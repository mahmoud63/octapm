'use strict';

/**
 * The CERT-2 proof of fix round 6, group alerts-6: the lead-time alert's
 * recompute (its cost and its semantics) and the money aggregates written as
 * exact decimals.
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/alerts-6-proof.js [attacker=042] [victim=043] [--only=perf,settled,delete,subject,money,refusals]
 *
 * PERF      Round 5 worked a package's whole alert scope again for EVERY line
 *           written, inside the writer's five-second transaction: a 180-line
 *           order on one package answered 500 (P2028, transaction expired),
 *           120 lines took 4.1 s to create and 3.1 s to cancel, and a 120-line
 *           delivery answered 500. Each scope is now worked once, after the
 *           loop; a delivery has the batch writers' longer window (240 lines
 *           outlived the five seconds at the baseline too). Measured in the
 *           same run against the baseline commit (f16c14f, extracted
 *           read-only with git archive to C:/Temp/alerts-6-head): 180 and 240
 *           lines created, cancelled and closed, 120 and 240 received — none
 *           answers 5xx, creating is no slower than the baseline, cancelling
 *           and closing are within the baseline's time plus 100 ms (they now
 *           work the one scope the baseline never did), and receiving within
 *           125% of it where the baseline answered at all (a delivery's time
 *           is the warehouse's per-line work; run to run it varies by 15%).
 * SETTLED   A material ordered on an order since cancelled — or closed — kept
 *           its package's alert open, "delivery after need" on the dead
 *           order's promise: the material's view of its lines ignored the
 *           order's status. Resolved now, and the material's own risk shows
 *           no promise.
 * DELETE    Deleting the activity of a package's worst line — or of its worst
 *           planned material — deleted the package's whole alert (the
 *           database cascades the line, the material and the alert linked to
 *           them), while another line on the package was five days late. The
 *           alert stays, worked again on the line still late.
 * SUBJECT   A resolved alert kept the links of the risk it was resolved on;
 *           when that material became another package's worst, the open alert
 *           there was left pointing at nothing (no line, no material). The
 *           open alert has its subject now, and the list serves it.
 * MONEY     Totals checked as exact decimals (or not checked) were written as
 *           floats: 5,000,000,000,000,000 + 4,999,999,999,999,999 is 10^16 as a
 *           double, past a Decimal(18,2) column. A purchase order of two such
 *           lines, which the create check let through, was refused by its own
 *           total; a second such invoice against an order, a timesheet of two
 *           such entries, a commitment taking an activity to
 *           9,999,999,999,999,999 and an equipment cost reaching it were all
 *           refused at the write (numeric overflow 22003, answered with the
 *           generic 400 VALIDATION_ERROR of round 5's error mapping).
 *           Committed and equipment totals past 10^16 were not
 *           checked at all. Each total is now checked and written as the same
 *           decimal: what fits is stored to the cent, what does not is a
 *           specific 400 before anything is written.
 * REFUSALS  Company 043's activity, material, order, package, commitment,
 *           timesheet, daily report and cost record, named by company 042 on
 *           the same routes: answered exactly as a record that exists nowhere,
 *           nothing stored, nothing of 043 in any answer.
 *
 * Every REFUSED check is GATED on the company's own request succeeding on the
 * same kind of record. No answer may be a 5xx or carry anything of company
 * 043, and company 043's data must not change in any table (state
 * fingerprint). Re-runnable: everything is made fresh, through the API, by
 * company 042's own people, on its last active standard project with a site
 * warehouse and a supplier (the large orders stay off the project the other
 * proofs share). Exit code 0 when every check holds, 2 otherwise.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { as, multipart } = require('../lib/api');
const { buildPopulation } = require('../lib/spec');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ATTACKER = positional[0] || '042';
const VICTIM = positional[1] || '043';
const ONLY = (process.argv.find((a) => a.startsWith('--only='))?.slice(7) || 'perf,settled,delete,subject,money,refusals').split(',');
const runs = (section) => ONLY.includes(section);
const GROUP = 'alerts-6';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `AL6-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const INPROCESS = process.env.CERT_INPROCESS === '1';
const BASELINE = process.env.CERT_ALERTS6_BASELINE || 'f16c14f';
const BASELINE_DIR = process.env.CERT_ALERTS6_BASELINE_DIR || 'C:/Temp/alerts-6-head';
const BACKEND = path.resolve(__dirname, '..', '..', '..');
const WORKTREE = path.resolve(BACKEND, '..');

const results = [];
const answers = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const said = (res) => `${res?.status} ${res?.body?.error?.code || ''} ${res?.body?.error?.message || ''}`.trim();
const ok2xx = (res) => Boolean(res) && res.status >= 200 && res.status < 300;
const gateHolds = (gate) => (gate && 'ok' in gate ? Boolean(gate.ok) : ok2xx(gate));
const gateSays = (gate) => (gate && 'ok' in gate ? gate.why : gate ? said(gate) : 'nothing sent');
const gated = (gate, name, ok, detail = '') =>
  check(`${name} [gated]`, gateHolds(gate) && ok, gateHolds(gate) ? detail : `NOT GATED — the own request was not shown to succeed (${gateSays(gate)}); ${detail}`);
/** A calendar date this many days from today (UTC), as a client sends one. */
const dayOf = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const sameRefusal = (foreign, none) => Boolean(foreign) && foreign.status >= 400 && foreign.status < 500 && said(foreign) === said(none);

// The product's local e-mail transport writes to the console in process; keep it out of the proof's output.
const print = console.log.bind(console);
console.log = (...args) => {
  const text = args.map(String).join(' ');
  if (text.startsWith('[email:local]')) return;
  print(...args);
};

/** The baseline commit's backend, extracted read-only (git archive), with this checkout's node_modules. */
const ensureBaseline = () => {
  const marker = path.join(BASELINE_DIR, 'BASELINE');
  const sha = execFileSync('git', ['rev-parse', BASELINE], { cwd: WORKTREE, encoding: 'utf8' }).trim();
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === sha && fs.existsSync(path.join(BASELINE_DIR, 'backend', 'src', 'app.js'))) return { sha, dir: BASELINE_DIR, made: false };
  // Extracted (again) over whatever is there: the commit's files are what is run.
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  const tar = execFileSync('git', ['archive', '--format=tar', sha, 'backend/src', 'backend/scripts/cert/lib', 'backend/package.json', 'shared'], { cwd: WORKTREE, maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', BASELINE_DIR], { input: tar });
  for (const [link, target] of [[path.join(BASELINE_DIR, 'node_modules'), path.join(WORKTREE, 'node_modules')], [path.join(BASELINE_DIR, 'backend', 'node_modules'), path.join(BACKEND, 'node_modules')]]) {
    if (!fs.existsSync(link)) fs.symlinkSync(fs.realpathSync(target), link, 'junction');
  }
  fs.writeFileSync(marker, `${sha}\n`);
  return { sha, dir: BASELINE_DIR, made: true };
};

/** One child process timing a plan against one backend tree (alerts-6-timing.js). */
const timePlan = (tree, plan) =>
  new Promise((resolve) => {
    const env = { ...process.env, CERT_INPROCESS: '1' };
    delete env.DATABASE_URL;
    const child = spawn(process.execPath, [path.join(__dirname, 'alerts-6-timing.js'), `--tree=${tree}`, `--plan=${plan}`, `--attacker=${ATTACKER}`], { cwd: BACKEND, env });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('close', (code) => {
      const rows = out.split(/\r?\n/).filter((line) => line.startsWith('TIMING ')).map((line) => JSON.parse(line.slice(7)));
      resolve({ code, rows, tail: rows.length ? '' : out.slice(-1500) });
    });
  });

const main = async () => {
  console.log(`${GROUP} proof — attacker ${ATTACKER}, victim ${VICTIM}, stamp ${STAMP}, sections ${ONLY.join(',')}${INPROCESS ? ', in process (the working tree\'s code)' : ' — NOT in process: this asks a running API, which does not prove the working tree'}\n`);
  const { companies } = buildPopulation();
  const attacker = companies.find((c) => c.code === ATTACKER);
  const victim = companies.find((c) => c.code === VICTIM);
  if (!attacker || !victim) throw new Error(`unknown company ${ATTACKER} or ${VICTIM}`);
  const stages = JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'projects.json'), 'utf8'))[ATTACKER] || {};
  const atkInv = JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'inventory', `${ATTACKER}.json`), 'utf8'));
  const usable = Object.entries(atkInv.projects).filter(([key, p]) => p.depth === 'standard' && stages[key]?.stage === 'active' && p.refs?.inventory?.warehouses?.site && p.refs?.inventory?.supplierId);
  const [projectKey, B] = usable[usable.length - 1] || [];
  if (!B) throw new Error(`company ${ATTACKER} needs an active standard project with a site warehouse and a supplier`);
  const BP = `/projects/${B.id}`;
  const supplierId = B.refs.inventory.supplierId;
  const siteWh = B.refs.inventory.warehouses.site;

  const db = await guard.connectCert();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const one = async (sql, params = []) => (await q(sql, params))[0] || null;
  const orgOf = async (code) => (await one(`select id::text as id from "Organisation" where slug like $1`, [`cert-${code}-%`]))?.id;
  const attackerOrg = await orgOf(ATTACKER);
  const victimOrg = await orgOf(VICTIM);
  if (!attackerOrg || !victimOrg) throw new Error('both companies must exist in the certification database');

  const pm = as(`pm@${attacker.domain}`);
  const buyer = as(`procurement@${attacker.domain}`);
  const store = as(`warehouse@${attacker.domain}`);
  const ask = async (who, method, route, body, options) => {
    const res = await who.send(method, route, body, options);
    answers.push({ route: `${method} ${route}`, status: res.status, text: res.text || '' });
    return res;
  };

  // ── the records, each proven by its owner ───────────────────────────────
  const projectOrg = (await one(`select "orgId"::text as org from "Project" where id = $1`, [B.id]))?.org;
  const activities = await q(`select a.id::text as id, coalesce(c.actual, 0)::text as actual
      from "Activity" a left join "CostRecord" c on c."activityId" = a.id and c."projectId" = a."projectId"
     where a."projectId" = $1 and a."isActive" = true order by a."createdAt", a.id`, [B.id]);
  const ownActivity = activities[0]?.id;
  const roomy = activities.filter((row) => Math.abs(Number(row.actual)) < 1e12);
  const engineer = await one(`select id::text as id from "User" where lower(email) = lower($1)`, [`site@${attacker.domain}`]);
  check(`setup: project ${projectKey} (${B.id}) is company ${ATTACKER}'s, with ${activities.length} active activities (${roomy.length} with room for the money sections) and its site engineer`, projectOrg === attackerOrg && ownActivity && roomy.length >= 2 && engineer?.id, JSON.stringify({ projectOrg, attackerOrg, siteWh, supplierId, engineer: engineer?.id }));

  const victimOf = async (sql) => one(sql, [victimOrg]);
  const V = {
    alert: await victimOf(`select a.id::text as id, a."projectId"::text as project from "ProcurementLeadTimeAlert" a join "Project" p on p.id = a."projectId" where p."orgId" = $1 order by a."createdAt" limit 1`),
    order: await victimOf(`select o.id::text as id from "ProcurementOrder" o join "Project" p on p.id = o."projectId" where p."orgId" = $1 order by o."createdAt" limit 1`),
    package: await victimOf(`select k.id::text as id from "ProcurementPackage" k join "Project" p on p.id = k."projectId" where p."orgId" = $1 order by k."createdAt" limit 1`),
    material: await victimOf(`select m.id::text as id from "ActivityMaterial" m join "Project" p on p.id = m."projectId" where p."orgId" = $1 order by m."createdAt" limit 1`),
    activity: await victimOf(`select a.id::text as id from "Activity" a join "Project" p on p.id = a."projectId" where p."orgId" = $1 order by a."createdAt" limit 1`),
    commitment: await victimOf(`select id::text as id from "Commitment" where "orgId" = $1 order by "createdAt" limit 1`),
    timesheet: await victimOf(`select id::text as id from "Timesheet" where "orgId" = $1 order by "createdAt" limit 1`),
    dailyReport: await victimOf(`select d.id::text as id from "DailyReport" d join "Project" p on p.id = d."projectId" where p."orgId" = $1 order by d."createdAt" limit 1`),
    costRecord: await victimOf(`select c.id::text as id from "CostRecord" c join "Project" p on p.id = c."projectId" where p."orgId" = $1 order by c.id limit 1`),
  };
  const missing = Object.entries(V).filter(([, row]) => !row).map(([key]) => key);
  check(`setup: company ${VICTIM}'s alert, order, package, material, activity, commitment, timesheet, daily report and cost record are found in the database`, missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : '');
  const victimIds = [...new Set(Object.values(V).flatMap((row) => (row ? [row.id, row.project] : [])).filter(Boolean))];
  const victimTraces = new RegExp([`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`, ...victimIds].join('|'));
  const traced = (res) => victimTraces.test(res?.text || '');

  const SKIP_FINGERPRINT = process.env.CERT_PROOF_SKIP_FINGERPRINT === '1';
  const snapshot = async () => {
    if (SKIP_FINGERPRINT) return null;
    await db.query('begin transaction isolation level repeatable read read only');
    const taken = await fingerprint.take(db);
    await db.query('rollback');
    return taken;
  };
  const before = await snapshot();
  const victimRows = async () => JSON.stringify(await q(`
      select to_jsonb(x)::text as row from "ProcurementLeadTimeAlert" x where x.id = $1
      union all select to_jsonb(x)::text from "ProcurementOrder" x where x.id = $2
      union all select to_jsonb(x)::text from "ActivityMaterial" x where x.id = $3
      union all select to_jsonb(x)::text from "Activity" x where x.id = $4
      union all select to_jsonb(x)::text from "Commitment" x where x.id = $5
      union all select to_jsonb(x)::text from "Timesheet" x where x.id = $6
      union all select to_jsonb(x)::text from "DailyReport" x where x.id = $7
      union all select to_jsonb(x)::text from "CostRecord" x where x.id = $8 order by 1`,
  [V.alert?.id, V.order?.id, V.material?.id, V.activity?.id, V.commitment?.id, V.timesheet?.id, V.dailyReport?.id, V.costRecord?.id].map((id) => id || null)));
  const victimBefore = await victimRows();

  // ── helpers over company 042's own procurement ───────────────────────────
  const alertsOf = async (packageId) => q(`select id::text as id, status, severity, reason, "daysAtRisk", "poLineId"::text as "poLineId", "orderId"::text as "orderId",
      "activityMaterialId"::text as "activityMaterialId", "expectedDeliveryDate" from "ProcurementLeadTimeAlert" where "packageId" = $1 order by "createdAt"`, [packageId]);
  /** A fresh package needed on site in 200 days: nothing about the package itself is at risk. */
  const newPackage = async (label) => {
    const made = await ask(buyer, 'POST', `${BP}/procurement/packages`, { packageNumber: `${STAMP}-${label}`, title: `Proof package ${label} ${STAMP}`, activityId: ownActivity, requiredOnSiteDate: dayOf(200), leadWeeks: 0, bufferDays: 0, notes: `Proof ${STAMP}` });
    const id = made.body?.data?.id;
    return { res: made, id, quiet: id ? (await alertsOf(id)).length === 0 : false };
  };
  /** A draft order on the package; each line { activityId?, need, promised, materialId?, qty?, unitCost? }. */
  const newOrder = async (packageId, label, lines) => {
    const made = await ask(buyer, 'POST', `${BP}/procurement/purchase-orders`, {
      supplierId, status: 'draft', ...(packageId ? { packageId } : {}), currency: 'USD', requiredBy: dayOf(lines[0]?.need ?? 30), item: `Proof ${label} ${STAMP}`, notes: `Proof ${STAMP}`,
      lines: lines.map((line, k) => ({ activityId: line.activityId || ownActivity, description: `Proof ${label} line ${k + 1} ${STAMP}`, unit: 'nr', orderedQty: line.qty || 1, unitCost: line.unitCost ?? 10, requiredDate: dayOf(line.need ?? 30), promisedDate: dayOf(line.promised ?? 20), ...(line.materialId ? { activityMaterialId: line.materialId } : {}) })),
    });
    return { res: made, id: made.body?.data?.id, lines: (made.body?.data?.lines || []).map((line) => line.id) };
  };
  const issue = async (order) => {
    const steps = [];
    for (const [step, who] of [['submit', buyer], ['approve', pm], ['issue', buyer]]) steps.push(await ask(who, 'POST', `${BP}/purchase-orders/${order.id}/${step}`, {}));
    return { ok: steps.every(ok2xx), why: steps.map(said).join(', ') };
  };
  const newMaterial = async (activityId, label, fields) => {
    const res = await ask(pm, 'POST', `${BP}/activities/${activityId}/materials`, { name: `Proof material ${label} ${STAMP}`, unit: 'PCS', qty: 1, notes: `Proof ${STAMP}`, ...fields });
    return { res, id: res.body?.data?.id };
  };
  const newActivity = async (label) => {
    const res = await ask(pm, 'POST', `${BP}/activities`, { name: `Proof activity ${label} ${STAMP}`, engineerIds: [engineer.id], startDate: dayOf(10), endDate: dayOf(40) });
    return { res, id: res.body?.data?.id };
  };
  const openList = async () => {
    const res = await ask(buyer, 'GET', `${BP}/procurement/lead-time-alerts?status=open`);
    return { res, rows: res.body?.data || [] };
  };

  // ══ 1. the cost of the recompute, against the baseline ═══════════════════
  if (runs('perf')) {
    console.log(`\n── 180 and 240 lines on one package, created, cancelled and closed; 120 and 240 received — the working tree against ${BASELINE} ──`);
    let baseline = null;
    try {
      baseline = ensureBaseline();
      check(`setup: the baseline ${BASELINE} (${baseline.sha.slice(0, 12)}) is extracted read-only to ${baseline.dir}${baseline.made ? ' (made now)' : ''}`, true);
    } catch (error) {
      check(`setup: the baseline ${BASELINE} is extracted read-only`, false, error.message);
    }
    if (baseline) {
      const plan = '180:create,cancel,close;240:create,cancel,close;120:receipt;240:receipt';
      const planned = plan.split(';').map((item) => {
        const [lines, steps] = item.split(':');
        return { lines: Number(lines), steps: steps.split(',') };
      });
      // Lines written per round: one order for create and cancel, another for close, another for a receipt.
      const linesPerRound = planned.reduce((sum, { lines, steps }) => sum + lines * (['create', 'close', 'receipt'].filter((step) => steps.includes(step)).length), 0);
      const rounds = [];
      // Interleaved, two rounds each: the best of each tree is compared, so a
      // pause of the machine in one run does not decide the comparison.
      for (let round = 0; round < 2; round += 1) {
        for (const [name, tree] of [['baseline', path.join(baseline.dir, 'backend')], ['tree', BACKEND]]) {
          const outcome = await timePlan(tree, plan);
          rounds.push({ name, round, ...outcome });
          console.log(`        ${name} round ${round + 1}: ${outcome.rows.map((row) => `${row.lines} lines ${['create', 'cancel', 'close', 'receipt'].filter((step) => row[step]).map((step) => `${step} ${row[step].status} ${row[step].ms} ms`).join(', ')}`).join(' | ') || `no timings (exit ${outcome.code}) ${outcome.tail}`}`);
        }
      }
      const runsOf = (name) => rounds.filter((row) => row.name === name);
      const measured = (name, lines, step) => runsOf(name).flatMap((run) => run.rows.filter((row) => row.lines === lines && row[step]).map((row) => row[step]));
      const best = (list) => list.filter((row) => row.status >= 200 && row.status < 300).reduce((min, row) => Math.min(min, row.ms), Infinity);
      const treeStatuses = runsOf('tree').flatMap((run) => run.rows.flatMap((row) => ['create', 'cancel', 'close', 'receipt'].filter((step) => row[step]).flatMap((step) => [row[step].status, ...(row[step].setup || [])])));
      check(`every timed request on the working tree answered (two rounds, ${linesPerRound.toLocaleString('en-US')} lines a round), and none with a 5xx`,
        runsOf('tree').every((run) => run.rows.length === planned.length) && treeStatuses.length > 0 && treeStatuses.every((status) => status < 500),
        `statuses ${[...new Set(treeStatuses)].join(', ')}${runsOf('tree').map((run) => run.tail).join(' ')}`);
      for (const lines of [180, 240]) {
        const tree = measured('tree', lines, 'create');
        const base = measured('baseline', lines, 'create');
        check(`REGRESSION: ${lines} lines on one package are created (201) — round 5 answered 500 (transaction expired) — no slower than ${BASELINE} (best of two: ${best(tree)} ms against ${best(base)} ms)`,
          tree.length === 2 && tree.every((row) => row.status === 201) && best(tree) <= best(base), JSON.stringify({ tree, base }));
        for (const step of ['cancel', 'close']) {
          const treeStep = measured('tree', lines, step);
          const baseStep = measured('baseline', lines, step);
          check(`REGRESSION: ${lines} lines ${step === 'cancel' ? 'cancelled' : 'closed short'} (200) within ${BASELINE}'s time + 100 ms — it now works the package's one alert, once (best of two: ${best(treeStep)} ms against ${best(baseStep)} ms; round 5 took 3.1 s for 120 lines)`,
            treeStep.length === 2 && treeStep.every((row) => row.status === 200) && best(treeStep) <= best(baseStep) + 100, JSON.stringify({ treeStep, baseStep }));
        }
      }
      for (const lines of [120, 240]) {
        const treeReceipt = measured('tree', lines, 'receipt');
        const baseReceipt = measured('baseline', lines, 'receipt');
        const baseAnswered = baseReceipt.filter((row) => row.status === 201).length;
        // Compared with the baseline's time where the baseline answered; where its
        // five-second window expired, answering at all is the improvement.
        check(`REGRESSION: half of each of ${lines} lines received in one delivery (201 both times; round 5 answered 500 at 120) — within 125% of ${BASELINE}'s time where ${BASELINE} answered (a delivery's time is the warehouse's own work per line, which this round does not change; the alerts' part of it is one scope read now) (best of two: ${best(treeReceipt)} ms against ${best(baseReceipt)} ms; ${BASELINE} answered ${baseReceipt.map((row) => row.said).join(', ')})`,
          treeReceipt.length === 2 && treeReceipt.every((row) => row.status === 201) && (baseAnswered === 0 || best(treeReceipt) <= best(baseReceipt) * 1.25), JSON.stringify({ treeReceipt, baseReceipt }));
      }
      // The alerts the timed runs left: one per package, on the worst line, resolved once cancelled or closed.
      const lastTree = runsOf('tree').at(-1)?.rows || [];
      const cancelledPkg = lastTree.find((row) => row.lines === 240 && row.create)?.packageId;
      const closedPkg = lastTree.find((row) => row.lines === 240 && row.close)?.close?.packageId;
      const receivedPkg = lastTree.find((row) => row.lines === 120 && row.receipt)?.receipt?.packageId;
      const [cancelledAlerts, closedAlerts, receivedAlerts] = [await alertsOf(cancelledPkg), await alertsOf(closedPkg), await alertsOf(receivedPkg)];
      check('…and the alerts are right: the cancelled 240-line order\'s package has one alert, resolved; the closed one\'s likewise; the half-delivered 120-line order\'s one alert is open, 39 days at risk on its worst line',
        cancelledAlerts.length === 1 && cancelledAlerts[0].status === 'resolved' && closedAlerts.length === 1 && closedAlerts[0].status === 'resolved' && receivedAlerts.length === 1 && receivedAlerts[0].status === 'open' && receivedAlerts[0].daysAtRisk === 39,
        JSON.stringify({ cancelledAlerts, closedAlerts, receivedAlerts }));
    }
  }

  // ══ 2. a material on a cancelled or closed order ═════════════════════════
  if (runs('settled')) {
    console.log('\n── a material ordered on an order since cancelled, or closed: no promise of anything ──');
    for (const settled of ['cancelled', 'closed']) {
      const label = settled === 'cancelled' ? 'SC' : 'SX';
      const P = await newPackage(label);
      const M = await newMaterial(ownActivity, label, { requiredDate: dayOf(30), leadWeeks: 0, bufferDays: 0, procurementPackageId: P.id });
      const quietAfterMaterial = P.id ? (await alertsOf(P.id)).length === 0 : false;
      const O = await newOrder(P.id, label, [{ need: 30, promised: 40, materialId: M.id }]);
      let rows = await alertsOf(P.id);
      check(`open state (${settled}): a fresh package, a material on it needed in 30 days (nothing at risk), ordered on a line promised 10 days late — the package's one alert is open, delivery after need`,
        P.res.status === 201 && P.quiet && M.res.status === 201 && quietAfterMaterial && O.res.status === 201 && rows.length === 1 && rows[0].status === 'open' && rows[0].reason === 'delivery_after_need' && rows[0].daysAtRisk === 10,
        `${[P.res, M.res, O.res].map(said).join(' | ')}; ${JSON.stringify(rows)}`);
      let gate;
      if (settled === 'cancelled') {
        gate = O.id ? await ask(pm, 'POST', `${BP}/purchase-orders/${O.id}/cancel`, { reason: `Proof ${STAMP}: supplier cannot deliver` }) : null;
      } else {
        const issued = await issue(O);
        const closed = O.id ? await ask(pm, 'POST', `${BP}/purchase-orders/${O.id}/close`, { force: true, reason: `Proof ${STAMP}: closed short` }) : null;
        gate = { ok: issued.ok && ok2xx(closed), why: `${issued.why}; ${said(closed)}` };
      }
      rows = await alertsOf(P.id);
      const listed = await openList();
      gated(gate, `REGRESSION: the order is ${settled} — neither its line nor the material's view of it holds the package's alert open: resolved (round 5 kept it open on the material, delivery after need on the ${settled} order's promise), and GET ?status=open does not answer it`,
        rows.length === 1 && rows[0].status === 'resolved' && listed.res.status === 200 && !listed.rows.some((row) => row.id === rows[0].id),
        `${gateSays(gate)}; ${JSON.stringify(rows)}`);
      const materials = await ask(pm, 'GET', `${BP}/activities/${ownActivity}/materials`);
      const served = (materials.body?.data || []).find((row) => row.id === M.id);
      gated(gate, `…and the material register serves the material with no promise from the ${settled} order: no expected delivery, not "delivery after need"`,
        materials.status === 200 && served && served.procurementRisk?.expectedDeliveryDate === null && served.procurementRisk?.reason !== 'delivery_after_need',
        `${said(materials)}; ${JSON.stringify(served?.procurementRisk && { reason: served.procurementRisk.reason, severity: served.procurementRisk.severity, expectedDeliveryDate: served.procurementRisk.expectedDeliveryDate })}`);
    }
  }

  // ══ 3. deleting the activity of a package's worst member ═════════════════
  let ownDelete = null;
  if (runs('delete')) {
    console.log('\n── deleting the activity of a package\'s worst line, or of its worst material ──');
    const X = await newActivity('X');
    const D = await newPackage('D');
    const OD = await newOrder(D.id, 'OD', [{ activityId: X.id, need: 5, promised: 40 }, { need: 5, promised: 10 }]);
    let rows = await alertsOf(D.id);
    check('open state: a fresh activity and a fresh package; an order on it with the worst line (35 days late) on that activity and another line 5 days late on another — the package\'s one alert is on the worst line',
      X.res.status === 201 && D.res.status === 201 && D.quiet && OD.res.status === 201 && rows.length === 1 && rows[0].status === 'open' && rows[0].poLineId === OD.lines[0] && rows[0].daysAtRisk === 35,
      `${[X.res, D.res, OD.res].map(said).join(' | ')}; ${JSON.stringify(rows)}`);
    const alertId = rows[0]?.id;
    ownDelete = X.id ? await ask(pm, 'DELETE', `${BP}/activities/${X.id}`) : null;
    rows = await alertsOf(D.id);
    const lineGone = (await one(`select count(*)::int as n from "ProcurementPoLine" where id = $1`, [OD.lines[0] || null]))?.n === 0;
    check('ALLOWED: the activity is deleted (200), and its line with it', ok2xx(ownDelete) && lineGone, said(ownDelete));
    gated(ownDelete, 'REGRESSION: the package keeps its one alert — open, worked again on the line still 5 days late (round 5: the cascade took the whole alert, and the package had none)',
      rows.length === 1 && rows[0].id === alertId && rows[0].status === 'open' && rows[0].poLineId === OD.lines[1] && rows[0].daysAtRisk === 5, JSON.stringify(rows));
    const value = await one(`select value::text as value, (select count(*)::int from "ProcurementPoLine" where "orderId" = $1) as lines from "ProcurementOrder" where id = $1`, [OD.id || null]);
    console.log(`        note (reported, not part of this round's fix): the order's stored value after its line was deleted with the activity: ${JSON.stringify(value)}`);

    // The worst member is a planned material on the deleted activity.
    const X2 = await newActivity('X2');
    const D2 = await newPackage('D2');
    const OL = await newOrder(D2.id, 'OL', [{ need: 5, promised: 10 }]);
    const M2 = X2.id ? await newMaterial(X2.id, 'D2', { requiredDate: dayOf(30), leadWeeks: 12, bufferDays: 0, procurementPackageId: D2.id }) : { res: null };
    rows = await alertsOf(D2.id);
    check('open state: a fresh package with a line 5 days late and, on a fresh activity, a planned material past its order-by date — the package\'s one alert is on the material, the worse',
      X2.res.status === 201 && D2.res.status === 201 && OL.res.status === 201 && M2.res?.status === 201 && rows.length === 1 && rows[0].status === 'open' && rows[0].activityMaterialId === M2.id,
      `${[X2.res, D2.res, OL.res, M2.res].map(said).join(' | ')}; ${JSON.stringify(rows)}`);
    const d2Alert = rows[0]?.id;
    const removed = X2.id ? await ask(pm, 'DELETE', `${BP}/activities/${X2.id}`) : null;
    rows = await alertsOf(D2.id);
    gated(removed, 'REGRESSION: that activity is deleted (200), and its material with it: the package keeps its one alert, open, back on the line 5 days late',
      rows.length === 1 && rows[0].id === d2Alert && rows[0].status === 'open' && rows[0].poLineId === OL.lines[0] && rows[0].activityMaterialId === null && rows[0].daysAtRisk === 5, `${said(removed)}; ${JSON.stringify(rows)}`);
  }

  // ══ 4. the open alert keeps its subject ══════════════════════════════════
  if (runs('subject')) {
    console.log('\n── a resolved alert gives up the link it was resolved on; the open alert has its subject ──');
    const P1 = await newPackage('T1');
    const P2 = await newPackage('T2');
    const M = await newMaterial(ownActivity, 'T', { requiredDate: dayOf(5), leadWeeks: 12, bufferDays: 0, procurementPackageId: P1.id });
    let first = await alertsOf(P1.id);
    check('open state: two fresh packages; a material on the first, past its order-by date — the first package\'s alert is open, on the material',
      P1.res.status === 201 && P2.res.status === 201 && P1.quiet && P2.quiet && M.res.status === 201 && first.length === 1 && first[0].status === 'open' && first[0].activityMaterialId === M.id,
      `${[P1.res, P2.res, M.res].map(said).join(' | ')}; ${JSON.stringify(first)}`);
    const relax = M.id ? await ask(pm, 'PATCH', `${BP}/activities/${ownActivity}/materials/${M.id}`, { requiredDate: dayOf(300) }) : null;
    first = await alertsOf(P1.id);
    check('ALLOWED: the material is needed much later (200): the first package\'s alert is resolved', ok2xx(relax) && first.length === 1 && first[0].status === 'resolved', `${said(relax)}; ${JSON.stringify(first)}`);
    const move = M.id ? await ask(pm, 'PATCH', `${BP}/activities/${ownActivity}/materials/${M.id}`, { procurementPackageId: P2.id, requiredDate: dayOf(5) }) : null;
    const second = await alertsOf(P2.id);
    first = await alertsOf(P1.id);
    gated(move, 'REGRESSION: moved to the second package and needed soon again (200): the second package\'s open alert is on the material (round 5 left it pointing at nothing), and the first\'s resolved alert has let the material go',
      second.length === 1 && second[0].status === 'open' && second[0].activityMaterialId === M.id && second[0].reason === 'order_by_missed' && first.length === 1 && first[0].status === 'resolved' && first[0].activityMaterialId === null,
      `${said(move)}; second ${JSON.stringify(second)}; first ${JSON.stringify(first)}`);
    const listed = await openList();
    const row = listed.rows.find((each) => each.id === second[0]?.id);
    gated(move, '…and GET lead-time-alerts?status=open (200) serves that alert with its material', listed.res.status === 200 && row?.activityMaterial?.id === M.id && !traced(listed.res),
      `${said(listed.res)}; ${JSON.stringify(row && { id: row.id, activityMaterialId: row.activityMaterialId, activityMaterial: row.activityMaterial?.id ?? null })}`);
  }

  // ══ 5. money totals, checked and written as one exact decimal ════════════
  if (runs('money')) {
    console.log('\n── totals of 5,000,000,000,000,000 and 4,999,999,999,999,999: checked and written as exact decimals ──');
    // A purchase order of the two.
    const orderRow = async (id) => one(`select value::text as value, subtotal::text as subtotal, "invoicedAmount"::text as invoiced, "invoiceStatus" as "invoiceStatus" from "ProcurementOrder" where id = $1`, [id || null]);
    const fits = await newOrder(null, 'MAXPO', [{ unitCost: 5000000000000000 }, { unitCost: 4999999999999999 }]);
    check('REGRESSION: an order of two lines, 5,000,000,000,000,000 and 4,999,999,999,999,999, is created (201) with its value stored to the cent — 9,999,999,999,999,999.00 (round 5 refused it: its own total, added in floating point, was 10^16)',
      fits.res.status === 201 && (await orderRow(fits.id))?.value === '9999999999999999.00', `${said(fits.res)}; ${JSON.stringify(await orderRow(fits.id))}`);
    const over = await newOrder(null, 'OVERPO', [{ unitCost: 5000000000000000 }, { unitCost: 5000000000000000 }]);
    const storedOver = await one(`select count(*)::int as n from "ProcurementOrder" where "projectId" = $1 and item = $2`, [B.id, `Proof OVERPO ${STAMP}`]);
    gated(fits.res, 'REFUSED: one of 5e15 + 5e15 does not fit — 400 PO_VALUE_TOO_LARGE, nothing stored', over.res.status === 400 && over.res.body?.error?.code === 'PO_VALUE_TOO_LARGE' && storedOver.n === 0, `${said(over.res)}; stored ${storedOver.n}`);

    // Two invoices against an order.
    const invoice = (orderId, label, amount) => ask(pm, 'POST', `${BP}/direct-costs`, { type: 'invoice', description: `Proof invoice ${label} ${STAMP}`, costDate: dayOf(0), vendorName: `Proof vendor ${STAMP}`, invoiceNumber: `${STAMP}-${label}`, purchaseOrderId: orderId, lines: [{ description: `Proof ${label}`, amount }] });
    const billed = await newOrder(null, 'BILLED', [{ unitCost: 10 }]);
    const i1 = billed.id ? await invoice(billed.id, 'I1', 5000000000000000) : null;
    const i2 = billed.id ? await invoice(billed.id, 'I2', 4999999999999999) : null;
    check('REGRESSION: two invoices against one order, 5,000,000,000,000,000 and 4,999,999,999,999,999, are recorded (201 each) — round 5 refused the second at the write, 400 VALIDATION_ERROR "a value that cannot be stored" (22003: the float sum was 10^16) — and the order\'s invoiced amount is 9,999,999,999,999,999.00 to the cent',
      billed.res.status === 201 && i1?.status === 201 && i2?.status === 201 && (await orderRow(billed.id))?.invoiced === '9999999999999999.00', `${[billed.res, i1, i2].map(said).join(' | ')}; ${JSON.stringify(await orderRow(billed.id))}`);
    const beforeI3 = JSON.stringify(await orderRow(billed.id));
    const i3 = billed.id ? await invoice(billed.id, 'I3', 1) : null;
    const storedI3 = await one(`select count(*)::int as n from "DirectCost" where "projectId" = $1 and "invoiceNumber" = $2`, [B.id, `${STAMP}-I3`]);
    gated(i2, 'REFUSED: one more invoice of 1.00 would pass what the order can record — 400 PO_INVOICED_TOO_LARGE, nothing stored, the order unchanged', i3?.status === 400 && i3.body?.error?.code === 'PO_INVOICED_TOO_LARGE' && storedI3.n === 0 && JSON.stringify(await orderRow(billed.id)) === beforeI3, `${said(i3)}; stored ${storedI3.n}`);
    const removedInvoices = [];
    for (const res of [i1, i2]) if (res?.body?.data?.id) removedInvoices.push(await ask(pm, 'DELETE', `${BP}/direct-costs/${res.body.data.id}`));
    check('cleanup: both invoices deleted (200 each): the order\'s invoiced amount is nought again', removedInvoices.length === 2 && removedInvoices.every(ok2xx) && (await orderRow(billed.id))?.invoiced === '0.00', `${removedInvoices.map(said).join(', ')}; ${JSON.stringify(await orderRow(billed.id))}`);
    for (const order of [fits, billed]) if (order.id) await ask(pm, 'POST', `${BP}/purchase-orders/${order.id}/cancel`, { reason: `Proof ${STAMP}: done` });

    // A timesheet of the two.
    const workers = [];
    for (const [n, rate] of [[5, 50000000000000], [9, 49999999999999.99]]) {
      const res = await ask(pm, 'POST', `${BP}/timesheets/workers`, { name: `Proof rate ${n} ${STAMP}`, employeeNumber: `${STAMP}-${n}`, hourlyRate: rate, overtimeMultiplier: 5, notes: `Proof ${STAMP}` });
      workers.push({ res, id: res.body?.data?.id });
    }
    const [X, Y] = [roomy[0].id, roomy[1].id];
    const actualOf = async (activityId) => (await one(`select coalesce(sum(actual), 0)::text as n from "CostRecord" where "activityId" = $1`, [activityId]))?.n;
    const xBefore = await actualOf(X);
    const yBefore = await actualOf(Y);
    const made = await ask(pm, 'POST', `${BP}/timesheets`, { date: dayOf(-4), notes: `Proof ${STAMP}`, entries: [{ workerId: workers[0].id, activityId: X, timeType: 'overtime', hours: 20 }, { workerId: workers[1].id, activityId: Y, timeType: 'overtime', hours: 20 }] });
    const sheetId = made.body?.data?.id;
    const submitted = sheetId ? await ask(pm, 'POST', `${BP}/timesheets/${sheetId}/submit`, {}) : null;
    const approved = sheetId ? await ask(pm, 'POST', `${BP}/timesheets/${sheetId}/approve`, {}) : null;
    const sheetRow = async () => one(`select status, "totalCost"::text as total from "Timesheet" where id = $1`, [sheetId || null]);
    check('REGRESSION: a timesheet whose two entries cost 5,000,000,000,000,000 and 4,999,999,999,999,999 is approved (200) — round 5 refused at the write, 400 VALIDATION_ERROR "a value that cannot be stored" (22003: the float sum was 10^16) — with its total stored to the cent, 9,999,999,999,999,999.00',
      workers.every(({ res }) => res.status === 201) && made.status === 201 && ok2xx(submitted) && ok2xx(approved) && JSON.stringify(await sheetRow()) === JSON.stringify({ status: 'approved', total: '9999999999999999.00' }),
      `${[...workers.map(({ res }) => res), made, submitted, approved].map(said).join(' | ')}; ${JSON.stringify(await sheetRow())}`);
    const reopened = sheetId ? await ask(pm, 'POST', `${BP}/timesheets/${sheetId}/reopen`, { reason: `Proof ${STAMP}: done` }) : null;
    check('cleanup: reopened (200): both activities\' actual cost read as before', ok2xx(reopened) && (await actualOf(X)) === xBefore && (await actualOf(Y)) === yBefore, `${said(reopened)}; ${xBefore} -> ${await actualOf(X)}, ${yBefore} -> ${await actualOf(Y)}`);
    for (const { id } of workers) if (id) await ask(pm, 'PATCH', `${BP}/timesheets/workers/${id}`, { status: 'inactive' });

    // Commitments on one fresh activity.
    const K = await newActivity('K');
    const committedOf = async () => (await one(`select committed::text as n from "CostRecord" where "activityId" = $1`, [K.id || null]))?.n ?? null;
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
    // The vendor: one of company 042's own vendor companies (read only).
    const vendor = await one(`select id::text as id from "Company" where "orgId" = $1 order by "isVendor" desc, "createdAt", id limit 1`, [attackerOrg]);
    const commitment = async (label, amount) => {
      const res = await ask(pm, 'POST', `${BP}/commitments`, { title: `Proof commitment ${label} ${STAMP}`, type: 'subcontract', vendorCompanyId: vendor?.id, notes: `Proof ${STAMP}`, lines: [{ description: `Proof ${label}`, activityId: K.id, amount }] });
      const id = res.body?.data?.id;
      const steps = [res];
      if (id) for (const step of ['submit', 'approve']) steps.push(await ask(pm, 'POST', `${BP}/commitments/${id}/${step}`, {}));
      return { id, ok: steps.every(ok2xx), why: steps.map(said).join(', ') };
    };
    const execute = (id) => ask(pm, 'POST', `${BP}/commitments/${id}/execute`, undefined, { form: multipart({ field: 'file', filename: `agreement-${STAMP}.pdf`, contentType: 'application/pdf', body: pdf }) });
    const statusOf = async (id) => (await one(`select status from "Commitment" where id = $1`, [id || null]))?.status;
    // Amounts a commitment line stores exactly (its own rounding is to the cent in floating point).
    const C1 = await commitment('C1', 9700000000000000);
    const e1 = C1.id ? await execute(C1.id) : null;
    check('open state: a fresh activity; a commitment of 9,700,000,000,000,000 on it is created, submitted, approved and executed (2xx each): the activity is committed to 9.7e15',
      K.res.status === 201 && C1.ok && ok2xx(e1) && (await committedOf()) === '9700000000000000.00', `${said(K.res)}; ${C1.why}; ${said(e1)}; committed ${await committedOf()}`);
    const C2 = await commitment('C2', 6000000000000000);
    const committedBefore = await committedOf();
    const e2 = C2.id ? await execute(C2.id) : null;
    gated(e1, 'REFUSED: a second of 6e15 on the same activity would take it past 10^16 — 400 COMMITTED_TOTAL_TOO_LARGE before anything is written (round 5: only at the write, the generic 400 of a numeric overflow): still approved, the activity committed as before',
      C2.ok && e2?.status === 400 && e2.body?.error?.code === 'COMMITTED_TOTAL_TOO_LARGE' && (await statusOf(C2.id)) === 'approved' && (await committedOf()) === committedBefore, `${C2.why}; ${said(e2)}; ${await statusOf(C2.id)}; committed ${await committedOf()}`);
    const C3 = await commitment('C3', 299999999999999);
    const e3 = C3.id ? await execute(C3.id) : null;
    check('REGRESSION: one of 299,999,999,999,999 is executed (200) — round 5 refused it at the write, 400 VALIDATION_ERROR (9.7e15 + it, added in floating point, was 10^16) — and the activity is committed to 9,999,999,999,999,999.00 to the cent',
      C3.ok && ok2xx(e3) && (await committedOf()) === '9999999999999999.00', `${C3.why}; ${said(e3)}; committed ${await committedOf()}`);
    const voided = C2.id ? await ask(pm, 'DELETE', `${BP}/commitments/${C2.id}`, { reason: `Proof ${STAMP}: more than the activity can record` }) : null;
    check('cleanup: the refused commitment is voided (200)', ok2xx(voided), said(voided));

    // An activity's equipment category.
    const E = await newActivity('E');
    const rec = E.id ? await ask(pm, 'POST', `${BP}/cost/activity/${E.id}`, { equipment: 9900000000000000 }) : null;
    const recordId = rec?.body?.data?.id;
    const equipmentRow = async () => one(`select equipment::text as equipment, actual::text as actual from "CostRecord" where id = $1`, [recordId || null]);
    const crane = await ask(pm, 'POST', `${BP}/equipment`, { name: `Proof crane ${STAMP}`, rateType: 'hourly', rate: 99999999999999.5 });
    const report = E.id && crane.body?.data?.id ? await ask(pm, 'POST', `${BP}/daily-reports`, { activityId: E.id, date: dayOf(0), shift: 'day', notes: `Proof ${STAMP}`, equipment: [{ equipmentId: crane.body.data.id, hours: 2 }] }) : null;
    const reportId = report?.body?.data?.id;
    const submittedReport = reportId ? await ask(pm, 'POST', `${BP}/daily-reports/${reportId}/submit`, {}) : null;
    const reportRow = async () => one(`select status, (select count(*)::int from "CostLedgerEntry" where "sourceId" = $1) as postings, (select count(*)::int from "ActivityEquipmentUsage" where "dailyReportId" = $1) as usages from "DailyReport" where id = $1`, [reportId || null]);
    check('open state: a fresh activity whose equipment cost stands at 9,900,000,000,000,000; a crane at 99,999,999,999,999.50 an hour; a daily report of two crane hours on it (199,999,999,999,999.00), submitted (2xx each)',
      E.res.status === 201 && ok2xx(rec) && (await equipmentRow())?.equipment === '9900000000000000.00' && crane.status === 201 && report?.status === 201 && ok2xx(submittedReport),
      `${[E.res, rec, crane, report, submittedReport].map(said).join(' | ')}; ${JSON.stringify(await equipmentRow())}`);
    const recBefore = JSON.stringify(await equipmentRow());
    const a1 = reportId ? await ask(pm, 'POST', `${BP}/daily-reports/${reportId}/approve`, {}) : null;
    gated(submittedReport, 'REFUSED: approving it would take the equipment cost past 10^16 — 400 COST_LEDGER_TOTAL_TOO_LARGE before anything is written (round 5: only at the write, the generic 400 of a numeric overflow): still submitted, nothing posted, no usage, the record unchanged',
      a1?.status === 400 && a1.body?.error?.code === 'COST_LEDGER_TOTAL_TOO_LARGE' && JSON.stringify(await reportRow()) === JSON.stringify({ status: 'submitted', postings: 0, usages: 0 }) && JSON.stringify(await equipmentRow()) === recBefore,
      `${said(a1)}; ${JSON.stringify(await reportRow())}; ${JSON.stringify(await equipmentRow())}`);
    const lowered = recordId ? await ask(pm, 'PATCH', `${BP}/cost/${recordId}`, { equipment: 9800000000000000 }) : null;
    const a2 = reportId ? await ask(pm, 'POST', `${BP}/daily-reports/${reportId}/approve`, {}) : null;
    check('REGRESSION: with the equipment cost at 9,800,000,000,000,000 (200) the same approval goes through (200) — round 5 refused it at the write, 400 VALIDATION_ERROR (the float sum was 10^16) — and the equipment cost moves by exactly what was posted, to 9,999,999,999,999,999.00',
      ok2xx(lowered) && ok2xx(a2) && (await equipmentRow())?.equipment === '9999999999999999.00' && (await reportRow())?.postings === 1, `${said(lowered)}; ${said(a2)}; ${JSON.stringify(await equipmentRow())}; ${JSON.stringify(await reportRow())}`);
  }

  // ══ 6. company 043's records on the same routes ══════════════════════════
  if (runs('refusals')) {
    console.log(`\n── company ${VICTIM}'s records, named by company ${ATTACKER} ──`);
    const nowhere = () => crypto.randomUUID();
    // Activity delete: gated on the own delete of section 3, or a fresh one.
    let gate = ownDelete;
    if (!gate) {
      const Z = await newActivity('Z');
      gate = Z.id ? await ask(pm, 'DELETE', `${BP}/activities/${Z.id}`) : Z.res;
    }
    const delForeign = await ask(pm, 'DELETE', `${BP}/activities/${V.activity?.id}`);
    const delNowhere = await ask(pm, 'DELETE', `${BP}/activities/${nowhere()}`);
    const victimActivityThere = (await one(`select count(*)::int as n from "Activity" where id = $1`, [V.activity?.id || null]))?.n === 1;
    gated(gate, `REFUSED: DELETE activities/{${VICTIM}'s activity} is answered exactly as an activity that exists nowhere (${said(delNowhere)}), and it is still there`, sameRefusal(delForeign, delNowhere) && victimActivityThere && !traced(delForeign), `${said(delForeign)} vs ${said(delNowhere)}`);

    const M = await newMaterial(ownActivity, 'R', { requiredDate: dayOf(90), leadWeeks: 0, bufferDays: 0 });
    const ownPatch = M.id ? await ask(pm, 'PATCH', `${BP}/activities/${ownActivity}/materials/${M.id}`, { requiredDate: dayOf(100) }) : M.res;
    const matForeign = await ask(pm, 'PATCH', `${BP}/activities/${ownActivity}/materials/${V.material?.id}`, { requiredDate: dayOf(100), procurementPackageId: null });
    const matNowhere = await ask(pm, 'PATCH', `${BP}/activities/${ownActivity}/materials/${nowhere()}`, { requiredDate: dayOf(100), procurementPackageId: null });
    gated(ownPatch, `REFUSED: PATCH materials/{${VICTIM}'s material} is answered exactly as a material that exists nowhere (${said(matNowhere)})`, sameRefusal(matForeign, matNowhere) && !traced(matForeign), `${said(matForeign)} vs ${said(matNowhere)}`);

    const own = await newOrder(null, 'RC', [{ need: 30, promised: 20 }]);
    const ownCancel = own.id ? await ask(pm, 'POST', `${BP}/purchase-orders/${own.id}/cancel`, { reason: `Proof ${STAMP}: refusal gate` }) : own.res;
    for (const step of ['cancel', 'close']) {
      const body = step === 'cancel' ? { reason: `Proof ${STAMP}` } : { force: true, reason: `Proof ${STAMP}` };
      const foreign = await ask(pm, 'POST', `${BP}/purchase-orders/${V.order?.id}/${step}`, body);
      const none = await ask(pm, 'POST', `${BP}/purchase-orders/${nowhere()}/${step}`, body);
      gated(ownCancel, `REFUSED: POST purchase-orders/{${VICTIM}'s order}/${step} is answered exactly as an order that exists nowhere (${said(none)})`, sameRefusal(foreign, none) && !traced(foreign), `${said(foreign)} vs ${said(none)}`);
    }
    const onForeignPackage = await newOrder(V.package?.id, 'XP', [{ need: 5, promised: 40 }]);
    const onNowherePackage = await newOrder(nowhere(), 'NP', [{ need: 5, promised: 40 }]);
    const storedForeign = await one(`select count(*)::int as n from "ProcurementOrder" where "projectId" = $1 and item = any($2::text[])`, [B.id, [`Proof XP ${STAMP}`, `Proof NP ${STAMP}`]]);
    gated(own.res, `REFUSED: an order on company ${VICTIM}'s package is answered as one on a package that exists nowhere (${said(onNowherePackage.res)}), and nothing is stored`, sameRefusal(onForeignPackage.res, onNowherePackage.res) && storedForeign.n === 0 && !traced(onForeignPackage.res), `${said(onForeignPackage.res)} vs ${said(onNowherePackage.res)}; stored ${storedForeign.n}`);
    const dcForeign = await ask(pm, 'POST', `${BP}/direct-costs`, { type: 'invoice', description: `Proof XI ${STAMP}`, costDate: dayOf(0), purchaseOrderId: V.order?.id, lines: [{ description: 'x', amount: 1 }] });
    const dcNowhere = await ask(pm, 'POST', `${BP}/direct-costs`, { type: 'invoice', description: `Proof NI ${STAMP}`, costDate: dayOf(0), purchaseOrderId: nowhere(), lines: [{ description: 'x', amount: 1 }] });
    const storedDc = await one(`select count(*)::int as n from "DirectCost" where "projectId" = $1 and description = any($2::text[])`, [B.id, [`Proof XI ${STAMP}`, `Proof NI ${STAMP}`]]);
    gated(own.res, `REFUSED: an invoice against company ${VICTIM}'s order is answered as one against an order that exists nowhere (${said(dcNowhere)}), and nothing is stored`, sameRefusal(dcForeign, dcNowhere) && storedDc.n === 0 && !traced(dcForeign), `${said(dcForeign)} vs ${said(dcNowhere)}; stored ${storedDc.n}`);

    const pairs = [
      ['commitments/{id}/execute', (id) => ask(pm, 'POST', `${BP}/commitments/${id}/execute`, { documentId: nowhere() }), V.commitment?.id],
      ['timesheets/{id}/approve', (id) => ask(pm, 'POST', `${BP}/timesheets/${id}/approve`, {}), V.timesheet?.id],
      ['daily-reports/{id}/approve', (id) => ask(pm, 'POST', `${BP}/daily-reports/${id}/approve`, {}), V.dailyReport?.id],
      ['cost/{id} (the equipment category)', (id) => ask(pm, 'PATCH', `${BP}/cost/${id}`, { equipment: 1 }), V.costRecord?.id],
    ];
    for (const [route, call, foreignId] of pairs) {
      const foreign = await call(foreignId);
      const none = await call(nowhere());
      gated(ownCancel, `REFUSED: ${route} on company ${VICTIM}'s record is answered exactly as one that exists nowhere (${said(none)})`, sameRefusal(foreign, none) && !traced(foreign), `${said(foreign)} vs ${said(none)}`);
    }
    const listed = await openList();
    check(`READ: GET lead-time-alerts (200) serves nothing of company ${VICTIM}`, listed.res.status === 200 && !traced(listed.res), said(listed.res));
  }

  // ── after ────────────────────────────────────────────────────────────────
  console.log('\n── after ──');
  check(`company ${VICTIM}'s alert, order, material, activity, commitment, timesheet, daily report and cost record rows are exactly as they were`, (await victimRows()) === victimBefore);
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
