'use strict';

/**
 * The live proof of the CERT-2 "hidden by own state" pairs of bids, purchase
 * order receipts and change-event RFQs: each field may name only the caller's
 * own project's / organisation's record, judged on a record that is OPEN —
 * in the state where the request is legitimately accepted.
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/procurement-rfq-state-proof.js [attacker=042] [victim=043]
 *
 * The CERT-2 foreign-reference sweep re-sent each company's own accepted
 * writes with one id swapped for another company's, but for these pairs every
 * attempt was refused by the attacker's OWN record state (409
 * BID_PACKAGE_LOCKED, RECEIPT_ALREADY_POSTED, CHANGE_EVENT_LOCKED) or billing
 * (402) before the product looked at the foreign id
 * (C:/Temp/octapm-cert/scratch/gap-pairs.json):
 *   POST  /projects/{p}/bids/{pkg}/lines/from-boq          boqItemIds[]                 (boq_item)
 *   PATCH /projects/{p}/bids/{pkg}/lines/{lineId}          activityId | costCodeId | budgetLineId
 *   POST  /projects/{p}/bids/{pkg}/invitations             invitations[].vendorCompanyId (company)
 *   POST  /projects/{p}/bids/{pkg}/award                   bidId                        (bid)
 *   POST  /projects/{p}/procurement/purchase-orders/{o}/receipts  lines[].poLineId     (procurement_po_line)
 *   POST  /projects/{p}/change-events/{ce}/rfqs            recipients[].vendorCompanyId (company)
 *   POST  /projects/{p}/change-events/{ce}/rfqs            lineIds[]                    (change_event_line)
 *
 * For each pair, on a fresh record of the attacker's own put into the accepting
 * state through the API (a draft package, a published package with a
 * submitted bid, an issued purchase order, an open change event):
 *   ALLOWED  the attacker company's own id is accepted (2xx) and stored;
 *   REFUSED  the victim company's id is refused with a 4xx (never a 5xx),
 *            exactly as an id that exists nowhere is (status, code, message),
 *            nothing names it afterwards, and the answer does not carry it;
 *   IGNORED  (a list filtered by project) the victim's id is dropped exactly
 *            as an id that exists nowhere is, and nothing names it;
 *   STILL    the record still accepts the attacker's own id afterwards.
 * The receipt's victim purchase-order line must not even be row-locked by the
 * attempt (its xmax is read before and after). One field outside the group's
 * pairs on the same request, the receipt's dailyReportId, is proven too.
 *
 * No answer (and no e-mail) may carry the victim's ids, names, addresses or
 * canaries, no answer may be a 5xx, and the victim company's data must not
 * change in any table (fingerprint, restricted to the victim).
 *
 * Exit code 0 when every check holds, 2 otherwise. Re-runnable: every record
 * is fresh and carries this run's stamp.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { as, raw } = require('../lib/api');
const { buildPopulation } = require('../lib/spec');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');

const GROUP = 'procurement-rfq';
const ATTACKER = process.argv[2] || '042';
const VICTIM = process.argv[3] || '043';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `PRS-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const INPROCESS = process.env.CERT_INPROCESS === '1';
const results = [];
const answers = [];
let currentPair = 'setup';
const check = (name, ok, detail = '') => {
  results.push({ pair: currentPair, name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const said = (res) => `${res.status} ${res.body?.error?.code || ''} ${res.body?.error?.message || ''}`.trim();
const ok2xx = (res) => res.status >= 200 && res.status < 300;
const is4xx = (res) => res.status >= 400 && res.status < 500;
const nowhere = () => crypto.randomUUID();
const future = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
const first = (map) => Object.values(map || {})[0] || null;

// In process, the product's local e-mail transport writes each message to the
// console: every one is kept (and out of the proof's output) so it can be
// searched for the victim's traces.
const emails = [];
const print = console.log.bind(console);
console.log = (...args) => {
  const text = args.map(String).join(' ');
  if (text.startsWith('[email:local]')) {
    emails.push(text);
    return;
  }
  print(...args);
};

const OWNER_SQL = {
  BoqItem: 'select o.slug from "BoqItem" t join "Project" p on p.id = t."projectId" join "Organisation" o on o.id = p."orgId" where t.id = $1',
  Activity: 'select o.slug from "Activity" t join "Project" p on p.id = t."projectId" join "Organisation" o on o.id = p."orgId" where t.id = $1',
  BudgetLine: 'select o.slug from "BudgetLine" t join "Organisation" o on o.id = t."orgId" where t.id = $1',
  CostCode: 'select o.slug from "CostCode" t join "Organisation" o on o.id = t."orgId" where t.id = $1',
  Company: 'select o.slug from "Company" t join "Organisation" o on o.id = t."orgId" where t.id = $1',
  Bid: 'select o.slug from "Bid" t join "Organisation" o on o.id = t."orgId" where t.id = $1',
  ProcurementPoLine: 'select o.slug from "ProcurementPoLine" t join "Project" p on p.id = t."projectId" join "Organisation" o on o.id = p."orgId" where t.id = $1',
  ChangeEventLine: 'select o.slug from "ChangeEventLine" t join "Organisation" o on o.id = t."orgId" where t.id = $1',
  DailyReport: 'select o.slug from "DailyReport" t join "Project" p on p.id = t."projectId" join "Organisation" o on o.id = p."orgId" where t.id = $1',
};

const main = async () => {
  console.log(`${GROUP} state proof — attacker ${ATTACKER}, victim ${VICTIM}, stamp ${STAMP}${INPROCESS ? ', in process (the working tree\'s code)' : ' — NOT in process: this asks a running API, which does not run the working tree\'s code'}\n`);
  const { companies } = buildPopulation();
  const attacker = companies.find((c) => c.code === ATTACKER);
  const victim = companies.find((c) => c.code === VICTIM);
  if (!attacker || !victim) throw new Error(`unknown company ${ATTACKER} or ${VICTIM}`);
  const inventory = (code) => JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'inventory', `${code}.json`), 'utf8'));
  const standard = (inv) => Object.values(inv.projects).find((p) => p.depth === 'standard' && p.refs?.activities && p.refs?.boq && p.refs?.budgetLines && p.refs?.inventory?.warehouses);
  const atkInv = inventory(ATTACKER);
  const vicInv = inventory(VICTIM);
  const A = standard(atkInv);
  const V = standard(vicInv);
  if (!A || !V) throw new Error('both companies need a standard project with BOQ, activities, budget lines and warehouses');
  const AP = `/projects/${A.id}`;

  const db = await guard.connectCert();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => (await q(sql, args))[0] || null;
  const count = async (sql, args = []) => Number((await one(sql, args))?.n || 0);
  const orgOf = async (code) => (await one('select id from "Organisation" where slug like $1', [`cert-${code}-%`]))?.id;
  const attackerOrg = await orgOf(ATTACKER);
  const victimOrg = await orgOf(VICTIM);
  const ownerOf = async (table, id) => {
    const slug = (await one(OWNER_SQL[table], [id]))?.slug || null;
    return /^cert-(\d{3})-/.exec(slug || '')?.[1] || (slug || 'nowhere');
  };

  const actors = {};
  const actor = (role) => {
    if (!actors[role]) {
      const session = as(`${role}@${attacker.domain}`);
      actors[role] = {
        send: async (method, route, body) => {
          const res = await session.send(method, route, body);
          answers.push({ route: `${role} ${method} ${route}`, status: res.status, text: res.text || '' });
          return res;
        },
      };
    }
    return actors[role];
  };
  const pm = actor('pm');
  const procurement = actor('procurement');
  const warehouse = actor('warehouse');
  const portal = async (method, route, json) => {
    const res = await raw(method, route, { json });
    answers.push({ route: `portal ${method} ${route.replace(/bids\/[^/]+/, 'bids/<token>')}`, status: res.status, text: res.text || '' });
    return res;
  };
  const must = (res, what) => {
    if (!ok2xx(res)) throw new Error(`setup ${what}: ${said(res)} ${(res.text || '').slice(0, 300)}`);
    return res.body?.data;
  };

  // ── the ids: the attacker's own and the victim's, each proven by its owner ──
  const activeBoq = async (projectId) => (await q('select id from "BoqItem" where "projectId" = $1 and "isActive" and "supersededAt" is null order by "sortOrder", code limit 2', [projectId])).map((r) => r.id);
  const [ownBoq1, ownBoq2] = await activeBoq(A.id);
  const [foreignBoq] = await activeBoq(V.id);
  const ids = {
    BoqItem: { own: ownBoq1, foreign: foreignBoq },
    Activity: { own: first(A.refs.activities), foreign: first(V.refs.activities) },
    CostCode: { own: first(atkInv.company.refs.costCodes), foreign: first(vicInv.company.refs.costCodes) },
    BudgetLine: { own: first(A.refs.budgetLines), foreign: first(V.refs.budgetLines) },
    Company: { own: atkInv.company.refs.directory.supplier, foreign: vicInv.company.refs.directory.supplier },
    Bid: { own: null, foreign: (await one('select id from "Bid" where "orgId" = $1 order by "createdAt" limit 1', [victimOrg]))?.id },
    ProcurementPoLine: { own: null, foreign: (await one('select l.id from "ProcurementPoLine" l join "Project" p on p.id = l."projectId" where p."orgId" = $1 order by l."createdAt" limit 1', [victimOrg]))?.id },
    ChangeEventLine: { own: null, foreign: (await one('select id from "ChangeEventLine" where "orgId" = $1 order by "createdAt" limit 1', [victimOrg]))?.id },
    DailyReport: { own: (await one('select id from "DailyReport" where "projectId" = $1 order by date desc limit 1', [A.id]))?.id, foreign: (await one('select d.id from "DailyReport" d join "Project" p on p.id = d."projectId" where p."orgId" = $1 order by d.date desc limit 1', [victimOrg]))?.id },
  };
  for (const [table, pair] of Object.entries(ids)) {
    const foreignOwner = await ownerOf(table, pair.foreign);
    const ownOwner = pair.own ? await ownerOf(table, pair.own) : ATTACKER;
    check(`setup: ${table} ${pair.foreign} is company ${VICTIM}'s${pair.own ? ` and ${pair.own} is company ${ATTACKER}'s` : ''}`, foreignOwner === VICTIM && ownOwner === ATTACKER, `owners ${ownOwner} / ${foreignOwner}`);
  }
  check(`setup: a second own BOQ item of project ${A.id}`, Boolean(ownBoq2) && (await ownerOf('BoqItem', ownBoq2)) === ATTACKER);
  const foreignIds = Object.values(ids).map((pair) => pair.foreign).filter(Boolean);
  const ownSupplier = A.refs.inventory.supplierId;
  const ownWarehouse = A.refs.inventory.warehouses.site;

  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const printOf = await fingerprint.take(db);
    await db.query('rollback');
    return printOf;
  };
  const before = await snapshot();
  console.log(`\nattacker project ${A.id}, victim project ${V.id}\n`);

  /** A refused foreign id: 4xx, the same answer as an id that exists nowhere, not echoed. */
  const refusedLikeNowhere = (label, bad, none, foreign) => {
    check(`${label}: company ${VICTIM}'s id is refused with a 4xx, not a 5xx`, is4xx(bad), said(bad));
    check(`${label}: …exactly as an id that exists nowhere (status, code, message)`, said(bad) === said(none) && is4xx(none), `${said(bad)} | ${said(none)}`);
    check(`${label}: …and the answer does not carry the victim's id`, !(bad.text || '').includes(foreign), (bad.text || '').slice(0, 300));
  };

  // ════ bid package 1: a DRAFT package (lines from the BOQ, invitations) ═══════
  const p1 = must(await pm.send('POST', `${AP}/bids`, { title: `Proof ${STAMP} draft`, dueAt: future(21) }), 'draft bid package');
  const linesOf = async (packageId) => q('select id, "boqItemId", "activityId", "costCodeId", "budgetLineId" from "BidPackageLine" where "packageId" = $1 order by "lineNumber"', [packageId]);
  check(`setup: bid package ${p1.ref} is a draft`, p1.status === 'draft', p1.status);

  // ── POST .../lines/from-boq [boqItemIds[]] ────────────────────────────────
  currentPair = 'from-boq boqItemIds[]';
  {
    const label = 'from-boq boqItemIds[]';
    const ok = await procurement.send('POST', `${AP}/bids/${p1.id}/lines/from-boq`, { boqItemIds: [ownBoq1] });
    const afterOwn = await linesOf(p1.id);
    check(`${label}: the company's own BOQ item is accepted (2xx) and stored as a line`, ok2xx(ok) && afterOwn.some((l) => l.boqItemId === ownBoq1), `${said(ok)}; lines ${afterOwn.map((l) => l.boqItemId).join(',')}`);
    const namesForeignBefore = await count('select count(*)::int n from "BidPackageLine" where "orgId" = $1 and "boqItemId" = $2', [attackerOrg, foreignBoq]);
    const bad = await procurement.send('POST', `${AP}/bids/${p1.id}/lines/from-boq`, { boqItemIds: [foreignBoq] });
    const afterBad = await linesOf(p1.id);
    const none = await procurement.send('POST', `${AP}/bids/${p1.id}/lines/from-boq`, { boqItemIds: [nowhere()] });
    const afterNone = await linesOf(p1.id);
    const shape = (res) => `${said(res)} lines=${(res.body?.data?.lines || []).map((l) => l.boqItemId).join(',')}`;
    check(`${label}: company ${VICTIM}'s BOQ item is not a 5xx`, bad.status < 500, said(bad));
    check(`${label}: …is answered exactly as a BOQ item that exists nowhere (status, code, message, lines)`, shape(bad) === shape(none), `${shape(bad)} | ${shape(none)}`);
    check(`${label}: …nothing stored (no line added, none names it)`, afterBad.length === afterOwn.length && afterNone.length === afterOwn.length
      && (await count('select count(*)::int n from "BidPackageLine" where "orgId" = $1 and "boqItemId" = $2', [attackerOrg, foreignBoq])) === namesForeignBefore,
      `lines ${afterOwn.length} -> ${afterBad.length} -> ${afterNone.length}`);
    check(`${label}: …and the answer does not carry the victim's id`, !(bad.text || '').includes(foreignBoq));
    // STILL: the draft still takes the company's own item, beside the foreign one (dropped).
    const mixed = await procurement.send('POST', `${AP}/bids/${p1.id}/lines/from-boq`, { boqItemIds: [ownBoq2, foreignBoq] });
    const afterMixed = await linesOf(p1.id);
    check(`${label}: the draft still accepts the company's own item (beside the victim's, which is dropped)`, ok2xx(mixed) && afterMixed.some((l) => l.boqItemId === ownBoq2) && !afterMixed.some((l) => l.boqItemId === foreignBoq), `${said(mixed)}; lines ${afterMixed.map((l) => l.boqItemId).join(',')}`);
  }

  // ── POST .../invitations [invitations[].vendorCompanyId] ──────────────────
  currentPair = 'invitations vendorCompanyId';
  {
    const label = 'invitations[].vendorCompanyId';
    const { own, foreign } = ids.Company;
    const email = (tag) => `${tag}.${STAMP.toLowerCase()}@bidders.${attacker.domain}`;
    const invite = (vendorCompanyId, tag, extra = {}) => procurement.send('POST', `${AP}/bids/${p1.id}/invitations`, { invitations: [{ vendorCompanyId, contactName: `Proof estimator ${STAMP}`, contactEmail: email(tag) }], ...extra });
    const invitationsNaming = (id) => count('select count(*)::int n from "BidInvitation" where "orgId" = $1 and "vendorCompanyId" = $2', [attackerOrg, id]);
    const ok = await invite(own, 'own');
    const ownRow = await one('select * from "BidInvitation" where "packageId" = $1 and "contactEmail" = $2', [p1.id, email('own')]);
    check(`${label}: the company's own (prequalified) directory vendor is accepted (201) and stored`, ok.status === 201 && ownRow?.vendorCompanyId === own, `${said(ok)}; stored ${ownRow?.vendorCompanyId ?? 'nothing'}`);
    const namingBefore = await invitationsNaming(foreign);
    // As the sweep sent it (no prequalification override) …
    const bad = await invite(foreign, 'foreign');
    const none = await invite(nowhere(), 'nowhere');
    refusedLikeNowhere(label, bad, none, foreign);
    // … and with a prequalification override reason, past that gate.
    const badOverride = await invite(foreign, 'foreign-override', { prequalOverrideReason: `Proof ${STAMP}` });
    const noneOverride = await invite(nowhere(), 'nowhere-override', { prequalOverrideReason: `Proof ${STAMP}` });
    refusedLikeNowhere(`${label} (with a prequalification override)`, badOverride, noneOverride, foreign);
    const stray = await count('select count(*)::int n from "BidInvitation" where "packageId" = $1 and "contactEmail" like $2', [p1.id, `%nowhere%${STAMP.toLowerCase()}%`]) + await count('select count(*)::int n from "BidInvitation" where "packageId" = $1 and "contactEmail" like $2', [p1.id, `foreign%${STAMP.toLowerCase()}%`]);
    check(`${label}: …nothing stored (no invitation names it, no refused invitation exists)`, (await invitationsNaming(foreign)) === namingBefore && stray === 0, `naming ${namingBefore} -> ${await invitationsNaming(foreign)}; refused rows ${stray}`);
    const again = await invite(own, 'own-again');
    check(`${label}: the draft still accepts the company's own vendor`, again.status === 201, said(again));
  }

  // ════ bid package 2: PUBLISHED (open) with a submitted bid ═══════════════════
  currentPair = 'setup';
  const p2 = must(await pm.send('POST', `${AP}/bids`, { title: `Proof ${STAMP} open`, dueAt: future(21) }), 'open bid package');
  must(await pm.send('POST', `${AP}/bids/${p2.id}/lines`, { description: `Proof line ${STAMP}`, qty: 10, unit: 'm', estimateRate: 5 }), 'bid line');
  const p2Line = (await linesOf(p2.id))[0];
  const bidderEmail = `bidder.${STAMP.toLowerCase()}@bidders.${attacker.domain}`;
  const [invitation] = must(await pm.send('POST', `${AP}/bids/${p2.id}/invitations`, { invitations: [{ vendorCompanyId: ids.Company.own, contactName: 'Proof bidder', contactEmail: bidderEmail }] }), 'invitation').items;
  must(await pm.send('POST', `${AP}/bids/${p2.id}/publish`, {}), 'publish');
  const resent = must(await pm.send('POST', `${AP}/bids/${p2.id}/invitations/${invitation.id}/resend`, {}), 'resend invitation');
  const token = /\/bid\/([A-Za-z0-9_-]+)/.exec(resent.portalUrl || '')?.[1];
  if (!token) throw new Error('setup: no portal link on the resent invitation');
  must(await portal('PUT', `/public/bids/${token}/bid`, { lines: [{ packageLineId: p2Line.id, rate: 12, included: true }], notes: `Proof ${STAMP}` }), 'price the bid');
  must(await portal('POST', `/public/bids/${token}/bid/submit`, { submittedBy: 'Proof estimator' }), 'submit the bid');
  const ownBid = await one('select id, status from "Bid" where "invitationId" = $1', [invitation.id]);
  ids.Bid.own = ownBid?.id;
  const p2Row = async () => one('select status, "softAwardBidId" from "BidPackage" where id = $1', [p2.id]);
  check(`setup: bid package ${p2.ref} is open with a submitted bid ${ownBid?.id}`, (await p2Row())?.status === 'open' && ownBid?.status === 'submitted', JSON.stringify({ pkg: await p2Row(), bid: ownBid }));

  // ── PATCH .../lines/{lineId} [activityId | costCodeId | budgetLineId] ─────
  for (const [field, table, code] of [['activityId', 'Activity', 'ACTIVITY_NOT_FOUND'], ['costCodeId', 'CostCode', 'COST_CODE_NOT_FOUND'], ['budgetLineId', 'BudgetLine', 'BUDGET_LINE_NOT_FOUND']]) {
    currentPair = `bid line PATCH ${field}`;
    const label = `bid line PATCH ${field} (open package)`;
    const { own, foreign } = ids[table];
    const route = `${AP}/bids/${p2.id}/lines/${p2Line.id}`;
    const stored = async () => (await one(`select "${field}" v from "BidPackageLine" where id = $1`, [p2Line.id]))?.v ?? null;
    const ok = await pm.send('PATCH', route, { [field]: own });
    check(`${label}: the company's own ${table} is accepted (200) and stored`, ok.status === 200 && (await stored()) === own, `${said(ok)}; stored ${await stored()}`);
    const bad = await pm.send('PATCH', route, { [field]: foreign });
    const afterBad = await stored();
    const none = await pm.send('PATCH', route, { [field]: nowhere() });
    refusedLikeNowhere(label, bad, none, foreign);
    check(`${label}: …answered as the route's own 404 ${code}`, bad.status === 404 && bad.body?.error?.code === code, said(bad));
    check(`${label}: …nothing stored (the line keeps its own; no line names it)`, afterBad === own && (await stored()) === own
      && (await count(`select count(*)::int n from "BidPackageLine" where "orgId" = $1 and "${field}" = $2`, [attackerOrg, foreign])) === 0, `line now ${await stored()}`);
    const again = await pm.send('PATCH', route, { [field]: own, qty: 11 });
    check(`${label}: the open package still accepts the company's own ${table}`, again.status === 200, said(again));
  }

  // ── POST .../award [bidId] ────────────────────────────────────────────────
  currentPair = 'award bidId';
  {
    const label = 'award bidId';
    const { own, foreign } = ids.Bid;
    const ok = await pm.send('POST', `${AP}/bids/${p2.id}/award`, { bidId: own });
    check(`${label}: the package's own submitted bid is accepted (200) and stored as the soft award`, ok.status === 200 && (await p2Row())?.softAwardBidId === own, `${said(ok)}; ${JSON.stringify(await p2Row())}`);
    const bad = await pm.send('POST', `${AP}/bids/${p2.id}/award`, { bidId: foreign });
    const afterBad = await p2Row();
    const none = await pm.send('POST', `${AP}/bids/${p2.id}/award`, { bidId: nowhere() });
    refusedLikeNowhere(label, bad, none, foreign);
    check(`${label}: …nothing stored (the package keeps its own soft award; none names it)`, afterBad?.softAwardBidId === own && (await p2Row())?.softAwardBidId === own
      && (await count('select count(*)::int n from "BidPackage" where "orgId" = $1 and ("softAwardBidId" = $2 or "awardedBidId" = $2)', [attackerOrg, foreign])) === 0, JSON.stringify(await p2Row()));
    const again = await pm.send('POST', `${AP}/bids/${p2.id}/award`, { bidId: own });
    check(`${label}: the package still accepts its own bid`, again.status === 200, said(again));
  }

  // ════ an ISSUED purchase order: goods receipts ═══════════════════════════════
  currentPair = 'setup';
  const item = `Proof ${STAMP} receipt order`;
  must(await pm.send('POST', `${AP}/procurement/purchase-orders`, { item, status: 'draft', supplierId: ownSupplier, requiredBy: future(30).slice(0, 10), lines: [{ activityId: ids.Activity.own, description: `Proof ${STAMP} material`, unit: 'nr', orderedQty: 10, unitCost: 5 }] }), 'purchase order');
  const order = await one('select id, ref from "ProcurementOrder" where "projectId" = $1 and item = $2', [A.id, item]);
  for (const step of ['submit', 'approve', 'issue']) must(await pm.send('POST', `${AP}/purchase-orders/${order.id}/${step}`, {}), `order ${step}`);
  const ownPoLine = (await one('select id from "ProcurementPoLine" where "orderId" = $1', [order.id]))?.id;
  ids.ProcurementPoLine.own = ownPoLine;
  const orderRow = async () => one('select status from "ProcurementOrder" where id = $1', [order.id]);
  check(`setup: purchase order ${order.ref} is issued with line ${ownPoLine}`, (await orderRow())?.status === 'issued' && Boolean(ownPoLine), JSON.stringify(await orderRow()));

  const receiptsRoute = `${AP}/procurement/purchase-orders/${order.id}/receipts`;
  const receipt = (tag, lines, extra = {}) => warehouse.send('POST', receiptsRoute, { receiptNumber: `${STAMP}-${tag}`, warehouseId: ownWarehouse, receivedBy: 'Proof gate clerk', lines, ...extra });
  const receiptRow = async (tag) => one('select id, "dailyReportId" from "DeliveryReceipt" where "projectId" = $1 and "receiptNumber" = $2', [A.id, `${STAMP}-${tag}`]);
  const ownLineState = async () => one('select "receivedQty"::text r from "ProcurementPoLine" where id = $1', [ownPoLine]);

  // ── POST .../receipts [lines[].poLineId] ──────────────────────────────────
  currentPair = 'receipts poLineId';
  {
    const label = 'receipts lines[].poLineId';
    const foreign = ids.ProcurementPoLine.foreign;
    const ok = await receipt('OWN', [{ poLineId: ownPoLine, acceptedQty: 1 }]);
    const ownReceipt = await receiptRow('OWN');
    const ownStored = ownReceipt ? await one('select "poLineId" from "DeliveryReceiptLine" where "receiptId" = $1', [ownReceipt.id]) : null;
    check(`${label}: the order's own line is accepted (201) and stored on the receipt`, ok.status === 201 && ownStored?.poLineId === ownPoLine, `${said(ok)}; stored ${ownStored?.poLineId ?? 'nothing'}`);
    const namingBefore = await count('select count(*)::int n from "DeliveryReceiptLine" where "projectId" = $1 and "poLineId" = $2', [A.id, foreign]);
    const xmaxOf = async () => (await one('select xmax::text x from "ProcurementPoLine" where id = $1', [foreign]))?.x;
    const xmaxBefore = await xmaxOf();
    const bad = await receipt('FOREIGN', [{ poLineId: foreign, acceptedQty: 1 }]);
    const xmaxAfter = await xmaxOf();
    const none = await receipt('NOWHERE', [{ poLineId: nowhere(), acceptedQty: 1 }]);
    refusedLikeNowhere(label, bad, none, foreign);
    const qtyBefore = (await ownLineState())?.r;
    const mixed = await receipt('MIXED', [{ poLineId: ownPoLine, acceptedQty: 1 }, { poLineId: foreign, acceptedQty: 1 }]);
    check(`${label}: …a receipt naming it beside the order's own line is refused the same way`, said(mixed) === said(none), `${said(mixed)} | ${said(none)}`);
    check(`${label}: …nothing stored (no receipt for the refused notes, no receipt line names it, the own line did not move)`,
      !(await receiptRow('FOREIGN')) && !(await receiptRow('NOWHERE')) && !(await receiptRow('MIXED'))
        && (await count('select count(*)::int n from "DeliveryReceiptLine" where "projectId" = $1 and "poLineId" = $2', [A.id, foreign])) === namingBefore
        && (await ownLineState())?.r === qtyBefore,
      `receipts ${Boolean(await receiptRow('FOREIGN'))}/${Boolean(await receiptRow('NOWHERE'))}/${Boolean(await receiptRow('MIXED'))}; own line ${qtyBefore} -> ${(await ownLineState())?.r}`);
    check(`${label}: …and company ${VICTIM}'s purchase-order line was not even row-locked by the attempt`, xmaxBefore === xmaxAfter, `xmax ${xmaxBefore} -> ${xmaxAfter}`);
    const again = await receipt('OWN-AGAIN', [{ poLineId: ownPoLine, acceptedQty: 1 }]);
    check(`${label}: the issued order still accepts a receipt of its own line`, again.status === 201, said(again));
  }

  // ── outside the group's pairs: the same request's dailyReportId ───────────
  currentPair = 'receipts dailyReportId (outside the group)';
  {
    const label = 'receipts dailyReportId';
    const { own, foreign } = ids.DailyReport;
    const ok = await receipt('DR-OWN', [{ poLineId: ownPoLine, acceptedQty: 1 }], { dailyReportId: own });
    check(`${label}: the project's own daily report is accepted (201) and stored`, ok.status === 201 && (await receiptRow('DR-OWN'))?.dailyReportId === own, `${said(ok)}; stored ${(await receiptRow('DR-OWN'))?.dailyReportId ?? 'nothing'}`);
    const namingBefore = await count('select count(*)::int n from "DeliveryReceipt" where "projectId" = $1 and "dailyReportId" = $2', [A.id, foreign]);
    const bad = await receipt('DR-FOREIGN', [{ poLineId: ownPoLine, acceptedQty: 1 }], { dailyReportId: foreign });
    const badRow = await receiptRow('DR-FOREIGN');
    const none = await receipt('DR-NOWHERE', [{ poLineId: ownPoLine, acceptedQty: 1 }], { dailyReportId: nowhere() });
    refusedLikeNowhere(label, bad, none, foreign);
    check(`${label}: …nothing stored (no receipt for the refused notes; none names it)`, !badRow && !(await receiptRow('DR-NOWHERE'))
      && (await count('select count(*)::int n from "DeliveryReceipt" where "projectId" = $1 and "dailyReportId" = $2', [A.id, foreign])) === namingBefore,
      badRow ? `STORED: DeliveryReceipt ${badRow.id} (company ${ATTACKER}) .dailyReportId = ${badRow.dailyReportId} -> DailyReport of company ${await ownerOf('DailyReport', badRow.dailyReportId)}` : '');
  }

  // ════ an OPEN change event: RFQs ═════════════════════════════════════════════
  currentPair = 'setup';
  const event = must(await pm.send('POST', `${AP}/change-events`, { title: `Proof ${STAMP} change`, type: 'other', lines: [{ description: `Proof ${STAMP} scope A`, quantity: 2, unit: 'm', unitCost: 10 }, { description: `Proof ${STAMP} scope B`, quantity: 1, unit: 'nr', unitCost: 50 }] }), 'change event');
  const [ownCeLine] = (await q('select id from "ChangeEventLine" where "changeEventId" = $1 order by "sortOrder"', [event.id])).map((r) => r.id);
  ids.ChangeEventLine.own = ownCeLine;
  check(`setup: change event ${event.ref} is open with line ${ownCeLine}`, event.status === 'open' && Boolean(ownCeLine), event.status);
  const rfqRoute = `${AP}/change-events/${event.id}/rfqs`;
  const rfqEmail = (tag) => `rfq.${tag}.${STAMP.toLowerCase()}@parties.${attacker.domain}`;
  const rfqRow = async (tag) => one('select id, "vendorCompanyId", "lineIdsJson" from "Rfq" where "changeEventId" = $1 and "contactEmail" = $2', [event.id, rfqEmail(tag)]);
  const sendRfq = (tag, recipient, extra = {}) => procurement.send('POST', rfqRoute, { recipients: [{ companyName: `Proof vendor ${tag}`, contactName: 'Proof estimator', contactEmail: rfqEmail(tag), ...recipient }], dueDate: future(14).slice(0, 10), instructions: `Proof ${STAMP}`, ...extra });

  // ── POST .../rfqs [recipients[].vendorCompanyId] ──────────────────────────
  currentPair = 'rfqs recipients[].vendorCompanyId';
  {
    const label = 'rfqs recipients[].vendorCompanyId';
    const { own, foreign } = ids.Company;
    const ok = await sendRfq('own', { vendorCompanyId: own }, { lineIds: [ownCeLine] });
    const ownRow = await rfqRow('own');
    check(`${label}: the company's own directory vendor is accepted (201) and stored`, ok.status === 201 && ownRow?.vendorCompanyId === own, `${said(ok)}; stored ${ownRow?.vendorCompanyId ?? 'nothing'}`);
    const namingBefore = await count('select count(*)::int n from "Rfq" where "orgId" = $1 and "vendorCompanyId" = $2', [attackerOrg, foreign]);
    const bad = await sendRfq('foreign', { vendorCompanyId: foreign });
    const badRow = await rfqRow('foreign');
    const none = await sendRfq('nowhere', { vendorCompanyId: nowhere() });
    refusedLikeNowhere(label, bad, none, foreign);
    check(`${label}: …nothing stored (no RFQ for the refused recipient; none names it)`, !badRow && !(await rfqRow('nowhere'))
      && (await count('select count(*)::int n from "Rfq" where "orgId" = $1 and "vendorCompanyId" = $2', [attackerOrg, foreign])) === namingBefore,
      badRow ? `STORED: Rfq ${badRow.id} (company ${ATTACKER}) .vendorCompanyId = ${badRow.vendorCompanyId} -> Company of company ${await ownerOf('Company', badRow.vendorCompanyId)}` : '');
    const again = await sendRfq('own-again', { vendorCompanyId: own });
    check(`${label}: the change event still accepts the company's own vendor`, again.status === 201, said(again));
  }

  // ── POST .../rfqs [lineIds[]] ─────────────────────────────────────────────
  currentPair = 'rfqs lineIds[]';
  {
    const label = 'rfqs lineIds[]';
    const { own, foreign } = ids.ChangeEventLine;
    const ok = await sendRfq('lines-own', {}, { lineIds: [own] });
    const ownRow = await rfqRow('lines-own');
    check(`${label}: the event's own line is accepted (201) and stored on the RFQ`, ok.status === 201 && JSON.stringify(ownRow?.lineIdsJson) === JSON.stringify([own]), `${said(ok)}; stored ${JSON.stringify(ownRow?.lineIdsJson ?? null)}`);
    const namingBefore = await count('select count(*)::int n from "Rfq" where "orgId" = $1 and "lineIdsJson"::text like $2', [attackerOrg, `%${foreign}%`]);
    const bad = await sendRfq('lines-foreign', {}, { lineIds: [foreign] });
    const none = await sendRfq('lines-nowhere', {}, { lineIds: [nowhere()] });
    const shape = (res) => `${said(res)} lineIds=${JSON.stringify(res.body?.data?.rfqs?.[0]?.lineIds ?? null)}`;
    check(`${label}: company ${VICTIM}'s line is not a 5xx`, bad.status < 500, said(bad));
    check(`${label}: …is answered exactly as a line that exists nowhere (status, code, message, lines sent)`, shape(bad) === shape(none), `${shape(bad)} | ${shape(none)}`);
    const badRow = await rfqRow('lines-foreign');
    const noneRow = await rfqRow('lines-nowhere');
    check(`${label}: …nothing stored names it (the RFQ, if any, carries no foreign line)`, JSON.stringify(badRow?.lineIdsJson ?? null) === JSON.stringify(noneRow?.lineIdsJson ?? null)
      && !JSON.stringify(badRow?.lineIdsJson ?? '').includes(foreign)
      && (await count('select count(*)::int n from "Rfq" where "orgId" = $1 and "lineIdsJson"::text like $2', [attackerOrg, `%${foreign}%`])) === namingBefore,
      `stored ${JSON.stringify(badRow?.lineIdsJson ?? null)} | ${JSON.stringify(noneRow?.lineIdsJson ?? null)}`);
    check(`${label}: …and the answer does not carry the victim's id`, !(bad.text || '').includes(foreign));
    const again = await sendRfq('lines-own-again', {}, { lineIds: [own] });
    check(`${label}: the change event still accepts its own line`, again.status === 201, said(again));
  }

  // ── after ────────────────────────────────────────────────────────────────
  currentPair = 'whole run';
  const victimTraces = new RegExp([`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`, victimOrg, ...foreignIds].join('|'));
  const leaked = answers.filter((a) => victimTraces.test(a.text));
  check(`no answer to company ${ATTACKER} carries company ${VICTIM}'s ids, names, addresses or canaries`, leaked.length === 0, leaked.slice(0, 6).map((a) => `${a.status} ${a.route} -> ${(a.text.match(victimTraces) || [])[0]}`).join('\n        '));
  const mailed = emails.filter((text) => victimTraces.test(text));
  check(`no e-mail carries company ${VICTIM}'s ids, names, addresses or canaries (${emails.length} e-mails sent)`, mailed.length === 0, mailed.slice(0, 3).map((t) => t.slice(0, 200)).join('\n        '));
  const errors = answers.filter((a) => a.status >= 500);
  check('no answer is a server error', errors.length === 0, errors.slice(0, 6).map((a) => `${a.status} ${a.route} ${(a.text || '').slice(0, 160)}`).join('\n        '));
  const after = await snapshot();
  const moved = fingerprint.compare(before, after).filter((c) => !c.noise && c.org === VICTIM);
  check(`company ${VICTIM}'s data did not change (every table)`, moved.length === 0, moved.slice(0, 8).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
  await db.end();

  const byPair = new Map();
  for (const r of results) {
    const entry = byPair.get(r.pair) || { passed: 0, failed: 0 };
    entry[r.ok ? 'passed' : 'failed'] += 1;
    byPair.set(r.pair, entry);
  }
  console.log('\nper pair:');
  for (const [pair, entry] of byPair) console.log(`  ${entry.failed ? 'FAIL' : 'ok  '}  ${pair}: ${entry.passed} passed, ${entry.failed} failed`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${GROUP} state proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
