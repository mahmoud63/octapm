'use strict';

/**
 * CERT-3 WP-0: the weak checks of the certified lifecycle, verified after the
 * fact on the stored data of the 14 certified projects (plan §4 WP-0, the
 * stage table). Each stored figure is compared with its known answer, worked
 * on paper — never with another figure the product computed.
 *
 *   node scripts/cert/cert3/lifecycle-posthoc-verifier.js                  # the 14 projects
 *   node scripts/cert/cert3/lifecycle-posthoc-verifier.js --codes=021,087   # some of them
 *
 * The 14 projects. Company codes 021 027 033 039 045 051 057 063 069 075 081
 * 087 093 099, each with the project "OCTA PHASE21 GREENFIELD C<code>". The
 * list is the one run-lifecycles.js runs: the companies whose first project
 * has depth `certified` in lib/spec.js (medium or large, n % 6 = 3). It is
 * cross-checked here against spec.js and against the state files the
 * lifecycle wrote (<work>/state/p21-<code>.json, which also give every id
 * read below). OCTAPM_100_COMPANY_MATRIX.md lines 23-37 and journal entry
 * "CERT-1 COMPLETE" (14 x 18/18 stages, 496 checks each) name the same 14.
 *
 * Known answers (integer cents for money, working days for the schedule):
 *   stage 1   the four directory companies "<tag> Meridian Property Group",
 *             "... Gulf Steel & Cement Supply", "... Delta Concrete Works",
 *             "... Aziz Consulting Engineers", type external; the four names
 *             resolve to exactly the four ids stage 1 recorded
 *   stage 2   A140 EF 34 LF 81 TF 47; A300 EF 61 LF 81 TF 20; M900 EF 81;
 *             every activity as plan §4 WP-1 T1 (the same 14-activity
 *             network); TF = LF - EF on every row; 12 critical; A110 back at 10
 *   stage 3   B-001/A110 60,000.00; B-002/A120 30,000.00; B-002/A130
 *             90,000.00; B-004/A310 135,000.00; B-005/A320 72,000.00
 *             = 387,000.00; nothing on B-003; unallocated 72,000.00 (B-003)
 *   stage 4   PO-<stamp>-A 100 x 10.00 = 1,000.00 and PO-<stamp>-B
 *             50 x 13.00 = 650.00, stored in the column `value`; one line
 *             each, on A130 and cost code 02-100
 *   stage 5   commitment draft -> pending -> approved -> executed; pay app
 *             draft -> submitted -> under_review -> approved -> paid; gross
 *             60,000.00, retention 6,000.00, net 54,000.00, paid 54,000.00 in
 *             one payment; cash outflow 54,000.00 (period 2027-04)
 *   stage 9   one approved submission each, by the site engineer, approved by
 *             the PM; official progress A110 100, A120 50, A130 25; EV from
 *             the stored inputs 75,000.00 before A130's approval and
 *             97,500.00 after it. The EV the stage recorded in its state file
 *             is reported as information, not checked: the gating figures come
 *             from stored rows (CERT-3 WP-0 adjudication C)
 *   stage 14  location "<stamp>-GRID-AD", kind zone, on the project; the RFI
 *             points to it (and to A130)
 * What is only observable at run time (HTTP answers, the intermediate
 * network with A110 at 20 days, the EV report's own answer) is listed as
 * "not verifiable post hoc", with the run log's line where there is one.
 *
 * READ ONLY BY CONSTRUCTION:
 *   - the database comes through the certification guard (CERT_DATABASE_URL,
 *     database octapm_cert, the marker row), on ONE connection;
 *   - the session is `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`
 *     before any data is read, and `SHOW transaction_read_only` must read
 *     `on` before, inside each transaction and after (the house pattern of
 *     scripts/project-controls/*-census.js);
 *   - data is read only with findMany / findFirst / count — this file refuses
 *     to run if it contains a Prisma write call or another raw execute;
 *   - a fingerprint is taken before and after, each in one repeatable-read
 *     transaction. It gates only on the 14 projects' own rows — the project
 *     rows, the directory companies and cost codes their state files name, and
 *     every project-scoped table — a count and a sha256 of every column: any
 *     difference there is exit 1. Whole-table row counts, and the rows of the
 *     14 companies in the org-level tables (organisation, project, company,
 *     cost code), are information only (CERT-3 WP-0 adjudication C): another
 *     run in the same company (the proving run C087R, the permission probe's
 *     CERT3-PERM-* records) moves them without touching the 14 projects. Run
 *     it with nothing else writing to the certification database anyway (the
 *     API idle or stopped).
 *
 * Results: <work>/results/cert3/lifecycle-posthoc.json.
 * Exit 0: every stored figure matches its known answer. 2: a stored figure
 * contradicts it. 1: setup error (guard refusal, a missing state file or
 * project, the session not read-only, the comparator without teeth, or the
 * gated fingerprint changed) — 1 wins over 2.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const fs = require('fs');
const crypto = require('crypto');
const guard = require('../lib/cert-env');

const NAME = 'lifecycle-posthoc';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STATE_DIR = path.join(WORK, 'state');
const LOG_DIR = path.join(WORK, 'logs', 'lifecycle');
const RESULT_FILE = path.join(WORK, 'results', 'cert3', `${NAME}.json`);

/** The 14 certified companies (see the header for where the list comes from). */
const CERTIFIED = ['021', '027', '033', '039', '045', '051', '057', '063', '069', '075', '081', '087', '093', '099'];
const PROJECTS_SOURCE =
  'lib/spec.js buildPopulation(): companies whose first project has depth "certified" (the list run-lifecycles.js runs), ' +
  'cross-checked with <work>/state/p21-<code>.json; the same 14 in OCTAPM_100_COMPANY_MATRIX.md lines 23-37';

// ── the known answers ─────────────────────────────────────────────────────────
const KNOWN = {
  stage1: {
    type: 'external',
    names: {
      client: 'Meridian Property Group',
      supplier: 'Gulf Steel & Cement Supply',
      subcontractor: 'Delta Concrete Works',
      consultant: 'Aziz Consulting Engineers',
    },
  },
  stage2: {
    // [ES, EF, LS, LF, TF] in working days from the project start: plan §4
    // WP-1 T1, the same network stage 2 builds (FS links, lag 0).
    network: {
      A100: [0, 5, 0, 5, 0],
      A110: [5, 15, 5, 15, 0],
      A120: [15, 18, 15, 18, 0],
      A130: [18, 30, 18, 30, 0],
      A140: [30, 34, 77, 81, 47],
      A200: [30, 38, 30, 38, 0],
      A210: [38, 44, 38, 44, 0],
      A220: [44, 51, 44, 51, 0],
      A230: [51, 59, 51, 59, 0],
      A300: [51, 61, 71, 81, 20],
      A310: [59, 68, 59, 68, 0],
      A320: [68, 75, 68, 75, 0],
      A330: [75, 81, 75, 81, 0],
      M900: [81, 81, 81, 81, 0],
    },
    // The stage table's own rows.
    floats: {
      A140: { earlyFinish: 34, lateFinish: 81, totalFloat: 47 },
      A300: { earlyFinish: 61, lateFinish: 81, totalFloat: 20 },
    },
    m900EarlyFinish: 81,
    critical: 12,
    activities: 14,
    a110Duration: 10,
  },
  stage3: {
    items: { 'B-001': 6_000_000, 'B-002': 12_000_000, 'B-003': 7_200_000, 'B-004': 13_500_000, 'B-005': 7_200_000 },
    boqTotalCents: 45_900_000,
    allocations: [
      ['B-001', 'A110', 6_000_000],
      ['B-002', 'A120', 3_000_000],
      ['B-002', 'A130', 9_000_000],
      ['B-004', 'A310', 13_500_000],
      ['B-005', 'A320', 7_200_000],
    ],
    allocatedCents: 38_700_000,
    unallocatedItem: 'B-003',
    unallocatedCents: 7_200_000,
  },
  stage4: {
    activity: 'A130',
    costCode: '02-100',
    orders: {
      A: { quantity: 100, unitCostCents: 1_000, valueCents: 100_000 },
      B: { quantity: 50, unitCostCents: 1_300, valueCents: 65_000 },
    },
  },
  stage5: {
    commitmentTransitions: ['draft->pending', 'pending->approved', 'approved->executed'],
    payAppTransitions: ['draft->submitted', 'submitted->under_review', 'under_review->approved', 'approved->paid'],
    grossCents: 6_000_000,
    retentionCents: 600_000,
    netCents: 5_400_000,
    paidCents: 5_400_000,
    payments: 1,
    cashOutCents: 5_400_000,
    cashOutPeriod: '2027-04',
  },
  stage9: {
    official: { A110: 100, A120: 50, A130: 25 },
    evBeforeA130Cents: 7_500_000, // 60,000 x 100% + 30,000 x 50%
    evFinalCents: 9_750_000, // + 90,000 x 25%
  },
  stage14: { codeSuffix: '-GRID-AD', kind: 'zone', activity: 'A130' },
};

/**
 * Run-time facts that leave nothing in the database. The run log's lines are
 * quoted where there are some (the patterns match the stage labels before and
 * after the CERT-3 WP-0 stage edits, which assert these on every future run).
 */
const NOT_VERIFIABLE = [
  { stage: 'stage1', item: 'POST /companies answered with the name sent and type external, and GET /companies?search=<tag> listed exactly the four ids', why: 'HTTP answers are not stored; the stored companies (name, type, and the four names resolving to exactly the four recorded ids) are checked instead', log: ['stage1-foundation', /all four companies appear in the directory|the directory (keeps|records|returns the same four)/] },
  { stage: 'stage2', item: 'with A110 at 20 days: M900 EF 91, A140 TF 47, A300 TF 20 (then restored to 81)', why: 'the intermediate network is overwritten when the duration is restored; only the restored one is stored', log: ['stage2-schedule', /finish after \+10 days on excavation|with A110 at 20 days|restored, /] },
  { stage: 'stage4', item: 'GET /purchase-orders/:id answered the value in a field named "value"', why: 'the API answer is not stored; the stored column ProcurementOrder.value, and the lines, are checked instead', log: ['stage4-procurement-inventory', /PO value is quantity x rate|PO-[AB] (value is|answers its value)/] },
  { stage: 'stage5', item: 'each commitment and pay-application step answered 200, the payment 201, and no 409 was accepted for a record not yet past its step', why: 'HTTP answers are not stored (the state file\'s paymentStatus 200 is probe()\'s success code, not the HTTP status); the stamps and the audited status transitions are checked instead', log: ['stage5-subcontract', /^\s*----\s+((commitment |pay app )?(submit|approve|review)|payment):|the payment answers/] },
  { stage: 'stage9', item: 'each progress approval answered 200 with status approved', why: 'HTTP answers are not stored; the stored submissions (status, submitter, reviewer), their audited transitions and the official progress rows are checked instead', log: ['stage9-progress-ev', /A1[123]0 approved:|the approval answers/] },
  { stage: 'stage9', item: 'the EV report as the product answered it (75,000.00, then 97,500.00)', why: 'the report is worked on request; unless a period was locked (EvPeriodSnapshot, reported under info) nothing stores it. EV re-derived from the stored approved progress and allocations is checked instead; the figures the stage wrote to its state file are reported under info (stateFileEv), not checked', log: ['stage9-progress-ev', /EV totals|EV now|the EV report answers/] },
  { stage: 'stage14', item: 'POST /locations answered with the code and kind', why: 'the API answer is not stored; the stored Location row is checked instead', log: ['stage14-rfi', /a project location exists|the location('s code| is a zone)/] },
];

// ── small pure helpers ────────────────────────────────────────────────────────
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Money as integer cents, from a Prisma Decimal, a number or a string; never compared as a float. */
const centsOf = (value) => {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'object' && typeof value.toFixed === 'function' ? value.toFixed(2) : Number(value).toFixed(2);
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(text);
  if (!match) return null;
  const magnitude = Number(match[2]) * 100 + Number(match[3]);
  return match[1] === '-' ? -magnitude : magnitude;
};

const numberOrNull = (value) => (value === null || value === undefined ? null : Number(value));

/** EV in cents: allocation x percent, the product's rule (earned-value.service.js), rounded per activity. */
const evCents = (allocatedByActivity, pctByActivity) =>
  Object.entries(allocatedByActivity).reduce((sum, [key, cents]) => sum + Math.round((cents * Number(pctByActivity[key] || 0)) / 100), 0);

const stableHash = (rows) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify(rows, (_key, value) => {
        if (typeof value === 'bigint') return `${value}n`;
        if (value && value.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data).toString('base64');
        if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
        return value;
      }),
    )
    .digest('hex');

const at = (date) => (date ? new Date(date).getTime() : null);

// ── the guarantees, checked before anything connects ─────────────────────────
/** This file must hold no Prisma write and no raw execute other than the read-only switch. */
const assertSourceReadOnly = () => {
  const source = fs.readFileSync(__filename, 'utf8');
  const writes = source.match(/\b(?:prisma|tx|db|client)\s*\.\s*\w+\s*\.\s*(?:create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)\s*\(/g) || [];
  const executeNeedle = ['$execute', 'Raw'].join('');
  const executes = source.split('\n').filter((line) => line.includes(executeNeedle));
  const allowed = executes.filter((line) => line.includes('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY'));
  if (writes.length || executes.length !== allowed.length || allowed.length !== 1) {
    throw new Error(`the verifier's source is not read-only: ${writes.length} write call(s), ${executes.length - allowed.length} other raw execute(s)`);
  }
};

/** The comparator must fail a figure that moved (the stage-table mutations). */
const assertTeeth = () => {
  const mutated = [
    ['PO-A at a unit cost of 10.50 is 1,050.00, not 1,000.00', KNOWN.stage4.orders.A.valueCents, 100 * centsOf('10.50')],
    ['A140 with a float of 46', KNOWN.stage2.floats.A140.totalFloat, 46],
    ['M900 finishing on day 91', KNOWN.stage2.m900EarlyFinish, 91],
    ['A130 at 30% gives an EV of 102,000.00', KNOWN.stage9.evFinalCents, evCents({ A110: 6_000_000, A120: 3_000_000, A130: 9_000_000 }, { A110: 100, A120: 50, A130: 30 })],
    ['a payment of 54,000.01', KNOWN.stage5.paidCents, centsOf('54000.01')],
  ];
  const control = [
    ['PO-A at 10.00 is 1,000.00', KNOWN.stage4.orders.A.valueCents, 100 * centsOf('10.00')],
    ['EV at 100 / 50 / 25 is 97,500.00', KNOWN.stage9.evFinalCents, evCents({ A110: 6_000_000, A120: 3_000_000, A130: 9_000_000 }, KNOWN.stage9.official)],
    ['EV at 100 / 50 is 75,000.00', KNOWN.stage9.evBeforeA130Cents, evCents({ A110: 6_000_000, A120: 3_000_000 }, KNOWN.stage9.official)],
    ['a Decimal-like 54000 is 5,400,000 cents', KNOWN.stage5.paidCents, centsOf({ toFixed: () => '54000.00' })],
  ];
  const toothless = mutated.filter(([, expected, actual]) => same(expected, actual)).map(([label]) => label);
  const broken = control.filter(([, expected, actual]) => !same(expected, actual)).map(([label]) => label);
  if (toothless.length || broken.length) {
    throw new Error(`the comparator has no teeth: mutations not caught [${toothless.join('; ')}], controls failed [${broken.join('; ')}]`);
  }
  return { mutationsCaught: mutated.map(([label]) => label), controls: control.map(([label]) => label) };
};

// ── state files ───────────────────────────────────────────────────────────────
const readState = (code) => {
  const file = path.join(STATE_DIR, `p21-${code}.json`);
  if (!fs.existsSync(file)) return { file, error: `missing state file ${file}` };
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    const missing = ['orgId', 'projectId', 'stamp', 'tag', 'companies', 'activities', 'boq', 'costCodes', 'purchaseOrders', 'commitmentId', 'payAppId', 'locationId', 'rfiId', 'userIds'].filter((key) => !state[key]);
    if (missing.length) return { file, error: `${file} lacks ${missing.join(', ')}` };
    if (state.stamp !== `C${code}` || state.tag !== `P21-C${code}`) return { file, error: `${file} names stamp ${state.stamp} / tag ${state.tag}, not C${code}` };
    return { file, state };
  } catch (error) {
    return { file, error: `${file}: ${error.message}` };
  }
};

/** The first lines of a stage's run log that match, as a pointer to the run-time record. */
const runRecord = (code, stage, pattern) => {
  const file = path.join(LOG_DIR, `${code}-${stage}.log`);
  if (!fs.existsSync(file)) return { file, lines: [] };
  const lines = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => pattern.test(line))
    .slice(0, 6)
    .map((line) => line.trim().slice(0, 240));
  return { file, lines };
};

// ── the database ──────────────────────────────────────────────────────────────
const singleConnection = (raw) => {
  const url = new URL(raw);
  url.searchParams.set('connection_limit', '1');
  return url.toString();
};

const readOnlyNow = async (client) => {
  const rows = await client.$queryRawUnsafe('SHOW transaction_read_only');
  return rows?.[0]?.transaction_read_only ?? null;
};

/** One repeatable-read transaction on the read-only session; refuses to read if the transaction is not read-only. */
const inReadOnlyTransaction = (prisma, Prisma, work) =>
  prisma.$transaction(
    async (tx) => {
      const mode = await readOnlyNow(tx);
      if (mode !== 'on') throw new Error(`the transaction is not read-only (transaction_read_only = ${mode})`);
      return work(tx);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 60_000, timeout: 30 * 60_000 },
  );

/**
 * Every table the verifier reads, as [model, gate, info]. `gate` is the 14
 * projects' own rows (a project-scoped table, or the ids the state files name)
 * and is what the fingerprint gates on. `info` is every row of the 14
 * companies in an org-level table, hashed as information only, like every
 * table's whole-table count (CERT-3 WP-0 adjudication C).
 */
const fingerprintScope = ({ orgIds, projectIds, companyIds, costCodeIds }) => [
  ['organisation', null, { id: { in: orgIds } }],
  ['project', { id: { in: projectIds } }, { orgId: { in: orgIds } }],
  ['company', { id: { in: companyIds } }, { orgId: { in: orgIds } }],
  ['costCode', { id: { in: costCodeIds } }, { orgId: { in: orgIds } }],
  ['activity', { projectId: { in: projectIds } }, null],
  ['activityProgress', { activity: { projectId: { in: projectIds } } }, null],
  ['activityBoqAllocation', { projectId: { in: projectIds } }, null],
  ['boqItem', { projectId: { in: projectIds } }, null],
  ['procurementOrder', { projectId: { in: projectIds } }, null],
  ['procurementPoLine', { projectId: { in: projectIds } }, null],
  ['commitment', { projectId: { in: projectIds } }, null],
  ['subPayApp', { projectId: { in: projectIds } }, null],
  ['subPayAppPayment', { projectId: { in: projectIds } }, null],
  ['cashFlowEntry', { projectId: { in: projectIds } }, null],
  ['progressSubmission', { projectId: { in: projectIds } }, null],
  ['auditEvent', { projectId: { in: projectIds } }, null],
  ['location', { projectId: { in: projectIds } }, null],
  ['rfi', { projectId: { in: projectIds } }, null],
  ['evPeriodSnapshot', { projectId: { in: projectIds } }, null],
];

const takeFingerprint = async (tx, scope) => {
  const tables = {};
  for (const [model, gate, info] of fingerprintScope(scope)) {
    // Information: the whole table's count, and the 14 companies' rows of an org-level table.
    const entry = { totalRows: await tx[model].count() };
    if (info) {
      const companyRows = await tx[model].findMany({ where: info, orderBy: { id: 'asc' } });
      Object.assign(entry, { companyRows: companyRows.length, companySha256: stableHash(companyRows) });
    }
    // The gate: the 14 projects' own rows.
    if (gate) {
      const rows = await tx[model].findMany({ where: gate, orderBy: { id: 'asc' } });
      Object.assign(entry, { scopedRows: rows.length, sha256: stableHash(rows) });
    }
    tables[model] = entry;
  }
  return { takenAt: new Date().toISOString(), tables };
};

/**
 * `differences` gate (exit 1): the 14 projects' hashed rows changed.
 * `information` does not: a whole-table count or a company-wide hash moved.
 */
const compareFingerprints = (before, after) => {
  const differences = [];
  const information = [];
  for (const model of new Set([...Object.keys(before.tables), ...Object.keys(after.tables)])) {
    const a = before.tables[model];
    const b = after.tables[model];
    if (!a || !b || a.scopedRows !== b.scopedRows || a.sha256 !== b.sha256) {
      differences.push({ table: model, before: a || null, after: b || null });
    }
    if (a && b && (a.totalRows !== b.totalRows || a.companyRows !== b.companyRows || a.companySha256 !== b.companySha256)) {
      information.push({
        table: model,
        totalRows: [a.totalRows, b.totalRows],
        ...(a.companyRows === undefined ? {} : { companyRows: [a.companyRows, b.companyRows], companyRowsChanged: a.companySha256 !== b.companySha256 }),
      });
    }
  }
  return { differences, information };
};

// ── the checks of one project ─────────────────────────────────────────────────
const verifyProject = async (tx, code, state) => {
  const out = { code, projectId: state.projectId, projectName: state.projectName, orgId: state.orgId, setupErrors: [], checks: [], info: {} };
  const check = (stage, label, expected, actual, source = 'database') => {
    const pass = same(expected, actual);
    out.checks.push({ stage, label, expected, actual, pass, source });
    if (!pass) console.log(`  [FAIL] C${code} ${stage} ${label}  expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
    return pass;
  };
  const P = state.projectId;
  const { stamp, tag } = state;
  const A = state.activities;

  // ── identity: the right database, the right project ──
  const org = await tx.organisation.findFirst({ where: { id: state.orgId }, select: { id: true, slug: true } });
  if (!org || !new RegExp(`^cert-${code}-`).test(org.slug || '')) out.setupErrors.push(`organisation ${state.orgId} is not certification company ${code} (slug ${org?.slug ?? 'missing'})`);
  const project = await tx.project.findFirst({ where: { id: P }, select: { id: true, orgId: true, name: true, archivedAt: true } });
  if (!project) out.setupErrors.push(`project ${P} (state file) is not in this database`);
  else if (project.orgId !== state.orgId || project.name !== `OCTA PHASE21 GREENFIELD ${stamp}`) out.setupErrors.push(`project ${P} is "${project.name}" in ${project.orgId}, not "OCTA PHASE21 GREENFIELD ${stamp}" in ${state.orgId}`);
  if (out.setupErrors.length) return out;
  out.info.archivedAt = project.archivedAt;

  // ── stage 1: the company directory ──
  const names = Object.fromEntries(Object.entries(KNOWN.stage1.names).map(([kind, name]) => [kind, `${tag} ${name}`]));
  const companies = await tx.company.findMany({
    where: { orgId: state.orgId, name: { in: Object.values(names) } },
    select: { id: true, orgId: true, name: true, type: true },
    orderBy: { id: 'asc' },
  });
  for (const [kind, name] of Object.entries(names)) {
    const row = companies.find((c) => c.name === name) || null;
    check('stage1', `${kind}: "${name}" is the company stage 1 recorded`, state.companies[kind]?.id ?? null, row?.id ?? null);
    check('stage1', `${kind}: the recorded name is the one sent`, name, state.companies[kind]?.name ?? null, 'state file');
    check('stage1', `${kind}: type ${KNOWN.stage1.type}`, KNOWN.stage1.type, row?.type ?? null);
  }
  check(
    'stage1',
    'the four directory names resolve to exactly the four recorded ids',
    Object.keys(names).map((kind) => state.companies[kind]?.id ?? null).sort(),
    companies.map((c) => c.id).sort(),
  );

  // ── stage 2: the network as stored (after the A110 round trip) ──
  const activities = await tx.activity.findMany({
    where: { projectId: P, isActive: true },
    select: { id: true, activityCode: true, duration: true, earlyStart: true, earlyFinish: true, lateStart: true, lateFinish: true, totalFloat: true, endDate: true },
    orderBy: { id: 'asc' },
  });
  const act = new Map(activities.map((a) => [a.activityCode, a]));
  check('stage2', 'active activities', KNOWN.stage2.activities, activities.length);
  for (const [activityCode, id] of Object.entries(A)) check('stage2', `${activityCode} is the activity stage 2 recorded`, id, act.get(activityCode)?.id ?? null);
  for (const [activityCode, known] of Object.entries(KNOWN.stage2.floats)) {
    const a = act.get(activityCode);
    check('stage2', `${activityCode} early finish day ${known.earlyFinish}`, known.earlyFinish, numberOrNull(a?.earlyFinish));
    check('stage2', `${activityCode} late finish day ${known.lateFinish}`, known.lateFinish, numberOrNull(a?.lateFinish));
    check('stage2', `${activityCode} total float ${known.totalFloat}`, known.totalFloat, numberOrNull(a?.totalFloat));
  }
  check('stage2', `M900 early finish day ${KNOWN.stage2.m900EarlyFinish}`, KNOWN.stage2.m900EarlyFinish, numberOrNull(act.get('M900')?.earlyFinish));
  for (const [activityCode, known] of Object.entries(KNOWN.stage2.network)) {
    const a = act.get(activityCode);
    check('stage2', `${activityCode} ES/EF/LS/LF/TF (plan T1)`, known, a ? [a.earlyStart, a.earlyFinish, a.lateStart, a.lateFinish, a.totalFloat].map(numberOrNull) : null);
  }
  check(
    'stage2',
    'TF = LF - EF on every activity (activities where it does not hold)',
    [],
    activities.filter((a) => numberOrNull(a.totalFloat) !== numberOrNull(a.lateFinish) - numberOrNull(a.earlyFinish)).map((a) => a.activityCode),
  );
  check('stage2', 'critical activities (TF 0)', KNOWN.stage2.critical, activities.filter((a) => numberOrNull(a.totalFloat) === 0).length);
  check('stage2', 'A110 is back at its planned duration', KNOWN.stage2.a110Duration, numberOrNull(act.get('A110')?.duration));
  out.info.m900EndDate = act.get('M900')?.endDate ?? null;
  out.info.plannedFinishRecordedAtStage2 = state.plannedFinish ?? null;

  // ── stage 3: the bill against the schedule ──
  const items = await tx.boqItem.findMany({ where: { projectId: P, isActive: true }, select: { id: true, code: true, amount: true }, orderBy: { id: 'asc' } });
  const allocations = await tx.activityBoqAllocation.findMany({
    where: { projectId: P, isActive: true },
    select: { id: true, boqItemId: true, activityId: true, amount: true, status: true },
    orderBy: { id: 'asc' },
  });
  const itemByCode = new Map(items.map((i) => [i.code, i]));
  check('stage3', 'five BOQ rows', Object.keys(KNOWN.stage3.items).length, items.length);
  for (const [itemCode, cents] of Object.entries(KNOWN.stage3.items)) {
    check('stage3', `${itemCode} is the row stage 3 recorded`, state.boq[itemCode] ?? null, itemByCode.get(itemCode)?.id ?? null);
    check('stage3', `${itemCode} amount (cents)`, cents, centsOf(itemByCode.get(itemCode)?.amount));
  }
  check('stage3', 'BOQ total (cents)', KNOWN.stage3.boqTotalCents, items.reduce((s, i) => s + centsOf(i.amount), 0));
  check('stage3', `no allocation on ${KNOWN.stage3.unallocatedItem}`, 0, allocations.filter((r) => r.boqItemId === state.boq[KNOWN.stage3.unallocatedItem]).length);
  check('stage3', 'five allocations', KNOWN.stage3.allocations.length, allocations.length);
  for (const [itemCode, activityCode, cents] of KNOWN.stage3.allocations) {
    const rows = allocations.filter((r) => r.boqItemId === state.boq[itemCode] && r.activityId === A[activityCode]);
    check('stage3', `${itemCode} -> ${activityCode}: one allocation of ${cents} cents`, [1, cents], [rows.length, rows.length === 1 ? centsOf(rows[0].amount) : null]);
  }
  const allocatedCents = allocations.reduce((s, r) => s + centsOf(r.amount), 0);
  check('stage3', 'allocated total (cents)', KNOWN.stage3.allocatedCents, allocatedCents);
  const unallocatedByItem = items
    .map((i) => [i.code, Math.max(0, centsOf(i.amount) - allocations.filter((r) => r.boqItemId === i.id).reduce((s, r) => s + centsOf(r.amount), 0))])
    .filter(([, cents]) => cents > 0);
  check('stage3', 'unallocated (cents), and on which row', [[KNOWN.stage3.unallocatedItem, KNOWN.stage3.unallocatedCents]], unallocatedByItem);

  // ── stage 4: the two purchase orders ──
  const orderIds = [state.purchaseOrders.A, state.purchaseOrders.B].filter(Boolean);
  const orders = await tx.procurementOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, projectId: true, ref: true, value: true, subtotal: true }, orderBy: { id: 'asc' } });
  const poLines = await tx.procurementPoLine.findMany({
    where: { orderId: { in: orderIds } },
    select: { id: true, orderId: true, lineNumber: true, activityId: true, costCodeId: true, orderedQty: true, unitCost: true },
    orderBy: { id: 'asc' },
  });
  const costCode = await tx.costCode.findFirst({ where: { id: state.costCodes[KNOWN.stage4.costCode] ?? '00000000-0000-0000-0000-000000000000' }, select: { id: true, orgId: true, code: true } });
  check('stage4', `the recorded cost code is ${KNOWN.stage4.costCode} of this company`, [KNOWN.stage4.costCode, state.orgId], [costCode?.code ?? null, costCode?.orgId ?? null]);
  for (const [key, known] of Object.entries(KNOWN.stage4.orders)) {
    const order = orders.find((o) => o.id === state.purchaseOrders[key]) || null;
    const lines = poLines.filter((l) => l.orderId === state.purchaseOrders[key]);
    check('stage4', `PO-${key} is on the project, ref PO-${stamp}-${key}`, [P, `PO-${stamp}-${key}`], [order?.projectId ?? null, order?.ref ?? null]);
    check('stage4', `PO-${key} stores its value in the column "value"`, true, Boolean(order) && order.value !== null && order.value !== undefined);
    check('stage4', `PO-${key} value (cents)`, known.valueCents, centsOf(order?.value));
    check('stage4', `PO-${key} has one line`, 1, lines.length);
    const line = lines[0] || null;
    check('stage4', `PO-${key} line is on ${KNOWN.stage4.activity}`, A[KNOWN.stage4.activity], line?.activityId ?? null);
    check('stage4', `PO-${key} line is coded ${KNOWN.stage4.costCode}`, state.costCodes[KNOWN.stage4.costCode], line?.costCodeId ?? null);
    check('stage4', `PO-${key} line: quantity and unit cost (cents)`, [known.quantity, known.unitCostCents], [numberOrNull(line?.orderedQty), centsOf(line?.unitCost)]);
    check('stage4', `PO-${key} line amount = quantity x unit cost (cents)`, known.valueCents, line ? Math.round(Number(line.orderedQty) * centsOf(line.unitCost)) : null);
  }

  // ── stage 5: commitment, pay application, payment, cash ──
  const transitionsOf = async (entityType, entityId) =>
    (
      await tx.auditEvent.findMany({
        where: { projectId: P, entityType, entityId },
        select: { oldStatus: true, newStatus: true, occurredAt: true },
        orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      })
    )
      .filter((e) => e.oldStatus && e.newStatus && e.oldStatus !== e.newStatus)
      .map((e) => `${e.oldStatus}->${e.newStatus}`);

  const commitment = await tx.commitment.findFirst({
    where: { id: state.commitmentId, projectId: P },
    select: { id: true, status: true, vendorCompanyId: true, submittedAt: true, approvedAt: true, executedAt: true },
  });
  check('stage5', 'the commitment is executed', 'executed', commitment?.status ?? null);
  check('stage5', 'the commitment was submitted, then approved, then executed (stamps)', true,
    Boolean(commitment?.submittedAt && commitment?.approvedAt && commitment?.executedAt) && at(commitment.submittedAt) <= at(commitment.approvedAt) && at(commitment.approvedAt) <= at(commitment.executedAt));
  check('stage5', 'the commitment\'s audited transitions', KNOWN.stage5.commitmentTransitions, commitment ? await transitionsOf('commitment', commitment.id) : null);
  check('stage5', 'the commitment is with the subcontractor from the directory', state.companies.subcontractor?.id ?? null, commitment?.vendorCompanyId ?? null);

  const payApp = await tx.subPayApp.findFirst({
    where: { id: state.payAppId, projectId: P },
    select: { id: true, commitmentId: true, status: true, grossThisPeriod: true, retentionThisPeriod: true, netThisPeriod: true, paidAmount: true, submittedAt: true, reviewedAt: true, approvedAt: true, paidAt: true },
  });
  check('stage5', 'the pay application is on the commitment', state.commitmentId, payApp?.commitmentId ?? null);
  check('stage5', 'the pay application is paid', 'paid', payApp?.status ?? null);
  check('stage5', 'the pay application was submitted, reviewed, approved, then paid (stamps)', true,
    Boolean(payApp?.submittedAt && payApp?.reviewedAt && payApp?.approvedAt && payApp?.paidAt) && at(payApp.submittedAt) <= at(payApp.reviewedAt) && at(payApp.reviewedAt) <= at(payApp.approvedAt));
  check('stage5', 'the pay application\'s audited transitions', KNOWN.stage5.payAppTransitions, payApp ? await transitionsOf('sub_pay_app', payApp.id) : null);
  check('stage5', 'gross / retention / net / paid (cents)',
    [KNOWN.stage5.grossCents, KNOWN.stage5.retentionCents, KNOWN.stage5.netCents, KNOWN.stage5.paidCents],
    [centsOf(payApp?.grossThisPeriod), centsOf(payApp?.retentionThisPeriod), centsOf(payApp?.netThisPeriod), centsOf(payApp?.paidAmount)]);
  const payments = await tx.subPayAppPayment.findMany({ where: { payAppId: state.payAppId }, select: { id: true, projectId: true, amount: true, reference: true }, orderBy: { id: 'asc' } });
  check('stage5', 'one payment of 5,400,000 cents, reference <tag>-PMT-1',
    [KNOWN.stage5.payments, KNOWN.stage5.paidCents, `${tag}-PMT-1`, P],
    [payments.length, payments.length === 1 ? centsOf(payments[0].amount) : null, payments[0]?.reference ?? null, payments[0]?.projectId ?? null]);
  const cash = await tx.cashFlowEntry.findMany({ where: { projectId: P }, select: { id: true, period: true, inflow: true, outflow: true, source: true }, orderBy: { id: 'asc' } });
  check('stage5', 'cash outflow (cents)', KNOWN.stage5.cashOutCents, cash.reduce((s, r) => s + centsOf(r.outflow), 0));
  check('stage5', `cash outflow in ${KNOWN.stage5.cashOutPeriod} (cents)`, KNOWN.stage5.cashOutCents, cash.filter((r) => r.period === KNOWN.stage5.cashOutPeriod).reduce((s, r) => s + centsOf(r.outflow), 0));

  // ── stage 9: approvals, official progress, earned value ──
  const submissions = await tx.progressSubmission.findMany({
    where: { projectId: P },
    select: { id: true, activityId: true, status: true, pctComplete: true, submittedBy: true, reviewedBy: true, reviewedAt: true },
    orderBy: { id: 'asc' },
  });
  for (const [activityCode, pct] of Object.entries(KNOWN.stage9.official)) {
    const onActivity = submissions.filter((s) => s.activityId === A[activityCode]);
    const approved = onActivity.filter((s) => s.status === 'approved');
    check('stage9', `${activityCode}: one submission, approved, at ${pct}%`, [1, 1, pct], [onActivity.length, approved.length, approved.length === 1 ? numberOrNull(approved[0].pctComplete) : null]);
    check('stage9', `${activityCode}: claimed by the site engineer, approved by the PM`, [state.userIds.site, state.userIds.pm, true],
      [approved[0]?.submittedBy ?? null, approved[0]?.reviewedBy ?? null, Boolean(approved[0]?.reviewedAt)]);
    check('stage9', `${activityCode}: the approval's audited transition`, ['submitted->approved'], approved.length === 1 ? await transitionsOf('progress_submission', approved[0].id) : null);
  }
  check('stage9', 'the five allocations EV reads are approved', KNOWN.stage3.allocations.length, allocations.filter((r) => r.status === 'approved').length);

  const progressRows = await tx.activityProgress.findMany({
    where: { status: 'approved', activity: { projectId: P } },
    select: { id: true, activityId: true, pctComplete: true, approvedAt: true, updatedAt: true },
    orderBy: { id: 'asc' },
  });
  const when = (row) => at(row.approvedAt ?? row.updatedAt);
  /** The official percent of each activity as at an instant (null = now): the latest approved row, as earned-value.service reads it. */
  const officialAt = (instant) => {
    const latest = new Map();
    for (const row of progressRows) {
      if (instant !== null && !(when(row) < instant)) continue;
      const current = latest.get(row.activityId);
      if (!current || when(row) > when(current)) latest.set(row.activityId, row);
    }
    return latest;
  };
  const codeOf = new Map(Object.entries(A).map(([c, id]) => [id, c]));
  const official = officialAt(null);
  for (const [activityCode, pct] of Object.entries(KNOWN.stage9.official)) {
    check('stage9', `official progress ${activityCode}`, pct, numberOrNull(official.get(A[activityCode])?.pctComplete));
  }
  const allocatedByCode = {};
  for (const r of allocations.filter((row) => row.status === 'approved')) {
    const c = codeOf.get(r.activityId) || r.activityId;
    allocatedByCode[c] = (allocatedByCode[c] || 0) + centsOf(r.amount);
  }
  const pctOf = (map) => Object.fromEntries([...map.entries()].map(([id, row]) => [codeOf.get(id) || id, Number(row.pctComplete)]));
  check('stage9', 'EV now, from the stored approved progress and allocations (cents)', KNOWN.stage9.evFinalCents, evCents(allocatedByCode, pctOf(official)), 'database (derived)');
  const a130Approvals = progressRows.filter((r) => r.activityId === A.A130).sort((x, y) => when(x) - when(y));
  check('stage9', 'EV just before A130\'s approval, from the stored rows (cents)', KNOWN.stage9.evBeforeA130Cents,
    a130Approvals.length ? evCents(allocatedByCode, pctOf(officialAt(when(a130Approvals[0])))) : null, 'database (derived)');
  // The EV the stage observed and wrote to its state file: information, not a
  // check (CERT-3 WP-0 adjudication C) — the gating EV figures are the two
  // above, derived from the stored rows.
  out.info.stateFileEv = {
    afterA110AndA120: { knownCents: KNOWN.stage9.evBeforeA130Cents, recordedCents: numberOrNull(state.ev?.ev), agrees: KNOWN.stage9.evBeforeA130Cents === numberOrNull(state.ev?.ev) },
    afterA130: { knownCents: KNOWN.stage9.evFinalCents, recordedCents: numberOrNull(state.evAfter?.ev), agrees: KNOWN.stage9.evFinalCents === numberOrNull(state.evAfter?.ev) },
  };
  const snapshots = await tx.evPeriodSnapshot.findMany({ where: { projectId: P }, select: { id: true, cutoffDate: true, ev: true }, orderBy: { id: 'asc' } });
  out.info.evPeriodSnapshots = snapshots.map((s) => ({ id: s.id, cutoffDate: s.cutoffDate, evCents: centsOf(s.ev) }));
  out.info.approvedProgressRows = progressRows.length;

  // ── stage 14: the location and the RFI that points to it ──
  const locationCode = `${stamp}${KNOWN.stage14.codeSuffix}`;
  const location = await tx.location.findFirst({ where: { id: state.locationId }, select: { id: true, orgId: true, projectId: true, code: true, kind: true } });
  check('stage14', `the location is ${locationCode}, kind ${KNOWN.stage14.kind}, on the project`, [locationCode, KNOWN.stage14.kind, P, state.orgId],
    [location?.code ?? null, location?.kind ?? null, location?.projectId ?? null, location?.orgId ?? null]);
  const byCode = await tx.location.findMany({ where: { projectId: P, code: locationCode }, select: { id: true }, orderBy: { id: 'asc' } });
  check('stage14', `${locationCode} is exactly the recorded location`, [state.locationId], byCode.map((l) => l.id));
  const rfi = await tx.rfi.findFirst({ where: { id: state.rfiId }, select: { id: true, projectId: true, locationId: true, activityId: true } });
  check('stage14', 'the RFI is on the project and points to the location', [P, state.locationId], [rfi?.projectId ?? null, rfi?.locationId ?? null]);
  check('stage14', `the RFI is on ${KNOWN.stage14.activity}`, A[KNOWN.stage14.activity], rfi?.activityId ?? null);

  return out;
};

// ── the run ───────────────────────────────────────────────────────────────────
const main = async () => {
  const startedAt = new Date().toISOString();
  const result = { tool: NAME, startedAt, finishedAt: null, projectsSource: PROJECTS_SOURCE, codes: [], readOnly: {}, teeth: null, fingerprint: null, notVerifiable: [], projects: [], setupErrors: [], summary: null, exit: null };
  const setup = (message) => {
    result.setupErrors.push(message);
    console.error(`SETUP ERROR: ${message}`);
  };
  let prisma = null;

  try {
    assertSourceReadOnly();
    result.teeth = assertTeeth();

    const asked = process.argv.find((a) => a.startsWith('--codes='))?.split('=')[1]?.split(',').filter(Boolean);
    const codes = asked || CERTIFIED;
    const unknown = codes.filter((c) => !CERTIFIED.includes(c));
    if (unknown.length) throw new Error(`not certified companies: ${unknown.join(', ')}`);
    // eslint-disable-next-line global-require
    const fromSpec = require('../lib/spec').buildPopulation().companies.filter((c) => c.projects?.[0]?.depth === 'certified').map((c) => c.code);
    if (!same([...fromSpec].sort(), [...CERTIFIED].sort())) throw new Error(`lib/spec.js names ${fromSpec.length} certified companies (${fromSpec.join(',')}), not the 14 this verifier knows`);
    result.codes = codes;

    const states = new Map();
    for (const code of codes) {
      const { state, error } = readState(code);
      if (error) setup(error);
      else states.set(code, state);
    }
    if (result.setupErrors.length) throw new Error('state files are missing or incomplete');

    const scope = {
      orgIds: [...states.values()].map((s) => s.orgId),
      projectIds: [...states.values()].map((s) => s.projectId),
      // The 14 projects' own rows of the org-level tables: the directory companies and cost codes their state files name.
      companyIds: [...states.values()].flatMap((s) => Object.values(s.companies).map((c) => c?.id).filter(Boolean)),
      costCodeIds: [...states.values()].flatMap((s) => Object.values(s.costCodes).filter(Boolean)),
    };

    // One connection, through the guard; then the session is made read-only before any data is read.
    const env = { ...process.env, CERT_DATABASE_URL: singleConnection(guard.certDatabaseUrl()) };
    prisma = await guard.connectCertPrisma({ env });
    // eslint-disable-next-line global-require
    const { Prisma } = require('@prisma/client');
    await prisma.$executeRawUnsafe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    result.readOnly.before = await readOnlyNow(prisma);
    if (result.readOnly.before !== 'on') throw new Error(`the session is not read-only (transaction_read_only = ${result.readOnly.before})`);

    const before = await inReadOnlyTransaction(prisma, Prisma, (tx) => takeFingerprint(tx, scope));
    console.log(`fingerprint before: ${Object.keys(before.tables).length} tables`);

    const projects = await inReadOnlyTransaction(prisma, Prisma, async (tx) => {
      const list = [];
      for (const code of codes) {
        console.log(`C${code}: verifying ${states.get(code).projectName}`);
        list.push(await verifyProject(tx, code, states.get(code)));
      }
      return list;
    });

    const after = await inReadOnlyTransaction(prisma, Prisma, (tx) => takeFingerprint(tx, scope));
    result.readOnly.after = await readOnlyNow(prisma);
    const { differences, information } = compareFingerprints(before, after);
    result.fingerprint = { before, after, gate: "the 14 projects' hashed rows", identical: differences.length === 0, differences, information };
    if (result.readOnly.after !== 'on') setup(`the session is no longer read-only after the run (transaction_read_only = ${result.readOnly.after})`);
    if (differences.length) setup(`the 14 projects' hashed rows changed between before and after: ${differences.map((d) => d.table).join(', ')}`);
    if (information.length) console.log(`fingerprint information (not a gate): whole-table counts or company-wide rows moved in ${information.map((d) => d.table).join(', ')}`);

    for (const p of projects) {
      for (const message of p.setupErrors) setup(`C${p.code}: ${message}`);
      p.passed = p.checks.filter((c) => c.pass).length;
      p.contradictions = p.checks.filter((c) => !c.pass).length;
      p.runRecords = NOT_VERIFIABLE.map(({ stage, item, log }) => ({ stage, item, ...runRecord(p.code, log[0], log[1]) }));
      console.log(`C${p.code}: ${p.passed} of ${p.checks.length} stored figures match their known answers${p.contradictions ? `, ${p.contradictions} CONTRADICT them` : ''}`);
    }
    result.projects = projects;
  } catch (error) {
    setup(error.message);
  } finally {
    if (prisma) await prisma.$disconnect().catch((error) => setup(`disconnect: ${error.message}`));
  }

  result.notVerifiable = NOT_VERIFIABLE.map(({ stage, item, why }) => ({ stage, item, why, status: 'not verifiable post hoc' }));
  const checks = result.projects.flatMap((p) => p.checks);
  const contradictions = checks.filter((c) => !c.pass);
  result.summary = {
    projects: result.projects.length,
    checks: checks.length,
    passed: checks.length - contradictions.length,
    contradictions: contradictions.length,
    notVerifiable: result.notVerifiable.length,
    setupErrors: result.setupErrors.length,
  };
  result.exit = result.setupErrors.length ? 1 : contradictions.length ? 2 : 0;
  result.finishedAt = new Date().toISOString();

  fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
  fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 1));
  console.log(`\n${NAME}: ${result.summary.projects} projects, ${result.summary.passed} of ${result.summary.checks} stored figures match, ${result.summary.contradictions} contradict, ${result.summary.notVerifiable} not verifiable post hoc, ${result.summary.setupErrors} setup errors`);
  console.log(`fingerprint of the 14 projects' rows ${result.fingerprint ? (result.fingerprint.identical ? 'identical before and after' : 'CHANGED') : 'not taken'}${result.fingerprint?.information?.length ? ` (information: ${result.fingerprint.information.length} table(s) moved outside them)` : ''}; results ${RESULT_FILE}; exit ${result.exit}`);
  process.exitCode = result.exit;
};

main();
