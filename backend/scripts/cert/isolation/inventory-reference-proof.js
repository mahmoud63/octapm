'use strict';

/**
 * The live proof of finding C2-INV-1 / lead L5: an inventory item or warehouse
 * may point only at its own company's project, supplier and people.
 *
 *   node scripts/cert/isolation/inventory-reference-proof.js [attacker=022] [victim=023]
 *
 * Runs the product's application in this process against octapm_cert
 * (lib/inprocess.js). The attacker company's own people write to their own
 * company's inventory, putting the victim company's identifiers in the
 * reference fields. Every answer must be a refusal that does not tell a
 * foreign id from one that exists nowhere, no answer may be a 500, no answer
 * may carry the victim's data, and the victim company's data must not change
 * at all (state fingerprint of every table, before and after).
 *
 * Exit code 0 when every case behaves, 2 otherwise.
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { start } = require('../lib/inprocess');
const fingerprint = require('./fingerprint');
const { buildPopulation } = require('../lib/spec');

const ATTACKER = process.argv[2] || '022';
const VICTIM = process.argv[3] || '023';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = crypto.randomBytes(3).toString('hex');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};

const main = async () => {
  const { as, prisma, close } = await start();
  const { companies } = buildPopulation();
  const attacker = companies.find((c) => c.code === ATTACKER);
  const victim = companies.find((c) => c.code === VICTIM);
  const projects = JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'projects.json'), 'utf8'));
  const ownProject = Object.values(projects[ATTACKER] || {}).find((p) => p.id)?.id;
  const foreignProject = Object.values(projects[VICTIM] || {}).find((p) => p.id)?.id;
  if (!ownProject || !foreignProject) throw new Error('both companies need a project (state/projects.json)');

  const pm = as(`pm@${attacker.domain}`);
  const warehouseKeeper = as(`warehouse@${attacker.domain}`);
  const site = as(`site@${attacker.domain}`);
  const ownMember = attacker.people.find((p) => p.persona === 'warehouse');
  const foreignPerson = victim.people.find((p) => p.persona === 'finance');

  // A supplier of each company: the victim's read as the victim; the attacker's own made if it has none.
  const victimPm = as(`pm@${victim.domain}`);
  const supplierOf = async (who, projectId, label) => {
    const listed = await who.send('GET', `/projects/${projectId}/procurement/suppliers`);
    const rows = Array.isArray(listed.body?.data) ? listed.body.data : listed.body?.data?.items || [];
    if (rows[0]?.id) return rows[0];
    const made = await who.send('POST', `/projects/${projectId}/procurement/suppliers`, { name: `${label} supplier ${STAMP}` });
    if (made.status !== 201 && made.status !== 200) throw new Error(`could not make a supplier for ${label}: ${made.status} ${made.text?.slice(0, 200)}`);
    return made.body.data;
  };
  const foreignSupplier = await supplierOf(victimPm, foreignProject, `CERT-${VICTIM}`);
  const ownSupplier = await supplierOf(pm, ownProject, `CERT-${ATTACKER}`);
  const nowhere = crypto.randomUUID();

  const db = await (require('../lib/cert-env').connectCert());
  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const print = await fingerprint.take(db);
    await db.query('rollback');
    return print;
  };
  const before = await snapshot();

  const answers = [];
  const ask = async (who, method, route, json) => {
    const res = await who.send(method, route, json);
    answers.push({ route, status: res.status, text: res.text || '' });
    return res;
  };
  const refusal = (res) => `${res.status} ${res.body?.error?.code || ''} ${res.body?.error?.message || ''}`.trim();
  const code = (prefix) => `CRT${ATTACKER}-${prefix}-${STAMP}`.toUpperCase();

  console.log(`attacker company ${ATTACKER}, victim company ${VICTIM}\n`);

  // ── the project ────────────────────────────────────────────────────────
  const ownWh = await ask(warehouseKeeper, 'POST', '/inventory/warehouses', { code: code('W1'), name: 'Own project store', kind: 'site', projectId: ownProject });
  check('a warehouse on the company\'s own project is created', ownWh.status === 201, refusal(ownWh));
  const foreignWh = await ask(warehouseKeeper, 'POST', '/inventory/warehouses', { code: code('W2'), name: 'Foreign project store', kind: 'site', projectId: foreignProject });
  const nowhereWh = await ask(warehouseKeeper, 'POST', '/inventory/warehouses', { code: code('W3'), name: 'No project store', kind: 'site', projectId: nowhere });
  check('a warehouse on another company\'s project is refused (404 PROJECT_NOT_FOUND)', foreignWh.status === 404 && foreignWh.body?.error?.code === 'PROJECT_NOT_FOUND', refusal(foreignWh));
  check('…with exactly the answer a project that exists nowhere gets', refusal(foreignWh) === refusal(nowhereWh), `${refusal(foreignWh)} | ${refusal(nowhereWh)}`);
  const ownItem = await ask(pm, 'POST', '/inventory/items', { sku: code('I1'), name: 'Own item', unit: 'bag', projectId: ownProject, preferredSupplierId: ownSupplier.id });
  check('an item on the own project with the own supplier is created', ownItem.status === 201, refusal(ownItem));
  const foreignItem = await ask(pm, 'POST', '/inventory/items', { sku: code('I2'), name: 'Foreign project item', unit: 'bag', projectId: foreignProject });
  const nowhereItem = await ask(pm, 'POST', '/inventory/items', { sku: code('I3'), name: 'No project item', unit: 'bag', projectId: nowhere });
  check('an item on another company\'s project is refused (404 PROJECT_NOT_FOUND)', foreignItem.status === 404 && foreignItem.body?.error?.code === 'PROJECT_NOT_FOUND', refusal(foreignItem));
  check('…with exactly the answer a project that exists nowhere gets', refusal(foreignItem) === refusal(nowhereItem));

  // ── who may write at all ───────────────────────────────────────────────
  const bySite = await ask(site, 'POST', '/inventory/warehouses', { code: code('W4'), name: 'Site engineer store', kind: 'site', projectId: ownProject });
  check('a site engineer (no inventory create) is refused (403)', bySite.status === 403, refusal(bySite));
  const bySiteForeign = await ask(site, 'POST', '/inventory/warehouses', { code: code('W5'), name: 'Site engineer foreign store', kind: 'site', projectId: foreignProject });
  check('…and refused the same way with another company\'s project (permission first, nothing learned)', bySiteForeign.status === 403, refusal(bySiteForeign));

  // ── the supplier and the manager ───────────────────────────────────────
  const foreignSup = await ask(pm, 'POST', '/inventory/items', { sku: code('I4'), name: 'Foreign supplier item', unit: 'bag', preferredSupplierId: foreignSupplier.id });
  const nowhereSup = await ask(pm, 'POST', '/inventory/items', { sku: code('I5'), name: 'No supplier item', unit: 'bag', preferredSupplierId: nowhere });
  check('an item naming another company\'s supplier is refused (404 SUPPLIER_NOT_FOUND)', foreignSup.status === 404 && foreignSup.body?.error?.code === 'SUPPLIER_NOT_FOUND', refusal(foreignSup));
  check('…with exactly the answer a supplier that exists nowhere gets', refusal(foreignSup) === refusal(nowhereSup));
  const ownMgr = await ask(warehouseKeeper, 'POST', '/inventory/warehouses', { code: code('W6'), name: 'Managed store', kind: 'central', managerId: ownMember.id });
  check('a warehouse managed by a member of the company is created', ownMgr.status === 201, refusal(ownMgr));
  const foreignMgr = await ask(warehouseKeeper, 'POST', '/inventory/warehouses', { code: code('W7'), name: 'Foreign managed store', kind: 'central', managerId: foreignPerson.id });
  const nowhereMgr = await ask(warehouseKeeper, 'POST', '/inventory/warehouses', { code: code('W8'), name: 'Nobody managed store', kind: 'central', managerId: nowhere });
  check('a warehouse managed by another company\'s person is refused (404 USER_NOT_FOUND)', foreignMgr.status === 404 && foreignMgr.body?.error?.code === 'USER_NOT_FOUND', refusal(foreignMgr));
  check('…with exactly the answer a person who exists nowhere gets', refusal(foreignMgr) === refusal(nowhereMgr));

  // ── updates ────────────────────────────────────────────────────────────
  const itemId = ownItem.body?.data?.id;
  const whId = ownMgr.body?.data?.id;
  if (itemId) {
    const toForeignProject = await ask(pm, 'PATCH', `/inventory/items/${itemId}`, { projectId: foreignProject });
    check('moving an item onto another company\'s project is refused', toForeignProject.status === 404 && toForeignProject.body?.error?.code === 'PROJECT_NOT_FOUND', refusal(toForeignProject));
    const toForeignSupplier = await ask(pm, 'PATCH', `/inventory/items/${itemId}`, { preferredSupplierId: foreignSupplier.id });
    check('giving an item another company\'s supplier is refused', toForeignSupplier.status === 404 && toForeignSupplier.body?.error?.code === 'SUPPLIER_NOT_FOUND', refusal(toForeignSupplier));
  }
  if (whId) {
    const toForeignManager = await ask(warehouseKeeper, 'PATCH', `/inventory/warehouses/${whId}`, { managerId: foreignPerson.id });
    check('making another company\'s person a warehouse manager is refused', toForeignManager.status === 404 && toForeignManager.body?.error?.code === 'USER_NOT_FOUND', refusal(toForeignManager));
  }

  // ── nothing of the victim's came back, nothing of the victim's moved ───
  const victimTraces = new RegExp([`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`, foreignPerson.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), String(foreignSupplier.name || '~~none~~').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')].join('|'));
  const leaked = answers.filter((a) => victimTraces.test(a.text));
  check('no answer carries the victim company\'s names, addresses or canaries', leaked.length === 0, leaked.map((a) => `${a.status} ${a.route}`).join(', '));
  const errors = answers.filter((a) => a.status >= 500);
  check('no answer is a server error', errors.length === 0, errors.map((a) => `${a.status} ${a.route}`).join(', '));
  const after = await snapshot();
  const moved = fingerprint.compare(before, after).filter((c) => !c.noise && c.org === VICTIM);
  check(`the victim company's data did not change (every table)`, moved.length === 0, moved.map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));

  await db.end();
  await close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\ninventory reference proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
