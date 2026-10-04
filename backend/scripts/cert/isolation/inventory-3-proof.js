'use strict';

/**
 * The CERT-2 proof of the inventory and procurement-receipt shapes, of what a
 * direct stock movement may name, of a delivered line's price, and of the
 * receipt read side.
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/inventory-3-proof.js [attacker=054] [victim=055] [--only=stock,refs,transfers,receipts,reads]
 *
 * SHAPES (stock)   POST /inventory/stock/{receive,issue,return,adjust,damage,
 *                  quarantine,release,reserve}: every identifier the route
 *                  takes — itemId, warehouseId, locationId, projectId,
 *                  activityId, costCodeId, boqItemId, commitmentId,
 *                  locationRefId, poLineId, receiptLineId — sent as ["<id>"],
 *                  [["<id>"]] and {"id":"<id>"} of the company's own record,
 *                  of company 055's and of one that exists nowhere, and as
 *                  12345, true and {"not":"x"}. Each must be a 4xx, never a
 *                  5xx (74 of these were a 500 in the shape sweep); the same
 *                  answer (status, code, message) for own, foreign and
 *                  nowhere; refused at the door (400 VALIDATION_ERROR naming
 *                  the field); nothing stored (the company's movements, stock
 *                  positions and item prices read back unchanged).
 * REFS             A direct movement's work location, purchase-order line and
 *                  delivery line (stored as given before) are the company's
 *                  own: company 055's is refused exactly as one that exists
 *                  nowhere and nothing stored; the own one is stored. A
 *                  transfer's or a count's provenance is never the caller's:
 *                  own, foreign or nowhere, none of it is stored (a receipt
 *                  naming 055's transfer was stored; a transfer that exists
 *                  nowhere was a 500 on the foreign key).
 * TRANSFERS        POST /inventory/transfers fromWarehouseId, toWarehouseId,
 *                  lines[].itemId in every shape; a transfer receipt's line
 *                  that is not an object ([null] was a 500); a list filter
 *                  sent twice (?status=a&status=b was a 500).
 * RECEIPTS         Both doors to the goods receipt (POST /inventory/goods-
 *                  receipt and POST /projects/{p}/procurement/purchase-orders/
 *                  {o}/receipts): every identifier in every shape, receivedBy
 *                  and receivedAt; a line's unitCost that is not a number of
 *                  zero or more ("abc" reset the item's average, last price
 *                  and unit cost to 0) — refused, prices unchanged, and a
 *                  first delivery refused for its price leaves no stocked
 *                  item behind.
 * READS            Rows of company 054 that name company 055's records —
 *                  residue left by a reproduction before the write guards,
 *                  found in the database and left exactly as they are — serve
 *                  nothing of 055: the purchase-order list (three receipts
 *                  naming 055's daily report), a delivery's "how much have I
 *                  got now" and the item's weighted average (a balance of 054
 *                  in 055's bin).
 *
 * Every REFUSED check is GATED: it holds only when the request with the
 * company's own id on the same record was accepted (2xx). No answer may be a
 * 5xx or carry anything of company 055, no row of 054 may come to name 055's
 * ids, the residue rows stay exactly as they were, and company 055's data must
 * not change in any table (state fingerprint, before and after).
 *
 * Re-runnable: the stocked item, the orders, the transfers and the receipts
 * are made fresh on every run, through the API, by company 054's own people.
 * Exit code 0 when every check holds, 2 otherwise.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { as } = require('../lib/api');
const { buildPopulation } = require('../lib/spec');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ATTACKER = positional[0] || '054';
const VICTIM = positional[1] || '055';
const ONLY = (process.argv.find((a) => a.startsWith('--only='))?.slice(7) || 'stock,refs,transfers,receipts,reads').split(',');
const runs = (section) => ONLY.includes(section);
const GROUP = 'inventory-3';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `INV3-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const INPROCESS = process.env.CERT_INPROCESS === '1';
// The residue the brief names: receipts of company 054 naming company 055's daily report, and 054's
// stock balances in 055's bin. Found in the database and left exactly as they are.
const BRIEF_RESIDUE = ATTACKER === '054' && VICTIM === '055'
  ? {
      receipts: ['33137145-06e2-434d-ace8-537a0e7046ec', 'e3b7ec22-fe45-4009-9b79-8872d1f3fb46', '4291574b-ad7a-44f7-90e3-ee13d3788556'],
      report: '6d1fd9f2-ef89-49a0-b9a8-35a27e354d1d',
      bin: '8e89ee2f-82d2-4b11-8d47-d17d6f72df15',
      balances: ['32838085-6b82-49d9-9c20-128b5a2dcb6e', '69d4c9c2-24da-458d-961e-53862ff9350a'],
    }
  : null;

const results = [];
const answers = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const said = (res) => `${res.status} ${res.body?.error?.code || ''} ${res.body?.error?.message || ''}`.trim();
const ok2xx = (res) => Boolean(res) && res.status >= 200 && res.status < 300;
const is4xx = (res) => Boolean(res) && res.status >= 400 && res.status < 500;
const nowhere = () => crypto.randomUUID();
const gateHolds = (gate) => (gate && 'ok' in gate ? Boolean(gate.ok) : ok2xx(gate));
const gateSays = (gate) => (gate && 'ok' in gate ? gate.why : gate ? said(gate) : 'nothing sent');
const gated = (gate, name, ok, detail = '') =>
  check(`${name} [gated]`, gateHolds(gate) && ok, gateHolds(gate) ? detail : `NOT GATED — the record was not shown to accept the own id (${gateSays(gate)}); ${detail}`);
/** The fields a 400 VALIDATION_ERROR names. */
const fieldsNamed = (res) => (res?.body?.error?.code === 'VALIDATION_ERROR' ? (res.body.error.details || []).map((d) => d.field) : []);
/** Every wrong shape: the first three wrap an identifier (own, foreign and nowhere are sent), the rest do not. */
const SHAPES = [
  ['["id"]', (id) => [id], true],
  ['[["id"]]', (id) => [[id]], true],
  ['{"id":id}', (id) => ({ id }), true],
  ['12345', () => 12345, false],
  ['true', () => true, false],
  ['{"not":"x"}', () => ({ not: 'x' }), false],
];

// The product's local e-mail transport writes to the console in process; keep it out of the proof's output.
const print = console.log.bind(console);
console.log = (...args) => {
  const text = args.map(String).join(' ');
  if (text.startsWith('[email:local]')) return;
  print(...args);
};

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
  const inv = A.refs.inventory;
  const siteWh = inv.warehouses.site;
  const laydownWh = inv.warehouses.laydown;
  const ownBin = inv.locations.bins[0];
  const supplierId = inv.supplierId;
  const ownActivity = (await one(`select id::text as id from "Activity" where "projectId" = $1 and "isActive" = true order by "createdAt" limit 1`, [A.id]))?.id;
  const ownCostCode = (await one(`select id::text as id from "CostCode" where "orgId" = $1 order by code limit 1`, [attackerOrg]))?.id;
  const ownBoq = (await one(`select id::text as id from "BoqItem" where "projectId" = $1 order by "createdAt" limit 1`, [A.id]))?.id;
  const ownCommitment = (await one(`select id::text as id from "Commitment" where "projectId" = $1 and "orgId" = $2 order by "createdAt" limit 1`, [A.id, attackerOrg]))?.id;
  const ownWorkLocation = (await one(`select id::text as id from "Location" where "projectId" = $1 and "orgId" = $2 order by "createdAt" limit 1`, [A.id, attackerOrg]))?.id;
  const ownReport = (await one(`select id::text as id from "DailyReport" where "projectId" = $1 order by date desc limit 1`, [A.id]))?.id;

  const victimOne = async (sql) => (await one(sql, [victimOrg]))?.id;
  const V = {
    itemId: await victimOne(`select id::text as id from "InventoryItem" where "orgId" = $1 order by "createdAt" limit 1`),
    warehouseId: await victimOne(`select id::text as id from "Warehouse" where "orgId" = $1 order by "createdAt" limit 1`),
    locationId: await victimOne(`select id::text as id from "WarehouseLocation" where "orgId" = $1 and status = 'active' order by kind = 'bin' desc, "createdAt" limit 1`),
    projectId: await victimOne(`select id::text as id from "Project" where "orgId" = $1 order by "createdAt" limit 1`),
    activityId: await victimOne(`select a.id::text as id from "Activity" a join "Project" p on p.id = a."projectId" where p."orgId" = $1 order by a."createdAt" limit 1`),
    costCodeId: await victimOne(`select id::text as id from "CostCode" where "orgId" = $1 order by code limit 1`),
    boqItemId: await victimOne(`select b.id::text as id from "BoqItem" b join "Project" p on p.id = b."projectId" where p."orgId" = $1 order by b."createdAt" limit 1`),
    commitmentId: await victimOne(`select id::text as id from "Commitment" where "orgId" = $1 order by "createdAt" limit 1`),
    locationRefId: await victimOne(`select id::text as id from "Location" where "orgId" = $1 order by "createdAt" limit 1`),
    poLineId: await victimOne(`select l.id::text as id from "ProcurementPoLine" l join "Project" p on p.id = l."projectId" where p."orgId" = $1 order by l."createdAt" limit 1`),
    receiptLineId: await victimOne(`select l.id::text as id from "DeliveryReceiptLine" l join "Project" p on p.id = l."projectId" where p."orgId" = $1 order by l."createdAt" limit 1`),
    orderId: await victimOne(`select o.id::text as id from "ProcurementOrder" o join "Project" p on p.id = o."projectId" where p."orgId" = $1 order by o."createdAt" limit 1`),
    dailyReportId: await victimOne(`select d.id::text as id from "DailyReport" d join "Project" p on p.id = d."projectId" where p."orgId" = $1 order by d.date desc limit 1`),
    transferId: await victimOne(`select id::text as id from "StockTransfer" where "orgId" = $1 order by "createdAt" limit 1`),
    countId: await victimOne(`select id::text as id from "InventoryCount" where "orgId" = $1 order by "createdAt" limit 1`),
  };
  const OWNER_SQL = {
    itemId: `select "orgId"::text as org from "InventoryItem" where id = $1`,
    warehouseId: `select "orgId"::text as org from "Warehouse" where id = $1`,
    locationId: `select "orgId"::text as org from "WarehouseLocation" where id = $1`,
    projectId: `select "orgId"::text as org from "Project" where id = $1`,
    activityId: `select p."orgId"::text as org from "Activity" a join "Project" p on p.id = a."projectId" where a.id = $1`,
    costCodeId: `select "orgId"::text as org from "CostCode" where id = $1`,
    boqItemId: `select p."orgId"::text as org from "BoqItem" b join "Project" p on p.id = b."projectId" where b.id = $1`,
    commitmentId: `select "orgId"::text as org from "Commitment" where id = $1`,
    locationRefId: `select "orgId"::text as org from "Location" where id = $1`,
    poLineId: `select p."orgId"::text as org from "ProcurementPoLine" l join "Project" p on p.id = l."projectId" where l.id = $1`,
    receiptLineId: `select p."orgId"::text as org from "DeliveryReceiptLine" l join "Project" p on p.id = l."projectId" where l.id = $1`,
    orderId: `select p."orgId"::text as org from "ProcurementOrder" o join "Project" p on p.id = o."projectId" where o.id = $1`,
    dailyReportId: `select p."orgId"::text as org from "DailyReport" d join "Project" p on p.id = d."projectId" where d.id = $1`,
    transferId: `select "orgId"::text as org from "StockTransfer" where id = $1`,
    countId: `select "orgId"::text as org from "InventoryCount" where id = $1`,
  };
  const ownerOf = async (kind, id) => (id ? (await one(OWNER_SQL[kind], [id]))?.org : null);
  const victimProven = {};
  for (const [kind, id] of Object.entries(V)) victimProven[kind] = Boolean(id) && (await ownerOf(kind, id)) === victimOrg;
  check(`setup: company ${VICTIM}'s records are proven ${VICTIM}'s from the database (${Object.keys(V).length} kinds)`, Object.entries(V).every(([kind, id]) => kind === 'countId' || victimProven[kind]), JSON.stringify(Object.fromEntries(Object.entries(V).map(([k, id]) => [k, `${id || 'none'}${victimProven[k] ? '' : ' NOT PROVEN'}`]))));
  const ownProven = { siteWh: await ownerOf('warehouseId', siteWh), laydownWh: await ownerOf('warehouseId', laydownWh), ownBin: await ownerOf('locationId', ownBin), ownActivity: await ownerOf('activityId', ownActivity), ownCostCode: await ownerOf('costCodeId', ownCostCode), ownBoq: await ownerOf('boqItemId', ownBoq), ownCommitment: await ownerOf('commitmentId', ownCommitment), ownWorkLocation: await ownerOf('locationRefId', ownWorkLocation), ownReport: await ownerOf('dailyReportId', ownReport) };
  check(`setup: company ${ATTACKER}'s own records are proven ${ATTACKER}'s (project ${A.id})`, Object.values(ownProven).every((org) => org === attackerOrg), JSON.stringify(ownProven));

  // Residue: rows of the attacker's company that name the victim's records, left as they are.
  const residueReceipts = await q(`select r.id::text as id, r."dailyReportId"::text as report from "DeliveryReceipt" r join "Project" p on p.id = r."projectId" join "DailyReport" d on d.id = r."dailyReportId" join "Project" dp on dp.id = d."projectId" where p."orgId" = $1 and dp."orgId" = $2 order by r.id`, [attackerOrg, victimOrg]);
  const residueBalances = await q(`select b.id::text as id, b."itemId"::text as item, b."warehouseId"::text as wh, b."locationId"::text as loc from "StockBalance" b join "WarehouseLocation" l on l.id = b."locationId" where b."orgId" = $1 and l."orgId" = $2 order by b.id`, [attackerOrg, victimOrg]);
  if (BRIEF_RESIDUE) {
    check(`setup: the residue receipts of company ${ATTACKER} naming company ${VICTIM}'s daily report ${BRIEF_RESIDUE.report} are present (${BRIEF_RESIDUE.receipts.length})`,
      BRIEF_RESIDUE.receipts.every((id) => residueReceipts.some((row) => row.id === id && row.report === BRIEF_RESIDUE.report)) && (await ownerOf('dailyReportId', BRIEF_RESIDUE.report)) === victimOrg,
      JSON.stringify(residueReceipts));
    check(`setup: the residue balances of company ${ATTACKER} in company ${VICTIM}'s bin ${BRIEF_RESIDUE.bin} are present (${BRIEF_RESIDUE.balances.length})`,
      BRIEF_RESIDUE.balances.every((id) => residueBalances.some((row) => row.id === id && row.loc === BRIEF_RESIDUE.bin)),
      JSON.stringify(residueBalances));
  }
  const residueRows = async () => (await q(`select to_jsonb(r)::text as row from "DeliveryReceipt" r where r.id = any($1::text[])
    union all select to_jsonb(b)::text from "StockBalance" b where b.id = any($2::text[]) order by 1`, [residueReceipts.map((r) => r.id), residueBalances.map((r) => r.id)])).map((r) => r.row);
  const residueBefore = JSON.stringify(await residueRows());

  const victimIds = [...new Set(Object.values(V).filter(Boolean))];
  const victimTraces = new RegExp([`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`, ...victimIds].join('|'));
  const traced = (res) => victimTraces.test(res?.text || '');
  const trace = (res) => (traced(res) ? ` — answer carries ${(res.text.match(victimTraces) || [])[0]}` : '');

  // Rows of the attacker's company that name one of the victim's ids, in the tables these routes write.
  const NAMING = {
    StockBalance: `select count(*)::int as n from "StockBalance" t where t."orgId" = $1`,
    StockTransaction: `select count(*)::int as n from "StockTransaction" t where t."orgId" = $1`,
    StockTransfer: `select count(*)::int as n from "StockTransfer" t where t."orgId" = $1`,
    StockTransferLine: `select count(*)::int as n from "StockTransferLine" t where t."orgId" = $1`,
    DeliveryReceipt: `select count(*)::int as n from "DeliveryReceipt" t join "Project" p on p.id = t."projectId" where p."orgId" = $1`,
    DeliveryReceiptLine: `select count(*)::int as n from "DeliveryReceiptLine" t join "Project" p on p.id = t."projectId" where p."orgId" = $1`,
    ProcurementPoLine: `select count(*)::int as n from "ProcurementPoLine" t join "Project" p on p.id = t."projectId" where p."orgId" = $1`,
    InventoryItem: `select count(*)::int as n from "InventoryItem" t where t."orgId" = $1`,
  };
  const naming = async () => {
    const counts = {};
    for (const [tableName, sql] of Object.entries(NAMING)) {
      counts[tableName] = (await q(`${sql} and (${victimIds.map((_, i) => `to_jsonb(t)::text like '%' || $${i + 2} || '%'`).join(' or ')})`, [attackerOrg, ...victimIds]))[0].n;
    }
    return counts;
  };
  // A mutation run (a guard removed to show this proof fails) may skip the fingerprint, the slowest
  // read here; a run that certifies the tree never does.
  const SKIP_FINGERPRINT = process.env.CERT_PROOF_SKIP_FINGERPRINT === '1';
  const snapshot = async () => {
    if (SKIP_FINGERPRINT) return null;
    await db.query('begin transaction isolation level repeatable read read only');
    const taken = await fingerprint.take(db);
    await db.query('rollback');
    return taken;
  };
  const before = await snapshot();
  const namingBefore = await naming();

  /** The company's stock, as the database holds it: every movement, position and item price of the attacker's company. */
  const stockState = async () => JSON.stringify(await one(`select
      (select count(*)::int from "StockTransaction" where "orgId" = $1) as movements,
      (select md5(coalesce(string_agg(to_jsonb(b)::text, ',' order by b.id), '')) from "StockBalance" b where b."orgId" = $1) as positions,
      (select md5(coalesce(string_agg(i.id || ':' || i."averageCost"::text || ':' || coalesce(i."lastPurchasePrice"::text, '-') || ':' || i."unitCost"::text, ',' order by i.id), '')) from "InventoryItem" i where i."orgId" = $1) as prices,
      (select count(*)::int from "InventoryItem" where "orgId" = $1) as items,
      (select count(*)::int from "StockTransfer" where "orgId" = $1) as transfers`, [attackerOrg]));

  // ── fresh stock, brought in by this run ───────────────────────────────────
  const sku = `${STAMP}-ITEM`;
  const madeItem = await ask(pm, 'POST', '/inventory/items', { sku, name: `Proof item ${STAMP}`, unit: 'nr', notes: `Proof ${STAMP}` });
  const freshItem = madeItem.body?.data?.id;
  check(`open state: a fresh stocked item ${sku} is created (201)`, madeItem.status === 201 && freshItem, said(madeItem));
  const stocked = [];
  stocked.push(await ask(store, 'POST', '/inventory/stock/receive', { itemId: freshItem, warehouseId: siteWh, quantity: 200, unitCost: 5, reference: `Proof stock ${STAMP}` }));
  stocked.push(await ask(store, 'POST', '/inventory/stock/receive', { itemId: freshItem, warehouseId: siteWh, locationId: ownBin, quantity: 40, unitCost: 5, reference: `Proof stock ${STAMP}` }));
  stocked.push(await ask(store, 'POST', '/inventory/stock/quarantine', { itemId: freshItem, warehouseId: siteWh, quantity: 10, reference: `Proof stock ${STAMP}` }));
  stocked.push(await ask(store, 'POST', '/inventory/stock/quarantine', { itemId: freshItem, warehouseId: siteWh, locationId: ownBin, quantity: 5, reference: `Proof stock ${STAMP}` }));
  check('open state: 200 received into the site store and 40 into its own bin, 10 and 5 of them quarantined (201 each)', stocked.every((res) => res.status === 201), stocked.map(said).join(' | '));

  /** A fresh purchase order on the project, issued: one line, nothing received yet. */
  const openOrder = async (label, itemCode, orderedQty, unitCost = 6) => {
    const made = await ask(procurement, 'POST', `${AP}/procurement/purchase-orders`, {
      supplierId,
      status: 'draft',
      currency: 'USD',
      orderDate: new Date().toISOString().slice(0, 10),
      requiredBy: new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10),
      promisedDate: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
      item: `Proof ${label} order ${STAMP}`,
      notes: `Proof ${STAMP}`,
      lines: [{ lineNumber: 1, activityId: ownActivity, itemCode, description: `Proof ${label} line ${STAMP}`, unit: 'nr', orderedQty, unitCost }],
    });
    const orderId = made.body?.data?.id;
    const steps = [];
    for (const [step, who] of [['submit', procurement], ['approve', pm], ['issue', procurement]]) {
      steps.push(orderId ? await ask(who, 'POST', `${AP}/purchase-orders/${orderId}/${step}`, {}) : { status: 0, body: null });
    }
    const order = orderId ? await one(`select status from "ProcurementOrder" where id = $1`, [orderId]) : null;
    const poLine = orderId ? await one(`select id::text as id, "receivedQty", "inventoryItemId"::text as item from "ProcurementPoLine" where "orderId" = $1`, [orderId]) : null;
    check(`open state (${label}): a fresh purchase order is created (201), submitted, approved and issued; its line has nothing received and no stocked item`,
      made.status === 201 && steps.every((res) => res.status === 200) && order?.status === 'issued' && poLine && Number(poLine.receivedQty) === 0 && !poLine.item,
      `${said(made)}; ${steps.map(said).join(', ')}; ${order?.status}; ${JSON.stringify(poLine)}`);
    return { orderId, poLineId: poLine?.id };
  };
  const receiptOf = async (number) => one(`select r.id::text as id, r."dailyReportId"::text as report, r."receivedBy" as "receivedBy" from "DeliveryReceipt" r join "Project" p on p.id = r."projectId" where p."orgId" = $1 and r."receiptNumber" = $2`, [attackerOrg, number]);
  const lineState = async (poLineId) => JSON.stringify(await one(`select "receivedQty"::text as r, "inventoryItemId"::text as item from "ProcurementPoLine" where id = $1`, [poLineId]));

  // The company's own purchase-order line and delivery line, for the references a direct receipt may name.
  let ownPoLine = null;
  let ownReceiptLine = null;
  if (runs('stock') || runs('refs')) {
    const { orderId, poLineId } = await openOrder('references', `${STAMP}-REF`, 10);
    const first = await ask(store, 'POST', '/inventory/goods-receipt', { orderId, warehouseId: siteWh, receiptNumber: `${STAMP}-REF-1`, lines: [{ poLineId, acceptedQty: 1 }] });
    ownPoLine = poLineId;
    ownReceiptLine = (await one(`select l.id::text as id from "DeliveryReceiptLine" l join "DeliveryReceipt" r on r.id = l."receiptId" where r."receiptNumber" = $1 and r."orderId" = $2`, [`${STAMP}-REF-1`, orderId]))?.id;
    check(`open state: a delivery against a fresh order gives the company its own purchase-order line ${ownPoLine} and delivery line ${ownReceiptLine}`, first.status === 201 && ownPoLine && ownReceiptLine, said(first));
  }

  const OWN = { itemId: freshItem, warehouseId: siteWh, locationId: ownBin, projectId: A.id, activityId: ownActivity, costCodeId: ownCostCode, boqItemId: ownBoq, commitmentId: ownCommitment, locationRefId: ownWorkLocation, poLineId: ownPoLine, receiptLineId: ownReceiptLine };

  // ══ 1. the stock routes: every identifier in every shape ══════════════════
  if (runs('stock')) {
    console.log('\n── stock movements: identifiers of any other shape ──');
    const tag = `Proof shapes ${STAMP}`;
    const ROUTES = [
      ['receive', () => ({ itemId: freshItem, warehouseId: siteWh, quantity: 1, unitCost: 5, reference: tag }), ['itemId', 'warehouseId', 'locationId', 'projectId', 'activityId', 'costCodeId', 'boqItemId', 'commitmentId', 'locationRefId', 'poLineId', 'receiptLineId']],
      ['issue', () => ({ itemId: freshItem, warehouseId: siteWh, quantity: 1, costCodeId: ownCostCode, projectId: A.id, reference: tag }), ['itemId', 'warehouseId', 'locationId', 'activityId', 'costCodeId', 'boqItemId', 'projectId', 'commitmentId', 'locationRefId']],
      ['return', () => ({ itemId: freshItem, warehouseId: siteWh, quantity: 1, projectId: A.id, reference: tag }), ['itemId', 'warehouseId', 'locationId', 'projectId', 'activityId', 'costCodeId']],
      ['adjust', () => ({ itemId: freshItem, warehouseId: siteWh, quantity: 1, notes: tag }), ['itemId', 'warehouseId', 'locationId', 'projectId', 'activityId', 'costCodeId']],
      ['damage', () => ({ itemId: freshItem, warehouseId: siteWh, quantity: 1, reference: tag }), ['itemId', 'warehouseId', 'locationId', 'projectId', 'activityId', 'costCodeId']],
      ['quarantine', () => ({ itemId: freshItem, warehouseId: siteWh, quantity: 1, reference: tag }), ['itemId', 'warehouseId', 'locationId', 'projectId', 'activityId', 'costCodeId']],
      ['release', () => ({ itemId: freshItem, warehouseId: siteWh, quantity: 1, reference: tag }), ['itemId', 'warehouseId', 'locationId', 'projectId', 'activityId', 'costCodeId']],
      ['reserve', () => ({ itemId: freshItem, warehouseId: siteWh, quantity: 1, reference: tag }), ['itemId', 'warehouseId', 'locationId']],
    ];
    for (const [path, base, fields] of ROUTES) {
      const route = `/inventory/stock/${path}`;
      for (const field of fields) {
        // ALLOWED — the gate: the company's own id, as one string, on the same stock.
        const gate = await ask(store, 'POST', route, { ...base(), [field]: OWN[field] });
        const stateBefore = await stockState();
        const sent = [];
        for (const [shape, make, wraps] of SHAPES) {
          for (const [whose, id] of wraps ? [['own', OWN[field]], ['foreign', V[field]], ['nowhere', nowhere()]] : [['-', null]]) {
            sent.push({ shape, whose, res: await ask(store, 'POST', route, { ...base(), [field]: make(id) }) });
          }
        }
        const stateAfter = await stockState();
        const first = sent[0].res;
        gated(gate, `SHAPES POST ${route} ${field}: ${sent.length} wrongly shaped values (own, ${VICTIM}'s and nowhere ids wrapped; 12345, true, {"not":"x"}) — each a 4xx, never a 5xx, and the same answer for own, foreign and nowhere`,
          sent.every(({ res }) => is4xx(res)) && sent.every(({ res }) => said(res) === said(first)),
          `${[...new Set(sent.map(({ res }) => said(res)))].join(' | ')}${sent.filter(({ res }) => res.status >= 500).map(({ shape, whose }) => ` 5xx: ${shape} ${whose}`).join('')}`);
        gated(gate, `SHAPES POST ${route} ${field}: …refused at the door (400 VALIDATION_ERROR naming ${field})`,
          sent.every(({ res }) => res.status === 400 && res.body?.error?.code === 'VALIDATION_ERROR' && fieldsNamed(res).includes(field)),
          [...new Set(sent.map(({ shape, whose, res }) => `${shape}/${whose}: ${said(res)} [${fieldsNamed(res).join(',')}]`))].slice(0, 4).join(' | '));
        gated(gate, `SHAPES POST ${route} ${field}: …nothing stored (the company's movements, positions and item prices read back unchanged) and nothing of ${VICTIM} in any answer`,
          stateBefore === stateAfter && !sent.some(({ res }) => traced(res)),
          `${stateBefore === stateAfter ? '' : `state ${stateBefore} -> ${stateAfter}`}${sent.map(({ res }) => trace(res)).join('')}`);
      }
    }
  }

  // ══ 2. what a direct movement names ══════════════════════════════════════
  if (runs('refs')) {
    console.log('\n── a direct movement\'s work location, order line, delivery line; a transfer\'s and a count\'s provenance ──');
    const movementField = async (movementId, field) => (movementId ? (await one(`select "${field}"::text as v from "StockTransaction" where id = $1`, [movementId]))?.v ?? null : 'no movement');
    const CASES = [
      ['receive', 'locationRefId', 'LOCATION_NOT_FOUND', () => ({ itemId: freshItem, warehouseId: siteWh, quantity: 1, unitCost: 5 })],
      ['receive', 'poLineId', 'PO_LINE_NOT_FOUND', () => ({ itemId: freshItem, warehouseId: siteWh, quantity: 1, unitCost: 5 })],
      ['receive', 'receiptLineId', 'RECEIPT_LINE_NOT_FOUND', () => ({ itemId: freshItem, warehouseId: siteWh, quantity: 1, unitCost: 5 })],
      ['receive', 'locationRefId', 'LOCATION_NOT_FOUND', () => ({ itemId: freshItem, warehouseId: siteWh, quantity: 1, unitCost: 5, projectId: A.id })],
      ['issue', 'locationRefId', 'LOCATION_NOT_FOUND', () => ({ itemId: freshItem, warehouseId: siteWh, quantity: 1, costCodeId: ownCostCode, projectId: A.id })],
    ];
    for (const [path, field, code, base] of CASES) {
      const route = `/inventory/stock/${path}`;
      const label = `POST ${route} ${field}${base().projectId ? ' (on a project)' : ''}`;
      const ok = await ask(store, 'POST', route, { ...base(), [field]: OWN[field], reference: `Proof ref own ${STAMP}` });
      const okId = path === 'issue' ? ok.body?.data?.movements?.[0]?.id : ok.body?.data?.id;
      const stored = await movementField(okId, field);
      check(`ALLOWED ${label}: the company's own ${OWN[field]} is accepted (201) and stored on the movement`, ok.status === 201 && stored === OWN[field], `${said(ok)}; stored ${stored}`);
      const stateBefore = await stockState();
      const bad = await ask(store, 'POST', route, { ...base(), [field]: V[field], reference: `Proof ref foreign ${STAMP}` });
      const none = await ask(store, 'POST', route, { ...base(), [field]: nowhere(), reference: `Proof ref nowhere ${STAMP}` });
      const stateAfter = await stockState();
      gated(ok, `REFUSED ${label}: company ${VICTIM}'s ${V[field]} is refused (404 ${code}) exactly as one that exists nowhere (status, code, message)`, is4xx(bad) && bad.body?.error?.code === code && said(bad) === said(none), `${said(bad)} | ${said(none)}`);
      gated(ok, `REFUSED ${label}: …nothing stored (movements, positions, prices unchanged), nothing of ${VICTIM} in the answer`, stateBefore === stateAfter && !traced(bad), `${stateBefore === stateAfter ? '' : `state ${stateBefore} -> ${stateAfter}`}${trace(bad)}`);
    }

    // A transfer's or a count's provenance is the product's to write: a fresh transfer of the company's own.
    const ownTransfer = await ask(store, 'POST', '/inventory/transfers', { fromWarehouseId: siteWh, toWarehouseId: laydownWh, reason: `Proof provenance ${STAMP}`, lines: [{ itemId: freshItem, quantity: 1 }] });
    const ownTransferId = ownTransfer.body?.data?.id;
    const victimTransferNaming = async () => num(`select count(*)::int as n from "StockTransaction" where "orgId" = $1 and ("transferId" = $2 or "countId" = $3)`, [attackerOrg, V.transferId, V.countId || V.transferId]);
    const namingTransferBefore = await victimTransferNaming();
    const provenance = [];
    for (const [whose, id] of [['own', ownTransferId], ['foreign', V.transferId], ['nowhere', nowhere()]]) {
      for (const path of ['receive', 'adjust']) {
        const body = path === 'receive'
          ? { itemId: freshItem, warehouseId: siteWh, quantity: 1, unitCost: 5, transferId: id, countId: whose === 'foreign' ? (V.countId || nowhere()) : id, reference: `Proof provenance ${whose} ${STAMP}` }
          : { itemId: freshItem, warehouseId: siteWh, quantity: 1, notes: `Proof provenance ${whose} ${STAMP}`, transferId: id, countId: whose === 'foreign' ? (V.countId || nowhere()) : id };
        const res = await ask(store, 'POST', `/inventory/stock/${path}`, body);
        const movementId = path === 'receive' ? res.body?.data?.id : res.body?.data?.movements?.[0]?.id;
        provenance.push({ whose, path, res, transfer: await movementField(movementId, 'transferId'), count: await movementField(movementId, 'countId') });
      }
    }
    const ownCase = provenance.filter((row) => row.whose === 'own');
    const ownGate = { ok: ownTransfer.status === 201 && ownCase.every((row) => row.res.status === 201), why: `own transfer ${said(ownTransfer)}; ${ownCase.map((row) => said(row.res)).join(', ')}` };
    check('ALLOWED: a direct receipt and an adjustment naming the company\'s own transfer are accepted (201), and the transfer is not taken from the caller (nothing stored)', ownGate.ok && ownCase.every((row) => row.transfer === null && row.count === null), JSON.stringify(ownCase.map((row) => ({ path: row.path, status: row.res.status, transferId: row.transfer, countId: row.count }))));
    gated(ownGate, `REFUSED: naming company ${VICTIM}'s transfer (or count) is answered exactly as one that exists nowhere (201, nothing of it stored) — not a 500 for nowhere, not stored for ${VICTIM}`,
      provenance.every((row) => row.res.status === 201 && row.transfer === null && row.count === null),
      JSON.stringify(provenance.map((row) => ({ whose: row.whose, path: row.path, said: said(row.res), transferId: row.transfer, countId: row.count }))));
    gated(ownGate, `NOTHING: no movement of company ${ATTACKER} names company ${VICTIM}'s transfer or count that did not before`, (await victimTransferNaming()) === namingTransferBefore, `${namingTransferBefore} -> ${await victimTransferNaming()}`);
  }

  // ══ 3. transfers ══════════════════════════════════════════════════════════
  if (runs('transfers')) {
    console.log('\n── transfers: identifiers of any other shape; a reported line that is not an object; list filters sent twice ──');
    const base = () => ({ fromWarehouseId: siteWh, toWarehouseId: laydownWh, reason: `Proof transfer shapes ${STAMP}`, lines: [{ itemId: freshItem, quantity: 1 }] });
    const TFIELDS = [
      ['fromWarehouseId', siteWh, V.warehouseId, (body, value) => ({ ...body, fromWarehouseId: value })],
      ['toWarehouseId', laydownWh, V.warehouseId, (body, value) => ({ ...body, toWarehouseId: value })],
      ['lines[0].itemId', freshItem, V.itemId, (body, value) => ({ ...body, lines: [{ itemId: value, quantity: 1 }] })],
    ];
    for (const [field, own, foreign, put] of TFIELDS) {
      const gate = await ask(store, 'POST', '/inventory/transfers', put(base(), own));
      const stateBefore = await stockState();
      const sent = [];
      for (const [shape, make, wraps] of SHAPES) {
        for (const [whose, id] of wraps ? [['own', own], ['foreign', foreign], ['nowhere', nowhere()]] : [['-', null]]) {
          sent.push({ shape, whose, res: await ask(store, 'POST', '/inventory/transfers', put(base(), make(id))) });
        }
      }
      const stateAfter = await stockState();
      gated(gate, `SHAPES POST /inventory/transfers ${field}: ${sent.length} wrongly shaped values — each a 4xx, never a 5xx, the same answer for own, foreign and nowhere, refused at the door (400 VALIDATION_ERROR naming ${field})`,
        sent.every(({ res }) => res.status === 400 && said(res) === said(sent[0].res) && fieldsNamed(res).includes(field)),
        [...new Set(sent.map(({ res }) => `${said(res)} [${fieldsNamed(res).join(',')}]`))].join(' | '));
      gated(gate, `SHAPES POST /inventory/transfers ${field}: …nothing stored (no transfer, no movement), nothing of ${VICTIM} in any answer`, stateBefore === stateAfter && !sent.some(({ res }) => traced(res)), `${stateBefore === stateAfter ? '' : `state ${stateBefore} -> ${stateAfter}`}`);
    }

    // A transfer receipt's reported line that is not an object: on a dispatched (in transit) transfer.
    const made = await ask(store, 'POST', '/inventory/transfers', { ...base(), reason: `Proof transfer lines ${STAMP}`, lines: [{ itemId: freshItem, quantity: 2 }] });
    const transferId = made.body?.data?.id;
    const sentOut = transferId ? await ask(store, 'POST', `/inventory/transfers/${transferId}/dispatch`, {}) : { status: 0 };
    const transferState = async () => JSON.stringify(await q(`select t.status, l."receivedQty", l."damagedQty" from "StockTransfer" t join "StockTransferLine" l on l."transferId" = t.id where t.id = $1 order by l.id`, [transferId]));
    const inTransit = transferId ? await transferState() : null;
    const odd = [];
    for (const lines of [[null], ['x'], [12345], [null, null]]) {
      odd.push({ lines, res: transferId ? await ask(store, 'POST', `/inventory/transfers/${transferId}/receive`, { lines }) : { status: 0 }, state: transferId ? await transferState() : null });
    }
    const lineId = transferId ? (await one(`select id::text as id from "StockTransferLine" where "transferId" = $1`, [transferId]))?.id : null;
    const received = transferId ? await ask(store, 'POST', `/inventory/transfers/${transferId}/receive`, { lines: [{ id: lineId, receivedQty: 2, damagedQty: 0 }] }) : { status: 0 };
    check('open state: a fresh transfer is created (201) and dispatched (200), in transit', made.status === 201 && sentOut.status === 200 && /in_transit/.test(inTransit || ''), `${said(made)}; ${said(sentOut)}; ${inTransit}`);
    gated(received, 'REFUSED POST /inventory/transfers/{id}/receive lines [null], ["x"], [12345]: each a 400 naming lines[0] — not a 500, not a receipt in full — and the transfer stays in transit, untouched',
      odd.every(({ res, state }) => res.status === 400 && fieldsNamed(res).includes('lines[0]') && state === inTransit),
      odd.map(({ lines, res, state }) => `${JSON.stringify(lines)}: ${said(res)}${state === inTransit ? '' : ` state ${state}`}`).join(' | '));
    check('ALLOWED: the transfer is then received with its own line id (200)', received.status === 200, said(received));

    // List filters sent twice: one string each, or a 400 — never a 500.
    const FILTERS = [
      ['/inventory/transfers', 'status', 'draft', 'received', 'in_transit'],
      ['/inventory/items', 'status', 'active', 'archived', 'active'],
      ['/inventory/stock/transactions', 'itemId', freshItem, V.itemId, nowhere()],
      ['/inventory/stock/transactions', 'warehouseId', siteWh, V.warehouseId, nowhere()],
      ['/inventory/stock/transactions', 'projectId', A.id, V.projectId, nowhere()],
      ['/inventory/stock/transactions', 'activityId', ownActivity, V.activityId, nowhere()],
      ['/inventory/items', 'projectId', A.id, V.projectId, nowhere()],
      ['/inventory/warehouses', 'projectId', A.id, V.projectId, nowhere()],
      ['/inventory/summary', 'projectId', A.id, V.projectId, nowhere()],
      ['/inventory/analytics', 'projectId', A.id, V.projectId, nowhere()],
      ['/inventory/purchase-orders', 'projectId', A.id, V.projectId, nowhere()],
    ];
    for (const [route, key, own, foreign, other] of FILTERS) {
      const gate = await ask(store, 'GET', `${route}?${key}=${own}`);
      const twiceForeign = await ask(store, 'GET', `${route}?${key}=${own}&${key}=${foreign}`);
      const twiceOther = await ask(store, 'GET', `${route}?${key}=${own}&${key}=${other}`);
      gated(gate, `SHAPES GET ${route}?${key} sent twice (own + ${foreign === V[key] ? `${VICTIM}'s` : 'another'} | own + ${other === own ? 'own' : 'nowhere'}): a 400, never a 5xx, the same answer either way, nothing of ${VICTIM}`,
        twiceForeign.status === 400 && said(twiceForeign) === said(twiceOther) && !traced(twiceForeign),
        `${said(twiceForeign)} | ${said(twiceOther)}${trace(twiceForeign)}`);
    }
  }

  // ══ 4. the goods receipt, both doors ══════════════════════════════════════
  if (runs('receipts')) {
    console.log('\n── goods receipt: identifiers of any other shape, receivedBy, receivedAt, unitCost ──');
    // A first delivery refused for its price leaves no stocked item behind: the line has none yet.
    const firstCode = `${STAMP}-FIRST`;
    const first = await openOrder('first delivery', firstCode, 50);
    const itemBySku = async (code) => one(`select id::text as id, "averageCost"::text as avg, "lastPurchasePrice"::text as last, "unitCost"::text as unit from "InventoryItem" where "orgId" = $1 and sku = $2`, [attackerOrg, code]);
    const firstRefusals = [];
    for (const [door, unitCost] of [['inventory', ['5', '6']], ['inventory', 'abc'], ['procurement', 'abc'], ['procurement', ['5', '6']], ['procurement', -1], ['procurement', '']]) {
      const number = `${STAMP}-FP-${firstRefusals.length}`;
      const res = door === 'inventory'
        ? await ask(store, 'POST', '/inventory/goods-receipt', { orderId: first.orderId, warehouseId: siteWh, receiptNumber: number, lines: [{ poLineId: first.poLineId, acceptedQty: 1, unitCost }] })
        : await ask(store, 'POST', `${AP}/procurement/purchase-orders/${first.orderId}/receipts`, { receiptNumber: number, warehouseId: siteWh, lines: [{ poLineId: first.poLineId, acceptedQty: 1, unitCost }] });
      firstRefusals.push({ door, unitCost, number, res, left: await itemBySku(firstCode), stored: await receiptOf(number) });
    }
    const firstOk = await ask(store, 'POST', '/inventory/goods-receipt', { orderId: first.orderId, warehouseId: siteWh, receiptNumber: `${STAMP}-FP-OWN`, lines: [{ poLineId: first.poLineId, acceptedQty: 1, unitCost: 7 }] });
    const firstItem = await itemBySku(firstCode);
    check(`ALLOWED: the first delivery at 7.00 is accepted (201) and creates the stocked item ${firstCode} at that price`, firstOk.status === 201 && firstItem && Number(firstItem.last) === 7, `${said(firstOk)}; ${JSON.stringify(firstItem)}`);
    gated(firstOk, 'REFUSED (first delivery, both doors): a unitCost that is not a number of zero or more ("abc", ["5","6"], -1, "") is a 400, never a 5xx; no receipt, and no stocked item left behind',
      firstRefusals.every(({ res, left, stored }) => res.status === 400 && !left && !stored),
      firstRefusals.map(({ door, unitCost, res, left, stored }) => `${door} ${JSON.stringify(unitCost)}: ${said(res)}${left ? ` LEFT item ${left.id}` : ''}${stored ? ` STORED receipt ${stored.id}` : ''}`).join(' | '));
    gated(firstOk, 'REFUSED (procurement door): "abc", -1 and "" are refused at the door (400 VALIDATION_ERROR naming lines[0].unitCost)',
      firstRefusals.filter(({ door, unitCost }) => door === 'procurement' && !Array.isArray(unitCost)).every(({ res }) => fieldsNamed(res).includes('lines[0].unitCost')),
      firstRefusals.filter(({ door }) => door === 'procurement').map(({ unitCost, res }) => `${JSON.stringify(unitCost)}: ${said(res)} [${fieldsNamed(res).join(',')}]`).join(' | '));

    // The same price checks on a line whose item exists: its prices must not move.
    const priceState = async () => JSON.stringify(await itemBySku(firstCode));
    const pricesBefore = await priceState();
    const priced = [];
    for (const [door, unitCost] of [['inventory', ['5', '6']], ['inventory', 'abc'], ['procurement', 'abc'], ['procurement', ['5', '6']], ['procurement', -1]]) {
      const number = `${STAMP}-PR-${priced.length}`;
      const res = door === 'inventory'
        ? await ask(store, 'POST', '/inventory/goods-receipt', { orderId: first.orderId, warehouseId: siteWh, receiptNumber: number, lines: [{ poLineId: first.poLineId, acceptedQty: 1, unitCost }] })
        : await ask(store, 'POST', `${AP}/procurement/purchase-orders/${first.orderId}/receipts`, { receiptNumber: number, warehouseId: siteWh, lines: [{ poLineId: first.poLineId, acceptedQty: 1, unitCost }] });
      priced.push({ door, unitCost, res, stored: await receiptOf(number) });
    }
    const pricesAfter = await priceState();
    const pricedOk = await ask(store, 'POST', `${AP}/procurement/purchase-orders/${first.orderId}/receipts`, { receiptNumber: `${STAMP}-PR-OWN`, warehouseId: siteWh, lines: [{ poLineId: first.poLineId, acceptedQty: 1, unitCost: 9 }] });
    const pricedItem = await itemBySku(firstCode);
    check('ALLOWED (procurement door): a delivery at 9.00 is accepted (201) and moves the item\'s last price to 9.00', pricedOk.status === 201 && Number(pricedItem?.last) === 9, `${said(pricedOk)}; ${JSON.stringify(pricedItem)}`);
    gated(pricedOk, 'REFUSED (both doors): the same bad prices on a stocked line are a 400 and leave the item\'s average, last price and unit cost exactly as they were (they used to be reset to 0)',
      priced.every(({ res, stored }) => res.status === 400 && !stored) && pricesBefore === pricesAfter,
      `${priced.map(({ door, unitCost, res }) => `${door} ${JSON.stringify(unitCost)}: ${said(res)}`).join(' | ')}; prices ${pricesBefore} -> ${pricesAfter}`);

    // Every identifier of both doors in every shape, gated on the own id accepted on the same order.
    const { orderId, poLineId } = await openOrder('shapes', `${STAMP}-SHP`, 200);
    const seed = await ask(store, 'POST', '/inventory/goods-receipt', { orderId, warehouseId: siteWh, receiptNumber: `${STAMP}-SHP-0`, lines: [{ poLineId, acceptedQty: 1 }] });
    const lineItem = (await one(`select "inventoryItemId"::text as id from "ProcurementPoLine" where id = $1`, [poLineId]))?.id;
    check('open state: a first delivery settles the shapes order\'s stocked item (201)', seed.status === 201 && lineItem, `${said(seed)}; item ${lineItem}`);
    let n = 0;
    const invDoor = (extra = {}, lineExtra = {}) => {
      n += 1;
      const number = `${STAMP}-S-${n}`;
      return { number, res: ask(store, 'POST', '/inventory/goods-receipt', { orderId, warehouseId: siteWh, receiptNumber: number, notes: `Proof ${STAMP}`, lines: [{ poLineId, acceptedQty: 1, ...lineExtra }], ...extra }) };
    };
    const procDoor = (extra = {}, lineExtra = {}) => {
      n += 1;
      const number = `${STAMP}-S-${n}`;
      return { number, res: ask(store, 'POST', `${AP}/procurement/purchase-orders/${orderId}/receipts`, { receiptNumber: number, warehouseId: siteWh, notes: `Proof ${STAMP}`, lines: [{ poLineId, acceptedQty: 1, ...lineExtra }], ...extra }) };
    };
    const RFIELDS = [
      // [door, field (as the refusal names it), body or line, key, own, foreign, how a shape is answered]
      ['inventory', 'orderId', 'body', 'orderId', orderId, V.orderId, 'door'],
      ['inventory', 'warehouseId', 'body', 'warehouseId', siteWh, V.warehouseId, 'door'],
      ['inventory', 'projectId', 'body', 'projectId', A.id, V.projectId, 'door'],
      ['inventory', 'lines[0].poLineId', 'line', 'poLineId', poLineId, V.poLineId, 'door'],
      ['inventory', 'lines[0].locationId', 'line', 'locationId', ownBin, V.locationId, 'door'],
      ['inventory', 'lines[0].inventoryItemId', 'line', 'inventoryItemId', lineItem, V.itemId, 'door'],
      // Left to the service on purpose: any other shape is answered exactly as a report that exists nowhere.
      ['inventory', 'dailyReportId', 'body', 'dailyReportId', ownReport, V.dailyReportId, 'nowhere'],
      ['procurement', 'warehouseId', 'body', 'warehouseId', siteWh, V.warehouseId, 'door'],
      ['procurement', 'dailyReportId', 'body', 'dailyReportId', ownReport, V.dailyReportId, 'door'],
      ['procurement', 'lines[0].poLineId', 'line', 'poLineId', poLineId, V.poLineId, 'door'],
      ['procurement', 'lines[0].dailyReportId', 'line', 'dailyReportId', ownReport, V.dailyReportId, 'door'],
      ['procurement', 'lines[0].locationId', 'line', 'locationId', ownBin, V.locationId, 'door'],
      ['procurement', 'lines[0].inventoryItemId', 'line', 'inventoryItemId', lineItem, V.itemId, 'door'],
    ];
    for (const [door, field, where, key, own, foreign, how] of RFIELDS) {
      const send = door === 'inventory' ? invDoor : procDoor;
      const put = (value) => (where === 'body' ? send({ [key]: value }) : send({}, { [key]: value }));
      const gateCall = put(own);
      const gate = await gateCall.res;
      const stored = await receiptOf(gateCall.number);
      check(`ALLOWED (${door} door) ${field}: the company's own ${own} is accepted (201)`, gate.status === 201 && Boolean(stored) && (key !== 'dailyReportId' || where !== 'body' || stored.report === own), `${said(gate)}; stored ${JSON.stringify(stored)}`);
      const lineBefore = await lineState(poLineId);
      const stateBefore = await stockState();
      const sent = [];
      for (const [shape, make, wraps] of SHAPES) {
        for (const [whose, id] of wraps ? [['own', own], ['foreign', foreign], ['nowhere', nowhere()]] : [['-', null]]) {
          const call = put(make(id));
          sent.push({ shape, whose, number: call.number, res: await call.res });
        }
      }
      // The plain id that exists nowhere, for a field the service answers (a report): refused, stores nothing.
      const noneCall = how === 'nowhere' ? put(nowhere()) : null;
      const none = noneCall ? await noneCall.res : null;
      const storedAny = [];
      for (const { number } of [...sent, ...(noneCall ? [{ number: noneCall.number }] : [])]) if (await receiptOf(number)) storedAny.push(number);
      const lineAfter = await lineState(poLineId);
      const stateAfter = await stockState();
      gated(gate, `SHAPES (${door} door) ${field}: ${sent.length} wrongly shaped values — each a 4xx, never a 5xx, the same answer for own, foreign and nowhere`,
        sent.every(({ res }) => is4xx(res) && said(res) === said(sent[0].res)),
        [...new Set(sent.map(({ res }) => said(res)))].join(' | '));
      if (how === 'door') {
        gated(gate, `SHAPES (${door} door) ${field}: …refused at the door (400 VALIDATION_ERROR naming ${field})`, sent.every(({ res }) => res.status === 400 && fieldsNamed(res).includes(field)), [...new Set(sent.map(({ res }) => `${said(res)} [${fieldsNamed(res).join(',')}]`))].join(' | '));
      } else {
        gated(gate, `SHAPES (${door} door) ${field}: …answered exactly as a report that exists nowhere (${said(none)})`, sent.every(({ res }) => said(res) === said(none)) && none?.status === 404, `${said(sent[0].res)} | nowhere ${said(none || { status: 0 })}`);
      }
      gated(gate, `SHAPES (${door} door) ${field}: …nothing stored (no receipt, the order line and the company's stock unchanged), nothing of ${VICTIM} in any answer`,
        storedAny.length === 0 && lineBefore === lineAfter && stateBefore === stateAfter && !sent.some(({ res }) => traced(res)),
        `${storedAny.length ? `STORED ${storedAny.join(',')}; ` : ''}line ${lineBefore} -> ${lineAfter}${stateBefore === stateAfter ? '' : `; state ${stateBefore} -> ${stateAfter}`}`);
    }

    // Procurement's door takes a line's daily report as one string and stores none: own, foreign and
    // nowhere have the same effect — accepted, and no delivery line names a report.
    {
      const lineReport = async (number) => (await one(`select l."dailyReportId"::text as report from "DeliveryReceiptLine" l join "DeliveryReceipt" r on r.id = l."receiptId" where r."orderId" = $1 and r."receiptNumber" = $2`, [orderId, number]))?.report ?? null;
      const calls = [];
      for (const [whose, id] of [['own', ownReport], ['foreign', V.dailyReportId], ['nowhere', nowhere()]]) {
        const call = procDoor({}, { dailyReportId: id });
        const res = await call.res;
        calls.push({ whose, res, stored: await receiptOf(call.number), report: await lineReport(call.number) });
      }
      const ownCall = calls[0];
      gated(ownCall.res, `REFUSED (procurement door) lines[0].dailyReportId: company ${VICTIM}'s report has exactly the effect of one that exists nowhere (accepted, and no delivery line names it), nothing of ${VICTIM} in the answer`,
        calls.every(({ res, stored, report }) => res.status === 201 && stored && report === null) && said(calls[1].res) === said(calls[2].res) && !traced(calls[1].res),
        calls.map(({ whose, res, report }) => `${whose}: ${said(res)}, line report ${report}`).join(' | '));
    }

    // receivedBy is text; receivedAt is a date.
    const byOkCall = invDoor({ receivedBy: 'Sam (storeman)' });
    const byOk = await byOkCall.res;
    check('ALLOWED (inventory door): receivedBy as text is accepted (201) and stored', byOk.status === 201 && (await receiptOf(byOkCall.number))?.receivedBy === 'Sam (storeman)', said(byOk));
    const lineBeforeBy = await lineState(poLineId);
    const byShapes = [];
    for (const value of [['Sam'], [['Sam']], { not: 'x' }, 12345, true]) {
      const call = invDoor({ receivedBy: value });
      byShapes.push({ value, number: call.number, res: await call.res });
    }
    let byStored = 0;
    for (const { number } of byShapes) if (await receiptOf(number)) byStored += 1;
    gated(byOk, 'REFUSED (inventory door): receivedBy that is not text (["Sam"], {"not":"x"}, 12345, true) is a 400 naming receivedBy — it used to be stored as "Sam" or "[object Object]" — and nothing is stored',
      byShapes.every(({ res }) => res.status === 400 && fieldsNamed(res).includes('receivedBy')) && byStored === 0 && (await lineState(poLineId)) === lineBeforeBy,
      byShapes.map(({ value, res }) => `${JSON.stringify(value)}: ${said(res)}`).join(' | '));
    const atOkCall = invDoor({ receivedAt: new Date().toISOString() });
    const atOk = await atOkCall.res;
    const atShapes = [];
    for (const value of [['2026-10-01'], 'not a date', { not: 'x' }, 12345, true]) {
      const call = invDoor({ receivedAt: value });
      atShapes.push({ value, number: call.number, res: await call.res });
    }
    let atStored = 0;
    for (const { number } of atShapes) if (await receiptOf(number)) atStored += 1;
    check('ALLOWED (inventory door): a receivedAt date is accepted (201)', atOk.status === 201, said(atOk));
    gated(atOk, 'REFUSED (inventory door): receivedAt that is not a date is a 4xx, never a 5xx, and nothing is stored', atShapes.every(({ res }) => is4xx(res)) && atStored === 0, atShapes.map(({ value, res }) => `${JSON.stringify(value)}: ${said(res)}`).join(' | '));
  }

  // ══ 5. the read side, over stored foreign references (residue) ═══════════
  if (runs('reads')) {
    console.log('\n── reads over stored foreign references (residue) ──');
    // The purchase-order list: a fresh receipt booked against the project's own report is served with it;
    // the residue receipts naming company 055's report are served without it.
    const { orderId, poLineId } = await openOrder('reads', `${STAMP}-RD`, 20, 2);
    // A residue item a proof made (SKU PRF-…) rather than a seeded one: this read moves its average.
    const residueSkus = await q(`select id::text as id, sku from "InventoryItem" where id = any($1::text[])`, [residueBalances.map((row) => row.item)]);
    const residueItem = (residueSkus.find((row) => row.sku.startsWith('PRF-')) || residueSkus[0])?.id || null;
    const residueWh = residueBalances.find((row) => row.item === residueItem)?.wh || siteWh;
    const ownOnHandIn = async (itemId, warehouseId) => num(`select coalesce(sum(b."onHand"), 0)::float8 as n from "StockBalance" b join "Warehouse" w on w.id = b."warehouseId" left join "WarehouseLocation" l on l.id = b."locationId" where b."itemId" = $1 and b."warehouseId" = $2 and b."orgId" = $3 and w."orgId" = $3 and (b."locationId" is null or l."orgId" = $3)`, [itemId, warehouseId, attackerOrg]);
    const everyOnHandIn = async (itemId, warehouseId) => num(`select coalesce(sum("onHand"), 0)::float8 as n from "StockBalance" where "itemId" = $1 and "warehouseId" = $2`, [itemId, warehouseId]);
    const delivery = await ask(store, 'POST', '/inventory/goods-receipt', {
      orderId, warehouseId: residueWh, receiptNumber: `${STAMP}-RD-1`, dailyReportId: ownReport, notes: `Proof ${STAMP}`,
      lines: [{ poLineId, acceptedQty: 1, ...(residueItem ? { inventoryItemId: residueItem } : {}) }],
    });
    const deliveredItem = (await one(`select "inventoryItemId"::text as id from "ProcurementPoLine" where id = $1`, [poLineId]))?.id;
    const own = deliveredItem ? await ownOnHandIn(deliveredItem, residueWh) : null;
    const every = deliveredItem ? await everyOnHandIn(deliveredItem, residueWh) : null;
    const answered = delivery.body?.data?.lines?.[0]?.onHand;
    check(`ALLOWED: a delivery of ${residueItem ? `the residue item ${residueItem}` : 'a fresh item'} into ${residueWh}, booked against the project's own report, is accepted (201)`, delivery.status === 201, said(delivery));
    gated(delivery, `READ the delivery's answer: on hand is the company's own positions (${own}), not every balance of the item in the store (${every}) — none of company ${VICTIM}'s bin, nothing of ${VICTIM}`,
      answered === own && (residueItem ? every !== own : true) && !traced(delivery), `answered ${answered}; own ${own}; every ${every}${trace(delivery)}`);

    const list = await ask(procurement, 'GET', `${AP}/procurement/purchase-orders`);
    const receipts = (list.body?.data || []).flatMap((order) => order.deliveryReceipts || []);
    const ownReceipt = receipts.find((row) => row.receiptNumber === `${STAMP}-RD-1`);
    const listGate = { ok: list.status === 200 && ownReceipt?.dailyReportId === ownReport, why: `${said(list)}; own receipt served with report ${ownReceipt?.dailyReportId}` };
    check(`ALLOWED: the purchase-order list (200) serves the fresh receipt with the project's own daily report ${ownReport}`, listGate.ok, listGate.why);
    const residueServed = receipts.filter((row) => residueReceipts.some((r) => r.id === row.id));
    gated(listGate, `READ GET ${AP}/procurement/purchase-orders: the ${residueReceipts.length} residue receipt(s) are still listed, with company ${VICTIM}'s daily report blanked, and the answer carries nothing of ${VICTIM}`,
      residueServed.length === residueReceipts.filter((r) => receipts.some((row) => row.id === r.id)).length && residueReceipts.every((r) => receipts.some((row) => row.id === r.id)) && residueServed.every((row) => row.dailyReportId === null && (row.lines || []).every((line) => line.dailyReportId == null)) && !traced(list),
      `${JSON.stringify(residueServed.map((row) => ({ id: row.id, dailyReportId: row.dailyReportId })))}${trace(list)}`);
    const stillStored = await q(`select id::text as id, "dailyReportId"::text as report from "DeliveryReceipt" where id = any($1::text[]) order by id`, [residueReceipts.map((r) => r.id)]);
    check(`READ: …the residue rows themselves are untouched (they still name company ${VICTIM}'s report in the database: the read scopes, it does not rewrite)`, stillStored.length === residueReceipts.length && stillStored.every((row) => residueReceipts.some((r) => r.id === row.id && r.report === row.report)), JSON.stringify(stillStored));

    // The weighted average blends against the company's own positions only.
    if (residueItem) {
      const avgOf = async (itemId) => Number((await one(`select "averageCost"::float8 as a from "InventoryItem" where id = $1`, [itemId]))?.a);
      const ownQty = async (itemId) => num(`select coalesce(sum(b."onHand" + b."inTransit" + b.quarantined), 0)::float8 as n from "StockBalance" b join "Warehouse" w on w.id = b."warehouseId" left join "WarehouseLocation" l on l.id = b."locationId" where b."itemId" = $1 and b."orgId" = $2 and w."orgId" = $2 and (b."locationId" is null or l."orgId" = $2)`, [itemId, attackerOrg]);
      const allQty = async (itemId) => num(`select coalesce(sum("onHand" + "inTransit" + quarantined), 0)::float8 as n from "StockBalance" where "itemId" = $1`, [itemId]);
      const round4 = (value) => Math.round(value * 10_000) / 10_000;
      const price = 50;
      const avgBefore = await avgOf(residueItem);
      const qtyOwn = await ownQty(residueItem);
      const qtyAll = await allQty(residueItem);
      const expected = round4((qtyOwn * avgBefore + price) / (qtyOwn + 1));
      const withResidue = round4((qtyAll * avgBefore + price) / (qtyAll + 1));
      const receipt = await ask(store, 'POST', '/inventory/stock/receive', { itemId: residueItem, warehouseId: residueWh, quantity: 1, unitCost: price, reference: `Proof average ${STAMP}` });
      const avgAfter = await avgOf(residueItem);
      check(`ALLOWED: 1 of the residue item received at ${price}.00 into its own store (201)`, receipt.status === 201, said(receipt));
      gated(receipt, `READ the item's weighted average: blended against the company's own positions (${qtyOwn} at ${avgBefore} -> ${expected}), not every balance of the item (${qtyAll} -> ${withResidue})`,
        Math.abs(avgAfter - expected) < 0.00015 && (qtyAll === qtyOwn || Math.abs(avgAfter - withResidue) > 0.00015) && !traced(receipt),
        `average now ${avgAfter}`);
    } else {
      console.log('      (no residue balance in a bin of the victim: the average and on-hand reads have nothing to show)');
    }
  }

  // ── after ────────────────────────────────────────────────────────────────
  console.log('\n── after ──');
  const namingAfter = await naming();
  const grew = Object.keys(NAMING).filter((t) => namingAfter[t] !== namingBefore[t]);
  check(`no row of company ${ATTACKER} names company ${VICTIM}'s ids that did not before`, grew.length === 0, grew.map((t) => `${t} ${namingBefore[t]}->${namingAfter[t]}`).join(', '));
  check(`the residue rows (${residueReceipts.length} receipt(s), ${residueBalances.length} balance(s)) are exactly as they were`, JSON.stringify(await residueRows()) === residueBefore);
  const leaked = answers.filter((a) => victimTraces.test(a.text));
  check(`no answer to company ${ATTACKER} carries company ${VICTIM}'s ids, names, addresses or canaries (${answers.length} answers)`, leaked.length === 0, leaked.slice(0, 6).map((a) => `${a.status} ${a.route} -> ${(a.text.match(victimTraces) || [])[0]}`).join('\n        '));
  const errors = answers.filter((a) => a.status >= 500);
  check(`no answer is a server error (${answers.length} answers)`, errors.length === 0, errors.slice(0, 5).map((a) => `${a.status} ${a.route} ${(a.text || '').slice(0, 160)}`).join('\n        '));
  if (SKIP_FINGERPRINT) {
    console.log(`(the fingerprint of company ${VICTIM} was skipped: CERT_PROOF_SKIP_FINGERPRINT=1, a mutation run — not a certifying run)`);
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
