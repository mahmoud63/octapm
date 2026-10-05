'use strict';

/**
 * The CERT-2 proof of the lead-time alert's semantics and of the money
 * aggregates (group alerts-money-5).
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/alerts-money-5-proof.js [attacker=042] [victim=043] [--only=alerts,ack,tax,timesheet,issue]
 *
 * ALERTS   A procurement package has one lead-time alert, and it carries the
 *          WORST open risk among every order line and material on the
 *          package. Two orders on one package, the first promised five weeks
 *          after it is needed, the second five days: the alert points at the
 *          first. The second is delivered: the alert stays open on the first
 *          (round 4 resolved it, severity none, and GET lead-time-alerts?
 *          status=open showed nothing — seen on RV4-0E5075-P). The first is
 *          delivered: resolved. A material planned on the package past its
 *          order-by date: open again, on the material. The material ordered
 *          in time: resolved. One alert for the package throughout. A planned
 *          material that is another package's worst risk is deleted: the
 *          package keeps its alert, back on its late line (the alert's link
 *          to the material cascaded, and took the whole alert with it).
 * ACK      An acknowledgement of a three-day slip; a second order eighty days
 *          late on the same package opens the alert again (round 4 kept it
 *          acknowledged). Acknowledged again, a delivery that changes nothing
 *          worse keeps it acknowledged. A cancelled order's line holds nothing
 *          open. Company 043's alert acknowledged or resolved by company 042:
 *          refused exactly as an alert that exists nowhere, and unchanged.
 * TAX      PATCH /projects/{p}/purchase-orders/{id} taxRate 100 on an order
 *          worth 9e15 answered 500 (numeric overflow): a 400 PO_VALUE_TOO_LARGE
 *          before anything is written, the order read back unchanged; a rate
 *          the value holds is accepted; company 043's order is refused like
 *          one that exists nowhere.
 * TIMESHEET A worker at the highest rate on overtime: twelve hours fit the
 *          activity once, not twice — the second approval is a 400
 *          COST_LEDGER_TOTAL_TOO_LARGE (it was a 500), nothing posted, and
 *          goes through once the first is reopened. Two such workers for a
 *          whole day on one timesheet: each entry fits, the total does not —
 *          400 TIMESHEET_TOTAL_TOO_LARGE, nothing posted.
 * ISSUE    Costly stock issued to one activity: the first issue fits, the
 *          second would take the activity's actual cost past 10^16 — a 400
 *          COST_LEDGER_TOTAL_TOO_LARGE (it was a 500), no movement, no stock
 *          moved, no cost; after a return frees the room the same issue goes
 *          through. Everything is returned and the stock adjusted away at the
 *          end, so the activity's actual cost reads as before.
 *
 * Every REFUSED check is GATED on the company's own request succeeding on the
 * same record. No answer may be a 5xx or carry anything of company 043, and
 * company 043's data must not change in any table (state fingerprint, before
 * and after). Re-runnable: every package, order, material, worker, timesheet
 * and stocked item is made fresh, through the API, by company 042's own
 * people. Exit code 0 when every check holds, 2 otherwise.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { as } = require('../lib/api');
const { buildPopulation } = require('../lib/spec');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ATTACKER = positional[0] || '042';
const VICTIM = positional[1] || '043';
const ONLY = (process.argv.find((a) => a.startsWith('--only='))?.slice(7) || 'alerts,ack,tax,timesheet,issue').split(',');
const runs = (section) => ONLY.includes(section);
const GROUP = 'alerts-money-5';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `AM5-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const INPROCESS = process.env.CERT_INPROCESS === '1';
const MONEY_MAX = 9999999999999999.99;

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
  check(`${name} [gated]`, gateHolds(gate) && ok, gateHolds(gate) ? detail : `NOT GATED — the own request on the record was not shown to succeed (${gateSays(gate)}); ${detail}`);
/** A calendar date this many days from today (UTC), as a client sends one. */
const dayOf = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

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
  const stages = JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'projects.json'), 'utf8'))[ATTACKER] || {};
  const atkInv = JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'inventory', `${ATTACKER}.json`), 'utf8'));
  const [projectKey, A] = Object.entries(atkInv.projects).find(([key, p]) => p.depth === 'standard' && stages[key]?.stage === 'active' && p.refs?.inventory?.warehouses?.site && p.refs?.inventory?.supplierId) || [];
  if (!A) throw new Error(`company ${ATTACKER} needs an active standard project with a site warehouse and a supplier`);
  const AP = `/projects/${A.id}`;
  const siteWh = A.refs.inventory.warehouses.site;
  const supplierId = A.refs.inventory.supplierId;

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
  const ask = async (who, method, route, body) => {
    const res = await who.send(method, route, body);
    answers.push({ route: `${method} ${route}`, status: res.status, text: res.text || '' });
    return res;
  };

  // ── the records, each proven by its owner ───────────────────────────────
  const ownedBy = async (sql, id) => (id ? (await one(sql, [id]))?.org : null);
  const projectOrg = await ownedBy(`select "orgId"::text as org from "Project" where id = $1`, A.id);
  const activities = await q(`select a.id::text as id, a."isCritical" as critical, coalesce(c.actual, 0)::text as actual
      from "Activity" a left join "CostRecord" c on c."activityId" = a.id and c."projectId" = a."projectId"
     where a."projectId" = $1 and a."isActive" = true order by a."createdAt", a.id`, [A.id]);
  const ownActivity = activities[0]?.id;
  // Two activities with room on them for the money sections: their actual cost is read before and after.
  const roomy = activities.filter((row) => Math.abs(Number(row.actual)) < 1e12);
  const V = {
    alert: (await one(`select a.id::text as id, a."projectId"::text as project from "ProcurementLeadTimeAlert" a join "Project" p on p.id = a."projectId" where p."orgId" = $1 order by a."createdAt" limit 1`, [victimOrg])),
    order: (await one(`select o.id::text as id, o."projectId"::text as project from "ProcurementOrder" o join "Project" p on p.id = o."projectId" where p."orgId" = $1 order by o."createdAt" limit 1`, [victimOrg])),
    package: (await one(`select k.id::text as id from "ProcurementPackage" k join "Project" p on p.id = k."projectId" where p."orgId" = $1 order by k."createdAt" limit 1`, [victimOrg])),
    timesheet: (await one(`select id::text as id from "Timesheet" where "orgId" = $1 order by "createdAt" limit 1`, [victimOrg])),
    material: (await one(`select m.id::text as id from "ActivityMaterial" m join "Project" p on p.id = m."projectId" where p."orgId" = $1 order by m."createdAt" limit 1`, [victimOrg])),
  };
  check(`setup: project ${projectKey} (${A.id}) is company ${ATTACKER}'s, with ${activities.length} active activities (${roomy.length} with room for the money sections)`, projectOrg === attackerOrg && ownActivity && roomy.length >= 2, JSON.stringify({ projectOrg, attackerOrg, siteWh, supplierId }));
  const victimAlertOrg = await ownedBy(`select p."orgId"::text as org from "ProcurementLeadTimeAlert" a join "Project" p on p.id = a."projectId" where a.id = $1`, V.alert?.id);
  const victimOrderOrg = await ownedBy(`select p."orgId"::text as org from "ProcurementOrder" o join "Project" p on p.id = o."projectId" where o.id = $1`, V.order?.id);
  const victimPackageOrg = await ownedBy(`select p."orgId"::text as org from "ProcurementPackage" k join "Project" p on p.id = k."projectId" where k.id = $1`, V.package?.id);
  check(`setup: company ${VICTIM}'s alert, order and package are proven ${VICTIM}'s from the database`, victimAlertOrg === victimOrg && victimOrderOrg === victimOrg && victimPackageOrg === victimOrg, JSON.stringify(V));

  const victimMaterialOrg = await ownedBy(`select p."orgId"::text as org from "ActivityMaterial" m join "Project" p on p.id = m."projectId" where m.id = $1`, V.material?.id);
  check(`setup: company ${VICTIM}'s material requirement is proven ${VICTIM}'s from the database`, victimMaterialOrg === victimOrg, JSON.stringify(V.material));
  const victimIds = [...new Set([V.alert?.id, V.order?.id, V.package?.id, V.timesheet?.id, V.material?.id, V.alert?.project, V.order?.project].filter(Boolean))];
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
  const victimRows = async () => JSON.stringify(await q(`select to_jsonb(a)::text as row from "ProcurementLeadTimeAlert" a where a.id = $1
      union all select to_jsonb(o)::text from "ProcurementOrder" o where o.id = $2
      union all select to_jsonb(m)::text from "ActivityMaterial" m where m.id = $3 order by 1`, [V.alert?.id || null, V.order?.id || null, V.material?.id || null]));
  const victimBefore = await victimRows();

  // ── helpers over company 042's own procurement ───────────────────────────
  const alertsOf = async (packageId) => q(`select id::text as id, status, severity, reason, "daysAtRisk", "poLineId"::text as "poLineId", "orderId"::text as "orderId",
      "activityMaterialId"::text as "activityMaterialId", "acknowledgedAt", "acknowledgedBy" from "ProcurementLeadTimeAlert" where "packageId" = $1 order by "createdAt"`, [packageId]);
  /** A fresh package needed on site in 200 days: nothing about the package itself is at risk. */
  const newPackage = async (label) => {
    const made = await ask(buyer, 'POST', `${AP}/procurement/packages`, { packageNumber: `${STAMP}-${label}`, title: `Proof package ${label} ${STAMP}`, activityId: ownActivity, requiredOnSiteDate: dayOf(200), leadWeeks: 0, bufferDays: 0, notes: `Proof ${STAMP}` });
    const id = made.body?.data?.id;
    return { res: made, id, quiet: id ? (await alertsOf(id)).length === 0 : false };
  };
  /** A planned order on the package, one line needed `need` days from today and promised `promised` days from today. */
  const newOrder = async (packageId, label, need, promised, extra = {}) => {
    const made = await ask(buyer, 'POST', `${AP}/procurement/purchase-orders`, {
      supplierId, status: 'draft', packageId, currency: 'USD', requiredBy: dayOf(need), item: `Proof ${label} ${STAMP}`, notes: `Proof ${STAMP}`,
      lines: [{ activityId: ownActivity, description: `Proof ${label} line ${STAMP}`, unit: 'nr', orderedQty: extra.qty || 1, unitCost: 10, requiredDate: dayOf(need), promisedDate: dayOf(promised), ...(extra.line || {}) }],
    });
    return { res: made, id: made.body?.data?.id, line: made.body?.data?.lines?.[0]?.id };
  };
  /** Submitted, approved, issued and delivered in full into the site store. */
  const deliver = async (order, label, qty = 1) => {
    const steps = [];
    for (const [step, who] of [['submit', buyer], ['approve', pm], ['issue', buyer]]) steps.push(await ask(who, 'POST', `${AP}/purchase-orders/${order.id}/${step}`, {}));
    steps.push(await ask(store, 'POST', '/inventory/goods-receipt', { orderId: order.id, warehouseId: siteWh, receiptNumber: `${STAMP}-${label}`, lines: [{ poLineId: order.line, acceptedQty: qty }] }));
    return { ok: steps.every(ok2xx), why: steps.map(said).join(', ') };
  };
  const openList = async () => {
    const res = await ask(buyer, 'GET', `${AP}/procurement/lead-time-alerts?status=open`);
    return { res, rows: res.body?.data || [] };
  };

  // ══ 1. one alert per package, carrying its worst risk ═════════════════════
  if (runs('alerts')) {
    console.log('\n── one package, two orders, then a material: the alert carries the worst open risk ──');
    const P = await newPackage('P');
    const o1 = await newOrder(P.id, 'O1', 5, 40);
    const o2 = await newOrder(P.id, 'O2', 5, 10);
    check('open state: a fresh package (no alert of its own) and two orders on it (201 each): order 1\'s line promised 35 days after it is needed, order 2\'s 5 days', P.res.status === 201 && P.quiet && o1.res.status === 201 && o2.res.status === 201 && o1.line && o2.line, [P.res, o1.res, o2.res].map(said).join(' | '));
    let rows = await alertsOf(P.id);
    check('the package has one alert, open, on order 1\'s line — the worse of the two (35 days), not the one changed last (5 days)',
      rows.length === 1 && rows[0].status === 'open' && rows[0].poLineId === o1.line && rows[0].orderId === o1.id && rows[0].reason === 'delivery_after_need' && rows[0].daysAtRisk === 35,
      JSON.stringify(rows));
    const alertId = rows[0]?.id;

    const d2 = await deliver(o2, 'O2-R');
    rows = await alertsOf(P.id);
    let listed = await openList();
    check('ALLOWED: order 2 is submitted, approved, issued and delivered in full (2xx each)', d2.ok, d2.why);
    gated(d2, 'REGRESSION: after order 2 is delivered the package\'s alert is still open on order 1\'s line, 35 days at risk (round 4 resolved it, severity none)',
      rows.length === 1 && rows[0].id === alertId && rows[0].status === 'open' && rows[0].severity !== 'none' && rows[0].poLineId === o1.line && rows[0].daysAtRisk === 35,
      JSON.stringify(rows));
    gated(d2, '…and GET lead-time-alerts?status=open answers it (200), on order 1\'s line',
      listed.res.status === 200 && listed.rows.some((row) => row.id === alertId && row.poLineId === o1.line && row.status === 'open') && !traced(listed.res),
      `${said(listed.res)}; ${JSON.stringify(listed.rows.filter((row) => row.packageId === P.id).map((row) => ({ id: row.id, status: row.status, poLineId: row.poLineId })))}`);
    const pkgs = await ask(buyer, 'GET', `${AP}/procurement/packages`);
    const served = (pkgs.body?.data || []).find((row) => row.id === P.id);
    gated(d2, '…and the package list serves the package with that one open alert',
      pkgs.status === 200 && served?.leadTimeAlerts?.length === 1 && served.leadTimeAlerts[0].id === alertId && served.leadTimeAlerts[0].status === 'open', `${said(pkgs)}; ${JSON.stringify(served?.leadTimeAlerts?.map((row) => ({ id: row.id, status: row.status })))}`);

    const d1 = await deliver(o1, 'O1-R');
    rows = await alertsOf(P.id);
    listed = await openList();
    check('ALLOWED: order 1 is delivered in full too (2xx each)', d1.ok, d1.why);
    gated(d1, 'nothing on the package is at risk any more: its one alert is resolved, and GET ?status=open no longer answers it',
      rows.length === 1 && rows[0].id === alertId && rows[0].status === 'resolved' && listed.res.status === 200 && !listed.rows.some((row) => row.id === alertId),
      JSON.stringify(rows));

    // A material planned on the package, past its order-by date (needed in 30 days, 12 weeks' lead).
    const material = await ask(pm, 'POST', `${AP}/activities/${ownActivity}/materials`, { name: `Proof material ${STAMP}`, unit: 'PCS', qty: 5, requiredDate: dayOf(30), leadWeeks: 12, procurementPackageId: P.id, notes: `Proof ${STAMP}` });
    const materialId = material.body?.data?.id;
    rows = await alertsOf(P.id);
    check('ALLOWED: a material is planned on the package (201)', material.status === 201 && materialId, said(material));
    gated(material, 'materials count: the package\'s one alert opens again, on the material, its order-by date missed',
      rows.length === 1 && rows[0].id === alertId && rows[0].status === 'open' && rows[0].activityMaterialId === materialId && rows[0].poLineId === null && rows[0].reason === 'order_by_missed',
      JSON.stringify(rows));
    const o3 = await newOrder(P.id, 'O3', 30, 20, { qty: 5, line: { activityMaterialId: materialId } });
    rows = await alertsOf(P.id);
    check('ALLOWED: the material is ordered on the package, promised ten days before it is needed (201)', o3.res.status === 201, said(o3.res));
    gated(o3.res, 'ordered in time: nothing on the package is at risk, and its one alert is resolved again',
      rows.length === 1 && rows[0].id === alertId && rows[0].status === 'resolved', JSON.stringify(rows));
    const holding = await q(`select id::text as id from "ProcurementLeadTimeAlert" where "projectId" = $1 and ("poLineId" = any($2::text[]) or "activityMaterialId" = $3) and id <> $4`, [A.id, [o1.line, o2.line, o3.line].filter(Boolean), materialId, alertId || '']);
    check('one alert speaks for the package: no other alert holds its lines or its material', holding.length === 0, JSON.stringify(holding));

    // A planned material is a package's worst risk, and is deleted. The alert's link to a
    // material cascades on delete: the package's whole alert went with it while its line
    // was still late.
    const D = await newPackage('D');
    const od = await newOrder(D.id, 'OD', 5, 12);
    const m2 = await ask(pm, 'POST', `${AP}/activities/${ownActivity}/materials`, { name: `Proof material D ${STAMP}`, unit: 'PCS', qty: 2, requiredDate: dayOf(30), leadWeeks: 12, procurementPackageId: D.id, notes: `Proof ${STAMP}` });
    const m2Id = m2.body?.data?.id;
    rows = await alertsOf(D.id);
    check('open state: a fresh package with a line 7 days late and a planned material past its order-by date: its one alert is on the material, the worse',
      D.res.status === 201 && D.quiet && od.res.status === 201 && m2.status === 201 && rows.length === 1 && rows[0].status === 'open' && rows[0].activityMaterialId === m2Id, JSON.stringify(rows));
    const dAlert = rows[0]?.id;
    const removed = m2Id ? await ask(pm, 'DELETE', `${AP}/activities/${ownActivity}/materials/${m2Id}`) : null;
    rows = await alertsOf(D.id);
    gated(removed, 'the material is deleted (200): the package keeps its one alert — open, back on the line that is still 7 days late (the link used to take the whole alert with it)',
      rows.length === 1 && rows[0].id === dAlert && rows[0].status === 'open' && rows[0].poLineId === od.line && rows[0].activityMaterialId === null && rows[0].daysAtRisk === 7, `${said(removed)}; ${JSON.stringify(rows)}`);
    const foreignMaterial = V.material ? await ask(pm, 'DELETE', `${AP}/activities/${ownActivity}/materials/${V.material.id}`) : null;
    const nowhereMaterial = await ask(pm, 'DELETE', `${AP}/activities/${ownActivity}/materials/${crypto.randomUUID()}`);
    gated(removed, `REFUSED: deleting company ${VICTIM}'s material is answered exactly as a material that exists nowhere (${said(nowhereMaterial)})`,
      foreignMaterial && foreignMaterial.status >= 400 && foreignMaterial.status < 500 && said(foreignMaterial) === said(nowhereMaterial) && !traced(foreignMaterial), `${said(foreignMaterial)} vs ${said(nowhereMaterial)}`);
  }

  // ══ 2. acknowledgement, cancellation, and another company's alert ═════════
  let ownAck = null;
  if (runs('ack')) {
    console.log('\n── an acknowledged risk that worsens; a cancelled order; company 043\'s alert ──');
    const Q = await newPackage('Q');
    const s1 = await newOrder(Q.id, 'S1', 5, 8);
    let rows = await alertsOf(Q.id);
    check('open state: a fresh package with one order promised 3 days late — its alert is open, 3 days at risk', Q.res.status === 201 && s1.res.status === 201 && rows.length === 1 && rows[0].status === 'open' && rows[0].daysAtRisk === 3, JSON.stringify(rows));
    const alertId = rows[0]?.id;
    ownAck = alertId ? await ask(buyer, 'PATCH', `${AP}/procurement/lead-time-alerts/${alertId}/acknowledge`, { note: `Proof ${STAMP}: known, three days` }) : null;
    rows = await alertsOf(Q.id);
    check('ALLOWED: the buyer acknowledges the three-day slip (200), and it is stored acknowledged', ok2xx(ownAck) && rows[0]?.status === 'acknowledged' && rows[0]?.acknowledgedAt, `${said(ownAck)}; ${JSON.stringify(rows)}`);
    const s2 = await newOrder(Q.id, 'S2', 5, 85);
    rows = await alertsOf(Q.id);
    gated(s2.res, 'a second order on the package promised 80 days late: the acknowledged alert opens again (round 4 kept it acknowledged), on the new line, its acknowledgement cleared',
      rows.length === 1 && rows[0].id === alertId && rows[0].status === 'open' && rows[0].poLineId === s2.line && rows[0].daysAtRisk === 80 && !rows[0].acknowledgedAt && !rows[0].acknowledgedBy,
      JSON.stringify(rows));
    const again = alertId ? await ask(buyer, 'PATCH', `${AP}/procurement/lead-time-alerts/${alertId}/acknowledge`, { note: `Proof ${STAMP}: known, eighty days` }) : null;
    const d1 = await deliver(s1, 'S1-R');
    rows = await alertsOf(Q.id);
    check('ALLOWED: acknowledged again (200), and the first order delivered (2xx each)', ok2xx(again) && d1.ok, `${said(again)}; ${d1.why}`);
    gated(d1, 'a change that does not make the risk worse keeps the acknowledgement: still acknowledged, still on the 80-day line',
      rows.length === 1 && rows[0].status === 'acknowledged' && rows[0].poLineId === s2.line && rows[0].daysAtRisk === 80, JSON.stringify(rows));

    const R = await newPackage('R');
    const c1 = await newOrder(R.id, 'C1', 5, 40);
    const before1 = await alertsOf(R.id);
    const cancel = c1.id ? await ask(pm, 'POST', `${AP}/purchase-orders/${c1.id}/cancel`, { reason: `Proof ${STAMP}: supplier cannot meet the date` }) : null;
    const after1 = await alertsOf(R.id);
    check('open state: a fresh package (no alert of its own) whose only order is 35 days late has an open alert', R.res.status === 201 && R.quiet && c1.res.status === 201 && before1.length === 1 && before1[0].status === 'open', JSON.stringify(before1));
    gated(cancel, 'the order is cancelled (200): its line will deliver nothing, and the package\'s alert is resolved', after1.length === 1 && after1[0].status === 'resolved', `${said(cancel)}; ${JSON.stringify(after1)}`);

    // Company 043's alert, by company 042's buyer: exactly as an alert that exists nowhere.
    const nowhere = crypto.randomUUID();
    for (const action of ['acknowledge', 'resolve']) {
      const foreign = V.alert ? await ask(buyer, 'PATCH', `${AP}/procurement/lead-time-alerts/${V.alert.id}/${action}`, { note: `Proof ${STAMP}` }) : null;
      const none = await ask(buyer, 'PATCH', `${AP}/procurement/lead-time-alerts/${nowhere}/${action}`, { note: `Proof ${STAMP}` });
      gated(ownAck, `REFUSED: PATCH lead-time-alerts/{${VICTIM}'s alert}/${action} is answered exactly as an alert that exists nowhere (${said(none)}), nothing of ${VICTIM} in the answer`,
        foreign && foreign.status === 404 && said(foreign) === said(none) && !traced(foreign), `${said(foreign)} vs ${said(none)}`);
      // …and in company 043's own project route, from company 042: the project is not 042's.
      const viaTheirs = V.alert ? await ask(buyer, 'PATCH', `/projects/${V.alert.project}/procurement/lead-time-alerts/${V.alert.id}/${action}`, { note: `Proof ${STAMP}` }) : null;
      const viaNowhere = await ask(buyer, 'PATCH', `/projects/${crypto.randomUUID()}/procurement/lead-time-alerts/${nowhere}/${action}`, { note: `Proof ${STAMP}` });
      gated(ownAck, `REFUSED: …through company ${VICTIM}'s own project route too, exactly as a project that exists nowhere (${said(viaNowhere)})`,
        viaTheirs && viaTheirs.status >= 400 && viaTheirs.status < 500 && said(viaTheirs) === said(viaNowhere) && !traced(viaTheirs), `${said(viaTheirs)} vs ${said(viaNowhere)}`);
    }
    const foreignLine = V.package ? await newOrder(V.package.id, 'XP', 5, 40) : null;
    const nowhereLine = await newOrder(crypto.randomUUID(), 'NP', 5, 40);
    const storedForeign = await one(`select count(*)::int as n from "ProcurementOrder" o join "Project" p on p.id = o."projectId" where p."orgId" = $1 and o.item = any($2::text[])`, [attackerOrg, [`Proof XP ${STAMP}`, `Proof NP ${STAMP}`]]);
    gated(Q.res.status === 201 && s1.res.status === 201 ? { ok: true } : { ok: false, why: said(s1.res) }, `REFUSED: an order on company ${VICTIM}'s package is answered as one on a package that exists nowhere (${said(nowhereLine.res)}), and nothing is stored`,
      foreignLine && foreignLine.res.status >= 400 && foreignLine.res.status < 500 && said(foreignLine.res) === said(nowhereLine.res) && storedForeign.n === 0 && !traced(foreignLine.res), `${said(foreignLine?.res)} vs ${said(nowhereLine.res)}; stored ${storedForeign.n}`);
    const listed = await openList();
    check(`READ: GET lead-time-alerts (200) serves nothing of company ${VICTIM}`, listed.res.status === 200 && !traced(listed.res), said(listed.res));
  }

  // ══ 3. an order's value after an edit ═════════════════════════════════════
  if (runs('tax')) {
    console.log('\n── PATCH an order\'s tax rate: its value fits the column ──');
    const made = await ask(buyer, 'POST', `${AP}/procurement/purchase-orders`, {
      supplierId, status: 'draft', currency: 'USD', requiredBy: dayOf(30), item: `Proof big ${STAMP}`, notes: `Proof ${STAMP}`,
      lines: [{ activityId: ownActivity, description: `Proof big line ${STAMP}`, unit: 'nr', orderedQty: 90_000_000_000, unitCost: 100000 }],
    });
    const bigId = made.body?.data?.id;
    const orderRow = async (id) => one(`select "taxRate"::text as rate, subtotal::text as subtotal, "taxAmount"::text as tax, value::text as value, "updatedAt" from "ProcurementOrder" where id = $1`, [id]);
    check('open state: a fresh draft order worth 9e15 (201)', made.status === 201 && bigId && (await orderRow(bigId))?.value === '9000000000000000.00', `${said(made)}; ${JSON.stringify(await orderRow(bigId))}`);
    const ten = bigId ? await ask(buyer, 'PATCH', `${AP}/purchase-orders/${bigId}`, { taxRate: 10 }) : null;
    const atTen = await orderRow(bigId);
    check('ALLOWED: PATCH taxRate 10 (200) — the value 9.9e15 fits, and is stored', ok2xx(ten) && atTen?.rate === '10' && atTen?.value === '9900000000000000.00', `${said(ten)}; ${JSON.stringify(atTen)}`);
    const tries = [];
    for (const taxRate of [100, '100', 12]) tries.push({ taxRate, res: bigId ? await ask(buyer, 'PATCH', `${AP}/purchase-orders/${bigId}`, { taxRate }) : null });
    const afterTries = await orderRow(bigId);
    gated(ten, 'REFUSED: PATCH taxRate 100 (and "100", and 12) on it is a 400 PO_VALUE_TOO_LARGE — it was a 500 — and the order reads back exactly as before',
      tries.every(({ res }) => res?.status === 400 && res.body?.error?.code === 'PO_VALUE_TOO_LARGE') && JSON.stringify(afterTries) === JSON.stringify(atTen),
      `${tries.map(({ taxRate, res }) => `${JSON.stringify(taxRate)}: ${said(res)}`).join(' | ')}; ${JSON.stringify(afterTries)}`);
    const eleven = bigId ? await ask(buyer, 'PATCH', `${AP}/purchase-orders/${bigId}`, { taxRate: 11 }) : null;
    check('ALLOWED: taxRate 11 — 9.99e15, just under the column — is accepted (200) and stored', ok2xx(eleven) && (await orderRow(bigId))?.value === '9990000000000000.00', `${said(eleven)}; ${JSON.stringify(await orderRow(bigId))}`);
    const small = await newOrder(null, 'TAX', 30, 20);
    const fraction = small.id ? await ask(buyer, 'PATCH', `${AP}/purchase-orders/${small.id}`, { taxRate: 7.5, notes: `Proof ${STAMP}: taxed` }) : null;
    check('ALLOWED: an ordinary order taxed at 7.5 (200): 10.00 + 0.75', ok2xx(fraction) && (await orderRow(small.id))?.value === '10.75', `${said(fraction)}; ${JSON.stringify(await orderRow(small.id))}`);
    const foreign = V.order ? await ask(buyer, 'PATCH', `${AP}/purchase-orders/${V.order.id}`, { taxRate: 100 }) : null;
    const none = await ask(buyer, 'PATCH', `${AP}/purchase-orders/${crypto.randomUUID()}`, { taxRate: 100 });
    gated(ten, `REFUSED: PATCH company ${VICTIM}'s order is answered exactly as an order that exists nowhere (${said(none)})`, foreign && foreign.status === 404 && said(foreign) === said(none) && !traced(foreign), `${said(foreign)} vs ${said(none)}`);
    // Cleared away: a cancelled order is out of every order value.
    const cancelled = bigId ? await ask(pm, 'POST', `${AP}/purchase-orders/${bigId}/cancel`, { reason: `Proof ${STAMP}: done` }) : null;
    check('cleanup: the 9e15 order is cancelled (200)', ok2xx(cancelled), said(cancelled));
  }

  // ══ 4. a timesheet's labour cost ═════════════════════════════════════════
  if (runs('timesheet')) {
    console.log('\n── timesheets at the highest rate: what fits the activity, and the timesheet ──');
    const RATE_MAX = 83333333333333;
    const workers = [];
    for (const n of [1, 2]) {
      const res = await ask(pm, 'POST', `${AP}/timesheets/workers`, { name: `Proof top rate ${n} ${STAMP}`, employeeNumber: `${STAMP}-${n}`, hourlyRate: RATE_MAX, overtimeMultiplier: 5, notes: `Proof ${STAMP}` });
      workers.push({ res, id: res.body?.data?.id });
    }
    check(`open state: two fresh workers at the highest rate (${RATE_MAX.toLocaleString('en-US')}/h), overtime ×5 (201 each)`, workers.every(({ res, id }) => res.status === 201 && id), workers.map(({ res }) => said(res)).join(' | '));
    const X = roomy[0].id;
    const Y = roomy[1].id;
    const actualOf = async (activityId) => (await one(`select coalesce(sum(actual), 0)::text as n from "CostRecord" where "activityId" = $1`, [activityId]))?.n;
    const ledgerOf = async (sheetId) => Number((await one(`select count(*)::int as n from "CostLedgerEntry" where "sourceId" = $1`, [sheetId]))?.n || 0);
    const sheetRow = async (id) => one(`select status, "totalCost"::text as total from "Timesheet" where id = $1`, [id]);
    const sheet = async (date, entries) => {
      const made = await ask(pm, 'POST', `${AP}/timesheets`, { date, notes: `Proof ${STAMP}`, entries });
      const id = made.body?.data?.id;
      const submitted = id ? await ask(pm, 'POST', `${AP}/timesheets/${id}/submit`, {}) : null;
      return { id, ok: made.status === 201 && ok2xx(submitted), why: `${said(made)}; ${said(submitted)}` };
    };
    const xBefore = await actualOf(X);
    const yBefore = await actualOf(Y);
    // Twelve hours at the highest rate on overtime: 4,999,999,999,999,980 — fits once on top of what X has spent, not twice.
    const t1 = await sheet(dayOf(-3), [{ workerId: workers[0].id, activityId: X, timeType: 'overtime', hours: 12 }]);
    const t2 = await sheet(dayOf(-2), [{ workerId: workers[1].id, activityId: X, timeType: 'overtime', hours: 12 }]);
    check('open state: two timesheets, each twelve hours at the highest rate on overtime on the same activity, are created and submitted', t1.ok && t2.ok, `${t1.why} | ${t2.why}`);
    const a1 = t1.id ? await ask(pm, 'POST', `${AP}/timesheets/${t1.id}/approve`, {}) : null;
    const xAfter1 = await actualOf(X);
    check('ALLOWED: the first is approved (200) and its labour posted to the activity', ok2xx(a1) && Number(xAfter1) > 4.9e15 && (await ledgerOf(t1.id)) === 1, `${said(a1)}; actual ${xBefore} -> ${xAfter1}`);
    const a2 = t2.id ? await ask(pm, 'POST', `${AP}/timesheets/${t2.id}/approve`, {}) : null;
    gated(a1, 'REFUSED: the second would take the activity\'s actual cost past 10^16 — a 400 COST_LEDGER_TOTAL_TOO_LARGE (it was a 500): still submitted, nothing on the ledger, the activity unchanged',
      a2?.status === 400 && a2.body?.error?.code === 'COST_LEDGER_TOTAL_TOO_LARGE' && (await sheetRow(t2.id))?.status === 'submitted' && (await ledgerOf(t2.id)) === 0 && (await actualOf(X)) === xAfter1,
      `${said(a2)}; ${JSON.stringify(await sheetRow(t2.id))}; actual ${await actualOf(X)}`);
    const r1 = t1.id ? await ask(pm, 'POST', `${AP}/timesheets/${t1.id}/reopen`, { reason: `Proof ${STAMP}: room for the second` }) : null;
    const a2again = t2.id ? await ask(pm, 'POST', `${AP}/timesheets/${t2.id}/approve`, {}) : null;
    check('ALLOWED: once the first is reopened (its cost reversed), the same second approval goes through (200)', ok2xx(r1) && ok2xx(a2again) && (await sheetRow(t2.id))?.status === 'approved', `${said(r1)}; ${said(a2again)}`);
    const r2 = t2.id ? await ask(pm, 'POST', `${AP}/timesheets/${t2.id}/reopen`, { reason: `Proof ${STAMP}: done` }) : null;
    check('cleanup: the second reopened too (200): the activity\'s actual cost reads as before the proof', ok2xx(r2) && (await actualOf(X)) === xBefore, `${said(r2)}; ${xBefore} -> ${await actualOf(X)}`);

    // Two such workers for a whole day: each entry (9,999,999,999,999,960) fits; the timesheet's total does not.
    const t3 = await sheet(dayOf(-1), workers.map(({ id }) => ({ workerId: id, activityId: Y, timeType: 'overtime', hours: 24 })));
    const a3 = t3.id ? await ask(pm, 'POST', `${AP}/timesheets/${t3.id}/approve`, {}) : null;
    gated(a1, 'REFUSED: two workers at the highest rate on overtime for a whole day — each entry fits, the timesheet\'s total does not — a 400 TIMESHEET_TOTAL_TOO_LARGE (it was a 500): still submitted, nothing on the ledger, the activity unchanged',
      t3.ok && a3?.status === 400 && a3.body?.error?.code === 'TIMESHEET_TOTAL_TOO_LARGE' && (await sheetRow(t3.id))?.status === 'submitted' && (await sheetRow(t3.id))?.total === '0.00' && (await ledgerOf(t3.id)) === 0 && (await actualOf(Y)) === yBefore,
      `${t3.why}; ${said(a3)}; ${JSON.stringify(await sheetRow(t3.id))}; actual ${yBefore} -> ${await actualOf(Y)}`);
    const back = t3.id ? await ask(pm, 'POST', `${AP}/timesheets/${t3.id}/reject`, { reason: `Proof ${STAMP}: more than a timesheet can record` }) : null;
    check('cleanup: that timesheet is returned (200)', ok2xx(back), said(back));
    const foreign = V.timesheet ? await ask(pm, 'POST', `${AP}/timesheets/${V.timesheet.id}/approve`, {}) : null;
    const none = await ask(pm, 'POST', `${AP}/timesheets/${crypto.randomUUID()}/approve`, {});
    gated(a1, `REFUSED: approving company ${VICTIM}'s timesheet is answered exactly as a timesheet that exists nowhere (${said(none)})`, foreign && foreign.status === 404 && said(foreign) === said(none) && !traced(foreign), `${said(foreign)} vs ${said(none)}`);
    for (const { id } of workers) if (id) await ask(pm, 'PATCH', `${AP}/timesheets/workers/${id}`, { status: 'inactive' });
  }

  // ══ 5. stock issued to an activity ════════════════════════════════════════
  if (runs('issue')) {
    console.log('\n── costly stock issued to one activity: what fits its actual cost ──');
    const Z = roomy[roomy.length > 2 ? 2 : 0].id;
    const UNIT = 99_999_999_999_999;
    const item = await ask(pm, 'POST', '/inventory/items', { sku: `${STAMP}-BIG`, name: `Proof costly item ${STAMP}`, unit: 'nr', notes: `Proof ${STAMP}` });
    const itemId = item.body?.data?.id;
    const received = [];
    for (let i = 0; i < 2; i += 1) received.push(itemId ? await ask(store, 'POST', '/inventory/stock/receive', { itemId, warehouseId: siteWh, quantity: 99, unitCost: UNIT, reference: `Proof ${STAMP}` }) : null);
    check('open state: a fresh item, 99 received twice at 99,999,999,999,999 (each receipt 9.9e15, 201 each)', item.status === 201 && received.every(ok2xx), [item, ...received].map(said).join(' | '));
    const actualOf = async () => (await one(`select coalesce(sum(actual), 0)::text as n from "CostRecord" where "activityId" = $1`, [Z]))?.n;
    const stockOf = async () => JSON.stringify(await one(`select (select count(*)::int from "StockTransaction" where "itemId" = $1) as movements, (select coalesce(sum("onHand"), 0)::float8 from "StockBalance" where "itemId" = $1) as "onHand", (select count(*)::int from "CostLedgerEntry" e join "StockTransaction" t on t.id = e."sourceId" where t."itemId" = $1) as postings`, [itemId]));
    const issue = () => ask(store, 'POST', '/inventory/stock/issue', { itemId, warehouseId: siteWh, quantity: 99, projectId: A.id, activityId: Z, reference: `Proof issue ${STAMP}` });
    const giveBack = () => ask(store, 'POST', '/inventory/stock/return', { itemId, warehouseId: siteWh, quantity: 99, projectId: A.id, activityId: Z, reference: `Proof return ${STAMP}` });
    const zBefore = await actualOf();
    const first = itemId ? await issue() : null;
    const zAfter1 = await actualOf();
    check('ALLOWED: the first issue of 99 to the activity (201) posts 9,899,999,999,999,901 to its actual cost', ok2xx(first) && Number(zAfter1) - Number(zBefore) > 9.8e15, `${said(first)}; ${zBefore} -> ${zAfter1}`);
    const stockBefore = await stockOf();
    const second = itemId ? await issue() : null;
    gated(first, 'REFUSED: the second would take the activity past 10^16 — a 400 COST_LEDGER_TOTAL_TOO_LARGE (it was a 500): no movement, no stock moved, no cost, the activity unchanged',
      second?.status === 400 && second.body?.error?.code === 'COST_LEDGER_TOTAL_TOO_LARGE' && (await stockOf()) === stockBefore && (await actualOf()) === zAfter1,
      `${said(second)}; ${stockBefore} -> ${await stockOf()}; actual ${await actualOf()}`);
    const returned = itemId ? await giveBack() : null;
    const again = itemId ? await issue() : null;
    check('ALLOWED: after a return frees the room (201) the same issue goes through (201)', ok2xx(returned) && ok2xx(again), `${said(returned)}; ${said(again)}`);
    const returnedAgain = itemId ? await giveBack() : null;
    // Taken out in two movements: one of 198 would itself be worth more than a movement can record.
    const adjusted = [];
    for (let i = 0; i < 2; i += 1) adjusted.push(itemId ? await ask(store, 'POST', '/inventory/stock/adjust', { itemId, warehouseId: siteWh, quantity: -99, notes: `Proof ${STAMP}: the costly stock is taken back out` }) : null);
    check('cleanup: returned (201) and the stock adjusted away (201 each): the activity\'s actual cost reads as before, nothing of the item on hand',
      ok2xx(returnedAgain) && adjusted.every(ok2xx) && (await actualOf()) === zBefore && JSON.parse(await stockOf()).onHand === 0, `${said(returnedAgain)}; ${adjusted.map(said).join(', ')}; ${zBefore} -> ${await actualOf()}; ${await stockOf()}`);
  }

  // ── after ────────────────────────────────────────────────────────────────
  console.log('\n── after ──');
  check(`company ${VICTIM}'s alert, order and material rows are exactly as they were`, (await victimRows()) === victimBefore);
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
