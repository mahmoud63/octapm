'use strict';

/**
 * Timed purchase-order writes of every shape, for the availability-7 proof
 * (CERT-2): how long creating, editing, cancelling, closing and receiving an
 * order of N lines takes, in process, against the code of two backend trees
 * loaded side by side in ONE process — the working tree and a snapshot of the
 * baseline commit — their requests interleaved, so both meet the same
 * database, the same load and the same warm-up, and a difference is the
 * code's.
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/availability-7-timing.js --head=<backend dir> --plan=<item>;<item>... [--reps=3] [--attacker=042]
 *
 *   item   <lines>:<shape>:<when>:<steps>
 *   shape  one   every line on one fresh package (the order's package)
 *          many  line k on its own fresh package
 *          none  no package: every line is its own alert scope
 *   when   late    needed in 5 days, line k promised 5 + (k mod 40) days out
 *          ontime  needed in 60 days, promised in 20
 *   steps  create   POST /projects/{p}/procurement/purchase-orders (draft)
 *          update   PATCH /projects/{p}/purchase-orders/{id} (notes) on that order
 *          cancel   POST /projects/{p}/purchase-orders/{id}/cancel on that order
 *          close    POST …/close (force, closed short) on another such order, issued
 *          receipt  POST /inventory/goods-receipt of half of every line of another
 *                   such issued order (one item code for its lines)
 *
 * Prints "TIMING {json}" per tree, item and repetition. Every record is made
 * fresh, through the API, by company 042's own buyer, PM and storeman, on the
 * LAST of its active standard projects with a site warehouse and a supplier:
 * the large orders stay off the project the proofs share. The packages an
 * order's lines are on are made through the API too, eight at a time.
 */

process.env.REQUEST_LOG_FORMAT = process.env.REQUEST_LOG_FORMAT || 'off';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WORKTREE_BACKEND = path.join(__dirname, '..', '..', '..');
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const dayOf = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const said = (res) => `${res?.status} ${res?.body?.error?.code || ''}`.trim();

/**
 * One tree's application, in this process: its own api client (its own
 * src/app), the database client shared (src/config/db keeps it on global).
 */
const treeOf = (dir, label) => {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const api = require(path.join(dir, 'scripts', 'cert', 'lib', 'api.js'));
  return { dir, label, as: api.as, pool: api.pool };
};

/** Where the timed orders go: company 042's last active standard project with a site warehouse and a supplier. */
const placeFor = async (attackerCode) => {
  // eslint-disable-next-line global-require
  const { buildPopulation } = require('../lib/spec');
  // eslint-disable-next-line global-require
  const { connectCert } = require('../lib/cert-env');
  const { companies } = buildPopulation();
  const company = companies.find((c) => c.code === attackerCode);
  const stages = JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'projects.json'), 'utf8'))[attackerCode] || {};
  const inv = JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'inventory', `${attackerCode}.json`), 'utf8'));
  const usable = Object.entries(inv.projects).filter(([key, p]) => p.depth === 'standard' && stages[key]?.stage === 'active' && p.refs?.inventory?.warehouses?.site && p.refs?.inventory?.supplierId);
  const [projectKey, project] = usable[usable.length - 1] || [];
  if (!project) throw new Error(`company ${attackerCode} needs an active standard project with a site warehouse and a supplier`);
  const db = await connectCert();
  const activityId = (await db.query('select id::text as id from "Activity" where "projectId" = $1 and "isActive" = true order by "createdAt", id limit 1', [project.id])).rows[0]?.id;
  await db.end();
  return {
    company,
    projectKey,
    projectId: project.id,
    activityId,
    supplierId: project.refs.inventory.supplierId,
    siteWarehouse: project.refs.inventory.warehouses.site,
  };
};

/** The writer of one tree: fresh packages, orders of a shape, and each step timed. */
const writerFor = (tree, place, stamp) => {
  const AP = `/projects/${place.projectId}`;
  const buyer = tree.as(`procurement@${place.company.domain}`);
  const pm = tree.as(`pm@${place.company.domain}`);
  const store = tree.as(`warehouse@${place.company.domain}`);
  let packages = 0;
  const timed = async (fn) => {
    const started = process.hrtime.bigint();
    const res = await fn();
    return { res, ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6) };
  };
  const newPackages = async (count, label) => {
    const made = await tree.pool(Array.from({ length: count }, (_, k) => k), 8, async () => {
      packages += 1;
      const res = await buyer.send('POST', `${AP}/procurement/packages`, {
        packageNumber: `${stamp}-${tree.label}-${label}-${packages}`,
        title: `Timing package ${label} ${stamp}`,
        activityId: place.activityId,
        requiredOnSiteDate: dayOf(200),
        leadWeeks: 0,
        bufferDays: 0,
        notes: `Timing ${stamp}`,
      });
      if (res.status !== 201) throw new Error(`package ${label}: ${said(res)}`);
      return res.body.data.id;
    });
    return made;
  };
  /** An order body of N lines of the shape and timing, on fresh packages as the shape needs. */
  const orderBody = async ({ lines: n, shape, when }, label) => {
    const [header] = shape === 'one' ? await newPackages(1, label) : [null];
    const own = shape === 'many' ? await newPackages(n, label) : [];
    const need = when === 'late' ? 5 : 60;
    return {
      supplierId: place.supplierId,
      status: 'draft',
      ...(header ? { packageId: header } : {}),
      currency: 'USD',
      requiredBy: dayOf(need),
      item: `Timing ${label} ${stamp}`,
      notes: `Timing ${stamp}`,
      lines: Array.from({ length: n }, (_, k) => ({
        activityId: place.activityId,
        itemCode: `${stamp}-${tree.label}-${label}`,
        description: `Timing ${label} line ${k + 1} ${stamp}`,
        unit: 'nr',
        orderedQty: 1,
        unitCost: 10,
        requiredDate: dayOf(need),
        promisedDate: dayOf(when === 'late' ? 5 + (k % 40) : 20),
        ...(shape === 'many' ? { packageId: own[k] } : {}),
      })),
    };
  };
  const create = (body) => buyer.send('POST', `${AP}/procurement/purchase-orders`, body);
  /** An order of the shape, submitted, approved and issued. */
  const issuedOrder = async (item, label) => {
    const made = await create(await orderBody(item, label));
    const orderId = made.body?.data?.id;
    const setup = [made];
    for (const [step, who] of [['submit', buyer], ['approve', pm], ['issue', buyer]]) setup.push(await who.send('POST', `${AP}/purchase-orders/${orderId}/${step}`, {}));
    return { orderId, lineIds: (made.body?.data?.lines || []).map((line) => line.id), setup: setup.map(said) };
  };
  return {
    label: tree.label,
    /** A two-line order made and cancelled: the code paths and the pool warmed. */
    warm: async () => {
      const made = await create(await orderBody({ lines: 2, shape: 'one', when: 'late' }, 'W'));
      await pm.send('POST', `${AP}/purchase-orders/${made.body?.data?.id}/cancel`, { reason: `Timing ${stamp}: warm-up` });
    },
    /** One plan item, every step it names, each timed. */
    run: async (item, tag) => {
      const { steps } = item;
      const out = { tree: tree.label, lines: item.lines, shape: item.shape, when: item.when, stamp };
      if (steps.some((step) => ['create', 'update', 'cancel'].includes(step))) {
        const body = await orderBody(item, `C${tag}`);
        const made = await timed(() => create(body));
        out.create = { status: made.res.status, said: said(made.res), ms: made.ms, lines: made.res.body?.data?.lines?.length || 0, orderId: made.res.body?.data?.id || null };
        const orderId = made.res.body?.data?.id;
        if (steps.includes('update') && orderId) {
          const edited = await timed(() => buyer.send('PATCH', `${AP}/purchase-orders/${orderId}`, { notes: `Timing ${stamp}: edited` }));
          out.update = { status: edited.res.status, said: said(edited.res), ms: edited.ms };
        }
        if (steps.includes('cancel') && orderId) {
          const cancelled = await timed(() => pm.send('POST', `${AP}/purchase-orders/${orderId}/cancel`, { reason: `Timing ${stamp}: cancelled` }));
          out.cancel = { status: cancelled.res.status, said: said(cancelled.res), ms: cancelled.ms };
        }
      }
      if (steps.includes('close')) {
        const order = await issuedOrder(item, `K${tag}`);
        // Closed short: nothing delivered, every line outstanding.
        const closed = await timed(() => pm.send('POST', `${AP}/purchase-orders/${order.orderId}/close`, { force: true, reason: `Timing ${stamp}: closed short` }));
        out.close = { status: closed.res.status, said: said(closed.res), ms: closed.ms, setup: order.setup };
      }
      if (steps.includes('receipt')) {
        const order = await issuedOrder(item, `R${tag}`);
        // Half of every line received: every line moves.
        const received = await timed(() => store.send('POST', '/inventory/goods-receipt', {
          orderId: order.orderId,
          warehouseId: place.siteWarehouse,
          receiptNumber: `${stamp}-${tree.label}-R${tag}`,
          lines: order.lineIds.map((poLineId) => ({ poLineId, acceptedQty: 0.5 })),
        }));
        out.receipt = { status: received.res.status, said: said(received.res), ms: received.ms, setup: order.setup };
      }
      return out;
    },
  };
};

const parsePlan = (text) =>
  String(text)
    .split(';')
    .filter(Boolean)
    .map((item) => {
      const [lines, shape = 'one', when = 'late', steps = 'create,cancel'] = item.split(':');
      return { lines: Number(lines), shape, when, steps: steps.split(',') };
    });

/**
 * Runs every plan item `reps` times on each tree, the trees taking turns (the
 * first tree of each turn alternating), and gives every result as it comes.
 */
const runInterleaved = async ({ trees, plan, reps = 1, attacker = '042', onResult = () => {} }) => {
  const place = await placeFor(attacker);
  const stamp = `AV7-${attacker}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
  const writers = trees.map((tree) => writerFor(tree, place, stamp));
  for (const writer of writers) await writer.warm();
  const results = [];
  let turn = 0;
  for (const [index, item] of plan.entries()) {
    for (let rep = 0; rep < reps; rep += 1) {
      const order = turn % 2 === 0 ? writers : [...writers].reverse();
      turn += 1;
      for (const writer of order) {
        const out = { ...(await writer.run(item, `${index + 1}.${rep + 1}`)), rep: rep + 1, project: place.projectKey };
        results.push(out);
        onResult(out);
      }
    }
  }
  return { place, stamp, results };
};

module.exports = { treeOf, parsePlan, runInterleaved, placeFor };

if (require.main === module) {
  const arg = (name, fallback = null) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  if (process.env.CERT_INPROCESS !== '1') throw new Error('availability-7-timing runs in process only (CERT_INPROCESS=1)');
  // eslint-disable-next-line global-require
  require('dotenv').config({ path: path.join(WORKTREE_BACKEND, '.env') });
  const print = console.log.bind(console);
  console.log = (...args) => {
    if (String(args[0] || '').startsWith('[email:local]')) return;
    print(...args);
  };
  console.error = () => {};
  const trees = [treeOf(WORKTREE_BACKEND, 'tree')];
  if (arg('head')) trees.push(treeOf(path.resolve(arg('head')), 'head'));
  runInterleaved({ trees, plan: parsePlan(arg('plan', '120:one:late:create,cancel')), reps: Number(arg('reps', '1')), attacker: arg('attacker', '042'), onResult: (out) => print(`TIMING ${JSON.stringify(out)}`) })
    .then(() => setTimeout(() => process.exit(0), 200))
    .catch((error) => {
      print(`TIMING-ERROR ${error?.stack || error}`);
      process.exit(1);
    });
}
