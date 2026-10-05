'use strict';

/**
 * Timed runs of large purchase orders on one procurement package each, for
 * the alerts-6 proof (CERT-2): how long creating, cancelling, receiving and
 * closing an order of N lines takes, in process, against the code of the
 * backend tree named on the command line — the working tree, or a snapshot of
 * an earlier commit (the proof compares the two in one run).
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/alerts-6-timing.js --tree=<backend dir> --plan=180:create,cancel,close;240:create,cancel,close;120:receipt [--attacker=042] [--project=042-07]
 *
 * Prints one line "TIMING {json}" per run of the plan. Every record is made
 * fresh, through the API, by company 042's own buyer, PM and storeman, on the
 * LAST of its active standard projects with a site warehouse and a supplier
 * (or --project): the large orders stay off the project the proofs share.
 *
 *   create   POST /projects/{p}/procurement/purchase-orders, N draft lines on
 *            a fresh package (line k promised k mod 40 days late)
 *   cancel   POST /projects/{p}/purchase-orders/{id}/cancel on that order
 *   close    POST /projects/{p}/purchase-orders/{id}/close (force, closed
 *            short) on another such order, submitted, approved and issued
 *   receipt  POST /inventory/goods-receipt of half of every line of another
 *            such issued order (one item code for its lines: one stocked item)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const arg = (name, fallback = null) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const TREE = path.resolve(arg('tree', path.join(__dirname, '..', '..', '..')));
const PLAN = (arg('plan') || `${arg('lines', '120')}:${arg('steps', 'create,cancel')}`)
  .split(';')
  .filter(Boolean)
  .map((item) => {
    const [lines, steps] = item.split(':');
    return { lines: Number(lines), steps: (steps || 'create,cancel').split(',') };
  });
const ATTACKER = arg('attacker', '042');
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `AT6-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
if (process.env.CERT_INPROCESS !== '1') throw new Error('alerts-6-timing runs in process only (CERT_INPROCESS=1)');

// The certification environment is this checkout's (a snapshot of an earlier
// commit has no .env of its own); the tree's own client, in process, loads
// <tree>/src/app.
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });
// eslint-disable-next-line import/no-dynamic-require
const { as } = require(path.join(TREE, 'scripts', 'cert', 'lib', 'api.js'));
// eslint-disable-next-line import/no-dynamic-require
const { buildPopulation } = require(path.join(TREE, 'scripts', 'cert', 'lib', 'spec.js'));
// eslint-disable-next-line import/no-dynamic-require
const { connectCert } = require(path.join(TREE, 'scripts', 'cert', 'lib', 'cert-env.js'));

const print = console.log.bind(console);
console.log = (...args) => {
  if (String(args[0] || '').startsWith('[email:local]')) return;
  print(...args);
};

const dayOf = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const said = (res) => `${res?.status} ${res?.body?.error?.code || ''}`.trim();

const main = async () => {
  const { companies } = buildPopulation();
  const attacker = companies.find((c) => c.code === ATTACKER);
  const stages = JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'projects.json'), 'utf8'))[ATTACKER] || {};
  const inv = JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'inventory', `${ATTACKER}.json`), 'utf8'));
  const usable = Object.entries(inv.projects).filter(([key, p]) => p.depth === 'standard' && stages[key]?.stage === 'active' && p.refs?.inventory?.warehouses?.site && p.refs?.inventory?.supplierId);
  const [projectKey, A] = (arg('project') ? usable.find(([key]) => key === arg('project')) : usable[usable.length - 1]) || [];
  if (!A) throw new Error(`company ${ATTACKER} needs an active standard project with a site warehouse and a supplier`);
  const AP = `/projects/${A.id}`;
  const buyer = as(`procurement@${attacker.domain}`);
  const pm = as(`pm@${attacker.domain}`);
  const store = as(`warehouse@${attacker.domain}`);
  // The project's first active activity (read only).
  const db = await connectCert();
  const activityId = arg('activity') || (await db.query('select id::text as id from "Activity" where "projectId" = $1 and "isActive" = true order by "createdAt", id limit 1', [A.id])).rows[0]?.id;
  await db.end();
  const supplierId = A.refs.inventory.supplierId;
  const siteWh = A.refs.inventory.warehouses.site;

  const timed = async (fn) => {
    const started = process.hrtime.bigint();
    const res = await fn();
    return { res, ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6) };
  };
  const newPackage = (label) => buyer.send('POST', `${AP}/procurement/packages`, { packageNumber: `${STAMP}-${label}`, title: `Timing package ${label} ${STAMP}`, activityId, requiredOnSiteDate: dayOf(200), leadWeeks: 0, bufferDays: 0, notes: `Timing ${STAMP}` });
  // N lines needed in 5 days, line k promised 5 + (k mod 40) days out: the worst is 39 days late.
  // One item code for an order's lines: a delivery stocks them as one item, not N new ones.
  const orderBody = (packageId, label, n) => ({
    supplierId, status: 'draft', packageId, currency: 'USD', requiredBy: dayOf(5), item: `Timing ${label} ${STAMP}`, notes: `Timing ${STAMP}`,
    lines: Array.from({ length: n }, (_, k) => ({ activityId, itemCode: `${STAMP}-${label}`, description: `Timing ${label} line ${k + 1} ${STAMP}`, unit: 'nr', orderedQty: 1, unitCost: 10, requiredDate: dayOf(5), promisedDate: dayOf(5 + (k % 40)) })),
  });
  /** An order of N lines on a fresh package, submitted, approved and issued. */
  const issuedOrder = async (label, n) => {
    const pkg = await newPackage(label);
    const made = await buyer.send('POST', `${AP}/procurement/purchase-orders`, orderBody(pkg.body?.data?.id, label, n));
    const orderId = made.body?.data?.id;
    const steps = [made];
    for (const [step, who] of [['submit', buyer], ['approve', pm], ['issue', buyer]]) steps.push(await who.send('POST', `${AP}/purchase-orders/${orderId}/${step}`, {}));
    return { packageId: pkg.body?.data?.id, orderId, lineIds: (made.body?.data?.lines || []).map((line) => line.id), setup: steps.map((res) => res.status), said: steps.map(said) };
  };

  // Warm the code paths and the pool: a two-line order created and cancelled.
  const warm = await newPackage('W');
  const warmOrder = await buyer.send('POST', `${AP}/procurement/purchase-orders`, orderBody(warm.body?.data?.id, 'W', 2));
  await pm.send('POST', `${AP}/purchase-orders/${warmOrder.body?.data?.id}/cancel`, { reason: `Timing ${STAMP}: warm-up` });

  for (const [index, { lines: n, steps }] of PLAN.entries()) {
    const tag = `${index + 1}`;
    const out = { tree: TREE, project: projectKey, lines: n, stamp: STAMP };
    if (steps.includes('create') || steps.includes('cancel')) {
      const P = await newPackage(`P${tag}`);
      out.packageId = P.body?.data?.id;
      const created = await timed(() => buyer.send('POST', `${AP}/procurement/purchase-orders`, orderBody(out.packageId, `C${tag}`, n)));
      out.create = { status: created.res.status, said: said(created.res), ms: created.ms, lines: created.res.body?.data?.lines?.length || 0, orderId: created.res.body?.data?.id || null };
      if (steps.includes('cancel') && out.create.orderId) {
        const cancelled = await timed(() => pm.send('POST', `${AP}/purchase-orders/${out.create.orderId}/cancel`, { reason: `Timing ${STAMP}: cancelled` }));
        out.cancel = { status: cancelled.res.status, said: said(cancelled.res), ms: cancelled.ms };
      }
    }
    if (steps.includes('close')) {
      const K = await issuedOrder(`K${tag}`, n);
      // Closed short: nothing delivered, every line outstanding.
      const closed = await timed(() => pm.send('POST', `${AP}/purchase-orders/${K.orderId}/close`, { force: true, reason: `Timing ${STAMP}: closed short` }));
      out.close = { status: closed.res.status, said: said(closed.res), ms: closed.ms, packageId: K.packageId, setup: K.setup, setupSaid: K.said };
    }
    if (steps.includes('receipt')) {
      const R = await issuedOrder(`R${tag}`, n);
      // Half of every line received: every line moves.
      const received = await timed(() => store.send('POST', '/inventory/goods-receipt', { orderId: R.orderId, warehouseId: siteWh, receiptNumber: `${STAMP}-R${tag}`, lines: R.lineIds.map((poLineId) => ({ poLineId, acceptedQty: 0.5 })) }));
      out.receipt = { status: received.res.status, said: said(received.res), ms: received.ms, packageId: R.packageId, setup: R.setup, setupSaid: R.said };
    }
    print(`TIMING ${JSON.stringify(out)}`);
  }
};

main()
  .then(() => setTimeout(() => process.exit(0), 200))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
