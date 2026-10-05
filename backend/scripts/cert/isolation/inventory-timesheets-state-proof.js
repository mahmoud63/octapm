'use strict';

/**
 * The CERT-2 state-gap proof of the inventory and timesheet pairs, and of what
 * the inventory reads serve when a row of the attacker's company already names
 * the victim's record.
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/inventory-timesheets-state-proof.js [attacker=054] [victim=055]
 *
 * Pairs the foreign-reference sweep never judged, because every attempt it
 * made was refused by the attacker's OWN record state before the product
 * looked at the foreign id (scratch/gap-pairs.json), and the fields beside them:
 *
 *   POST /inventory/goods-receipt                     lines[].locationId (warehouse_location) hidden by 409 RECEIPT_OVER_ORDER
 *   POST /projects/{p}/procurement/purchase-orders/{o}/receipts  lines[].locationId (the same writer)
 *   POST /inventory/goods-receipt                     dailyReportId      (daily_report)
 *   POST /projects/{p}/procurement/purchase-orders/{o}/receipts  dailyReportId (the same writer)
 *   POST /inventory/goods-receipt                     orderId, projectId, warehouseId, lines[].inventoryItemId, receivedAt
 *   POST /projects/{p}/procurement/purchase-orders/{o}/receipts  warehouseId, lines[].inventoryItemId
 *   POST /inventory/transfers/{transferId}/receive    lines[].id         (stock_transfer_line) hidden by 409 TRANSFER_STATE
 *   POST /projects/{p}/timesheets/crews               foremanUserId      (user)               hidden by 409 CREW_NAME_EXISTS
 *   PATCH /projects/{p}/timesheets/crews/{id}         foremanUserId
 *
 * For each pair the attacker company's own people first build a record in the
 * state where the request is legitimately accepted, through the API, fresh on
 * every run — a freshly issued purchase order with room on its line, a fresh
 * stocked item with fresh stock received into the site store and a freshly
 * dispatched transfer of it, a crew name used nowhere — and then, on that
 * record:
 *   ALLOWED  the request with the attacker's own id is accepted (2xx) and the
 *            id is stored (read back from the database);
 *   REFUSED  the request with the victim company's id (proven company 055's
 *            from the database) is refused with a 4xx — or, for a field the
 *            product only matches against the record's own rows, has no effect
 *            at all — exactly as the same request with an id that exists
 *            nowhere: same status, code and message, same effect. Every REFUSED
 *            check is GATED: it holds only when the own-id request on the same
 *            record was accepted (2xx), so a refusal by the record's own state
 *            (a 409, a 402) can never stand in for it;
 *   SHAPES   the field sent as [victim id], {"id": victim id}, 12345 and
 *            {"not":"x"} (a Prisma filter) is a 4xx, never a 5xx, stores
 *            nothing, and a shaped victim id answers as the same shape of an
 *            id that exists nowhere;
 *   NOTHING  no row of the attacker's company names the victim's id afterwards
 *            that did not before, the refused request left no row behind, and
 *            the answer carries no id, name, address or canary of the victim.
 *
 * And the read side: rows of the attacker's company that name the victim's
 * bin (residue of a reproduction made before the write guard existed — the
 * stock balances and movements are found in the database and left exactly as
 * they are) must serve nothing of the victim through any inventory read: the
 * scans, the items, the ledger, the lists, the summary and the analytics.
 *
 * No answer may be a 5xx, and the victim company's data must not change in any
 * table (state fingerprint restricted to company 055, before and after).
 *
 * Re-runnable: every record is new, every name carries a fresh stamp, and the
 * stock a transfer moves is brought in by this run. Exit code 0 when every
 * check holds, 2 otherwise.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { as } = require('../lib/api');
const { buildPopulation } = require('../lib/spec');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');

const ATTACKER = process.argv[2] || '054';
const VICTIM = process.argv[3] || '055';
const GROUP = 'inventory-timesheets';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `ITS-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const INPROCESS = process.env.CERT_INPROCESS === '1';
// The rows a reproduction made in company 054 before the bin guard existed:
// they name company 055's bin 8e89ee2f-… and must stay exactly as they are.
const BRIEF_RESIDUE = ATTACKER === '054' && VICTIM === '055'
  ? {
      bin: '8e89ee2f-82d2-4b11-8d47-d17d6f72df15',
      balances: ['32838085-6b82-49d9-9c20-128b5a2dcb6e', '69d4c9c2-24da-458d-961e-53862ff9350a'],
      transactions: ['dd6a810e-01fe-4baa-b3f5-fe95d6a084ee', '341da7fa-c111-4e04-8ec4-6c5f7f5b7861', '2692c609-ec86-4d05-ad48-aa3778ffde43'],
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
/**
 * A REFUSED check holds only on a record shown to accept: the gate is the
 * own-id request on the same record (its answer must be 2xx), or — where the
 * own id travels in the same request — { ok, why } saying it was honoured.
 */
const gateHolds = (gate) => (gate && 'ok' in gate ? Boolean(gate.ok) : ok2xx(gate));
const gateSays = (gate) => (gate && 'ok' in gate ? gate.why : gate ? said(gate) : 'nothing sent');
const gated = (gate, name, ok, detail = '') =>
  check(`${name} [gated]`, gateHolds(gate) && ok, gateHolds(gate) ? detail : `NOT GATED — the record was not shown to accept the own id (${gateSays(gate)}); ${detail}`);
/** The four wrong shapes a field is sent in, for a victim id and for an id that exists nowhere. */
const SHAPES = [
  ['[id]', (id) => [id]],
  ['{"id":id}', (id) => ({ id })],
  ['12345', () => 12345],
  ['{"not":"x"}', () => ({ not: 'x' })],
];

// The product's local e-mail transport writes to the console in process; keep it out of the proof's output.
const print = console.log.bind(console);
console.log = (...args) => {
  const text = args.map(String).join(' ');
  if (text.startsWith('[email:local]')) return;
  print(...args);
};

const main = async () => {
  console.log(`${GROUP} state proof — attacker ${ATTACKER}, victim ${VICTIM}, stamp ${STAMP}${INPROCESS ? ', in process (the working tree\'s code)' : ' — NOT in process: this asks a running API, which does not prove the working tree'}\n`);
  const { companies } = buildPopulation();
  const attacker = companies.find((c) => c.code === ATTACKER);
  const victim = companies.find((c) => c.code === VICTIM);
  if (!attacker || !victim) throw new Error(`unknown company ${ATTACKER} or ${VICTIM}`);
  const inventory = (code) => JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'inventory', `${code}.json`), 'utf8'));
  const atkInv = inventory(ATTACKER);
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
  const codeOfOrg = async (orgId) => {
    const slug = (await one(`select slug from "Organisation" where id = $1`, [orgId]))?.slug;
    return /^cert-(\d{3})-/.exec(slug || '')?.[1] || (slug || 'nowhere');
  };

  const procurement = as(`procurement@${attacker.domain}`);
  const pm = as(`pm@${attacker.domain}`);
  const warehouse = as(`warehouse@${attacker.domain}`);
  const site = as(`site@${attacker.domain}`);
  const ask = async (who, method, route, body) => {
    const res = await who.send(method, route, body);
    answers.push({ route: `${method} ${route}`, status: res.status, text: res.text || '' });
    return res;
  };
  const must = (res, what) => {
    if (!ok2xx(res)) throw new Error(`setup ${what}: ${said(res)} ${(res.text || '').slice(0, 300)}`);
    return res.body?.data;
  };

  // ── the ids, each proven by its owner ─────────────────────────────────────
  const inv = A.refs.inventory;
  const siteWh = inv.warehouses.site;
  const laydownWh = inv.warehouses.laydown;
  const ownLocation = inv.locations.bins[0];
  const otherWarehouseLocation = inv.locations.laydown || null;
  const ownActivity = Object.values(A.refs.activities)[0];
  const supplierId = inv.supplierId;

  const locOwner = async (id) => one(`select l."orgId"::text as org, l."warehouseId"::text as wh from "WarehouseLocation" l where l.id = $1`, [id]);
  const foreignLocation = (await one(`select l.id::text as id from "WarehouseLocation" l where l."orgId" = $1 and l.status = 'active' order by l.kind = 'bin' desc, l."createdAt" limit 1`, [victimOrg]))?.id;
  const foreignTransferLine = (await one(`select tl.id::text as id from "StockTransferLine" tl where tl."orgId" = $1 order by tl."createdAt" limit 1`, [victimOrg]))?.id;
  const userByEmail = async (email) => (await one(`select id::text as id from "User" where email = $1`, [email]))?.id;
  const ownForeman = await userByEmail(`site@${attacker.domain}`);
  // A member of the attacker's company whose home workspace is another: a person is a colleague by membership.
  const crossHomeMember = (await one(`select u.id::text as id, u.email from "User" u join "OrganizationMembership" m on m."userId" = u.id where m."orgId" = $1 and m.status = 'active' and u."orgId" <> $1 and not exists (select 1 from "OrganizationMembership" v where v."userId" = u.id and v."orgId" = $2) order by u.email limit 1`, [attackerOrg, victimOrg])) || null;
  const foreignUser = await userByEmail(`pm@${victim.domain}`);
  const memberOf = async (userId, orgId) => (await one(`select status from "OrganizationMembership" where "userId" = $1 and "orgId" = $2`, [userId, orgId]))?.status || null;
  const reportOwner = async (id) => one(`select d."projectId"::text as project, p."orgId"::text as org from "DailyReport" d join "Project" p on p.id = d."projectId" where d.id = $1`, [id]);
  const ownReport = (await one(`select id::text as id from "DailyReport" where "projectId" = $1 order by date desc limit 1`, [A.id]))?.id;
  const foreignReport = (await one(`select d.id::text as id from "DailyReport" d join "Project" p on p.id = d."projectId" where p."orgId" = $1 order by d.date desc limit 1`, [victimOrg]))?.id;

  const ownLoc = await locOwner(ownLocation);
  check(`setup: warehouse location ${ownLocation} is company ${ATTACKER}'s, in its site store ${siteWh}`, ownLoc && ownLoc.org === attackerOrg && ownLoc.wh === siteWh, JSON.stringify(ownLoc));
  const forLoc = foreignLocation ? await locOwner(foreignLocation) : null;
  check(`setup: warehouse location ${foreignLocation} is company ${VICTIM}'s`, forLoc && forLoc.org === victimOrg && (await codeOfOrg(forLoc.org)) === VICTIM, JSON.stringify(forLoc));
  const forLine = foreignTransferLine ? await one(`select "orgId"::text as org from "StockTransferLine" where id = $1`, [foreignTransferLine]) : null;
  check(`setup: stock transfer line ${foreignTransferLine} is company ${VICTIM}'s`, forLine?.org === victimOrg, JSON.stringify(forLine));
  check(`setup: user ${ownForeman} (site@) is an active member of company ${ATTACKER}`, (await memberOf(ownForeman, attackerOrg)) === 'active');
  check(`setup: user ${foreignUser} (pm@ of ${VICTIM}) is an active member of company ${VICTIM} and not a member of company ${ATTACKER}`, (await memberOf(foreignUser, victimOrg)) === 'active' && (await memberOf(foreignUser, attackerOrg)) === null);
  const ownRep = ownReport ? await reportOwner(ownReport) : null;
  check(`setup: daily report ${ownReport} is project ${A.id}'s (company ${ATTACKER})`, ownRep?.project === A.id && ownRep?.org === attackerOrg, JSON.stringify(ownRep));
  const forRep = foreignReport ? await reportOwner(foreignReport) : null;
  check(`setup: daily report ${foreignReport} is company ${VICTIM}'s`, forRep?.org === victimOrg, JSON.stringify(forRep));
  // The victim's order, project, warehouse and stocked item, for the goods receipt's other identifiers.
  const foreignOrder = (await one(`select o.id::text as id from "ProcurementOrder" o join "Project" p on p.id = o."projectId" where p."orgId" = $1 order by o."createdAt" limit 1`, [victimOrg]))?.id;
  const foreignProject = (await one(`select id::text as id from "Project" where "orgId" = $1 order by "createdAt" limit 1`, [victimOrg]))?.id;
  const foreignWarehouse = (await one(`select id::text as id from "Warehouse" where "orgId" = $1 order by "createdAt" limit 1`, [victimOrg]))?.id;
  const foreignItem = (await one(`select id::text as id from "InventoryItem" where "orgId" = $1 order by "createdAt" limit 1`, [victimOrg]))?.id;
  const owners = await one(`select (select p."orgId"::text from "ProcurementOrder" o join "Project" p on p.id = o."projectId" where o.id = $1) as "order", (select "orgId"::text from "Project" where id = $2) as project, (select "orgId"::text from "Warehouse" where id = $3) as warehouse, (select "orgId"::text from "InventoryItem" where id = $4) as item`, [foreignOrder, foreignProject, foreignWarehouse, foreignItem]);
  check(`setup: purchase order ${foreignOrder}, project ${foreignProject}, warehouse ${foreignWarehouse} and item ${foreignItem} are company ${VICTIM}'s`, Object.values(owners || {}).length === 4 && Object.values(owners).every((org) => org === victimOrg), JSON.stringify(owners));
  if (crossHomeMember) console.log(`      cross-home member of ${ATTACKER}: ${crossHomeMember.id} (home workspace elsewhere)`);

  // The residue: rows of the attacker's company that name one of the victim's bins.
  const residueBalances = await q(`select b.id::text as id, b."itemId"::text as item, b."locationId"::text as loc from "StockBalance" b join "WarehouseLocation" l on l.id = b."locationId" where b."orgId" = $1 and l."orgId" = $2 order by b.id`, [attackerOrg, victimOrg]);
  const residueMovements = await q(`select t.id::text as id, t."itemId"::text as item, t."locationId"::text as loc from "StockTransaction" t join "WarehouseLocation" l on l.id = t."locationId" where t."orgId" = $1 and l."orgId" = $2 order by t.id`, [attackerOrg, victimOrg]);
  const residueBins = [...new Set([...residueBalances, ...residueMovements].map((row) => row.loc))];
  const residueItems = [...new Set([...residueBalances, ...residueMovements].map((row) => row.item))];
  // The brief's rows are those of the population the reproduction ran on: a
  // regenerated population has neither them nor the bin they name.
  const briefResidue = BRIEF_RESIDUE && (await locOwner(BRIEF_RESIDUE.bin)) ? BRIEF_RESIDUE : null;
  if (BRIEF_RESIDUE && !briefResidue) console.log(`      the brief's residue (bin ${BRIEF_RESIDUE.bin}) belongs to an earlier population: this one has no such bin`);
  if (briefResidue) {
    const balanceIds = residueBalances.map((row) => row.id);
    const movementIds = residueMovements.map((row) => row.id);
    check(`setup: the residue rows of company ${ATTACKER} naming company ${VICTIM}'s bin ${BRIEF_RESIDUE.bin} are present (StockBalance ${BRIEF_RESIDUE.balances.length}, StockTransaction ${BRIEF_RESIDUE.transactions.length})`,
      BRIEF_RESIDUE.balances.every((id) => balanceIds.includes(id)) && BRIEF_RESIDUE.transactions.every((id) => movementIds.includes(id)) && residueBins.includes(BRIEF_RESIDUE.bin) && (await locOwner(BRIEF_RESIDUE.bin))?.org === victimOrg,
      `balances ${balanceIds.join(',')}; movements ${movementIds.join(',')}; bins ${residueBins.join(',')}`);
  } else {
    console.log(`      residue: ${residueBalances.length} balance(s), ${residueMovements.length} movement(s) of ${ATTACKER} name a bin of ${VICTIM}`);
  }
  const residueRows = async () => (await q(`select to_jsonb(b)::text as row from "StockBalance" b where b.id = any($1::text[])
    union all select to_jsonb(m)::text from "StockTransaction" m where m.id = any($2::text[]) order by 1`, [residueBalances.map((r) => r.id), residueMovements.map((r) => r.id)])).map((r) => r.row);
  const residueBefore = JSON.stringify(await residueRows());

  const victimIds = [foreignLocation, foreignTransferLine, foreignUser, foreignReport, foreignOrder, foreignProject, foreignWarehouse, foreignItem, ...residueBins].filter(Boolean);
  const victimTraces = new RegExp([`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`, ...new Set(victimIds)].join('|'));
  const traced = (res) => victimTraces.test(res?.text || '');
  const trace = (res) => (traced(res) ? ` — answer carries ${(res.text.match(victimTraces) || [])[0]}` : '');

  // Rows of the attacker's company that name one of the victim's ids, in the tables these routes write.
  const NAMING = {
    StockBalance: `select count(*)::int as n from "StockBalance" t where t."orgId" = $1`,
    StockTransaction: `select count(*)::int as n from "StockTransaction" t where t."orgId" = $1`,
    StockTransferLine: `select count(*)::int as n from "StockTransferLine" t where t."orgId" = $1`,
    StockTransfer: `select count(*)::int as n from "StockTransfer" t where t."orgId" = $1`,
    DeliveryReceipt: `select count(*)::int as n from "DeliveryReceipt" t join "Project" p on p.id = t."projectId" where p."orgId" = $1`,
    DeliveryReceiptLine: `select count(*)::int as n from "DeliveryReceiptLine" t join "Project" p on p.id = t."projectId" where p."orgId" = $1`,
    InventoryItem: `select count(*)::int as n from "InventoryItem" t where t."orgId" = $1`,
    Crew: `select count(*)::int as n from "Crew" t where t."orgId" = $1`,
    Notification: `select count(*)::int as n from "Notification" t where t."orgId" = $1`,
  };
  const naming = async () => {
    const counts = {};
    for (const [table, sql] of Object.entries(NAMING)) {
      counts[table] = (await q(`${sql} and (${victimIds.map((_, i) => `to_jsonb(t)::text like '%' || $${i + 2} || '%'`).join(' or ')})`, [attackerOrg, ...victimIds]))[0].n;
    }
    return counts;
  };

  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const taken = await fingerprint.take(db);
    await db.query('rollback');
    return taken;
  };
  const before = await snapshot();
  const namingBefore = await naming();
  const victimLineBefore = foreignTransferLine ? await one(`select to_jsonb(t)::text as row from "StockTransferLine" t where id = $1`, [foreignTransferLine]) : null;

  // ══ 0. the read side: rows of the attacker's company naming the victim's bin ══
  console.log('\n── reads over stored foreign references (residue) ──');
  {
    // What the company holds of an item, counted from the database: its own
    // balance rows, in its own warehouses, in its own bins or none.
    const ownOnHand = async (itemId) => num(`select coalesce(sum(b."onHand"), 0) as n from "StockBalance" b join "Warehouse" w on w.id = b."warehouseId" left join "WarehouseLocation" l on l.id = b."locationId" where b."itemId" = $1 and b."orgId" = $2 and w."orgId" = $2 and (b."locationId" is null or l."orgId" = $2)`, [itemId, attackerOrg]);
    const allOnHand = async (itemId) => num(`select coalesce(sum("onHand"), 0) as n from "StockBalance" where "itemId" = $1`, [itemId]);
    const ownPositions = async (itemId) => num(`select count(*)::int as n from "StockBalance" b join "Warehouse" w on w.id = b."warehouseId" left join "WarehouseLocation" l on l.id = b."locationId" where b."itemId" = $1 and b."orgId" = $2 and w."orgId" = $2 and (b."locationId" is null or l."orgId" = $2)`, [itemId, attackerOrg]);
    if (!residueItems.length) console.log('      (no residue: nothing of the attacker names a bin of the victim)');
    for (const itemId of residueItems) {
      const item = await one(`select sku, "orgId"::text as org from "InventoryItem" where id = $1`, [itemId]);
      const own = await ownOnHand(itemId);
      const all = await allOnHand(itemId);
      const positions = await ownPositions(itemId);
      const residueHere = residueBalances.filter((row) => row.item === itemId).map((row) => row.id);
      console.log(`      item ${item?.sku} (${itemId}): own on hand ${own}, every balance ${all}; residue balance(s) ${residueHere.join(',') || 'none'}`);

      const scan = await ask(warehouse, 'GET', `/inventory/items/scan/${encodeURIComponent(item.sku)}`);
      const stock = scan.body?.data?.stock || [];
      gated(scan, `READ scan ${item.sku}: the answer carries nothing of company ${VICTIM} (no bin id, name or canary)`, scan.status === 200 && !traced(scan), `${said(scan)}${trace(scan)}`);
      gated(scan, `READ scan ${item.sku}: it lists the company's own positions only (${positions}) and none in a bin of company ${VICTIM}`, stock.length === positions && !stock.some((row) => residueBins.includes(row.locationId)), `stock rows ${stock.length}: ${JSON.stringify(stock.map((row) => row.locationId))}`);
      gated(scan, `READ scan ${item.sku}: the on-hand figure is the company's own positions (${own}), not every balance naming the item (${all})`, scan.body?.data?.item?.onHand === own, `onHand ${scan.body?.data?.item?.onHand}`);

      const detail = await ask(warehouse, 'GET', `/inventory/items/${itemId}`);
      gated(detail, `READ item ${item.sku}: nothing of company ${VICTIM}, on hand = own positions (${own})`, detail.status === 200 && !traced(detail) && detail.body?.data?.onHand === own, `${said(detail)}; onHand ${detail.body?.data?.onHand}${trace(detail)}`);

      const listed = await ask(warehouse, 'GET', `/inventory/items?search=${encodeURIComponent(item.sku)}`);
      const row = (listed.body?.data?.items || []).find((candidate) => candidate.id === itemId);
      gated(listed, `READ item list (search ${item.sku}): nothing of company ${VICTIM}, on hand = own positions`, listed.status === 200 && !traced(listed) && row?.onHand === own, `${said(listed)}; onHand ${row?.onHand}${trace(listed)}`);

      const ledger = await ask(warehouse, 'GET', `/inventory/stock/transactions?itemId=${itemId}&limit=500`);
      const residueIds = residueMovements.filter((movement) => movement.item === itemId).map((movement) => movement.id);
      const shown = (ledger.body?.data?.items || []).filter((movement) => residueIds.includes(movement.id));
      gated(ledger, `READ ledger of ${item.sku}: the company's own residue movements (${residueIds.length}) are still listed, with their bin blanked, and nothing of company ${VICTIM}`,
        ledger.status === 200 && !traced(ledger) && shown.length === residueIds.length && shown.every((movement) => movement.locationId === null && movement.location === null),
        `${said(ledger)}; residue rows shown ${JSON.stringify(shown.map((movement) => ({ id: movement.id, locationId: movement.locationId, location: movement.location })))}${trace(ledger)}`);
    }
    for (const route of ['/inventory/warehouses', `/inventory/warehouses/${siteWh}/locations`, '/inventory/transfers', `/inventory/stock/transactions?warehouseId=${siteWh}&limit=500`, '/inventory/items']) {
      const res = await ask(warehouse, 'GET', route);
      gated(res, `READ ${route}: nothing of company ${VICTIM}`, res.status === 200 && !traced(res), `${said(res)}${trace(res)}`);
    }

    // The figures: the summary and the analytics count the company's own positions of its own items only.
    const round = (value, dp) => Math.round((Number(value) || 0) * 10 ** dp) / 10 ** dp;
    const siteLines = await num(`select count(*)::int as n from "StockBalance" b join "InventoryItem" i on i.id = b."itemId" left join "WarehouseLocation" l on l.id = b."locationId" where b."warehouseId" = $1 and b."orgId" = $2 and i."orgId" = $2 and (b."locationId" is null or l."orgId" = $2) and b."onHand" > 0`, [siteWh, attackerOrg]);
    const siteLinesAll = await num(`select count(*)::int as n from "StockBalance" b where b."warehouseId" = $1 and b."onHand" > 0`, [siteWh]);
    const itemFigures = await q(`select i.id, i."averageCost"::float8 as avg, coalesce((select sum(b."onHand") from "StockBalance" b join "Warehouse" w on w.id = b."warehouseId" left join "WarehouseLocation" l on l.id = b."locationId" where b."itemId" = i.id and b."orgId" = $1 and w."orgId" = $1 and (b."locationId" is null or l."orgId" = $1)), 0)::float8 as own from "InventoryItem" i where i."orgId" = $1 and i.status = 'active'`, [attackerOrg]);
    const ownValue = round(itemFigures.reduce((sum, row) => sum + round(round(row.own, 4) * row.avg, 2), 0), 2);
    console.log(`      site store: ${siteLines} own stocked line(s), ${siteLinesAll} balance row(s) with stock; the company's stock at average ${ownValue}`);
    const summary = await ask(warehouse, 'GET', '/inventory/summary');
    const summarySite = (summary.body?.data?.byWarehouse || []).find((row) => row.id === siteWh);
    gated(summary, `READ /inventory/summary: nothing of company ${VICTIM}; the site store's stocked lines are its own positions (${siteLines}) and the total value the company's own stock (${ownValue})`,
      summary.status === 200 && !traced(summary) && summarySite?.lines === siteLines && Math.abs(Number(summary.body?.data?.totalValue) - ownValue) < 0.05,
      `${said(summary)}; site lines ${summarySite?.lines}; total ${summary.body?.data?.totalValue}${trace(summary)}`);
    const analytics = await ask(warehouse, 'GET', '/inventory/analytics');
    const analyticsSite = (analytics.body?.data?.byWarehouse || []).find((row) => row.id === siteWh);
    gated(analytics, `READ /inventory/analytics: nothing of company ${VICTIM}; the site store's stocked lines are its own positions (${siteLines}) and the total value the company's own stock (${ownValue})`,
      analytics.status === 200 && !traced(analytics) && analyticsSite?.lines === siteLines && Math.abs(Number(analytics.body?.data?.headline?.totalValue) - ownValue) < 0.05,
      `${said(analytics)}; site lines ${analyticsSite?.lines}; total ${analytics.body?.data?.headline?.totalValue}${trace(analytics)}`);
  }

  // ══ 1. goods receipt: lines[].locationId, both doors ══════════════════════
  console.log('\n── goods receipt: lines[].locationId ──');
  const openOrder = async (label, itemCode, orderedQty) => {
    const made = await ask(procurement, 'POST', `${AP}/procurement/purchase-orders`, {
      supplierId,
      status: 'draft',
      currency: 'USD',
      orderDate: new Date().toISOString().slice(0, 10),
      requiredBy: new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10),
      promisedDate: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
      item: `Proof ${label} order ${STAMP}`,
      notes: `State proof ${STAMP}`,
      lines: [{ lineNumber: 1, activityId: ownActivity, itemCode, description: `Proof ${label} line ${STAMP}`, unit: 'bag', orderedQty, unitCost: 2 }],
    });
    const orderId = made.body?.data?.id;
    check(`open state (${label}): a fresh purchase order is created (201)`, made.status === 201 && orderId, said(made));
    for (const [step, who] of [['submit', procurement], ['approve', pm], ['issue', procurement]]) {
      const res = orderId ? await ask(who, 'POST', `${AP}/purchase-orders/${orderId}/${step}`, {}) : { status: 0, body: null };
      check(`open state (${label}): ${step} (200)`, res.status === 200, said(res));
    }
    const order = orderId ? await one(`select status from "ProcurementOrder" where id = $1`, [orderId]) : null;
    const poLine = orderId ? await one(`select id::text as id, "receivedQty", "inventoryItemId"::text as item from "ProcurementPoLine" where "orderId" = $1`, [orderId]) : null;
    check(`open state (${label}): the order is issued, its line has nothing received and no stocked item yet`, order?.status === 'issued' && poLine && Number(poLine.receivedQty) === 0 && !poLine.item, `${order?.status}; line ${JSON.stringify(poLine)}`);
    return { orderId, poLineId: poLine?.id };
  };
  const receiptOf = async (orderId, field, value) => one(`select id::text as id, "dailyReportId"::text as report from "DeliveryReceipt" where "orderId" = $1 and "${field}" = $2`, [orderId, value]);
  const movementsOf = async (poLineId) => q(`select "locationId"::text as loc from "StockTransaction" where "poLineId" = $1 order by "createdAt"`, [poLineId]);
  const itemBySku = async (sku) => one(`select id::text as id from "InventoryItem" where "orgId" = $1 and sku = $2`, [attackerOrg, sku]);
  {
    const itemCode = `PRF-${STAMP}`;
    const { orderId, poLineId } = await openOrder('bins', itemCode, 40);
    // The line names no stocked item: the first delivery makes a fresh one (SKU PRF-<stamp>), so what
    // the item's scan shows afterwards is this run's doing and nothing older.
    const receipt = (note, locationId) => ({
      orderId,
      projectId: A.id,
      warehouseId: siteWh,
      deliveryNote: note,
      notes: `State proof ${STAMP}`,
      lines: [{ poLineId, acceptedQty: 1, rejectedQty: 0, locationId }],
    });
    const byNote = (note) => receiptOf(orderId, 'deliveryNote', note);

    // ALLOWED — the gate of every REFUSED check on this order
    const ownNote = `DN own ${STAMP}`;
    const ok = await ask(warehouse, 'POST', '/inventory/goods-receipt', receipt(ownNote, ownLocation));
    const afterOwn = await movementsOf(poLineId);
    check(`ALLOWED: the company's own bin ${ownLocation} is accepted (201) and stored on the stock movement`, ok.status === 201 && afterOwn.length === 1 && afterOwn[0].loc === ownLocation && (await byNote(ownNote)), `${said(ok)}; movements ${JSON.stringify(afterOwn)}`);

    // REFUSED and NOWHERE
    const badNote = `DN foreign ${STAMP}`;
    const bad = await ask(warehouse, 'POST', '/inventory/goods-receipt', receipt(badNote, foreignLocation));
    const afterBad = await movementsOf(poLineId);
    const badReceipt = await byNote(badNote);
    gated(ok, `REFUSED: company ${VICTIM}'s location is refused with a 4xx (no 5xx)`, is4xx(bad), said(bad));
    gated(ok, 'REFUSED: …nothing stored (no receipt, no movement, the line not advanced)', !badReceipt && afterBad.length === afterOwn.length,
      `${badReceipt ? `STORED: DeliveryReceipt ${badReceipt.id}; ` : ''}movements ${JSON.stringify(afterBad)}${afterBad.some((m) => m.loc === foreignLocation) ? ` — a movement of company ${ATTACKER} names company ${VICTIM}'s location` : ''}`);
    gated(ok, 'REFUSED: …and the answer carries nothing of the victim', !traced(bad), `${bad.status} ${(bad.text || '').slice(0, 200)}`);
    const noneNote = `DN nowhere ${STAMP}`;
    const none = await ask(warehouse, 'POST', '/inventory/goods-receipt', receipt(noneNote, nowhere()));
    gated(ok, 'NOWHERE: …exactly as a location that exists nowhere (status, code, message)', said(bad) === said(none), `${said(bad)} | ${said(none)}`);
    gated(ok, 'NOWHERE: …which is itself a 4xx and stores nothing', is4xx(none) && !(await byNote(noneNote)) && (await movementsOf(poLineId)).length === afterOwn.length, said(none));

    // The same company's bin of another warehouse is not "in this warehouse" either.
    if (otherWarehouseLocation) {
      const otherNote = `DN other store ${STAMP}`;
      const other = await ask(warehouse, 'POST', '/inventory/goods-receipt', receipt(otherNote, otherWarehouseLocation));
      gated(ok, 'a bin of another warehouse of the same company is refused the same way (not stored)', said(other) === said(none) && !(await byNote(otherNote)), `${said(other)} | ${said(none)}`);
    }

    // SHAPES
    for (const [shape, make] of SHAPES) {
      const shapedBad = await ask(warehouse, 'POST', '/inventory/goods-receipt', receipt(`DN shape foreign ${shape} ${STAMP}`, make(foreignLocation)));
      const shapedNone = await ask(warehouse, 'POST', '/inventory/goods-receipt', receipt(`DN shape nowhere ${shape} ${STAMP}`, make(nowhere())));
      gated(ok, `SHAPES (inventory door) locationId ${shape}: a 4xx, never a 5xx, answered as the same shape of an id that exists nowhere, nothing of the victim, nothing stored`,
        is4xx(shapedBad) && said(shapedBad) === said(shapedNone) && !traced(shapedBad) && !(await byNote(`DN shape foreign ${shape} ${STAMP}`)) && !(await byNote(`DN shape nowhere ${shape} ${STAMP}`)) && (await movementsOf(poLineId)).length === afterOwn.length,
        `${said(shapedBad)} | ${said(shapedNone)}`);
    }
    const ok2 = await ask(warehouse, 'POST', '/inventory/goods-receipt', receipt(`DN own again ${STAMP}`, ownLocation));
    check('STILL: the own bin is still accepted after the refusals', ok2.status === 201, said(ok2));

    // Procurement's door to the same writer carries the line's bin too.
    const door = (number, locationId) => ask(warehouse, 'POST', `${AP}/procurement/purchase-orders/${orderId}/receipts`, {
      receiptNumber: number,
      warehouseId: siteWh,
      deliveryNote: `State proof ${number}`,
      lines: [{ poLineId, acceptedQty: 1, rejectedQty: 0, locationId }],
    });
    const byNumber = (number) => receiptOf(orderId, 'receiptNumber', number);
    const beforeDoor = (await movementsOf(poLineId)).length;
    const pOwn = await door(`PRF-${STAMP}-P1`, ownLocation);
    const afterDoor = await movementsOf(poLineId);
    check('ALLOWED (procurement door): the own bin is accepted (201) and stored on the stock movement', pOwn.status === 201 && afterDoor.length === beforeDoor + 1 && afterDoor.at(-1)?.loc === ownLocation, `${said(pOwn)}; last movement ${JSON.stringify(afterDoor.at(-1))}`);
    const pBad = await door(`PRF-${STAMP}-P2`, foreignLocation);
    const pNone = await door(`PRF-${STAMP}-P3`, nowhere());
    gated(pOwn, `REFUSED (procurement door): company ${VICTIM}'s location is refused with a 4xx exactly as a location that exists nowhere`, is4xx(pBad) && said(pBad) === said(pNone) && !traced(pBad), `${said(pBad)} | ${said(pNone)}`);
    gated(pOwn, 'REFUSED (procurement door): …nothing stored', !(await byNumber(`PRF-${STAMP}-P2`)) && !(await byNumber(`PRF-${STAMP}-P3`)) && (await movementsOf(poLineId)).length === afterDoor.length, JSON.stringify(await movementsOf(poLineId)));
    for (const [index, [shape, make]] of SHAPES.entries()) {
      const shapedBad = await door(`PRF-${STAMP}-PSF${index}`, make(foreignLocation));
      const shapedNone = await door(`PRF-${STAMP}-PSN${index}`, make(nowhere()));
      gated(pOwn, `SHAPES (procurement door) locationId ${shape}: a 4xx, never a 5xx, answered as the same shape of an id that exists nowhere, nothing stored`,
        is4xx(shapedBad) && said(shapedBad) === said(shapedNone) && !traced(shapedBad) && !(await byNumber(`PRF-${STAMP}-PSF${index}`)) && !(await byNumber(`PRF-${STAMP}-PSN${index}`)) && (await movementsOf(poLineId)).length === afterDoor.length,
        `${said(shapedBad)} | ${said(shapedNone)}`);
    }

    // What the company reads back afterwards: the fresh item's scan names only its own bins.
    const item = await itemBySku(itemCode);
    const scan = item ? await ask(warehouse, 'GET', `/inventory/items/scan/${encodeURIComponent(itemCode)}`) : { status: 0, text: '' };
    const bins = (scan.body?.data?.stock || []).map((row) => row.locationId);
    check(`read-back: the delivered item's scan (${itemCode}) shows stock in the company's own bin only, nothing of company ${VICTIM}`, scan.status === 200 && bins.length > 0 && bins.every((bin) => bin === ownLocation) && !traced(scan), `${said(scan)}; bins ${JSON.stringify(bins)}${trace(scan)}`);
  }

  // ══ 2. goods receipt: dailyReportId, both doors ═══════════════════════════
  console.log('\n── goods receipt: dailyReportId ──');
  {
    const itemCode = `PRF-${STAMP}-DR`;
    const { orderId, poLineId } = await openOrder('daily report', itemCode, 40);
    const invDoor = (number, extra) => ask(warehouse, 'POST', '/inventory/goods-receipt', { orderId, warehouseId: siteWh, receiptNumber: number, notes: `State proof ${STAMP}`, lines: [{ poLineId, acceptedQty: 1, rejectedQty: 0 }], ...extra });
    const procDoor = (number, extra) => ask(warehouse, 'POST', `${AP}/procurement/purchase-orders/${orderId}/receipts`, { receiptNumber: number, warehouseId: siteWh, notes: `State proof ${STAMP}`, lines: [{ poLineId, acceptedQty: 1, rejectedQty: 0 }], ...extra });
    const byNumber = (number) => receiptOf(orderId, 'receiptNumber', number);
    const reportNaming = async () => num(`select count(*)::int as n from "DeliveryReceipt" r join "Project" p on p.id = r."projectId" where p."orgId" = $1 and r."dailyReportId" = $2`, [attackerOrg, foreignReport]);
    const namingBeforeDr = await reportNaming();

    // A first delivery refused for its report leaves no stocked item behind:
    // the line has none yet, and the refused requests come first.
    const firstBad = await invDoor(`${STAMP}-DR-FIRST-F`, { dailyReportId: foreignReport });
    const firstNone = await invDoor(`${STAMP}-DR-FIRST-N`, { dailyReportId: nowhere() });
    const firstShape = await invDoor(`${STAMP}-DR-FIRST-S`, { dailyReportId: { not: 'x' } });
    const leftItem = await itemBySku(itemCode);
    // ALLOWED — the gate of every REFUSED check on this order (the inventory door)
    const ok = await invDoor(`${STAMP}-DR-OWN`, { dailyReportId: ownReport });
    const okRow = await byNumber(`${STAMP}-DR-OWN`);
    check(`ALLOWED (inventory door): the project's own daily report ${ownReport} is accepted (201) and stored on the receipt`, ok.status === 201 && okRow?.report === ownReport, `${said(ok)}; stored ${okRow?.report ?? 'nothing'}`);
    gated(ok, `REFUSED (inventory door, first delivery): company ${VICTIM}'s report, one that exists nowhere and a Prisma filter are refused alike (4xx) and leave no stocked item behind`,
      is4xx(firstBad) && said(firstBad) === said(firstNone) && said(firstShape) === said(firstNone) && !leftItem && !(await byNumber(`${STAMP}-DR-FIRST-F`)) && !(await byNumber(`${STAMP}-DR-FIRST-N`)) && !(await byNumber(`${STAMP}-DR-FIRST-S`)),
      `${said(firstBad)} | ${said(firstNone)} | ${said(firstShape)}${leftItem ? `; STORED: InventoryItem ${leftItem.id} (${itemCode}) created by a refused delivery` : ''}`);

    const bad = await invDoor(`${STAMP}-DR-F`, { dailyReportId: foreignReport });
    const none = await invDoor(`${STAMP}-DR-N`, { dailyReportId: nowhere() });
    gated(ok, `REFUSED (inventory door): company ${VICTIM}'s daily report is refused with a 4xx exactly as one that exists nowhere (status, code, message)`, is4xx(bad) && said(bad) === said(none), `${said(bad)} | ${said(none)}`);
    gated(ok, 'REFUSED (inventory door): …nothing stored, nothing of the victim in the answer', !(await byNumber(`${STAMP}-DR-F`)) && !(await byNumber(`${STAMP}-DR-N`)) && !traced(bad), `${bad.status} ${(bad.text || '').slice(0, 160)}`);
    for (const [index, [shape, make]] of SHAPES.entries()) {
      const shapedBad = await invDoor(`${STAMP}-DR-SF${index}`, { dailyReportId: make(foreignReport) });
      const shapedNone = await invDoor(`${STAMP}-DR-SN${index}`, { dailyReportId: make(nowhere()) });
      gated(ok, `SHAPES (inventory door) dailyReportId ${shape}: a 4xx, never a 5xx, answered as a report that exists nowhere, nothing of the victim, nothing stored`,
        is4xx(shapedBad) && said(shapedBad) === said(none) && said(shapedNone) === said(none) && !traced(shapedBad) && !(await byNumber(`${STAMP}-DR-SF${index}`)) && !(await byNumber(`${STAMP}-DR-SN${index}`)),
        `${said(shapedBad)} | ${said(shapedNone)} | nowhere: ${said(none)}`);
    }
    const ownShaped = await invDoor(`${STAMP}-DR-SOWN`, { dailyReportId: [ownReport] });
    gated(ok, 'SHAPES (inventory door) dailyReportId [own report]: an identifier is a string — refused as a report that exists nowhere, nothing stored', said(ownShaped) === said(none) && !(await byNumber(`${STAMP}-DR-SOWN`)), `${said(ownShaped)} | ${said(none)}`);
    const trimmed = await invDoor(`${STAMP}-DR-TRIM`, { dailyReportId: `  ${ownReport}  ` });
    check('ALLOWED (inventory door): the own report sent with surrounding spaces is stored trimmed', trimmed.status === 201 && (await byNumber(`${STAMP}-DR-TRIM`))?.report === ownReport, `${said(trimmed)}; stored ${(await byNumber(`${STAMP}-DR-TRIM`))?.report ?? 'nothing'}`);

    // Procurement's door to the same writer
    const pOk = await procDoor(`${STAMP}-DR-POWN`, { dailyReportId: ownReport });
    check(`ALLOWED (procurement door): the project's own daily report is accepted (201) and stored`, pOk.status === 201 && (await byNumber(`${STAMP}-DR-POWN`))?.report === ownReport, `${said(pOk)}; stored ${(await byNumber(`${STAMP}-DR-POWN`))?.report ?? 'nothing'}`);
    const pBad = await procDoor(`${STAMP}-DR-PF`, { dailyReportId: foreignReport });
    const pNone = await procDoor(`${STAMP}-DR-PN`, { dailyReportId: nowhere() });
    gated(pOk, `REFUSED (procurement door): company ${VICTIM}'s daily report is refused with a 4xx exactly as one that exists nowhere; nothing stored`, is4xx(pBad) && said(pBad) === said(pNone) && !traced(pBad) && !(await byNumber(`${STAMP}-DR-PF`)) && !(await byNumber(`${STAMP}-DR-PN`)), `${said(pBad)} | ${said(pNone)}`);
    for (const [index, [shape, make]] of SHAPES.entries()) {
      const shapedBad = await procDoor(`${STAMP}-DR-PSF${index}`, { dailyReportId: make(foreignReport) });
      const shapedNone = await procDoor(`${STAMP}-DR-PSN${index}`, { dailyReportId: make(nowhere()) });
      gated(pOk, `SHAPES (procurement door) dailyReportId ${shape}: a 4xx, never a 5xx, answered as the same shape of an id that exists nowhere, nothing stored`,
        is4xx(shapedBad) && said(shapedBad) === said(shapedNone) && !traced(shapedBad) && !(await byNumber(`${STAMP}-DR-PSF${index}`)) && !(await byNumber(`${STAMP}-DR-PSN${index}`)),
        `${said(shapedBad)} | ${said(shapedNone)}`);
    }
    gated(ok, `NOTHING: no receipt of company ${ATTACKER} names company ${VICTIM}'s daily report that did not before`, (await reportNaming()) === namingBeforeDr, `${namingBeforeDr} -> ${await reportNaming()}`);
    const still = await invDoor(`${STAMP}-DR-OWN2`, { dailyReportId: ownReport });
    check('STILL: the order still accepts a delivery booked against the own report', still.status === 201, said(still));
  }

  // ══ 2b. goods receipt: the other identifiers the delivery names ═══════════
  console.log('\n── goods receipt: orderId, projectId, warehouseId, lines[].inventoryItemId, receivedAt ──');
  {
    const itemCode = `PRF-${STAMP}-ID`;
    const { orderId, poLineId } = await openOrder('identifiers', itemCode, 60);
    const lineState = async () => JSON.stringify(await one(`select "receivedQty"::text as r, "inventoryItemId"::text as item from "ProcurementPoLine" where id = $1`, [poLineId]));
    const byNumber = (number) => receiptOf(orderId, 'receiptNumber', number);
    const invDoor = (number, extra = {}, lineExtra = {}) => ask(warehouse, 'POST', '/inventory/goods-receipt', { orderId, projectId: A.id, warehouseId: siteWh, receiptNumber: number, notes: `State proof ${STAMP}`, lines: [{ poLineId, acceptedQty: 1, rejectedQty: 0, ...lineExtra }], ...extra });
    const procDoor = (number, extra = {}, lineExtra = {}) => ask(warehouse, 'POST', `${AP}/procurement/purchase-orders/${orderId}/receipts`, { receiptNumber: number, warehouseId: siteWh, notes: `State proof ${STAMP}`, lines: [{ poLineId, acceptedQty: 1, rejectedQty: 0, ...lineExtra }], ...extra });

    // ALLOWED: the first delivery settles the line's stocked item; the next names it, and every own identifier.
    const first = await invDoor(`${STAMP}-ID-FIRST`, { receivedAt: new Date().toISOString() });
    const ownItem = (await one(`select "inventoryItemId"::text as item from "ProcurementPoLine" where id = $1`, [poLineId]))?.item;
    const ok = await invDoor(`${STAMP}-ID-OWN`, { receivedAt: new Date().toISOString() }, { inventoryItemId: ownItem });
    check('ALLOWED (inventory door): the own order, project, warehouse, line item and a date are accepted (201) and stored', first.status === 201 && ok.status === 201 && Boolean(ownItem) && Boolean(await byNumber(`${STAMP}-ID-OWN`)), `${said(first)}; ${said(ok)}; item ${ownItem}`);
    const pOk = await procDoor(`${STAMP}-ID-POWN`, {}, { inventoryItemId: ownItem });
    check('ALLOWED (procurement door): the own warehouse and line item are accepted (201) and stored', pOk.status === 201 && Boolean(await byNumber(`${STAMP}-ID-POWN`)), said(pOk));

    const fields = [
      // [door, field, where it goes, victim's id, gate]
      ['inventory', 'orderId', 'body', foreignOrder, ok],
      ['inventory', 'projectId', 'body', foreignProject, ok],
      ['inventory', 'warehouseId', 'body', foreignWarehouse, ok],
      ['inventory', 'lines[].inventoryItemId', 'line', foreignItem, ok],
      ['procurement', 'warehouseId', 'body', foreignWarehouse, pOk],
      ['procurement', 'lines[].inventoryItemId', 'line', foreignItem, pOk],
    ];
    let n = 0;
    for (const [door, field, where, foreignId, gate] of fields) {
      const send = door === 'inventory' ? invDoor : procDoor;
      const key = field.replace('lines[].', '');
      const sendWith = (value) => {
        n += 1;
        const number = `${STAMP}-ID-${n}`;
        return { number, res: send(number, where === 'body' ? { [key]: value } : {}, where === 'line' ? { [key]: value } : {}) };
      };
      const before = await lineState();
      const badCall = sendWith(foreignId);
      const bad = await badCall.res;
      const noneCall = sendWith(nowhere());
      const none = await noneCall.res;
      gated(gate, `REFUSED (${door} door) ${field}: company ${VICTIM}'s id is refused with a 4xx exactly as one that exists nowhere; nothing stored, nothing of the victim`,
        is4xx(bad) && said(bad) === said(none) && !traced(bad) && !(await byNumber(badCall.number)) && !(await byNumber(noneCall.number)) && (await lineState()) === before,
        `${said(bad)} | ${said(none)}; line ${before} -> ${await lineState()}`);
      for (const [shape, make] of SHAPES) {
        const sb = sendWith(make(foreignId));
        const shapedBad = await sb.res;
        const sn = sendWith(make(nowhere()));
        const shapedNone = await sn.res;
        gated(gate, `SHAPES (${door} door) ${field} ${shape}: a 4xx, never a 5xx, answered as the same shape of an id that exists nowhere; nothing stored (the line's item not rebound)`,
          is4xx(shapedBad) && said(shapedBad) === said(shapedNone) && !traced(shapedBad) && !(await byNumber(sb.number)) && !(await byNumber(sn.number)) && (await lineState()) === before,
          `${said(shapedBad)} | ${said(shapedNone)}; line ${before} -> ${await lineState()}`);
      }
    }
    // receivedAt: a date, or refused before anything is read or written.
    for (const [index, value] of [['2026-10-01'], 'not a date', { not: 'x' }, 12345, true].entries()) {
      const before = await lineState();
      const number = `${STAMP}-ID-AT${index}`;
      const res = await invDoor(number, { receivedAt: value });
      gated(ok, `SHAPES (inventory door) receivedAt ${JSON.stringify(value)}: a 4xx, never a 5xx; nothing stored`, is4xx(res) && !(await byNumber(number)) && (await lineState()) === before, `${said(res)}; line ${before} -> ${await lineState()}`);
    }
    const still = await invDoor(`${STAMP}-ID-OWN2`, {}, { inventoryItemId: ownItem });
    check('STILL: the order still accepts a delivery naming its own identifiers', still.status === 201, said(still));
  }

  // ══ 3. POST /inventory/transfers/{transferId}/receive  lines[].id ═════════
  console.log('\n── transfer receive: lines[].id ──');
  {
    // Fresh stock, brought in by this run: a fresh stocked item received into the site store.
    const sku = `PRF-${STAMP}-TRF`;
    const madeItem = await ask(pm, 'POST', '/inventory/items', { sku, name: `Proof transfer item ${STAMP}`, unit: 'nr', notes: `State proof ${STAMP}` });
    const itemId = madeItem.body?.data?.id;
    check(`open state: a fresh stocked item ${sku} is created (201)`, madeItem.status === 201 && itemId, said(madeItem));
    const received = itemId ? await ask(warehouse, 'POST', '/inventory/stock/receive', { itemId, warehouseId: siteWh, quantity: 60, unitCost: 1, reference: `Proof stock ${STAMP}` }) : { status: 0 };
    const onHand = itemId ? await num(`select coalesce(sum("onHand"), 0) as n from "StockBalance" where "itemId" = $1 and "warehouseId" = $2`, [itemId, siteWh]) : 0;
    check('open state: 60 of it are received into the site store (201) — stock this run brought in', received.status === 201 && onHand === 60, `${said(received)}; on hand ${onHand}`);

    // One transfer per case, two lines of the fresh item, dispatched (in transit).
    const openTransfer = async (label) => {
      const made = await ask(warehouse, 'POST', '/inventory/transfers', {
        fromWarehouseId: siteWh,
        toWarehouseId: laydownWh,
        reason: `State proof ${label} ${STAMP}`,
        lines: [{ itemId, quantity: 2, notes: `State proof ${label} A ${STAMP}` }, { itemId, quantity: 2, notes: `State proof ${label} B ${STAMP}` }],
      });
      const id = made.body?.data?.id;
      const sent = id ? await ask(warehouse, 'POST', `/inventory/transfers/${id}/dispatch`, {}) : { status: 0 };
      const rows = id ? await q(`select t.status, l.id::text as "lineId" from "StockTransfer" t join "StockTransferLine" l on l."transferId" = t.id where t.id = $1 order by l.notes`, [id]) : [];
      const open = made.status === 201 && sent.status === 200 && rows.length === 2 && rows.every((row) => row.status === 'in_transit');
      check(`open state (${label}): a fresh two-line transfer is created (201) and dispatched (200), in transit`, open, `${said(made)}; ${said(sent)}; ${rows.map((row) => row.status).join(',')}`);
      return { id, lines: rows.map((row) => row.lineId), open };
    };
    const lineRow = async (lineId) => one(`select "receivedQty", "damagedQty", quantity from "StockTransferLine" where id = $1`, [lineId]);
    const effect = async (t) => JSON.stringify([await lineRow(t.lines[0]), await lineRow(t.lines[1])]);
    // The request names the transfer's own first line (receivedQty 1) and, second, the line under test.
    const receive = (t, secondId) => ask(warehouse, 'POST', `/inventory/transfers/${t.id}/receive`, { lines: [{ id: t.lines[0], receivedQty: 1, damagedQty: 0 }, { id: secondId, receivedQty: 1, damagedQty: 0 }] });

    const own = await openTransfer('own');
    const ok = own.open ? await receive(own, own.lines[1]) : { status: 0 };
    check('ALLOWED: the transfer\'s own line ids are accepted (200) and their reported figures stored (received 1 of 2 on each)', ok.status === 200 && (await effect(own)) === JSON.stringify([{ receivedQty: 1, damagedQty: 0, quantity: 2 }, { receivedQty: 1, damagedQty: 0, quantity: 2 }]), `${said(ok)}; lines ${await effect(own)}`);

    const foreignT = await openTransfer('foreign');
    const bad = foreignT.open ? await receive(foreignT, foreignTransferLine) : { status: 0 };
    const noneT = await openTransfer('nowhere');
    const none = noneT.open ? await receive(noneT, nowhere()) : { status: 0 };
    // What the two requests left on their transfers, read before the gate below receives them.
    const effectBad = await effect(foreignT);
    const effectNone = await effect(noneT);
    const asDispatched = JSON.stringify([{ receivedQty: 0, damagedQty: 0, quantity: 2 }, { receivedQty: 0, damagedQty: 0, quantity: 2 }]);
    // Behaviour changed deliberately (CERT-2 bodies-4): a line that is not one of the transfer's own was
    // matched to nothing and the line it meant booked in full, its reported figures dropped. Such a
    // request is now refused whole (404 TRANSFER_LINE_NOT_FOUND), so the own first line named in the same
    // request is no longer honoured from it. The gate is the same transfer, still in transit, then
    // received with its own line ids (200, received 1 on each).
    const honoured = async (t) => {
      const res = t.open ? await receive(t, t.lines[1]) : { status: 0 };
      return { ok: t.open && ok2xx(res) && Number((await lineRow(t.lines[0]))?.receivedQty) === 1, why: `transfer ${t.open ? 'in transit' : 'NOT in transit'}; own receive ${said(res)}; own line ${JSON.stringify(t.lines[0] ? await lineRow(t.lines[0]) : null)}` };
    };
    const badGate = await honoured(foreignT);
    gated(badGate, `REFUSED: company ${VICTIM}'s transfer line is answered exactly as a line that exists nowhere (status, code, message) — refused, a 4xx`, is4xx(bad) && said(bad) === said(none), `${said(bad)} | ${said(none)}`);
    gated(badGate, 'REFUSED: …with exactly the same effect on the open transfer: none (nothing booked — the transfer\'s lines as dispatched)', effectBad === effectNone && effectBad === asDispatched, `foreign case ${effectBad} | nowhere case ${effectNone}`);
    const victimLineAfter = foreignTransferLine ? await one(`select to_jsonb(t)::text as row from "StockTransferLine" t where id = $1`, [foreignTransferLine]) : null;
    gated(badGate, `REFUSED: …company ${VICTIM}'s transfer line is untouched`, victimLineBefore?.row === victimLineAfter?.row);
    gated(badGate, 'REFUSED: …and the answer carries nothing of the victim', !traced(bad), `${bad.status} ${(bad.text || '').slice(0, 200)}`);

    // SHAPES: [id] used to reach the product (the validator took an array element by element); since CERT-2
    // bodies-4 it is refused at the door like the other shapes. Gated, as above, on the same transfer then
    // received with its own line ids.
    const shapedForeignT = await openTransfer('shape foreign');
    const shapedNoneT = await openTransfer('shape nowhere');
    const sBad = shapedForeignT.open ? await receive(shapedForeignT, [foreignTransferLine]) : { status: 0 };
    const sNone = shapedNoneT.open ? await receive(shapedNoneT, [nowhere()]) : { status: 0 };
    const sEffectBad = await effect(shapedForeignT);
    const sEffectNone = await effect(shapedNoneT);
    gated(await honoured(shapedForeignT), `SHAPES transfer lines[].id [id]: not a 5xx, answered and applied exactly as [an id that exists nowhere]`, sBad.status < 500 && said(sBad) === said(sNone) && sEffectBad === sEffectNone && !traced(sBad), `${said(sBad)} | ${said(sNone)}; ${sEffectBad} | ${sEffectNone}`);
    // The other shapes are refused at the door: one dispatched transfer takes them all, and is then
    // received with its own line ids — the gate, showing it was in an accepting state throughout.
    const held = await openTransfer('shape refused');
    // The lines as dispatched, read back before any refused request.
    const untouched = held.open ? await effect(held) : null;
    const shaped = [];
    for (const [shape, make] of SHAPES.slice(1)) {
      const shapedBad = held.open ? await receive(held, make(foreignTransferLine)) : { status: 0 };
      const shapedNone = held.open ? await receive(held, make(nowhere())) : { status: 0 };
      const state = held.open ? (await one(`select status from "StockTransfer" where id = $1`, [held.id]))?.status : null;
      shaped.push({ shape, shapedBad, shapedNone, state, lines: held.open ? await effect(held) : null });
    }
    const heldOwn = held.open ? await receive(held, held.lines[1]) : { status: 0 };
    check('ALLOWED: that transfer is then received with its own line ids (200)', heldOwn.status === 200, said(heldOwn));
    for (const { shape, shapedBad, shapedNone, state, lines } of shaped) {
      gated(heldOwn, `SHAPES transfer lines[].id ${shape}: a 4xx, never a 5xx, answered as the same shape of an id that exists nowhere, the transfer untouched (still in transit)`,
        is4xx(shapedBad) && said(shapedBad) === said(shapedNone) && !traced(shapedBad) && state === 'in_transit' && lines === untouched,
        `${said(shapedBad)} | ${said(shapedNone)}; ${state}; ${lines}`);
    }
  }

  // ══ 4. POST /projects/{projectId}/timesheets/crews  foremanUserId ═════════
  console.log('\n── crews: foremanUserId ──');
  {
    const crewByName = async (name) => one(`select id::text as id, "foremanUserId"::text as foreman from "Crew" where "projectId" = $1 and name = $2`, [A.id, name]);
    const foremanCount = async (userId) => Number((await one(`select count(*)::int as n from "Crew" where "orgId" = $1 and "foremanUserId" = $2`, [attackerOrg, userId])).n);
    const foreignBefore = await foremanCount(foreignUser);

    // ALLOWED: a crew name used nowhere is the open state.
    const ownName = `Proof crew own ${STAMP}`;
    check('open state: the crew name is used nowhere on the project', !(await crewByName(ownName)));
    const ok = await ask(site, 'POST', `${AP}/timesheets/crews`, { name: ownName, foremanUserId: ownForeman, status: 'active' });
    const ownRow = await crewByName(ownName);
    check(`ALLOWED: the company's own member ${ownForeman} is accepted as foreman (201) and stored`, ok.status === 201 && ownRow?.foreman === ownForeman, `${said(ok)}; stored ${ownRow?.foreman ?? 'nothing'}`);
    if (crossHomeMember) {
      const memberName = `Proof crew member ${STAMP}`;
      const okMember = await ask(site, 'POST', `${AP}/timesheets/crews`, { name: memberName, foremanUserId: crossHomeMember.id });
      const memberRow = await crewByName(memberName);
      check('ALLOWED: a member whose home workspace is another company is accepted too (membership, not home)', okMember.status === 201 && memberRow?.foreman === crossHomeMember.id, `${said(okMember)}; stored ${memberRow?.foreman ?? 'nothing'}`);
    }

    // REFUSED and NOWHERE
    const badName = `Proof crew foreign ${STAMP}`;
    const bad = await ask(site, 'POST', `${AP}/timesheets/crews`, { name: badName, foremanUserId: foreignUser, status: 'active' });
    const badRow = await crewByName(badName);
    gated(ok, `REFUSED: company ${VICTIM}'s person is refused as foreman with a 4xx`, is4xx(bad), said(bad));
    gated(ok, 'REFUSED: …nothing stored (no crew, no crew of the company names them)', !badRow && (await foremanCount(foreignUser)) === foreignBefore, badRow ? `STORED: Crew ${badRow.id} (company ${ATTACKER}) .foremanUserId = ${badRow.foreman} -> a member of company ${VICTIM}` : '');
    gated(ok, 'REFUSED: …and the answer carries nothing of the victim', !traced(bad), `${bad.status} ${(bad.text || '').slice(0, 200)}`);
    const noneName = `Proof crew nowhere ${STAMP}`;
    const none = await ask(site, 'POST', `${AP}/timesheets/crews`, { name: noneName, foremanUserId: nowhere(), status: 'active' });
    gated(ok, 'NOWHERE: …exactly as a person who exists nowhere (status, code, message)', said(bad) === said(none), `${said(bad)} | ${said(none)}`);
    gated(ok, 'NOWHERE: …which is itself a 4xx and stores nothing', is4xx(none) && !(await crewByName(noneName)), said(none));

    // The edit route carries the same field; the crew is first shown to accept its own foreman.
    if (ownRow) {
      const editOwn = await ask(site, 'PATCH', `${AP}/timesheets/crews/${ownRow.id}`, { foremanUserId: ownForeman });
      check('ALLOWED (PATCH): the crew accepts its own foreman (200)', editOwn.status === 200, said(editOwn));
      const edit = await ask(site, 'PATCH', `${AP}/timesheets/crews/${ownRow.id}`, { foremanUserId: foreignUser });
      const kept = await crewByName(ownName);
      const editNone = await ask(site, 'PATCH', `${AP}/timesheets/crews/${ownRow.id}`, { foremanUserId: nowhere() });
      gated(editOwn, `REFUSED (PATCH): company ${VICTIM}'s person is refused as nowhere is, and the crew keeps its own foreman`, is4xx(edit) && said(edit) === said(editNone) && kept?.foreman === ownForeman && !traced(edit), `${said(edit)} | ${said(editNone)}; foreman now ${kept?.foreman}`);
      const rename = await ask(site, 'PATCH', `${AP}/timesheets/crews/${ownRow.id}`, { name: `${ownName} renamed` });
      check('STILL (PATCH): the crew is still editable with its own foreman', rename.status === 200, said(rename));
    }
  }

  // ── after ────────────────────────────────────────────────────────────────
  console.log('\n── after ──');
  const namingAfter = await naming();
  const grew = Object.keys(NAMING).filter((t) => namingAfter[t] !== namingBefore[t]);
  check(`no row of company ${ATTACKER} names company ${VICTIM}'s ids that did not before`, grew.length === 0, grew.map((t) => `${t} ${namingBefore[t]}->${namingAfter[t]}`).join(', '));
  check(`the residue rows (${residueBalances.length} balance(s), ${residueMovements.length} movement(s)) are exactly as they were`, JSON.stringify(await residueRows()) === residueBefore);
  const leaked = answers.filter((a) => victimTraces.test(a.text));
  check(`no answer to company ${ATTACKER} carries company ${VICTIM}'s ids, names, addresses or canaries`, leaked.length === 0, leaked.slice(0, 6).map((a) => `${a.status} ${a.route} -> ${(a.text.match(victimTraces) || [])[0]}`).join('\n        '));
  const errors = answers.filter((a) => a.status >= 500);
  check('no answer is a server error', errors.length === 0, errors.slice(0, 5).map((a) => `${a.status} ${a.route} ${(a.text || '').slice(0, 160)}`).join('\n        '));
  const after = await snapshot();
  const moved = fingerprint.compare(before, after).filter((c) => !c.noise && c.org === VICTIM);
  check(`company ${VICTIM}'s data did not change (every table)`, moved.length === 0, moved.slice(0, 8).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
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
