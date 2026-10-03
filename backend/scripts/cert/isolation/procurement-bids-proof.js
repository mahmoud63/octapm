'use strict';

/**
 * The proof of the CERT-2 procurement-bids pairs: a bid package line and a
 * procurement purchase-order line may name only their own project's BOQ item,
 * activity and budget line, and their own organisation's cost code (the
 * shared check is services/tenant-references.service.js).
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/procurement-bids-proof.js [attacker=023] [victim=024]
 *
 * The CERT-2 injection sweep (results/isolation/cert2-inject.json) found
 *   POST /projects/{projectId}/bids/{packageId}/lines            boqItemId, activityId, costCodeId, budgetLineId
 *   POST /projects/{projectId}/procurement/purchase-orders       lines[].boqItemId, lines[].budgetLineId, lines[].costCodeId
 * answered 201 with another company's id, stored it on bid_package_line /
 * procurement_po_line, and (bid lines) served it back in the package.
 *
 * For each pair, built as the sweep built it (the attacker company's own
 * request on its own project, one id replaced):
 *   ALLOWED  the attacker company's own id is accepted and stored;
 *   REFUSED  the victim company's id is refused with the route's 404 *_NOT_FOUND,
 *            nothing is stored, and the id is not echoed back;
 *   NOWHERE  an id that exists nowhere gets exactly the same answer.
 * The edit route of a bid line (PATCH .../lines/{lineId}) carries the same
 * fields and is proven the same way. Two more references on the same paths are
 * proven too: a bid package's procurementPackageId and a purchase-order line's
 * materialMasterId.
 *
 * No answer may be a 500 or carry the victim's ids, names, addresses or
 * canaries, and the victim company's data must not change in any table.
 * When a refusal fails, the stored row is read back and printed with the
 * company that owns the record it names (the reproduction).
 *
 * Exit code 0 when every case behaves, 2 otherwise.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { as } = require('../lib/api');
const { buildPopulation } = require('../lib/spec');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');

const ATTACKER = process.argv[2] || '023';
const VICTIM = process.argv[3] || '024';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = crypto.randomBytes(3).toString('hex');
const results = [];
const answers = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const said = (res) => `${res.status} ${res.body?.error?.code || ''} ${res.body?.error?.message || ''}`.trim();
const first = (map) => Object.values(map || {})[0] || null;

/** The company (NNN) that owns a record, read from the database. */
const OWNER_SQL = {
  BoqItem: 'select o.slug from "BoqItem" t join "Project" p on p.id = t."projectId" join "Organisation" o on o.id = p."orgId" where t.id = $1',
  Activity: 'select o.slug from "Activity" t join "Project" p on p.id = t."projectId" join "Organisation" o on o.id = p."orgId" where t.id = $1',
  BudgetLine: 'select o.slug from "BudgetLine" t join "Organisation" o on o.id = t."orgId" where t.id = $1',
  CostCode: 'select o.slug from "CostCode" t join "Organisation" o on o.id = t."orgId" where t.id = $1',
  ProcurementPackage: 'select o.slug from "ProcurementPackage" t join "Project" p on p.id = t."projectId" join "Organisation" o on o.id = p."orgId" where t.id = $1',
  MaterialMaster: 'select o.slug from "MaterialMaster" t join "Project" p on p.id = t."projectId" join "Organisation" o on o.id = p."orgId" where t.id = $1',
};

const main = async () => {
  const { companies } = buildPopulation();
  const attacker = companies.find((c) => c.code === ATTACKER);
  const victim = companies.find((c) => c.code === VICTIM);
  const inventory = (code) => JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'inventory', `${code}.json`), 'utf8'));
  const standard = (inv) => Object.values(inv.projects).find((p) => p.depth === 'standard' && p.refs?.activities && p.refs?.boq && p.refs?.budgetLines && p.refs?.procurement?.packages);
  const atkInv = inventory(ATTACKER);
  const vicInv = inventory(VICTIM);
  const A = standard(atkInv);
  const V = standard(vicInv);
  if (!A || !V) throw new Error('both companies need a standard project with BOQ, activities, budget lines and procurement packages');

  const atk = as(`pm@${attacker.domain}`);
  const send = async (method, route, body) => {
    const res = await atk.send(method, route, body);
    answers.push({ route: `${method} ${route}`, status: res.status, text: res.text || '' });
    return res;
  };
  const nowhere = () => crypto.randomUUID();
  const AP = `/projects/${A.id}`;

  const db = await guard.connectCert();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const ownerOf = async (table, id) => {
    const slug = (await q(OWNER_SQL[table], [id]))[0]?.slug || null;
    return /^cert-(\d{3})-/.exec(slug || '')?.[1] || (slug ? slug : 'nowhere');
  };

  // ── the ids: the attacker's own and the victim's, each proven by its owner ──
  const ids = {
    BoqItem: { own: first(A.refs.boq), foreign: first(V.refs.boq) },
    Activity: { own: first(A.refs.activities), foreign: first(V.refs.activities) },
    BudgetLine: { own: first(A.refs.budgetLines), foreign: first(V.refs.budgetLines) },
    CostCode: { own: first(atkInv.company.refs.costCodes), foreign: first(vicInv.company.refs.costCodes) },
    ProcurementPackage: { own: first(A.refs.procurement.packages), foreign: first(V.refs.procurement.packages) },
  };
  // No route creates a material master; use one of another company's if the database holds any.
  const anyForeignMaster = (await q(`select t.id::text as id from "MaterialMaster" t join "Project" p on p.id = t."projectId" join "Organisation" o on o.id = p."orgId" where o.slug not like $1 limit 1`, [`cert-${ATTACKER}-%`]))[0]?.id || null;
  for (const [table, pair] of Object.entries(ids)) {
    const own = await ownerOf(table, pair.own);
    const foreign = await ownerOf(table, pair.foreign);
    check(`setup: ${table} ${pair.own} is company ${ATTACKER}'s and ${pair.foreign} is company ${VICTIM}'s`, own === ATTACKER && foreign === VICTIM, `owners ${own} / ${foreign}`);
  }
  const foreignIds = Object.values(ids).map((pair) => pair.foreign);

  console.log(`\nattacker ${ATTACKER} (${A.id}), victim ${VICTIM} (${V.id})${process.env.CERT_INPROCESS === '1' ? ', in process' : ', AGAINST A SERVER (does not prove the working tree)'}\n`);

  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const print = await fingerprint.take(db);
    await db.query('rollback');
    return print;
  };
  const before = await snapshot();

  // ── bid package lines ─────────────────────────────────────────────────────
  const pkgRes = await send('POST', `${AP}/bids`, { title: `Proof bid lines ${STAMP}` });
  if (pkgRes.status !== 201) throw new Error(`setup bid package: ${said(pkgRes)}`);
  const packageId = pkgRes.body.data.id;
  const lineByDescription = async (description) => (await q('select * from "BidPackageLine" where "packageId" = $1 and description = $2', [packageId, description]))[0] || null;
  const showStored = async (row, field, table) =>
    row ? `STORED: BidPackageLine ${row.id} (company ${ATTACKER}) .${field} = ${row[field]} -> ${table} of company ${await ownerOf(table, row[field])}` : 'nothing stored';

  const BID_FIELDS = [
    ['boqItemId', 'BoqItem', 'BOQ_ITEM_NOT_FOUND'],
    ['activityId', 'Activity', 'ACTIVITY_NOT_FOUND'],
    ['costCodeId', 'CostCode', 'COST_CODE_NOT_FOUND'],
    ['budgetLineId', 'BudgetLine', 'BUDGET_LINE_NOT_FOUND'],
  ];
  for (const [field, table, code] of BID_FIELDS) {
    const { own, foreign } = ids[table];
    const label = `bid line ${field}`;
    // ALLOWED
    const ownDesc = `Own ${field} ${STAMP}`;
    const ok = await send('POST', `${AP}/bids/${packageId}/lines`, { description: ownDesc, qty: 1, [field]: own });
    const ownRow = await lineByDescription(ownDesc);
    check(`${label}: the company's own ${table} is accepted (201) and stored`, ok.status === 201 && ownRow?.[field] === own, `${said(ok)}; stored ${ownRow?.[field] ?? 'nothing'}`);
    // REFUSED
    const badDesc = `Foreign ${field} ${STAMP}`;
    const bad = await send('POST', `${AP}/bids/${packageId}/lines`, { description: badDesc, qty: 1, [field]: foreign });
    const badRow = await lineByDescription(badDesc);
    check(`${label}: company ${VICTIM}'s ${table} is refused (404 ${code})`, bad.status === 404 && bad.body?.error?.code === code, said(bad));
    check(`${label}: …nothing stored`, !badRow, await showStored(badRow, field, table));
    check(`${label}: …and the foreign id is not answered back`, !(bad.text || '').includes(foreign), `${bad.status}`);
    // NOWHERE
    const noneDesc = `Nowhere ${field} ${STAMP}`;
    const none = await send('POST', `${AP}/bids/${packageId}/lines`, { description: noneDesc, qty: 1, [field]: nowhere() });
    check(`${label}: …exactly as an id that exists nowhere`, said(bad) === said(none) && !(await lineByDescription(noneDesc)), `${said(bad)} | ${said(none)}`);
    // the edit route, same field
    if (ownRow) {
      const edit = await send('PATCH', `${AP}/bids/${packageId}/lines/${ownRow.id}`, { [field]: foreign });
      const after = (await q('select * from "BidPackageLine" where id = $1', [ownRow.id]))[0];
      check(`${label} (PATCH): company ${VICTIM}'s ${table} is refused (404 ${code}) and the line keeps its own`, edit.status === 404 && edit.body?.error?.code === code && after?.[field] === own, `${said(edit)}; line now ${after?.[field]}`);
      const editOwn = await send('PATCH', `${AP}/bids/${packageId}/lines/${ownRow.id}`, { [field]: own, qty: 2 });
      check(`${label} (PATCH): the company's own ${table} is still accepted`, editOwn.status === 200, said(editOwn));
    }
  }

  // ── a bid package's procurement package ───────────────────────────────────
  {
    const { own, foreign } = ids.ProcurementPackage;
    const ownTitle = `Proof quote own ${STAMP}`;
    const ok = await send('POST', `${AP}/bids`, { title: ownTitle, procurementPackageId: own });
    const ownRow = (await q('select * from "BidPackage" where "projectId" = $1 and title = $2', [A.id, ownTitle]))[0];
    check('bid package procurementPackageId: the company\'s own procurement package is accepted and stored', ok.status === 201 && ownRow?.procurementPackageId === own, `${said(ok)}; stored ${ownRow?.procurementPackageId ?? 'nothing'}`);
    const badTitle = `Proof quote foreign ${STAMP}`;
    const bad = await send('POST', `${AP}/bids`, { title: badTitle, procurementPackageId: foreign });
    const badRow = (await q('select * from "BidPackage" where "projectId" = $1 and title = $2', [A.id, badTitle]))[0];
    check(`bid package procurementPackageId: company ${VICTIM}'s procurement package is refused (404 PROCUREMENT_PACKAGE_NOT_FOUND)`, bad.status === 404 && bad.body?.error?.code === 'PROCUREMENT_PACKAGE_NOT_FOUND', said(bad));
    check('bid package procurementPackageId: …nothing stored', !badRow, badRow ? `STORED: BidPackage ${badRow.id} (company ${ATTACKER}) -> ProcurementPackage of company ${await ownerOf('ProcurementPackage', badRow.procurementPackageId)}` : '');
    const noneTitle = `Proof quote nowhere ${STAMP}`;
    const none = await send('POST', `${AP}/bids`, { title: noneTitle, procurementPackageId: nowhere() });
    check('bid package procurementPackageId: …exactly as an id that exists nowhere', said(bad) === said(none), `${said(bad)} | ${said(none)}`);
    if (ownRow) {
      const edit = await send('PATCH', `${AP}/bids/${ownRow.id}`, { procurementPackageId: foreign });
      const after = (await q('select * from "BidPackage" where id = $1', [ownRow.id]))[0];
      check('bid package procurementPackageId (PATCH): another company\'s is refused and the package keeps its own', edit.status === 404 && edit.body?.error?.code === 'PROCUREMENT_PACKAGE_NOT_FOUND' && after?.procurementPackageId === own, `${said(edit)}; now ${after?.procurementPackageId}`);
    }
  }

  // ── procurement purchase-order lines ──────────────────────────────────────
  const ownActivity = ids.Activity.own;
  const orderLine = (extra) => ({ activityId: ownActivity, description: `Proof PO line ${STAMP}`, unit: 'nr', orderedQty: 2, unitCost: 10, ...extra });
  const orderByItem = async (item) => (await q('select * from "ProcurementOrder" where "projectId" = $1 and item = $2', [A.id, item]))[0] || null;
  const PO_FIELDS = [
    ['boqItemId', 'BoqItem', 'BOQ_ITEM_NOT_FOUND'],
    ['budgetLineId', 'BudgetLine', 'BUDGET_LINE_NOT_FOUND'],
    ['costCodeId', 'CostCode', 'COST_CODE_NOT_FOUND'],
  ];
  for (const [field, table, code] of PO_FIELDS) {
    const { own, foreign } = ids[table];
    const label = `PO lines[].${field}`;
    const linesWith = async (id) => Number((await q(`select count(*)::int n from "ProcurementPoLine" where "projectId" = $1 and "${field}" = $2`, [A.id, id]))[0].n);
    const foreignBefore = await linesWith(foreign);
    // ALLOWED
    const ownItem = `Proof PO own ${field} ${STAMP}`;
    const ok = await send('POST', `${AP}/procurement/purchase-orders`, { item: ownItem, status: 'draft', lines: [orderLine({ [field]: own })] });
    const ownOrder = await orderByItem(ownItem);
    const ownLine = ownOrder ? (await q('select * from "ProcurementPoLine" where "orderId" = $1', [ownOrder.id]))[0] : null;
    check(`${label}: the company's own ${table} is accepted (201) and stored`, ok.status === 201 && ownLine?.[field] === own, `${said(ok)}; stored ${ownLine?.[field] ?? 'nothing'}`);
    // REFUSED
    const badItem = `Proof PO foreign ${field} ${STAMP}`;
    const bad = await send('POST', `${AP}/procurement/purchase-orders`, { item: badItem, status: 'draft', lines: [orderLine({ [field]: foreign })] });
    const badOrder = await orderByItem(badItem);
    const badLine = badOrder ? (await q('select * from "ProcurementPoLine" where "orderId" = $1', [badOrder.id]))[0] : null;
    check(`${label}: company ${VICTIM}'s ${table} is refused (404 ${code})`, bad.status === 404 && bad.body?.error?.code === code, said(bad));
    check(`${label}: …nothing stored (no order, no line naming it)`, !badOrder && (await linesWith(foreign)) === foreignBefore,
      badLine ? `STORED: ProcurementPoLine ${badLine.id} (company ${ATTACKER}) .${field} = ${badLine[field]} -> ${table} of company ${await ownerOf(table, badLine[field])}` : badOrder ? `STORED: ProcurementOrder ${badOrder.id}` : '');
    check(`${label}: …and the foreign id is not answered back`, !(bad.text || '').includes(foreign), `${bad.status}`);
    // NOWHERE
    const noneItem = `Proof PO nowhere ${field} ${STAMP}`;
    const none = await send('POST', `${AP}/procurement/purchase-orders`, { item: noneItem, status: 'draft', lines: [orderLine({ [field]: nowhere() })] });
    check(`${label}: …exactly as an id that exists nowhere`, said(bad) === said(none) && !(await orderByItem(noneItem)), `${said(bad)} | ${said(none)}`);
  }

  // A purchase-order line's material master: no route makes one, so the
  // population holds none; an id that exists nowhere must be refused as the
  // line's material is (404 MATERIAL_NOT_FOUND), not fail on the foreign key.
  {
    const noneItem = `Proof PO nowhere materialMasterId ${STAMP}`;
    const none = await send('POST', `${AP}/procurement/purchase-orders`, { item: noneItem, status: 'draft', lines: [orderLine({ materialMasterId: nowhere() })] });
    check('PO lines[].materialMasterId: an id that exists nowhere is refused (404 MATERIAL_NOT_FOUND), not a 500', none.status === 404 && none.body?.error?.code === 'MATERIAL_NOT_FOUND' && !(await orderByItem(noneItem)), said(none));
    if (anyForeignMaster) {
      const badItem = `Proof PO foreign materialMasterId ${STAMP}`;
      const bad = await send('POST', `${AP}/procurement/purchase-orders`, { item: badItem, status: 'draft', lines: [orderLine({ materialMasterId: anyForeignMaster })] });
      check('PO lines[].materialMasterId: another company\'s material master is refused the same way', said(bad) === said(none) && !(await orderByItem(badItem)), `${said(bad)} | ${said(none)}`);
    } else {
      console.log('      (no material master exists in any other company; the foreign case is the unit test\'s)');
    }
  }

  // ── after ────────────────────────────────────────────────────────────────
  const victimTraces = new RegExp([`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`, ...foreignIds].join('|'));
  const leaked = answers.filter((a) => victimTraces.test(a.text));
  check(`no answer to company ${ATTACKER} carries company ${VICTIM}'s ids, names, addresses or canaries`, leaked.length === 0, leaked.slice(0, 6).map((a) => `${a.status} ${a.route} -> ${(a.text.match(victimTraces) || [])[0]}`).join('\n        '));
  const errors = answers.filter((a) => a.status >= 500);
  check('no answer is a server error', errors.length === 0, errors.slice(0, 5).map((a) => `${a.status} ${a.route}`).join(', '));
  const after = await snapshot();
  const moved = fingerprint.compare(before, after).filter((c) => !c.noise && c.org === VICTIM);
  check(`company ${VICTIM}'s data did not change (every table)`, moved.length === 0, moved.slice(0, 8).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
  await db.end();

  const failed = results.filter((r) => !r.ok);
  console.log(`\nprocurement-bids proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
