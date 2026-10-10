'use strict';

/**
 * CERT-3 deep population, 052-COM "CERT3 Commercial" (plan §3.2 "D2, company
 * 052": "052-COM: IPC I1, I3, I4 and I8; pay applications P3 and P4; change
 * events E1 and E2; commitments C1 and C2; PO O2"), 052 Summit General
 * Contractors, USD. The same answers as 087-COM, in USD cents, under another
 * company's owner and administration (answer book commercial.js deep["052-COM"],
 * which mirrors WP4 I1/I3/I4/I8, P3/P4, E1/E2, C1/C2 and WP5 O2; read as D052 below).
 *
 * What it leaves (the request shapes are 087-COM's: helpers from _commercial.js):
 *   - the project WITHOUT defaultRetentionRate (deep["052-COM"].I1 "assumes 052-COM
 *     is also created without defaultRetentionRate"), shown through the API only
 *     (adjudication G5, R3-18): the display default, the contract's first read and
 *     IPC-01's items (findings HR-C1);
 *   - the F1 network hand-built, a bill of B-001..B-005 (stage 3), C-001 (the I1
 *     row 1,000 m3 @ 100) and D-001 (1,000 m3 @ 97.50, the I8 certificate's row),
 *     approved allocations (B-002 split A120 200 / A130 600) and approved
 *     progress: A110, A120, A130 at 100 (I3: "both activities at 100%"), A220 40
 *     (I1), A310 and A320 50 (P2/P3/P4 caps), A200 100 (I8);
 *   - the contract value established at 2,000,000.00 (the I5 gate before any certify);
 *   - I3: CO 7,500 approved with allocationLinks [{B-002/A120, qty 50, 7,500}]
 *     (WP4.I3: A120 limit 250 m3 / 37,500.00, A130 600 / 90,000.00). A130 is never
 *     certified in this build, so the I3 proof's PATCH of 650 on A130 meets no
 *     earlier certified amount (WP4.I3.patchA130Qty650 note);
 *   - I1: IPC-01 a draft claiming C-001 400 m3 = 40,000.00 at the silent item rate 0
 *     (retention unconfigured); its certification is the HR-C1 refusal case:
 *     BLOCKED HR-C1, not sent (it would settle at 0). Then retention is configured
 *     explicitly: the contract's retentionRate 10 (deep["052-COM"].contractRetentionRate),
 *     and, because HEAD reads the project default for items (finding L114), 10 is sent on
 *     each later claimed item and asserted on its answer (as 087-COM does);
 *   - I8: IPC-02 on D-001 1,000 m3: 97,500.00 / 9,750.00 / 87,750.00, certified,
 *     invoiced; its moments asserted as they happen (R3-3, R2-9): 87,750.01 refused,
 *     paid 87,750.00 (payFull), 9,750.01 release refused, 9,750.00 released (the state
 *     after it exactly; status per HR-C3's today, a finding), the 9,750.00 paid (WP4.I8);
 *   - I4: IPC-03 left SUBMITTED (with IPC-01 draft and IPC-02 paid, the states the
 *     I4 refusals are probed on); its figures are deep["052-COM"].ipc03 (B-001 1,000 m3
 *     x 12.00 = 12,000.00, retention 1,200.00, net 10,800.00; round 3 R3-1);
 *   - E1: lines 6,000 + 4,000, vendor A quotes 5,700 + 3,800 through the public
 *     link, accepted, converted to a draft CO of 9,500.00 (WP4.E1);
 *     E2: another event priced the same way and left PRICED for the concurrent
 *     converts (WP4.E2);
 *   - C1/C2: SC-001 executed (100,000.00 on A310, required insurance on file) with
 *     a commitment CO +10,000 approved (committed 110,000.00, each moment asserted) and
 *     one +5,000 pending (does not count); SC-002 executed on a PM override after its
 *     COMMITMENT_INSURANCE_MISSING and COMMITMENT_OVERRIDE_REASON_REQUIRED refusals
 *     (WP4.C1, C2);
 *   - P3: PA-01 on SC-001 50,000.00 approved, revoked to draft with a reason,
 *     re-approved (certificationRevision 1), each transition guarded on its own status
 *     (as 087-COM's R2-1) (WP4.P3); P4: 20,000.00 paid on it (status approved, paid
 *     20,000.00), and PA-P4 on SC-003 (insurance on file; SC-002's applications meet the
 *     compliance gate) approved 50,000.00 / net 45,000.00 with nothing paid, for the
 *     ceiling probes (WP4.P4);
 *   - O2: a PO of 100 bags @ 10.00 issued, 60 received: partial, left open for the
 *     O2 proof (close refusals, the forced close: HR-C8).
 *
 * Every adoption or read-back find selects by identity and asserts at most one match
 * (C.atMostOne; adjudication G6, round 2 R2-D).
 *
 * Run alone: node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/build/052-com.js
 */

const lib = require('./lib');
const C = require('./_commercial');

const { is } = lib;
const { listOf, cents, money, one, atMostOne } = C;
const BOOK = lib.answers.commercial;
const D052 = BOOK.deep['052-COM'];
/** A book money figure (integer cents) in major units. */
const major = (figure) => figure.value / 100;
/** A book money figure as a matcher on a major-unit answer (compared in cents). */
const asCents = (figure) => is.cents(major(figure));
/** A book error figure as the lib's '<status> <CODE>'. */
const saidOf = (figure) => `${figure.value.status} ${figure.value.code}`;
/** The configured item rate (deep["052-COM"].contractRetentionRate), PATCHed on every configured claim (L114). */
const RATE = D052.contractRetentionRate.value;

const SECTION = 'Substructure and frame';
const DESIGNED = [
  { code: 'B-001', description: 'Bulk excavation to reduced level', quantity: 5000, unit: 'm3', rate: 12 },
  { code: 'B-002', description: 'Foundation concrete C35', quantity: 800, unit: 'm3', rate: 150 },
  { code: 'B-003', description: 'High tensile reinforcement', quantity: 60, unit: 't', rate: 1200 },
  { code: 'B-004', description: 'Blockwork walls 200mm', quantity: 3000, unit: 'm2', rate: 45 },
  { code: 'B-005', description: 'Internal plaster two coats', quantity: 4000, unit: 'm2', rate: 18 },
  // WP4.I1.currentCert: 1,000 m3 @ 100 = 100,000, its activity approved at 40%.
  { code: 'C-001', description: 'Ground slab concrete C30', quantity: 1000, unit: 'm3', rate: 100 },
  // WP4.I8: the certificate's row, 1,000 m3 @ 97.50 = 97,500.00 (not A130: I3 needs A130 uncertified).
  { code: 'D-001', description: 'Column frame level 1', quantity: 1000, unit: 'm3', rate: 97.5 },
].map((row) => ({ ...row, mappingRule: 'required', section: SECTION }));

const ALLOCATIONS = [
  { key: 'B-001.A110', boqCode: 'B-001', activity: 'A110', quantity: 5000, amount: 60000 },
  { key: 'B-002.A120', boqCode: 'B-002', activity: 'A120', quantity: 200, amount: 30000 },
  { key: 'B-002.A130', boqCode: 'B-002', activity: 'A130', quantity: 600, amount: 90000 },
  { key: 'B-004.A310', boqCode: 'B-004', activity: 'A310', quantity: 3000, amount: 135000 },
  { key: 'B-005.A320', boqCode: 'B-005', activity: 'A320', quantity: 4000, amount: 72000 },
  { key: 'C-001.A220', boqCode: 'C-001', activity: 'A220', quantity: 1000, amount: 100000 },
  { key: 'D-001.A200', boqCode: 'D-001', activity: 'A200', quantity: 1000, amount: 97500 },
];

/** Approved progress (the caps). I3: A120 and A130 at 100%; I1: A220 40; P3/P4: A310 and A320 50; I8: A200 100. */
const PROGRESS = [['A110', 100], ['A120', 100], ['A130', 100], ['A220', 40], ['A310', 50], ['A320', 50], ['A200', 100]].map(([activity, pct]) => ({ activity, pct }));

lib.main('052-COM', async (b) => {
  b.assert(D052.currency.value === 'USD' && RATE === 10, 'deep["052-COM"]: USD, contract retention 10');
  b.assert(D052.I8.certifiedNet.value === 8775000 && D052.E1.convertedValue.value === 950000 && D052.P3.gross.value === 5000000, 'deep["052-COM"] mirrors I8 87,750.00, E1 9,500.00, P3 50,000.00');

  // ── the project: WITHOUT defaultRetentionRate ──
  await b.project({
    title: 'Commercial',
    payload: {
      type: 'building', contractType: 'remeasurement', contractNumber: b.ref('PC'),
      startDate: '2026-01-05', endDate: '2027-06-30', completionDate: '2027-06-30', projectCalendar: 'five_day', currency: D052.currency.value,
    },
    fields: { currency: D052.currency.value, projectCalendar: 'five_day', startDate: is.day('2026-01-05') },
  });

  // deep["052-COM"].I1: created without defaultRetentionRate (the payload names none). Through the API alone
  // (adjudication G5, R3-18) an unset rate cannot be told from an explicit 5 on the project itself; the contract's
  // first read (contract.value) and IPC-01's items at 0 (ipc.I1) complete the evidence.
  await b.step('project.retention-unset', async (s) => {
    const shown = await s.get('pm', b.P);
    s.expectFields(shown, { contractValue: (v) => v === null || v === undefined || Number(v) === 0 || 'no contract value on the project' }, 'the project as created');
    const rate = shown.defaultRetentionRate ?? null;
    if (rate !== null) {
      s.assert(Number(rate) === 5, `GET /projects/:id shows defaultRetentionRate ${rate}: neither unset nor the display default 5 (HR-C1)`);
      s.finding('HR-C1', "GET /projects/:id shows defaultRetentionRate 5 for 052-COM, created without one (deep[\"052-COM\"].I1): the project serializer displays a silent 5% (project.service.js:280-282, defaultRetentionRate ?? DEFAULT_RETENTION_RATE). Through the API the unset value is evidenced by the prime contract's first read and IPC-01's items at rate 0 (steps contract.value and ipc.I1; adjudication G5).");
    }
    return { apiShows: rate };
  });

  await b.team({ planner: 'planning_eng', qs: 'qs', cost: 'cost_controller', procurement: 'procurement', warehouse: 'warehouse', site: 'site_engineer', finance: 'finance' });

  // ── the company directory ──
  const DIRECTORY = [['client', 'Client Holdings'], ['subA', 'Blockwork Subcontractor'], ['subB', 'Plaster Subcontractor'], ['supplier', 'Cement Supplier'], ['vendorA', 'Groundworks Vendor A'], ['vendorB', 'Groundworks Vendor B']];
  const partyMail = (key) => `${key.toLowerCase()}.052com@parties.c052.octapm-cert.test`;
  const directory = await b.step('directory', async (s) => {
    const ids = {};
    for (const [key, label] of DIRECTORY) {
      const name = b.name(label);
      const search = `/companies?limit=100&search=${encodeURIComponent(name)}`;
      const data = await s.create(`company.${key}`, 'pm', '/companies', { name, type: 'external', email: partyMail(key), phone: '+1 225 555 0152', status: 'active' }, {
        fields: { name, type: 'external' },
        get: search,
        adopt: true,
        find: async (s2) => atMostOne(listOf(await s2.get('pm', search)), (row) => row.name === name, `directory company ${name}`),
      });
      ids[key] = data.id;
    }
    return { ids };
  });
  const companyId = (key) => directory.ids[key];

  // ── cost codes, budget lines ──
  await C.costCodes(b, [
    { code: '01-100', name: b.name('Labour'), category: 'labour' },
    { code: '02-100', name: b.name('Material'), category: 'material' },
    { code: '03-100', name: b.name('Subcontract'), category: 'subcontract' },
  ]);
  await C.budgetLines(b, [
    { code: '01-100', costType: 'labour', originalBudget: 100000, description: 'Labour' },
    { code: '02-100', costType: 'material', originalBudget: 100000, description: 'Material' },
    { code: '03-100', costType: 'subcontract', originalBudget: 300000, description: 'Subcontract' },
  ]);
  const codeId = (code) => b.out('cost-codes').ids[code];
  const lineId = (code, type) => b.out('budget-lines').ids[`${code}:${type}`];

  // ── the F1 network hand-built, the bill, allocations, approved progress ──
  const A = (await C.activitiesF1(b, { persona: 'planner', engineer: 'site' })).ids;

  const boq = await b.step('boq', async (s) => {
    const file = lib.files.boqWorkbook(DESIGNED, { filename: b.file('BOQ.xlsx'), title: b.name('Bill of quantities') });
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
    s.assert(items.length === DESIGNED.length, `${DESIGNED.length} active bill rows read back (read ${items.length})`);
    const total = items.reduce((sum, i) => sum + cents(i.amount), 0);
    s.assert(total === file.totalCents, `the bill total is the workbook's ${money(file.totalCents)} (read ${money(total)})`);
    return { revisionId: uploaded?.revisionId ?? uploaded?.id, totalCents: total, ids: Object.fromEntries(DESIGNED.map((row) => [row.code, one(items, (i) => i.code === row.code, `bill row ${row.code}`).id])) };
  }, { needs: ['activities'] });

  const alloc = await C.allocate(b, ALLOCATIONS, { boqItems: boq.ids, activityIds: A });
  const allocId = (key) => alloc.ids[key];
  await C.progress(b, PROGRESS, { activityIds: A });

  // ── the contract value established (the I5 gate; deep.087-COM.contractOriginal in USD) ──
  await b.step('contract.value', async (s) => {
    const first = await s.get('qs', `${b.P}/prime-contract`);
    // WP4.I1.silentContractRate: the first read stores the contract (ensureContract); with the project's default
    // unset it writes retentionRate 5, which under HR-C1 is not configuration (G5: the API observation).
    const stored = first.retentionRate ?? null;
    if (stored !== null) {
      s.assert(Number(stored) === 5, `the contract's first read stores retentionRate ${stored}: neither unset nor the silent 5 (WP4.I1.silentContractRate)`);
      s.finding('HR-C1', "052-COM's prime contract, first read with the project's default unset, stores retentionRate 5 (prime-contract.service.js:264-266, ensureContract): the silent fallback that WP4.I1.silentContractRate (mirrored in deep[\"052-COM\"].I1) says must not count as configuration. The contract rate is configured explicitly at 10 only after the I1 case (step contract.retention).");
    }
    const data = await s.act('contract.value.enter', 'qs', 'PATCH', `${b.P}/prime-contract`, {
      title: b.name('Client contract'), originalValue: major(BOOK.deep['087-COM'].contractOriginal), clientCompanyId: companyId('client'), paymentTermsDays: 30, status: 'active', notes: `Contract value as signed ${b.ref('CONTRACT')}`,
    }, {
      fields: { originalValue: asCents(BOOK.deep['087-COM'].contractOriginal), originalValueSource: BOOK.WP4.I5.valueSourceAfter.value },
      verify: async (s2) => (await s2.get('qs', `${b.P}/prime-contract`)).originalValueSource === BOOK.WP4.I5.valueSourceAfter.value,
    });
    return { firstRead: { originalValueSource: first.originalValueSource, originalValue: first.originalValue, retentionRate: first.retentionRate }, originalValue: data?.originalValue ?? major(BOOK.deep['087-COM'].contractOriginal) };
  }, { needs: ['boq'] });

  // ── prime COs: I3's allocation link ──
  const coRegisterRoute = `${b.P}/change-orders?includeArchived=true`;
  const coRegister = async (s) => listOf(await s.get('qs', coRegisterRoute), 'orders');
  const coById = async (s, id) => (await coRegister(s)).find((row) => row.id === id) || null;
  await b.step('co.I3', async (s) => {
    const key = 'CO-I3';
    // WP4.I3 (deep["052-COM"].I3): A120LimitAmount 37,500.00 = the A120 allocation 30,000.00 + this CO's 7,500.00.
    const value = major(D052.I3.A120LimitAmount) - major(BOOK['stage3:109']['allocation.B-002/A120']);
    const description = `${b.name(`Variation ${key}`)}: instructed scope`;
    const made = await s.create(`co.${key}`, 'qs', `${b.P}/change-orders`, {
      description, category: 'client_variation', value, activityId: A.A120, budgetLineId: lineId('02-100', 'material'), scheduleImpact: 0, raisedBy: `QS ${b.ref(key)}`,
      // WP4.I3: 7,500 approved with allocationLinks [{A120, qty 50, amount 7,500}] on the split B-002 row.
      allocationLinks: [{ allocationId: allocId('B-002.A120'), quantity: D052.I3.A120LimitQuantity.value - 200, amount: value, notes: b.ref(key) }],
    }, {
      get: coRegisterRoute,
      fields: { status: 'draft', value: is.cents(value) },
      find: async (s2) => atMostOne(await coRegister(s2), (row) => row.description === description, `prime CO ${key}`),
    });
    const id = made.id;
    const docs = await C.attach(s, `co.${key}.instruction`, 'qs', 'change_order', id, `Client instruction for ${key}`);
    await s.act(`co.${key}.approvable`, 'qs', 'PATCH', `${b.P}/change-orders/${id}`, {
      scheduleImpactSummary: `No programme effect: absorbed in the activity duration (${b.ref(key)})`,
      costImpactSummary: `${value} at contract rates (${b.ref(key)})`,
      activityLinks: [{ activityId: A.A120, relationType: 'impacted', scheduleImpactDays: 0, costImpact: value, notes: b.ref(key) }],
      documentIds: [docs.documentId],
    }, { fields: { id }, verify: async (s2) => Boolean((await coById(s2, id))?.costImpactSummary) });
    await s.act(`co.${key}.submit`, 'qs', 'POST', `${b.P}/change-orders/${id}/submit`, { comment: `For approval ${b.ref(key)}` }, {
      fields: { status: 'pending' },
      verify: async (s2) => ['pending', 'approved'].includes((await coById(s2, id))?.status),
    });
    await s.act(`co.${key}.approve`, 'pm', 'POST', `${b.P}/change-orders/${id}/approve`, { comment: `Approved under the instruction ${b.ref(key)}` }, {
      fields: { status: 'approved' },
      verify: async (s2) => (await coById(s2, id))?.status === 'approved',
    });
    const row = await coById(s, id);
    s.expectFields(row, { status: 'approved', value: is.cents(value) }, key);
    return { id, ref: row.ref };
  }, {
    needs: ['allocations', 'contract.value'],
    verify: async (s, out) => ((await coById(s, out.id))?.status === 'approved') || `CO-I3 ${out.id} is no longer approved`,
  });

  // ── change events E1 (converted) and E2 (priced); RFQs through the public link ──
  const ceRoute = (id) => `${b.P}/change-events/${id}`;
  const ceGet = async (s, id) => s.get('qs', ceRoute(id));
  const lineOf = (event, description, key) => one(event.lines, (l) => String(l.description).startsWith(`${description} (`), `${key}: event line "${description}"`);
  const newEvent = async (s, key, lines) => {
    const title = b.name(`Change event ${key}`);
    return s.create(`ce.${key}`, 'qs', `${b.P}/change-events`, {
      title, description: `Potential change ${b.ref(key)}`, type: 'owner_change', origin: 'manual', activityId: A.A130, scheduleImpactDays: 0, notes: b.ref(key),
      lines: lines.map((line, index) => ({
        description: `${line.description} (${b.ref(`${key}-L${index + 1}`)})`, costCodeId: codeId('02-100'), budgetLineId: lineId('02-100', 'material'), activityId: A.A130,
        quantity: 1, unit: 'ls', unitCost: line.rom, romAmount: line.rom,
      })),
    }, {
      fields: { title, status: 'open' },
      adopt: true,
      find: async (s2) => atMostOne(listOf(await s2.get('qs', `${b.P}/change-events`)), (row) => row.title === title, `change event ${key}`),
    });
  };
  const tokens = new Map();
  const sendRfqs = async (s, key, event, recipients, lineIds) => {
    const sent = await s.create(`ce.${key}.rfqs`, 'procurement', `${b.P}/change-events/${event.id}/rfqs`, {
      recipients: recipients.map((r) => ({ vendorCompanyId: companyId(r), companyName: b.name(DIRECTORY.find(([k]) => k === r)[1]), contactName: `Estimating ${b.ref(r)}`, contactEmail: partyMail(r) })),
      dueDate: b.date(14, { future: true }),
      instructions: `Price the lines, delivered and installed ${b.ref(`${key}-RFQ`)}`,
      lineIds,
    }, {
      expect: [200, 201],
      get: ceRoute,
      idOf: (d) => d?.changeEvent?.id ?? null,
      // WP4.E1.afterRfqSend (deep["052-COM"].E1): sending an RFQ moves the open event to pricing.
      fields: { sent: (v, d) => (d?.sent ?? (d?.rfqs || []).length) === recipients.length || `${recipients.length} RFQs`, 'changeEvent.status': D052.E1.afterRfqSend.value },
      find: async (s2) => {
        const now = await ceGet(s2, event.id);
        return (now.rfqs || []).length >= recipients.length ? { changeEvent: now, rfqs: now.rfqs } : null;
      },
    });
    for (const rfq of sent?.rfqs || []) if (rfq.portalUrl) tokens.set(rfq.id, C.tokenOf(rfq.portalUrl, '/rfq/'));
    // The vendors' personal links are kept in memory only, never in the state file.
    const kept = b.state.records[`ce.${key}.rfqs`]?.data;
    if (kept && Array.isArray(kept.rfqs) && kept.rfqs.some((r) => r.portalUrl)) {
      kept.rfqs = kept.rfqs.map(({ portalUrl, ...rest }) => rest);
      b.save();
    }
    const rfqs = (await ceGet(s, event.id)).rfqs || [];
    return Object.fromEntries(recipients.map((r) => [r, one(rfqs, (row) => row.vendorCompanyId === companyId(r), `${key}: the RFQ to ${r}`).id]));
  };
  const quote = async (s, key, event, rfqId, amounts) => {
    const rfq = one((await ceGet(s, event.id)).rfqs || [], (row) => row.id === rfqId, `${key}: RFQ ${rfqId}`);
    if (rfq.status === 'quoted' || rfq.status === 'accepted') return rfq;
    let token = tokens.get(rfqId);
    if (!token) {
      // A link from an earlier run is not kept: a reminder issues a fresh one.
      const reminded = await b.send('procurement', 'POST', `${b.P}/change-events/rfqs/${rfqId}/remind`, {});
      s.assert(reminded.status === 200, `the RFQ reminder answered 200 (got ${lib.said(reminded)})`);
      token = C.tokenOf(reminded.body?.data?.portalUrl, '/rfq/');
    }
    const lines = (await ceGet(s, event.id)).lines || [];
    const res = await C.portal(b, 'PUT', `/public/rfqs/${token}/quote`, {
      lines: lines.filter((line) => amounts[line.id] !== undefined).map((line) => ({ lineId: line.id, amount: amounts[line.id], note: b.ref(key) })),
      notes: `Quotation ${b.ref(key)}`, validUntil: b.date(30, { future: true }), leadTimeDays: 10, quotedBy: `Estimator ${b.ref(key)}`,
    });
    s.assert(res.status === 200, `the vendor's quote on ${key} answered 200 (got ${lib.said(res)})`);
    const after = one((await ceGet(s, event.id)).rfqs || [], (row) => row.id === rfqId, `${key}: RFQ ${rfqId}`);
    s.assert(after.status === 'quoted', `the RFQ ${after.ref} reads quoted`);
    return after;
  };
  /** Lines 6,000 + 4,000; vendor A quotes 5,700 + 3,800 on both lines (WP4.E1.quoteA note); accepted: priced. */
  const pricedEvent = async (s, key) => {
    let event = await newEvent(s, key, [{ description: 'Extra excavation to soft spots', rom: 6000 }, { description: 'Extra blinding', rom: 4000 }]);
    event = await ceGet(s, event.id);
    const l1 = lineOf(event, 'Extra excavation to soft spots', key);
    const l2 = lineOf(event, 'Extra blinding', key);
    s.assert(lib.sameCents(Number(l1.romAmount) + Number(l2.romAmount), major(D052.E1.romTotal)), `${key}'s lines total WP4.E1.romTotal ${major(D052.E1.romTotal)}`);
    const rfqs = await sendRfqs(s, key, event, ['vendorA'], [l1.id, l2.id]);
    await quote(s, key, event, rfqs.vendorA, { [l1.id]: 5700, [l2.id]: 3800 });
    if ((await ceGet(s, event.id)).status === 'pricing' || b.state.records[`ce.${key}.accept`]?.status === 'pending') {
      await s.act(`ce.${key}.accept`, 'qs', 'POST', `${b.P}/change-events/rfqs/${rfqs.vendorA}/accept`, { createCommitmentChangeOrder: false }, {
        fields: { 'changeEvent.status': D052.E1.afterAccept.value },
        verify: async (s2) => [D052.E1.afterAccept.value, D052.E1.eventStatus.value].includes((await ceGet(s2, event.id)).status),
      });
    }
    return { event, rfqId: rfqs.vendorA };
  };
  await b.step('ce.E1', async (s) => {
    const { event, rfqId } = await pricedEvent(s, 'E1');
    const converted = await s.create('ce.E1.convert', 'qs', `${b.P}/change-events/${event.id}/convert`, { description: `${b.name('Variation E1')} from ${event.ref}` }, {
      get: coRegisterRoute,
      idOf: (d) => d?.changeOrder?.id ?? null,
      // WP4.E1.convertedValue 9,500.00, coStatus draft, eventStatus converted (deep["052-COM"].E1)
      fields: { 'changeOrder.value': asCents(D052.E1.convertedValue), 'changeOrder.status': D052.E1.coStatus.value, 'changeEvent.status': D052.E1.eventStatus.value },
      // Adopted from the live records: the event and the register row of the CO it names.
      find: async (s2) => {
        const now = await ceGet(s2, event.id);
        if (!now.changeOrderId) return null;
        const changeOrder = await coById(s2, now.changeOrderId);
        s2.assert(Boolean(changeOrder), `E1 names change order ${now.changeOrderId}, which is in the register`);
        return { changeOrder, changeEvent: now };
      },
    });
    const changeOrderId = converted?.changeOrder?.id ?? converted?.id;
    s.expectFields(await coById(s, changeOrderId), { status: D052.E1.coStatus.value, value: asCents(D052.E1.convertedValue) }, 'the CO from E1');
    return { eventId: event.id, rfqId, changeOrderId };
  }, {
    needs: ['activities', 'budget-lines', 'directory'],
    verify: async (s, out) => ((await ceGet(s, out.eventId)).status === D052.E1.eventStatus.value) || `E1 ${out.eventId} is no longer converted`,
  });
  await b.step('ce.E2', async (s) => {
    // WP4.E2: left PRICED; the proof sends the two concurrent converts (one 2xx, one 409, one CO, pending +9,500.00).
    const { event, rfqId } = await pricedEvent(s, 'E2');
    const now = await ceGet(s, event.id);
    s.expectFields(now, { status: D052.E1.afterAccept.value, changeOrderId: is.absent }, 'E2 left priced');
    return { eventId: event.id, rfqId };
  }, {
    needs: ['activities', 'budget-lines', 'directory'],
    verify: async (s, out) => ((await ceGet(s, out.eventId)).status === D052.E1.afterAccept.value) || `E2 ${out.eventId} is no longer priced`,
  });

  // ── the IPC lane ──
  const ipcRoute = (label) => `${b.P}/ipc/${encodeURIComponent(label)}`;
  const period = (n) => b.ref(`IPC-${String(n).padStart(2, '0')}`);
  const readPeriod = (s, label) => s.get('qs', ipcRoute(label));
  const openPeriod = async (s, key, label) => {
    await s.create(`ipc.${key}`, 'qs', `${b.P}/ipc`, { period: label }, {
      get: () => ipcRoute(label),
      fields: { period: label, status: 'draft' },
      adopt: true,
      find: async (s2) => atMostOne(listOf(await s2.get('qs', `${b.P}/ipc`)), (row) => row.period === label, `IPC period ${label}`),
    });
    return readPeriod(s, label);
  };
  const itemOf = (certificate, allocationKey) => one(certificate.items || [], (row) => row.allocationId === allocId(allocationKey), `${certificate.period}: the item of allocation ${allocationKey}`);
  /** retentionRate is sent only when given (explicit configuration); the item's rate is then asserted on the answer. */
  const claim = async (s, key, label, allocationKey, qty, retentionRate) => {
    const item = itemOf(await readPeriod(s, label), allocationKey);
    const rate = Number(item.rate);
    return s.act(`ipc.${key}.claim.${allocationKey}`, 'qs', 'PATCH', `${ipcRoute(label)}/items/${item.id}`, { qty, ...(retentionRate === undefined ? {} : { retentionRate }) }, {
      fields: { qty, currentCert: is.cents(Math.round(qty * rate * 100) / 100), ...(retentionRate === undefined ? {} : { retentionRate }) },
      verify: async (s2) => {
        const row = itemOf(await readPeriod(s2, label), allocationKey);
        return Number(row.qty) === qty && (retentionRate === undefined || Number(row.retentionRate) === retentionRate);
      },
    });
  };
  const transition = async (s, key, label, verb, persona, payload, fields, done) =>
    s.act(`ipc.${key}.${verb}`, persona, 'POST', `${ipcRoute(label)}/${verb}`, payload, {
      fields,
      verify: async (s2) => done.includes((await readPeriod(s2, label)).status),
    });
  const expectTotals = (s, certificate, totals, label) => s.expectFields(certificate, Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, typeof v === 'number' ? is.cents(v) : v])), label);
  /** A certificate's totals against a deep["052-COM"].ipcNN leaf set (as 087-COM's bookTotals: every figure is a book key). */
  const bookTotals = (X) => ({
    status: X.status.value,
    totalCert: major(X.gross),
    grossThisPeriod: major(X.gross),
    totalRet: major(X.retention),
    advanceRecovery: major(X.advanceRecovery),
    deductions: major(X.deductions),
    taxAmount: major(X.taxAmount),
    netPayable: major(X.net),
  });
  /**
   * A certificate's invoice, payments and releases are recorded with get: null and re-read live by this step-level
   * verify (the get: null rule, R3-16): GET /ipc/:period carries them, but also `items` (the certificate's lines),
   * which is the only list the lib's read-back searches for a recorded id.
   */
  const ipcMoneyVerify = (...labels) => async (s) => {
    const seen = new Set();
    for (const label of labels) {
      const certificate = await readPeriod(s, label);
      const invoices = certificate.invoices || [];
      for (const row of [...invoices, ...invoices.flatMap((i) => i.payments || []), ...(certificate.payments || []), ...(certificate.retentionReleases || [])]) seen.add(row.id);
    }
    const missing = Object.entries(b.state.records).filter(([, r]) => r.step === s.name && r.status === 'done' && r.kind === 'create' && !r.get && !seen.has(r.id)).map(([name]) => name);
    return missing.length ? `no longer on the certificate: ${missing.join(', ')}` : true;
  };

  // IPC-01 — WP4.I1 (deep["052-COM"].I1): retention not configured; the draft claims 400 m3 = 40,000.00.
  const i1 = await b.step('ipc.I1', async (s) => {
    const label = period(1);
    await openPeriod(s, 'I1', label);
    let certificate = await readPeriod(s, label);
    const rates = [...new Set((certificate.items || []).map((item) => Number(item.retentionRate)))];
    await claim(s, 'I1', label, 'C-001.A220', 400); // retentionRate NOT sent
    certificate = await readPeriod(s, label);
    const contract = await s.get('qs', `${b.P}/prime-contract`);
    const claimed = itemOf(certificate, 'C-001.A220');
    const observed = {
      itemRetentionRates: rates,
      claimedItem: { qty: 400, currentCert: Number(claimed.currentCert), retention: Number(claimed.retention) },
      draftTotals: { totalCert: Number(certificate.totalCert), totalRet: Number(certificate.totalRet), netPayable: Number(certificate.netPayable) },
      contractRetentionRate: contract.retentionRate,
    };
    // WP4.I1.certifyUnconfigured.today: item rate 0, retention 0, net 40,000.00.
    const today = D052.I1.certifyUnconfigured.today;
    s.assert(rates.length === 1 && rates[0] === today.itemRetentionRate, `every IPC-01 item carries the silent rate ${today.itemRetentionRate} from the unset project default (read ${rates.join(', ')})`);
    expectTotals(s, certificate, { totalCert: major(D052.I1.currentCert), totalRet: today.retention / 100, netPayable: today.net / 100, status: 'draft' }, 'IPC-01 draft');
    return { label, observed };
  }, { needs: ['allocations', 'progress', 'contract.value'] });
  // HR-C1 (decided): no silent rate; the refusing step and code are the fix's (adjudication C2). Not sent:
  // at HEAD it would certify at 0 and leave an unconfigured certificate behind. IPC-01 stays a draft for the proof.
  b.blocked('ipc.I1.certify-unconfigured', 'HR-C1', {
    expected: 'refused: configuration required (code chosen by the HR-C1 fix)',
    today: 'certify would settle at the silent item rate 0: retention 0.00, net 40,000.00 (WP4.I1.certifyUnconfigured.today)',
    observedOnTheDraft: i1 ? i1.observed : null,
    notSent: 'certifying would leave an unconfigured certificate in the population; IPC-01 is left a draft',
  });

  // Retention configured explicitly: the contract rate 10 (deep["052-COM"].contractRetentionRate).
  await b.step('contract.retention', async (s) => {
    const data = await s.act('contract.retention.configure', 'qs', 'PATCH', `${b.P}/prime-contract`, { retentionRate: RATE, taxRate: 0 }, {
      fields: { retentionRate: RATE, taxRate: 0 },
      verify: async (s2) => Number((await s2.get('qs', `${b.P}/prime-contract`)).retentionRate) === RATE,
    });
    return { retentionRate: data.retentionRate };
  }, { needs: ['ipc.I1'] });

  // IPC-02 — WP4.I8 (deep["052-COM"].I8): D-001 1,000 m3 = 97,500.00, retention 9,750.00, net 87,750.00, certified and
  // invoiced; its moments asserted as they happen (R3-3, R2-9): the over-balance payment refused, payFull, the over-held
  // release refused, the state after the release, the second payment.
  await b.step('ipc.I8', async (s) => {
    const I8 = D052.I8;
    const RET = major(I8.afterReleaseBalanceDue); // 10% x 97,500.00 = 9,750.00, the retention held
    const GROSS = major(I8.certifiedNet) + RET; // 97,500.00
    const label = period(2);
    const draft = await openPeriod(s, 'I8', label);
    // L114: the first certificate after the contract rate was configured; its items are created at the project
    // default (unset: 0), never the contract rate, so RATE is PATCHed onto each claimed item and asserted.
    const before = Number(itemOf(draft, 'D-001.A200').retentionRate);
    if (before !== RATE) {
      s.finding('L114', `052-COM's IPC-02, opened after the prime contract's retentionRate was configured at ${RATE}, creates its items at retentionRate ${before} (item D-001/A200 read before any claim): HEAD resolves the item rate from the project default (ipc.service.js:51-54 resolveRetentionRate, :779, :872), never the contract rate. As the answer book prescribes for HEAD (deep["052-COM"].contractRetentionRate note), every configured 052-COM certificate PATCHes item retentionRate ${RATE}, and each claimed item's rate is asserted ${RATE} on the PATCH answer; after WP-4's HR-C1 fix the PATCH should become unnecessary.`);
    }
    await claim(s, 'I8', label, 'D-001.A200', 1000, RATE);
    expectTotals(s, await readPeriod(s, label), { totalCert: GROSS, totalRet: RET, netPayable: major(I8.certifiedNet) }, 'IPC-02 draft (WP4.I8.certifiedNet)');
    await transition(s, 'I8', label, 'submit', 'qs', {}, { status: 'submitted' }, ['submitted', 'certified', 'paid']);
    await transition(s, 'I8', label, 'certify', 'pm', { comment: `Certified ${b.ref('IPC-02')}` }, { status: 'certified', totalCert: is.cents(GROSS), totalRet: is.cents(RET), netPayable: asCents(I8.certifiedNet) }, ['certified', 'paid']);
    const invoiceNumber = b.ref('INV-I8');
    await s.create('ipc.I8.invoice', 'finance', `${ipcRoute(label)}/invoice/issue`, { invoiceNumber, invoiceDate: b.past('2026-08-10'), dueDate: '2026-09-09' }, {
      get: null, // re-read live by the step's ipcMoneyVerify
      fields: { netAmount: asCents(I8.certifiedNet) },
      find: async (s2) => atMostOne((await readPeriod(s2, label)).invoices || [], (row) => row.invoiceNumber === invoiceNumber, `${label}: invoice ${invoiceNumber}`),
    });
    const pay = async (n, amount, paymentDate, moment) => {
      const reference = b.ref(`PAY-I8-${n}`);
      return s.create(`ipc.I8.pay.${n}`, 'finance', `${ipcRoute(label)}/payments`, { amount, paymentReference: reference, paymentDate: b.past(paymentDate), paymentMethod: 'bank_transfer', notes: `Client payment ${reference}` }, {
        get: null, // re-read live by the step's ipcMoneyVerify
        idOf: (d) => d?.payment?.id ?? null,
        fields: { 'payment.amount': is.cents(amount), 'payment.paymentReference': reference, ...moment },
        // Adopted right after an interruption, before anything else moved the certificate.
        find: async (s2) => {
          const certificate = await readPeriod(s2, label);
          const payment = atMostOne(certificate.payments || [], (row) => row.paymentReference === reference, `${label}: payment ${reference}`);
          return payment ? { payment, certificate } : null;
        },
      });
    };
    // WP4.I8.payOverBalance at its moment (balance 87,750.00, nothing paid): 87,750.01 refused, nothing written.
    const overPay = b.ref('PAY-I8-OVER');
    await s.refused('ipc.I8.pay.over', 'finance', 'POST', `${ipcRoute(label)}/payments`, {
      amount: major(I8.certifiedNet) + 0.01, paymentReference: overPay, paymentDate: b.past('2026-08-28'), paymentMethod: 'bank_transfer', notes: `Over the payable balance ${overPay}`,
    }, saidOf(I8.payOverBalance), {
      find: async (s2) => atMostOne((await readPeriod(s2, label)).payments || [], (row) => row.paymentReference === overPay, `${label}: payment ${overPay}`),
    });
    // WP4.I8.payFull / balanceDueAfterPay, in the payment's own answer.
    await pay(1, major(I8.certifiedNet), '2026-08-28', {
      'certificate.status': I8.payFull.value,
      'certificate.paymentStatus': I8.payFull.value,
      'certificate.balanceDue': asCents(I8.balanceDueAfterPay),
    });
    // WP4.I8.releaseOverHeld at its moment (9,750.00 held): 9,750.01 refused, nothing written.
    const overRelease = b.ref('RET-I8-OVER');
    await s.refused('ipc.I8.release.over', 'finance', 'POST', `${ipcRoute(label)}/retention-release`, {
      amount: RET + 0.01, releaseReference: overRelease, releaseDate: b.past('2026-09-15'), reason: `Over the retention held ${overRelease}`,
    }, saidOf(I8.releaseOverHeld), {
      find: async (s2) => atMostOne((await readPeriod(s2, label)).retentionReleases || [], (row) => row.releaseReference === overRelease, `${label}: release ${overRelease}`),
    });
    // The whole 9,750.00 released; the state after it, in the release's own answer (R2-9): paymentStatus partially_paid
    // and balanceDue 9,750.00 exactly; status the book's 'certified', or HEAD's 'paid' (the first word of its today, HR-C3).
    const todayStatus = String(I8.afterReleaseStatus.today).split(/[\s(]/)[0];
    const releaseRef = b.ref('RET-I8');
    await s.create('ipc.I8.release', 'finance', `${ipcRoute(label)}/retention-release`, { amount: RET, releaseReference: releaseRef, releaseDate: b.past('2026-09-15'), reason: `Released on the taking-over certificate ${releaseRef}` }, {
      get: null, // re-read live by the step's ipcMoneyVerify
      idOf: (d) => d?.release?.id ?? null,
      fields: {
        'release.amount': is.cents(RET),
        'certificate.paymentStatus': I8.afterReleasePaymentStatus.value,
        'certificate.balanceDue': asCents(I8.afterReleaseBalanceDue),
        'certificate.status': (v) => v === I8.afterReleaseStatus.value || v === todayStatus || `${I8.afterReleaseStatus.value} (WP4.I8.afterReleaseStatus) or HEAD's ${todayStatus} (its today, HR-C3)`,
      },
      find: async (s2) => {
        const certificate = await readPeriod(s2, label);
        const release = atMostOne(certificate.retentionReleases || [], (row) => row.releaseReference === releaseRef, `${label}: release ${releaseRef}`);
        return release ? { release, certificate } : null;
      },
    });
    const atRelease = b.state.records['ipc.I8.release']?.data?.certificate || null;
    s.assert(Boolean(atRelease), 'the release answer (or its adoption) carries the certificate at that moment');
    if (atRelease.status === todayStatus && atRelease.status !== I8.afterReleaseStatus.value) {
      s.finding('HR-C3', `After 052-COM IPC-02's 9,750.00 retention release the certificate reads status '${atRelease.status}' with paymentStatus '${atRelease.paymentStatus}' and balanceDue ${atRelease.balanceDue}: WP4.I8.afterReleaseStatus (deep["052-COM"].I8) expects '${I8.afterReleaseStatus.value}' (status agreeing with paymentStatus), HEAD keeps 'paid' one-way (ipc.service.js:352-357; the book's today). paymentStatus and balanceDue are as the book says.`);
    }
    // WP4.I8.paySecond / amountPaidTotal, in the second payment's answer.
    await pay(2, RET, '2026-09-30', {
      'certificate.status': I8.paySecond.value,
      'certificate.paymentStatus': I8.paySecond.value,
      'certificate.retentionStatus': 'released',
      'certificate.amountPaid': asCents(I8.amountPaidTotal),
    });
    const end = await readPeriod(s, label);
    expectTotals(s, end, { status: I8.paySecond.value, paymentStatus: I8.paySecond.value, retentionStatus: 'released', amountPaid: major(I8.amountPaidTotal), balanceDue: 0 }, 'IPC-02 paid with retention released');
    return { label, itemRateBeforeClaim: before, afterRelease: { status: atRelease.status, paymentStatus: atRelease.paymentStatus, balanceDue: atRelease.balanceDue }, status: end.status, amountPaid: end.amountPaid };
  }, { needs: ['contract.retention'], verify: ipcMoneyVerify(period(2)) });

  // IPC-03 — left SUBMITTED for the I4 refusals (with IPC-01 draft and IPC-02 paid): every figure is deep["052-COM"].ipc03
  // (B-001 1,000 m3 x 12.00 = 12,000.00; retention 10% 1,200.00; no cap, advance, deduction or tax; net 10,800.00; round 3
  // R3-1), asserted on the draft after the claim and again on the submitted certificate.
  await b.step('ipc.I4-submitted', async (s) => {
    const X = D052.ipc03;
    const label = period(3);
    await openPeriod(s, 'I4', label);
    // The item's rate is the book's (deep["052-COM"].ipc03.retentionRate = the configured contract rate), asserted on the PATCH answer (L114).
    await claim(s, 'I4', label, 'B-001.A110', X.quantity.value, X.retentionRate.value);
    const draft = await readPeriod(s, label);
    expectTotals(s, draft, { ...bookTotals(X), status: 'draft' }, 'IPC-03 draft (deep["052-COM"].ipc03)');
    s.assert(Number(itemOf(draft, 'B-001.A110').qty) === X.quantity.value, `IPC-03's A110 item holds deep["052-COM"].ipc03.quantity ${X.quantity.value} m3`);
    await transition(s, 'I4', label, 'submit', 'qs', {}, { status: X.status.value }, [X.status.value]);
    const end = await readPeriod(s, label);
    expectTotals(s, end, bookTotals(X), 'IPC-03 submitted (deep["052-COM"].ipc03)');
    return { label, status: end.status, netPayable: end.netPayable };
  }, { needs: ['ipc.I8'] });

  // ── commitments (C1, C2) ──
  const commitmentGet = (s, id) => s.get('qs', `${b.P}/commitments/${id}`);
  const commitment = (key, { vendor, lines, insurance = null }) =>
    b.step(`commitment.${key}`, async (s) => {
      const title = b.name(`Subcontract ${key}`);
      const made = await s.create(`commitment.${key}`, 'qs', `${b.P}/commitments`, {
        type: 'subcontract', title, description: `${title} as tendered`, vendorCompanyId: companyId(vendor),
        retentionRate: RATE, // explicit, never the silent `defaultRetentionRate ?? 5` (WP4.C3.noDefaultNoRate, HR-C1)
        paymentTerms: `30 days from certification ${b.ref(key)}`, startDate: '2026-02-02', endDate: '2027-05-28', lines,
      }, {
        fields: {
          title,
          status: 'draft',
          retentionRate: RATE,
          original: is.cents(lines.reduce((sum, l) => sum + (l.amount ?? l.qty * l.rate), 0)),
          lines: (v) => (Array.isArray(v) && v.length === lines.length && lines.every((l) => v.filter((row) => row.description === l.description && row.activityId === l.activityId && lib.sameCents(row.amount, l.amount ?? l.qty * l.rate)).length === 1)) || 'the SOV lines as sent (description, activity, amount)',
        },
        adopt: true,
        find: async (s2) => {
          const row = atMostOne(listOf(await s2.get('qs', `${b.P}/commitments?includeVoid=true&search=${encodeURIComponent(key)}`)), (r) => r.title === title, `commitment ${key}`);
          return row ? commitmentGet(s2, row.id) : null;
        },
      });
      let documentId = null;
      // The certificate's upload and the insurance PUT are two records with two names (one shared name made the PUT
      // read as already done, so the requirement was never sent).
      const insuranceEntry = (v) => (Array.isArray(v) && v.length === 1 && v[0].type === insurance.type && v[0].required === true && (documentId ? v[0].documentId === documentId : !v[0].documentId)) || `one required ${insurance?.type} entry${documentId ? ' with its certificate' : ' with no certificate'}`;
      if (insurance) {
        if (insurance.withDocument) documentId = (await C.attach(s, `commitment.${key}.insurance-certificate`, 'qs', 'commitment', made.id, `Insurance certificate ${key}`)).documentId;
        await s.act(`commitment.${key}.insurance`, 'qs', 'PUT', `${b.P}/commitments/${made.id}/insurance`, {
          insurance: [{ type: insurance.type, label: `${insurance.label} (${b.ref(key)})`, required: true, ...(documentId ? { documentId, expiresAt: '2027-12-31' } : {}), note: b.ref(key) }],
        }, {
          fields: { insurance: insuranceEntry },
          verify: async (s2) => insuranceEntry((await commitmentGet(s2, made.id)).insurance) === true,
        });
        s.expectFields(await commitmentGet(s, made.id), { insurance: insuranceEntry, insuranceReady: Boolean(documentId) }, `${key}'s required insurance`);
      }
      const read = await commitmentGet(s, made.id);
      return { id: made.id, ref: read.ref, title, sovLines: read.lines.map((l) => ({ id: l.id, activityId: l.activityId, amount: l.amount, description: l.description })) };
    }, { needs: ['budget-lines', 'activities', 'directory'] });
  const pendingRecord = (name) => b.state.records[name]?.status === 'pending';
  const toApproved = async (s, key, id) => {
    const status = async () => (await commitmentGet(s, id)).status;
    if ((await status()) === 'draft' || pendingRecord(`commitment.${key}.submit`)) await s.act(`commitment.${key}.submit`, 'qs', 'POST', `${b.P}/commitments/${id}/submit`, {}, { fields: { status: 'pending' }, verify: async () => (await status()) !== 'draft' });
    if ((await status()) === 'pending' || pendingRecord(`commitment.${key}.approve`)) await s.act(`commitment.${key}.approve`, 'pm', 'POST', `${b.P}/commitments/${id}/approve`, {}, { fields: { status: 'approved' }, verify: async () => ['approved', 'executed'].includes(await status()) });
  };
  const sovLine = (out, activity, key) => one(out.sovLines, (l) => l.activityId === A[activity], `${key}: the SOV line on ${activity}`);
  const executeWithFile = async (s, key, id) => {
    if ((await commitmentGet(s, id)).status === 'executed' && !pendingRecord(`commitment.${key}.execute`)) return;
    await s.upload(`commitment.${key}.execute`, 'pm', `${b.P}/commitments/${id}/execute`, C.pdf(`Signed agreement ${key} ${b.code}`, b.file(`${key}-signed.pdf`)), {
      expect: 200,
      get: () => `${b.P}/commitments/${id}`,
      fields: { status: 'executed', executedDocument: is.present },
      find: async (s2) => ((await commitmentGet(s2, id)).status === 'executed' ? commitmentGet(s2, id) : null),
    });
  };

  // SC-001: blockwork 2,000 m2 @ 50 = 100,000.00 on A310, required insurance on file (WP4.C2.committedExecuted).
  const sc1 = await commitment('SC-001', {
    vendor: 'subA',
    lines: [{ description: `Blockwork walls 200mm ${b.ref('SC-001-L1')}`, costCodeId: codeId('03-100'), budgetLineId: lineId('03-100', 'subcontract'), boqItemId: boq.ids['B-004'], activityId: A.A310, unit: 'm2', qty: 2000, rate: 50 }],
    insurance: { type: 'general_liability', label: 'Public liability', withDocument: true },
  });
  await b.step('commitment.SC-001.execute', async (s) => {
    await toApproved(s, 'SC-001', sc1.id);
    await executeWithFile(s, 'SC-001', sc1.id);
    // WP4.C2.committedExecuted at its moment (no CO yet).
    s.expectFields(await commitmentGet(s, sc1.id), { status: 'executed', original: asCents(D052.C2.committedExecuted), revised: asCents(D052.C2.committedExecuted), insuranceReady: true }, 'SC-001 (WP4.C2.committedExecuted)');
    return { status: 'executed' };
  }, { needs: ['commitment.SC-001'] });

  // SC-002: plaster 4,000 m2 @ 25 = 100,000.00 on A320, the required bond missing: executed on a PM override (WP4.C1).
  // Its applications would meet the compliance gate (409 SUB_PAY_APP_COMPLIANCE, WP4.P5): P4's application is on SC-003.
  const sc2 = await commitment('SC-002', {
    vendor: 'subB',
    lines: [{ description: `Internal plaster ${b.ref('SC-002-L1')}`, costCodeId: codeId('03-100'), budgetLineId: lineId('03-100', 'subcontract'), boqItemId: boq.ids['B-005'], activityId: A.A320, unit: 'm2', qty: 4000, rate: 25 }],
    insurance: { type: 'bond', label: 'Performance bond', withDocument: false },
  });
  // SC-003: plaster finishing 4,000 m2 @ 25 = 100,000.00 on A320 (at 50%: cap 50,000), insurance on file: the P4 probes' commitment.
  const sc3 = await commitment('SC-003', {
    vendor: 'subB',
    lines: [{ description: `Plaster finishing coat ${b.ref('SC-003-L1')}`, costCodeId: codeId('03-100'), budgetLineId: lineId('03-100', 'subcontract'), boqItemId: boq.ids['B-005'], activityId: A.A320, unit: 'm2', qty: 4000, rate: 25 }],
    insurance: { type: 'general_liability', label: 'Public liability', withDocument: true },
  });
  await b.step('commitment.SC-003.execute', async (s) => {
    await toApproved(s, 'SC-003', sc3.id);
    await executeWithFile(s, 'SC-003', sc3.id);
    s.expectFields(await commitmentGet(s, sc3.id), { status: 'executed', original: is.cents(100000), insuranceReady: true }, 'SC-003');
    return { status: 'executed' };
  }, { needs: ['commitment.SC-003'] });
  await b.step('commitment.SC-002.execute', async (s) => {
    await toApproved(s, 'SC-002', sc2.id);
    if ((await commitmentGet(s, sc2.id)).status === 'approved' || pendingRecord('commitment.SC-002.execute')) {
      const signed = await C.attach(s, 'commitment.SC-002.signed', 'pm', 'commitment', sc2.id, 'Signed agreement SC-002');
      // WP4.C1.insuranceMissing and overrideWithoutReason, then the override with its reason.
      // An interrupted probe is found by what a wrongly accepted one would have made: an executed SC-002.
      const executedNow = async (s2) => {
        const c = await commitmentGet(s2, sc2.id);
        return c.status === 'executed' ? c : null;
      };
      await s.refused('commitment.SC-002.execute.no-override', 'pm', 'POST', `${b.P}/commitments/${sc2.id}/execute`, { documentId: signed.documentId }, saidOf(D052.C1.insuranceMissing), { named: false, find: executedNow });
      await s.refused('commitment.SC-002.execute.no-reason', 'pm', 'POST', `${b.P}/commitments/${sc2.id}/execute`, { documentId: signed.documentId, override: true }, saidOf(D052.C1.overrideWithoutReason), { named: false, find: executedNow });
      await s.act('commitment.SC-002.execute', 'pm', 'POST', `${b.P}/commitments/${sc2.id}/execute`, { documentId: signed.documentId, override: true, overrideReason: `Bond to follow within 14 days ${b.ref('SC-002')}` }, {
        fields: { status: 'executed' },
        verify: async (s2) => (await commitmentGet(s2, sc2.id)).status === 'executed',
      });
    }
    s.expectFields(await commitmentGet(s, sc2.id), { status: 'executed', insuranceReady: false }, 'SC-002 executed with the bond missing');
    return { status: 'executed' };
  }, { needs: ['commitment.SC-002'] });

  // WP4.C2 (deep["052-COM"].C2): +10,000 approved (committed 110,000.00), +5,000 pending (does not count); the
  // committed value asserted at each moment.
  await b.step('commitment.SC-001.change-orders', async (s) => {
    const C2 = D052.C2;
    const commitmentRoute = `${b.P}/commitments/${sc1.id}`;
    const read = async (id) => ((await commitmentGet(s, sc1.id)).changeOrders || []).find((row) => row.id === id);
    const revised = async (label, figure) => s.expectFields(await commitmentGet(s, sc1.id), { revised: asCents(figure) }, `SC-001 ${label} (WP4.C2)`);
    const l1 = sovLine(sc1, 'A310', 'SC-001');
    const make = async (key, amount) => {
      const title = b.name(`Commitment variation ${key}`);
      return s.create(`cco.${key}`, 'qs', `${commitmentRoute}/change-orders`, {
        title, description: `${title} ${b.ref(key)}`,
        lines: [{ amount, sovLineId: l1.id, description: `Extra to line 1 ${b.ref(key)}`, costCodeId: codeId('03-100'), budgetLineId: lineId('03-100', 'subcontract'), activityId: A.A310 }],
      }, {
        get: commitmentRoute,
        fields: { status: 'draft', value: is.cents(amount) },
        adopt: true,
        find: async () => atMostOne((await commitmentGet(s, sc1.id)).changeOrders || [], (row) => row.title === title, `SC-001 commitment CO ${key}`),
      });
    };
    const go = async (key, id, verb, persona, body, status) => s.act(`cco.${key}.${verb}`, persona, 'POST', `${b.P}/commitments/change-orders/${id}/${verb}`, body, {
      fields: { status },
      verify: async () => (await read(id))?.status === status,
    });
    const at = async (row, status, name) => (await read(row.id)).status === status || pendingRecord(name);
    const approved = await make('APPROVED', major(C2.committedCoApproved) - major(C2.committedExecuted));
    if (await at(approved, 'draft', 'cco.APPROVED.submit')) {
      if ((await read(approved.id)).status === 'draft') await revised('with the +10,000 CO in draft', C2.committedCoDraftPending);
      await go('APPROVED', approved.id, 'submit', 'qs', {}, 'pending');
    }
    if (await at(approved, 'pending', 'cco.APPROVED.approve')) {
      if ((await read(approved.id)).status === 'pending') await revised('with the +10,000 CO pending', C2.committedCoDraftPending);
      await go('APPROVED', approved.id, 'approve', 'pm', {}, 'approved');
    }
    await revised('after the +10,000 CO is approved', C2.committedCoApproved);
    const pending = await make('PENDING', 5000);
    if (await at(pending, 'draft', 'cco.PENDING.submit')) await go('PENDING', pending.id, 'submit', 'qs', {}, 'pending');
    const states = { approved: (await read(approved.id)).status, pending: (await read(pending.id)).status };
    s.expectFields(states, { approved: 'approved', pending: 'pending' }, 'commitment CO states');
    // WP4.C2.committedCoApproved: 100,000 + 10,000 = 110,000.00 (the pending 5,000 does not count).
    await revised('at the end (the pending 5,000 does not count)', C2.committedCoApproved);
    return { ids: { approved: approved.id, pending: pending.id }, states };
  }, { needs: ['commitment.SC-001.execute'] });

  // ── pay applications (P3, P4) ──
  const payAppGet = (s, id) => s.get('qs', `${b.P}/pay-apps/${id}`);
  const newPayApp = async (s, key, commitmentId, periodStart, periodEnd) => {
    const periodLabel = b.ref(`PA-${key}`);
    return s.create(`payapp.${key}`, 'qs', `${b.P}/pay-apps`, { commitmentId, periodLabel, periodStart, periodEnd: b.past(periodEnd), notes: `Application ${periodLabel}` }, {
      fields: { periodLabel, status: 'draft' },
      adopt: true,
      find: async (s2) => atMostOne(listOf(await s2.get('qs', `${b.P}/pay-apps?includeVoid=true&commitmentId=${commitmentId}`)), (row) => row.periodLabel === periodLabel, `pay application ${periodLabel}`),
    });
  };
  const claimPayApp = async (s, key, payApp, amounts) => {
    const app = await payAppGet(s, payApp.id);
    if (app.status !== 'draft' && !pendingRecord(`payapp.${key}.claim`)) return app;
    const lines = app.lines.map((line) => ({ sovLineId: line.sovLineId, thisPeriodAmount: amounts[line.sovLineId] ?? 0, notes: b.ref(`PA-${key}`) }));
    const want = Object.values(amounts).reduce((a, v) => a + v, 0);
    return s.act(`payapp.${key}.claim`, 'qs', 'PATCH', `${b.P}/pay-apps/${payApp.id}`, { lines }, {
      fields: { grossThisPeriod: is.cents(want) },
      verify: async (s2) => lib.sameCents((await payAppGet(s2, payApp.id)).grossThisPeriod, want),
    });
  };
  const payAppAct = async (s, key, id, verb, persona, body, status, { fields = null, verify = null } = {}) =>
    s.act(`payapp.${key}.${verb}`, persona, 'POST', `${b.P}/pay-apps/${id}/${verb}`, body, {
      fields: fields || { status },
      verify: verify || (async (s2) => (await payAppGet(s2, id)).status === status),
    });

  // PA-01 on SC-001 (A310 at 50%: cap 50% x 110,000 = 55,000): WP4.P3 50,000 approved (+50,000), revoked (-50,000),
  // re-approved under r1, each transition guarded on its own status and revision (as 087-COM's PA-01, R2-1); then
  // WP4.P4's part payment of 20,000.00 (status approved, paid 20,000.00, outflow +20,000.00).
  await b.step('payapp.P3', async (s) => {
    const P3 = D052.P3;
    const P4 = D052.P4;
    const l1 = sovLine(sc1, 'A310', 'SC-001');
    const app = await newPayApp(s, '01', sc1.id, '2026-06-01', '2026-06-30');
    const phaseOf = (row) => {
      const revision = Number(row.certificationRevision) || 0;
      if (revision === 0) {
        if (row.status === 'draft') return lib.sameCents(row.grossThisPeriod, major(P3.gross)) ? 1 : 0;
        return { submitted: 2, under_review: 3, approved: 4 }[row.status] ?? -1;
      }
      if (revision === 1) return { draft: 5, submitted: 6, approved: 7 }[row.status] ?? -1;
      return -1;
    };
    const phase = async (s2 = s) => phaseOf(await payAppGet(s2, app.id));
    const reached = (n) => async (s2) => (await phase(s2)) >= n;
    const at = async (n, name) => (await phase()) === n || pendingRecord(name);
    s.assert((await phase()) >= 0, `PA-01 reads a state of the P3 sequence (status ${(await payAppGet(s, app.id)).status})`);
    if (await at(0, 'payapp.01.claim')) await claimPayApp(s, '01', app, { [l1.id]: major(P3.gross) });
    if (await at(1, 'payapp.01.submit')) await payAppAct(s, '01', app.id, 'submit', 'qs', {}, 'submitted', { verify: reached(2) });
    if (await at(2, 'payapp.01.review')) await payAppAct(s, '01', app.id, 'review', 'qs', { note: `Checked against the site measure ${b.ref('PA-01')}` }, 'under_review', { verify: reached(3) });
    // WP4.P3.gross / retention / net: 50,000.00 / 5,000.00 / 45,000.00 (deep["052-COM"].P3), at the approval (r0).
    if (await at(3, 'payapp.01.approve')) {
      await payAppAct(s, '01', app.id, 'approve', 'pm', {}, 'approved', { fields: { status: 'approved', certificationRevision: 0, grossThisPeriod: asCents(P3.gross), retentionThisPeriod: asCents(P3.retention), netThisPeriod: asCents(P3.net) }, verify: reached(4) });
    }
    if (await at(4, 'payapp.01.reopen')) {
      await payAppAct(s, '01', app.id, 'reopen', 'pm', { reason: `Certified against the wrong measure ${b.ref('PA-01')}` }, 'draft', { fields: { status: 'draft', certificationRevision: 1 }, verify: reached(5) });
    }
    if (await at(5, 'payapp.01.resubmit')) {
      await s.act('payapp.01.resubmit', 'qs', 'POST', `${b.P}/pay-apps/${app.id}/submit`, {}, { fields: { status: 'submitted', certificationRevision: 1 }, verify: reached(6) });
    }
    if (await at(6, 'payapp.01.reapprove')) {
      await s.act('payapp.01.reapprove', 'pm', 'POST', `${b.P}/pay-apps/${app.id}/approve`, {}, { fields: { status: 'approved', certificationRevision: 1, netThisPeriod: asCents(P3.net) }, verify: reached(7) });
    }
    // WP4.P4.payPartStatus / paidAmount, in the payment's own answer.
    const reference = b.ref('PA-01-PAY-1');
    await s.create('payapp.01.pay.1', 'finance', `${b.P}/pay-apps/${app.id}/payments`, { amount: major(P4.paidAmount), paidAt: b.past('2026-07-15'), method: 'bank_transfer', reference, note: `Paid ${reference}` }, {
      get: `${b.P}/pay-apps/${app.id}`,
      idOf: (d) => atMostOne(d?.payments || [], (p) => p.reference === reference, `pay application payment ${reference}`)?.id ?? null,
      fields: {
        paidAmount: asCents(P4.paidAmount),
        status: P4.payPartStatus.value,
        payments: (v) => (Array.isArray(v) && v.filter((p) => p.reference === reference && lib.sameCents(p.amount, major(P4.paidAmount))).length === 1) || `one payment ${reference}`,
      },
      find: async (s2) => {
        const now = await payAppGet(s2, app.id);
        return atMostOne(now.payments || [], (p) => p.reference === reference, `pay application payment ${reference}`) ? now : null;
      },
    });
    const end = await payAppGet(s, app.id);
    // WP4.P4.payPartStatus / paidAmount: still approved, 20,000.00 paid.
    s.expectFields(end, { status: P4.payPartStatus.value, certificationRevision: 1, paidAmount: asCents(P4.paidAmount), netThisPeriod: asCents(P3.net) }, 'PA-01 (WP4.P3 / P4)');
    return { id: app.id, ref: end.ref };
  }, { needs: ['commitment.SC-001.change-orders'] });

  // PA-P4 on SC-003 (A320 at 50%: cap 50,000): approved 50,000.00 / net 45,000.00, nothing paid — the WP4.P4 ceiling probes' application.
  await b.step('payapp.P4', async (s) => {
    const P3 = D052.P3;
    const line = sovLine(sc3, 'A320', 'SC-003');
    const app = await newPayApp(s, 'P4', sc3.id, '2026-07-01', '2026-07-31');
    await claimPayApp(s, 'P4', app, { [line.id]: major(P3.gross) });
    if ((await payAppGet(s, app.id)).status === 'draft' || pendingRecord('payapp.P4.submit')) await payAppAct(s, 'P4', app.id, 'submit', 'qs', {}, 'submitted', { verify: async (s2) => (await payAppGet(s2, app.id)).status !== 'draft' });
    if ((await payAppGet(s, app.id)).status === 'submitted' || pendingRecord('payapp.P4.approve')) await payAppAct(s, 'P4', app.id, 'approve', 'pm', {}, 'approved', { fields: { status: 'approved', netThisPeriod: asCents(P3.net) } });
    const end = await payAppGet(s, app.id);
    s.expectFields(end, { status: 'approved', grossThisPeriod: asCents(P3.gross), retentionThisPeriod: asCents(P3.retention), netThisPeriod: asCents(P3.net), paidAmount: is.cents(0) }, 'PA-P4');
    return { id: app.id, ref: end.ref };
  }, { needs: ['commitment.SC-003.execute'] });

  // ── O2: a PO of 100 bags @ 10.00, issued, 60 received: partial (WP5.O2), left for the proof ──
  await b.step('suppliers', async (s) => {
    const code = 'SUP-052COM';
    const route = `${b.P}/procurement/suppliers`;
    const made = await s.create('supplier.main', 'procurement', route, {
      companyId: companyId('supplier'), code, contactName: `Account manager ${b.ref('SUP')}`, status: 'approved', notes: `Framework supplier ${b.ref('SUP')}`,
    }, {
      get: route,
      fields: { status: 'approved' },
      adopt: true,
      find: async (s2) => atMostOne(listOf(await s2.get('procurement', route)), (row) => row.code === code, `supplier ${code}`),
    });
    return { id: made.id };
  }, { needs: ['directory'] });

  // Warehouse codes and item SKUs are unique in the company: they carry the project's id prefix, so that a debug
  // project archived earlier never holds them.
  const sku = `CERT3-052-COM-CEM-${b.projectId.slice(0, 8)}`;
  const store = await b.step('warehouse', async (s) => {
    const listRoute = `/inventory/warehouses?projectId=${b.projectId}`;
    const visible = listOf(await s.get('warehouse', listRoute));
    const code = `C3-052COM-SITE-${b.projectId.slice(0, 8)}`;
    const wh = await s.create('warehouse.site', 'warehouse', '/inventory/warehouses', {
      code, name: b.name('Site store'), kind: 'site', projectId: b.projectId, managerId: await b.userId('warehouse'), notes: b.ref('WH-SITE'),
    }, {
      get: listRoute,
      fields: { code },
      adopt: true,
      find: async () => atMostOne(visible, (row) => row.code === code, `warehouse ${code}`),
    });
    const locationsRoute = `/inventory/warehouses/${wh.id}/locations`;
    const existing = listOf(await s.get('warehouse', locationsRoute));
    const bin = await s.create('location.site.Z-A', 'warehouse', locationsRoute, { code: 'Z-A', name: `Zone A (${b.code})`, kind: 'zone', parentId: null }, {
      get: locationsRoute,
      fields: { code: 'Z-A' },
      adopt: true,
      find: async () => atMostOne(existing, (r) => r.code === 'Z-A', 'site location Z-A'),
    });
    const item = await s.create('item.cement', 'warehouse', '/inventory/items', {
      sku, name: b.name('Cement OPC 42.5N 50kg bag'), unit: 'bag', category: 'cement', projectId: b.projectId, unitCost: 10, notes: b.ref('ITEM-CEM'),
    }, {
      get: (id) => `/inventory/items/${id}`,
      fields: { sku },
      adopt: true,
      find: async (s2) => atMostOne(listOf(await s2.get('warehouse', `/inventory/items?projectId=${b.projectId}&search=${encodeURIComponent(sku)}`)), (row) => row.sku === sku, `stock item ${sku}`),
    });
    return { warehouseId: wh.id, locationId: bin.id, itemId: item.id };
  });

  await b.step('po.O2', async (s) => {
    const O2 = D052.O2;
    const supplierId = b.out('suppliers').id;
    const poRoute = (id) => `${b.P}/purchase-orders/${id}`;
    const poGet = (s2, id) => s2.get('procurement', poRoute(id));
    const title = `${b.name('Cement for the slab')} ${b.ref('PO-O2')}`;
    const description = `Cement OPC 42.5N (${b.code})`;
    const made = await s.create('po.O2', 'procurement', `${b.P}/procurement/purchase-orders`, {
      item: title, supplierId, status: 'draft', currency: D052.currency.value, requiredBy: b.date(21, { future: true }), promisedDate: b.date(14, { future: true }), buyer: `Buyer ${b.ref('PO')}`, notes: b.ref('PO-O2'),
      lines: [{
        lineNumber: 1, notes: b.ref('PO-O2-L1'), activityId: A.A220, costCodeId: codeId('02-100'), budgetLineId: lineId('02-100', 'material'), itemCode: sku,
        description, unit: 'bag', orderedQty: O2.ordered.value, unitCost: 10,
      }],
    }, {
      get: (id) => poRoute(id),
      // WP5.O2.order1000: 100 x 10.00 = 1,000.00; the line as sent.
      fields: {
        status: 'draft',
        value: asCents(O2.order1000),
        lines: (v) => (Array.isArray(v) && v.length === 1 && v[0].description === description && Number(v[0].orderedQty) === O2.ordered.value && lib.sameCents(v[0].unitCost, 10) && v[0].activityId === A.A220) || `one line of ${O2.ordered.value} bags @ 10.00 on A220`,
      },
      adopt: true,
      find: async (s2) => {
        const row = atMostOne(listOf(await s2.get('procurement', `${b.P}/procurement/purchase-orders`)), (r) => r.item === title, 'purchase order O2');
        return row ? poGet(s2, row.id) : null;
      },
    });
    const id = made.id;
    const status = async () => (await poGet(s, id)).status;
    const go = async (verb, persona, done) => s.act(`po.O2.${verb}`, persona, 'POST', `${poRoute(id)}/${verb}`, {}, { fields: { id }, verify: async () => done.includes(await status()) });
    if ((await status()) === 'draft' || pendingRecord('po.O2.submit')) await go('submit', 'procurement', ['pending_approval', 'approved', 'issued', 'partial']);
    if ((await status()) === 'pending_approval' || pendingRecord('po.O2.approve')) await go('approve', 'pm', ['approved', 'issued', 'partial']);
    if ((await status()) === 'approved' || pendingRecord('po.O2.issue')) await go('issue', 'procurement', ['issued', 'partial']);
    const order = await poGet(s, id);
    s.expectFields(order, { value: asCents(O2.order1000) }, 'PO O2');
    const poLine = one(order.lines, (l) => l.lineNumber === 1, 'PO O2: its line 1');
    const receiptNote = b.ref('DN-O2');
    await s.create('receipt.O2', 'warehouse', '/inventory/goods-receipt', {
      orderId: id, projectId: b.projectId, warehouseId: store.warehouseId, deliveryNote: receiptNote, notes: `Checked against the order ${receiptNote}`,
      lines: [{ poLineId: poLine.id, acceptedQty: O2.received.value, rejectedQty: 0, locationId: store.locationId, inventoryItemId: store.itemId, notes: b.ref('RCV-O2') }],
    }, {
      expect: [200, 201],
      get: () => poRoute(id),
      idOf: (d) => d?.receiptId ?? null,
      fields: { receiptId: is.present },
      adopt: true,
      find: async (s2) => {
        const receipt = atMostOne((await poGet(s2, id)).receipts || [], (r) => r.deliveryNote === receiptNote, `receipt ${receiptNote}`);
        return receipt ? { receiptId: receipt.id } : null;
      },
    });
    const after = await poGet(s, id);
    // WP5.O2.ordered 100 / received 60 / statusAfterPartial partial; the 60 bags in stock.
    s.expectFields({ status: after.status, line: one(after.lines, (l) => l.id === poLine.id, 'PO O2: its line') }, {
      status: O2.statusAfterPartial.value,
      'line.orderedQty': O2.ordered.value,
      'line.receivedQty': O2.received.value,
      'line.rejectedQty': 0,
    }, 'PO O2 after 60 received');
    s.expectFields(await s.get('warehouse', `/inventory/items/${store.itemId}`), { onHand: O2.received.value }, 'the cement received into stock');
    return { id, ref: after.ref, status: after.status };
  }, { needs: ['suppliers', 'warehouse', 'activities', 'budget-lines'] });
});
