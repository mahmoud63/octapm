'use strict';

/**
 * CERT-3 builder 087-COM-B (plan §3.2 D1 087-COM-B; serves WP-4 I2 / C3 and WP-5 O6).
 *
 *   - project retention 7.5% (defaultRetentionRate, at creation) and the prime
 *     contract's retention 10%, set explicitly (deep.087-COM-B.projectRetention /
 *     primeContractRetention; adjudication C3 corrected the swapped cell);
 *   - the I1-shaped row for WP4.I2: 1,000 m3 @ 100 allocated to A110, A110 approved
 *     at 40%, so the proof's period certifies 400 x 100 = 40,000.00 (expected
 *     retention 4,000 / net 36,000 at the contract's 10; today 3,000 / 37,000
 *     because HEAD reads the project default: L114, HR-C1);
 *   - a commitment with no rate of its own: it takes the project's 7.5 (WP4.C3.projectDefault);
 *   - its first purchase order, PO-00001, issued: the same reference as
 *     087-COM's first order (deep.087-COM-B.poRefCollision, WP5.O6). 087-COM is
 *     built first (run-all order), so the collision is asserted strictly, live on
 *     both projects (R2-7): a missing or unfinished 087-COM fails this build.
 *
 * Every adoption or read-back find selects by identity and asserts at most one match
 * (C.atMostOne; adjudication G6, round 2 R2-D).
 *
 * Debug: node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/build/087-com-b.js
 */

const lib = require('./lib');
const C = require('./_commercial');

const { is } = lib;
const { listOf, cents, money, one, atMostOne } = C;

const BOOK = lib.answers.commercial;
const DB = BOOK.deep['087-COM-B'];
const PROJECT_RATE = DB.projectRetention.value; // 7.5
const CONTRACT_RATE = DB.primeContractRetention.value; // 10
const COLLIDING_REF = DB.poRefCollision.value; // PO-00001

lib.main('087-COM-B', async (b) => {
  await b.project({
    title: 'Commercial B',
    payload: {
      type: 'building',
      contractType: 'remeasurement',
      contractNumber: b.ref('PC'),
      startDate: '2026-01-05',
      endDate: '2027-06-30',
      completionDate: '2027-06-30',
      projectCalendar: 'five_day',
      currency: 'EGP',
      // deep.087-COM-B.projectRetention: 7.5, explicit.
      defaultRetentionRate: PROJECT_RATE,
    },
    fields: { currency: 'EGP', defaultRetentionRate: PROJECT_RATE, projectCalendar: 'five_day' },
  });
  await b.team({ planner: 'planning_eng', qs: 'qs', cost: 'cost_controller', procurement: 'procurement', site: 'site_engineer', finance: 'finance' });

  await C.costCodes(b, [
    { code: '02-100', name: b.name('Material'), category: 'material' },
    { code: '03-100', name: b.name('Subcontract'), category: 'subcontract' },
  ]);
  await C.budgetLines(b, [
    { code: '02-100', costType: 'material', originalBudget: 50000, description: 'Material' },
    { code: '03-100', costType: 'subcontract', originalBudget: 50000, description: 'Subcontract' },
  ]);
  const codeId = (code) => b.out('cost-codes').ids[code];
  const lineId = (code, type) => b.out('budget-lines').ids[`${code}:${type}`];

  const acts = await C.activitiesF1(b, { only: ['A100', 'A110'] });
  const A = acts.ids;

  // The I1-shaped row (WP4.I1.currentCert: 1,000 m3 @ 100 = 100,000) and one more.
  const boq = await b.step('boq', async (s) => {
    const rows = [
      { code: 'C-001', description: 'Ground slab concrete C30', quantity: 1000, unit: 'm3', rate: 100, mappingRule: 'required', section: 'Substructure' },
      { code: 'C-002', description: 'Slab formwork edges', quantity: 400, unit: 'm', rate: 25, mappingRule: 'optional', section: 'Substructure' },
    ];
    const file = lib.files.boqWorkbook(rows, { filename: b.file('BOQ.xlsx'), title: b.name('Bill of quantities') });
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
    s.assert(items.length === rows.length, `${rows.length} bill rows (read ${items.length})`);
    const total = items.reduce((sum, i) => sum + cents(i.amount), 0);
    s.assert(total === file.totalCents, `bill total ${money(file.totalCents)} (read ${money(total)})`);
    // One row per code (G6).
    const ids = Object.fromEntries(rows.map((row) => [row.code, one(items, (i) => i.code === row.code, `bill row ${row.code}`).id]));
    return { revisionId: uploaded?.revisionId ?? uploaded?.id, ids, totalCents: total };
  }, { needs: ['activities'] });

  await C.allocate(b, [{ key: 'C-001.A110', boqCode: 'C-001', activity: 'A110', quantity: 1000, amount: 100000 }], { boqItems: boq.ids, activityIds: A });
  // WP4.I2: the activity approved at 40%, so 400 m3 may be certified.
  await C.progress(b, [{ activity: 'A110', pct: 40 }], { activityIds: A });

  // The contract: value established, retention 10% set explicitly (ensureContract first copies the project's 7.5).
  await b.step('contract', async (s) => {
    const first = await s.get('qs', `${b.P}/prime-contract`);
    // deep.087-COM-B.primeContractRetention note: the first read copies the project default 7.5 onto the contract.
    // Only an interrupted earlier attempt (s.dirty) may already have configured the contract's 10 (R2-14).
    s.assert(Number(first.retentionRate) === PROJECT_RATE || (s.dirty && Number(first.retentionRate) === CONTRACT_RATE), `the contract's first retention is the project's ${PROJECT_RATE}${s.dirty ? ` (or ${CONTRACT_RATE} after an interrupted attempt)` : ''} (read ${first.retentionRate})`);
    const data = await s.act('contract.configure', 'qs', 'PATCH', `${b.P}/prime-contract`, {
      title: b.name('Client contract'),
      originalValue: 2000000,
      retentionRate: CONTRACT_RATE,
      paymentTermsDays: 30,
      status: 'active',
      notes: `Contract terms ${b.ref('CONTRACT')}`,
    }, {
      fields: { originalValueSource: BOOK.WP4.I5.valueSourceAfter.value, retentionRate: CONTRACT_RATE, originalValue: is.cents(2000000) },
      verify: async (s2) => Number((await s2.get('qs', `${b.P}/prime-contract`)).retentionRate) === CONTRACT_RATE,
    });
    const project = await s.get('pm', b.P);
    // deep.087-COM-B: project 7.5, contract 10 (the I2 proof's two rates).
    s.expectFields({ project: project.defaultRetentionRate, contract: data.retentionRate }, { project: PROJECT_RATE, contract: CONTRACT_RATE }, 'the two retention rates');
    return { firstRead: { source: first.originalValueSource, retentionRate: first.retentionRate }, retentionRate: CONTRACT_RATE, projectDefault: PROJECT_RATE };
  }, { needs: ['boq'] });

  // WP4.C3.projectDefault: a commitment with no rate takes the project's 7.5 (it never reads the contract's 10).
  await b.step('commitment.C3', async (s) => {
    const title = b.name('Subcontract C3 with no rate of its own');
    const made = await s.create('commitment.C3', 'qs', `${b.P}/commitments`, {
      type: 'subcontract',
      title,
      description: `Retention taken from the project default ${b.ref('C3')}`,
      lines: [{ description: `Slab works ${b.ref('C3-L1')}`, costCodeId: codeId('03-100'), budgetLineId: lineId('03-100', 'subcontract'), activityId: A.A110, unit: 'ls', qty: 1, amount: 20000 }],
    }, {
      fields: { title, status: 'draft', retentionRate: BOOK.WP4.C3.projectDefault.value },
      adopt: true,
      find: async (s2) => atMostOne(listOf(await s2.get('qs', `${b.P}/commitments?includeVoid=true&search=${encodeURIComponent('C3')}`)), (row) => row.title === title, 'commitment C3'),
    });
    return { id: made.id, retentionRate: made.retentionRate };
  }, { needs: ['budget-lines', 'activities'] });

  // WP5.O6 / deep.087-COM-B.poRefCollision: this project's first order is PO-00001, issued (receivable).
  await b.step('po.PO-00001', async (s) => {
    const code = 'SUP-087COMB';
    const suppliers = `${b.P}/procurement/suppliers`;
    const supplier = await s.create('supplier', 'procurement', suppliers, {
      name: b.name('Block supplier'),
      code,
      contactName: `Sales desk ${b.ref('SUP')}`,
      email: 'blocks.087comb@suppliers.c087.octapm-cert.test',
      status: 'approved',
      notes: b.ref('SUP'),
    }, {
      get: suppliers,
      fields: { status: 'approved' },
      adopt: true,
      find: async (s2) => atMostOne(listOf(await s2.get('procurement', suppliers)), (row) => row.code === code, `supplier ${code}`),
    });
    const item = `${b.name('Concrete blocks')} ${b.ref('PO-1')}`;
    const order = await s.create('po.1', 'procurement', `${b.P}/procurement/purchase-orders`, {
      item,
      supplierId: supplier.id,
      status: 'draft',
      currency: 'EGP',
      requiredBy: b.date(21, { future: true }),
      promisedDate: b.date(14, { future: true }),
      buyer: `Buyer ${b.ref('PO')}`,
      notes: b.ref('PO-1'),
      lines: [{ lineNumber: 1, activityId: A.A110, costCodeId: codeId('02-100'), budgetLineId: lineId('02-100', 'material'), description: `Concrete block 200mm (${b.code})`, unit: 'pcs', orderedQty: 50, unitCost: 10, notes: b.ref('PO-1-L1') }],
    }, {
      get: (id) => `${b.P}/purchase-orders/${id}`,
      fields: {
        status: 'draft',
        ref: COLLIDING_REF,
        value: is.cents(50 * 10),
        lines: (v) => (Array.isArray(v) && v.length === 1 && v[0].description === `Concrete block 200mm (${b.code})` && Number(v[0].orderedQty) === 50 && lib.sameCents(v[0].unitCost, 10)) || 'one line of 50 blocks @ 10.00',
      },
      adopt: true,
      find: async (s2) => {
        const row = atMostOne(listOf(await s2.get('procurement', `${b.P}/procurement/purchase-orders`)), (r) => r.item === item, 'purchase order PO-1');
        return row ? s2.get('procurement', `${b.P}/purchase-orders/${row.id}`) : null;
      },
    });
    const status = async () => (await s.get('procurement', `${b.P}/purchase-orders/${order.id}`)).status;
    const pending = (name) => b.state.records[name]?.status === 'pending';
    const go = (verb, persona, done) => s.act(`po.1.${verb}`, persona, 'POST', `${b.P}/purchase-orders/${order.id}/${verb}`, {}, { fields: { id: order.id }, verify: async () => done.includes(await status()) });
    if ((await status()) === 'draft' || pending('po.1.submit')) await go('submit', 'procurement', ['pending_approval', 'approved', 'issued']);
    if ((await status()) === 'pending_approval' || pending('po.1.approve')) await go('approve', 'pm', ['approved', 'issued']);
    if ((await status()) === 'approved' || pending('po.1.issue')) await go('issue', 'procurement', ['issued']);
    const end = await s.get('procurement', `${b.P}/purchase-orders/${order.id}`);
    s.expectFields(end, { ref: COLLIDING_REF, status: 'issued' }, COLLIDING_REF);
    // The collision is with 087-COM's first order: 087-COM is built before this build (run-all order), so its
    // state must name that order and the order must read PO-00001 live (R2-7: no swallowed error).
    const other = b.other('087-COM');
    const theirs = other.out('purchase-orders').ack;
    s.assert(Boolean(theirs?.id) && theirs.ref === COLLIDING_REF, `087-COM's state names its first order ${COLLIDING_REF} (read ${theirs?.ref})`);
    s.expectFields(await s.get('procurement', `${other.P}/purchase-orders/${theirs.id}`), { ref: COLLIDING_REF }, `087-COM's first order, read live`);
    return { supplierId: supplier.id, orderId: order.id, ref: end.ref, collidesWith: { code: '087-COM', projectId: other.projectId, orderId: theirs.id } };
  }, {
    needs: ['budget-lines', 'activities'],
    // On every resume: this order is still PO-00001, and so is 087-COM's first order, live.
    verify: async (s, out) => {
      const mine = await s.get('procurement', `${b.P}/purchase-orders/${out.orderId}`);
      if (mine.ref !== COLLIDING_REF) return `this project's order reads ${mine.ref}`;
      const other = b.other('087-COM');
      const theirs = other.out('purchase-orders').ack;
      const read = await s.get('procurement', `${other.P}/purchase-orders/${theirs.id}`);
      return read.ref === COLLIDING_REF || `087-COM's first order reads ${read.ref}`;
    },
  });
});
