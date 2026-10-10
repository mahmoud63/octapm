'use strict';

/**
 * CERT-3 builder 087-COM-C (plan §3.2 D1 087-COM-C; serves WP-4 I5, the certify gate).
 *
 * The contract value comes ONLY from the BOQ fallback: the project carries no
 * contract value, so the prime contract's first read records the bill's total
 * as originalValueSource boq_fallback (deep.087-COM-C.valueSource), and nobody
 * enters or confirms it. A submitted certificate is then refused at
 * certification with 409 CONTRACT_VALUE_NOT_ESTABLISHED (deep.087-COM-C.certifyGate,
 * WP4.I5.certifyOnBoqFallback); it is left submitted for the I5 proof, which
 * enters the value and certifies (WP4.I5.afterValueEntered).
 *
 * Retention is configured explicitly (project default 10%, HR-C1: no silent rate),
 * so the certificate the proof later certifies holds a configured retention.
 *
 * Every figure is a book key (round 2 R2-B, B3): the bill is deep.087-COM-C.billRows
 * (B-001 5,000 m3 x 12.00 and B-006 2,000 m3 x 8.00) totalling deep.087-COM-C.billTotal
 * 76,000.00, the fallback value; IPC-01 is deep.087-COM-C.ipc01 (5,000 m3, gross
 * 60,000.00, rate 10, retention 6,000.00, no recovery, deduction or tax, net 54,000.00).
 * Every adoption or read-back find selects by identity and asserts at most one match
 * (C.atMostOne; adjudication G6, round 2 R2-D).
 *
 * Debug: node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/build/087-com-c.js
 */

const lib = require('./lib');
const C = require('./_commercial');

const { is } = lib;
const { listOf, cents, money, one, atMostOne } = C;

const BOOK = lib.answers.commercial;
const DC = BOOK.deep['087-COM-C'];
const GATE = `${DC.certifyGate.value.status} ${DC.certifyGate.value.code}`; // 409 CONTRACT_VALUE_NOT_ESTABLISHED
const I01 = DC.ipc01;
/** A book money figure (integer cents) in major units, for a payload. */
const major = (figure) => figure.value / 100;
/** A book money figure as a matcher on a major-unit answer (compared in cents). */
const asCents = (figure) => is.cents(major(figure));
/** deep.087-COM-C.billRows, in one workbook section (the book's rows carry none; HR-C14 keeps no section anyway). */
const BILL = DC.billRows.value.map((row) => ({ ...row, section: 'Earthworks' }));
/** The configured rate (deep.087-COM-C.ipc01.retentionRate): the project default, the items' and the contract's. */
const RATE = I01.retentionRate.value;

lib.main('087-COM-C', async (b) => {
  await b.project({
    title: 'Commercial C',
    payload: {
      type: 'building',
      contractType: 'remeasurement',
      contractNumber: b.ref('PC'),
      startDate: '2026-01-05',
      endDate: '2027-06-30',
      completionDate: '2027-06-30',
      projectCalendar: 'five_day',
      currency: 'EGP',
      // HR-C1: retention configured explicitly (deep.087-COM-C.ipc01.retentionRate); no contract value on the project.
      defaultRetentionRate: RATE,
    },
    fields: { currency: 'EGP', defaultRetentionRate: RATE, contractValue: (v) => v === null || Number(v) === 0 || 'no contract value' },
  });
  await b.team({ planner: 'planning_eng', qs: 'qs', site: 'site_engineer', finance: 'finance' });

  const acts = await C.activitiesF1(b, { only: ['A100', 'A110'] });
  const A = acts.ids;

  const boq = await b.step('boq', async (s) => {
    const file = lib.files.boqWorkbook(BILL, { filename: b.file('BOQ.xlsx'), title: b.name('Bill of quantities') });
    s.assert(file.totalCents === DC.billTotal.value, `the workbook totals deep.087-COM-C.billTotal ${money(DC.billTotal.value)} (built ${money(file.totalCents)})`);
    const label = b.name('BOQ revision 1');
    const uploaded = await s.upload('boq.upload', 'qs', `${b.P}/boq/upload`, file, {
      expect: 200,
      form: { label },
      idOf: (d) => d?.revisionId ?? d?.id ?? null,
      get: (id) => `${b.P}/boq/revisions/${id}`,
      // The upload's answer (mode imported, its revisionId), or on an adoption the revision row of this build's label.
      fields: {
        mode: (v, d) => v === 'imported' || (v === undefined && d?.label === label) || "mode 'imported' (or the adopted revision of this label)",
        revisionId: (v, d) => Boolean(v || (d?.label === label && d?.id)) || 'a revision id',
      },
      // An interrupted upload is adopted from the revision this build's label names (identity, at most one: R2-D).
      find: async (s2) => atMostOne(listOf(await s2.get('qs', `${b.P}/boq`), 'revisions'), (r) => r.label === label, `BOQ revision ${label}`),
    });
    const items = listOf(await s.get('qs', `${b.P}/boq`), 'boqItems').filter((i) => i.isActive !== false);
    s.assert(items.length === BILL.length, `${BILL.length} bill rows (deep.087-COM-C.billRows; read ${items.length})`);
    const total = items.reduce((sum, i) => sum + cents(i.amount), 0);
    // deep.087-COM-C.billTotal: 5,000 x 12.00 + 2,000 x 8.00 = 76,000.00, the value the fallback takes.
    s.assert(total === DC.billTotal.value, `bill total deep.087-COM-C.billTotal ${money(DC.billTotal.value)} (read ${money(total)})`);
    // One row per code (G6), each as the book gives it.
    const ids = {};
    for (const row of BILL) {
      const item = one(items, (i) => i.code === row.code, `bill row ${row.code}`);
      s.expectFields(item, { quantity: row.quantity, rate: is.cents(row.rate), amount: is.cents(row.quantity * row.rate) }, `bill row ${row.code} (deep.087-COM-C.billRows)`);
      ids[row.code] = item.id;
    }
    return { revisionId: uploaded?.revisionId ?? uploaded?.id, ids, totalCents: total };
  }, { needs: ['activities'] });

  // The whole B-001 row on A110 (stage3:109.allocation.B-001/A110 60,000.00 = deep.087-COM-C.ipc01's 5,000 m3).
  await C.allocate(b, [{ key: 'B-001.A110', boqCode: 'B-001', activity: 'A110', quantity: I01.quantity.value, amount: major(BOOK['stage3:109']['allocation.B-001/A110']) }], { boqItems: boq.ids, activityIds: A });
  // A110 approved at 100% (deep.087-COM-C.ipc01.quantity: the whole 5,000 m3 within earned; a build choice).
  await C.progress(b, [{ activity: 'A110', pct: 100 }], { activityIds: A });

  // deep.087-COM-C.valueSource / billTotal: the first read records the bill's total as the BOQ fallback; nobody confirms it.
  await b.step('contract.fallback', async (s) => {
    const contract = await s.get('qs', `${b.P}/prime-contract`);
    s.expectFields(contract, { originalValueSource: DC.valueSource.value, originalValue: asCents(DC.billTotal), retentionRate: RATE }, 'the contract on the BOQ fallback (deep.087-COM-C.billTotal)');
    return { originalValueSource: contract.originalValueSource, originalValue: contract.originalValue, retentionRate: contract.retentionRate };
  }, { needs: ['boq'] });

  // A submitted certificate refused at the certify gate (WP4.I5.certifyOnBoqFallback): 409 CONTRACT_VALUE_NOT_ESTABLISHED.
  await b.step('ipc.01', async (s) => {
    const label = b.ref('IPC-01');
    const route = `${b.P}/ipc/${encodeURIComponent(label)}`;
    await s.create('ipc.01', 'qs', `${b.P}/ipc`, { period: label }, {
      get: () => route,
      fields: { period: label, status: 'draft' },
      adopt: true,
      find: async (s2) => atMostOne(listOf(await s2.get('qs', `${b.P}/ipc`)), (row) => row.period === label, `IPC period ${label}`),
    });
    let certificate = await s.get('qs', route);
    const item = one(certificate.items || [], (row) => row.allocationId === b.out('allocations').ids['B-001.A110'], 'IPC-01: the item of allocation B-001.A110');
    s.assert(Number(item.retentionRate) === RATE, `the item carries the configured ${RATE}% (deep.087-COM-C.ipc01.retentionRate; read ${item.retentionRate})`);
    // deep.087-COM-C.ipc01: gross 60,000.00, retention 6,000.00, no recovery, deduction or tax, net 54,000.00.
    const totals = { totalCert: asCents(I01.gross), totalRet: asCents(I01.retention), advanceRecovery: asCents(I01.advanceRecovery), deductions: asCents(I01.deductions), taxAmount: asCents(I01.taxAmount), netPayable: asCents(I01.net) };
    if (certificate.status === 'draft' || b.state.records['ipc.01.submit']?.status === 'pending') {
      await s.act('ipc.01.claim', 'qs', 'PATCH', `${route}/items/${item.id}`, { qty: I01.quantity.value }, {
        fields: { qty: I01.quantity.value, currentCert: asCents(I01.gross) },
        verify: async (s2) => Number(((await s2.get('qs', route)).items || []).find((row) => row.id === item.id)?.qty) === I01.quantity.value,
      });
      certificate = await s.get('qs', route);
      s.expectFields(certificate, totals, 'IPC-01 draft (deep.087-COM-C.ipc01)');
      await s.act('ipc.01.submit', 'qs', 'POST', `${route}/submit`, {}, {
        fields: { status: 'submitted' },
        verify: async (s2) => (await s2.get('qs', route)).status !== 'draft',
      });
    }
    // deep.087-COM-C.certifyGate (WP4.I5.certifyOnBoqFallback).
    await s.refused('ipc.01.certify.gate', 'pm', 'POST', `${route}/certify`, { comment: `Certify on the bill's total ${b.ref('IPC-01')}` }, GATE, {
      // An interrupted probe is found by what a wrongly accepted one would have made: a certified IPC-01.
      find: async (s2) => {
        const now = await s2.get('qs', route);
        return ['certified', 'paid'].includes(now.status) ? now : null;
      },
    });
    const end = await s.get('qs', route);
    s.expectFields(end, { status: 'submitted', ...totals }, 'IPC-01 left at the certify gate (deep.087-COM-C.ipc01)');
    const contract = await s.get('qs', `${b.P}/prime-contract`);
    s.expectFields(contract, { originalValueSource: DC.valueSource.value }, 'the value is still the fallback (the refusal wrote nothing)');
    return { label, status: end.status, netPayable: end.netPayable };
  }, { needs: ['allocations', 'progress', 'contract.fallback'] });
});
