'use strict';

/**
 * The CERT-2 proof of the remaining body shapes, of dates and numeric bounds,
 * and of the lead-time alert on a package ordered on twice (group bodies-4).
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/bodies-4-proof.js [attacker=054] [victim=055] [--only=shapes,dates,routes,numbers,alerts]
 *
 * SHAPES   Body fields express-validator took element by element: a purchase
 *          order line's boqItemId, budgetLineId, costCodeId, materialMasterId,
 *          packageId, supplierId; an activity's dependencies[].predecessorId
 *          and predecessorActivityId (POST and PATCH); a progress claim's
 *          entryIds[] and a bulk claim's updates[].entryIds[]; a transfer
 *          receipt's lines[].id; a bid package's boqSections[] (and the same
 *          on procurement's quote request). Each wrapped id — the company's
 *          own, company 055's, one that exists nowhere — is refused at the
 *          door (400 VALIDATION_ERROR naming the field), the same answer for
 *          all three, nothing stored. A transfer receipt naming a line the
 *          transfer does not have (055's, nowhere's) is refused whole (404
 *          TRANSFER_LINE_NOT_FOUND) — it used to book the line in full and drop
 *          the reported figures — and the transfer stays in transit.
 * DATES    occurredAt / expiryDate of every stock movement, and a delivered
 *          line's expiryDate on procurement's door: "x", {"not":"x"}, [] and
 *          ["2026-10-01"] were a 500 (new Date() on the raw value) — now a 400
 *          naming the field, nothing stored; a date is stored as given.
 * ROUTES   The date sweep's 76 other (route, field) pairs that answered 500 on
 *          [] (isISO8601() checks an array element by element) and four found
 *          after it (EOT weather links, contract notices, photo AI filters):
 *          each sent on company 054's own captured request with the field set
 *          to [] — a 400 naming the field, never a 5xx, nothing of company 054
 *          changed (fingerprint of the attacker's tables around the batch) —
 *          and gated on the same request with a date: accepted, or at least
 *          past the field's check (the record's own state answering).
 * NUMBERS  A unit cost of 1e15 (stock receipt, either goods-receipt door, the
 *          item master), a quantity of 1e15 (stock receipt, a delivered line,
 *          an order line), an order worth 10^16, a delivery at an ordered
 *          price beyond the item's price columns, an hourly rate of 1e20
 *          (worker create, edit, import): each a 400 before anything is
 *          stored; the largest figure the columns hold is accepted and stored.
 * ALERTS   A second (and third) order on a procurement package that already
 *          has a lead-time alert, and a material linked to such a package, are
 *          accepted (they answered 409 CONFLICT with Prisma's text); the
 *          package keeps exactly one alert, brought up to date, its
 *          acknowledgement kept; another company's package is refused exactly
 *          as one that exists nowhere.
 *
 * Every REFUSED check is GATED on the company's own request on the same record
 * being accepted (2xx) — or, where the record's own state forbids a second
 * acceptance, named "[door-gated]" and held only when the own value passes
 * the field's check. No answer may be a 5xx or carry anything of company 055,
 * no row of company 054 may come to name 055's ids, and company 055's data
 * must not change in any table (state fingerprint, before and after).
 *
 * Re-runnable: items, orders, transfers, activities, entries, packages,
 * workers are made fresh on every run, through the API, by company 054's own
 * people. Exit code 0 when every check holds, 2 otherwise.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { as } = require('../lib/api');
const { buildPopulation } = require('../lib/spec');
const { buildMatcher } = require('../lib/routes');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');
const { QUANTITY_MAX, UNIT_COST_MAX } = require('../../../src/utils/stock-figures');
const { RATE_MAX } = require('../../../src/services/timesheet.service');

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ATTACKER = positional[0] || '054';
const VICTIM = positional[1] || '055';
const ONLY = (process.argv.find((a) => a.startsWith('--only='))?.slice(7) || 'shapes,dates,routes,numbers,alerts').split(',');
const runs = (section) => ONLY.includes(section);
const GROUP = 'bodies-4';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `B4-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const INPROCESS = process.env.CERT_INPROCESS === '1';
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const results = [];
const answers = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const said = (res) => `${res.status} ${res.body?.error?.code || ''} ${String(res.body?.error?.message || '').split('\n')[0]}`.trim();
const ok2xx = (res) => Boolean(res) && res.status >= 200 && res.status < 300;
const is4xx = (res) => Boolean(res) && res.status >= 400 && res.status < 500;
const nowhere = () => crypto.randomUUID();
const gateHolds = (gate) => (gate && 'ok' in gate ? Boolean(gate.ok) : ok2xx(gate));
const gateSays = (gate) => (gate && 'ok' in gate ? gate.why : gate ? said(gate) : 'nothing sent');
const gated = (gate, name, ok, detail = '') =>
  check(`${name} [gated]`, gateHolds(gate) && ok, gateHolds(gate) ? detail : `NOT GATED — the record was not shown to accept the own value (${gateSays(gate)}); ${detail}`);
/** The fields a 400 VALIDATION_ERROR names. */
const fieldsNamed = (res) => (res?.body?.error?.code === 'VALIDATION_ERROR' ? (res.body.error.details || []).map((d) => d.field) : []);
const atDoor = (res, field) => res?.status === 400 && fieldsNamed(res).includes(field);
const distinct = (list) => [...new Set(list)];
/** Prisma's own words in an answer: what the alert defect leaked. */
const PRISMA_TEXT = /Invalid `|Unique constraint|prisma\.|tx\.[a-z]+\.(create|update)\(/;

// The product's local e-mail transport writes to the console in process; keep it out of the proof's output.
const print = console.log.bind(console);
console.log = (...args) => {
  const text = args.map(String).join(' ');
  if (text.startsWith('[email:local]')) return;
  print(...args);
};

/** The 76 (route, field) pairs of the date sweep that answered 500 on [] (routes/transmittals.js is another group's). */
const DATE_PAIRS = [
  ['POST /projects', ['startDate', 'endDate', 'completionDate', 'baselineDate', 'dataDate', 'revisedCompletionDate']],
  ['PATCH /projects/{id}', ['startDate', 'endDate', 'completionDate', 'baselineDate', 'dataDate', 'revisedCompletionDate']],
  ['POST /projects/{projectId}/weekly-reports', ['weekStartDate', 'weekEndDate']],
  ['PATCH /projects/{projectId}/weekly-reports/{id}', ['weekStartDate', 'weekEndDate']],
  ['PATCH /projects/{projectId}/purchase-orders/{orderId}', ['requiredBy', 'promisedDate']],
  ['POST /projects/{projectId}/cost/burn-rate', ['date']],
  ['POST /projects/{projectId}/change-orders', ['submittedDate']],
  ['PATCH /projects/{projectId}/prime-contract', ['startDate', 'completionDate']],
  ['POST /projects/{projectId}/prime-contract/advances', ['occurredAt']],
  ['POST /projects/{projectId}/budget-revisions', ['effectiveDate']],
  ['PATCH /projects/{projectId}/budget-revisions/{revisionId}', ['effectiveDate']],
  ['POST /projects/{projectId}/weather-delays', ['date', 'activityLinks.*.delayStart', 'activityLinks.*.delayEnd']],
  ['PATCH /projects/{projectId}/weather-delays/{weatherId}', ['date']],
  ['POST /projects/{projectId}/ncr', ['dueDate']],
  ['POST /projects/{projectId}/ncr/{ncrId}/submit', ['dueDate']],
  ['PATCH /projects/{projectId}/ncr/{ncrId}', ['dueDate']],
  ['POST /projects/{projectId}/itp', ['dueDate', 'inspectionDate']],
  ['PATCH /projects/{projectId}/itp/{itpId}', ['dueDate', 'inspectionDate']],
  ['POST /projects/{projectId}/defects', ['dueDate', 'targetCloseBy']],
  ['PATCH /projects/{projectId}/defects/{defectId}', ['dueDate', 'targetCloseBy']],
  ['POST /projects/{projectId}/safety', ['date', 'dueDate']],
  ['PATCH /projects/{projectId}/safety/{incidentId}', ['date', 'dueDate']],
  ['POST /projects/{projectId}/material-tests', ['dueDate', 'testDate']],
  ['PATCH /projects/{projectId}/material-tests/{testId}', ['dueDate', 'testDate']],
  ['POST /projects/{projectId}/rfi', ['raisedDate', 'dueDate', 'responseRequiredBy', 'answeredDate']],
  ['PATCH /projects/{projectId}/rfi/{rfiId}', ['raisedDate', 'dueDate', 'responseRequiredBy', 'answeredDate']],
  ['POST /projects/{projectId}/submittals/packages', ['requiredOnSite']],
  ['PATCH /projects/{projectId}/submittals/packages/{packageId}', ['requiredOnSite']],
  ['POST /projects/{projectId}/submittals', ['requiredOnSite', 'submittedOn', 'dueDate', 'reviewedOn']],
  ['POST /projects/{projectId}/drawings', ['dueDate', 'reviewedOn', 'issueDate']],
  ['PATCH /projects/{projectId}/drawings/{drawingId}', ['dueDate', 'reviewedOn', 'issueDate']],
  ['POST /projects/{projectId}/correspondence', ['date', 'dueDate', 'responseRequiredBy', 'responseDate']],
  ['PATCH /projects/{projectId}/correspondence/{correspondenceId}', ['date', 'dueDate', 'responseRequiredBy', 'responseDate']],
];

const main = async () => {
  console.log(`${GROUP} proof — attacker ${ATTACKER}, victim ${VICTIM}, stamp ${STAMP}, sections ${ONLY.join(',')}${INPROCESS ? ', in process (the working tree\'s code)' : ' — NOT in process: this asks a running API, which does not prove the working tree'}\n`);
  const { companies } = buildPopulation();
  const attacker = companies.find((c) => c.code === ATTACKER);
  const victim = companies.find((c) => c.code === VICTIM);
  if (!attacker || !victim) throw new Error(`unknown company ${ATTACKER} or ${VICTIM}`);
  const atkInv = JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'inventory', `${ATTACKER}.json`), 'utf8'));
  const A = Object.values(atkInv.projects).find((p) => p.depth === 'standard' && p.refs?.inventory?.warehouses?.site && p.refs?.inventory?.locations?.bins?.length && p.refs?.activities);
  if (!A) throw new Error(`company ${ATTACKER} needs a standard project with a site warehouse and bins`);
  const AP = `/projects/${A.id}`;

  const db = await guard.connectCert();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const one = async (sql, params = []) => (await q(sql, params))[0] || null;
  const num = async (sql, params = []) => Number((await one(sql, params))?.n ?? 0);
  const orgOf = async (code) => (await one(`select id::text as id from "Organisation" where slug like $1`, [`cert-${code}-%`]))?.id;
  const attackerOrg = await orgOf(ATTACKER);
  const victimOrg = await orgOf(VICTIM);
  if (!attackerOrg || !victimOrg) throw new Error('both companies must exist in the certification database');

  const pm = as(`pm@${attacker.domain}`);
  const procurement = as(`procurement@${attacker.domain}`);
  const store = as(`warehouse@${attacker.domain}`);
  const ask = async (who, method, route, body) => {
    const res = await who.send(method, route, body);
    answers.push({ route: `${method} ${route}`, status: res.status, text: res.text || '' });
    return res;
  };

  // ── the ids, each proven by its owner ─────────────────────────────────────
  const siteWh = A.refs.inventory.warehouses.site;
  const laydownWh = A.refs.inventory.warehouses.laydown;
  const supplierId = A.refs.inventory.supplierId;
  const ownActivity = (await one(`select id::text as id from "Activity" where "projectId" = $1 and "isActive" = true order by "createdAt" limit 1`, [A.id]))?.id;
  const qtyActivity = await one(`select a.id::text as activity, al.id::text as allocation, al."boqItemId"::text as boq
      from "Activity" a join "ActivityBoqAllocation" al on al."activityId" = a.id and al.status = 'approved'
      join "ActivityProgressMethod" m on m."activityId" = a.id and m.method = 'quantity'
     where a."projectId" = $1 and a."isActive" = true order by a."createdAt" limit 1`, [A.id]);
  const siteUser = (await one(`select id::text as id from "User" where email = $1`, [`site@${attacker.domain}`]))?.id;
  const OWN = {
    boqItemId: (await one(`select id::text as id from "BoqItem" where "projectId" = $1 order by "createdAt" limit 1`, [A.id]))?.id,
    budgetLineId: (await one(`select id::text as id from "BudgetLine" where "projectId" = $1 order by "createdAt" limit 1`, [A.id]))?.id,
    costCodeId: (await one(`select id::text as id from "CostCode" where "orgId" = $1 order by code limit 1`, [attackerOrg]))?.id,
    packageId: (await one(`select id::text as id from "ProcurementPackage" where "projectId" = $1 order by "createdAt" limit 1`, [A.id]))?.id,
    supplierId,
  };
  const victimOne = async (sql) => (await one(sql, [victimOrg]))?.id;
  const V = {
    boqItemId: await victimOne(`select b.id::text as id from "BoqItem" b join "Project" p on p.id = b."projectId" where p."orgId" = $1 order by b."createdAt" limit 1`),
    budgetLineId: await victimOne(`select b.id::text as id from "BudgetLine" b join "Project" p on p.id = b."projectId" where p."orgId" = $1 order by b."createdAt" limit 1`),
    costCodeId: await victimOne(`select id::text as id from "CostCode" where "orgId" = $1 order by code limit 1`),
    packageId: await victimOne(`select k.id::text as id from "ProcurementPackage" k join "Project" p on p.id = k."projectId" where p."orgId" = $1 order by k."createdAt" limit 1`),
    supplierId: await victimOne(`select s.id::text as id from "ProcurementSupplier" s join "Project" p on p.id = s."projectId" where p."orgId" = $1 order by s."createdAt" limit 1`),
    activityId: await victimOne(`select a.id::text as id from "Activity" a join "Project" p on p.id = a."projectId" where p."orgId" = $1 order by a."createdAt" limit 1`),
    entryId: await victimOne(`select id::text as id from "QuantityProgressEntry" where "orgId" = $1 order by "createdAt" limit 1`),
    transferLineId: await victimOne(`select id::text as id from "StockTransferLine" where "orgId" = $1 order by "createdAt" limit 1`),
  };
  const OWNER_SQL = {
    boqItemId: `select p."orgId"::text as org from "BoqItem" b join "Project" p on p.id = b."projectId" where b.id = $1`,
    budgetLineId: `select p."orgId"::text as org from "BudgetLine" b join "Project" p on p.id = b."projectId" where b.id = $1`,
    costCodeId: `select "orgId"::text as org from "CostCode" where id = $1`,
    packageId: `select p."orgId"::text as org from "ProcurementPackage" k join "Project" p on p.id = k."projectId" where k.id = $1`,
    supplierId: `select p."orgId"::text as org from "ProcurementSupplier" s join "Project" p on p.id = s."projectId" where s.id = $1`,
    activityId: `select p."orgId"::text as org from "Activity" a join "Project" p on p.id = a."projectId" where a.id = $1`,
    entryId: `select "orgId"::text as org from "QuantityProgressEntry" where id = $1`,
    transferLineId: `select "orgId"::text as org from "StockTransferLine" where id = $1`,
  };
  const ownerOf = async (kind, id) => (id ? (await one(OWNER_SQL[kind], [id]))?.org : null);
  const victimProven = {};
  for (const [kind, id] of Object.entries(V)) victimProven[kind] = Boolean(id) && (await ownerOf(kind, id)) === victimOrg;
  check(`setup: company ${VICTIM}'s records are proven ${VICTIM}'s from the database (${Object.keys(V).length} kinds)`, Object.values(victimProven).every(Boolean), JSON.stringify(Object.fromEntries(Object.entries(V).map(([k, id]) => [k, `${id || 'none'}${victimProven[k] ? '' : ' NOT PROVEN'}`]))));
  const ownProven = {};
  for (const [kind, id] of Object.entries(OWN)) ownProven[kind] = await ownerOf(kind, id);
  ownProven.activityId = await ownerOf('activityId', ownActivity);
  check(`setup: company ${ATTACKER}'s own records are proven ${ATTACKER}'s (project ${A.id}; quantity activity ${qtyActivity?.activity})`, Object.values(ownProven).every((org) => org === attackerOrg) && qtyActivity && siteUser, JSON.stringify(ownProven));

  const victimIds = distinct(Object.values(V).filter(Boolean));
  const victimTraces = new RegExp([`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`, ...victimIds].join('|'));
  const traced = (res) => victimTraces.test(res?.text || '');
  const trace = (res) => (traced(res) ? ` — answer carries ${(res.text.match(victimTraces) || [])[0]}` : '');

  // Rows of the attacker's company that name one of the victim's ids, in the tables these routes write.
  const NAMING = {
    ProcurementOrder: `select count(*)::int as n from "ProcurementOrder" t join "Project" p on p.id = t."projectId" where p."orgId" = $1`,
    ProcurementPoLine: `select count(*)::int as n from "ProcurementPoLine" t join "Project" p on p.id = t."projectId" where p."orgId" = $1`,
    ProcurementLeadTimeAlert: `select count(*)::int as n from "ProcurementLeadTimeAlert" t join "Project" p on p.id = t."projectId" where p."orgId" = $1`,
    ActivityDependency: `select count(*)::int as n from "ActivityDependency" t join "Project" p on p.id = t."projectId" where p."orgId" = $1`,
    ProgressSubmission: `select count(*)::int as n from "ProgressSubmission" t join "Project" p on p.id = t."projectId" where p."orgId" = $1`,
    QuantityProgressEntry: `select count(*)::int as n from "QuantityProgressEntry" t where t."orgId" = $1`,
    StockTransferLine: `select count(*)::int as n from "StockTransferLine" t where t."orgId" = $1`,
    StockTransaction: `select count(*)::int as n from "StockTransaction" t where t."orgId" = $1`,
    BidPackage: `select count(*)::int as n from "BidPackage" t where t."orgId" = $1`,
    Worker: `select count(*)::int as n from "Worker" t where t."orgId" = $1`,
  };
  const naming = async () => {
    const counts = {};
    for (const [tableName, sql] of Object.entries(NAMING)) {
      counts[tableName] = (await q(`${sql} and (${victimIds.map((_, i) => `to_jsonb(t)::text like '%' || $${i + 2} || '%'`).join(' or ')})`, [attackerOrg, ...victimIds]))[0].n;
    }
    return counts;
  };
  const SKIP_FINGERPRINT = process.env.CERT_PROOF_SKIP_FINGERPRINT === '1';
  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const taken = await fingerprint.take(db);
    await db.query('rollback');
    return taken;
  };
  const before = SKIP_FINGERPRINT ? null : await snapshot();
  const namingBefore = await naming();

  /** The company's stock, as the database holds it: every movement, position and item price. */
  const stockState = async () => JSON.stringify(await one(`select
      (select count(*)::int from "StockTransaction" where "orgId" = $1) as movements,
      (select md5(coalesce(string_agg(to_jsonb(b)::text, ',' order by b.id), '')) from "StockBalance" b where b."orgId" = $1) as positions,
      (select md5(coalesce(string_agg(i.id || ':' || i."averageCost"::text || ':' || coalesce(i."lastPurchasePrice"::text, '-') || ':' || i."unitCost"::text, ',' order by i.id), '')) from "InventoryItem" i where i."orgId" = $1) as prices,
      (select count(*)::int from "InventoryItem" where "orgId" = $1) as items,
      (select count(*)::int from "DeliveryReceipt" r join "Project" p on p.id = r."projectId" where p."orgId" = $1) as receipts`, [attackerOrg]));
  /** The company's orders, as the database holds them. */
  const orderState = async () => JSON.stringify(await one(`select
      (select count(*)::int from "ProcurementOrder" o join "Project" p on p.id = o."projectId" where p."orgId" = $1) as orders,
      (select md5(coalesce(string_agg(to_jsonb(l)::text, ',' order by l.id), '')) from "ProcurementPoLine" l join "Project" p on p.id = l."projectId" where p."orgId" = $1) as lines`, [attackerOrg]));

  const freshItem = async (label) => {
    const made = await ask(pm, 'POST', '/inventory/items', { sku: `${STAMP}-${label}`, name: `Proof ${label} ${STAMP}`, unit: 'nr', notes: `Proof ${STAMP}` });
    return made.body?.data?.id || null;
  };
  /** A fresh purchase order on the project, issued: its lines as given, nothing received yet. */
  const openOrder = async (label, lines) => {
    const made = await ask(procurement, 'POST', `${AP}/procurement/purchase-orders`, {
      supplierId, status: 'draft', currency: 'USD', orderDate: day(0), requiredBy: day(21), promisedDate: day(14), item: `Proof ${label} ${STAMP}`, notes: `Proof ${STAMP}`,
      lines: lines.map((line, i) => ({ lineNumber: i + 1, activityId: ownActivity, itemCode: `${STAMP}-${label}-${i + 1}`, description: `Proof ${label} ${i + 1} ${STAMP}`, unit: 'nr', ...line })),
    });
    const orderId = made.body?.data?.id;
    const steps = [];
    for (const [step, who] of [['submit', procurement], ['approve', pm], ['issue', procurement]]) steps.push(orderId ? await ask(who, 'POST', `${AP}/purchase-orders/${orderId}/${step}`, {}) : { status: 0 });
    const poLines = orderId ? (await q(`select id::text as id from "ProcurementPoLine" where "orderId" = $1 order by "lineNumber"`, [orderId])).map((r) => r.id) : [];
    const issued = made.status === 201 && steps.every((res) => res.status === 200);
    check(`open state (${label}): a fresh purchase order is created (201), submitted, approved and issued`, issued, `${said(made)}; ${steps.map(said).join(', ')}`);
    return { orderId, poLines, issued };
  };
  const receiptBy = async (number) => one(`select r.id::text as id from "DeliveryReceipt" r join "Project" p on p.id = r."projectId" where p."orgId" = $1 and r."receiptNumber" = $2`, [attackerOrg, number]);

  // ══ 1. SHAPES ═════════════════════════════════════════════════════════════
  if (runs('shapes')) {
    console.log('\n── shapes: identifiers taken element by element ──');
    const WRAPS = [['["id"]', (id) => [id]], ['[["id"]]', (id) => [[id]]]];

    // (a) a purchase order line's coding and references
    const poLine = (extra) => ({ lineNumber: 1, activityId: ownActivity, description: `Proof shape line ${STAMP}`, unit: 'nr', orderedQty: 1, unitCost: 2, ...extra });
    const po = (lines) => ask(procurement, 'POST', `${AP}/procurement/purchase-orders`, { supplierId, status: 'draft', currency: 'USD', item: `Proof shapes ${STAMP}`, lines });
    for (const field of ['boqItemId', 'budgetLineId', 'costCodeId', 'packageId', 'supplierId']) {
      const gate = await po([poLine({ [field]: OWN[field] })]);
      const storedOwn = gate.body?.data?.id ? (await one(`select "${field}"::text as v from "ProcurementPoLine" where "orderId" = $1`, [gate.body.data.id]))?.v : null;
      check(`ALLOWED POST purchase-orders lines[0].${field}: the company's own ${OWN[field]} as one string is accepted (201) and stored`, gate.status === 201 && storedOwn === OWN[field], `${said(gate)}; stored ${storedOwn}`);
      const stateBefore = await orderState();
      const sent = [];
      for (const [shape, make] of WRAPS) for (const [whose, id] of [['own', OWN[field]], ['foreign', V[field]], ['nowhere', nowhere()]]) sent.push({ shape, whose, res: await po([poLine({ [field]: make(id) })]) });
      const stateAfter = await orderState();
      gated(gate, `SHAPES POST purchase-orders lines[0].${field}: ["id"] and [["id"]] of own, ${VICTIM}'s and nowhere's — each refused at the door (400 VALIDATION_ERROR naming lines[0].${field}), the same answer for all, nothing stored, nothing of ${VICTIM}`,
        sent.every(({ res }) => atDoor(res, `lines[0].${field}`) && said(res) === said(sent[0].res) && !traced(res)) && stateBefore === stateAfter,
        `${distinct(sent.map(({ res }) => `${said(res)} [${fieldsNamed(res).join(',')}]`)).join(' | ')}${stateBefore === stateAfter ? '' : `; orders ${stateBefore} -> ${stateAfter}`}`);
    }
    // No material master exists in either company: the gate is the door — one string reaches the service.
    {
      const field = 'materialMasterId';
      const plain = await po([poLine({ [field]: nowhere() })]);
      const doorGate = { ok: plain.status === 404 && plain.body?.error?.code === 'MATERIAL_NOT_FOUND', why: said(plain) };
      check(`ALLOWED (door) POST purchase-orders lines[0].${field}: one string passes the door and is answered by the service (404 MATERIAL_NOT_FOUND) — no material master exists to accept`, doorGate.ok, said(plain));
      const stateBefore = await orderState();
      const sent = [];
      for (const [shape, make] of WRAPS) sent.push({ shape, res: await po([poLine({ [field]: make(nowhere()) })]) });
      const stateAfter = await orderState();
      gated(doorGate, `SHAPES [door-gated] POST purchase-orders lines[0].${field}: ["id"] and [["id"]] refused at the door (400 naming lines[0].${field}), nothing stored`,
        sent.every(({ res }) => atDoor(res, `lines[0].${field}`)) && stateBefore === stateAfter, distinct(sent.map(({ res }) => said(res))).join(' | '));
    }

    // (b) an activity's dependencies
    const activityName = `Proof dependency ${STAMP}`;
    // With a duration: one made without is scheduled with none (start = end) and every later edit of it
    // is then refused 400 INVALID_DATES — a product behaviour outside this proof.
    const span = { startDate: day(30), endDate: day(40), duration: 5 };
    const madeActivity = await ask(pm, 'POST', `${AP}/activities`, { name: activityName, ...span, engineerIds: [siteUser], dependencies: [{ predecessorId: ownActivity, relationshipType: 'FS', lagDays: 0 }] });
    const F = madeActivity.body?.data?.id;
    const depsOf = async (successorId) => JSON.stringify(await q(`select "predecessorId"::text as p, "relationshipType" as r from "ActivityDependency" where "successorId" = $1 order by "predecessorId"`, [successorId]));
    const fDeps = F ? await depsOf(F) : null;
    check(`ALLOWED POST activities dependencies[0].predecessorId: the company's own activity is accepted (201) and stored as the predecessor of the fresh activity ${F}`, madeActivity.status === 201 && fDeps === JSON.stringify([{ p: ownActivity, r: 'FS' }]), `${said(madeActivity)}; ${fDeps}`);
    const shapedName = `Proof dependency shape ${STAMP}`;
    const namedCount = async () => num(`select count(*)::int as n from "Activity" where "projectId" = $1 and name = $2`, [A.id, shapedName]);
    const depsBefore = F ? await depsOf(F) : null;
    const namedBefore = await namedCount();
    const depSent = [];
    for (const field of ['predecessorId', 'predecessorActivityId']) {
      for (const [shape, make] of WRAPS) {
        for (const [whose, id] of [['own', ownActivity], ['foreign', V.activityId], ['nowhere', nowhere()]]) {
          depSent.push({ field, shape, whose, verb: 'POST', res: await ask(pm, 'POST', `${AP}/activities`, { name: shapedName, ...span, engineerIds: [siteUser], dependencies: [{ [field]: make(id), relationshipType: 'FS' }] }) });
          if (F) depSent.push({ field, shape, whose, verb: 'PATCH', res: await ask(pm, 'PATCH', `${AP}/activities/${F}`, { dependencies: [{ [field]: make(id), relationshipType: 'FS' }] }) });
        }
      }
    }
    const depsAfter = F ? await depsOf(F) : null;
    const namedAfter = await namedCount();
    const patchGate = F ? await ask(pm, 'PATCH', `${AP}/activities/${F}`, { dependencies: [{ predecessorActivityId: ownActivity, relationshipType: 'SS' }] }) : { status: 0 };
    const patched = F ? await depsOf(F) : null;
    check('ALLOWED PATCH activities/{id} dependencies[0].predecessorActivityId: the company\'s own activity as one string is accepted (200) and stored (SS)', patchGate.status === 200 && patched === JSON.stringify([{ p: ownActivity, r: 'SS' }]), `${said(patchGate)}; ${patched}`);
    for (const field of ['predecessorId', 'predecessorActivityId']) {
      const mine = depSent.filter((s) => s.field === field);
      gated({ ok: madeActivity.status === 201 && patchGate.status === 200, why: `${said(madeActivity)}; ${said(patchGate)}` }, `SHAPES POST and PATCH activities dependencies[0].${field}: ["id"] and [["id"]] of own, ${VICTIM}'s and nowhere's — refused at the door (400 naming dependencies[0].${field}), the same answer for all, no activity made, the fresh activity's dependencies unchanged, nothing of ${VICTIM}`,
        mine.every(({ res }) => atDoor(res, `dependencies[0].${field}`) && said(res) === said(mine[0].res) && !traced(res)) && depsBefore === depsAfter && namedBefore === namedAfter,
        `${distinct(mine.map(({ res }) => `${said(res)} [${fieldsNamed(res).join(',')}]`)).join(' | ')}; deps ${depsBefore} -> ${depsAfter}; named ${namedBefore} -> ${namedAfter}`);
    }

    // (c) a progress claim's quantity entries
    const makeEntry = async (label) => {
      const res = await ask(pm, 'POST', `${AP}/quantity-progress`, { activityId: qtyActivity.activity, boqItemId: qtyActivity.boq, allocationId: qtyActivity.allocation, quantity: 0.001, date: day(0), status: 'submitted', note: `Proof ${label} ${STAMP}` });
      return res.body?.data?.entry?.id || res.body?.data?.id || null;
    };
    const submissions = async () => num(`select count(*)::int as n from "ProgressSubmission" where "activityId" = $1`, [qtyActivity.activity]);
    const bundledIn = async (entryId) => (await one(`select "submissionId"::text as s from "QuantityProgressEntry" where id = $1`, [entryId]))?.s ?? null;
    const e1 = await makeEntry('entry single');
    const e2 = await makeEntry('entry bulk');
    check(`open state: two fresh quantity entries on the quantity activity ${qtyActivity.activity}, in no bundle`, e1 && e2 && !(await bundledIn(e1)) && !(await bundledIn(e2)), `${e1} ${e2}`);
    const ENTRY_SHAPES = [['[["id"]]', (id) => [id]], ['[{"id":id}]', (id) => ({ id })]];
    const subsBefore = await submissions();
    const single = [];
    const bulk = [];
    for (const [shape, make] of ENTRY_SHAPES) {
      for (const [whose, id] of [['own', e1], ['foreign', V.entryId], ['nowhere', nowhere()]]) {
        single.push({ shape, whose, res: await ask(pm, 'POST', `${AP}/activities/${qtyActivity.activity}/progress`, { entryIds: [make(id)], notes: `Proof shape ${STAMP}` }) });
        bulk.push({ shape, whose, res: await ask(pm, 'POST', `${AP}/activities/bulk-progress`, { updates: [{ activityId: qtyActivity.activity, entryIds: [make(whose === 'own' ? e2 : id)], notes: `Proof shape ${STAMP}` }] }) });
      }
    }
    const subsAfter = await submissions();
    const unbundled = !(await bundledIn(e1)) && !(await bundledIn(e2));
    const singleGate = await ask(pm, 'POST', `${AP}/activities/${qtyActivity.activity}/progress`, { entryIds: [e1], notes: `Proof bundle ${STAMP}` });
    const bulkGate = await ask(pm, 'POST', `${AP}/activities/bulk-progress`, { updates: [{ activityId: qtyActivity.activity, entryIds: [e2], notes: `Proof bundle ${STAMP}` }] });
    check('ALLOWED POST activities/{id}/progress entryIds: the fresh entry as one string is accepted (2xx) and bundled', ok2xx(singleGate) && Boolean(await bundledIn(e1)), `${said(singleGate)}; bundled in ${await bundledIn(e1)}`);
    check('ALLOWED POST activities/bulk-progress updates[0].entryIds: the fresh entry as one string is accepted (2xx) and bundled', ok2xx(bulkGate) && Boolean(await bundledIn(e2)), `${said(bulkGate)}; bundled in ${await bundledIn(e2)}`);
    gated(singleGate, `SHAPES POST activities/{id}/progress entryIds[0]: [["id"]] and [{"id":id}] of own, ${VICTIM}'s and nowhere's — refused at the door (400 naming entryIds[0]), the same answer for all, nothing of ${VICTIM}`,
      single.every(({ res }) => atDoor(res, 'entryIds[0]') && said(res) === said(single[0].res) && !traced(res)), distinct(single.map(({ res }) => `${said(res)} [${fieldsNamed(res).join(',')}]`)).join(' | '));
    gated(bulkGate, `SHAPES POST activities/bulk-progress updates[0].entryIds[0]: the same shapes — refused at the door (400 naming updates[0].entryIds[0]), the same answer for all, nothing of ${VICTIM}`,
      bulk.every(({ res }) => atDoor(res, 'updates[0].entryIds[0]') && said(res) === said(bulk[0].res) && !traced(res)), distinct(bulk.map(({ res }) => `${said(res)} [${fieldsNamed(res).join(',')}]`)).join(' | '));
    gated({ ok: ok2xx(singleGate) && ok2xx(bulkGate), why: `${said(singleGate)}; ${said(bulkGate)}` }, 'SHAPES entryIds: …nothing stored (no submission made, both entries still in no bundle before the own claims)', subsBefore === subsAfter && unbundled, `submissions ${subsBefore} -> ${subsAfter}; unbundled ${unbundled}`);

    // (d) a transfer receipt's lines
    const tItem = await freshItem('TRF');
    const stocked = tItem ? await ask(store, 'POST', '/inventory/stock/receive', { itemId: tItem, warehouseId: siteWh, quantity: 20, unitCost: 1, reference: `Proof ${STAMP}` }) : { status: 0 };
    const made = tItem ? await ask(store, 'POST', '/inventory/transfers', { fromWarehouseId: siteWh, toWarehouseId: laydownWh, reason: `Proof lines ${STAMP}`, lines: [{ itemId: tItem, quantity: 2 }, { itemId: tItem, quantity: 2 }] }) : { status: 0 };
    const T = made.body?.data?.id;
    const dispatched = T ? await ask(store, 'POST', `/inventory/transfers/${T}/dispatch`, {}) : { status: 0 };
    const tLines = T ? (await q(`select id::text as id from "StockTransferLine" where "transferId" = $1 order by id`, [T])).map((r) => r.id) : [];
    const tState = async () => (T ? JSON.stringify(await q(`select t.status, l."receivedQty", l."damagedQty" from "StockTransfer" t join "StockTransferLine" l on l."transferId" = t.id where t.id = $1 order by l.id`, [T])) : null);
    const inTransit = await tState();
    check('open state: a fresh two-line transfer (2 + 2) of a fresh stocked item is created (201) and dispatched (200), in transit', stocked.status === 201 && made.status === 201 && dispatched.status === 200 && /in_transit/.test(inTransit || '') && tLines.length === 2, `${said(stocked)}; ${said(made)}; ${said(dispatched)}; ${inTransit}`);
    const receive = (lines) => ask(store, 'POST', `/inventory/transfers/${T}/receive`, { lines });
    const doorShapes = [];
    for (const [shape, value] of [['["own line"]', [tLines[0]]], ['[["own line"]]', [[tLines[0]]]], ['["foreign line"]', [V.transferLineId]], ['["nowhere"]', [nowhere()]], ['12345', 12345], ['no id', undefined]]) {
      const line = value === undefined ? { receivedQty: 1, damagedQty: 0 } : { id: value, receivedQty: 1, damagedQty: 0 };
      doorShapes.push({ shape, res: T ? await receive([line, { id: tLines[1], receivedQty: 2 }]) : { status: 0 }, state: await tState() });
    }
    const unknown = [];
    for (const [whose, id] of [['foreign', V.transferLineId], ['nowhere', nowhere()]]) {
      unknown.push({ whose, res: T ? await receive([{ id: tLines[0], receivedQty: 1, damagedQty: 0 }, { id, receivedQty: 1, damagedQty: 0 }]) : { status: 0 }, state: await tState() });
    }
    const tGate = T ? await receive([{ id: tLines[0], receivedQty: 1, damagedQty: 0 }, { id: tLines[1], receivedQty: 2, damagedQty: 0 }]) : { status: 0 };
    const landed = await tState();
    check('ALLOWED: the transfer is then received with its own line ids (200), the reported figures stored as reported (1 of 2 on the first line — not booked in full — and 2 of 2)', tGate.status === 200 && landed === JSON.stringify([{ status: 'received', receivedQty: 1, damagedQty: 0 }, { status: 'received', receivedQty: 2, damagedQty: 0 }]), `${said(tGate)}; ${landed}`);
    gated(tGate, 'SHAPES POST transfers/{id}/receive lines[0].id: ["own line"], [["own line"]], ["foreign line"], ["nowhere"], 12345 and no id — each refused at the door (400 naming lines[0].id), the same answer for all; the transfer stays in transit, untouched (["own line"] used to book the line in full)',
      doorShapes.every(({ res, state }) => atDoor(res, 'lines[0].id') && said(res) === said(doorShapes[0].res) && state === inTransit),
      doorShapes.map(({ shape, res, state }) => `${shape}: ${said(res)} [${fieldsNamed(res).join(',')}]${state === inTransit ? '' : ` state ${state}`}`).join(' | '));
    gated(tGate, `REFUSED POST transfers/{id}/receive: company ${VICTIM}'s transfer line is answered exactly as a line that exists nowhere (404 TRANSFER_LINE_NOT_FOUND), the request refused whole — the own line beside it not booked, the transfer still in transit — nothing of ${VICTIM}`,
      unknown.every(({ res, state }) => res.status === 404 && res.body?.error?.code === 'TRANSFER_LINE_NOT_FOUND' && said(res) === said(unknown[0].res) && state === inTransit && !traced(res)),
      unknown.map(({ whose, res, state }) => `${whose}: ${said(res)}${state === inTransit ? '' : ` state ${state}`}${trace(res)}`).join(' | '));

    // (e) a bid package's BOQ sections, and procurement's quote request
    const sectionName = `Proof section ${STAMP}`;
    const bidsNamed = async () => num(`select count(*)::int as n from "BidPackage" where "orgId" = $1 and title like $2`, [attackerOrg, `Proof sections ${STAMP}%`]);
    const bidsBefore = await bidsNamed();
    const sectionShapes = [];
    for (const [shape, boqSections, at] of [['[["x"]]', [['x']], 0], ['[{"not":"x"}]', [{ not: 'x' }], 0], ['[5]', [5], 0], ['[null]', [null], 0], ['[name, ["x"]]', [sectionName, ['x']], 1]]) {
      sectionShapes.push({ shape, at, res: await ask(pm, 'POST', `${AP}/bids`, { title: `Proof sections ${STAMP} ${shape}`, boqSections }) });
      sectionShapes.push({ shape: `quotes ${shape}`, at, res: OWN.packageId ? await ask(pm, 'POST', `${AP}/procurement/packages/${OWN.packageId}/quotes`, { title: `Proof sections ${STAMP} quotes ${shape}`, boqSections }) : { status: 0 } });
    }
    const bidsAfter = await bidsNamed();
    const bidGate = await ask(pm, 'POST', `${AP}/bids`, { title: `Proof sections ${STAMP} own`, boqSections: [sectionName] });
    const storedSections = bidGate.body?.data?.id ? (await one(`select "boqSections" as s from "BidPackage" where id = $1`, [bidGate.body.data.id]))?.s : null;
    const quoteGate = OWN.packageId ? await ask(pm, 'POST', `${AP}/procurement/packages/${OWN.packageId}/quotes`, { title: `Proof sections ${STAMP} quotes own`, boqSections: [sectionName] }) : { status: 0 };
    check(`ALLOWED POST bids boqSections: a section name is accepted (201) and stored as given`, bidGate.status === 201 && JSON.stringify(storedSections) === JSON.stringify([sectionName]), `${said(bidGate)}; stored ${JSON.stringify(storedSections)}`);
    check(`ALLOWED POST procurement/packages/{id}/quotes boqSections: a section name is accepted (201)`, quoteGate.status === 201, said(quoteGate));
    gated({ ok: bidGate.status === 201 && quoteGate.status === 201, why: `${said(bidGate)}; ${said(quoteGate)}` }, 'SHAPES POST bids and quotes boqSections[i]: [["x"]], [{"not":"x"}], [5], [null] — refused at the door (400 naming the element) — they were stored as "x", "[object Object]", "5", "" — and no package stored',
      sectionShapes.every(({ res, at }) => atDoor(res, `boqSections[${at}]`)) && bidsBefore === bidsAfter,
      `${distinct(sectionShapes.map(({ shape, res }) => `${shape}: ${said(res)} [${fieldsNamed(res).join(',')}]`)).join(' | ')}; packages ${bidsBefore} -> ${bidsAfter}`);
  }

  // ══ 2. DATES of the stock movements and the delivered lines ═══════════════
  if (runs('dates')) {
    console.log('\n── dates: a stock movement\'s occurredAt and expiryDate, a delivered line\'s expiryDate ──');
    const BAD_DATES = [['"x"', 'x'], ['{"not":"x"}', { not: 'x' }], ['[]', []], ['["2026-10-01"]', ['2026-10-01']], ['12345', 12345]];
    const dItem = await freshItem('DATES');
    const seed = dItem ? await ask(store, 'POST', '/inventory/stock/receive', { itemId: dItem, warehouseId: siteWh, quantity: 100, unitCost: 2, reference: `Proof ${STAMP}` }) : { status: 0 };
    const quarantined = dItem ? await ask(store, 'POST', '/inventory/stock/quarantine', { itemId: dItem, warehouseId: siteWh, quantity: 20, reference: `Proof ${STAMP}` }) : { status: 0 };
    check('open state: a fresh stocked item with 100 received (201) and 20 of it quarantined (201)', seed.status === 201 && quarantined.status === 201, `${said(seed)}; ${said(quarantined)}`);
    const movementOf = async (res) => {
      const id = res.body?.data?.id || res.body?.data?.movements?.[0]?.id;
      // The columns are timestamps without a zone, written in UTC.
      return id ? one(`select to_char("occurredAt", 'YYYY-MM-DD"T"HH24:MI:SS') as at, to_char("expiryDate", 'YYYY-MM-DD') as exp from "StockTransaction" where id = $1`, [id]) : null;
    };
    const ROUTES = [
      ['receive', { quantity: 1, unitCost: 2 }],
      ['adjust', { quantity: 1, notes: `Proof ${STAMP}` }],
      ['damage', { quantity: 1 }],
      ['quarantine', { quantity: 1 }],
      ['release', { quantity: 1 }],
      ['return', { quantity: 1, projectId: A.id }],
      ['issue', { quantity: 1, activityId: ownActivity }],
    ];
    for (const [route, extra] of ROUTES) {
      const base = { itemId: dItem, warehouseId: siteWh, reference: `Proof dates ${STAMP}`, ...extra };
      const stateBefore = await stockState();
      const sent = [];
      for (const field of ['occurredAt', 'expiryDate']) for (const [shape, value] of BAD_DATES) sent.push({ field, shape, res: await ask(store, 'POST', `/inventory/stock/${route}`, { ...base, [field]: value }) });
      const stateAfter = await stockState();
      const gate = await ask(store, 'POST', `/inventory/stock/${route}`, { ...base, occurredAt: '2026-10-01T08:00:00.000Z', expiryDate: '2027-06-30' });
      const stored = await movementOf(gate);
      check(`ALLOWED POST /inventory/stock/${route}: occurredAt and expiryDate that are dates are accepted (201) and stored as given`, gate.status === 201 && stored?.at === '2026-10-01T08:00:00' && stored?.exp === '2027-06-30', `${said(gate)}; stored ${JSON.stringify(stored)}`);
      gated(gate, `DATES POST /inventory/stock/${route} occurredAt and expiryDate "x", {"not":"x"}, [], ["2026-10-01"], 12345 — each refused at the door (400 naming the field; "x", {"not":"x"} and [] were a 500), nothing stored`,
        sent.every(({ field, res }) => atDoor(res, field)) && stateBefore === stateAfter,
        `${distinct(sent.map(({ field, shape, res }) => `${field} ${shape}: ${said(res)}`)).slice(0, 4).join(' | ')}${stateBefore === stateAfter ? '' : `; state ${stateBefore} -> ${stateAfter}`}${sent.filter(({ res }) => res.status >= 500).map(({ field, shape }) => ` 5xx ${field} ${shape}`).join('')}`);
    }
    // A delivered line's expiry date, both doors.
    const { orderId, poLines, issued } = await openOrder('dates', [{ orderedQty: 10, unitCost: 3 }]);
    const sent = [];
    let n = 0;
    for (const [shape, value] of BAD_DATES) {
      for (const door of ['procurement', 'inventory']) {
        n += 1;
        const number = `${STAMP}-DT-${n}`;
        const res = door === 'procurement'
          ? await ask(store, 'POST', `${AP}/procurement/purchase-orders/${orderId}/receipts`, { receiptNumber: number, warehouseId: siteWh, lines: [{ poLineId: poLines[0], acceptedQty: 1, expiryDate: value }] })
          : await ask(store, 'POST', '/inventory/goods-receipt', { orderId, warehouseId: siteWh, receiptNumber: number, lines: [{ poLineId: poLines[0], acceptedQty: 1, expiryDate: value }] });
        sent.push({ door, shape, res, stored: await receiptBy(number) });
      }
    }
    const itemOfLine = async () => (await one(`select "inventoryItemId"::text as id from "ProcurementPoLine" where id = $1`, [poLines[0]]))?.id ?? null;
    const noItemYet = !(await itemOfLine());
    const gate = issued ? await ask(store, 'POST', `${AP}/procurement/purchase-orders/${orderId}/receipts`, { receiptNumber: `${STAMP}-DT-OWN`, warehouseId: siteWh, lines: [{ poLineId: poLines[0], acceptedQty: 1, expiryDate: '2027-06-30' }] }) : { status: 0 };
    const gateExpiry = (await one(`select to_char(t."expiryDate", 'YYYY-MM-DD') as exp from "StockTransaction" t join "DeliveryReceiptLine" l on l.id = t."receiptLineId" join "DeliveryReceipt" r on r.id = l."receiptId" where r."receiptNumber" = $1 and r."orderId" = $2`, [`${STAMP}-DT-OWN`, orderId]))?.exp;
    check('ALLOWED (procurement door): a delivered line\'s expiry date that is a date is accepted (201) and stored on its stock movement', gate.status === 201 && gateExpiry === '2027-06-30', `${said(gate)}; stored ${gateExpiry}`);
    gated(gate, 'DATES (both doors) lines[0].expiryDate "x", {"not":"x"}, [], ["2026-10-01"], 12345 — each refused at the door (400 naming lines[0].expiryDate; the procurement door\'s were a 500), no receipt stored, no stocked item settled for the first delivery',
      sent.every(({ res, stored }) => atDoor(res, 'lines[0].expiryDate') && !stored) && noItemYet,
      `${distinct(sent.map(({ door, shape, res }) => `${door} ${shape}: ${said(res)}`)).slice(0, 4).join(' | ')}; item before the gate ${noItemYet ? 'none' : 'SETTLED'}`);
  }

  // ══ 3. ROUTES: the date sweep's 500s on [] ════════════════════════════════
  if (runs('routes')) {
    console.log('\n── dates on the other routes: [] where a date belongs ──');
    const routes = JSON.parse(fs.readFileSync(path.join(WORK, 'routes.json'), 'utf8'));
    const match = buildMatcher(routes);
    const wanted = new Map(DATE_PAIRS.map(([key, fields]) => [key, fields]));
    const chosen = new Map();
    const needle = `@c${ATTACKER}.octapm-cert.test"`;
    for (const file of fs.readdirSync(path.join(WORK, 'corpus')).filter((f) => f.endsWith('.jsonl'))) {
      const rl = readline.createInterface({ input: fs.createReadStream(path.join(WORK, 'corpus', file)), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.includes(needle)) continue;
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        if (!(entry.status >= 200 && entry.status < 300) || !entry.json || typeof entry.json !== 'object' || entry.file) continue;
        if (!String(entry.actor || '').endsWith(`@c${ATTACKER}.octapm-cert.test`)) continue;
        const hit = match(entry.method, entry.route);
        const key = hit && `${entry.method} ${hit.template}`;
        if (!key || !wanted.has(key) || chosen.has(key)) continue;
        // A nested field needs its container in the captured body.
        if (wanted.get(key).some((field) => field.includes('.*.') && !Array.isArray(entry.json[field.split('.')[0]]))) continue;
        chosen.set(key, entry);
      }
    }
    const setField = (body, field, value) => {
      const copy = JSON.parse(JSON.stringify(body));
      const parts = field.split('.');
      if (parts.length === 1) copy[field] = value;
      else copy[parts[0]][0][parts[2]] = value;
      return copy;
    };
    const missing = [...wanted.keys()].filter((key) => !chosen.has(key));
    check(`setup: an accepted request of company ${ATTACKER} for each of the ${wanted.size} routes (${DATE_PAIRS.reduce((s, [, f]) => s + f.length, 0)} fields)`, missing.length === 0, missing.length ? `none for ${missing.join(' | ')}` : '');

    // The refusals first, all of them, between two fingerprints of the attacker's own tables: refused at the door, nothing written.
    const atkBefore = SKIP_FINGERPRINT ? null : await snapshot();
    const refused = [];
    for (const [key, fields] of DATE_PAIRS) {
      const entry = chosen.get(key);
      if (!entry) continue;
      const session = as(entry.actor, entry.org || null);
      for (const field of fields) {
        const res = await session.send(entry.method, entry.route, setField(entry.json, field, []));
        answers.push({ route: `${entry.method} ${entry.route}`, status: res.status, text: res.text || '' });
        refused.push({ key, field, res });
      }
    }
    const atkAfter = SKIP_FINGERPRINT ? null : await snapshot();
    const atkMoved = SKIP_FINGERPRINT ? [] : fingerprint.compare(atkBefore, atkAfter).filter((c) => !c.noise && c.org === ATTACKER);
    // Then the gates: the same request as captured — the dates it carried, as it carried them.
    const gates = new Map();
    for (const [key] of DATE_PAIRS) {
      const entry = chosen.get(key);
      if (!entry) continue;
      const session = as(entry.actor, entry.org || null);
      const body = entry.json;
      // A new project per run is not made for the gate: a project's dates go through the same chain on PATCH /projects/{id}.
      if (key === 'POST /projects') {
        gates.set(key, { door: true, res: null, alias: 'PATCH /projects/{id}' });
        continue;
      }
      const res = await session.send(entry.method, entry.route, body);
      answers.push({ route: `${entry.method} ${entry.route}`, status: res.status, text: res.text || '' });
      gates.set(key, { res });
    }
    if (gates.has('POST /projects')) gates.set('POST /projects', gates.get('PATCH /projects/{id}') || { res: { status: 0 } });
    let accepted = 0;
    let doorOnly = 0;
    for (const [key, fields] of DATE_PAIRS) {
      const gateRes = gates.get(key)?.res;
      if (!gateRes) continue;
      const passesDoor = gateRes.status < 500 && !fields.some((field) => fieldsNamed(gateRes).includes(field.replace(/\.\*\./, '[0].')));
      const gate = ok2xx(gateRes) ? gateRes : { ok: passesDoor, why: `own request with dates: ${said(gateRes)}` };
      if (ok2xx(gateRes)) accepted += 1; else if (passesDoor) doorOnly += 1;
      const mine = refused.filter((r) => r.key === key);
      gated(gate, `DATES ${key} ${fields.join(', ')}${ok2xx(gateRes) ? '' : ' [door-gated: the own request is answered on its own state]'} — [] refused at the door (400 naming the field; it was a 500), nothing of ${VICTIM}`,
        mine.every(({ field, res }) => atDoor(res, field.replace(/\.\*\./, '[0].')) && !traced(res)),
        mine.map(({ field, res }) => `${field}: ${said(res)}`).join(' | ') + (ok2xx(gateRes) ? '' : ` | gate ${said(gateRes)} [${fieldsNamed(gateRes).join(',')}]`));
    }
    check(`DATES: …the ${refused.length} refused requests changed nothing of company ${ATTACKER} (its every table, fingerprinted before and after the batch)${SKIP_FINGERPRINT ? ' — SKIPPED (mutation run)' : ''}`, SKIP_FINGERPRINT || atkMoved.length === 0, atkMoved.slice(0, 8).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
    console.log(`      (gates: ${accepted} route(s) accepted the own request with dates, ${doorOnly} answered on the record's own state past the date check)`);

    // Four found after the sweep (no request of company 054 in the corpus, or the container absent).
    const co = (await one(`select id::text as id from "ChangeOrder" where "projectId" = $1 order by "createdAt" limit 1`, [A.id]))?.id;
    const photo = (await one(`select id::text as id from "Photo" where "projectId" = $1 order by "createdAt" limit 1`, [A.id]))?.id;
    const wd = (await one(`select id::text as id from "WeatherDelay" where "projectId" = $1 order by "createdAt" desc limit 1`, [A.id]))?.id;
    const EXTRA = [
      ['POST', `${AP}/eot`, 'weatherDelayLinks[0].delayStart', (d) => ({ eventName: `Proof EOT ${STAMP}`, delayDays: 1, weatherDelayLinks: [{ weatherDelayId: wd, delayStart: d, delayEnd: day(2) }] })],
      ['POST', `${AP}/eot`, 'weatherDelayLinks[0].delayEnd', (d) => ({ eventName: `Proof EOT ${STAMP}`, delayDays: 1, weatherDelayLinks: [{ weatherDelayId: wd, delayStart: day(1), delayEnd: d }] })],
      ['POST', `${AP}/contract/notices`, 'date', (d) => ({ recordType: 'change_order', recordId: co, subject: `Proof notice ${STAMP}`, body: `Proof notice ${STAMP}`, date: d })],
      ['POST', `${AP}/photos/ai/analyze`, 'from', (d) => ({ from: d, uncaptionedOnly: true, limit: 1 })],
      ['POST', `${AP}/photos/${photo}/ai/observation`, 'dueDate', (d) => ({ hazard: `Proof hazard ${STAMP}`, dueDate: d })],
    ];
    for (const [method, route, field, make] of EXTRA) {
      const bad = await ask(pm, method, route, make([]));
      const own = await ask(pm, method, route, make(day(1)));
      const gate = ok2xx(own) ? own : { ok: own.status < 500 && !fieldsNamed(own).includes(field), why: `own request with a date: ${said(own)}` };
      gated(gate, `DATES ${method} ${route.replace(A.id, '{projectId}').replace(photo || '-', '{photoId}')} ${field}${ok2xx(own) ? '' : ' [door-gated]'} — [] refused at the door (400 naming ${field}; it was a 500, or stored for the observation), nothing of ${VICTIM}`, atDoor(bad, field) && !traced(bad), `${said(bad)} [${fieldsNamed(bad).join(',')}] | own ${said(own)}`);
    }
  }

  // ══ 4. NUMBERS ════════════════════════════════════════════════════════════
  if (runs('numbers')) {
    console.log('\n── numbers: what the columns hold ──');
    // (a) a direct receipt
    const nItem = await freshItem('NUM');
    const base = { itemId: nItem, warehouseId: siteWh, reference: `Proof numbers ${STAMP}` };
    const stateBefore = await stockState();
    const sent = [];
    for (const [label, body, field] of [
      ['unitCost 1e15', { quantity: 1, unitCost: 1e15 }, 'unitCost'],
      [`unitCost ${UNIT_COST_MAX + 1}`, { quantity: 1, unitCost: UNIT_COST_MAX + 1 }, 'unitCost'],
      ['quantity 1e15 at 5', { quantity: 1e15, unitCost: 5 }, 'quantity'],
      ['quantity 1e15 at 0', { quantity: 1e15, unitCost: 0 }, 'quantity'],
      [`quantity ${QUANTITY_MAX + 1}`, { quantity: QUANTITY_MAX + 1, unitCost: 0 }, 'quantity'],
      ['damagedQty 1e15', { quantity: 1, unitCost: 1, damagedQty: 1e15 }, 'damagedQty'],
    ]) sent.push({ label, field, res: await ask(store, 'POST', '/inventory/stock/receive', { ...base, ...body }) });
    const valueRes = await ask(store, 'POST', '/inventory/stock/receive', { ...base, quantity: 1000, unitCost: UNIT_COST_MAX });
    const stateAfter = await stockState();
    const atMaxQty = await ask(store, 'POST', '/inventory/stock/receive', { ...base, quantity: QUANTITY_MAX, unitCost: 0 });
    const atMaxCost = await ask(store, 'POST', '/inventory/stock/receive', { ...base, quantity: 1, unitCost: UNIT_COST_MAX });
    const itemRow = await one(`select "lastPurchasePrice"::text as last, (select coalesce(sum("onHand"), 0)::float8 from "StockBalance" where "itemId" = $1 and "orgId" = $2) as on_hand from "InventoryItem" where id = $1`, [nItem, attackerOrg]);
    check(`ALLOWED POST /inventory/stock/receive: the largest quantity (${QUANTITY_MAX}) and the largest price (${UNIT_COST_MAX}) are accepted (201 each) and stored`, atMaxQty.status === 201 && atMaxCost.status === 201 && Number(itemRow?.on_hand) === QUANTITY_MAX + 1 && Number(itemRow?.last) === UNIT_COST_MAX, `${said(atMaxQty)}; ${said(atMaxCost)}; ${JSON.stringify(itemRow)}`);
    const gateRecv = { ok: atMaxQty.status === 201 && atMaxCost.status === 201, why: `${said(atMaxQty)}; ${said(atMaxCost)}` };
    gated(gateRecv, 'NUMBERS POST /inventory/stock/receive unitCost 1e15 (and one over the largest), quantity 1e15 (at a price, at none, one over the largest), damagedQty 1e15 — each refused at the door (400 naming the field; the price was a 500, the quantity stored)',
      sent.every(({ res, field }) => atDoor(res, field)), sent.map(({ label, res }) => `${label}: ${said(res)}`).join(' | '));
    gated(gateRecv, 'NUMBERS POST /inventory/stock/receive 1,000 at the largest price — worth 10^17 — refused by the service (400 INV_VALUE_TOO_LARGE); nothing of all of these stored',
      valueRes.status === 400 && valueRes.body?.error?.code === 'INV_VALUE_TOO_LARGE' && stateBefore === stateAfter, `${said(valueRes)}${stateBefore === stateAfter ? '' : `; state ${stateBefore} -> ${stateAfter}`}`);

    // (b) the item master's price
    const bigItem = await ask(pm, 'POST', '/inventory/items', { sku: `${STAMP}-PRICE-X`, name: `Proof price ${STAMP}`, unit: 'nr', unitCost: 1e15 });
    const bigStored = await num(`select count(*)::int as n from "InventoryItem" where "orgId" = $1 and sku = $2`, [attackerOrg, `${STAMP}-PRICE-X`]);
    const topItem = await ask(pm, 'POST', '/inventory/items', { sku: `${STAMP}-PRICE-TOP`, name: `Proof price top ${STAMP}`, unit: 'nr', unitCost: UNIT_COST_MAX });
    const topStored = (await one(`select "unitCost"::text as u from "InventoryItem" where "orgId" = $1 and sku = $2`, [attackerOrg, `${STAMP}-PRICE-TOP`]))?.u;
    check(`ALLOWED POST /inventory/items unitCost ${UNIT_COST_MAX}: accepted (201) and stored`, topItem.status === 201 && Number(topStored) === UNIT_COST_MAX, `${said(topItem)}; ${topStored}`);
    gated(topItem, 'NUMBERS POST /inventory/items unitCost 1e15 — refused at the door (400 naming unitCost; it was a 500), no item stored', atDoor(bigItem, 'unitCost') && bigStored === 0, `${said(bigItem)}; stored ${bigStored}`);

    // (c) the goods receipt, both doors: a price of 1e15, a quantity of 1e15
    const { orderId, poLines, issued } = await openOrder('numbers', [{ orderedQty: 10, unitCost: 6 }]);
    const lineItem = async (poLineId) => (await one(`select "inventoryItemId"::text as id from "ProcurementPoLine" where id = $1`, [poLineId]))?.id ?? null;
    const grSent = [];
    let n = 0;
    for (const [label, line, field] of [['unitCost 1e15', { acceptedQty: 1, unitCost: 1e15 }, 'lines[0].unitCost'], ['acceptedQty 1e15', { acceptedQty: 1e15 }, 'lines[0].acceptedQty']]) {
      for (const door of ['procurement', 'inventory']) {
        n += 1;
        const number = `${STAMP}-N-${n}`;
        const res = door === 'procurement'
          ? await ask(store, 'POST', `${AP}/procurement/purchase-orders/${orderId}/receipts`, { receiptNumber: number, warehouseId: siteWh, lines: [{ poLineId: poLines[0], ...line }] })
          : await ask(store, 'POST', '/inventory/goods-receipt', { orderId, warehouseId: siteWh, receiptNumber: number, lines: [{ poLineId: poLines[0], ...line }] });
        grSent.push({ label, door, field, res, stored: await receiptBy(number) });
      }
    }
    const noItem = !(await lineItem(poLines[0]));
    const grGate = issued ? await ask(store, 'POST', `${AP}/procurement/purchase-orders/${orderId}/receipts`, { receiptNumber: `${STAMP}-N-OWN`, warehouseId: siteWh, lines: [{ poLineId: poLines[0], acceptedQty: 1, unitCost: 7 }] }) : { status: 0 };
    check('ALLOWED (procurement door): a delivery at 7.00 on the same order is accepted (201)', grGate.status === 201, said(grGate));
    gated(grGate, 'NUMBERS (both doors) lines[0].unitCost 1e15 and lines[0].acceptedQty 1e15 — each refused at the door (400 naming the field; the price was a 500), no receipt, no stocked item settled for the first delivery',
      grSent.every(({ res, field, stored }) => atDoor(res, field) && !stored) && noItem, `${grSent.map(({ label, door, res }) => `${door} ${label}: ${said(res)}`).join(' | ')}; item before the gate ${noItem ? 'none' : 'SETTLED'}`);

    // (d) an order at a price the order holds but the item's price columns do not
    const big = await openOrder('ordered price', [{ orderedQty: 1, unitCost: 500_000_000_000_000 }]);
    const bigRes = big.issued ? await ask(store, 'POST', `${AP}/procurement/purchase-orders/${big.orderId}/receipts`, { receiptNumber: `${STAMP}-OP-1`, warehouseId: siteWh, lines: [{ poLineId: big.poLines[0], acceptedQty: 1 }] }) : { status: 0 };
    const bigNoItem = big.poLines[0] ? !(await lineItem(big.poLines[0])) : false;
    const bigNoReceipt = !(await receiptBy(`${STAMP}-OP-1`));
    const bigGate = big.issued ? await ask(store, 'POST', `${AP}/procurement/purchase-orders/${big.orderId}/receipts`, { receiptNumber: `${STAMP}-OP-OWN`, warehouseId: siteWh, lines: [{ poLineId: big.poLines[0], acceptedQty: 1, unitCost: 7 }] }) : { status: 0 };
    check('ALLOWED: the same order is delivered at a price the item holds, given on the line (201)', bigGate.status === 201, said(bigGate));
    gated(bigGate, 'NUMBERS a delivery at its ordered price of 500,000,000,000,000 — more than the item\'s price columns hold — refused by the service (400 INV_NUMBER; it was a 500) before the first delivery\'s stocked item is settled: no item, no receipt',
      bigRes.status === 400 && bigRes.body?.error?.code === 'INV_NUMBER' && bigNoItem && bigNoReceipt, `${said(bigRes)}; item ${bigNoItem ? 'none' : 'SETTLED'}; receipt ${bigNoReceipt ? 'none' : 'STORED'}`);

    // (e) an order's quantity and value
    const poLine = (extra) => ({ lineNumber: 1, activityId: ownActivity, description: `Proof value ${STAMP}`, unit: 'nr', ...extra });
    const ordersBefore = await orderState();
    const qtyRes = await ask(procurement, 'POST', `${AP}/procurement/purchase-orders`, { supplierId, status: 'draft', item: `Proof value ${STAMP}`, lines: [poLine({ orderedQty: 1e15, unitCost: 100 })] });
    const valRes = await ask(procurement, 'POST', `${AP}/procurement/purchase-orders`, { supplierId, status: 'draft', item: `Proof value ${STAMP}`, lines: [poLine({ orderedQty: 60_000_000_000, unitCost: 100_000 }), poLine({ lineNumber: 2, orderedQty: 60_000_000_000, unitCost: 100_000 })] });
    const ordersAfter = await orderState();
    const topOrder = await ask(procurement, 'POST', `${AP}/procurement/purchase-orders`, { supplierId, status: 'draft', item: `Proof value top ${STAMP}`, lines: [poLine({ orderedQty: QUANTITY_MAX, unitCost: 0.01 })] });
    const topValue = topOrder.body?.data?.id ? (await one(`select value::text as v from "ProcurementOrder" where id = $1`, [topOrder.body.data.id]))?.v : null;
    check(`ALLOWED POST purchase-orders: ${QUANTITY_MAX} at 0.01 is accepted (201), the order worth ${topValue}`, topOrder.status === 201 && Number(topValue) === Math.round(QUANTITY_MAX) / 100, `${said(topOrder)}; value ${topValue}`);
    gated(topOrder, 'NUMBERS POST purchase-orders lines[0].orderedQty 1e15 at 100.00 — refused at the door (400 naming lines[0].orderedQty; it was a 500) — and two lines worth 1.2 × 10^16 together — refused by the service (400 PO_VALUE_TOO_LARGE); no order stored',
      atDoor(qtyRes, 'lines[0].orderedQty') && valRes.status === 400 && valRes.body?.error?.code === 'PO_VALUE_TOO_LARGE' && ordersBefore === ordersAfter, `${said(qtyRes)} | ${said(valRes)}${ordersBefore === ordersAfter ? '' : `; orders ${ordersBefore} -> ${ordersAfter}`}`);

    // (f) a worker's hourly rate: create, edit, import
    const workerNamed = async (name) => one(`select id::text as id, "hourlyRate"::text as rate from "Worker" where "orgId" = $1 and name = $2`, [attackerOrg, name]);
    const refusedRates = [];
    for (const rate of [1e20, RATE_MAX + 1, -1]) {
      const name = `Proof rate ${STAMP} ${rate}`;
      refusedRates.push({ rate, res: await ask(pm, 'POST', `${AP}/timesheets/workers`, { name, hourlyRate: rate }), stored: await workerNamed(name) });
    }
    const topName = `Proof rate top ${STAMP}`;
    const topWorker = await ask(pm, 'POST', `${AP}/timesheets/workers`, { name: topName, hourlyRate: RATE_MAX });
    const topRow = await workerNamed(topName);
    check(`ALLOWED POST timesheets/workers hourlyRate ${RATE_MAX}: accepted (201) and stored`, topWorker.status === 201 && Number(topRow?.rate) === RATE_MAX, `${said(topWorker)}; ${JSON.stringify(topRow)}`);
    gated(topWorker, 'NUMBERS POST timesheets/workers hourlyRate 1e20, one over the largest, -1 — refused at the door (400 naming hourlyRate; 1e20 was a 500), no worker stored',
      refusedRates.every(({ res, stored }) => atDoor(res, 'hourlyRate') && !stored), refusedRates.map(({ rate, res }) => `${rate}: ${said(res)}`).join(' | '));
    const editBad = topRow ? await ask(pm, 'PATCH', `${AP}/timesheets/workers/${topRow.id}`, { hourlyRate: 1e20 }) : { status: 0 };
    const afterBad = topRow ? await workerNamed(topName) : null;
    const editOk = topRow ? await ask(pm, 'PATCH', `${AP}/timesheets/workers/${topRow.id}`, { hourlyRate: 40 }) : { status: 0 };
    const afterOk = topRow ? await workerNamed(topName) : null;
    check('ALLOWED PATCH timesheets/workers/{id} hourlyRate 40: accepted (200) and stored', editOk.status === 200 && Number(afterOk?.rate) === 40, `${said(editOk)}; ${JSON.stringify(afterOk)}`);
    gated(editOk, 'NUMBERS PATCH timesheets/workers/{id} hourlyRate 1e20 — refused at the door (400 naming hourlyRate; it was a 500), the rate unchanged', atDoor(editBad, 'hourlyRate') && afterBad?.rate === topRow?.rate, `${said(editBad)}; ${topRow?.rate} -> ${afterBad?.rate}`);
    const importRes = await ask(pm, 'POST', `${AP}/timesheets/workers/import`, { rows: [{ name: `Proof import overflow ${STAMP}`, employeeNumber: `${STAMP}-I1`, hourlyRate: 1e20 }, { name: `Proof import fine ${STAMP}`, employeeNumber: `${STAMP}-I2`, hourlyRate: 30 }] });
    const overflowRow = await workerNamed(`Proof import overflow ${STAMP}`);
    const fineRow = await workerNamed(`Proof import fine ${STAMP}`);
    check('ALLOWED POST timesheets/workers/import: the row at 30.00 is created', importRes.status === 200 && Number(fineRow?.rate) === 30, `${said(importRes)}; ${JSON.stringify(fineRow)}`);
    gated({ ok: importRes.status === 200 && Boolean(fineRow), why: said(importRes) }, 'NUMBERS POST timesheets/workers/import a row at 1e20 — reported as that row\'s error in the product\'s words, not stored',
      (importRes.body?.data?.errors || []).some((e) => e.row === 1 && /hourly rate/i.test(e.message)) && !overflowRow, `${JSON.stringify(importRes.body?.data?.errors)}; stored ${JSON.stringify(overflowRow)}`);
  }

  // ══ 5. ALERTS: a second order on a package that has an alert ══════════════
  if (runs('alerts')) {
    console.log('\n── lead-time alerts: one per package, kept up to date ──');
    const alertsOf = async (packageId) => q(`select id::text as id, "poLineId"::text as line, "activityMaterialId"::text as material, status from "ProcurementLeadTimeAlert" where "projectId" = $1 and "packageId" = $2 order by id`, [A.id, packageId]);
    const atRisk = (packageId, label) => ({ lineNumber: 1, activityId: ownActivity, packageId, description: `Proof alert ${label} ${STAMP}`, unit: 'nr', orderedQty: 1, unitCost: 2, requiredDate: day(5), promisedDate: day(40) });
    const order = (packageId, label) => ask(procurement, 'POST', `${AP}/procurement/purchase-orders`, { supplierId, status: 'draft', currency: 'USD', item: `Proof alert ${label} ${STAMP}`, lines: [atRisk(packageId, label)] });
    const lineOf = async (res) => (res.body?.data?.id ? (await one(`select id::text as id from "ProcurementPoLine" where "orderId" = $1`, [res.body.data.id]))?.id : null);

    const pkg = await ask(procurement, 'POST', `${AP}/procurement/packages`, { packageNumber: `${STAMP}-P1`, title: `Proof alert package ${STAMP}`, supplierId });
    const P = pkg.body?.data?.id;
    check(`open state: a fresh procurement package is created (201) with no lead-time alert`, pkg.status === 201 && P && (await alertsOf(P)).length === 0, said(pkg));
    const first = await order(P, 'first');
    const firstLine = await lineOf(first);
    const afterFirst = await alertsOf(P);
    check('ALLOWED: a first order on it, its line due on site five weeks after it is needed, is accepted (201) and raises one alert for the package, on that line', first.status === 201 && afterFirst.length === 1 && afterFirst[0].line === firstLine && afterFirst[0].status === 'open', `${said(first)}; ${JSON.stringify(afterFirst)}`);
    const second = await order(P, 'second');
    const secondLine = await lineOf(second);
    const afterSecond = await alertsOf(P);
    check('ALLOWED: a second order on the same package is accepted (201) — it was a 409 CONFLICT with Prisma\'s text — and the package keeps exactly one alert, now on the second order\'s line', second.status === 201 && afterSecond.length === 1 && afterSecond[0].id === afterFirst[0]?.id && afterSecond[0].line === secondLine, `${said(second)}; ${JSON.stringify(afterSecond)}${PRISMA_TEXT.test(second.text || '') ? ' — PRISMA TEXT IN THE ANSWER' : ''}`);
    const ack = afterSecond[0] ? await ask(procurement, 'PATCH', `${AP}/procurement/lead-time-alerts/${afterSecond[0].id}/acknowledge`, { note: `Proof ${STAMP}` }) : { status: 0 };
    const third = await order(P, 'third');
    const afterThird = await alertsOf(P);
    check('ALLOWED: the alert acknowledged (200), a third order on the package is accepted (201); still one alert, its acknowledgement kept', ack.status === 200 && third.status === 201 && afterThird.length === 1 && afterThird[0].status === 'acknowledged', `${said(ack)}; ${said(third)}; ${JSON.stringify(afterThird)}`);
    const listed = await ask(procurement, 'GET', `${AP}/procurement/lead-time-alerts`);
    const listedForP = (listed.body?.data || []).filter((row) => row.packageId === P);
    check('READ: the alert list (200) shows the package once', listed.status === 200 && listedForP.length === 1, `${said(listed)}; ${listedForP.length}`);

    // A material linked to a package that has an alert.
    const pkg2 = await ask(procurement, 'POST', `${AP}/procurement/packages`, { packageNumber: `${STAMP}-P2`, title: `Proof alert package 2 ${STAMP}`, supplierId });
    const P2 = pkg2.body?.data?.id;
    const ordered2 = await order(P2, 'material package');
    const material = await ask(pm, 'POST', `${AP}/activities/${ownActivity}/materials`, { name: `Proof material ${STAMP}`, unit: 'PCS', qty: 3, procurementPackageId: P2, requiredDate: day(5), leadWeeks: 12 });
    const afterMaterial = await alertsOf(P2);
    check('ALLOWED: a material linked to a package whose alert an order line holds is accepted (201) — it was a 409 CONFLICT — and the package keeps one alert, now the material\'s', pkg2.status === 201 && ordered2.status === 201 && material.status === 201 && afterMaterial.length === 1 && afterMaterial[0].material === material.body?.data?.id, `${said(pkg2)}; ${said(ordered2)}; ${said(material)}; ${JSON.stringify(afterMaterial)}`);

    // Another company's package on an order line: refused exactly as one that exists nowhere.
    const foreign = await order(V.packageId, 'foreign');
    const none = await order(nowhere(), 'nowhere');
    gated(second, `REFUSED: an order line on company ${VICTIM}'s package is answered exactly as one on a package that exists nowhere (status, code, message), nothing of ${VICTIM}`, is4xx(foreign) && said(foreign) === said(none) && !traced(foreign), `${said(foreign)} | ${said(none)}${trace(foreign)}`);
    const prismaLeaks = answers.filter((a) => /lead-time|purchase-orders|materials/.test(a.route) && PRISMA_TEXT.test(a.text));
    check('no answer of this section carries Prisma\'s own text', prismaLeaks.length === 0, prismaLeaks.slice(0, 3).map((a) => `${a.status} ${a.route}`).join(', '));
  }

  // ── after ────────────────────────────────────────────────────────────────
  console.log('\n── after ──');
  const namingAfter = await naming();
  const grew = Object.keys(NAMING).filter((t) => namingAfter[t] !== namingBefore[t]);
  check(`no row of company ${ATTACKER} names company ${VICTIM}'s ids that did not before`, grew.length === 0, grew.map((t) => `${t} ${namingBefore[t]}->${namingAfter[t]}`).join(', '));
  const leaked = answers.filter((a) => victimTraces.test(a.text));
  check(`no answer to company ${ATTACKER} carries company ${VICTIM}'s ids, names, addresses or canaries (${answers.length} answers)`, leaked.length === 0, leaked.slice(0, 6).map((a) => `${a.status} ${a.route} -> ${(a.text.match(victimTraces) || [])[0]}`).join('\n        '));
  const errors = answers.filter((a) => a.status >= 500);
  check(`no answer is a server error (${answers.length} answers)`, errors.length === 0, errors.slice(0, 5).map((a) => `${a.status} ${a.route} ${(a.text || '').slice(0, 160)}`).join('\n        '));
  if (SKIP_FINGERPRINT) {
    console.log(`(the fingerprints were skipped: CERT_PROOF_SKIP_FINGERPRINT=1, a mutation run — not a certifying run)`);
  } else {
    const after = await snapshot();
    const moved = fingerprint.compare(before, after).filter((c) => !c.noise && c.org === VICTIM);
    check(`company ${VICTIM}'s data did not change (every table)`, moved.length === 0, moved.slice(0, 8).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
  }
  await db.end();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${GROUP} proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
