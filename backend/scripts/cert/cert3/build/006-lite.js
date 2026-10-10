'use strict';

/**
 * CERT-3 deep population, 006-LITE "CERT3 Lite" (plan §3.2 "D3, company 006";
 * WP-0 choice of D3: 006 Atlas Infrastructure, Business, AED, Asia/Dubai).
 *
 * The reduced lane: four roles run the main path and the PM takes every step
 * of the missing planner.
 *   - one finance person brought in by D-ID-1 invitation and acceptance (006
 *     has no finance member; HR-A3: payment and retention release are
 *     finance-only). The address carries the state's creation stamp
 *     (cert3.finance.<yymmddhhmmss>@c006...), so a build started afresh never
 *     invites a person an earlier build already made a member (D-ID-1 Q3: 409
 *     ALREADY_MEMBER), and a resumed build keeps the same person;
 *   - the F1 programme: the PM imports, submits, approves, activates and
 *     baselines it (answers schedule.js D3.F1byPm; HR-S2 is fixed at f599e67,
 *     WP1-MS-1, so the approval and the baseline answer 200);
 *   - a 5-row BOQ with allocations (D3.boq = WP3.setup.boq / WP3.setup.allocations,
 *     387,000.00);
 *   - the site engineer submits progress and the QS approves it (D3.progress):
 *     A110 100, A120 50, A130 25, with 087-EV's loadings and direct costs, so
 *     the WP-3 T1 figures hold: every D3.WP3.T1 leaf (BAC = PV 387,000.00, EV
 *     97,500.00, AC 80,000.00, SPI 0.251938 with its alert, CPI 1.21875 without,
 *     EAC 317,538.46 and its basis, SV, CV, ETC), and the reporting zone through
 *     the API, Asia/Dubai with source 'project' and no note (D3.WP3.timeZone /
 *     timeZoneSource / timeZoneNote; R3-8);
 *   - one CO, left a draft (an approved CO would move BAC; D3.WP3.T1 assumes none);
 *   - one IPC: the QS submits it, the PM certifies it (period.certify is PM and
 *     finance only), finance issues the invoice and records the payment
 *     (commercial.js deep.006-LITE.ipcAfterConfiguration: gross 97,500.00,
 *     retention 9,750.00, net 87,750.00, paid in full, retention held);
 *   - retention: "left unconfigured" is the HR-C1 refusal case, asserted first
 *     (deep.006-LITE.retentionDefaultCase; the plan's own order, R3-19). HEAD
 *     has no such refusal (the refusing step and code are the fix's choice,
 *     adjudication C2), so that step is BLOCKED HR-C1 with what HEAD shows; no
 *     certificate is ever made at a silent rate. Retention is then configured
 *     explicitly at 10% (ipcAfterConfiguration.retentionRate): the project
 *     default and the contract, before the IPC period exists (builders'
 *     adjudication 087-OTH/052/006 item 6);
 *   - one daily log, one NCR, one RFI (site engineer).
 *
 * Resumable (G4): the CO, the NCR and the RFI, which the product lists, are
 * found again by their description or subject after an interruption (R2-C);
 * every find by identity asserts that at most one record matches
 * (lanes.atMostOne; R2-D).
 *
 * Run alone: node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/build/006-lite.js
 * The body is exported for the debug harness, which lives outside build/
 * (adjudication G9): C:\Temp\octapm-cert\scratch\build-debug\_debug-lane.js.
 */

const lib = require('./lib');
const lanes = require('./lanes');

const { is } = lib;
const COM = lib.answers.commercial;
const D3C = COM.deep['006-LITE'];
const D3S = lib.answers.schedule.D3;
const listOf = lanes.listOf;
const { atMostOne } = lanes; // G6 / R2-D: every find by identity names at most one record

const RETENTION_RATE = D3C.ipcAfterConfiguration.retentionRate.value; // 10 (assumption, adjudication C8)
const CONTRACT_VALUE = 387000; // the bill's in-scope total, entered by the PM (I5 gate: an established contract value)
/** The IPC items at the lane's approved progress (ipcAfterConfiguration.gross): code -> [activity, qty, rate]. */
const IPC_ITEMS = { 'E-001': ['A110', 5000, 12], 'E-002': ['A120', 100, 150], 'E-003': ['A130', 150, 150] };

async function body(b, opts = {}) {
  const debug = Boolean(opts.debug);

  // ── the project, created WITHOUT retention (the HR-C1 refusal case comes first) ──
  await b.project({
    title: 'Lite',
    payload: {
      startDate: lanes.SCHEDULE.inputs.start, endDate: '2026-12-31', projectCalendar: 'five_day', currency: 'AED',
      type: 'building', contractType: 'unit_rate', contractNumber: b.ref('CONTRACT'),
    },
    // defaultRetentionRate is not sent. Nothing is stored, yet GET /projects/:id shows 5 (project.service.js
    // serializer `defaultRetentionRate ?? DEFAULT_RETENTION_RATE`), while an IPC resolves Number(null) = 0
    // (ipc.service.js resolveRetentionRate): the HR-C1 step below records both.
    fields: { projectCalendar: 'five_day', currency: 'AED', startDate: is.day(lanes.SCHEDULE.inputs.start) },
  });

  // ── people: the invited finance person, then the team ──
  if (!debug) {
    const stamp = String(b.state.createdAt || '').replace(/\D/g, '').slice(2, 14); // yymmddhhmmss of this build's state
    b.assert(/^\d{12}$/.test(stamp), `the build state carries its creation time (${b.state.createdAt})`);
    await b.invite('finance', { email: `cert3.finance.${stamp}@${b.company.domain}`, role: 'finance', name: 'CERT3 Finance (006-LITE)' });
  }
  await b.team({ site: null, qs: null, finance: null });

  // ── the F1 programme, every planner step by the PM (answers D3.F1byPm) ──
  await lanes.scheduleF1(b, { importer: 'pm', submitter: 'pm', approver: 'pm', activator: 'pm', model: opts.f1Model });
  if (!debug) await lanes.assertF1Cpm(b, 'pm');

  // ── cost code, bill, allocations, baseline ──
  const codes = await lanes.costCodes(b, { admin: 'pm', codes: [{ suffix: '01', name: 'Works', category: 'subcontract' }] });
  await lanes.boqEv(b, { uploader: 'qs' });
  await lanes.allocationsEv(b, { creator: 'qs', approver: 'pm' });
  await lanes.assignEngineers(b, { persona: 'pm', engineer: 'site', codes: ['A110', 'A120', 'A130'] });
  await lanes.baselineF1(b, { persona: 'pm' });

  // ── planned value and actual cost (answers inputs.ev087 loadings / directCosts) ──
  await lanes.loadingsEv(b, { creator: 'qs', approver: 'finance' });
  await lanes.directCostsEv(b, { creator: 'qs', approver: 'finance', costCodeId: codes['01'] });

  // ── progress: the site engineer submits, the QS approves (D3.progress; EV 97,500.00) ──
  await lanes.progress(b, { step: 'progress.A110', code: 'A110', pct: 100, submitter: 'site', approver: 'qs', needs: ['schedule.assign'] });
  await lanes.progress(b, { step: 'progress.A120', code: 'A120', pct: 50, submitter: 'site', approver: 'qs', needs: ['schedule.assign'] });
  await lanes.progress(b, { step: 'progress.A130', code: 'A130', pct: 25, submitter: 'site', approver: 'qs', needs: ['schedule.assign'] });

  // ── WP-3 T1 on this lane: every D3.WP3.T1 leaf, and the Asia/Dubai reporting zone (R3-8) ──
  // (answers D3.WP3.T1, assumption: 087-EV's inputs in AED; D3.WP3.timeZone / timeZoneSource / timeZoneNote)
  await b.step('ev.T1', async (s) => {
    const t = await lanes.evTotals(s, b, 'pm');
    const figures = lanes.assertMetricLeaves(s, t, D3S.WP3.T1, 'D3.WP3.T1');
    let zone;
    if (debug) {
      // The debug harness runs this body in 087: the zone is that company's, read by the same rule.
      const rep = t.reporting || {};
      s.assert(rep.timeZone === b.company.timezone && rep.timeZoneSource === D3S.WP3.timeZoneSource.value, `the reporting zone is ${b.company.timezone}, source '${D3S.WP3.timeZoneSource.value}' (got ${rep.timeZone}, ${rep.timeZoneSource})`, rep);
      zone = { timeZone: rep.timeZone, timeZoneSource: rep.timeZoneSource, timeZoneNote: rep.timeZoneNote };
    } else {
      zone = lanes.assertReportingZone(s, b, t.reporting, D3S.WP3, 'D3.WP3');
    }
    return { ...figures, ...zone };
  }, { needs: ['progress.A110', 'progress.A120', 'progress.A130', 'ev.loadings', 'ev.costs', 'boq.allocations'] });

  // ── retention: the HR-C1 refusal case first, then explicit configuration ──
  // deep.006-LITE.retentionDefaultCase: { status: null, code: null, rule: HR-C1 }. HEAD has no refusing step: the
  // project read shows a 5 nobody configured and the contract is created holding 5 (ensureContract), while an IPC
  // created now would carry items at 0% (Number(null)). Nothing is certified to show it.
  // The observation is taken once, before anything is configured: once the project default or the contract has been
  // written (even by an interrupted retention.configure), the first observation stands.
  const configuredOnce = b.isDone('retention.configure') || Boolean(b.state.records['retention.configure.project']);
  if (!configuredOnce) {
    await b.step('retention.unconfigured', async (s) => {
      const project = await s.get('pm', b.P);
      const contract = await s.get('qs', `${b.P}/prime-contract`);
      s.blocked('HR-C1', `no request refuses an unconfigured retention at HEAD (the refusing step and code are the HR-C1 fix's choice, adjudication C2). Observed before configuration: GET /projects/:id defaultRetentionRate ${JSON.stringify(project?.defaultRetentionRate)} (none was sent; serializer default), GET /prime-contract retentionRate ${JSON.stringify(contract?.retentionRate)} (written by ensureContract from the default), while ipc.service.js resolveRetentionRate gives Number(null) = 0 for IPC items. No certificate was made at a silent rate.`);
    });
  } else {
    // The refusal case runs only before configuration; once configured, its recorded observation stands (still BLOCKED HR-C1).
    const prior = b.state.steps['retention.unconfigured']?.blocked;
    b.blocked('retention.unconfigured', prior?.ref || 'HR-C1', prior?.observed || 'HR-C1: no refusing step at HEAD (observation recorded by the first run)');
  }
  await b.step('retention.configure', async (s) => {
    await s.act('retention.configure.project', 'pm', 'PATCH', b.P, { defaultRetentionRate: RETENTION_RATE }, {
      fields: { defaultRetentionRate: is.number(RETENTION_RATE) },
      verify: async (s2) => Number((await s2.get('pm', b.P))?.defaultRetentionRate) === RETENTION_RATE,
    });
    // The contract value: the bill's total, which ensureContract stored as the BOQ fallback, confirmed by the
    // PM (who reads the BOQ) so it is established for the certify gate (I5). Sending the same amount as
    // originalValue would be a save, not an entry (prime-contract.service.js updateContract).
    await s.act('retention.configure.contract', 'pm', 'PATCH', `${b.P}/prime-contract`, {
      retentionRate: RETENTION_RATE, confirmOriginalValue: true, status: 'active', notes: b.name('Contract: retention configured explicitly'),
    }, {
      fields: { retentionRate: is.number(RETENTION_RATE), originalValue: is.cents(CONTRACT_VALUE), originalValueSource: 'contract_entry' },
      verify: async (s2) => {
        const c = await s2.get('pm', `${b.P}/prime-contract`);
        return Number(c?.retentionRate) === RETENTION_RATE && c?.originalValueSource === 'contract_entry';
      },
    });
    const contract = await s.get('qs', `${b.P}/prime-contract`);
    s.expectFields(contract, { retentionRate: is.number(RETENTION_RATE), originalValue: is.cents(CONTRACT_VALUE) }, 'the contract');
    return { retentionRate: RETENTION_RATE, originalValue: CONTRACT_VALUE };
  });

  // ── one CO, a draft (the QS) ──
  await b.step('co.one', async (s) => {
    const activityId = b.isDone('schedule.activate.F1') ? b.out('schedule.activate.F1').activities.A110 : null;
    const description = `${b.ref('CO-01')} additional dewatering to the excavation`;
    const co = await s.create('co.one', 'qs', `${b.P}/change-orders`, {
      description, value: 5000, status: 'draft', category: 'scope',
      ...(activityId ? { activityId } : {}),
      costImpactSummary: b.name('CO cost impact: dewatering pumps'),
      scheduleImpactSummary: b.name('CO schedule impact: none'),
    }, {
      fields: { status: 'draft', value: is.cents(5000), description },
      get: null, // no GET /change-orders/:id; the list answers { orders, summary }: the step's verify reads it
      // Interrupted (R2-C, G4): the register lists the project's change orders; the one carrying this
      // description is adopted (at most one), never made twice.
      find: async (s2) => atMostOne(s2, listOf(await s2.get('qs', `${b.P}/change-orders`)), (o) => o.description === description, `change order ${b.ref('CO-01')}`),
    });
    return { id: co.id, ref: co.ref || null };
  }, {
    verify: async (s, out) => {
      const row = listOf(await s.get('qs', `${b.P}/change-orders`)).find((o) => o.id === out.id);
      return (row && row.status === 'draft') || `CO ${out.id} is ${row ? row.status : 'gone'}`;
    },
  });

  // ── one IPC: the QS submits, the PM certifies, finance invoices and is paid ──
  const PERIOD = b.ref('IPC-01');
  await b.step('ipc.create', async (s) => {
    const cert = await s.create('ipc.create', 'qs', `${b.P}/ipc`, { period: PERIOD }, {
      fields: { period: PERIOD, status: 'draft' },
      get: () => `${b.P}/ipc/${encodeURIComponent(PERIOD)}`,
      find: async (s2) => atMostOne(s2, listOf(await s2.get('qs', `${b.P}/ipc`)), (c) => c.period === PERIOD, `IPC ${PERIOD}`),
    });
    const detail = await s.get('qs', `${b.P}/ipc/${encodeURIComponent(PERIOD)}`);
    const items = listOf(detail?.items);
    s.assert(items.length === 5, `the certificate carries one item per approved allocation (5; got ${items.length})`, items.map((i) => i.boqItemId));
    for (const it of items) s.assert(Number(it.retentionRate) === RETENTION_RATE, `item ${it.id} carries the configured ${RETENTION_RATE}% (got ${it.retentionRate})`);
    return { id: cert.id, period: PERIOD };
  }, { needs: ['boq.allocations', 'retention.configure', 'progress.A110', 'progress.A120', 'progress.A130'] });

  await b.step('ipc.items', async (s) => {
    const items = b.out('boq.upload').items;
    const C = `${b.P}/ipc/${encodeURIComponent(PERIOD)}`;
    const detail = await s.get('qs', C);
    const out = {};
    for (const [code, [activity, qty, rate]] of Object.entries(IPC_ITEMS)) {
      const mine = listOf(detail?.items).filter((i) => i.boqItemId === items[code]);
      s.assert(mine.length === 1, `the certificate has exactly one item for ${code} (${activity}; found ${mine.length})`);
      const [it] = mine;
      const data = await s.act(`ipc.items.${code}`, 'qs', 'PATCH', `${C}/items/${it.id}`, { qty, rate }, {
        fields: { qty: is.number(qty), rate: is.cents(rate) },
        // Interrupted: the item is read back on its certificate; the quantity and rate on it mean the PATCH took effect.
        verify: async (s2) => {
          const row = listOf((await s2.get('qs', C))?.items).find((i) => i.id === it.id);
          return Number(row?.qty) === qty && lib.sameCents(row?.rate, rate);
        },
      });
      out[code] = { id: it.id, qty, rate, currentCert: data?.currentCert ?? null };
    }
    return out;
  }, { needs: ['ipc.create'] });

  await b.step('ipc.submit', async (s) => {
    const C = `${b.P}/ipc/${encodeURIComponent(PERIOD)}`;
    await s.act('ipc.submit', 'qs', 'POST', `${C}/submit`, {}, {
      fields: { status: 'submitted' },
      verify: async (s2) => (await s2.get('qs', C))?.status !== 'draft',
    });
    return { status: 'submitted' };
  }, { needs: ['ipc.items'] });

  await b.step('ipc.certify', async (s) => {
    const C = `${b.P}/ipc/${encodeURIComponent(PERIOD)}`;
    const data = await s.act('ipc.certify', 'pm', 'POST', `${C}/certify`, { comment: b.name('IPC 1 certified') }, {
      // deep.006-LITE.ipcAfterConfiguration: gross 97,500.00, retention 9,750.00, net 87,750.00
      fields: {
        status: 'certified',
        totalCert: is.cents(D3C.ipcAfterConfiguration.gross.value / 100),
        totalRet: is.cents(D3C.ipcAfterConfiguration.retention.value / 100),
        netPayable: is.cents(D3C.ipcAfterConfiguration.net.value / 100),
      },
      verify: async (s2) => ['certified', 'invoiced', 'paid', 'partially_paid'].includes((await s2.get('qs', C))?.status),
    });
    return { totalCert: data?.totalCert, totalRet: data?.totalRet, netPayable: data?.netPayable };
  }, { needs: ['ipc.submit'] });

  const INVOICE = b.ref('INV-01');
  const PAYMENT = b.ref('PAY-01');
  /** The certificate's invoice, by its number (exactly one; G6). */
  const invoiceOf = (s, cert) => {
    const mine = listOf(cert?.invoices).filter((i) => i.invoiceNumber === INVOICE);
    s.assert(mine.length === 1, `the certificate carries exactly one invoice ${INVOICE} (found ${mine.length})`, listOf(cert?.invoices).map((i) => i.invoiceNumber));
    return mine[0];
  };
  await b.step('ipc.invoice', async (s) => {
    const C = `${b.P}/ipc/${encodeURIComponent(PERIOD)}`;
    const date = b.date(0);
    await s.create('ipc.invoice', 'finance', `${C}/invoice/issue`, { invoiceNumber: INVOICE, invoiceDate: date, dueDate: b.date(30, { future: true }) }, {
      fields: { invoiceNumber: INVOICE },
      idOf: (d) => d?.id ?? d?.invoice?.id ?? null,
      get: null, // the invoice is read on its certificate (below and in the step's verify)
      find: async (s2) => atMostOne(s2, listOf((await s2.get('finance', C))?.invoices), (i) => i.invoiceNumber === INVOICE, `invoice ${INVOICE}`),
    });
    const inv = invoiceOf(s, await s.get('finance', C));
    s.expectFields(inv, { netAmount: is.cents(D3C.ipcAfterConfiguration.net.value / 100), retentionHeld: is.cents(D3C.ipcAfterConfiguration.retention.value / 100) }, 'the invoice');
    return { invoiceId: inv.id };
  }, {
    needs: ['ipc.certify'],
    verify: async (s, out) => listOf((await s.get('finance', `${b.P}/ipc/${encodeURIComponent(PERIOD)}`))?.invoices).some((i) => i.id === out.invoiceId) || `invoice ${out.invoiceId} is no longer on the certificate`,
  });

  await b.step('ipc.payment', async (s) => {
    const C = `${b.P}/ipc/${encodeURIComponent(PERIOD)}`;
    const amount = D3C.ipcAfterConfiguration.amountPaid.value / 100; // 87,750.00
    // The payment's own id (R1-22: adopted by lookup, never a made-up id): the answer's payment, or the
    // certificate's payment carrying this reference.
    await s.create('ipc.payment', 'finance', `${C}/payments`, {
      amount, paymentReference: PAYMENT, paymentDate: b.date(0), paymentMethod: 'bank_transfer', notes: b.name('Client payment of IPC 1'),
    }, {
      fields: { 'payment.paymentReference': PAYMENT, 'payment.amount': is.cents(amount) },
      idOf: (d) => d?.payment?.id ?? null,
      get: null, // read on its certificate by the step's verify
      find: async (s2) => {
        const row = atMostOne(s2, listOf((await s2.get('finance', C))?.payments), (p) => p.paymentReference === PAYMENT, `payment ${PAYMENT}`);
        return row ? { payment: row } : null;
      },
    });
    const paymentId = s.id('ipc.payment');
    const cert = await s.get('finance', C);
    const inv = invoiceOf(s, cert);
    const paid = listOf(cert?.payments).filter((p) => p.paymentReference === PAYMENT);
    s.assert(paid.length === 1 && paid[0].id === paymentId, `the certificate carries the one payment ${PAYMENT} (${paymentId})`, paid);
    // deep.006-LITE.ipcAfterConfiguration.endState: paid / paid, retention held, balance 0.00
    s.expectFields(cert, { status: 'paid' }, 'the certificate after payment');
    s.expectFields(inv, { amountPaid: is.cents(amount), balanceDue: is.cents(0), status: 'paid' }, 'the invoice after payment');
    return { paymentId, amountPaid: amount, status: cert.status };
  }, {
    needs: ['ipc.invoice'],
    verify: async (s, out) => {
      const cert = await s.get('finance', `${b.P}/ipc/${encodeURIComponent(PERIOD)}`);
      const row = listOf(cert?.payments).find((p) => p.id === out.paymentId);
      return (row && lib.sameCents(row.amount, out.amountPaid) && cert.status === 'paid') || `payment ${out.paymentId} is ${row ? `${row.amount}, the certificate ${cert.status}` : 'gone'}`;
    },
  });

  // ── field: one daily log, one NCR, one RFI (the site engineer) ──
  // The day is pinned the first time (yesterday then), so a resumed run on a later day writes to the same log.
  const { date: logDate } = await b.step('field.daily-log.day', async () => ({ date: b.date(-1) }));
  await b.step('field.daily-log', async (s) => {
    const D = `${b.P}/daily-logs/${logDate}`;
    await s.act('field.daily-log.summary', 'site', 'PATCH', D, { summary: `${b.ref('DLOG')} excavation and blinding on site` }, {
      fields: { date: is.day(logDate) },
      verify: async (s2) => String((await s2.get('site', D))?.summary || '').includes(b.ref('DLOG')),
    });
    const entry = await s.create('field.daily-log.manpower', 'site', `${D}/entries/manpower`, {
      trade: 'Labourer', workers: 6, hours: 8, companyName: b.name('Own forces'), notes: b.ref('DLOG-MP'),
    }, {
      // The answer is the whole day (201); the entry is found in its manpower section by its note.
      idOf: (d) => listOf(d?.sections?.manpower).find((r) => String(r.notes || '').includes(b.ref('DLOG-MP')))?.id ?? null,
      fields: { 'sections.manpower': (v) => listOf(v).some((r) => String(r.notes || '').includes(b.ref('DLOG-MP')) && Number(r.workers) === 6) || 'the manpower row (6 workers)' },
      get: null,
      // Interrupted: the day is read again; a manpower row with this note means the entry was made.
      find: async (s2) => {
        const day = await s2.get('site', D);
        return atMostOne(s2, listOf(day?.sections?.manpower), (r) => String(r.notes || '').includes(b.ref('DLOG-MP')), `manpower row ${b.ref('DLOG-MP')}`) ? day : null;
      },
    });
    await s.act('field.daily-log.submit', 'site', 'POST', `${D}/submit`, {}, {
      fields: { status: 'submitted' },
      verify: async (s2) => (await s2.get('site', D))?.status !== 'open',
    });
    const log = await s.get('site', D);
    s.expectFields(log, { status: 'submitted' }, 'the daily log');
    const entryId = s.id('field.daily-log.manpower');
    const rows = listOf(log?.sections?.manpower).filter((r) => r.id === entryId);
    s.assert(rows.length === 1 && Number(rows[0].workers) === 6, `the daily log carries its one manpower row ${entryId} (6 workers)`, log?.sections?.manpower);
    return { date: logDate, entryId };
  }, {
    // The manpower row has no read-back route of its own (get: null): it is read live on its day.
    verify: async (s, out) => {
      const log = await s.get('site', `${b.P}/daily-logs/${out.date}`);
      const rows = listOf(log?.sections?.manpower).filter((r) => r.id === out.entryId);
      return (log?.status === 'submitted' && rows.length === 1 && Number(rows[0].workers) === 6) || `the daily log of ${out.date} is ${log?.status} with ${rows.length} manpower row(s) ${out.entryId}`;
    },
  });

  await b.step('field.ncr', async (s) => {
    const activityId = b.isDone('schedule.activate.F1') ? b.out('schedule.activate.F1').activities.A120 : null;
    const description = `${b.ref('NCR-01')} blinding concrete below the specified thickness`;
    const ncr = await s.create('field.ncr', 'site', `${b.P}/ncr`, {
      severity: 'minor', description, disposition: 'Rework to the specified thickness', responsible: b.name('Concrete gang'),
      dueDate: b.date(14, { future: true }), ...(activityId ? { activityId } : {}),
    }, {
      fields: { severity: 'minor', status: 'open', description },
      get: null, // no GET /ncr/:id; the list answers { rows, summary }: the step's verify reads it
      // Interrupted (R2-C, G4): the register lists the project's NCRs; the one carrying this description is adopted (at most one).
      find: async (s2) => atMostOne(s2, listOf(await s2.get('site', `${b.P}/ncr`)), (n) => n.description === description, `NCR ${b.ref('NCR-01')}`),
    });
    return { id: ncr.id };
  }, {
    verify: async (s, out) => {
      const row = listOf(await s.get('site', `${b.P}/ncr`)).find((n) => n.id === out.id);
      return (row && row.severity === 'minor') || `NCR ${out.id} is ${row ? row.severity : 'gone'}`;
    },
  });

  await b.step('field.rfi', async (s) => {
    const subject = `${b.ref('RFI-01')} founding level at grid C`;
    const rfi = await s.create('field.rfi', 'site', `${b.P}/rfi`, {
      subject, question: 'Please confirm the founding level at grid C; the drawing and the soil report differ.', priority: 'normal', status: 'open',
    }, {
      fields: { subject, status: 'open' },
      // Interrupted (R2-C, G4): the RFI register lists the project's RFIs (searched by this build's ref); the one
      // carrying this subject is adopted (at most one), never made twice. Read back by GET /rfi/:id.
      find: async (s2) => atMostOne(s2, listOf(await s2.get('site', `${b.P}/rfi?limit=100&search=${encodeURIComponent(b.ref('RFI-01'))}`)), (r) => r.subject === subject, `RFI ${b.ref('RFI-01')}`),
    });
    return { id: rfi.id };
  });
}

if (require.main === module) lib.main('006-LITE', (b) => body(b));
module.exports = { body };
