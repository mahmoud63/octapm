'use strict';

/**
 * CERT-3 builder 087-COM "CERT3 Commercial" (plan §3.2 D1 087-COM; serves WP-4,
 * WP-5, WP-6 and the WP-7 claims). Company 087 (EGP, Africa/Cairo).
 *
 * What it leaves (every figure derived on paper in the answer book,
 * answers/commercial.js, and read from it: BOOK / D087 below):
 *   - the project WITHOUT defaultRetentionRate (deep.087-COM.defaultRetentionRate),
 *     shown through the API only (adjudication G5): the display default, the
 *     contract's first read and IPC-01's items (findings HR-C1)
 *   - the F1 network hand-built (A100 .. M900), a 130-row bill whose workbook has three
 *     sections 50/50/30 (deep.087-COM.boqRows / boqSections) holding the stage-3 rows
 *     B-001..B-005, the I1 row C-001 and five 97,500.00 rows D-001..D-005; the rows read
 *     back carry no section today (finding HR-C14, round 2 R2-F)
 *   - cost codes and budget lines for all eight cost types (WP6.B1.original), plus
 *     02-100/subcontract next to 02-100/material for WP4.C4 (L108, R2-5)
 *   - approved allocations and approved progress (the IPC and pay-app caps)
 *   - the contract value established at 2,000,000.00 (deep.087-COM.contractOriginal)
 *   - prime COs in every state (approved 125,000, pending 40,000, rejected,
 *     archived, the E1 draft 9,500, the E4 split, the I3 allocation link on
 *     the split B-002 row, one from an RFI) and change events in every state,
 *     one with RFQs to two vendors on one line; the contract's end aggregates
 *     (approved 147,000, pending 49,500, revised 2,147,000) and the CO set that
 *     composes them are deep.087-COM.contractEnd (round 3 R3-3)
 *   - the IPC lane: IPC-01 is the I1 case (retention unconfigured: HR-C1,
 *     BLOCKED, never certified); then retention configured explicitly at 10%
 *     (deep.087-COM.contractRetentionRate; every claimed item PATCHed to 10 and
 *     asserted: finding L114) and IPC-02..IPC-10: capped and paid (I7), paid with
 *     retention released (I8, its moment refusals and states asserted at their
 *     moments), tax (I7), part-paid (stage 10), materials on site (I10), advance
 *     recovery (I7), IPC-04's PM override certified last (I6, deep.087-COM.ipc04;
 *     findings WP4-DRAFTS-1 and WP4-OVR-1), IPC-09 submitted with a deduction and
 *     IPC-10 a draft (deep.087-COM.ipc09 / ipc10, round 2 R2-B). WP4-OVR-1 is read from
 *     IPC-09's certification review (GET), never by certifying it (round 2 R2-F)
 *   - commitments: SC-001 (required insurance, 100,000.00 executed: WP4.C2's
 *     100,000 -> 110,000 asserted at each moment), SC-002 executed on a PM override,
 *     SC-003 (closeout gate), SC-004 (stage 5's plaster subcontract), PC-001 (a PO
 *     commitment on cost code 02-100 only, with a 1,000.00 application: WP4.C4),
 *     commitment COs and pay applications in every state (deep.087-COM.stateCoverage);
 *     PA-01 revoked and re-certified, each transition guarded on its own status (R2-1)
 *   - cash flow manual rows; payments dated so CF1's months hold only CF1's three
 *   - a weather delay and EOT claims in every state, two approved (WP7.T2, T3), with
 *     ldRatePerDay asserted on the project and the claims
 *   - a bid package with three bidders, a withdrawal (recorded portal calls, R2-10)
 *     and a late bid, awarded to the non-lowest on the prequalification override
 *     (finding WP5-AWD-1), and its PO (WP5.R1, R4)
 *   - POs in every status the plan names (lines, quantities, unit costs and values
 *     asserted): O2 cement 100 @ 10 with 60 received (closed short: HR-C8), O4's own
 *     order with 10 accepted and 2 rejected; two warehouses with bins, a serial item,
 *     receipts with damage and rejection, issues, quarantine, transfers, returns, and
 *     the N1 cement no other movement touches (on hand 90, reserved 50, available 40);
 *     material plan rows on PO lines
 *   - direct costs of every type and state and the supplier invoices (the D5
 *     over-invoiced service line: finding WP5-SVC-1)
 *
 * Every adoption or read-back find selects by identity and asserts at most one match
 * (C.atMostOne; adjudication G6, round 2 R2-D).
 *
 * Debug: from backend/ with DATABASE_URL unset,
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/build/087-com.js
 */

const lib = require('./lib');
const C = require('./_commercial');

const { is } = lib;
const { listOf, cents, money, one, atMostOne } = C;

const BOOK = lib.answers.commercial;
const D087 = BOOK.deep['087-COM'];
const { WP4, WP5, WP7 } = BOOK;
const STAGE4 = BOOK['stage4:170'];
const STAGE5 = BOOK['stage5:82-204'];
/** A book money figure (integer cents) in major units, for a payload or arithmetic. */
const major = (figure) => figure.value / 100;
/** A book money figure as a matcher on a major-unit answer (compared in cents). */
const asCents = (figure) => is.cents(major(figure));
/** A book error figure as the lib's '<status> <CODE>'. */
const saidOf = (figure) => `${figure.value.status} ${figure.value.code}`;

/** The stage-10 certificate's gross (= EV), 97,500.00: every D row and IPC-03 certify it. */
const GROSS = WP4.existing['stage10.gross'];
/** The configured item rate (deep.087-COM.contractRetentionRate), PATCHed on every configured claim (L114). */
const RATE = D087.contractRetentionRate.value;

const S1 = 'Substructure and frame';
const S2 = 'Envelope and services';
const S3 = 'Finishes and externals';

/** The designed rows (answer book commercial.js BOQ / ALLOC / I1_CERT, and the five 97,500.00 rows). */
const DESIGNED = [
  { code: 'B-001', description: 'Bulk excavation to reduced level', quantity: 5000, unit: 'm3', rate: 12 },
  { code: 'B-002', description: 'Foundation concrete C35', quantity: 800, unit: 'm3', rate: 150 },
  { code: 'B-003', description: 'High tensile reinforcement', quantity: 60, unit: 't', rate: 1200 },
  { code: 'B-004', description: 'Blockwork walls 200mm', quantity: 3000, unit: 'm2', rate: 45 },
  { code: 'B-005', description: 'Internal plaster two coats', quantity: 4000, unit: 'm2', rate: 18 },
  // WP4.I1.currentCert: 1,000 m3 @ 100 = 100,000, its activity approved at 40%.
  { code: 'C-001', description: 'Ground slab concrete C30', quantity: 1000, unit: 'm3', rate: 100 },
  // One 97,500.00 row per configured certificate (I7 cap, I7 tax, stage-10 part-paid, I10, I7 advance).
  { code: 'D-001', description: 'Column frame level 1', quantity: 1000, unit: 'm3', rate: 97.5 },
  { code: 'D-002', description: 'Beam frame level 1', quantity: 1000, unit: 'm3', rate: 97.5 },
  { code: 'D-003', description: 'Column frame level 2', quantity: 1000, unit: 'm3', rate: 97.5 },
  { code: 'D-004', description: 'MEP first fix containment', quantity: 1000, unit: 'm3', rate: 97.5 },
  { code: 'D-005', description: 'Painting and decoration', quantity: 1000, unit: 'm3', rate: 97.5 },
].map((row) => ({ ...row, mappingRule: 'required', section: S1 }));

/** Allocations: stage3 (WP4.existing / WP6.A3) plus the I1 row and the D rows. */
const ALLOCATIONS = [
  { key: 'B-001.A110', boqCode: 'B-001', activity: 'A110', quantity: 5000, amount: 60000 },
  { key: 'B-002.A120', boqCode: 'B-002', activity: 'A120', quantity: 200, amount: 30000 },
  { key: 'B-002.A130', boqCode: 'B-002', activity: 'A130', quantity: 600, amount: 90000 },
  { key: 'B-004.A310', boqCode: 'B-004', activity: 'A310', quantity: 3000, amount: 135000 },
  { key: 'B-005.A320', boqCode: 'B-005', activity: 'A320', quantity: 4000, amount: 72000 },
  { key: 'C-001.A220', boqCode: 'C-001', activity: 'A220', quantity: 1000, amount: 100000 },
  { key: 'D-001.A200', boqCode: 'D-001', activity: 'A200', quantity: 1000, amount: 97500 },
  { key: 'D-002.A210', boqCode: 'D-002', activity: 'A210', quantity: 1000, amount: 97500 },
  { key: 'D-003.A230', boqCode: 'D-003', activity: 'A230', quantity: 1000, amount: 97500 },
  { key: 'D-004.A300', boqCode: 'D-004', activity: 'A300', quantity: 1000, amount: 97500 },
  { key: 'D-005.A330', boqCode: 'D-005', activity: 'A330', quantity: 1000, amount: 97500 },
];

/** Approved progress (the caps): WP-3 T1's A110 100 / A120 50 / A130 25, I1's 40, P2's A310 50. */
const PROGRESS = [
  ['A110', 100], ['A120', 50], ['A130', 25], ['A220', 40], ['A310', 50], ['A320', 100],
  ['A200', 100], ['A210', 100], ['A230', 100], ['A300', 100], ['A330', 100],
].map(([activity, pct]) => ({ activity, pct }));

lib.main('087-COM', async (b) => {
  // A transition guarded on the record's status also runs while its own record is pending (sent by a killed run,
  // answer never recorded), so the lib's verify settles it instead of leaving it pending (G4).
  const pendingRecord = (name) => b.state.records[name]?.status === 'pending';
  // ── the project: created WITHOUT defaultRetentionRate (deep.087-COM.defaultRetentionRate) ──
  await b.project({
    title: 'Commercial',
    payload: {
      type: 'building',
      contractType: 'remeasurement',
      contractNumber: b.ref('PC'),
      startDate: '2026-01-05',
      endDate: '2027-06-30',
      // WP7.T2: completion 2027-06-30, the EOT recommendations count from it.
      completionDate: '2027-06-30',
      projectCalendar: 'five_day',
      currency: D087.currency.value,
      // deep.087-COM.ldRatePerDay: 1,000.00 (WP7.T4 / T5).
      ldRatePerDay: major(D087.ldRatePerDay),
    },
    fields: { currency: D087.currency.value, projectCalendar: 'five_day', startDate: is.day('2026-01-05'), completionDate: is.day('2027-06-30'), ldRatePerDay: asCents(D087.ldRatePerDay) },
  });

  // deep.087-COM.defaultRetentionRate 'unset': the create payload names none. Through the API alone
  // (adjudication G5) an unset rate cannot be told from an explicit 5 on the project itself; the
  // contract's first read (contract.value) and IPC-01's items at 0 (ipc.I1) complete the evidence.
  await b.step('project.retention-unset', async (s) => {
    const shown = await s.get('pm', b.P);
    s.expectFields(shown, { contractValue: (v) => v === null || v === undefined || Number(v) === 0 || 'no contract value on the project' }, 'the project as created');
    const rate = shown.defaultRetentionRate ?? null;
    if (rate !== null) {
      s.assert(Number(rate) === 5, `GET /projects/:id shows defaultRetentionRate ${rate}: neither unset nor the display default 5 (HR-C1)`);
      s.finding('HR-C1', "GET /projects/:id shows defaultRetentionRate 5 for 087-COM, created without one (deep.087-COM.defaultRetentionRate: unset): the project serializer displays a silent 5% (project.service.js:280-282, defaultRetentionRate ?? DEFAULT_RETENTION_RATE). Through the API the unset value is evidenced by the prime contract's first read and IPC-01's items at rate 0 (steps contract.value and ipc.I1; adjudication G5).");
    }
    return { apiShows: rate };
  });

  await b.team({ planner: 'planning_eng', qs: 'qs', cost: 'cost_controller', procurement: 'procurement', warehouse: 'warehouse', site: 'site_engineer', finance: 'finance' });

  // ── the company directory: client, subcontractors, supplier, RFQ vendors ──
  const DIRECTORY = [
    ['client', 'Client Holdings'], ['subA', 'Blockwork Subcontractor'], ['subB', 'MEP Subcontractor'], ['subC', 'Finishing Subcontractor'],
    ['supplier', 'Cement Supplier'], ['vendorA', 'Groundworks Vendor A'], ['vendorB', 'Groundworks Vendor B'],
  ];
  const directory = await b.step('directory', async (s) => {
    const ids = {};
    for (const [key, label] of DIRECTORY) {
      const name = b.name(label);
      const search = `/companies?limit=100&search=${encodeURIComponent(name)}`;
      const data = await s.create(`company.${key}`, 'pm', '/companies', {
        name,
        type: 'external',
        email: `${key.toLowerCase()}.087com@parties.c087.octapm-cert.test`,
        phone: '+20 2 5550 0187',
        status: 'active',
      }, {
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
  const partyMail = (key) => `${key.toLowerCase()}.087com@parties.c087.octapm-cert.test`;

  // ── cost codes and budget lines for all eight cost types (WP6.B1.original 410,000.00 over seven; deep.087-COM.costTypes) ──
  await C.costCodes(b, [
    { code: '01-100', name: b.name('Labour'), category: 'labour' },
    { code: '02-100', name: b.name('Material'), category: 'material' },
    { code: '03-100', name: b.name('Subcontract'), category: 'subcontract' },
    { code: '09-100', name: b.name('Indirect'), category: 'indirect' },
    { code: 'CERT3-087-COM-EQP', name: b.name('Equipment'), category: 'equipment' },
    { code: 'CERT3-087-COM-OVH', name: b.name('Overhead'), category: 'overhead' },
    { code: 'CERT3-087-COM-CON', name: b.name('Contingency'), category: 'contingency' },
    { code: 'CERT3-087-COM-OTH', name: b.name('Other'), category: 'other' },
  ]);
  const BUDGET = [
    { code: '01-100', costType: 'labour', originalBudget: 100000, description: 'Labour' },
    { code: '02-100', costType: 'material', originalBudget: 100000, description: 'Material' },
    // WP4.C4 (L108, R2-5): cost code X = 02-100 carries an X/material AND an X/subcontract line. Original 0, so the
    // seven typed lines still total WP6.B1.original.
    { code: '02-100', costType: 'subcontract', originalBudget: 0, description: 'Supply under a purchase-order commitment' },
    { code: 'CERT3-087-COM-EQP', costType: 'equipment', originalBudget: 50000, description: 'Equipment' },
    { code: '03-100', costType: 'subcontract', originalBudget: 100000, description: 'Subcontract' },
    { code: '09-100', costType: 'indirect', originalBudget: 20000, description: 'Indirect' },
    { code: 'CERT3-087-COM-OVH', costType: 'overhead', originalBudget: 10000, description: 'Overhead' },
    { code: 'CERT3-087-COM-CON', costType: 'contingency', originalBudget: 30000, description: 'Contingency' },
    { code: 'CERT3-087-COM-OTH', costType: 'other', originalBudget: 0, description: 'Other' },
  ];
  const budget = await C.budgetLines(b, BUDGET);
  b.assert(budget.originalCents === BOOK.WP6.B1.original.value, `the budget's original is WP6.B1.original ${money(BOOK.WP6.B1.original.value)} (read ${money(budget.originalCents)})`);
  const codeId = (code) => b.out('cost-codes').ids[code];
  const lineId = (code, type) => b.out('budget-lines').ids[`${code}:${type}`];

  // ── the F1 network, the bill, allocations, approved progress ──
  const acts = await C.activitiesF1(b, { persona: 'planner', engineer: 'site' });
  const A = acts.ids;

  const boq = await b.step('boq', async (s) => {
    // deep.087-COM.boqSections { count 3, sizes [50, 50, 30] }: the workbook's sections S1, S2, S3 in that order.
    const SECTIONS = D087.boqSections.value;
    const names = [S1, S2, S3];
    s.assert(SECTIONS.count === names.length && SECTIONS.sizes.length === names.length, `deep.087-COM.boqSections names ${names.length} sections`);
    const designedIn = (name) => DESIGNED.filter((row) => row.section === name).length;
    const fillers = lib.files.boqRows.filler({ prefix: 'F', seed: 'cert3-087-COM-boq', sections: names.map((name, i) => ({ name, count: SECTIONS.sizes[i] - designedIn(name) })) });
    const rows = [...DESIGNED, ...fillers];
    s.assert(rows.length === D087.boqRows.value, `${D087.boqRows.value} bill rows (built ${rows.length})`);
    names.forEach((name, i) => s.assert(rows.filter((row) => row.section === name).length === SECTIONS.sizes[i], `the workbook's section "${name}" holds ${SECTIONS.sizes[i]} rows (deep.087-COM.boqSections)`));
    const file = lib.files.boqWorkbook(rows, { filename: b.file('BOQ.xlsx'), title: b.name('Bill of quantities') });
    const label = b.name('BOQ revision 1');
    // An interrupted upload is adopted from the revision this build's label names (identity, at most one: R2-D).
    const revisionOf = async (s2) => atMostOne(listOf(await s2.get('qs', `${b.P}/boq`), 'revisions'), (r) => r.label === label, `BOQ revision ${label}`);
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
      find: revisionOf,
    });
    const revisionId = uploaded?.revisionId ?? uploaded?.id;
    const items = listOf(await s.get('qs', `${b.P}/boq`), 'boqItems').filter((i) => i.isActive !== false);
    s.assert(items.length === rows.length, `${rows.length} active bill rows read back (read ${items.length})`);
    const total = items.reduce((sum, i) => sum + cents(i.amount), 0);
    s.assert(total === file.totalCents, `the bill total is the workbook's ${money(file.totalCents)} (read ${money(total)})`);
    const ids = Object.fromEntries(DESIGNED.map((row) => [row.code, one(items, (i) => i.code === row.code, `bill row ${row.code}`).id]));
    // The rows read back, counted by their section (round 2 R2-F: the HR-C14 departure is a finding, never a comment).
    const sectionOf = (i) => (typeof i.section === 'string' && i.section.trim() ? i.section : null);
    const observed = {};
    for (const i of items) observed[sectionOf(i) ?? '(none)'] = (observed[sectionOf(i) ?? '(none)'] || 0) + 1;
    const withSection = items.filter((i) => sectionOf(i) !== null).length;
    if (withSection === 0) {
      s.finding('HR-C14', `087-COM's bill was uploaded with a section column holding ${names.map((name, i) => `"${name}" ${SECTIONS.sizes[i]}`).join(', ')} rows (deep.087-COM.boqSections: ${SECTIONS.count} sections, ${SECTIONS.sizes.join('/')}; asserted on the generated workbook), but none of the ${items.length} active rows read back (GET /projects/:id/boq) carries a section: the upload keeps no section column (HR-C14 "No section column"; the served BOQ row has no section). The rows' sections, and the AI job's [${SECTIONS.sizes.join(', ')}] batching by section (WP6.U5.aiJobCalls087), wait for the HR-C14 fix.`);
    } else {
      // After the HR-C14 fix: every row carries its workbook section, 50/50/30 by name.
      s.assert(withSection === items.length, `every bill row carries a section (${withSection} of ${items.length} do)`);
      names.forEach((name, i) => s.assert(observed[name] === SECTIONS.sizes[i], `section "${name}" holds ${SECTIONS.sizes[i]} rows read back (read ${observed[name] || 0}; deep.087-COM.boqSections)`));
      s.assert(Object.keys(observed).length === SECTIONS.count, `${SECTIONS.count} sections read back (read ${Object.keys(observed).join(', ')})`);
    }
    return { revisionId, rows: items.length, totalCents: total, ids, sections: { workbook: Object.fromEntries(names.map((name, i) => [name, SECTIONS.sizes[i]])), readBack: observed } };
  }, { needs: ['activities'] });

  const alloc = await C.allocate(b, ALLOCATIONS, { boqItems: boq.ids, activityIds: A });
  const allocId = (key) => alloc.ids[key];
  await C.progress(b, PROGRESS, { activityIds: A });

  // ── the contract value established (deep.087-COM.contractOriginal 2,000,000.00) ──
  await b.step('contract.value', async (s) => {
    const first = await s.get('qs', `${b.P}/prime-contract`);
    const observed = { originalValueSource: first.originalValueSource, originalValue: first.originalValue, retentionRate: first.retentionRate };
    // WP4.I1.silentContractRate: the first read stores the contract (ensureContract); with the project's
    // default unset it writes retentionRate 5, which under HR-C1 is not configuration (G5: the API observation).
    const stored = first.retentionRate ?? null;
    if (stored !== null) {
      s.assert(Number(stored) === 5, `the contract's first read stores retentionRate ${stored}: neither unset nor the silent 5 (WP4.I1.silentContractRate)`);
      s.finding('HR-C1', "087-COM's prime contract, first read with the project's default unset, stores retentionRate 5 (prime-contract.service.js:264-266, ensureContract): the silent fallback that WP4.I1.silentContractRate says must not count as configuration. The contract rate is configured explicitly at 10 only after the I1 case (step contract.retention).");
    }
    const data = await s.act('contract.value.enter', 'qs', 'PATCH', `${b.P}/prime-contract`, {
      title: b.name('Client contract'),
      originalValue: major(D087.contractOriginal),
      clientCompanyId: companyId('client'),
      paymentTermsDays: 30,
      status: 'active',
      notes: `Contract value as signed ${b.ref('CONTRACT')}`,
    }, {
      fields: { originalValue: asCents(D087.contractOriginal), originalValueSource: WP4.I5.valueSourceAfter.value },
      verify: async (s2) => (await s2.get('qs', `${b.P}/prime-contract`)).originalValueSource === WP4.I5.valueSourceAfter.value,
    });
    return { firstRead: observed, originalValue: data?.originalValue ?? major(D087.contractOriginal), source: WP4.I5.valueSourceAfter.value };
  }, { needs: ['boq'] });

  // ── prime change orders (before the IPC lane only the 125,000 approval moves the revised value) ──
  const coRegisterRoute = `${b.P}/change-orders?includeArchived=true`;
  const coRegister = async (s) => listOf(await s.get('qs', coRegisterRoute), 'orders');
  const coById = async (s, id) => (await coRegister(s)).find((row) => row.id === id) || null;
  /** A prime CO, made approvable (summaries, activity link, the instruction), optionally driven on. */
  const primeCo = (key, { value, activity, budgetLine, extra = {}, to = 'draft', withDocument = true }) =>
    b.step(`co.${key}`, async (s) => {
      const description = `${b.name(`Variation ${key}`)}: instructed scope`;
      const made = await s.create(`co.${key}`, 'qs', `${b.P}/change-orders`, {
        description,
        category: 'client_variation',
        value,
        activityId: A[activity],
        ...(budgetLine ? { budgetLineId: budgetLine } : {}),
        scheduleImpact: 0,
        raisedBy: `QS ${b.ref(key)}`,
        ...extra,
      }, {
        get: coRegisterRoute,
        fields: { status: 'draft', value: is.cents(value) },
        find: async (s2) => atMostOne(await coRegister(s2), (row) => row.description === description, `prime CO ${key}`),
      });
      const id = made.id;
      let documentId = null;
      if (withDocument) {
        const docs = await C.attach(s, `co.${key}.instruction`, 'qs', 'change_order', id, `Client instruction for ${key}`);
        documentId = docs.documentId;
        await s.act(`co.${key}.approvable`, 'qs', 'PATCH', `${b.P}/change-orders/${id}`, {
          scheduleImpactSummary: `No programme effect: absorbed in the activity duration (${b.ref(key)})`,
          costImpactSummary: `${value} at contract rates (${b.ref(key)})`,
          activityLinks: [{ activityId: A[activity], relationType: 'impacted', scheduleImpactDays: 0, costImpact: value, notes: b.ref(key) }],
          documentIds: [documentId],
        }, {
          fields: { id },
          verify: async (s2) => Boolean((await coById(s2, id))?.costImpactSummary),
        });
      }
      if (['pending', 'approved', 'rejected'].includes(to)) {
        await s.act(`co.${key}.submit`, 'qs', 'POST', `${b.P}/change-orders/${id}/submit`, { comment: `For approval ${b.ref(key)}` }, {
          fields: { status: 'pending' },
          verify: async (s2) => ['pending', 'approved', 'rejected'].includes((await coById(s2, id))?.status),
        });
      }
      if (to === 'approved') {
        await s.act(`co.${key}.approve`, 'pm', 'POST', `${b.P}/change-orders/${id}/approve`, { comment: `Approved under the instruction ${b.ref(key)}` }, {
          fields: { status: 'approved' },
          verify: async (s2) => (await coById(s2, id))?.status === 'approved',
        });
      }
      if (to === 'rejected') {
        await s.act(`co.${key}.reject`, 'pm', 'POST', `${b.P}/change-orders/${id}/reject`, { reason: `Not substantiated at contract rates ${b.ref(key)}` }, {
          fields: { status: 'rejected' },
          verify: async (s2) => (await coById(s2, id))?.status === 'rejected',
        });
      }
      if (to === 'archived') {
        await s.act(`co.${key}.archive`, 'pm', 'DELETE', `${b.P}/change-orders/${id}`, undefined, {
          fields: { '$status': 200 },
          verify: async (s2) => Boolean((await coById(s2, id))?.archivedAt),
        });
      }
      const row = await coById(s, id);
      s.assert(Boolean(row), `${key} is in the change-order register`);
      if (to === 'archived') s.assert(Boolean(row.archivedAt), `${key} is archived`);
      else s.expectFields(row, { status: to, value: is.cents(value) }, key);
      return { id, ref: row.ref, status: to, value, documentId };
    }, {
      verify: async (s, out) => {
        const row = await coById(s, out.id);
        if (!row) return `change order ${out.id} is gone`;
        return out.status === 'archived' ? Boolean(row.archivedAt) || 'no longer archived' : true;
      },
    });

  const budgetLine0310 = lineId('03-100', 'subcontract');
  // WP4.E5.approvedChangesValue / revisedValue: one approved 125,000 -> revised 2,125,000.00 (before IPC-02, WP4.I7.retentionCap).
  await primeCo('CO-125', { value: major(WP4.E5.approvedChangesValue), activity: 'A310', budgetLine: budgetLine0310, to: 'approved' });
  // WP4.E5.pendingChangesValue: one pending 40,000.
  await primeCo('CO-40', { value: major(WP4.E5.pendingChangesValue), activity: 'A320', budgetLine: budgetLine0310, to: 'pending' });
  await primeCo('CO-REJ', { value: 15000, activity: 'A320', budgetLine: budgetLine0310, to: 'rejected' });
  await primeCo('CO-ARC', { value: 3000, activity: 'A320', budgetLine: budgetLine0310, to: 'archived', withDocument: false });

  // WP4.E5 at its moment: CO-40 is the only draft/pending CO (E1's draft comes later), so pending reads 40,000.00.
  await b.step('contract.after-CO-125', async (s) => {
    const contract = await s.get('qs', `${b.P}/prime-contract`);
    s.expectFields(contract, {
      approvedChangesValue: asCents(WP4.E5.approvedChangesValue),
      pendingChangesValue: asCents(WP4.E5.pendingChangesValue),
      revisedValue: asCents(WP4.E5.revisedValue),
    }, 'contract after the 125,000 approval (WP4.E5)');
    return { approvedChangesValue: contract.approvedChangesValue, pendingChangesValue: contract.pendingChangesValue, revisedValue: contract.revisedValue };
  }, { needs: ['co.CO-125', 'co.CO-40', 'co.CO-REJ', 'co.CO-ARC'] });

  // ── change events in every state; RFQs through the public link ──
  const ceRoute = (id) => `${b.P}/change-events/${id}`;
  const ceGet = async (s, id) => s.get('qs', ceRoute(id));
  const lineOf = (event, description, key) => one(event.lines, (l) => String(l.description).startsWith(`${description} (`), `${key}: event line "${description}"`);
  const newEvent = async (s, key, { lines = [], persona = 'qs', type = 'owner_change' } = {}) => {
    const title = b.name(`Change event ${key}`);
    return s.create(`ce.${key}`, persona, `${b.P}/change-events`, {
      title,
      description: `Potential change ${b.ref(key)}`,
      type,
      origin: 'manual',
      activityId: A.A130,
      scheduleImpactDays: 0,
      notes: b.ref(key),
      lines: lines.map((line, index) => ({
        description: `${line.description} (${b.ref(`${key}-L${index + 1}`)})`,
        costCodeId: codeId('02-100'),
        budgetLineId: lineId('02-100', 'material'),
        activityId: A.A130,
        quantity: 1,
        unit: 'ls',
        unitCost: line.rom,
        romAmount: line.rom,
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
      // WP4.E1.afterRfqSend: sending an RFQ moves the open event to pricing.
      fields: { sent: (v, d) => (d?.sent ?? (d?.rfqs || []).length) === recipients.length || `${recipients.length} RFQs`, 'changeEvent.status': WP4.E1.afterRfqSend.value },
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
  /** The vendor quotes through the public link: skipped once quoted; a link from this run, else a reminder's fresh link. */
  const quote = async (s, key, event, rfqId, amounts) => {
    const rfq = one((await ceGet(s, event.id)).rfqs || [], (row) => row.id === rfqId, `${key}: RFQ ${rfqId}`);
    if (rfq.status === 'quoted' || rfq.status === 'accepted') return rfq;
    let token = tokens.get(rfqId);
    if (!token) {
      // A link from an earlier run is not kept: a reminder issues a fresh one (it only re-sends the e-mail).
      const reminded = await b.send('procurement', 'POST', `${b.P}/change-events/rfqs/${rfqId}/remind`, {});
      s.assert(reminded.status === 200, `the RFQ reminder answered 200 (got ${lib.said(reminded)})`);
      token = C.tokenOf(reminded.body?.data?.portalUrl, '/rfq/');
    }
    const lines = ((await ceGet(s, event.id)).lines || []);
    const res = await C.portal(b, 'PUT', `/public/rfqs/${token}/quote`, {
      lines: lines.filter((line) => amounts[line.id] !== undefined).map((line) => ({ lineId: line.id, amount: amounts[line.id], note: b.ref(key) })),
      notes: `Quotation ${b.ref(key)}`,
      validUntil: b.date(30, { future: true }),
      leadTimeDays: 10,
      quotedBy: `Estimator ${b.ref(key)}`,
    });
    s.assert(res.status === 200, `the vendor's quote on ${key} answered 200 (got ${lib.said(res)})`);
    const after = one((await ceGet(s, event.id)).rfqs || [], (row) => row.id === rfqId, `${key}: RFQ ${rfqId}`);
    s.assert(after.status === 'quoted', `the RFQ ${after.ref} reads quoted`);
    return after;
  };

  // E1 (WP4.E1): lines 6,000 + 4,000 (romTotal); vendor A quotes 5,700 + 3,800 = 9,500 on both lines (WP4.E1.quoteA note),
  // accepted (priced), converted to a draft CO of 9,500.00; each state asserted at its moment.
  await b.step('ce.E1', async (s) => {
    let event = await newEvent(s, 'E1', { lines: [{ description: 'Extra excavation to soft spots', rom: 6000 }, { description: 'Extra blinding', rom: 4000 }] });
    event = await ceGet(s, event.id);
    const l1 = lineOf(event, 'Extra excavation to soft spots', 'E1');
    const l2 = lineOf(event, 'Extra blinding', 'E1');
    s.assert(lib.sameCents(Number(l1.romAmount) + Number(l2.romAmount), major(WP4.E1.romTotal)), `E1's lines total WP4.E1.romTotal ${major(WP4.E1.romTotal)}`);
    const rfqs = await sendRfqs(s, 'E1', event, ['vendorA'], [l1.id, l2.id]);
    await quote(s, 'E1', event, rfqs.vendorA, { [l1.id]: 5700, [l2.id]: 3800 });
    if ((await ceGet(s, event.id)).status === 'pricing' || b.state.records['ce.E1.accept']?.status === 'pending') {
      await s.act('ce.E1.accept', 'qs', 'POST', `${b.P}/change-events/rfqs/${rfqs.vendorA}/accept`, { createCommitmentChangeOrder: false }, {
        fields: { 'changeEvent.status': WP4.E1.afterAccept.value },
        verify: async (s2) => [WP4.E1.afterAccept.value, WP4.E1.eventStatus.value].includes((await ceGet(s2, event.id)).status),
      });
    }
    const converted = await s.create('ce.E1.convert', 'qs', `${b.P}/change-events/${event.id}/convert`, { description: `${b.name('Variation E1')} from ${event.ref}` }, {
      get: coRegisterRoute,
      idOf: (d) => d?.changeOrder?.id ?? null,
      fields: { 'changeOrder.value': asCents(WP4.E1.convertedValue), 'changeOrder.status': WP4.E1.coStatus.value, 'changeEvent.status': WP4.E1.eventStatus.value },
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
    s.expectFields(await coById(s, changeOrderId), { status: WP4.E1.coStatus.value, value: asCents(WP4.E1.convertedValue) }, 'the CO from E1');
    return { eventId: event.id, rfqId: rfqs.vendorA, changeOrderId };
  }, { needs: ['activities', 'budget-lines', 'directory'] });

  // Two vendors on ONE line (plan §3.2; HR-C12's case): both quote, A is accepted; B's quote stays quoted.
  await b.step('ce.two-vendors', async (s) => {
    let event = await newEvent(s, 'TWO', { lines: [{ description: 'Dewatering of foundation trench', rom: 12000 }] });
    event = await ceGet(s, event.id);
    const line = lineOf(event, 'Dewatering of foundation trench', 'TWO');
    const rfqs = await sendRfqs(s, 'TWO', event, ['vendorA', 'vendorB'], [line.id]);
    await quote(s, 'TWO-A', event, rfqs.vendorA, { [line.id]: 11000 });
    await quote(s, 'TWO-B', event, rfqs.vendorB, { [line.id]: 11500 });
    if ((await ceGet(s, event.id)).status === 'pricing' || b.state.records['ce.TWO.accept']?.status === 'pending') {
      await s.act('ce.TWO.accept', 'qs', 'POST', `${b.P}/change-events/rfqs/${rfqs.vendorA}/accept`, { createCommitmentChangeOrder: false }, {
        fields: { 'changeEvent.status': 'priced' },
        verify: async (s2) => (await ceGet(s2, event.id)).status === 'priced',
      });
    }
    const now = await ceGet(s, event.id);
    s.expectFields(now, { status: 'priced' }, 'the two-vendor event');
    const states = {
      vendorA: one(now.rfqs || [], (r) => r.id === rfqs.vendorA, 'TWO: RFQ to vendor A').status,
      vendorB: one(now.rfqs || [], (r) => r.id === rfqs.vendorB, 'TWO: RFQ to vendor B').status,
    };
    s.assert(states.vendorA === 'accepted' && states.vendorB === 'quoted', `vendor A accepted and vendor B quoted on the one line (read ${JSON.stringify(states)})`);
    return { eventId: event.id, lineId: line.id, rfqs, states };
  }, { needs: ['activities', 'budget-lines', 'directory'] });

  await b.step('ce.states', async (s) => {
    // pricing: an RFQ out, not quoted
    let pricing = await newEvent(s, 'PRICING', { lines: [{ description: 'Temporary works redesign', rom: 7000 }] });
    pricing = await ceGet(s, pricing.id);
    await sendRfqs(s, 'PRICING', pricing, ['vendorB'], pricing.lines.map((l) => l.id));
    // open
    const open = await newEvent(s, 'OPEN', { lines: [{ description: 'Additional access road', rom: 5000 }], persona: 'site', type: 'site_condition' });
    // closed without a change
    const closedEvent = await newEvent(s, 'CLOSED', { lines: [] });
    if ((await ceGet(s, closedEvent.id)).status !== 'closed' || pendingRecord('ce.CLOSED.close')) {
      await s.act('ce.CLOSED.close', 'qs', 'POST', `${b.P}/change-events/${closedEvent.id}/close`, { reason: `Covered by the contract scope ${b.ref('CLOSED')}` }, {
        fields: { status: 'closed' },
        verify: async (s2) => (await ceGet(s2, closedEvent.id)).status === 'closed',
      });
    }
    // void
    const voided = await newEvent(s, 'VOID', { lines: [{ description: 'Raised twice', rom: 1000 }] });
    if ((await ceGet(s, voided.id)).status !== 'void' || pendingRecord('ce.VOID.void')) {
      await s.act('ce.VOID.void', 'pm', 'POST', `${b.P}/change-events/${voided.id}/void`, { reason: `Raised twice ${b.ref('VOID')}` }, {
        fields: { status: 'void' },
        verify: async (s2) => (await ceGet(s2, voided.id)).status === 'void',
      });
    }
    const states = {
      pricing: (await ceGet(s, pricing.id)).status,
      open: (await ceGet(s, open.id)).status,
      closed: (await ceGet(s, closedEvent.id)).status,
      void: (await ceGet(s, voided.id)).status,
    };
    s.expectFields(states, { pricing: 'pricing', open: 'open', closed: 'closed', void: 'void' }, 'change event states');
    return { ids: { pricing: pricing.id, open: open.id, closed: closedEvent.id, void: voided.id }, states };
  }, { needs: ['activities', 'budget-lines', 'directory'] });

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
  /**
   * Claims qty on one item. retentionRate is sent only when given (explicit configuration, see
   * contract.retention); the item's rate is then asserted on the answer (adjudication 087-COM item 1).
   */
  const claim = async (s, key, label, allocationKey, qty, retentionRate) => {
    const item = itemOf(await readPeriod(s, label), allocationKey);
    const rate = Number(item.rate);
    return s.act(`ipc.${key}.claim.${allocationKey}`, 'qs', 'PATCH', `${ipcRoute(label)}/items/${item.id}`, {
      qty,
      ...(retentionRate === undefined ? {} : { retentionRate }),
    }, {
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
  const invoice = async (s, key, label, invoiceDate, fields) => {
    const invoiceNumber = b.ref(`INV-${key}`);
    return s.create(`ipc.${key}.invoice`, 'finance', `${ipcRoute(label)}/invoice/issue`, {
      invoiceNumber,
      invoiceDate: b.past(invoiceDate),
      dueDate: lib.dates.addDays(invoiceDate, 30),
    }, {
      get: null, // re-read live by the step's ipcMoneyVerify
      fields,
      find: async (s2) => atMostOne((await readPeriod(s2, label)).invoices || [], (row) => row.invoiceNumber === invoiceNumber, `${label}: invoice ${invoiceNumber}`),
    });
  };
  /** A client payment; `moment` asserts the certificate in the payment's own answer (the moment it was paid). */
  const pay = async (s, key, label, n, amount, paymentDate, moment = {}) => {
    const reference = b.ref(`PAY-${key}-${n}`);
    return s.create(`ipc.${key}.pay.${n}`, 'finance', `${ipcRoute(label)}/payments`, {
      amount,
      paymentReference: reference,
      paymentDate: b.past(paymentDate),
      paymentMethod: 'bank_transfer',
      notes: `Client payment ${reference}`,
    }, {
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
  const expectTotals = (s, certificate, totals, label) => s.expectFields(certificate, Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, typeof v === 'number' ? is.cents(v) : v])), label);

  // IPC-01 — WP4.I1: retention not configured. Certification must refuse (HR-C1); at HEAD it settles at 0.
  const i1 = await b.step('ipc.I1', async (s) => {
    const label = period(1);
    await openPeriod(s, 'I1', label);
    let certificate = await readPeriod(s, label);
    const rates = [...new Set((certificate.items || []).map((item) => Number(item.retentionRate)))];
    // WP4.I1.currentCert: qty 400 x 100.00 = 40,000.00 (C-001 approved at 40%). retentionRate is NOT sent.
    await claim(s, 'I1', label, 'C-001.A220', 400);
    certificate = await readPeriod(s, label);
    const contract = await s.get('qs', `${b.P}/prime-contract`);
    const claimed = itemOf(certificate, 'C-001.A220');
    const observed = {
      itemRetentionRates: rates,
      claimedItem: { qty: 400, currentCert: Number(claimed.currentCert), retention: Number(claimed.retention) },
      draftTotals: { totalCert: Number(certificate.totalCert), totalRet: Number(certificate.totalRet), netPayable: Number(certificate.netPayable) },
      contractRetentionRate: contract.retentionRate,
    };
    // The answer book's `today` (WP4.I1.certifyUnconfigured.today): item rate 0, retention 0, net 40,000.00.
    const today = WP4.I1.certifyUnconfigured.today;
    s.assert(rates.length === 1 && rates[0] === today.itemRetentionRate, `every IPC-01 item carries the silent rate ${today.itemRetentionRate} from the unset project default (read ${rates.join(', ')})`);
    expectTotals(s, certificate, { totalCert: major(WP4.I1.currentCert), totalRet: today.retention / 100, netPayable: today.net / 100, status: 'draft' }, 'IPC-01 draft (WP4.I1.currentCert, certifyUnconfigured.today)');
    return { label, observed };
  }, { needs: ['allocations', 'progress', 'contract.value'] });
  // HR-C1 (owner decision): no silent rate; the refusing step and code are chosen by the fix
  // (WP4.I1.certifyUnconfigured, adjudication C2). Not sent: at HEAD it would certify at 0 and
  // leave a 40,000.00 certificate with no retention behind. IPC-01 stays a draft for the proof.
  if (i1) {
    b.blocked('ipc.I1.certify-unconfigured', 'HR-C1', {
      expected: 'refused: configuration required (code chosen by the HR-C1 fix)',
      today: 'certify would settle at the silent item rate 0: retention 0.00, net 40,000.00 (answer book WP4.I1.certifyUnconfigured.today)',
      observedOnTheDraft: i1.observed,
      notSent: 'certifying would leave an unconfigured certificate in the population; IPC-01 is left a draft',
    });
  }

  // Retention configured explicitly (deep.087-COM.contractRetentionRate 10; retentionCapRate 0.4,
  // advance 10% = 200,000.00 recovered at 10%: deep.087-COM.retentionCapRate / advance / advanceRecoveryRate).
  await b.step('contract.retention', async (s) => {
    const data = await s.act('contract.retention.configure', 'qs', 'PATCH', `${b.P}/prime-contract`, {
      retentionRate: RATE,
      retentionCapRate: D087.retentionCapRate.value,
      advanceRate: 10,
      advanceRecoveryRate: D087.advanceRecoveryRate.value,
      materialsOnSiteRate: 100,
      taxRate: 0,
    }, {
      fields: { retentionRate: RATE, retentionCapRate: D087.retentionCapRate.value, advanceAmount: asCents(D087.advance), advanceRecoveryRate: D087.advanceRecoveryRate.value, taxRate: 0 },
      verify: async (s2) => Number((await s2.get('qs', `${b.P}/prime-contract`)).retentionCapRate) === D087.retentionCapRate.value,
    });
    return { retentionRate: data.retentionRate, retentionCapRate: data.retentionCapRate, advanceAmount: data.advanceAmount };
  }, { needs: ['contract.after-CO-125'] });

  // IPC-02 — WP4.I7 cap: D-001 97,500.00 at 10% = 9,750.00, capped at 0.4% x 2,125,000 = 8,500.00; net 89,000.00. Paid.
  await b.step('ipc.02', async (s) => {
    const label = period(2);
    const draft = await openPeriod(s, '02', label);
    // L114 (adjudication 087-COM item 1): the first certificate after the contract rate was configured.
    // Its items are created at the project default (unset: 0), never the contract rate, so the answer
    // book's HEAD remedy (deep.087-COM.contractRetentionRate note) PATCHes RATE onto each claimed item.
    const before = Number(itemOf(draft, 'D-001.A200').retentionRate);
    if (before !== RATE) {
      s.finding('L114', `IPC-02, opened after 087-COM's prime contract retentionRate was configured at ${RATE}, creates its items at retentionRate ${before} (item D-001/A200 read before any claim): HEAD resolves the item rate from the project default (ipc.service.js:51-54 resolveRetentionRate, :779, :872), never the contract rate. As the answer book prescribes for HEAD (deep.087-COM.contractRetentionRate note), every configured 087-COM certificate PATCHes item retentionRate ${RATE}, and each claimed item's rate is asserted ${RATE} on the PATCH answer; after WP-4's HR-C1 fix the PATCH should become unnecessary.`);
    }
    await claim(s, '02', label, 'D-001.A200', 1000, RATE);
    expectTotals(s, await readPeriod(s, label), { totalCert: major(GROSS), totalRet: major(WP4.I7.totalRetCapped), netPayable: major(WP4.I7.netCapped) }, 'IPC-02 draft (WP4.I7.totalRetCapped / netCapped)');
    await transition(s, '02', label, 'submit', 'qs', {}, { status: 'submitted' }, ['submitted', 'certified', 'paid']);
    await transition(s, '02', label, 'certify', 'pm', { comment: `Certified against approved progress ${b.ref('IPC-02')}` }, { status: 'certified', totalCert: asCents(GROSS), totalRet: asCents(WP4.I7.totalRetCapped), netPayable: asCents(WP4.I7.netCapped) }, ['certified', 'paid']);
    await invoice(s, '02', label, '2026-04-10', { netAmount: asCents(WP4.I7.netCapped) });
    await pay(s, '02', label, 1, major(WP4.I7.netCapped), '2026-04-30');
    const end = await readPeriod(s, label);
    expectTotals(s, end, { status: 'paid', paymentStatus: 'paid', totalRet: major(WP4.I7.retentionCap), netPayable: major(WP4.I7.netCapped), balanceDue: 0 }, 'IPC-02 paid');
    return { label, itemRateBeforeClaim: before, status: end.status, totalRet: end.totalRet, netPayable: end.netPayable };
  }, { needs: ['contract.retention'], verify: ipcMoneyVerify(period(2)) });

  await b.step('contract.cap-off', async (s) => {
    // The cap stays on IPC-02 only, so I8's and I10's 9,750.00 retentions hold (WP4.I10.preconditions).
    await s.act('contract.cap-off', 'qs', 'PATCH', `${b.P}/prime-contract`, { retentionCapRate: null }, {
      fields: { retentionCapRate: null },
      verify: async (s2) => (await s2.get('qs', `${b.P}/prime-contract`)).retentionCapRate === null,
    });
    return { retentionCapRate: null };
  }, { needs: ['ipc.02'] });

  // IPC-03 — WP4.I8: A110 5,000 + A120 100 + A130 150 = 97,500.00, retention 9,750.00, net 87,750.00 (stage 10's
  // certificate). Its moments are asserted as they happen (G1, R2-9, R3-3): the over-balance payment refused, payFull,
  // the over-held release refused, the state after the release, the second payment. IPC-04 is drafted first on A130.
  await b.step('ipc.03', async (s) => {
    const I8 = WP4.I8;
    const RET = WP4.I7.itemRetention; // 10% x 97,500.00 = 9,750.00 (stage10.retention)
    const label = period(3);
    await openPeriod(s, '03', label);
    await claim(s, '03', label, 'B-001.A110', 5000, RATE);
    await claim(s, '03', label, 'B-002.A120', 100, RATE);
    await claim(s, '03', label, 'B-002.A130', 150, RATE);
    expectTotals(s, await readPeriod(s, label), { totalCert: major(GROSS), totalRet: major(RET), netPayable: major(I8.certifiedNet) }, 'IPC-03 draft (WP4.I8.certifiedNet)');
    // IPC-04 (WP4.I6, deep.087-COM.ipc04): 50 m3 more on A130 claimed while IPC-03 is an uncertified draft, so the
    // PATCH passes (it ignores other drafts) and certification later finds 22,500 + 7,500 = 30,000 > 22,500 earned.
    const X = D087.ipc04;
    const twin = period(4);
    await openPeriod(s, '04', twin);
    const twinClaim = await claim(s, '04', twin, 'B-002.A130', X.quantity.value, RATE);
    expectTotals(s, await readPeriod(s, twin), { totalCert: major(X.gross), totalRet: major(X.retention), netPayable: major(X.gross) - major(X.retention) }, 'IPC-04 draft (no advance received yet)');
    const twinSaid = b.state.records['ipc.04.claim.B-002.A130']?.said || '200 (adopted after an interruption)';
    s.finding('WP4-DRAFTS-1', `IPC-04's item PATCH on B-002/A130 (qty ${X.quantity.value} m3, currentCert ${Number(twinClaim?.currentCert ?? major(X.gross))}) answered ${twinSaid} while IPC-03, an uncertified draft, already claims 150 m3 (22,500.00) on the same allocation: together ${X.quantity.value + 150} m3 = 30,000.00 (WP4.I6.claimed) against 22,500.00 earned at 25% (WP4.I6.earnedCap). The item PATCH's progress check ignores other uncertified drafts (ipc.service.js:954-964); the certify gate catches the overage (IPC-04's PM override, step ipc.04). This two-draft set-up is how the build reaches WP4.I6, since one 200 m3 PATCH is refused at HEAD (WP4.I6.setupObstacle).`);
    await transition(s, '03', label, 'submit', 'qs', {}, { status: 'submitted' }, ['submitted', 'certified', 'paid']);
    await transition(s, '03', label, 'certify', 'finance', { comment: `Certified ${b.ref('IPC-03')}` }, { status: 'certified', totalCert: asCents(GROSS), totalRet: asCents(RET), netPayable: asCents(I8.certifiedNet) }, ['certified', 'paid']);
    await invoice(s, '03', label, '2026-05-10', { netAmount: asCents(I8.certifiedNet) });
    // WP4.I8.payOverBalance at its moment (balance 87,750.00, nothing paid): 87,750.01 refused, nothing written.
    const overPay = b.ref('PAY-03-OVER');
    await s.refused('ipc.03.pay.over', 'finance', 'POST', `${ipcRoute(label)}/payments`, {
      amount: major(I8.certifiedNet) + 0.01, paymentReference: overPay, paymentDate: b.past('2026-05-29'), paymentMethod: 'bank_transfer', notes: `Over the payable balance ${overPay}`,
    }, saidOf(I8.payOverBalance), {
      find: async (s2) => atMostOne((await readPeriod(s2, label)).payments || [], (row) => row.paymentReference === overPay, `${label}: payment ${overPay}`),
    });
    // WP4.I8.payFull / balanceDueAfterPay, in the payment's own answer.
    await pay(s, '03', label, 1, major(I8.certifiedNet), '2026-05-29', {
      'certificate.status': I8.payFull.value,
      'certificate.paymentStatus': I8.payFull.value,
      'certificate.balanceDue': asCents(I8.balanceDueAfterPay),
    });
    // WP4.I8.releaseOverHeld at its moment (9,750.00 held): 9,750.01 refused, nothing written.
    const overRelease = b.ref('RET-03-OVER');
    await s.refused('ipc.03.release.over', 'finance', 'POST', `${ipcRoute(label)}/retention-release`, {
      amount: major(RET) + 0.01, releaseReference: overRelease, releaseDate: b.past('2026-06-15'), reason: `Over the retention held ${overRelease}`,
    }, saidOf(I8.releaseOverHeld), {
      find: async (s2) => atMostOne((await readPeriod(s2, label)).retentionReleases || [], (row) => row.releaseReference === overRelease, `${label}: release ${overRelease}`),
    });
    // The whole 9,750.00 released; the state after it, asserted in the release's own answer (R2-9): paymentStatus
    // partially_paid and balanceDue 9,750.00 exactly; status the book's 'certified', or HEAD's 'paid' (its `today`, HR-C3).
    // The book's today is the sentence "paid (one-way, ...) while paymentStatus is partially_paid": its first word.
    const todayStatus = String(I8.afterReleaseStatus.today).split(/[\s(]/)[0];
    const reference = b.ref('RET-03');
    await s.create('ipc.03.release', 'finance', `${ipcRoute(label)}/retention-release`, {
      amount: major(RET),
      releaseReference: reference,
      releaseDate: b.past('2026-06-15'),
      reason: `Released on the taking-over certificate ${reference}`,
    }, {
      get: null, // re-read live by the step's ipcMoneyVerify
      idOf: (d) => d?.release?.id ?? null,
      fields: {
        'release.amount': asCents(RET),
        'certificate.paymentStatus': I8.afterReleasePaymentStatus.value,
        'certificate.balanceDue': asCents(I8.afterReleaseBalanceDue),
        'certificate.status': (v) => v === I8.afterReleaseStatus.value || v === todayStatus || `${I8.afterReleaseStatus.value} (WP4.I8.afterReleaseStatus) or HEAD's ${todayStatus} (its today, HR-C3)`,
      },
      find: async (s2) => {
        const certificate = await readPeriod(s2, label);
        const release = atMostOne(certificate.retentionReleases || [], (row) => row.releaseReference === reference, `${label}: release ${reference}`);
        return release ? { release, certificate } : null;
      },
    });
    const atRelease = b.state.records['ipc.03.release']?.data?.certificate || null;
    s.assert(Boolean(atRelease), 'the release answer (or its adoption) carries the certificate at that moment');
    if (atRelease.status === todayStatus && atRelease.status !== I8.afterReleaseStatus.value) {
      s.finding('HR-C3', `After IPC-03's 9,750.00 retention release the certificate reads status '${atRelease.status}' with paymentStatus '${atRelease.paymentStatus}' and balanceDue ${atRelease.balanceDue}: WP4.I8.afterReleaseStatus expects '${I8.afterReleaseStatus.value}' (status agreeing with paymentStatus), HEAD keeps 'paid' one-way (ipc.service.js:352-357; the book's today). paymentStatus and balanceDue are as the book says.`);
    }
    // WP4.I8.paySecond / amountPaidTotal, in the second payment's answer.
    await pay(s, '03', label, 2, major(I8.afterReleaseBalanceDue), '2026-06-30', {
      'certificate.status': I8.paySecond.value,
      'certificate.paymentStatus': I8.paySecond.value,
      'certificate.retentionStatus': 'released',
      'certificate.amountPaid': asCents(I8.amountPaidTotal),
    });
    const end = await readPeriod(s, label);
    expectTotals(s, end, { status: I8.paySecond.value, paymentStatus: I8.paySecond.value, retentionStatus: 'released', amountPaid: major(I8.amountPaidTotal), balanceDue: 0 }, 'IPC-03 paid with retention released');
    return {
      label,
      twin,
      afterRelease: { status: atRelease.status, paymentStatus: atRelease.paymentStatus, balanceDue: atRelease.balanceDue },
      status: end.status,
      amountPaid: end.amountPaid,
    };
  }, { needs: ['contract.cap-off'], verify: ipcMoneyVerify(period(3)) });

  // IPC-04 (WP4.I6, deep.087-COM.ipc04) is certified last, after IPC-08 (adjudication 087-COM item 3):
  // once A130 is certified over what progress earned, the review of every later certificate counts
  // that past overage and needs a PM override reason (WP4-OVR-1, observed on IPC-09 below).

  // IPC-05 — WP4.I7 tax (adjudication C7): taxRate 5 for this certificate only; 97,500 - 9,750 = 87,750; tax 4,387.50; net 92,137.50.
  await b.step('ipc.05', async (s) => {
    const label = period(5);
    await openPeriod(s, '05', label);
    await claim(s, '05', label, 'D-002.A210', 1000, RATE);
    if (['draft', 'submitted'].includes((await readPeriod(s, label)).status)) {
      await s.act('contract.tax-on', 'qs', 'PATCH', `${b.P}/prime-contract`, { taxRate: D087.taxRate.value }, {
        fields: { taxRate: D087.taxRate.value },
        verify: async (s2) => Number((await s2.get('qs', `${b.P}/prime-contract`)).taxRate) === D087.taxRate.value,
      });
    }
    await transition(s, '05', label, 'submit', 'qs', {}, { status: 'submitted' }, ['submitted', 'certified', 'paid']);
    await transition(s, '05', label, 'certify', 'pm', { comment: `Certified ${b.ref('IPC-05')}` }, { status: 'certified', taxAmount: asCents(WP4.I7.taxAmount), netPayable: asCents(WP4.I7.netWithTax) }, ['certified', 'paid']);
    await s.act('contract.tax-off', 'qs', 'PATCH', `${b.P}/prime-contract`, { taxRate: 0 }, {
      fields: { taxRate: 0 },
      verify: async (s2) => Number((await s2.get('qs', `${b.P}/prime-contract`)).taxRate) === 0,
    });
    await invoice(s, '05', label, '2026-07-10', { netAmount: asCents(WP4.I7.netWithTax) });
    const end = await readPeriod(s, label);
    expectTotals(s, end, { status: 'certified', taxRate: D087.taxRate.value, taxAmount: major(WP4.I7.taxAmount), totalRet: major(WP4.I7.itemRetention), netPayable: major(WP4.I7.netWithTax) }, 'IPC-05 (WP4.I7.taxAmount / netWithTax)');
    return { label, taxAmount: end.taxAmount, netPayable: end.netPayable };
  }, { needs: ['ipc.03'], verify: ipcMoneyVerify(period(5)) });

  // IPC-06 — stage 10's part-paid certificate: 97,500 / 9,750 / 87,750; the client pays 80,000 on 2026-09-15 (CF1 2026-09 inflow).
  await b.step('ipc.06', async (s) => {
    const label = period(6);
    await openPeriod(s, '06', label);
    await claim(s, '06', label, 'D-003.A230', 1000, RATE);
    await transition(s, '06', label, 'submit', 'qs', {}, { status: 'submitted' }, ['submitted', 'certified', 'paid']);
    await transition(s, '06', label, 'certify', 'finance', { comment: `Certified ${b.ref('IPC-06')}` }, { status: 'certified', netPayable: asCents(WP4.existing['stage10.net']) }, ['certified', 'paid']);
    await invoice(s, '06', label, '2026-09-01', { netAmount: asCents(WP4.existing['stage10.net']) });
    await pay(s, '06', label, 1, major(WP4.existing['stage10.received']), '2026-09-15');
    const end = await readPeriod(s, label);
    // WP4.existing stage10.received 80,000 / outstanding 7,750.00.
    expectTotals(s, end, { status: 'certified', paymentStatus: 'partially_paid', amountPaid: major(WP4.existing['stage10.received']), balanceDue: major(WP4.existing['stage10.outstanding']) }, 'IPC-06 part-paid');
    return { label, balanceDue: end.balanceDue };
  }, { needs: ['ipc.05'], verify: ipcMoneyVerify(period(6)) });

  // IPC-07 — WP4.I10: materials on site 5,000: gross 102,500, retention 9,750, net 92,750 (no deduction, recovery or tax).
  await b.step('ipc.07', async (s) => {
    const I10 = WP4.I10;
    const label = period(7);
    await openPeriod(s, '07', label);
    await claim(s, '07', label, 'D-004.A300', 1000, RATE);
    if ((await readPeriod(s, label)).status === 'draft') {
      await s.act('ipc.07.materials', 'qs', 'PATCH', `${ipcRoute(label)}/adjustments`, { materialsOnSite: major(I10.materialsOnSite), materialsAtCost: major(I10.materialsOnSite) }, {
        fields: { materialsOnSite: asCents(I10.materialsOnSite) },
        verify: async (s2) => lib.sameCents((await readPeriod(s2, label)).materialsOnSite, major(I10.materialsOnSite)),
      });
    }
    expectTotals(s, await readPeriod(s, label), { grossThisPeriod: major(I10.gross), totalRet: major(I10.retentionHeld), netPayable: major(I10.net) }, 'IPC-07 draft (WP4.I10.gross / net)');
    await transition(s, '07', label, 'submit', 'qs', {}, { status: 'submitted' }, ['submitted', 'certified', 'paid']);
    await transition(s, '07', label, 'certify', 'pm', { comment: `Certified ${b.ref('IPC-07')}` }, { status: 'certified', netPayable: asCents(I10.net) }, ['certified', 'paid']);
    const end = await readPeriod(s, label);
    expectTotals(s, end, { status: 'certified', grossThisPeriod: major(I10.gross), materialsOnSite: major(I10.materialsOnSite), totalRet: major(I10.retentionHeld), advanceRecovery: 0, taxAmount: 0, netPayable: major(I10.net) }, 'IPC-07');
    return { label, grossThisPeriod: end.grossThisPeriod, netPayable: end.netPayable };
  }, { needs: ['ipc.06'] });

  // The advance: 200,000.00 received on 2026-07-01 (WP4.CF2.advanceInflow; deep.087-COM.advance).
  const advanceRef = b.ref('ADV-1');
  const advanceRow = async (s) => atMostOne(listOf(await s.get('finance', `${b.P}/prime-contract/advances`)), (r) => r.reference === advanceRef, `advance receipt ${advanceRef}`);
  await b.step('contract.advance', async (s) => {
    const data = await s.create('contract.advance', 'finance', `${b.P}/prime-contract/advances`, {
      amount: major(D087.advance),
      reference: advanceRef,
      occurredAt: b.past('2026-07-01'),
      note: `Advance received against the advance payment guarantee ${advanceRef}`,
    }, {
      get: `${b.P}/prime-contract`,
      fields: { advancePaidAmount: asCents(D087.advance) },
      find: async (s2) => ((await advanceRow(s2)) ? s2.get('finance', `${b.P}/prime-contract`) : null),
    });
    const row = await advanceRow(s);
    s.assert(Boolean(row) && lib.sameCents(row.amount, major(D087.advance)), 'the advance receipt is in the advance ledger at 200,000.00');
    return { reference: advanceRef, advanceRowId: row.id, advancePaidAmount: data.advancePaidAmount };
  }, {
    needs: ['ipc.07'],
    // The ledger row itself, live (the create's read-back is the contract).
    verify: async (s, out) => ((await advanceRow(s))?.id === out.advanceRowId) || `the advance receipt ${out.advanceRowId} is gone`,
  });

  // IPC-08 — WP4.I7 advance: 97,500 - 9,750 retention - 9,750 recovery (10% of gross, outstanding 200,000) = 78,000.00.
  await b.step('ipc.08', async (s) => {
    const label = period(8);
    await openPeriod(s, '08', label);
    await claim(s, '08', label, 'D-005.A330', 1000, RATE);
    expectTotals(s, await readPeriod(s, label), { totalRet: major(WP4.I7.itemRetention), advanceRecovery: major(WP4.I7.advanceRecovery), netPayable: major(WP4.I7.netWithAdvance) }, 'IPC-08 draft (WP4.I7.advanceRecovery / netWithAdvance)');
    await transition(s, '08', label, 'submit', 'qs', {}, { status: 'submitted' }, ['submitted', 'certified', 'paid']);
    await transition(s, '08', label, 'certify', 'pm', { comment: `Certified ${b.ref('IPC-08')}` }, { status: 'certified', advanceRecovery: asCents(WP4.I7.advanceRecovery), netPayable: asCents(WP4.I7.netWithAdvance) }, ['certified', 'paid']);
    const contract = await s.get('finance', `${b.P}/prime-contract`);
    s.expectFields(contract, { advanceRecoveredAmount: asCents(WP4.I7.advanceRecovery), advanceOutstanding: asCents(D087.ipc04.advanceOutstandingBefore) }, 'the advance after IPC-08');
    return { label, advanceRecovery: contract.advanceRecoveredAmount, advanceOutstanding: contract.advanceOutstanding };
  }, { needs: ['contract.advance'] });

  // IPC-04 — WP4.I6 and deep.087-COM.ipc04: A130 over earned by 7,500.00 (22,500 earned at 25%, 30,000 certified);
  // without a reason 400, finance 403, the PM with a reason certifies. Certified after IPC-08, so the advance
  // recovery is in force: 7,500.00 - 750.00 retention - 750.00 recovery = 6,000.00 (deep.087-COM.ipc04.net).
  await b.step('ipc.04', async (s) => {
    const I6 = WP4.I6;
    const X = D087.ipc04;
    const label = period(4);
    await transition(s, '04', label, 'submit', 'qs', {}, { status: 'submitted' }, ['submitted', 'certified', 'paid']);
    let before = null;
    if ((await readPeriod(s, label)).status === 'submitted') {
      // deep.087-COM.ipc04.advanceOutstandingBefore at its moment: IPC-08's recovery locked, IPC-04 not yet certified.
      before = await s.get('finance', `${b.P}/prime-contract`);
      s.expectFields(before, { advanceOutstanding: asCents(X.advanceOutstandingBefore) }, 'the advance before IPC-04 (deep.087-COM.ipc04.advanceOutstandingBefore)');
      // An interrupted probe is found by what a wrongly accepted one would have made: a certified IPC-04.
      const certifiedNow = async (s2) => {
        const c = await readPeriod(s2, label);
        return ['certified', 'paid'].includes(c.status) ? c : null;
      };
      await s.refused('ipc.04.certify.no-reason', 'pm', 'POST', `${ipcRoute(label)}/certify`, { comment: b.ref('IPC-04') }, saidOf(I6.noReason), { find: certifiedNow });
      await s.refused('ipc.04.certify.finance', 'finance', 'POST', `${ipcRoute(label)}/certify`, { comment: b.ref('IPC-04'), overrideReason: `Finance tries the override ${b.ref('IPC-04')}` }, saidOf(I6.financeWithReason), { find: certifiedNow });
    }
    await transition(s, '04', label, 'certify', 'pm', {
      comment: `Certified ahead of the progress record ${b.ref('IPC-04')}`,
      overrideReason: `PM override: the last lift was measured after the progress cut-off ${b.ref('IPC-04')}`,
    }, { status: I6.pmWithReason.value, overCertificationAmount: asCents(X.overCertificationAmount), certificationOverrideReason: is.present }, [I6.pmWithReason.value, 'paid']);
    const end = await readPeriod(s, label);
    expectTotals(s, end, {
      status: I6.pmWithReason.value,
      overCertificationAmount: major(X.overCertificationAmount),
      totalCert: major(X.gross),
      grossThisPeriod: major(X.gross),
      totalRet: major(X.retention),
      advanceRecovery: major(X.advanceRecovery),
      deductions: major(X.deductions),
      taxAmount: major(X.taxAmount),
      netPayable: major(X.net),
    }, 'IPC-04 (deep.087-COM.ipc04)');
    s.assert(Number(itemOf(end, 'B-002.A130').qty) === X.quantity.value, `IPC-04's A130 item holds deep.087-COM.ipc04.quantity ${X.quantity.value} m3`);
    const after = await s.get('finance', `${b.P}/prime-contract`);
    s.expectFields(after, { advanceOutstanding: is.cents(major(X.advanceOutstandingBefore) - major(X.advanceRecovery)) }, 'the advance after IPC-04 (outstanding before less ipc04.advanceRecovery)');
    return { label, overCertificationAmount: end.overCertificationAmount, netPayable: end.netPayable, advanceOutstandingBefore: before ? before.advanceOutstanding : null, advanceOutstandingAfter: after.advanceOutstanding };
  }, { needs: ['ipc.08'] });

  /** A certificate's totals against a deep.087-COM.ipcNN leaf set (round 2 R2-B: every figure is a book key). */
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

  // IPC-09 — submitted, with a deduction (plan §3.2 "with a deduction"; kept off IPC-07 by WP4.I10.preconditions). Every
  // figure is deep.087-COM.ipc09 (A310 500 m2 x 45.00 = 22,500.00; retention 2,250.00; recovery 2,250.00 against the
  // 189,500.00 outstanding; deduction 1,000.00; tax 0.00; net 17,000.00). WP4-OVR-1 is observed on it (adjudication 087-COM
  // item 3) from its certification review, read through GET, never by certifying it (round 2 R2-F): IPC-09 stays submitted.
  await b.step('ipc.09', async (s) => {
    const X = D087.ipc09;
    const label = period(9);
    await openPeriod(s, '09', label);
    await claim(s, '09', label, 'B-004.A310', X.quantity.value, RATE);
    if ((await readPeriod(s, label)).status === 'draft') {
      await s.act('ipc.09.deduction', 'qs', 'PATCH', `${ipcRoute(label)}/adjustments`, { deductions: major(X.deductions), deductionsNote: `Back-charge: damaged kerbs reinstated by others ${b.ref('IPC-09')}` }, {
        fields: { deductions: asCents(X.deductions) },
        verify: async (s2) => lib.sameCents((await readPeriod(s2, label)).deductions, major(X.deductions)),
      });
    }
    await transition(s, '09', label, 'submit', 'qs', {}, { status: 'submitted' }, ['submitted', 'certified', 'paid']);
    // deep.087-COM.ipc09.advanceOutstandingBefore at its moment: IPC-08 and IPC-04 certified, IPC-09 not.
    const contract = await s.get('finance', `${b.P}/prime-contract`);
    s.expectFields(contract, { advanceOutstanding: asCents(X.advanceOutstandingBefore) }, 'the advance before IPC-09 (deep.087-COM.ipc09.advanceOutstandingBefore)');
    const end = await readPeriod(s, label);
    expectTotals(s, end, bookTotals(X), 'IPC-09 submitted (deep.087-COM.ipc09)');
    s.assert(Number(itemOf(end, 'B-004.A310').qty) === X.quantity.value, `IPC-09's A310 item holds deep.087-COM.ipc09.quantity ${X.quantity.value} m2`);
    const a130 = itemOf(end, 'B-002.A130');
    s.assert(lib.sameCents(a130.currentCert, 0), 'IPC-09 claims nothing on A130');
    // WP4-OVR-1 (R2-F): the review the certify gate applies, as GET /ipc/:period serves it (enrichIpcCertificateReview).
    const review = end.certificationReview;
    s.assert(Boolean(review) && typeof review.requiresPmOverride === 'boolean', `GET ${label} carries certificationReview.requiresPmOverride (read ${JSON.stringify(review ?? null).slice(0, 200)})`);
    const a130Review = a130.certificationReview || {};
    const observed = {
      requiresPmOverride: review.requiresPmOverride,
      overrideLineCount: review.overrideLineCount,
      overEarnedAmount: review.overEarnedAmount,
      a130: { currentClaimedAmount: a130Review.currentClaimedAmount, previousCertifiedAmount: a130Review.previousCertifiedAmount, earnedAmount: a130Review.earnedAmount, overEarnedAmount: a130Review.overEarnedAmount, requiresOverride: a130Review.requiresOverride },
    };
    if (review.requiresPmOverride === true) {
      s.finding('WP4-OVR-1', `IPC-09, submitted, reads certificationReview.requiresPmOverride true (overrideLineCount ${observed.overrideLineCount}, overEarnedAmount ${observed.overEarnedAmount}) on GET /ipc/:period, although it claims only A310 (${money(X.gross.value)}, within earned) and nothing on A130. A130's item review: currentClaimedAmount ${observed.a130.currentClaimedAmount}, previousCertifiedAmount ${observed.a130.previousCertifiedAmount}, earnedAmount ${observed.a130.earnedAmount}, overEarnedAmount ${observed.a130.overEarnedAmount}, requiresOverride ${observed.a130.requiresOverride}. After IPC-04's PM override certified A130 to 30,000.00 against 22,500.00 earned, every later certificate's review counts that past overage on the allocated item even when its current claim is 0 (ipc.service.js:556, :579-582); the certify gate applies the same review (:1329-1348), so a certification without a reason would be refused 400 IPC_PM_OVERRIDE_REASON_REQUIRED and finance's 403 IPC_PM_OVERRIDE_REQUIRED. Observed by reading, never by certifying: IPC-09 stays submitted (round 2 R2-F). IPC-09 / IPC-10 need a PM override reason in the WP-4 proofs; the build certifies IPC-04 last for this reason (adjudication 087-COM item 3).`);
    }
    return { label, netPayable: end.netPayable, advanceOutstandingBefore: contract.advanceOutstanding, overrideReview: observed };
  }, { needs: ['ipc.04'] });

  // IPC-10 — a draft: every figure is deep.087-COM.ipc10 (A320 1,000 m2 x 18.00 = 18,000.00; retention 1,800.00; recovery
  // 1,800.00; net 14,400.00, the preview). IPC-09, submitted, locks no recovery, so the outstanding is IPC-09's.
  await b.step('ipc.10', async (s) => {
    const X = D087.ipc10;
    const label = period(10);
    await openPeriod(s, '10', label);
    await claim(s, '10', label, 'B-005.A320', X.quantity.value, RATE);
    const contract = await s.get('finance', `${b.P}/prime-contract`);
    s.expectFields(contract, { advanceOutstanding: asCents(X.advanceOutstandingBefore) }, 'the advance with IPC-09 submitted (deep.087-COM.ipc10.advanceOutstandingBefore)');
    const end = await readPeriod(s, label);
    expectTotals(s, end, bookTotals(X), 'IPC-10 draft (deep.087-COM.ipc10)');
    s.assert(Number(itemOf(end, 'B-005.A320').qty) === X.quantity.value, `IPC-10's A320 item holds deep.087-COM.ipc10.quantity ${X.quantity.value} m2`);
    return { label, netPayable: end.netPayable, advanceOutstandingBefore: contract.advanceOutstanding };
  }, { needs: ['ipc.09'] });

  // ── prime COs after the cap certificate: the E4 split, the I3 allocation link, the RFI one ──
  // WP4.E4: 10,000 split 6,000 on 01-100 and 4,000 on 02-100; approved.
  await primeCo('CO-SPLIT', {
    value: major(WP4.E4.revisedDelta),
    activity: 'A120',
    extra: { budgetAllocations: [{ budgetLineId: lineId('01-100', 'labour'), amount: major(WP4.E4.split01_100) }, { budgetLineId: lineId('02-100', 'material'), amount: major(WP4.E4.split02_100) }] },
    to: 'approved',
  });
  // WP4.I3: 7,500 approved with allocationLinks [{A120, qty 50, amount 7,500}] on the split B-002 row
  // (A120LimitAmount 37,500.00 = the A120 allocation 30,000.00 + 7,500.00). The CO's value is the book's
  // deep.087-COM.contractEnd entry for CO-I3 (round 3 R3-3), which the book derives from those two keys.
  const contractEndCo = (key) => one([...D087.contractEnd.approvedChanges.value, ...D087.contractEnd.pendingChanges.value, ...D087.contractEnd.notCounted.value], (row) => row.co === key, `deep.087-COM.contractEnd: CO ${key}`);
  const coI3Value = contractEndCo('CO-I3').amount / 100;
  await primeCo('CO-I3', {
    value: coI3Value,
    activity: 'A120',
    budgetLine: lineId('02-100', 'material'),
    extra: { allocationLinks: [{ allocationId: allocId('B-002.A120'), quantity: WP4.I3.A120LimitQuantity.value - 200, amount: coI3Value, notes: b.ref('CO-I3') }] },
    to: 'approved',
  });
  // WP4.rfiCo: an RFI's 4,500 cost impact converted to a draft CO, then approved.
  await b.step('co.RFI', async (s) => {
    const subject = b.name('RFI founding level at grid A-D');
    const raised = await s.create('rfi', 'site', `${b.P}/rfi`, {
      subject,
      question: `Borehole BH-3 shows the competent stratum 150 mm below the founding level. Lower the level or thicken the pad? ${b.ref('RFI')}`,
      priority: 'high',
      discipline: 'structural',
      managerUserId: await b.userId('pm'),
      assigneeUserIds: [await b.userId('planner')],
      distributionUserIds: [await b.userId('qs')],
      activityId: A.A130,
      costImpact: true,
      costImpactAmount: major(WP4.rfiCo.value),
      scheduleImpactFlag: false,
      raisedDate: b.past('2026-03-02'),
      responseRequiredBy: '2026-03-09',
    }, {
      fields: { subject },
      adopt: true,
      find: async (s2) => atMostOne(listOf(await s2.get('site', `${b.P}/rfi?limit=100&includeArchived=true&search=${encodeURIComponent('founding level')}`)), (row) => row.subject === subject, `RFI ${subject}`),
    });
    const rfiId = raised.id;
    const rfiNow = async (s2) => s2.get('site', `${b.P}/rfi/${rfiId}`);
    if ((await rfiNow(s)).status === 'draft' || pendingRecord('rfi.submit')) {
      await s.act('rfi.submit', 'site', 'POST', `${b.P}/rfi/${rfiId}/submit`, {}, { fields: { status: 'open' }, verify: async (s2) => (await rfiNow(s2)).status !== 'draft' });
    }
    if ((await rfiNow(s)).status === 'open' || pendingRecord('rfi.answer')) {
      await s.act('rfi.answer', 'planner', 'POST', `${b.P}/rfi/${rfiId}/answer`, { response: `Lower the founding level by 150 mm at grid A-D; instructed as a variation ${b.ref('RFI')}`, answeredDate: b.past('2026-03-06') }, {
        fields: { status: 'answered' },
        verify: async (s2) => (await rfiNow(s2)).status !== 'open',
      });
    }
    const description = `${b.name('Variation from the RFI')}: additional excavation and blinding`;
    let coId = (await rfiNow(s)).changeOrderId;
    if (!coId || b.state.records['rfi.convert']?.status === 'pending') {
      const converted = await s.create('rfi.convert', 'pm', `${b.P}/rfi/${rfiId}/convert-to-change`, { description, category: 'client_instruction', value: major(WP4.rfiCo.value) }, {
        expect: [200, 201],
        get: coRegisterRoute,
        idOf: (d) => d?.changeOrder?.id ?? d?.id ?? null,
        // WP4.rfiCo.createdAs draft / value 4,500.00.
        fields: { status: (v, d) => (d?.changeOrder?.status ?? d?.status) === WP4.rfiCo.createdAs.value || 'a draft change order' },
        // Adopted from the register row of the CO the RFI names (its live status asserted), never a made-up object.
        find: async (s2) => {
          const id = (await rfiNow(s2)).changeOrderId;
          if (!id) return null;
          const row = await coById(s2, id);
          s2.assert(Boolean(row), `the RFI names change order ${id}, which is in the register`);
          return row;
        },
      });
      coId = converted?.changeOrder?.id ?? converted?.id;
    }
    const docs = await C.attach(s, 'co.RFI.instruction', 'qs', 'change_order', coId, 'RFI response and instruction');
    await s.act('co.RFI.approvable', 'qs', 'PATCH', `${b.P}/change-orders/${coId}`, {
      budgetLineId: lineId('01-100', 'labour'),
      scheduleImpactSummary: `No programme effect (${b.ref('RFI')})`,
      costImpactSummary: `4,500.00 for 150 mm additional excavation and blinding per the RFI response (${b.ref('RFI')})`,
      activityLinks: [{ activityId: A.A130, relationType: 'impacted', scheduleImpactDays: 0, costImpact: major(WP4.rfiCo.value), notes: b.ref('RFI') }],
      documentIds: [docs.documentId],
    }, { fields: { id: coId }, verify: async (s2) => Boolean((await coById(s2, coId))?.costImpactSummary) });
    if ((await coById(s, coId)).status === 'draft' || pendingRecord('co.RFI.submit')) {
      await s.act('co.RFI.submit', 'qs', 'POST', `${b.P}/change-orders/${coId}/submit`, { comment: `From the RFI ${b.ref('RFI')}` }, { fields: { status: 'pending' }, verify: async (s2) => (await coById(s2, coId)).status !== 'draft' });
    }
    if ((await coById(s, coId)).status === 'pending' || pendingRecord('co.RFI.approve')) {
      await s.act('co.RFI.approve', 'pm', 'POST', `${b.P}/change-orders/${coId}/approve`, { comment: `Approved ${b.ref('RFI')}` }, { fields: { status: 'approved' }, verify: async (s2) => (await coById(s2, coId)).status === 'approved' });
    }
    const row = await coById(s, coId);
    s.expectFields(row, { status: 'approved', value: asCents(WP4.rfiCo.value) }, 'the RFI change order');
    return { rfiId, changeOrderId: coId };
  }, { needs: ['ipc.10'] });

  // The contract once every prime CO exists: every figure is deep.087-COM.contractEnd (round 3 R3-3): approved 147,000.00
  // (CO-125, CO-SPLIT, CO-I3, CO-RFI), pending 49,500.00 (CO-40 pending, E1's draft), revised 2,147,000.00; CO-REJ and
  // CO-ARC in neither. The composition is read live: each listed CO by the id this build recorded for it.
  await b.step('contract.after-cos', async (s) => {
    const X = D087.contractEnd;
    const contract = await s.get('qs', `${b.P}/prime-contract`);
    s.expectFields(contract, {
      approvedChangesValue: asCents(X.approvedChangesValue),
      pendingChangesValue: asCents(X.pendingChangesValue),
      revisedValue: asCents(X.revisedValue),
    }, 'contract after every prime CO (deep.087-COM.contractEnd)');
    const idOf = {
      'CO-125': b.out('co.CO-125').id,
      'CO-40': b.out('co.CO-40').id,
      'CO-REJ': b.out('co.CO-REJ').id,
      'CO-ARC': b.out('co.CO-ARC').id,
      'CO-SPLIT': b.out('co.CO-SPLIT').id,
      'CO-I3': b.out('co.CO-I3').id,
      'CO-RFI': b.out('co.RFI').changeOrderId,
      'CO-E1': b.out('ce.E1').changeOrderId,
    };
    const register = await coRegister(s);
    const rowOf = (entry) => {
      s.assert(Boolean(idOf[entry.co]), `${entry.co}: this build recorded its change order (deep.087-COM.contractEnd)`);
      return one(register, (row) => row.id === idOf[entry.co], `the register row of ${entry.co}`);
    };
    // Each listed CO, live: the book's status and amount, archived only when the book says so.
    for (const [list, entries] of [['approvedChanges', X.approvedChanges.value], ['pendingChanges', X.pendingChanges.value], ['notCounted', X.notCounted.value]]) {
      for (const entry of entries) {
        s.expectFields(rowOf(entry), { status: entry.status, value: is.cents(entry.amount / 100), archivedAt: entry.status === 'archived' ? is.present : is.absent }, `deep.087-COM.contractEnd.${list}: ${entry.co}`);
      }
    }
    // The counted sets hold nothing else: the register's approved and draft/pending rows with archivedAt null are exactly the
    // book's lists (APPROVED_CHANGE_STATUSES / PENDING_CHANGE_STATUSES, prime-contract.service.js:35-37, 288-295).
    const live = register.filter((row) => !row.archivedAt);
    const sameSet = (rows, entries, what) => {
      const expected = new Set(entries.map((entry) => idOf[entry.co]));
      s.assert(rows.length === entries.length && rows.every((row) => expected.has(row.id)), `${what} are exactly the book's ${entries.map((entry) => entry.co).join(', ')} (read ${rows.length}: ${rows.map((row) => row.ref).join(', ')})`);
    };
    sameSet(live.filter((row) => row.status === 'approved'), X.approvedChanges.value, 'the approved, unarchived prime COs');
    sameSet(live.filter((row) => ['draft', 'pending'].includes(row.status)), X.pendingChanges.value, 'the draft and pending, unarchived prime COs');
    return { approvedChangesValue: contract.approvedChangesValue, pendingChangesValue: contract.pendingChangesValue, revisedValue: contract.revisedValue, changeOrders: idOf };
  }, { needs: ['co.CO-125', 'co.CO-40', 'co.CO-REJ', 'co.CO-ARC', 'co.CO-SPLIT', 'co.CO-I3', 'co.RFI', 'ce.E1'] });

  // ── commitments, commitment COs, pay applications ──
  const commitmentGet = (s, id) => s.get('qs', `${b.P}/commitments/${id}`);
  const commitment = (key, { vendor, type = 'subcontract', retentionRate = RATE, lines, insurance = null }) =>
    b.step(`commitment.${key}`, async (s) => {
      const title = b.name(`${type === 'purchase_order' ? 'Supply commitment' : 'Subcontract'} ${key}`);
      const original = lines.reduce((sum, l) => sum + (l.amount ?? l.qty * l.rate), 0);
      const made = await s.create(`commitment.${key}`, 'qs', `${b.P}/commitments`, {
        type,
        title,
        description: `${title} as tendered`,
        vendorCompanyId: companyId(vendor),
        // Explicit, never the silent `defaultRetentionRate ?? 5` (WP4.C3.noDefaultNoRate, HR-C1).
        retentionRate,
        paymentTerms: `30 days from certification ${b.ref(key)}`,
        startDate: '2026-02-02',
        endDate: '2027-05-28',
        lines,
      }, {
        fields: {
          title,
          status: 'draft',
          retentionRate,
          original: is.cents(original),
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
      return { id: made.id, ref: read.ref, title, sovLines: read.lines.map((l) => ({ id: l.id, activityId: l.activityId, amount: l.amount, description: l.description })), insuranceDocumentId: documentId };
    }, { needs: ['budget-lines', 'activities', 'directory'] });
  const commitmentTo = async (s, key, id, target) => {
    const status = async () => (await commitmentGet(s, id)).status;
    if (((await status()) === 'draft' || pendingRecord(`commitment.${key}.submit`)) && ['pending', 'approved', 'executed'].includes(target)) {
      await s.act(`commitment.${key}.submit`, 'qs', 'POST', `${b.P}/commitments/${id}/submit`, {}, { fields: { status: 'pending' }, verify: async () => (await status()) !== 'draft' });
    }
    if (((await status()) === 'pending' || pendingRecord(`commitment.${key}.approve`)) && ['approved', 'executed'].includes(target)) {
      await s.act(`commitment.${key}.approve`, 'pm', 'POST', `${b.P}/commitments/${id}/approve`, {}, { fields: { status: 'approved' }, verify: async () => ['approved', 'executed'].includes(await status()) });
    }
  };
  const executeWithFile = async (s, key, id) => {
    if ((await commitmentGet(s, id)).status === 'executed' && b.state.records[`commitment.${key}.execute`]?.status !== 'pending') return;
    await s.upload(`commitment.${key}.execute`, 'pm', `${b.P}/commitments/${id}/execute`, C.pdf(`Signed agreement ${key} ${b.code}`, b.file(`${key}-signed.pdf`)), {
      expect: 200,
      get: () => `${b.P}/commitments/${id}`,
      fields: { status: 'executed', executedDocument: is.present },
      find: async (s2) => ((await commitmentGet(s2, id)).status === 'executed' ? commitmentGet(s2, id) : null),
    });
  };
  const sovLine = (out, activity, key) => one(out.sovLines, (l) => l.activityId === A[activity], `${key}: the SOV line on ${activity}`);

  // SC-001: blockwork 2,000 m2 @ 50 = 100,000.00 on A310, required insurance on file (stage 5's subcontract; the
  // commitment WP4.C2 reads, 100,000.00 executed -> 110,000.00 once the +10,000 CO is approved: R2-6).
  const sc1 = await commitment('SC-001', {
    vendor: 'subA',
    lines: [{ description: `Blockwork walls 200mm ${b.ref('SC-001-L1')}`, costCodeId: codeId('03-100'), budgetLineId: lineId('03-100', 'subcontract'), boqItemId: boq.ids['B-004'], activityId: A.A310, unit: 'm2', qty: 2000, rate: 50 }],
    insurance: { type: 'general_liability', label: 'Public liability', withDocument: true },
  });
  await b.step('commitment.SC-001.execute', async (s) => {
    await commitmentTo(s, 'SC-001', sc1.id, 'executed');
    await executeWithFile(s, 'SC-001', sc1.id);
    const row = await commitmentGet(s, sc1.id);
    // WP4.C2.committedExecuted at its moment (no CO yet); stage 5's commitment.original.
    s.expectFields(row, { status: STAGE5['commitment.execute'].value, original: asCents(STAGE5['commitment.original']), revised: asCents(WP4.C2.committedExecuted), insuranceReady: true }, 'SC-001 executed (WP4.C2.committedExecuted)');
    return { status: row.status, revised: row.revised };
  }, { needs: ['commitment.SC-001'] });

  // SC-002: executed on a PM override (the required bond missing).
  const sc2 = await commitment('SC-002', {
    vendor: 'subB',
    lines: [{ description: `MEP first fix ${b.ref('SC-002-L1')}`, costCodeId: codeId('03-100'), budgetLineId: lineId('03-100', 'subcontract'), activityId: A.A230, unit: 'ls', qty: 1, amount: 50000 }],
    insurance: { type: 'bond', label: 'Performance bond', withDocument: false },
  });
  await b.step('commitment.SC-002.execute', async (s) => {
    await commitmentTo(s, 'SC-002', sc2.id, 'executed');
    if ((await commitmentGet(s, sc2.id)).status === 'approved' || b.state.records['commitment.SC-002.execute']?.status === 'pending') {
      const signed = await C.attach(s, 'commitment.SC-002.signed', 'pm', 'commitment', sc2.id, 'Signed agreement SC-002');
      // WP4.C1.insuranceMissing and overrideWithoutReason, then the override with its reason.
      // An interrupted probe is found by what a wrongly accepted one would have made: an executed SC-002.
      const executedNow = async (s2) => {
        const c = await commitmentGet(s2, sc2.id);
        return c.status === 'executed' ? c : null;
      };
      await s.refused('commitment.SC-002.execute.no-override', 'pm', 'POST', `${b.P}/commitments/${sc2.id}/execute`, { documentId: signed.documentId }, saidOf(WP4.C1.insuranceMissing), { named: false, find: executedNow });
      await s.refused('commitment.SC-002.execute.no-reason', 'pm', 'POST', `${b.P}/commitments/${sc2.id}/execute`, { documentId: signed.documentId, override: true }, saidOf(WP4.C1.overrideWithoutReason), { named: false, find: executedNow });
      await s.act('commitment.SC-002.execute', 'pm', 'POST', `${b.P}/commitments/${sc2.id}/execute`, { documentId: signed.documentId, override: true, overrideReason: `Bond to follow within 14 days ${b.ref('SC-002')}` }, {
        fields: { status: 'executed' },
        verify: async (s2) => (await commitmentGet(s2, sc2.id)).status === 'executed',
      });
    }
    const row = await commitmentGet(s, sc2.id);
    s.expectFields(row, { status: 'executed', insuranceReady: false, original: is.cents(50000) }, 'SC-002 executed with the bond missing');
    return { status: row.status };
  }, { needs: ['commitment.SC-002'] });

  // SC-003: the closeout-gate subcontract (WP4.P6): one line on A110 (100% approved), claimed in full.
  const sc3 = await commitment('SC-003', {
    vendor: 'subC',
    lines: [{ description: `Site clearance ${b.ref('SC-003-L1')}`, costCodeId: codeId('03-100'), budgetLineId: lineId('03-100', 'subcontract'), activityId: A.A110, unit: 'ls', qty: 1, amount: 10000 }],
  });
  await b.step('commitment.SC-003.execute', async (s) => {
    await commitmentTo(s, 'SC-003', sc3.id, 'executed');
    await executeWithFile(s, 'SC-003', sc3.id);
    s.expectFields(await commitmentGet(s, sc3.id), { status: 'executed', original: is.cents(10000) }, 'SC-003');
    return { status: 'executed' };
  }, { needs: ['commitment.SC-003'] });

  // SC-004: internal plaster 4,000 m2 @ 25 = 100,000.00 on A320 (100% approved): stage 5's 60,000 claim (PA-02) and
  // the open applications (PA-03, PA-04). Split off SC-001 so that SC-001 is the 100,000.00 commitment WP4.C2 reads.
  const sc4 = await commitment('SC-004', {
    vendor: 'subA',
    lines: [{ description: `Internal plaster ${b.ref('SC-004-L1')}`, costCodeId: codeId('03-100'), budgetLineId: lineId('03-100', 'subcontract'), boqItemId: boq.ids['B-005'], activityId: A.A320, unit: 'm2', qty: 4000, rate: 25 }],
  });
  await b.step('commitment.SC-004.execute', async (s) => {
    await commitmentTo(s, 'SC-004', sc4.id, 'executed');
    await executeWithFile(s, 'SC-004', sc4.id);
    s.expectFields(await commitmentGet(s, sc4.id), { status: 'executed', original: is.cents(100000) }, 'SC-004');
    return { status: 'executed' };
  }, { needs: ['commitment.SC-004'] });

  // PC-001: a PO commitment with the supplier whose SOV line names cost code 02-100 only (no budget line), while
  // 02-100 holds both a material and a subcontract line: WP4.C4's L108 shape (R2-5); its 1,000.00 application below.
  const pc1 = await commitment('PC-001', {
    vendor: 'supplier',
    type: 'purchase_order',
    retentionRate: 0,
    lines: [{ description: `Cement supply ${b.ref('PC-001-L1')}`, costCodeId: codeId('02-100'), activityId: A.A130, unit: 'bag', qty: 2000, rate: 10 }],
  });
  await b.step('commitment.PC-001.execute', async (s) => {
    await commitmentTo(s, 'PC-001', pc1.id, 'executed');
    await executeWithFile(s, 'PC-001', pc1.id);
    const row = await commitmentGet(s, pc1.id);
    s.expectFields(row, { status: 'executed', type: 'purchase_order', original: is.cents(20000) }, 'PC-001');
    const line = one(row.lines, (l) => l.activityId === A.A130, 'PC-001: the SOV line on A130');
    s.expectFields(line, { costCodeId: codeId('02-100'), budgetLineId: is.absent }, 'PC-001 line names cost code 02-100 only (WP4.C4)');
    return { status: 'executed' };
  }, { needs: ['commitment.PC-001'] });

  // Commitment COs in every state on SC-001 (deep.087-COM.stateCoverage.commitmentChangeOrders), with WP4.C2's
  // committed value asserted at each moment: 100,000.00 while the +10,000 is draft or pending, 110,000.00 once approved,
  // still 110,000.00 after a rejected one.
  await b.step('commitment.SC-001.change-orders', async (s) => {
    const C2 = WP4.C2;
    const commitmentRoute = `${b.P}/commitments/${sc1.id}`;
    const read = async (id) => ((await commitmentGet(s, sc1.id)).changeOrders || []).find((row) => row.id === id);
    const revised = async (label, figure) => s.expectFields(await commitmentGet(s, sc1.id), { revised: asCents(figure) }, `SC-001 ${label} (WP4.C2)`);
    const l1 = sovLine(sc1, 'A310', 'SC-001');
    const make = async (key, amount) => {
      const title = b.name(`Commitment variation ${key}`);
      return s.create(`cco.${key}`, 'qs', `${commitmentRoute}/change-orders`, {
        title,
        description: `${title} ${b.ref(key)}`,
        lines: [{ amount, sovLineId: l1.id, description: `Extra to line 1 ${b.ref(key)}`, costCodeId: codeId('03-100'), budgetLineId: lineId('03-100', 'subcontract'), activityId: A.A310 }],
      }, {
        get: commitmentRoute,
        fields: { status: 'draft', value: is.cents(amount) },
        adopt: true,
        find: async () => atMostOne((await commitmentGet(s, sc1.id)).changeOrders || [], (row) => row.title === title, `SC-001 commitment CO ${key}`),
      });
    };
    const step = async (key, id, verb, persona, body, status) => {
      await s.act(`cco.${key}.${verb}`, persona, 'POST', `${b.P}/commitments/change-orders/${id}/${verb}`, body, {
        fields: { status },
        verify: async () => (await read(id))?.status === status,
      });
    };
    // WP4.C2: +10,000 (= committedCoApproved - committedExecuted).
    const at = async (row, status, name) => (await read(row.id)).status === status || pendingRecord(name);
    const approved = await make('APPROVED', major(C2.committedCoApproved) - major(C2.committedExecuted));
    if (await at(approved, 'draft', 'cco.APPROVED.submit')) {
      if ((await read(approved.id)).status === 'draft') await revised('with the +10,000 CO in draft', C2.committedCoDraftPending);
      await step('APPROVED', approved.id, 'submit', 'qs', {}, 'pending');
    }
    if (await at(approved, 'pending', 'cco.APPROVED.approve')) {
      if ((await read(approved.id)).status === 'pending') await revised('with the +10,000 CO pending', C2.committedCoDraftPending);
      await step('APPROVED', approved.id, 'approve', 'pm', {}, 'approved');
    }
    await revised('after the +10,000 CO is approved', C2.committedCoApproved);
    const pending = await make('PENDING', 5000);
    if (await at(pending, 'draft', 'cco.PENDING.submit')) await step('PENDING', pending.id, 'submit', 'qs', {}, 'pending');
    const rejected = await make('REJECTED', 20000);
    if (await at(rejected, 'draft', 'cco.REJECTED.submit')) await step('REJECTED', rejected.id, 'submit', 'qs', {}, 'pending');
    if (await at(rejected, 'pending', 'cco.REJECTED.reject')) await step('REJECTED', rejected.id, 'reject', 'pm', { reason: `Not instructed by the engineer ${b.ref('REJECTED')}` }, 'rejected');
    await revised('after a rejected CO', C2.committedCoRejected);
    const draft = await make('DRAFT', 3000);
    const voided = await make('VOID', 2000);
    if (await at(voided, 'draft', 'cco.VOID.void')) await step('VOID', voided.id, 'void', 'qs', { reason: `Raised twice ${b.ref('VOID')}` }, 'void');
    const states = Object.fromEntries(await Promise.all(Object.entries({ approved, pending, rejected, draft, void: voided }).map(async ([k, row]) => [k, (await read(row.id)).status])));
    s.expectFields(states, { approved: 'approved', pending: 'pending', rejected: 'rejected', draft: 'draft', void: 'void' }, 'commitment CO states');
    await revised('at the end (only the approved CO counts)', C2.committedCoApproved);
    return { ids: { approved: approved.id, pending: pending.id, rejected: rejected.id, draft: draft.id, void: voided.id }, states };
  }, { needs: ['commitment.SC-001.execute'] });

  // Pay applications in every state (deep.087-COM.stateCoverage.payApplications).
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
    if (app.status !== 'draft' && b.state.records[`payapp.${key}.claim`]?.status !== 'pending') return app;
    const lines = app.lines.map((line) => ({ sovLineId: line.sovLineId, thisPeriodAmount: amounts[line.sovLineId] ?? 0, notes: b.ref(`PA-${key}`) }));
    const want = Object.values(amounts).reduce((a, v) => a + v, 0);
    return s.act(`payapp.${key}.claim`, 'qs', 'PATCH', `${b.P}/pay-apps/${payApp.id}`, { lines }, {
      fields: { grossThisPeriod: is.cents(want) },
      verify: async (s2) => lib.sameCents((await payAppGet(s2, payApp.id)).grossThisPeriod, want),
    });
  };
  const payAppAct = async (s, key, id, verb, persona, body, status, { method = 'POST', fields = null, verify = null } = {}) =>
    s.act(`payapp.${key}.${verb}`, persona, method, method === 'DELETE' ? `${b.P}/pay-apps/${id}` : `${b.P}/pay-apps/${id}/${verb}`, body, {
      fields: fields || { status },
      verify: verify || (async (s2) => (await payAppGet(s2, id)).status === status),
    });
  /** A payment on an application; `moment` asserts the application in the payment's own answer. */
  const payPayApp = async (s, key, id, n, amount, paidAt, moment = {}) => {
    const reference = b.ref(`PA-${key}-PAY-${n}`);
    return s.create(`payapp.${key}.pay.${n}`, 'finance', `${b.P}/pay-apps/${id}/payments`, { amount, paidAt: b.past(paidAt), method: 'bank_transfer', reference, note: `Paid ${reference}` }, {
      get: `${b.P}/pay-apps/${id}`,
      idOf: (d) => atMostOne(d?.payments || [], (p) => p.reference === reference, `pay application payment ${reference}`)?.id ?? null,
      fields: { paidAmount: (v, d) => (d?.payments || []).filter((p) => p.reference === reference && lib.sameCents(p.amount, amount)).length === 1 || `one payment ${reference} of ${amount}`, ...moment },
      find: async (s2) => {
        const app = await payAppGet(s2, id);
        return atMostOne(app.payments || [], (p) => p.reference === reference, `pay application payment ${reference}`) ? app : null;
      },
    });
  };

  // PA-01 on SC-001 (A310 at 50%): WP4.P3 50,000 approved (+50,000), revoked to draft with a reason (-50,000),
  // re-approved under r1; WP4.P4 paid 20,000 then 25,000 = net 45,000 -> paid. Payments dated in July (CF1's months
  // stay clean). R2-1: each transition is guarded on its own status and revision, so a killed run resumes at the
  // transition it was in (an interrupted one is settled by its verify), never skipping the revoke.
  await b.step('payapp.01', async (s) => {
    const P3 = WP4.P3;
    const P4 = WP4.P4;
    const l1 = sovLine(sc1, 'A310', 'SC-001');
    const app = await newPayApp(s, '01', sc1.id, '2026-06-01', '2026-06-30');
    const phaseOf = (row) => {
      const revision = Number(row.certificationRevision) || 0;
      if (revision === 0) {
        if (row.status === 'draft') return lib.sameCents(row.grossThisPeriod, major(P3.gross)) ? 1 : 0;
        return { submitted: 2, under_review: 3, approved: 4 }[row.status] ?? -1;
      }
      if (revision === 1) return { draft: 5, submitted: 6, approved: 7, paid: 8 }[row.status] ?? -1;
      return -1;
    };
    const phase = async (s2 = s) => phaseOf(await payAppGet(s2, app.id));
    const reached = (n) => async (s2) => (await phase(s2)) >= n;
    const at = async (n, name) => (await phase()) === n || pendingRecord(name);
    s.assert((await phase()) >= 0, `PA-01 reads a state of the P3 sequence (status ${(await payAppGet(s, app.id)).status})`);
    if (await at(0, 'payapp.01.claim')) await claimPayApp(s, '01', app, { [l1.id]: major(P3.gross) });
    if (await at(1, 'payapp.01.submit')) await payAppAct(s, '01', app.id, 'submit', 'qs', {}, 'submitted', { verify: reached(2) });
    if (await at(2, 'payapp.01.review')) await payAppAct(s, '01', app.id, 'review', 'qs', { note: `Checked against the site measure ${b.ref('PA-01')}` }, 'under_review', { verify: reached(3) });
    // WP4.P3.gross / retention / net at the approval (r0).
    if (await at(3, 'payapp.01.approve')) {
      await payAppAct(s, '01', app.id, 'approve', 'pm', {}, 'approved', {
        fields: { status: 'approved', certificationRevision: 0, grossThisPeriod: asCents(P3.gross), retentionThisPeriod: asCents(P3.retention), netThisPeriod: asCents(P3.net) },
        verify: reached(4),
      });
    }
    // Revoked to draft by the approver with a reason: certificationRevision 1 (WP4.P3.revokeMirror).
    if (await at(4, 'payapp.01.reopen')) {
      await payAppAct(s, '01', app.id, 'reopen', 'pm', { reason: `Certified against the wrong measure ${b.ref('PA-01')}` }, 'draft', { fields: { status: 'draft', certificationRevision: 1 }, verify: reached(5) });
    }
    if (await at(5, 'payapp.01.resubmit')) {
      await s.act('payapp.01.resubmit', 'qs', 'POST', `${b.P}/pay-apps/${app.id}/submit`, {}, { fields: { status: 'submitted', certificationRevision: 1 }, verify: reached(6) });
    }
    // WP4.P3.reapprovePosts: re-approved under r1.
    if (await at(6, 'payapp.01.reapprove')) {
      await s.act('payapp.01.reapprove', 'pm', 'POST', `${b.P}/pay-apps/${app.id}/approve`, {}, { fields: { status: 'approved', certificationRevision: 1, netThisPeriod: asCents(P3.net) }, verify: reached(7) });
    }
    // WP4.P4.payPartStatus / paidAmount in the first payment's answer; P4.paySecond in the second's.
    await payPayApp(s, '01', app.id, 1, major(P4.paidAmount), '2026-07-15', { status: P4.payPartStatus.value, paidAmount: asCents(P4.paidAmount) });
    await payPayApp(s, '01', app.id, 2, major(P3.net) - major(P4.paidAmount), '2026-07-31', { status: P4.paySecond.value, paidAmount: asCents(P3.net) });
    const end = await payAppGet(s, app.id);
    s.expectFields(end, { status: P4.paySecond.value, certificationRevision: 1, paidAmount: asCents(P3.net), netThisPeriod: asCents(P3.net) }, 'PA-01 (WP4.P3 / P4)');
    return { id: app.id, ref: end.ref };
  }, { needs: ['commitment.SC-001.change-orders'] });

  // PA-02 on SC-004 (A320 at 100%): stage 5's 60,000 gross, 10% retention 6,000, net 54,000 paid 2026-09-20 (CF1 2026-09 outflow).
  await b.step('payapp.02', async (s) => {
    const line = sovLine(sc4, 'A320', 'SC-004');
    const app = await newPayApp(s, '02', sc4.id, '2026-08-01', '2026-08-31');
    await claimPayApp(s, '02', app, { [line.id]: major(STAGE5['payApp.gross']) });
    if ((await payAppGet(s, app.id)).status === 'draft' || pendingRecord('payapp.02.submit')) await payAppAct(s, '02', app.id, 'submit', 'qs', {}, 'submitted', { verify: async (s2) => (await payAppGet(s2, app.id)).status !== 'draft' });
    if ((await payAppGet(s, app.id)).status === 'submitted' || pendingRecord('payapp.02.approve')) {
      await payAppAct(s, '02', app.id, 'approve', 'pm', {}, 'approved', {
        fields: { status: STAGE5['payApp.approve'].value, grossThisPeriod: asCents(STAGE5['payApp.gross']), retentionThisPeriod: asCents(STAGE5['payApp.retention']), netThisPeriod: asCents(STAGE5['payApp.net']) },
        verify: async (s2) => ['approved', 'paid'].includes((await payAppGet(s2, app.id)).status),
      });
    }
    await payPayApp(s, '02', app.id, 1, major(STAGE5['payment.paidAmount']), '2026-09-20', { status: STAGE5['payment.payAppStatus'].value, paidAmount: asCents(STAGE5['payment.paidAmount']) });
    const end = await payAppGet(s, app.id);
    // WP4 stage5:82-204 payApp.gross / retention / net, payment.payAppStatus paid.
    s.expectFields(end, { status: STAGE5['payment.payAppStatus'].value, grossThisPeriod: asCents(STAGE5['payApp.gross']), retentionThisPeriod: asCents(STAGE5['payApp.retention']), netThisPeriod: asCents(STAGE5['payApp.net']), paidAmount: asCents(STAGE5['payment.paidAmount']) }, 'PA-02');
    return { id: app.id, ref: end.ref };
  }, { needs: ['commitment.SC-004.execute', 'payapp.01'] });

  // PA-03 approved and unpaid; PA-04 under review (the last open one on SC-004).
  await b.step('payapp.03-04', async (s) => {
    const line = sovLine(sc4, 'A320', 'SC-004');
    const a3 = await newPayApp(s, '03', sc4.id, '2026-09-01', '2026-09-30');
    await claimPayApp(s, '03', a3, { [line.id]: 20000 });
    if ((await payAppGet(s, a3.id)).status === 'draft' || pendingRecord('payapp.03.submit')) await payAppAct(s, '03', a3.id, 'submit', 'qs', {}, 'submitted', { verify: async (s2) => (await payAppGet(s2, a3.id)).status !== 'draft' });
    if ((await payAppGet(s, a3.id)).status === 'submitted' || pendingRecord('payapp.03.approve')) await payAppAct(s, '03', a3.id, 'approve', 'pm', {}, 'approved', { fields: { status: 'approved', grossThisPeriod: is.cents(20000) } });
    const a4 = await newPayApp(s, '04', sc4.id, '2026-10-01', b.today);
    await claimPayApp(s, '04', a4, { [line.id]: 10000 });
    if ((await payAppGet(s, a4.id)).status === 'draft' || pendingRecord('payapp.04.submit')) await payAppAct(s, '04', a4.id, 'submit', 'qs', {}, 'submitted', { verify: async (s2) => (await payAppGet(s2, a4.id)).status !== 'draft' });
    if ((await payAppGet(s, a4.id)).status === 'submitted' || pendingRecord('payapp.04.review')) await payAppAct(s, '04', a4.id, 'review', 'qs', { note: `Being checked ${b.ref('PA-04')}` }, 'under_review');
    s.expectFields(await payAppGet(s, a3.id), { status: 'approved', grossThisPeriod: is.cents(20000), paidAmount: is.cents(0) }, 'PA-03');
    s.expectFields(await payAppGet(s, a4.id), { status: 'under_review', grossThisPeriod: is.cents(10000) }, 'PA-04');
    return { ids: { approved: a3.id, underReview: a4.id } };
  }, { needs: ['payapp.02'] });

  // On SC-002: PA-05 rejected, PA-06 void, PA-07 draft.
  await b.step('payapp.05-07', async (s) => {
    const line = sovLine(sc2, 'A230', 'SC-002');
    const a5 = await newPayApp(s, '05', sc2.id, '2026-07-01', '2026-07-31');
    await claimPayApp(s, '05', a5, { [line.id]: 10000 });
    if ((await payAppGet(s, a5.id)).status === 'draft' || pendingRecord('payapp.05.submit')) await payAppAct(s, '05', a5.id, 'submit', 'qs', {}, 'submitted', { verify: async (s2) => (await payAppGet(s2, a5.id)).status !== 'draft' });
    if ((await payAppGet(s, a5.id)).status === 'submitted' || pendingRecord('payapp.05.reject')) await payAppAct(s, '05', a5.id, 'reject', 'qs', { code: 'INCORRECT_QUANTITIES', reason: `Quantities do not match the site measure ${b.ref('PA-05')}` }, 'rejected');
    const a6 = await newPayApp(s, '06', sc2.id, '2026-08-01', '2026-08-31');
    if ((await payAppGet(s, a6.id)).status === 'draft' || pendingRecord('payapp.06.void')) await payAppAct(s, '06', a6.id, 'void', 'pm', { reason: `Raised for the wrong period ${b.ref('PA-06')}` }, 'void', { method: 'DELETE' });
    const a7 = await newPayApp(s, '07', sc2.id, '2026-09-01', '2026-09-30');
    await claimPayApp(s, '07', a7, { [line.id]: 5000 });
    const states = { rejected: (await payAppGet(s, a5.id)).status, void: (await payAppGet(s, a6.id)).status, draft: (await payAppGet(s, a7.id)).status };
    s.expectFields(states, { rejected: 'rejected', void: 'void', draft: 'draft' }, 'SC-002 applications');
    return { ids: { rejected: a5.id, void: a6.id, draft: a7.id } };
  }, { needs: ['commitment.SC-002.execute'] });

  // PA-08 on SC-003: the final application at the closeout gate (WP4.P6, assumption code CLOSEOUT_OUTSTANDING); left submitted.
  await b.step('payapp.08-final', async (s) => {
    const line = sovLine(sc3, 'A110', 'SC-003');
    const a8 = await newPayApp(s, '08', sc3.id, '2026-09-01', '2026-09-30');
    await claimPayApp(s, '08', a8, { [line.id]: 10000 });
    if ((await payAppGet(s, a8.id)).status === 'draft' || pendingRecord('payapp.08.submit')) await payAppAct(s, '08', a8.id, 'submit', 'qs', {}, 'submitted', { verify: async (s2) => (await payAppGet(s2, a8.id)).status !== 'draft' });
    await s.refused('payapp.08.approve.closeout', 'pm', 'POST', `${b.P}/pay-apps/${a8.id}/approve`, {}, saidOf(WP4.P6.finalCloseoutGate), {
      named: false,
      // An interrupted probe is found by what a wrongly accepted one would have made: an approved PA-08.
      find: async (s2) => {
        const app = await payAppGet(s2, a8.id);
        return ['approved', 'paid'].includes(app.status) ? app : null;
      },
    });
    s.expectFields(await payAppGet(s, a8.id), { status: 'submitted' }, 'PA-08 at the closeout gate');
    return { id: a8.id };
  }, { needs: ['commitment.SC-003.execute'] });

  // WP4.C4 (L108, R2-5): a 1,000.00 application on PC-001, approved. Its line names cost code 02-100 only, which holds a
  // material and a subcontract budget line; where the approval's actual lands against the committed cost is WP-4's check.
  await b.step('payapp.PC-001', async (s) => {
    const amount = major(WP4.C4.actualPosted);
    const line = sovLine(pc1, 'A130', 'PC-001');
    const app = await newPayApp(s, 'PC1', pc1.id, '2026-09-01', '2026-09-30');
    await claimPayApp(s, 'PC1', app, { [line.id]: amount });
    if ((await payAppGet(s, app.id)).status === 'draft' || pendingRecord('payapp.PC1.submit')) await payAppAct(s, 'PC1', app.id, 'submit', 'qs', {}, 'submitted', { verify: async (s2) => (await payAppGet(s2, app.id)).status !== 'draft' });
    if ((await payAppGet(s, app.id)).status === 'submitted' || pendingRecord('payapp.PC1.approve')) {
      // PC-001 holds no retention (retentionRate 0), so the net is the gross.
      await payAppAct(s, 'PC1', app.id, 'approve', 'pm', {}, 'approved', { fields: { status: 'approved', grossThisPeriod: asCents(WP4.C4.actualPosted), retentionThisPeriod: is.cents(0), netThisPeriod: asCents(WP4.C4.actualPosted) } });
    }
    const end = await payAppGet(s, app.id);
    s.expectFields(end, { status: 'approved', grossThisPeriod: asCents(WP4.C4.actualPosted), paidAmount: is.cents(0) }, 'PA-PC1 (WP4.C4)');
    return { id: app.id, ref: end.ref, sovLineId: line.id };
  }, { needs: ['commitment.PC-001.execute'] });

  // ── cash flow: manual rows away from CF1's months (WP4.CF3.manualSurvivesRebuild) ──
  await b.step('cash-flow.manual', async (s) => {
    const rows = [['2026-10', major(WP4.CF3.manualSurvivesRebuild), 0, 'Insurance claim recovery forecast'], ['2026-06', 0, 2500, 'Site security deposit']];
    const ids = {};
    for (const [periodKey, inflow, outflow, text] of rows) {
      const note = `${text} ${b.ref(`CF-${periodKey}`)}`;
      const made = await s.create(`cash-flow.${periodKey}`, 'cost', `${b.P}/cash-flow`, { period: periodKey, inflow, outflow, note }, {
        get: `${b.P}/cash-flow`,
        fields: { period: periodKey, inflow: is.cents(inflow), outflow: is.cents(outflow), note, source: 'manual' },
        find: async (s2) => atMostOne(listOf(await s2.get('cost', `${b.P}/cash-flow`), 'entries', 'rows'), (row) => row.note === note, `cash-flow row ${periodKey}`),
      });
      ids[periodKey] = made.id;
    }
    return { ids };
  });

  // ── a weather delay and EOT claims in every state (WP7.T1-T3; deep.087-COM.eotApprovedClaims) ──
  const weather = await b.step('weather-delay', async (s) => {
    const description = `Heavy rain stopped external works ${b.ref('WD-1')}`;
    const made = await s.create('weather-delay', 'planner', `${b.P}/weather-delays`, {
      description,
      date: b.past('2026-08-12'),
      delayDays: 2,
      contractual: true,
      activityLinks: [{ activityId: A.A310, delayStart: '2026-08-12', delayEnd: '2026-08-13', delayDays: 2 }],
    }, {
      get: `${b.P}/weather-delays`,
      fields: { description, date: is.day('2026-08-12'), delayDays: 2, contractual: true },
      find: async (s2) => atMostOne(listOf(await s2.get('planner', `${b.P}/weather-delays`), 'delays'), (row) => row.description === description, 'weather delay WD-1'),
    });
    return { id: made.id };
  }, { needs: ['activities'] });

  const eotList = async (s) => listOf(await s.get('planner', `${b.P}/eot`), 'claims');
  const eot = (key, { delayDays, eotDaysGranted, to, activity = 'A230', linkWeather = false }) =>
    b.step(`eot.${key}`, async (s) => {
      const eventName = b.name(`Delay event ${key}`);
      const made = await s.create(`eot.${key}`, 'planner', `${b.P}/eot`, {
        eventName,
        eventType: linkWeather ? 'weather' : 'client_instruction',
        delayDays,
        eotDaysGranted,
        ldRatePerDay: major(D087.ldRatePerDay),
        activityLinks: [{ activityId: A[activity], delayStart: '2026-08-12', delayEnd: lib.dates.addDays('2026-08-12', delayDays), delayDays, impactBasis: `As-built against the programme ${b.ref(key)}` }],
        ...(linkWeather ? { weatherDelayIds: [weather.id] } : {}),
        analysis: `The event delayed ${activity} beyond its float ${b.ref(key)}`,
        status: 'draft',
      }, {
        get: `${b.P}/eot`,
        // deep.087-COM.ldRatePerDay on the claim (R2-8).
        fields: { status: 'draft', eventName, delayDays, eotDaysGranted, ldRatePerDay: asCents(D087.ldRatePerDay) },
        find: async (s2) => atMostOne(await eotList(s2), (row) => row.eventName === eventName, `EOT claim ${key}`),
      });
      const read = async () => (await eotList(s)).find((row) => row.id === made.id);
      if (to !== 'draft') {
        const doc = await C.attach(s, `eot.${key}.notice`, 'planner', 'eot', made.id, `Notice of delay ${key}`);
        if ((await read()).status === 'draft' || pendingRecord(`eot.${key}.evidence`)) {
          await s.act(`eot.${key}.evidence`, 'planner', 'PATCH', `${b.P}/eot/${made.id}`, { documentIds: [doc.documentId] }, {
            fields: { id: made.id },
            // The claim's evidence references (attachmentRefs) name the document once the PATCH took effect.
            verify: async () => ((await read()).attachmentRefs || []).some((ref) => ref.documentId === doc.documentId),
          });
        }
        if ((await read()).status === 'draft' || pendingRecord(`eot.${key}.submit`)) {
          await s.act(`eot.${key}.submit`, 'planner', 'POST', `${b.P}/eot/${made.id}/submit`, { comment: `Submitted with particulars ${b.ref(key)}` }, { fields: { status: 'submitted' }, verify: async () => (await read()).status !== 'draft' });
        }
        if (to === 'approved' && ((await read()).status === 'submitted' || pendingRecord(`eot.${key}.approve`))) {
          await s.act(`eot.${key}.approve`, 'pm', 'POST', `${b.P}/eot/${made.id}/approve`, { comment: `Entitlement agreed ${b.ref(key)}` }, { fields: { status: 'approved' }, verify: async () => (await read()).status === 'approved' });
        }
        if (to === 'rejected' && ((await read()).status === 'submitted' || pendingRecord(`eot.${key}.reject`))) {
          await s.act(`eot.${key}.reject`, 'pm', 'POST', `${b.P}/eot/${made.id}/reject`, { reason: `Concurrent contractor delay ${b.ref(key)}` }, { fields: { status: 'rejected' }, verify: async () => (await read()).status === 'rejected' });
        }
      }
      const row = await read();
      s.expectFields(row, { status: to, ldRatePerDay: asCents(D087.ldRatePerDay) }, `EOT ${key}`);
      return { id: made.id, status: row.status, cumulativeApprovedEotDays: row.cumulativeApprovedEotDays ?? null, revisedCompletionRecommendation: row.revisedCompletionRecommendation ?? null };
    }, { needs: ['activities', 'weather-delay'] });
  // WP7.T2: 10 days approved -> cumulative 10, recommendation 2027-07-10; linked to the weather delay.
  const t2Days = WP7.T2.cumulativeApprovedEotDays.value;
  const t2 = await eot('T2', { delayDays: t2Days, eotDaysGranted: t2Days, to: 'approved', linkWeather: true });
  // WP7.T3: plus 5 -> cumulative 15, recommendation 2027-07-15.
  const t3Days = WP7.T3.cumulativeApprovedEotDays.value - t2Days;
  const t3 = await eot('T3', { delayDays: t3Days, eotDaysGranted: t3Days, to: 'approved', activity: 'A310' });
  await eot('REJECTED', { delayDays: 7, eotDaysGranted: 7, to: 'rejected', activity: 'A320' });
  await eot('SUBMITTED', { delayDays: 4, eotDaysGranted: 4, to: 'submitted', activity: 'A320' });
  await eot('DRAFT', { delayDays: 3, eotDaysGranted: 3, to: 'draft', activity: 'A330' });
  await b.step('eot.figures', async (s) => {
    const rows = await eotList(s);
    const first = one(rows, (row) => row.id === t2.id, 'EOT T2');
    const second = one(rows, (row) => row.id === t3.id, 'EOT T3');
    s.expectFields(first, { cumulativeApprovedEotDays: WP7.T2.cumulativeApprovedEotDays.value, revisedCompletionRecommendation: is.day(WP7.T2.revisedCompletionRecommendation.value) }, 'T2 (WP7.T2)');
    s.expectFields(second, { cumulativeApprovedEotDays: WP7.T3.cumulativeApprovedEotDays.value, revisedCompletionRecommendation: is.day(WP7.T3.revisedCompletionRecommendation.value) }, 'T3 (WP7.T3)');
    return { t2: { cumulative: first.cumulativeApprovedEotDays, recommendation: first.revisedCompletionRecommendation }, t3: { cumulative: second.cumulativeApprovedEotDays, recommendation: second.revisedCompletionRecommendation } };
  }, { needs: ['eot.T2', 'eot.T3'] });

  // ── supply chain ──
  // Warehouse codes and item SKUs are unique in the company: they carry the project's id
  // prefix so that a debug project archived earlier never holds them.
  const sku = (suffix) => `CERT3-087-COM-${suffix}-${b.projectId.slice(0, 8)}`;
  await b.step('suppliers', async (s) => {
    const code = 'SUP-087COM';
    const route = `${b.P}/procurement/suppliers`;
    const made = await s.create('supplier.main', 'procurement', route, {
      companyId: companyId('supplier'),
      code,
      contactName: `Account manager ${b.ref('SUP')}`,
      status: 'approved',
      notes: `Framework supplier ${b.ref('SUP')}`,
    }, {
      get: route,
      fields: { status: 'approved' },
      adopt: true,
      find: async (s2) => atMostOne(listOf(await s2.get('procurement', route)), (row) => row.code === code, `supplier ${code}`),
    });
    return { id: made.id };
  }, { needs: ['directory'] });
  const supplierId = () => b.out('suppliers').id;

  const warehouses = await b.step('warehouses', async (s) => {
    const listRoute = `/inventory/warehouses?projectId=${b.projectId}`;
    const visible = listOf(await s.get('warehouse', listRoute));
    const ensure = async (key, code, body) => s.create(`warehouse.${key}`, 'warehouse', '/inventory/warehouses', { code, ...body }, {
      get: listRoute,
      fields: { code },
      adopt: true,
      find: async () => atMostOne(visible, (row) => row.code === code, `warehouse ${code}`),
    });
    const site = await ensure('site', `C3-087COM-SITE-${b.projectId.slice(0, 8)}`, { name: b.name('Site store'), kind: 'site', projectId: b.projectId, managerId: await b.userId('warehouse'), notes: b.ref('WH-SITE') });
    const yard = await ensure('yard', `C3-087COM-YARD-${b.projectId.slice(0, 8)}`, { name: b.name('Laydown yard'), kind: 'project', projectId: b.projectId, managerId: await b.userId('warehouse'), notes: b.ref('WH-YARD') });
    const locations = async (warehouseId, key, specs) => {
      const route = `/inventory/warehouses/${warehouseId}/locations`;
      const existing = listOf(await s.get('warehouse', route));
      const out = {};
      for (const [code, name, kind, parent] of specs) {
        const row = await s.create(`location.${key}.${code}`, 'warehouse', route, {
          code, name: `${name} (${b.code})`, kind, parentId: parent ? out[parent] : null,
        }, {
          get: route,
          fields: { code },
          adopt: true,
          find: async () => atMostOne(existing, (r) => r.code === code, `${key} location ${code}`),
        });
        out[code] = row.id;
      }
      return out;
    };
    const siteLocations = await locations(site.id, 'site', [['Z-A', 'Zone A', 'zone'], ['Z-A-B01', 'Bin 01', 'bin', 'Z-A'], ['Z-A-B02', 'Bin 02', 'bin', 'Z-A'], ['Z-Q', 'Quarantine cage', 'zone']]);
    const yardLocations = await locations(yard.id, 'yard', [['Y-1', 'Hardstanding 1', 'zone'], ['Y-1-B01', 'Bay 01', 'bin', 'Y-1']]);
    return { site: site.id, yard: yard.id, siteLocations, yardLocations };
  });

  // The cement of stage 4 (PO-A, PO-B, the 60 issued, N1's reservation) and nothing else; the side movements
  // (quarantine, release, damage, returns, transfers) use the O2 cement (R2-4: N1's item no other movement touches).
  const items = await b.step('items', async (s) => {
    const make = async (key, code, body) => s.create(`item.${key}`, 'warehouse', '/inventory/items', { sku: code, ...body }, {
      get: (id) => `/inventory/items/${id}`,
      fields: { sku: code },
      adopt: true,
      find: async (s2) => atMostOne(listOf(await s2.get('warehouse', `/inventory/items?projectId=${b.projectId}&search=${encodeURIComponent(code)}`)), (row) => row.sku === code, `stock item ${code}`),
    });
    const cement = await make('cement', sku('CEM'), { name: b.name('Cement OPC 42.5N 50kg bag'), unit: 'bag', category: 'cement', projectId: b.projectId, unitCost: 10, notes: b.ref('ITEM-CEM') });
    const cement2 = await make('cement2', sku('CEM2'), { name: b.name('Cement OPC 42.5N 50kg bag for mortar'), unit: 'bag', category: 'cement', projectId: b.projectId, unitCost: 10, notes: b.ref('ITEM-CEM2') });
    const blocks = await make('blocks', sku('BLK'), { name: b.name('Concrete block 200mm'), unit: 'pcs', category: 'masonry', projectId: b.projectId, unitCost: 10, notes: b.ref('ITEM-BLK') });
    const wire = await make('wire', sku('TIE'), { name: b.name('Tie wire 1.6mm'), unit: 'kg', category: 'steel', projectId: b.projectId, unitCost: 2, notes: b.ref('ITEM-TIE') });
    const membrane = await make('membrane', sku('MEM'), { name: b.name('Waterproofing membrane roll'), unit: 'roll', category: 'waterproofing', projectId: b.projectId, unitCost: 100, notes: b.ref('ITEM-MEM') });
    const meter = await make('meter', sku('MTR'), { name: b.name('Digital moisture meter'), unit: 'pcs', category: 'tool', projectId: b.projectId, unitCost: 85, isSerialised: true, notes: b.ref('ITEM-MTR') });
    s.expectFields(await s.get('warehouse', `/inventory/items/${meter.id}`), { isSerialised: true }, 'the serial item');
    return { cement: cement.id, cement2: cement2.id, blocks: blocks.id, wire: wire.id, membrane: membrane.id, meter: meter.id };
  });
  const itemGet = (s, id) => s.get('warehouse', `/inventory/items/${id}`);

  // Material plan row on A130, linked to PO-A's line (WP5.N6 setup: 100 bags, 60 issued).
  const plan = await b.step('material-plan', async (s) => {
    const route = `${b.P}/activities/${A.A130}/materials`;
    const code = sku('CEM');
    const made = await s.create('material.cement', 'planner', route, {
      name: b.name('Cement for foundations'), code, spec: `OPC 42.5N ${b.ref('PLAN')}`, unit: 'BAG', qty: 100,
      requiredTiming: 'activity_start', leadWeeks: 2, bufferDays: 7, supplierId: supplierId(), notes: b.ref('PLAN'),
    }, {
      get: route,
      fields: { code, qty: 100 },
      adopt: true,
      find: async (s2) => atMostOne(listOf(await s2.get('planner', route)), (row) => row.code === code, `material plan row ${code}`),
    });
    return { id: made.id };
  }, { needs: ['suppliers', 'activities'] });

  // Purchase orders: PO-00001 is the acknowledged-before-delivery order (it collides with 087-COM-B's PO-00001, WP5.O6).
  const poRoute = (id) => `${b.P}/purchase-orders/${id}`;
  const poGet = (s, id) => s.get('procurement', poRoute(id));
  /** Raised as a draft; the lines (description, quantity, unit cost, activity, cost code) and the value asserted (R2-8). */
  const raisePo = async (s, key, { item, lines, value = null }) => {
    const title = `${b.name(item)} ${b.ref(`PO-${key}`)}`;
    const want = lines.reduce((sum, l) => sum + cents(l.orderedQty * l.unitCost), 0);
    const made = await s.create(`po.${key}`, 'procurement', `${b.P}/procurement/purchase-orders`, {
      item: title,
      supplierId: supplierId(),
      status: 'draft',
      currency: 'EGP',
      requiredBy: b.date(21, { future: true }),
      promisedDate: b.date(14, { future: true }),
      buyer: `Buyer ${b.ref('PO')}`,
      notes: b.ref(`PO-${key}`),
      lines: lines.map((line, index) => ({ lineNumber: index + 1, notes: b.ref(`PO-${key}-L${index + 1}`), ...line })),
    }, {
      get: (id) => poRoute(id),
      fields: {
        status: 'draft',
        value: value || is.cents(money(want)),
        lines: (v) => (Array.isArray(v) && v.length === lines.length && lines.every((l) => v.filter((row) => row.description === l.description && Number(row.orderedQty) === l.orderedQty && lib.sameCents(row.unitCost, l.unitCost) && row.activityId === l.activityId && row.costCodeId === l.costCodeId).length === 1)) || 'the lines as sent (description, quantity, unit cost, activity, cost code)',
      },
      adopt: true,
      find: async (s2) => {
        const row = atMostOne(listOf(await s2.get('procurement', `${b.P}/procurement/purchase-orders`)), (r) => r.item === title, `purchase order ${key}`);
        return row ? poGet(s2, row.id) : null;
      },
    });
    return poGet(s, made.id);
  };
  const poTo = async (s, key, id, target) => {
    const status = async () => (await poGet(s, id)).status;
    const go = async (verb, persona, body, done) => {
      await s.act(`po.${key}.${verb}`, persona, 'POST', `${poRoute(id)}/${verb}`, body, { fields: { id }, verify: async () => done.includes(await status()) });
    };
    // An order raised from an award starts 'planned', which behaves as a draft.
    if (['planned', 'draft'].includes(await status()) || pendingRecord(`po.${key}.submit`)) await go('submit', 'procurement', {}, ['pending_approval', 'approved', 'issued', 'acknowledged', 'partial', 'received', 'cancelled', 'closed']);
    if ((await status()) === 'pending_approval' || pendingRecord(`po.${key}.approve`)) await go('approve', 'pm', {}, ['approved', 'issued', 'acknowledged', 'partial', 'received', 'cancelled', 'closed']);
    if ((await status()) === 'approved' || pendingRecord(`po.${key}.issue`)) await go('issue', 'procurement', {}, ['issued', 'acknowledged', 'partial', 'received', 'cancelled', 'closed']);
    if (target === 'acknowledged' && ((await status()) === 'issued' || pendingRecord(`po.${key}.acknowledge`))) await go('acknowledge', 'procurement', { acknowledgedRef: b.ref(`ACK-${key}`) }, ['acknowledged']);
    if (target === 'cancelled' && ((await status()) === 'issued' || pendingRecord(`po.${key}.cancel`))) await go('cancel', 'procurement', { reason: `Supplier could not meet the date ${b.ref(key)}` }, ['cancelled']);
    return status();
  };
  /** A goods receipt; read back, and an interrupted one found, through its order's receipts by its delivery note. */
  const receive = async (s, key, order, lines) => {
    const receiptNote = b.ref(`DN-${key}`);
    return s.create(`receipt.${key}`, 'warehouse', '/inventory/goods-receipt', {
      orderId: order.id,
      projectId: b.projectId,
      warehouseId: warehouses.site,
      deliveryNote: receiptNote,
      notes: `Checked against the order ${receiptNote}`,
      lines,
    }, {
      expect: [200, 201],
      get: () => poRoute(order.id),
      idOf: (d) => d?.receiptId ?? null,
      fields: { receiptId: is.present },
      adopt: true,
      find: async (s2) => {
        const receipt = atMostOne((await poGet(s2, order.id)).receipts || [], (r) => r.deliveryNote === receiptNote, `receipt ${receiptNote}`);
        return receipt ? { receiptId: receipt.id } : null;
      },
    });
  };
  const line = (desc, { item = null, qty, cost, unit, activity = 'A130', code = '02-100', plan: planId = null }) => ({
    activityId: A[activity],
    costCodeId: codeId(code),
    budgetLineId: lineId(code, code === '02-100' ? 'material' : 'subcontract'),
    ...(item ? { itemCode: item } : {}),
    ...(planId ? { activityMaterialId: planId } : {}),
    description: `${desc} (${b.code})`,
    unit,
    orderedQty: qty,
    unitCost: cost,
  });
  const lineIdOf = (order, key) => one(order.lines, (l) => l.lineNumber === 1, `PO-${key}: its line 1`).id;

  const pos = await b.step('purchase-orders', async (s) => {
    const out = {};
    // PO-00001: acknowledged before any delivery.
    const ack = await raisePo(s, 'ACK', { item: 'Cement call-off', lines: [line('Cement OPC 42.5N', { item: sku('CEM'), qty: 20, cost: 10, unit: 'bag' })] });
    out.ack = { id: ack.id, ref: ack.ref, lineId: lineIdOf(ack, 'ACK'), status: await poTo(s, 'ACK', ack.id, 'acknowledged') };
    // PO-A: cement 100 @ 10 on the plan row (stage4:167 / :170 PO-A); received in full, then the close (WP5.O2.fullyReceivedClose).
    const a = await raisePo(s, 'A', { item: 'Cement for foundations', value: asCents(STAGE4['PO-A.value']), lines: [line('Cement OPC 42.5N', { item: sku('CEM'), qty: 100, cost: 10, unit: 'bag', plan: plan.id })] });
    out.a = { id: a.id, ref: a.ref, lineId: lineIdOf(a, 'A'), status: await poTo(s, 'A', a.id, 'issued') };
    // PO-B: cement 50 @ 13 (stage4:170 PO-B; the D5 price-variance invoice is 50 @ 14).
    const bOrder = await raisePo(s, 'B', { item: 'Cement top-up', value: asCents(STAGE4['PO-B.value']), lines: [line('Cement OPC 42.5N', { item: sku('CEM'), qty: 50, cost: 13, unit: 'bag' })] });
    out.b = { id: bOrder.id, ref: bOrder.ref, lineId: lineIdOf(bOrder, 'B'), status: await poTo(s, 'B', bOrder.id, 'issued') };
    // PO-C: WP5.O2 exactly (R2-15): 100 bags of cement @ 10.00 = 1,000.00 issued; 60 received; then the short close.
    const c = await raisePo(s, 'C', { item: 'Cement for blockwork mortar', value: asCents(WP5.O2.order1000), lines: [line('Cement OPC 42.5N for mortar', { item: sku('CEM2'), qty: WP5.O2.ordered.value, cost: 10, unit: 'bag', activity: 'A310' })] });
    out.c = { id: c.id, ref: c.ref, lineId: lineIdOf(c, 'C'), status: await poTo(s, 'C', c.id, 'issued') };
    // PO-O4: WP5.O4's rejection on its own order (R2-15): blocks 100 @ 10; a receipt of 10 accepted and 2 rejected.
    const o4 = await raisePo(s, 'O4', { item: 'Concrete blocks', lines: [line('Concrete block 200mm', { item: sku('BLK'), qty: 100, cost: 10, unit: 'pcs', activity: 'A310' })] });
    out.o4 = { id: o4.id, ref: o4.ref, lineId: lineIdOf(o4, 'O4'), status: await poTo(s, 'O4', o4.id, 'issued') };
    // PO-X: cancelled before delivery.
    const x = await raisePo(s, 'X', { item: 'Formwork plywood', lines: [line('Formwork plywood 18mm', { qty: 40, cost: 25, unit: 'sheet', activity: 'A200' })] });
    out.x = { id: x.id, ref: x.ref, lineId: lineIdOf(x, 'X'), status: await poTo(s, 'X', x.id, 'cancelled') };
    // PO-SVC: a service line received in full; over-invoiced 60 + 60 (WP5.D5.overInvoicedLedger).
    const svc = await raisePo(s, 'SVC', { item: 'Mobile crane hire', lines: [line('Mobile crane hire', { qty: 100, cost: 10, unit: 'hr', activity: 'A200' })] });
    out.svc = { id: svc.id, ref: svc.ref, lineId: lineIdOf(svc, 'SVC'), status: await poTo(s, 'SVC', svc.id, 'issued') };
    // PO-SVC2: a service line never received; its invoice is approved then voided (deep.087-COM.supplierInvoiceVoidedAfterApproval).
    const svc2 = await raisePo(s, 'SVC2', { item: 'Setting-out survey', lines: [line('Setting-out survey service', { qty: 1, cost: major(D087.supplierInvoiceVoidedAfterApproval.approvePosts), unit: 'ls', activity: 'A100' })] });
    out.svc2 = { id: svc2.id, ref: svc2.ref, lineId: lineIdOf(svc2, 'SVC2'), status: await poTo(s, 'SVC2', svc2.id, 'issued') };
    // PO-STK: a stocked membrane 10 @ 100 invoiced and approved BEFORE its receipt (WP5.D4, L35).
    const stk = await raisePo(s, 'STK', { item: 'Waterproofing membrane', lines: [line('Waterproofing membrane roll', { item: sku('MEM'), qty: 10, cost: 100, unit: 'roll', activity: 'A130' })] });
    out.stk = { id: stk.id, ref: stk.ref, lineId: lineIdOf(stk, 'STK'), status: await poTo(s, 'STK', stk.id, 'issued') };
    s.expectFields(out, { 'ack.status': 'acknowledged', 'a.status': 'issued', 'b.status': 'issued', 'c.status': 'issued', 'o4.status': 'issued', 'x.status': 'cancelled', 'svc.status': 'issued', 'svc2.status': 'issued', 'stk.status': 'issued' }, 'purchase orders');
    s.assert(out.ack.ref === BOOK.deep['087-COM-B'].poRefCollision.value, `the first order of the project is ${BOOK.deep['087-COM-B'].poRefCollision.value} (read ${out.ack.ref}): WP5.O6 needs it`);
    return out;
  }, { needs: ['suppliers', 'material-plan', 'budget-lines', 'items'] });

  // Receipts: PO-A in full, PO-B in full (WA 11.00: WP5.existing / stage4), PO-C 60 of 100 (WP5.O2), PO-O4 10 accepted +
  // 2 rejected (WP5.O4), PO-SVC in full. Each order's line and the stock read back (R2-8).
  await b.step('receipts', async (s) => {
    const loc = warehouses.siteLocations;
    await receive(s, 'A', pos.a, [{ poLineId: pos.a.lineId, acceptedQty: 100, rejectedQty: 0, locationId: loc['Z-A-B01'], inventoryItemId: items.cement, notes: b.ref('RCV-A') }]);
    await receive(s, 'B', pos.b, [{ poLineId: pos.b.lineId, acceptedQty: 50, rejectedQty: 0, locationId: loc['Z-A-B01'], inventoryItemId: items.cement, notes: b.ref('RCV-B') }]);
    await receive(s, 'C', pos.c, [{ poLineId: pos.c.lineId, acceptedQty: WP5.O2.received.value, rejectedQty: 0, locationId: loc['Z-A-B02'], inventoryItemId: items.cement2, notes: b.ref('RCV-C') }]);
    await receive(s, 'O4', pos.o4, [{ poLineId: pos.o4.lineId, acceptedQty: WP5.O4.acceptedStock.value, rejectedQty: WP5.O4.rejectedQty.value, locationId: loc['Z-A-B02'], inventoryItemId: items.blocks, notes: b.ref('RCV-O4') }]);
    await receive(s, 'SVC', pos.svc, [{ poLineId: pos.svc.lineId, acceptedQty: 100, rejectedQty: 0, notes: b.ref('RCV-SVC') }]);
    const orderLine = async (key) => {
      const order = await poGet(s, pos[key].id);
      return { status: order.status, line: one(order.lines, (l) => l.id === pos[key].lineId, `PO-${key}: its line`) };
    };
    const got = { a: await orderLine('a'), b: await orderLine('b'), c: await orderLine('c'), o4: await orderLine('o4'), svc: await orderLine('svc') };
    s.expectFields(got, {
      'a.status': 'received', 'a.line.receivedQty': 100, 'a.line.rejectedQty': 0,
      'b.status': 'received', 'b.line.receivedQty': 50, 'b.line.rejectedQty': 0,
      'c.status': WP5.O2.statusAfterPartial.value, 'c.line.orderedQty': WP5.O2.ordered.value, 'c.line.receivedQty': WP5.O2.received.value, 'c.line.rejectedQty': 0,
      'o4.status': 'partial', 'o4.line.receivedQty': WP5.O4.acceptedStock.value, 'o4.line.rejectedQty': WP5.O4.rejectedQty.value,
      'svc.status': 'received', 'svc.line.receivedQty': 100,
    }, 'orders and lines after the deliveries');
    // WP5.existing / stage4: 100 @ 10 + 50 @ 13 = 150 bags at a weighted average of 11.00; O2's 60; O4's 10 (rejected never stocked).
    s.expectFields(await itemGet(s, items.cement), { onHand: 150, averageCost: asCents(STAGE4.weightedAverage) }, 'cement after PO-A and PO-B');
    s.expectFields(await itemGet(s, items.cement2), { onHand: WP5.O2.received.value }, 'O2 cement after its receipt');
    s.expectFields(await itemGet(s, items.blocks), { onHand: WP5.O4.acceptedStock.value }, 'blocks after O4 (WP5.O4.acceptedStock)');
    return { states: Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.status])) };
  }, { needs: ['purchase-orders', 'warehouses'] });

  // The closes the plan names: HEAD refuses both (HR-C8, observed D-FUN-1): BLOCKED with today's answer.
  await b.step('po.C.close-short', async (s) => {
    // WP5.O2.forceWithReason: expected 200 closed; today 409 PO_TRANSITION_INVALID (no partial -> closed row; D-FUN-1).
    await s.act('po.C.close.force', 'procurement', 'POST', `${poRoute(pos.c.id)}/close`, { force: true, reason: `Closed short: balance no longer required ${b.ref('PO-C')}` }, {
      fields: { status: WP5.O2.forceWithReason.value },
      known: { ref: 'HR-C8', said: [`${WP5.O2.forceWithReason.today.status} ${WP5.O2.forceWithReason.today.code}`] },
      verify: async (s2) => (await poGet(s2, pos.c.id)).status === WP5.O2.forceWithReason.value,
    });
    return { status: WP5.O2.forceWithReason.value };
  }, { needs: ['receipts'] });
  await b.step('po.A.close-received', async (s) => {
    // WP5.O2.fullyReceivedClose: expected 200 closed without force; today 409 PO_TRANSITION_INVALID (D-FUN-1).
    await s.act('po.A.close', 'procurement', 'POST', `${poRoute(pos.a.id)}/close`, { reason: `Delivered in full ${b.ref('PO-A')}` }, {
      fields: { status: WP5.O2.fullyReceivedClose.value },
      known: { ref: 'HR-C8', said: [`${WP5.O2.fullyReceivedClose.today.status} ${WP5.O2.fullyReceivedClose.today.code}`] },
      verify: async (s2) => (await poGet(s2, pos.a.id)).status === WP5.O2.fullyReceivedClose.value,
    });
    return { status: WP5.O2.fullyReceivedClose.value };
  }, { needs: ['receipts'] });

  // Inventory movements: issues to an activity and to a cost code only, quarantine, transfers, returns, damage, serials, reservation.
  /** A movement on the stock ledger, by its reference (unique in the build) and its type: at most one (R2-D). */
  const stockRow = async (s, itemId, reference, type) => atMostOne(listOf(await s.get('warehouse', `/inventory/stock/transactions?itemId=${itemId}&limit=500`)), (row) => row.reference === reference && row.type === type, `the ${type} movement ${reference}`);
  /**
   * A stock movement (round 2 R2-C), settled through the lib in every case, never left pending: made (its answer's
   * `fields` asserted); a pending record (sent by a killed run) settled by the act's verify; a movement already on the
   * ledger with no record of this state adopted (adopt: true), so it is never made twice. Whichever way, the ledger row
   * itself is then read live and asserted (`ledger`: its type, signed quantity and, where given, the bin balance after it).
   */
  const move = async (s, key, persona, verb, body, fields, ledger) => {
    const onLedger = async (s2) => Boolean(await stockRow(s2, body.itemId, body.reference, ledger.type));
    const data = await s.act(`stock.${key}`, persona, 'POST', `/inventory/stock/${verb}`, body, {
      fields,
      expect: [200, 201],
      adopt: true,
      find: onLedger,
      verify: onLedger,
    });
    const row = await stockRow(s, body.itemId, body.reference, ledger.type);
    s.assert(Boolean(row), `stock.${key}: the ${ledger.type} movement ${body.reference} is on the stock ledger`);
    s.expectFields(row, { type: ledger.type, quantity: ledger.quantity, ...(ledger.balanceAfter === undefined ? {} : { balanceAfter: ledger.balanceAfter }) }, `stock.${key} on the ledger`);
    return data;
  };
  /** The movement of `type` in a stock answer: its quantity and the bin's balance after it. */
  const movement = (type, quantity, balanceAfter) => (v) => (Array.isArray(v) && v.filter((m) => m.type === type && Number(m.quantity) === quantity && (balanceAfter === undefined || Number(m.balanceAfter) === balanceAfter)).length === 1) || `one ${type} movement of ${quantity}${balanceAfter === undefined ? '' : `, the bin then at ${balanceAfter}`}`;
  await b.step('inventory', async (s) => {
    const site = warehouses.site;
    const loc = warehouses.siteLocations;
    const base = { projectId: b.projectId };
    // N1 / N6 / stage 4: issue 60 cement to A130 at 11.00 = 660.00 (WP4 stage4:170 issue60Cost; the N6 plan row). 150 -> 90.
    await move(s, 'issue-60', 'warehouse', 'issue', { ...base, itemId: items.cement, warehouseId: site, quantity: 60, activityId: A.A130, costCodeId: codeId('02-100'), reference: b.ref('ISS-60'), notes: b.ref('ISS-60') }, {
      costPosted: true,
      movements: (v) => movement('issue', -60, 90)(v) === true && v.some((m) => m.type === 'issue' && lib.sameCents(m.value, major(STAGE4.issue60Cost))) || 'one issue of 60 at 660.00, the bin then at 90',
    }, { type: 'issue', quantity: -60, balanceAfter: 90 });
    // A direct receipt of tie wire with one damaged on delivery (50 in, 1 written off: 49), then 5 kg issued to a cost code only (WP5.N1.costCodeOnly).
    await move(s, 'wire-receive', 'warehouse', 'receive', { ...base, itemId: items.wire, warehouseId: site, locationId: loc['Z-A-B02'], quantity: 50, unitCost: 2, damagedQty: 1, damageNotes: `One coil crushed ${b.ref('WIRE')}`, reference: b.ref('RCV-WIRE'), notes: b.ref('RCV-WIRE') }, {
      '$status': (v) => v === 200 || v === 201 || 'a receipt',
      type: 'receipt',
      quantity: 50,
    }, { type: 'receipt', quantity: 50 });
    // Cost code only: no activity and no project, so no project cost is posted (costPosted false, costNote).
    await move(s, 'wire-issue-costcode', 'warehouse', 'issue', { itemId: items.wire, warehouseId: site, quantity: 5, costCodeId: codeId('02-100'), reference: b.ref('ISS-WIRE-CC'), notes: b.ref('ISS-WIRE-CC') }, { costPosted: WP5.N1.costCodeOnly.value, costNote: is.present, movements: movement('issue', -5) }, { type: 'issue', quantity: -5 });
    // The O2 cement (60 in bin Z-A-B02): quarantine 5 (55 left), release 2 (57), damage 1 (56), issue 10 to A310 (46), return 4 (50).
    await move(s, 'quarantine', 'warehouse', 'quarantine', { ...base, itemId: items.cement2, warehouseId: site, locationId: loc['Z-A-B02'], quantity: 5, reference: b.ref('QTN'), notes: `Held for the test certificate ${b.ref('QTN')}` }, { movements: movement('quarantine', -5, 55) }, { type: 'quarantine', quantity: -5, balanceAfter: 55 });
    await move(s, 'release', 'warehouse', 'release', { ...base, itemId: items.cement2, warehouseId: site, locationId: loc['Z-A-B02'], quantity: 2, reference: b.ref('REL'), notes: `Certificate received for part of the batch ${b.ref('REL')}` }, { movements: movement('release', 2, 57) }, { type: 'release', quantity: 2, balanceAfter: 57 });
    await move(s, 'damage', 'warehouse', 'damage', { ...base, itemId: items.cement2, warehouseId: site, locationId: loc['Z-A-B02'], quantity: 1, reference: b.ref('DMG'), notes: `Split bag ${b.ref('DMG')}` }, { movements: movement('damage', -1, 56) }, { type: 'damage', quantity: -1, balanceAfter: 56 });
    await move(s, 'issue-10', 'warehouse', 'issue', { ...base, itemId: items.cement2, warehouseId: site, quantity: 10, activityId: A.A310, costCodeId: codeId('02-100'), reference: b.ref('ISS-10'), notes: b.ref('ISS-10') }, { costPosted: true, movements: movement('issue', -10, 46) }, { type: 'issue', quantity: -10, balanceAfter: 46 });
    // Return 4 of the 10 issued to A310.
    await move(s, 'return-4', 'site', 'return', { ...base, itemId: items.cement2, warehouseId: site, locationId: loc['Z-A-B02'], quantity: 4, activityId: A.A310, costCodeId: codeId('02-100'), reference: b.ref('RET-4'), notes: `Unused, back to the store ${b.ref('RET-4')}` }, { movements: movement('return', 4, 50) }, { type: 'return', quantity: 4, balanceAfter: 50 });
    // The serial item: two units in, one issued by serial.
    for (const n of [1, 2]) {
      await move(s, `meter-${n}`, 'warehouse', 'receive', { ...base, itemId: items.meter, warehouseId: site, locationId: loc['Z-A-B02'], quantity: 1, unitCost: 85, serialNo: `SN-087COM-${n}`, reference: b.ref(`MTR-${n}`), notes: b.ref(`MTR-${n}`) }, { '$status': (v) => v === 200 || v === 201 || 'a receipt', type: 'receipt', quantity: 1 }, { type: 'receipt', quantity: 1 });
    }
    await move(s, 'meter-issue', 'site', 'issue', { ...base, itemId: items.meter, warehouseId: site, locationId: loc['Z-A-B02'], quantity: 1, serialNo: 'SN-087COM-1', activityId: A.A300, costCodeId: codeId('02-100'), reference: b.ref('ISS-MTR'), notes: b.ref('ISS-MTR') }, { costPosted: true, movements: movement('issue', -1) }, { type: 'issue', quantity: -1 });
    // Resulting quantities (R2-8): WP5.existing on hand 90 at 11.00 = 990.00; wire 50 - 1 - 5 = 44 (1 damaged);
    // O2 cement 50 on hand with 3 quarantined and 1 damaged; one meter left.
    s.expectFields(await itemGet(s, items.cement), { onHand: WP5.existing.stockOnHand.value, value: asCents(WP5.existing.stockValue), reserved: 0, quarantined: 0 }, 'cement after the issue (WP5.existing)');
    s.expectFields(await itemGet(s, items.wire), { onHand: 44, damaged: 1 }, 'tie wire');
    s.expectFields(await itemGet(s, items.cement2), { onHand: 50, quarantined: 3, damaged: 1 }, 'O2 cement after its movements');
    s.expectFields(await itemGet(s, items.meter), { onHand: 1 }, 'the serial item after one issued');
    return { done: true };
  }, { needs: ['receipts'] });

  // Transfers of the O2 cement: full, and short with one damaged (WP5.N4's shape: 10 sent, 7 received, 1 damaged, 2 short).
  await b.step('transfers', async (s) => {
    // The transfer register is the company's: only this project's stores are this build's.
    const list = async () => listOf(await s.get('warehouse', '/inventory/transfers')).filter((row) => row.fromWarehouseId === warehouses.site);
    const transfer = async (key, quantity) => {
      const reason = `${b.name(`Transfer ${key}`)} to the laydown yard`;
      const made = await s.create(`transfer.${key}`, 'warehouse', '/inventory/transfers', {
        fromWarehouseId: warehouses.site,
        toWarehouseId: warehouses.yard,
        reason,
        notes: b.ref(`TRF-${key}`),
        lines: [{ itemId: items.cement2, quantity, notes: b.ref(`TRF-${key}`) }],
      }, {
        get: '/inventory/transfers',
        fields: { status: 'draft', lines: (v) => (Array.isArray(v) && v.length === 1 && v[0].itemId === items.cement2 && Number(v[0].quantity) === quantity) || `one line of ${quantity} O2 cement` },
        adopt: true,
        find: async () => atMostOne(await list(), (row) => row.reason === reason, `transfer ${key}`),
      });
      const row = async () => one(await list(), (r) => r.id === made.id, `transfer ${key}`);
      if ((await row()).status === 'draft' || pendingRecord(`transfer.${key}.dispatch`)) {
        await s.act(`transfer.${key}.dispatch`, 'warehouse', 'POST', `/inventory/transfers/${made.id}/dispatch`, {}, { fields: { status: 'in_transit' }, verify: async () => (await row()).status !== 'draft' });
      }
      return { id: made.id, row };
    };
    const full = await transfer('FULL', 10);
    if ((await full.row()).status === 'in_transit' || pendingRecord('transfer.FULL.receive')) {
      await s.act('transfer.FULL.receive', 'warehouse', 'POST', `/inventory/transfers/${full.id}/receive`, {}, { fields: { status: 'received' }, verify: async () => (await full.row()).status === 'received' });
    }
    const short = await transfer('SHORT', 10);
    if ((await short.row()).status === 'in_transit' || pendingRecord('transfer.SHORT.receive')) {
      const shortLine = one((await short.row()).lines || [], (l) => l.itemId === items.cement2, 'transfer SHORT: its line');
      await s.act('transfer.SHORT.receive', 'warehouse', 'POST', `/inventory/transfers/${short.id}/receive`, { lines: [{ id: shortLine.id, receivedQty: 7, damagedQty: 1 }] }, {
        fields: { status: 'received', lines: (v) => (Array.isArray(v) && v.filter((l) => l.id === shortLine.id && Number(l.receivedQty) === 7 && Number(l.damagedQty) === 1).length === 1) || 'the line received 7 with 1 damaged' },
        verify: async () => (await short.row()).status !== 'in_transit',
      });
    }
    // Resulting quantities: FULL moves 10 to the yard (50 on hand); SHORT lands 7, writes off 1 damaged and 2 short: 47
    // on hand, 2 damaged in all, 3 still quarantined, nothing in transit.
    s.expectFields({ full: (await full.row()).status, short: (await short.row()).status }, { full: 'received', short: 'received' }, 'transfer states');
    s.expectFields(await itemGet(s, items.cement2), { onHand: 47, damaged: 2, quarantined: 3, inTransit: 0 }, 'O2 cement after the transfers');
    return { full: full.id, short: short.id };
  }, { needs: ['inventory'] });

  // The reservation, last (WP5.N1: on hand 90, reserve 50, available 40 on the cement no other movement touches, R2-4).
  await b.step('reservation', async (s) => {
    const reference = b.ref('RES-50');
    const before = await itemGet(s, items.cement);
    if (Number(before.reserved) === 0 || pendingRecord('stock.reserve-50')) {
      await s.act('stock.reserve-50', 'site', 'POST', '/inventory/stock/reserve', { itemId: items.cement, warehouseId: warehouses.site, quantity: 50, reference, notes: `Held for the raft pour ${reference}` }, {
        fields: { onHand: WP5.existing.stockOnHand.value, reserved: 50, available: WP5.N1.availableAfterReserve.value },
        verify: async (s2) => Number((await itemGet(s2, items.cement)).reserved) === 50,
      });
    }
    const after = await itemGet(s, items.cement);
    s.expectFields(after, { onHand: WP5.existing.stockOnHand.value, reserved: 50, available: WP5.N1.availableAfterReserve.value, quarantined: 0, averageCost: asCents(STAGE4.weightedAverage) }, 'cement reserved (WP5.N1.availableAfterReserve)');
    return { onHand: after.onHand, reserved: after.reserved, available: after.available };
  }, { needs: ['transfers'] });

  // ── the bid package: three bidders, a withdrawal, a late bid, the non-lowest awarded on the override (WP5.R1) ──
  const bids = await b.step('bids', async (s) => {
    const R1 = WP5.R1;
    const pkgNumber = b.ref('PP-REBAR');
    const packagesRoute = `${b.P}/procurement/packages`;
    const procurementPackage = await s.create('procurement-package', 'procurement', packagesRoute, {
      packageNumber: pkgNumber,
      title: `${b.name('Rebar supply')} ${pkgNumber}`,
      description: `High tensile reinforcement for the foundations ${pkgNumber}`,
      activityId: A.A130,
      status: 'tendering',
      buyer: `Buyer ${pkgNumber}`,
      plannedAwardDate: b.date(10, { future: true }),
      requiredOnSiteDate: b.date(60, { future: true }),
      requiredTiming: 'activity_start',
      leadWeeks: 2,
      bufferDays: 7,
      notes: pkgNumber,
    }, {
      get: packagesRoute,
      fields: { packageNumber: pkgNumber },
      adopt: true,
      find: async (s2) => atMostOne(listOf(await s2.get('procurement', packagesRoute)), (row) => row.packageNumber === pkgNumber, `procurement package ${pkgNumber}`),
    });
    const title = `${b.name('Rebar enquiry')} ${pkgNumber}`;
    const enquiry = await s.create('bid-package', 'procurement', `${packagesRoute}/${procurementPackage.id}/quotes`, {
      title,
      description: `Price 60 t of high tensile reinforcement, delivered ${b.ref('BID')}`,
      instructions: `Quote per tonne; state the lead time ${b.ref('BID')}`,
      dueAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    }, {
      get: (id) => `${b.P}/bids/${id}`,
      fields: { title },
      adopt: true,
      find: async (s2) => atMostOne(listOf(await s2.get('procurement', `${b.P}/bids`)), (row) => row.title === title, `bid package ${title}`),
    });
    const pkgId = enquiry.id;
    const read = async () => s.get('procurement', `${b.P}/bids/${pkgId}`);
    const packageLine = async () => one((await read()).lines || [], (l) => l.boqItemId === boq.ids['B-003'], 'the bid package line of B-003');
    if (!((await read()).lines || []).length || pendingRecord('bid.lines')) {
      await s.act('bid.lines', 'procurement', 'POST', `${b.P}/bids/${pkgId}/lines/from-boq`, { boqItemIds: [boq.ids['B-003']] }, {
        expect: [200, 201],
        fields: { id: pkgId },
        verify: async () => ((await read()).lines || []).some((l) => l.boqItemId === boq.ids['B-003']),
      });
    }
    let pline = await packageLine();
    if (!pline.activityId || pendingRecord('bid.line.coding')) {
      await s.act('bid.line.coding', 'procurement', 'PATCH', `${b.P}/bids/${pkgId}/lines/${pline.id}`, { activityId: A.A130, costCodeId: codeId('02-100'), budgetLineId: lineId('02-100', 'material') }, {
        fields: { id: pkgId },
        verify: async () => (await packageLine()).activityId === A.A130,
      });
      pline = await packageLine();
    }
    // WP5.R1 bids (stage 11 rates): Gulf 1,150 (lowest), Northern 1,190, Emirates 1,240 (awarded); Coastal withdraws; Late is past due.
    const BIDDERS = [['gulf', 'Gulf Rebar Trading', 1150], ['northern', 'Northern Steel Mills', 1190], ['emirates', 'Emirates Rebar Trading', 1240], ['coastal', 'Coastal Building Supplies', 1210], ['late', 'Late Steel Stockists', 1180]];
    const mail = (key) => `${key}.087com@bidders.c087.octapm-cert.test`;
    const invitationOf = async (key) => one((await read()).invitations || [], (row) => row.contactEmail === mail(key), `the invitation of ${key}`);
    if (!((await read()).invitations || []).length || pendingRecord('bid.invitations')) {
      await s.create('bid.invitations', 'procurement', `${b.P}/bids/${pkgId}/invitations`, {
        invitations: BIDDERS.map(([key, label]) => ({ companyName: b.name(label), contactName: `Estimator ${b.ref(key)}`, contactEmail: mail(key) })),
      }, {
        get: `${b.P}/bids/${pkgId}`,
        idOf: (d) => atMostOne(listOf(d, 'invitations'), (row) => row.contactEmail === mail('gulf'), 'the invitation of gulf')?.id ?? null,
        fields: { length: (v, d) => BIDDERS.every(([key]) => listOf(d, 'invitations').filter((row) => row.contactEmail === mail(key)).length === 1) || `one invitation each for ${BIDDERS.length} bidders` },
        find: async () => {
          const invitations = (await read()).invitations || [];
          return BIDDERS.every(([key]) => invitations.some((row) => row.contactEmail === mail(key))) ? { items: invitations } : null;
        },
      });
    }
    // Published with a due time a little ahead; a resumed run past the due time reopens it.
    const pkg = await read();
    const bidsNow = async (s2 = s) => listOf(await s2.get('procurement', `${b.P}/bids/${pkgId}/bids`));
    const bidOfKey = async (key, s2 = s) => {
      const invitationId = (await invitationOf(key)).id;
      return atMostOne(await bidsNow(s2), (row) => row.invitationId === invitationId, `the bid of ${key}`);
    };
    const onTimeDone = async () => (await bidOfKey('gulf'))?.status === 'submitted' && (await bidOfKey('northern'))?.status === 'submitted' && (await bidOfKey('emirates'))?.status === 'submitted' && (await bidOfKey('coastal'))?.status === 'withdrawn';
    const dueIn = 150_000;
    if (pkg.status === 'draft' || pendingRecord('bid.publish')) {
      await s.act('bid.due', 'procurement', 'PATCH', `${b.P}/bids/${pkgId}`, { dueAt: new Date(Date.now() + dueIn).toISOString() }, {
        fields: { id: pkgId },
        // Re-sent after an interruption unless the due time is still comfortably ahead (the PATCH only moves it).
        verify: async () => new Date((await read()).dueAt).getTime() > Date.now() + 60_000,
      });
      await s.act('bid.publish', 'procurement', 'POST', `${b.P}/bids/${pkgId}/publish`, {}, { fields: { status: 'open' }, verify: async () => (await read()).status !== 'draft' });
    } else if (!(await onTimeDone()) && new Date((await read()).dueAt) <= new Date(Date.now() + 60_000)) {
      // A resumed run past the due time closes and reopens with a new one; the records are named by the due time they
      // replace, so an interrupted close or reopen is settled by its verify on the next resume, never sent twice.
      const replaced = Date.parse((await read()).dueAt);
      if ((await read()).status === 'open' || pendingRecord(`bid.close-for-reopen.${replaced}`)) await s.act(`bid.close-for-reopen.${replaced}`, 'procurement', 'POST', `${b.P}/bids/${pkgId}/close`, {}, { fields: { status: 'closed' }, verify: async () => (await read()).status === 'closed' });
      await s.act(`bid.reopen.${replaced}`, 'procurement', 'POST', `${b.P}/bids/${pkgId}/reopen`, { dueAt: new Date(Date.now() + dueIn).toISOString() }, { fields: { status: 'open' }, verify: async () => (await read()).status === 'open' && Date.parse((await read()).dueAt) !== replaced });
    }
    // A bidder's personal link: every e-mail replaces it, so it is asked for when needed (procurement driver tokenFor).
    const tokenFor = async (key) => {
      const invitation = await invitationOf(key);
      const resent = await b.send('procurement', 'POST', `${b.P}/bids/${pkgId}/invitations/${invitation.id}/resend`, {});
      s.assert(resent.status === 200, `the bid link for ${key} answered 200 (got ${lib.said(resent)})`);
      return C.tokenOf(resent.body?.data?.portalUrl, '/bid/');
    };
    const priceBid = async (key, rate) => {
      const token = await tokenFor(key);
      const saved = await C.portal(b, 'PUT', `/public/bids/${token}/bid`, { lines: [{ packageLineId: pline.id, rate, included: true, note: b.ref(key) }], leadTimeDays: key === 'emirates' ? 14 : 30, validityDays: 30, notes: `Quotation ${b.ref(key)}` });
      s.assert(saved.status === 200, `${key}'s priced bid saved (got ${lib.said(saved)})`);
      return token;
    };
    const priceAndSubmit = async (key, rate, { submit = true } = {}) => {
      const current = await bidOfKey(key);
      if (current && ['submitted', 'withdrawn'].includes(current.status)) return;
      const token = await priceBid(key, rate);
      if (!submit) return;
      const sent = await C.portal(b, 'POST', `/public/bids/${token}/bid/submit`, { submittedBy: `Estimator ${b.ref(key)}` });
      s.assert(sent.status === 200, `${key}'s bid submitted (got ${lib.said(sent)})`);
    };
    // Coastal submits, then withdraws: two portal calls recorded like acts (R2-10), each settled by a live read of the
    // bid after an interruption, so a run killed between them still withdraws on resume.
    const coastal = async (rate) => {
      const submitRec = b.state.records['bid.coastal.submit'];
      const current = await bidOfKey('coastal');
      if ((!submitRec || submitRec.status === 'pending') && !(current && ['submitted', 'withdrawn'].includes(current.status))) await priceBid('coastal', rate);
      // The bid in each answer (serializeBid) is asserted before the record is done (R2-C).
      await C.portalAct(s, 'bid.coastal.submit', 'POST', async () => `/public/bids/${await tokenFor('coastal')}/bid/submit`, { submittedBy: `Estimator ${b.ref('coastal')}` }, {
        label: '/public/bids/<token>/bid/submit',
        fields: { status: 'submitted', id: is.present },
        verify: async (s2) => ['submitted', 'withdrawn'].includes((await bidOfKey('coastal', s2))?.status),
      });
      await C.portalAct(s, 'bid.coastal.withdraw', 'POST', async () => `/public/bids/${await tokenFor('coastal')}/bid/withdraw`, {}, {
        label: '/public/bids/<token>/bid/withdraw',
        fields: { status: 'withdrawn', id: is.present },
        verify: async (s2) => (await bidOfKey('coastal', s2))?.status === 'withdrawn',
      });
    };
    if ((await read()).status === 'open') {
      for (const [key, , rate] of BIDDERS) {
        if (key === 'coastal') await coastal(rate);
        else await priceAndSubmit(key, rate, { submit: key !== 'late' });
      }
    }
    s.assert(await onTimeDone(), 'three bids submitted and one withdrawn before the due time');
    // The late bid: wait for the due time, then the submit is refused (WP5.R1.submitAfterDue).
    const due = new Date((await read()).dueAt).getTime();
    if (Date.now() < due + 2000) {
      const wait = due + 2000 - Date.now();
      s.note(`waiting ${Math.round(wait / 1000)} s for the due time to pass before the late bid`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    const lateToken = await tokenFor('late');
    const lateRes = await C.portal(b, 'POST', `/public/bids/${lateToken}/bid/submit`, { submittedBy: `Estimator ${b.ref('late')}` });
    s.assert(lib.said(lateRes) === saidOf(R1.submitAfterDue), `the late bid is refused ${saidOf(R1.submitAfterDue)} (got ${lib.said(lateRes)})`);
    if ((await read()).status === 'open' || pendingRecord('bid.close')) {
      await s.act('bid.close', 'procurement', 'POST', `${b.P}/bids/${pkgId}/close`, {}, { fields: { status: 'closed' }, verify: async () => (await read()).status !== 'open' });
    }
    const emirates = await bidOfKey('emirates');
    const gulf = await bidOfKey('gulf');
    const northern = await bidOfKey('northern');
    // WP5.R1 bid totals 69,000 / 71,400 / 74,400.
    s.expectFields({ gulf: gulf.total, northern: northern.total, emirates: emirates.total }, { gulf: asCents(R1['bid.gulf.total']), northern: asCents(R1['bid.northern.total']), emirates: asCents(R1['bid.emirates.total']) }, 'bid totals');
    if ((await read()).status !== 'awarded' || pendingRecord('bid.confirm')) {
      if ((await read()).softAwardBidId !== emirates.id || pendingRecord('bid.soft-award')) {
        await s.act('bid.soft-award', 'pm', 'POST', `${b.P}/bids/${pkgId}/award`, { bidId: emirates.id }, { fields: { status: 'closed' }, verify: async () => (await read()).softAwardBidId === emirates.id });
      }
      const confirm = { bidId: emirates.id, title: b.name('Rebar supply agreement'), retentionRate: 0, startDate: b.today, endDate: b.date(120, { future: true }) };
      // WP5.R1.unqualifiedAward: confirm without the override reason is refused; with it, the commitment is made.
      await s.refused('bid.confirm.no-override', 'pm', 'POST', `${b.P}/bids/${pkgId}/award/confirm`, confirm, saidOf(R1.unqualifiedAward), {
        // An interrupted probe is found by what a wrongly accepted one would have made: an awarded package.
        find: async () => {
          const now = await read();
          return now.status === 'awarded' ? { id: now.awardedCommitmentId, package: now } : null;
        },
      });
      await s.create('bid.confirm', 'pm', `${b.P}/bids/${pkgId}/award/confirm`, { ...confirm, prequalOverrideReason: `14-day lead time beats the lowest bid's 30 days ${b.ref('AWARD')}` }, {
        get: (id) => `${b.P}/commitments/${id}`,
        idOf: (d) => d?.commitment?.id ?? null,
        fields: { 'package.status': 'awarded', 'commitment.id': is.present },
        // Adopted from the live package and the commitment it names (read back), never a made-up object.
        find: async (s2) => {
          const now = await read();
          if (now.status !== 'awarded') return null;
          return { package: now, commitment: await commitmentGet(s2, now.awardedCommitmentId) };
        },
      });
    }
    const awarded = await read();
    s.expectFields(awarded, { status: 'awarded', awardedBidId: emirates.id, awardedCommitmentId: is.present }, 'the awarded package (the non-lowest, on the override)');
    s.finding('WP5-AWD-1', `The rebar package was awarded to Emirates (${money(cents(emirates.total))}), not the lowest bid (Gulf ${money(cents(gulf.total))}; WP5.R1.awardedNotLowestGap ${money(R1.awardedNotLowestGap.value)}). The product has no "not the lowest" justification on an award: confirming without an override answered ${saidOf(R1.unqualifiedAward)} (WP5.R1.unqualifiedAward), and the only override the confirm takes is the prequalification override (prequalOverrideReason), which the build used for the plan's "awarded on an override".`);
    return { procurementPackageId: procurementPackage.id, bidPackageId: pkgId, awardedBidId: emirates.id, lowestBidId: gulf.id, commitmentId: awarded.awardedCommitmentId };
  }, { needs: ['boq', 'budget-lines', 'activities'] });

  // The PO raised from the award (WP5.R4.awardPoValue 74,400.00), issued.
  await b.step('po.from-award', async (s) => {
    const registerRow = async (s2) => {
      const row = atMostOne(listOf(await s2.get('procurement', `${b.P}/procurement/purchase-orders`)), (r) => r.packageId === bids.procurementPackageId, 'the purchase order from the award');
      return row ? poGet(s2, row.id) : null;
    };
    const made = await s.create('po.AWARD', 'procurement', `${b.P}/procurement/packages/${bids.procurementPackageId}/order`, {
      requiredBy: b.date(40, { future: true }),
      leadWeeks: 2,
      notes: `Raised from the award ${b.ref('PO-AWARD')}`,
    }, {
      get: (id) => poRoute(id),
      fields: { value: asCents(WP5.R4.awardPoValue) },
      find: registerRow,
    });
    const status = await poTo(s, 'AWARD', made.id, 'issued');
    s.assert(status === 'issued', `the award's PO is issued (read ${status})`);
    return { id: made.id, ref: made.ref };
  }, { needs: ['bids', 'suppliers'] });

  // ── supplier invoices (the three-way match) ──
  const dcGet = (s, id) => s.get('cost', `${b.P}/direct-costs/${id}`);
  /** A direct cost as a draft; its lines (description, quantity, unit cost, amount), total and order asserted (R2-8, item 4). */
  const directCost = async (s, key, body) => {
    const description = `${b.name(`Direct cost ${key}`)}: ${body.what}`;
    const { what, ...rest } = body;
    const total = rest.lines.reduce((sum, l) => sum + l.amount, 0) + (rest.tax || 0);
    return s.create(`dc.${key}`, 'cost', `${b.P}/direct-costs`, { description, notes: b.ref(`DC-${key}`), ...rest }, {
      fields: {
        status: 'draft',
        type: rest.type,
        total: is.cents(total),
        ...(rest.purchaseOrderId ? { purchaseOrderId: rest.purchaseOrderId } : {}),
        lines: (v) => (Array.isArray(v) && v.length === rest.lines.length && rest.lines.every((l) => v.filter((row) => row.description === l.description && Number(row.quantity) === l.quantity && lib.sameCents(row.unitCost, l.unitCost) && lib.sameCents(row.amount, l.amount)).length === 1)) || 'the lines as sent (description, quantity, unit cost, amount)',
      },
      adopt: true,
      find: async (s2) => atMostOne(listOf(await s2.get('cost', `${b.P}/direct-costs`)), (row) => row.description === description, `direct cost ${key}`),
    });
  };
  const dcTo = async (s, key, id, target, { payDate = null, voidReason = null } = {}) => {
    const status = async () => (await dcGet(s, id)).status;
    const go = (verb, persona, body, done) => s.act(`dc.${key}.${verb}`, persona, 'POST', `${b.P}/direct-costs/${id}/${verb}`, body, { fields: { id }, verify: async () => done.includes(await status()) });
    const due = async (state, verb) => (await status()) === state || pendingRecord(`dc.${key}.${verb}`);
    if (target === 'void' && voidReason?.from === 'draft' && (await due('draft', 'void'))) return go('void', 'finance', { reason: voidReason.text }, ['void']);
    if (['pending', 'approved', 'paid', 'void'].includes(target) && (await due('draft', 'submit'))) await go('submit', 'cost', {}, ['pending', 'approved', 'paid', 'void']);
    if (target === 'void' && voidReason?.from === 'pending' && (await due('pending', 'void'))) return go('void', 'finance', { reason: voidReason.text }, ['void']);
    if (['approved', 'paid', 'void'].includes(target) && (await due('pending', 'approve'))) await go('approve', 'finance', {}, ['approved', 'paid', 'void']);
    if (target === 'void' && (await due('approved', 'void'))) return go('void', 'finance', { reason: voidReason.text }, ['void']);
    if (target === 'paid' && ((await status()) === 'approved' || pendingRecord(`dc.${key}.pay`))) {
      const total = Number((await dcGet(s, id)).total);
      const reference = b.ref(`DC-${key}-PAY`);
      await s.create(`dc.${key}.pay`, 'finance', `${b.P}/direct-costs/${id}/payments`, { amount: total, paidAt: `${b.past(payDate)}T09:00:00.000Z`, method: 'bank_transfer', reference, note: `Paid ${reference}` }, {
        get: `${b.P}/direct-costs/${id}`,
        idOf: (d) => atMostOne(d?.payments || [], (p) => p.reference === reference, `direct cost payment ${reference}`)?.id ?? null,
        fields: { status: 'paid' },
        find: async (s2) => (atMostOne((await dcGet(s2, id)).payments || [], (p) => p.reference === reference, `direct cost payment ${reference}`) ? dcGet(s2, id) : null),
      });
    }
    return null;
  };
  const dcLine = (desc, amount, { code = '02-100', type = 'material', activity = 'A130', poLineId = null, quantity = 1, unitCost = amount, unit = 'ls' } = {}) => ({
    description: `${desc} (${b.code})`,
    costCodeId: codeId(code),
    budgetLineId: lineId(code, type),
    activityId: A[activity],
    costType: type,
    quantity,
    unit,
    unitCost,
    amount,
    ...(poLineId ? { poLineId } : {}),
  });

  await b.step('supplier-invoices', async (s) => {
    const out = {};
    const invoiceBase = (key, order) => ({ type: 'invoice', vendorCompanyId: companyId('supplier'), invoiceNumber: b.ref(`SINV-${key}`), purchaseOrderId: order.id, costDate: b.past('2026-10-01'), dueDate: b.date(30, { future: true }) });
    // WP5.D5.priceVarianceVerdict: PO-B 50 @ 13 invoiced 50 @ 14 -> left pending (approval waits on HR-C5).
    const variance = await directCost(s, 'SINV-VAR', { what: 'cement invoiced above the order price', ...invoiceBase('VAR', pos.b), lines: [dcLine('Cement OPC 42.5N', 700, { poLineId: pos.b.lineId, quantity: 50, unitCost: 14, unit: 'bag' })] });
    await dcTo(s, 'SINV-VAR', variance.id, 'pending');
    out.variance = variance.id;
    // WP5.D5.overInvoicedLedger (adjudication 087-COM item 4): the received service line (crane hire, 100 hr received)
    // invoiced 60 then 60 = 120 > 100: the first approved, the second pending. Creation fields asserted; the ledger is WP-5's.
    const over1 = await directCost(s, 'SINV-OVER1', { what: 'crane hire 60 hours', ...invoiceBase('OVER1', pos.svc), lines: [dcLine('Mobile crane hire', 600, { poLineId: pos.svc.lineId, quantity: 60, unitCost: 10, unit: 'hr', activity: 'A200' })] });
    await dcTo(s, 'SINV-OVER1', over1.id, 'approved');
    const over2 = await directCost(s, 'SINV-OVER2', { what: 'crane hire another 60 hours', ...invoiceBase('OVER2', pos.svc), lines: [dcLine('Mobile crane hire', 600, { poLineId: pos.svc.lineId, quantity: 60, unitCost: 10, unit: 'hr', activity: 'A200' })] });
    await dcTo(s, 'SINV-OVER2', over2.id, 'pending');
    out.overInvoiced = [over1.id, over2.id];
    // WP5-SVC-1: the received service line became a stocked item at goods receipt, so the approved invoice is capitalised.
    const svcLine = one((await poGet(s, pos.svc.id)).lines, (l) => l.id === pos.svc.lineId, 'PO-SVC: its line');
    const over1Line = one((await dcGet(s, over1.id)).lines, (l) => l.description === `Mobile crane hire (${b.code})`, 'SINV-OVER1: its line');
    s.expectFields(svcLine, { receivedQty: 100 }, 'PO-SVC received in full (the over-invoicing is 120 against 100)');
    if (lib.sameCents(over1Line.postedAmount, 0)) {
      s.finding('WP5-SVC-1', `PO-SVC's service line (Mobile crane hire, 100 hr @ 10.00, ordered with no inventory item) was received in full and now names an inventory item (${svcLine.inventoryItemId ? 'one was created at goods receipt' : 'none'}): goods receipt turns a received service line into a stocked item (resolveInventoryItem). SINV-OVER1 (60 hr x 10.00 = 600.00 on that line), approved, reads postedAmount 0.00: it was capitalised, not posted, so WP5.D5.overInvoicedLedger's 600.00 cannot be read on this record set. SINV-OVER2 (another 60 hr, 120 invoiced against 100 received) is left pending.`);
    }
    // deep.087-COM.supplierInvoiceVoidedAfterApproval: 1,000.00 on the un-received service line, approved (+1,000) then voided (-1,000).
    const voided = await directCost(s, 'SINV-VOID', { what: 'setting-out survey', ...invoiceBase('VOID', pos.svc2), lines: [dcLine('Setting-out survey service', major(D087.supplierInvoiceVoidedAfterApproval.approvePosts), { poLineId: pos.svc2.lineId, activity: 'A100' })] });
    await dcTo(s, 'SINV-VOID', voided.id, 'void', { voidReason: { from: 'approved', text: `Booked twice ${b.ref('SINV-VOID')}` } });
    out.voidedAfterApproval = voided.id;
    // WP5.D4 (L35): the stocked membrane invoiced and approved BEFORE its receipt; then received and issued (today counted twice: L35, CERT-5).
    const early = await directCost(s, 'SINV-EARLY', { what: 'membrane invoiced before delivery', ...invoiceBase('EARLY', pos.stk), lines: [dcLine('Waterproofing membrane roll', 1000, { poLineId: pos.stk.lineId, quantity: 10, unitCost: 100, unit: 'roll' })] });
    await dcTo(s, 'SINV-EARLY', early.id, 'approved');
    out.approvedBeforeReceipt = early.id;
    const states = { variance: (await dcGet(s, variance.id)).status, over1: (await dcGet(s, over1.id)).status, over2: (await dcGet(s, over2.id)).status, voided: (await dcGet(s, voided.id)).status, early: (await dcGet(s, early.id)).status };
    s.expectFields(states, { variance: 'pending', over1: 'approved', over2: 'pending', voided: 'void', early: 'approved' }, 'supplier invoice states');
    return { ...out, over1PostedAmount: over1Line.postedAmount };
  }, { needs: ['receipts'] });

  await b.step('membrane.after-invoice', async (s) => {
    await receive(s, 'STK', pos.stk, [{ poLineId: pos.stk.lineId, acceptedQty: 10, rejectedQty: 0, locationId: warehouses.siteLocations['Z-A-B02'], inventoryItemId: items.membrane, notes: b.ref('RCV-STK') }]);
    await move(s, 'membrane-issue', 'warehouse', 'issue', { projectId: b.projectId, itemId: items.membrane, warehouseId: warehouses.site, quantity: 10, activityId: A.A130, costCodeId: codeId('02-100'), reference: b.ref('ISS-MEM'), notes: b.ref('ISS-MEM') }, { costPosted: true, movements: movement('issue', -10) }, { type: 'issue', quantity: -10 });
    s.expectFields(await itemGet(s, items.membrane), { onHand: 0 }, 'the membrane received and issued');
    b.note('WP5.D4 (L35, CERT-5): the membrane was invoiced and approved before its receipt, then received and issued; the ledger figure is WP-5\'s check (expected 1,000.00 once the CERT-5 decision lands).', 'membrane.after-invoice');
    return { done: true };
  }, { needs: ['supplier-invoices'] });

  // ── direct costs of every type and state (deep.087-COM.stateCoverage.directCostsTypeByState) ──
  await b.step('direct-costs', async (s) => {
    const VENDORLESS = { vendorName: `Sundry payee ${b.ref('DC')}` };
    const cells = {};
    const PLAN = {
      invoice: { draft: 1200, pending: 1300, approved: 1400, paid: 1500, void: 1600 },
      expense: { draft: 2100, pending: 2200, approved: 2300, paid: major(WP4.CF1['2026-08.outflow']), void: 2500 },
      payroll: { draft: 3100, pending: 3200, approved: 3300, paid: 3400, void: 3500 },
      other: { draft: 4100, pending: 4200, approved: 4300, paid: 4400, void: 4500 },
    };
    const TYPE = { invoice: ['02-100', 'material'], expense: ['09-100', 'indirect'], payroll: ['01-100', 'labour'], other: ['CERT3-087-COM-OTH', 'other'] };
    const VOID_FROM = { invoice: 'approved', expense: 'pending', payroll: 'draft', other: 'approved' };
    for (const [type, states] of Object.entries(PLAN)) {
      for (const [state, amount] of Object.entries(states)) {
        const key = `${type}-${state}`;
        const [code, costType] = TYPE[type];
        const row = await directCost(s, key, {
          what: `${type} left ${state}`,
          type,
          ...(type === 'invoice' ? { vendorCompanyId: companyId('supplier'), invoiceNumber: b.ref(`INV-${key}`) } : VENDORLESS),
          costDate: b.past(state === 'paid' && type === 'expense' ? '2026-08-20' : '2026-09-25'),
          lines: [dcLine(`${type} ${state}`, amount, { code, type: costType, activity: 'A320' })],
        });
        // CF1 2026-08 outflow: the expense paid 8,500.00 on 2026-08-31; the other payments fall in October.
        await dcTo(s, key, row.id, state, { payDate: type === 'expense' ? '2026-08-31' : '2026-10-02', voidReason: { from: VOID_FROM[type], text: `Raised in error ${b.ref(key)}` } });
        cells[key] = row.id;
      }
    }
    const read = Object.fromEntries(await Promise.all(Object.entries(cells).map(async ([key, id]) => [key, (await dcGet(s, id)).status])));
    s.expectFields(read, Object.fromEntries(Object.keys(cells).map((key) => [key, key.split('-').slice(1).join('-')])), 'direct cost type x state');
    return { cells };
  }, { needs: ['budget-lines', 'activities'] });

  // ── cash flow: CF1's months hold only CF1's three payments (WP4.CF1, without any manual rebuild) ──
  await b.step('cash-flow.months', async (s) => {
    const flow = await s.get('cost', `${b.P}/cash-flow`);
    const month = (period) => atMostOne(flow.monthly || [], (row) => row.period === period, `cash-flow month ${period}`) || { inflow: 0, outflow: 0 };
    // WP4.CF1 2026-08.outflow 8,500.00; 2026-09.inflow 80,000.00 and 2026-09.outflow 54,000.00 (no client money in August).
    s.expectFields({ aug: month('2026-08'), sep: month('2026-09') }, {
      'aug.inflow': is.cents(0),
      'aug.outflow': asCents(WP4.CF1['2026-08.outflow']),
      'sep.inflow': asCents(WP4.CF1['2026-09.inflow']),
      'sep.outflow': asCents(WP4.CF1['2026-09.outflow']),
    }, 'CF1 months');
    const manual = (flow.rows || []).filter((row) => row.source === 'manual').length;
    s.assert(manual === 2, `the two manual rows are on the projection (read ${manual})`);
    return { monthly: flow.monthly, summary: flow.summary };
  }, { needs: ['direct-costs', 'payapp.02', 'ipc.06', 'cash-flow.manual'] });

  // ── what the build leaves, read back in one place (adjudication C8 state coverage) ──
  await b.step('coverage', async (s) => {
    const ipc = listOf(await s.get('qs', `${b.P}/ipc`));
    const ipcStates = Object.fromEntries(ipc.filter((row) => row.period.startsWith(b.ref('IPC-'))).map((row) => [row.period.slice(-6), `${row.status}/${row.paymentStatus || '-'}`]));
    const orders = listOf(await s.get('qs', coRegisterRoute), 'orders');
    const primeStates = [...new Set(orders.map((row) => (row.archivedAt ? 'archived' : row.status)))].sort();
    s.assert(D087.stateCoverage.primeChangeOrders.value.every((state) => primeStates.includes(state)), `prime COs in every state (read ${primeStates.join(', ')})`);
    const apps = listOf(await s.get('qs', `${b.P}/pay-apps?includeVoid=true`));
    const appStates = [...new Set(apps.map((row) => row.status))].sort();
    s.assert(D087.stateCoverage.payApplications.value.every((state) => appStates.includes(state)), `pay applications in every state (read ${appStates.join(', ')})`);
    const claims = await eotList(s);
    const eotStates = claims.map((row) => row.status);
    s.assert(D087.stateCoverage.eotClaims.value.every((state) => eotStates.includes(state)) && eotStates.filter((x) => x === 'approved').length === D087.eotApprovedClaims.value, `EOT claims in every state, two approved (read ${eotStates.join(', ')})`);
    const ipcSet = new Set(Object.values(ipcStates));
    s.assert(ipc.length >= D087.ipcPeriodsMin.value, `at least four IPC periods (read ${ipc.length})`);
    return { ipcStates, primeStates, appStates, eotStates, ipcCount: ipc.length, ipcStateSet: [...ipcSet] };
  });
});
