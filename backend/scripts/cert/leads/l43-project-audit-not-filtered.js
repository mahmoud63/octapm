'use strict';

/**
 * L43 — Project audit history (including comment bodies) is not filtered by
 * the reader's modules or party.
 *
 * Actor: a guest of the subcontractor party of project 072-01 (audit: read is
 * in every party profile). The guest may not read change orders, IPC, cost,
 * budget, direct costs, procurement, risks or EOT, and reads commitments, pay
 * applications, RFIs and submittals of their own company only.
 *
 * The product's own rule for a record's discussion is in routes/comments.js:
 * the module's read permission AND documentTextService.recordVisibleToViewer
 * (the party rule). The audit route applies neither.
 *
 * Exit code 0 = the guest's history holds only records they may read;
 * 2 = it holds the rest of the project's.
 */

const pv = require('./lib/party-visibility');

const stamp = () => new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

// entity type → the list route of its module (the guest's status there says whether they may read it)
const MODULE_ROUTE = [
  [/^change_order/, 'change-orders'],
  [/^change_event/, 'change-events'],
  [/^ipc|^prime_contract|^retention/, 'ipc'],
  [/^cost_record|^cost_/, 'cost'],
  [/^budget_revision/, 'budget-revisions'],
  [/^budget/, 'budget'],
  [/^direct_cost/, 'direct-costs'],
  [/^procurement|^purchase_order|^long_lead|^delivery/, 'procurement/packages'],
  [/^bid|^rfq/, 'bids'],
  [/^risk/, 'risks'],
  [/^eot/, 'eot'],
  [/^ncr/, 'ncr'],
  [/^safety/, 'safety'],
];

pv.main(async () => {
  const s = await pv.setup();
  const P = s.projectId;
  const tag = stamp();

  console.log('L43 — the project history as read by a subcontractor-party guest');
  console.log(`project ${P} (072-01), guest ${s.subX.email}`);

  // ── set-up: two discussions the guest must not read ───────────────────────
  console.log('\n=== Set-up (PM): a comment on a change order; a comment on company Y\'s RFI ===');
  const orders = (await s.pm.GET(`/projects/${P}/change-orders?limit=100`)).orders || [];
  const order = orders.find((o) => Number(o.value) > 0) || orders[0];
  const coMarker = `L43-CO-${tag}: client will accept 61% of this variation, do not tell the subcontractors`;
  const coComment = await pv.show(s.pm, 'PM', 'POST', `/projects/${P}/comments`, { recordType: 'change_order', recordId: order.id, body: coMarker }, { max: 200 });
  const yRfis = (await s.subY.GET(`/projects/${P}/rfi?limit=100`)).rows || [];
  let yRfi = yRfis[0];
  if (!yRfi) yRfi = await s.subY.POST(`/projects/${P}/rfi`, { subject: 'PV L43 company Y query (cert leads)', question: 'Y only', status: 'open' });
  const rfiMarker = `L43-RFI-${tag}: note to company Y only — your claim is accepted in principle`;
  const rfiComment = await pv.show(s.pm, 'PM', 'POST', `/projects/${P}/comments`, { recordType: 'rfi', recordId: yRfi.id, body: rfiMarker }, { max: 200 });

  // ── controls: the comment routes apply the rule ───────────────────────────
  console.log('\n=== Controls: the comments route refuses the guest on both records ===');
  const c1 = await pv.show(s.subX, 'SUB-X guest', 'GET', `/projects/${P}/comments?recordType=change_order&recordId=${order.id}`, undefined, { max: 260 });
  const c2 = await pv.show(s.subX, 'SUB-X guest', 'GET', `/projects/${P}/comments?recordType=rfi&recordId=${yRfi.id}`, undefined, { max: 260 });

  // ── the history, source by source ─────────────────────────────────────────
  console.log('\n=== The guest reads GET /projects/:p/audit ===');
  const events = new Map();
  const add = (list) => list.forEach((event) => events.set(event.id, event));
  // The audit source pages by cursor; the others answer their newest and oldest hundred.
  let cursor = null;
  let pages = 0;
  for (;;) {
    const res = await s.subX.send('GET', `/projects/${P}/audit?source=audit&limit=100&order=desc${cursor ? `&cursor=${cursor}` : ''}`);
    if (res.status !== 200) {
      console.log(`> [SUB-X guest] GET /api/v1/projects/${P}/audit?source=audit → ${res.status} ${pv.short(res.body, 300)}`);
      break;
    }
    add(res.body.data.events);
    pages += 1;
    cursor = res.body.data.nextCursor;
    if (!cursor || pages >= 60) break;
  }
  console.log(`> [SUB-X guest] GET /api/v1/projects/${P}/audit?source=audit&limit=100&order=desc (+cursor) → 200, ${pages} page(s), ${events.size} audit events`);
  for (const source of ['approval', 'status', 'comment']) {
    for (const order2 of ['desc', 'asc']) {
      const res = await s.subX.send('GET', `/projects/${P}/audit?source=${source}&limit=100&order=${order2}`);
      if (res.status === 200) add(res.body.data.events);
      console.log(`> [SUB-X guest] GET /api/v1/projects/${P}/audit?source=${source}&limit=100&order=${order2} → ${res.status}, ${res.body?.data?.events?.length ?? 0} events`);
    }
  }

  // ── which of those may the guest read at the source? ──────────────────────
  const all = [...events.values()];
  const byType = new Map();
  for (const event of all) {
    const type = event.entityType || event.recordType || '(none)';
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(event);
  }
  const routeStatus = new Map();
  const probe = async (route) => {
    if (!routeStatus.has(route)) routeStatus.set(route, (await s.subX.send('GET', `/projects/${P}/${route}`)).status);
    return routeStatus.get(route);
  };
  // commitments and pay applications: per record (the vendor rule)
  const myCommitments = new Set(((await s.subX.GET(`/projects/${P}/commitments?limit=100`)).items || []).map((c) => c.id));
  const myPayApps = new Set(((await s.subX.send('GET', `/projects/${P}/pay-apps?limit=100`)).body?.data?.items || []).map((a) => a.id));
  const myRfis = new Set(((await s.subX.GET(`/projects/${P}/rfi?limit=100&includeArchived=true`)).rows || []).map((r) => r.id));
  const mySubmittals = new Set(((await s.subX.GET(`/projects/${P}/submittals?limit=100&includeArchived=true`)).rows || []).map((r) => r.id));

  console.log('\n=== Events in the guest\'s history, by record type ===');
  const unreadable = [];
  for (const [type, list] of [...byType].sort((a, b) => b[1].length - a[1].length)) {
    let verdict = 'readable or not classified';
    let hidden = 0;
    const rule = MODULE_ROUTE.find(([pattern]) => pattern.test(type));
    if (rule) {
      const status = await probe(rule[1]);
      if (status === 403) {
        hidden = list.length;
        verdict = `module refused to the guest (GET /${rule[1]} → 403)`;
      } else verdict = `GET /${rule[1]} → ${status}`;
    } else if (type === 'commitment' || type === 'sub_pay_app') {
      // The default lists hide void records the guest may still open by id, so
      // a record missing from the list is only a candidate: the detail route
      // decides whether the guest may read it.
      const [mine, route, noun] = type === 'commitment' ? [myCommitments, 'commitments', 'commitments'] : [myPayApps, 'pay-apps', 'pay applications'];
      const candidates = list.filter((e) => !mine.has(e.entityId));
      let refusedAtDetail = 0;
      for (const e of candidates) if ((await probe(`${route}/${e.entityId}`)) !== 200) refusedAtDetail += 1;
      hidden = refusedAtDetail;
      verdict = `${hidden} of ${list.length} on ${noun} the guest cannot open (${candidates.length - hidden} more are missing from the default list but open to the guest by id)`;
    } else if (type === 'rfi') {
      hidden = list.filter((e) => !myRfis.has(e.entityId)).length;
      verdict = `${hidden} of ${list.length} on RFIs not routed to the guest's company`;
    } else if (type === 'submittal') {
      hidden = list.filter((e) => !mySubmittals.has(e.entityId)).length;
      verdict = `${hidden} of ${list.length} on submittals not routed to the guest's company`;
    }
    console.log(`  ${String(list.length).padStart(4)}  ${type.padEnd(30)} ${verdict}`);
    if (hidden) unreadable.push({ type, hidden, sample: list.find((e) => e.summary && Object.keys(e.summary).length) || list[0] });
  }

  console.log('\n=== Samples from records the guest is refused at the source ===');
  const money = /value|amount|total|net|gross|retention|budget|rate|price|cost|payable|cert/i;
  for (const item of unreadable.slice(0, 14)) {
    const withMoney = (byType.get(item.type) || []).find((e) => [e.summary, e.newSummary, e.metadata].some((part) => part && Object.keys(part).some((key) => money.test(key)))) || item.sample;
    console.log(`  [${item.type}] ${withMoney.action} by ${withMoney.actorName || withMoney.actorId}: ${pv.short({ summary: withMoney.summary, newSummary: withMoney.newSummary, reason: withMoney.reason, comment: withMoney.comment }, 520)}`);
  }

  const comments = all.filter((e) => e.source === 'comment');
  const coSeen = comments.find((e) => String(e.comment || '').includes(coMarker));
  const rfiSeen = comments.find((e) => String(e.comment || '').includes(rfiMarker));
  console.log('\n=== Comment bodies ===');
  console.log(`  comments in the guest's history: ${comments.length}`);
  console.log(`  PM's comment on change order ${order.ref} (comments route: ${c1.status}): ${coSeen ? `RETURNED — "${coSeen.comment}"` : 'not returned'}`);
  console.log(`  PM's comment on company Y's RFI ${yRfi.ref} (comments route: ${c2.status}): ${rfiSeen ? `RETURNED — "${rfiSeen.comment}"` : 'not returned'}`);

  const hiddenTotal = unreadable.reduce((sum, item) => sum + item.hidden, 0);
  console.log('\nSummary');
  console.log(`  events read by the guest: ${all.length}; of records the guest is refused at the source: ${hiddenTotal} across ${unreadable.length} record type(s): ${unreadable.map((u) => `${u.type}(${u.hidden})`).join(', ')}`);
  console.log(`  set-up comments: change order ${coComment.status}, RFI ${rfiComment.status}`);

  if (hiddenTotal > 0 || coSeen || rfiSeen) {
    return pv.verdict('L43', 'CONFIRMED', `a subcontractor-party guest reads ${hiddenTotal} history events of records they are refused at the source (${unreadable.slice(0, 6).map((u) => u.type).join(', ')}…)${coSeen || rfiSeen ? ' and the full text of comments the comments route refuses them (403 / 404)' : ''}.`);
  }
  return pv.verdict('L43', 'NOT_REPRODUCED', 'the history held only records the guest may read.');
});
