'use strict';

/**
 * Proof for the "audit-customfields-assistant" group â€” certification findings
 * L43, X-PARTY-1, L45 and L46 (one company's own project; a role or a party
 * guest reaching what its role / party must not).
 *
 * Every guard is shown twice: the refusal of the caller the record is not
 * theirs, AND the same request answered for the caller it belongs to â€” so a
 * fix that turned into a blanket refusal fails here too.
 *
 *   G1  L43  a party guest's project history holds only records the guest may read
 *   G2  L43  comment bodies in the history follow the comments route's rule
 *   G3  L43  a company role's history leaves out the modules the role may not read
 *   G4  X-PARTY-1  every source of the history pages to its end, each event once
 *   G5  L45  custom-field values only for a record of the route's project
 *   G6  L45  custom-field values only for a record the party's own rule admits
 *   G7  L46  the organisation assistant decides project access before anything else
 *
 * Stage: company 072 â€” project 072-01 and its party guests SUB-X and SUB-Y
 * (scripts/cert/leads/lib/party-visibility.js); site@c072 (site engineer on
 * 072-01); james.rojas.9@c072 (site engineer NOT on 072-01, on other 072
 * projects). Run in process:
 *
 *   $env:CERT_INPROCESS = "1"; node scripts/cert/isolation/audit-customfields-assistant-proof.js [--only=G1,G4]
 *
 * Exit 0 = every refusal and every allowed case holds; 2 = a refusal failed
 * (a defect is present); 3 = only an allowed case failed (over-blocking);
 * 1 = the script itself failed.
 */

const fs = require('fs');
const path = require('path');
const pv = require('../leads/lib/party-visibility');

const ONLY = (process.argv.find((arg) => arg.startsWith('--only=')) || '').slice('--only='.length).split(',').filter(Boolean);
const wants = (...guards) => !ONLY.length || guards.some((guard) => ONLY.includes(guard));
const stamp = () => new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const results = [];

const check = (guard, kind, label, pass, detail = '') => {
  results.push({ guard, kind, label, pass: Boolean(pass), detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${guard} ${kind.padEnd(7)} ${label}${detail ? ` â€” ${detail}` : ''}`);
};
const said = (res) => `${res.status} ${res.body?.error?.code || ''}`.trim();
const data = (res) => res.body?.data;
const items = (res) => (Array.isArray(data(res)) ? data(res) : data(res)?.items || data(res)?.rows || data(res)?.orders || []);

const OUTSIDER = `james.rojas.9@c${pv.CODE}.octapm-cert.test`;
const SITE = `site@c${pv.CODE}.octapm-cert.test`;
const FIELD_KEY = 'cert_aca_probe';
const MAX_PAGES = 120;

/** Every event of a history query, following nextCursor; stops (and says so) when a page repeats. */
const pageAll = async (who, base) => {
  const seen = new Map();
  let cursor = null;
  let pages = 0;
  let duplicates = 0;
  let looped = false;
  let status = 200;
  const cursors = new Set();
  for (;;) {
    const res = await who.send('GET', `${base}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    status = res.status;
    if (res.status !== 200) break;
    pages += 1;
    for (const event of data(res).events || []) {
      if (seen.has(event.id)) duplicates += 1;
      seen.set(event.id, event);
    }
    cursor = data(res).nextCursor;
    if (!cursor) break;
    if (cursors.has(cursor) || pages >= MAX_PAGES) {
      looped = true;
      break;
    }
    cursors.add(cursor);
  }
  return { events: [...seen.values()], pages, duplicates, looped, status };
};

// entity type â†’ the list route of its module (the caller's status there says whether they may read it)
const MODULE_ROUTE = [
  [/^change_order/, 'change-orders'],
  [/^change_event/, 'change-events'],
  [/^ipc|^prime_contract|^retention|^sub_valuation/, 'ipc'],
  [/^cost_record|^burn_rate|^activity_equipment/, 'cost'],
  [/^budget_revision/, 'budget-revisions'],
  [/^budget/, 'budget'],
  [/^direct_cost/, 'direct-costs'],
  [/^procurement|^purchase_order|^long_lead|^delivery|^activity_material/, 'procurement/packages'],
  [/^bid|^rfq/, 'bids'],
  [/^risk/, 'risks'],
  [/^eot|^weather_delay/, 'eot'],
  [/^ncr|^itp|^defect|^material_test/, 'ncr'],
  [/^safety/, 'safety'],
];
// record types read by record (the party / vendor rule): their detail route
const DETAIL_ROUTE = { rfi: 'rfi', submittal: 'submittals', commitment: 'commitments', sub_pay_app: 'pay-apps', submittal_package: 'submittals/packages' };

/** Which events of `events` the caller is refused at the source (module list route, or the record's own detail route). */
const refusedAtSource = async ({ who, P, events }) => {
  const moduleStatus = new Map();
  const recordStatus = new Map();
  const moduleOf = async (route) => {
    if (!moduleStatus.has(route)) moduleStatus.set(route, (await who.send('GET', `/projects/${P}/${route}`)).status);
    return moduleStatus.get(route);
  };
  const recordOf = async (type, id) => {
    const key = `${type}:${id}`;
    if (!recordStatus.has(key)) recordStatus.set(key, (await who.send('GET', `/projects/${P}/${DETAIL_ROUTE[type]}/${id}`)).status);
    return recordStatus.get(key);
  };
  const readable = async (type, id) => {
    if (!type) return true;
    if (DETAIL_ROUTE[type] && id) return (await recordOf(type, id)) === 200;
    const rule = MODULE_ROUTE.find(([pattern]) => pattern.test(type));
    if (rule) return (await moduleOf(rule[1])) !== 403;
    return true;
  };
  const refused = [];
  for (const event of events) {
    const type = event.recordType || event.entityType;
    const id = event.recordId || event.entityId;
    let ok = await readable(type, id);
    // a file event: the file's record decides as well
    if (ok && (type === 'attachment' || type === 'document_revision')) {
      const linked = event.summary?.recordType || event.metadata?.recordType || null;
      const linkedId = event.summary?.recordId || event.metadata?.recordId || null;
      ok = await readable(linked, linkedId);
    }
    if (ok && type === 'project' && event.summary?.transition === 'contract.manage') ok = (await moduleOf('prime-contract')) !== 403;
    if (!ok) refused.push(event);
  }
  return refused;
};

const byType = (events) => {
  const out = {};
  for (const event of events) {
    const type = event.recordType || event.entityType || '(none)';
    out[type] = (out[type] || 0) + 1;
  }
  return out;
};

pv.main(async () => {
  const s = await pv.setup({ log: () => {} });
  const P = s.projectId;
  const tag = stamp();
  const X = s.subX;
  const Y = s.subY;
  const PM = s.pm;
  const site = pv.api.as(SITE);
  const outsider = pv.api.as(OUTSIDER);
  console.log(`audit-customfields-assistant proof â€” project ${P} (072-01), run ${tag}${ONLY.length ? `, only ${ONLY.join(',')}` : ''}`);

  // shared set-up: an RFI of each guest company, a change order
  const firstOr = async (who, route, create) => items(await who.send('GET', route))[0] || data(await who.send('POST', create.route, create.body));
  const xRfi = await firstOr(X, `/projects/${P}/rfi?limit=20`, { route: `/projects/${P}/rfi`, body: { subject: `PROOF ACA X ${tag}`, question: 'X question', status: 'open' } });
  const yRfi = await firstOr(Y, `/projects/${P}/rfi?limit=20`, { route: `/projects/${P}/rfi`, body: { subject: `PROOF ACA Y ${tag}`, question: 'Y-only question', status: 'open' } });
  const order = items(await PM.send('GET', `/projects/${P}/change-orders?limit=50`)).find((row) => Number(row.value) > 0);
  if (!xRfi?.id || !yRfi?.id || !order?.id) throw new Error('set-up: an RFI of each guest company and a change order are needed');
  if (xRfi.id === yRfi.id) throw new Error('set-up: SUB-X and SUB-Y list the same RFI');

  // â”€â”€ L43: the history as a party guest reads it â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (wants('G1', 'G2')) {
    console.log('\n== L43 â€” a subcontractor guest reads the project history (G1, G2) ==');
    const coMarker = `ACA-CO-${tag}: client will accept 61% of this variation`;
    const yMarker = `ACA-Y-${tag}: note to company Y only`;
    const xMarker = `ACA-X-${tag}: note on company X's own RFI`;
    const posted = [
      await PM.send('POST', `/projects/${P}/comments`, { recordType: 'change_order', recordId: order.id, body: coMarker }),
      await PM.send('POST', `/projects/${P}/comments`, { recordType: 'rfi', recordId: yRfi.id, body: yMarker }),
      await PM.send('POST', `/projects/${P}/comments`, { recordType: 'rfi', recordId: xRfi.id, body: xMarker }),
    ];
    if (posted.some((res) => res.status !== 201)) throw new Error(`set-up comments: ${posted.map(said).join(', ')}`);

    const guest = await pageAll(X, `/projects/${P}/audit?source=all&limit=100&order=desc`);
    console.log(`  SUB-X history: ${guest.events.length} events in ${guest.pages} page(s); by type ${JSON.stringify(byType(guest.events))}`);
    const refused = await refusedAtSource({ who: X, P, events: guest.events });
    check('G1', 'refused', 'no event on a record the guest is refused at the source (module, other party, other vendor, file of such a record)', guest.status === 200 && refused.length === 0, refused.length ? `${refused.length}: ${JSON.stringify(byType(refused))}` : `${guest.events.length} events checked`);
    const own = await pageAll(X, `/projects/${P}/audit?entityType=rfi&entityId=${xRfi.id}&limit=100&order=asc`);
    check('G1', 'allowed', "the guest reads the history of its own company's RFI", own.status === 200 && own.events.length > 0, `${own.events.length} events on ${xRfi.ref || xRfi.id}`);
    const readModules = guest.events.filter((event) => (event.recordType || event.entityType) === 'activity' || (event.recordType || event.entityType) === 'progress_submission' || (event.recordType || event.entityType) === 'location');
    check('G1', 'allowed', 'the guest keeps the modules it reads (schedule, progress, location)', readModules.length > 0, `${readModules.length} events`);

    const comments = guest.events.filter((event) => event.source === 'comment');
    const has = (list, marker) => list.some((event) => String(event.comment || '').includes(marker));
    check('G2', 'refused', "the PM's comment on a change order is not in the guest's history (comments route: 403)", !has(comments, coMarker), `${comments.length} comments in the guest's history`);
    check('G2', 'refused', "the PM's comment on company Y's RFI is not in the guest's history (comments route: 404)", !has(comments, yMarker));
    check('G2', 'allowed', "the PM's comment on the guest's own RFI is in the guest's history", has(comments, xMarker));
    const pmComments = (await pageAll(PM, `/projects/${P}/audit?source=comment&limit=100&order=desc`)).events;
    check('G2', 'allowed', 'the PM reads all three comments in the history', has(pmComments, coMarker) && has(pmComments, yMarker) && has(pmComments, xMarker));
  }

  // â”€â”€ L43: a company role â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (wants('G3')) {
    console.log('\n== L43 â€” a site engineer of the company reads the project history (G3) ==');
    const history = await pageAll(site, `/projects/${P}/audit?source=all&limit=100&order=desc`);
    const types = byType(history.events);
    console.log(`  site engineer history: ${history.events.length} events; by type ${JSON.stringify(types)}`);
    const refused = await refusedAtSource({ who: site, P, events: history.events });
    check('G3', 'refused', 'no event on a module the site engineer may not read (change orders, commitments, payment certificates, cost, pay applications)', history.status === 200 && refused.length === 0, refused.length ? JSON.stringify(byType(refused)) : `${history.events.length} events checked`);
    check('G3', 'allowed', 'the site engineer keeps the RFI and submittal history', (types.rfi || 0) > 0 && (types.submittal || 0) > 0, `rfi ${types.rfi || 0}, submittal ${types.submittal || 0}`);
    const pmOrders = await PM.send('GET', `/projects/${P}/audit?entityType=change_order&limit=5&order=desc`);
    check('G3', 'allowed', "the PM keeps the change orders' history", pmOrders.status === 200 && (data(pmOrders)?.events || []).length > 0, `${(data(pmOrders)?.events || []).length} events`);
  }

  // â”€â”€ X-PARTY-1: paging â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (wants('G4')) {
    console.log('\n== X-PARTY-1 â€” the history pages to its end for every source (G4) ==');
    // eslint-disable-next-line global-require
    const guard = require('../lib/cert-env');
    const prisma = await guard.connectCertPrisma();
    let counts;
    try {
      const [audit, approval, status, comment] = await Promise.all([
        prisma.auditEvent.count({ where: { projectId: P } }),
        prisma.approvalWorkflowEvent.count({ where: { projectId: P } }),
        prisma.workflowStatusHistory.count({ where: { projectId: P } }),
        prisma.comment.count({ where: { projectId: P, deletedAt: null } }),
      ]);
      counts = { audit, approval, status, comment, all: audit + approval + status + comment };
    } finally {
      await prisma.$disconnect();
    }
    console.log(`  rows in the database for 072-01: ${JSON.stringify(counts)}`);
    for (const [source, order2] of [['all', 'desc'], ['all', 'asc'], ['approval', 'desc'], ['status', 'desc'], ['comment', 'asc'], ['audit', 'desc']]) {
      const run = await pageAll(PM, `/projects/${P}/audit?source=${source}&limit=100&order=${order2}`);
      const complete = run.status === 200 && !run.looped && run.duplicates === 0 && run.events.length === counts[source];
      check('G4', 'allowed', `source=${source} order=${order2}: every event once, then the end`, complete, `${run.events.length}/${counts[source]} in ${run.pages} page(s)${run.duplicates ? `, ${run.duplicates} repeated` : ''}${run.looped ? ', the cursor did not move' : ''}`);
    }
    const first = await PM.send('GET', `/projects/${P}/audit?source=audit&limit=3&order=desc`);
    const legacy = data(first)?.events?.[2]?.rawId;
    const viaLegacy = legacy ? await PM.send('GET', `/projects/${P}/audit?source=audit&limit=3&order=desc&cursor=${legacy}`) : null;
    const viaNew = data(first)?.nextCursor ? await PM.send('GET', `/projects/${P}/audit?source=audit&limit=3&order=desc&cursor=${encodeURIComponent(data(first).nextCursor)}`) : null;
    const ids = (res) => (data(res)?.events || []).map((event) => event.id).join(',');
    check('G4', 'allowed', "a cursor of the earlier form (an audit event's id) still pages: the page after it, as the new cursor gives it", viaLegacy?.status === 200 && ids(viaLegacy) && ids(viaLegacy) === ids(viaNew) && ids(viaLegacy) !== ids(first), viaLegacy ? said(viaLegacy) : 'no event');
    const bad = await PM.send('GET', `/projects/${P}/audit?source=all&limit=3&cursor=h1.bm90LWEtY3Vyc29y`);
    check('G4', 'refused', 'a cursor that names no position is refused (400), not answered with the first page', bad.status === 400, said(bad));
  }

  // â”€â”€ L45: custom-field values â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (wants('G5', 'G6')) {
    console.log('\n== L45 â€” custom-field values (G5, G6) ==');
    let field = items(await PM.send('GET', '/company/custom-fields?recordType=rfi')).find((row) => row.key === FIELD_KEY);
    if (!field) field = data(await PM.send('POST', '/company/custom-fields', { recordType: 'rfi', type: 'text', label: 'Cert ACA probe', key: FIELD_KEY }));
    if (!field?.id) throw new Error('set-up: the company rfi custom field could not be made');
    const V = (project, id) => `/projects/${project}/custom-fields/values/rfi/${id}`;
    const put = (who, project, id, value) => who.send('PUT', V(project, id), { values: { [FIELD_KEY]: value }, partial: true });
    const valueOf = (res) => data(res)?.values?.[FIELD_KEY];

    if (wants('G5')) {
      const theirs = items(await outsider.send('GET', '/projects?limit=100')).filter((row) => row.id !== P);
      const directly = await outsider.send('GET', `/projects/${P}`);
      if (!theirs.length || directly.status !== 403) throw new Error(`set-up: ${OUTSIDER} must be on other projects and refused 072-01 (${said(directly)})`);
      const Q = theirs[0].id;
      let qRfi = items(await PM.send('GET', `/projects/${Q}/rfi?limit=5`))[0];
      if (!qRfi) qRfi = data(await outsider.send('POST', `/projects/${Q}/rfi`, { subject: `PROOF ACA own project ${tag}`, question: 'q', status: 'open' }));
      if (!qRfi?.id) throw new Error('set-up: an RFI on the outsider\'s own project is needed');
      const secret = `outsider-wrote-${tag}`;
      const before = valueOf(await PM.send('GET', V(P, yRfi.id)));
      const read = await outsider.send('GET', V(Q, yRfi.id));
      check('G5', 'refused', "a member not on 072-01 reads the values of a 072-01 RFI through a project they are on â†’ 404", read.status === 404 && read.body?.error?.code === 'CUSTOM_FIELD_RECORD_NOT_FOUND', said(read));
      const write = await put(outsider, Q, yRfi.id, secret);
      check('G5', 'refused', 'â€¦ and writes them â†’ 404', write.status === 404 && write.body?.error?.code === 'CUSTOM_FIELD_RECORD_NOT_FOUND', said(write));
      const bulk = await outsider.send('GET', `/projects/${Q}/custom-fields/values?recordType=rfi&recordIds=${yRfi.id},${qRfi.id}`);
      check('G5', 'refused', 'â€¦ and the bulk read leaves the 072-01 RFI out', bulk.status === 200 && !(yRfi.id in (data(bulk)?.items || {})), said(bulk));
      const after = valueOf(await PM.send('GET', V(P, yRfi.id)));
      check('G5', 'refused', "the 072-01 RFI's value is unchanged", after === before && after !== secret, `${JSON.stringify(before)} â†’ ${JSON.stringify(after)}`);
      const ownWrite = await put(outsider, Q, qRfi.id, `own-${tag}`);
      const ownRead = await outsider.send('GET', V(Q, qRfi.id));
      check('G5', 'allowed', 'the same member reads and writes the values of an RFI of their own project', ownWrite.status === 200 && valueOf(ownRead) === `own-${tag}`, `${said(ownWrite)} / ${said(ownRead)}`);
      const pmWrite = await put(PM, P, yRfi.id, `pm-${tag}`);
      check('G5', 'allowed', 'the PM writes the 072-01 RFI\'s values through 072-01', pmWrite.status === 200 && valueOf(pmWrite) === `pm-${tag}`, said(pmWrite));
    }

    if (wants('G6')) {
      const yRead = await X.send('GET', V(P, yRfi.id));
      check('G6', 'refused', "SUB-X reads the values of company Y's RFI â†’ 404", yRead.status === 404 && yRead.body?.error?.code === 'CUSTOM_FIELD_RECORD_NOT_FOUND', said(yRead));
      const yWrite = await put(X, P, yRfi.id, `x-wrote-${tag}`);
      check('G6', 'refused', 'â€¦ and writes them â†’ 404', yWrite.status === 404 && yWrite.body?.error?.code === 'CUSTOM_FIELD_RECORD_NOT_FOUND', said(yWrite));
      const bulk = await X.send('GET', `/projects/${P}/custom-fields/values?recordType=rfi&recordIds=${yRfi.id},${xRfi.id}`);
      check('G6', 'refused', "â€¦ and the bulk read leaves company Y's RFI out", bulk.status === 200 && !(yRfi.id in (data(bulk)?.items || {})), said(bulk));
      const xWrite = await put(X, P, xRfi.id, `x-own-${tag}`);
      const xRead = await X.send('GET', V(P, xRfi.id));
      check('G6', 'allowed', "SUB-X reads and writes the values of its own company's RFI", xWrite.status === 200 && valueOf(xRead) === `x-own-${tag}`, `${said(xWrite)} / ${said(xRead)}`);
      const yOwn = await Y.send('GET', V(P, yRfi.id));
      check('G6', 'allowed', "SUB-Y reads the values of its own RFI", yOwn.status === 200, said(yOwn));
    }
  }

  // â”€â”€ L46: the organisation-mounted assistant â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (wants('G7')) {
    console.log('\n== L46 â€” the organisation assistant and a project in the body (G7) ==');
    const conversations = async (who) => items(await who.send('GET', '/assistant/conversations?limit=100'));
    const theirs = items(await outsider.send('GET', '/projects?limit=100')).filter((row) => row.id !== P);
    const Q = theirs[0]?.id;
    const before = await conversations(outsider);
    const asked = await outsider.send('POST', '/assistant/ask', { question: 'What is the contract value and who is the client?', projectId: P });
    const afterAsk = await conversations(outsider);
    check('G7', 'refused', 'a member not on 072-01 asks about 072-01 â†’ 403 PROJECT_ACCESS_DENIED', asked.status === 403 && asked.body?.error?.code === 'PROJECT_ACCESS_DENIED', said(asked));
    check('G7', 'refused', 'â€¦ and no conversation is stored (nothing ran before the check)', afterAsk.length === before.length && !afterAsk.some((row) => row.projectId === P), `${before.length} â†’ ${afterAsk.length}`);
    const foreign = Object.values(JSON.parse(fs.readFileSync(path.join(process.env.CERT_STATE_DIR || 'C:/Temp/octapm-cert/state', 'projects.json'), 'utf8'))['026'])[0];
    const cross = await outsider.send('POST', '/assistant/ask', { question: 'Who is the client?', projectId: foreign.id });
    check('G7', 'refused', "a project of another company â†’ 404 PROJECT_NOT_FOUND (was a 500)", cross.status === 404 && cross.body?.error?.code === 'PROJECT_NOT_FOUND', said(cross));
    // A conversation a failed refusal stored is removed with the rest.
    const created = [asked, cross].filter((res) => data(res)?.conversationId).map((res) => [outsider, data(res).conversationId]);
    const own = Q ? await outsider.send('POST', '/assistant/ask', { question: 'What is open on this project?', projectId: Q }) : null;
    if (data(own)?.conversationId) created.push([outsider, data(own).conversationId]);
    check('G7', 'allowed', 'the same member asks about a project they are on â†’ 200, scoped to it', own?.status === 200 && data(own)?.projectId === Q, own ? said(own) : 'no project');
    const followUp = data(own)?.conversationId ? await outsider.send('POST', '/assistant/ask', { question: 'And what is late?', conversationId: data(own).conversationId }) : null;
    check('G7', 'allowed', 'â€¦ and follows up in that conversation â†’ 200', followUp?.status === 200, followUp ? said(followUp) : 'none');
    const pmAsk = await PM.send('POST', '/assistant/ask', { question: 'What is open on this project?', projectId: P });
    if (data(pmAsk)?.conversationId) created.push([PM, data(pmAsk).conversationId]);
    check('G7', 'allowed', 'the PM asks about 072-01 at the organisation assistant â†’ 200', pmAsk.status === 200 && data(pmAsk)?.projectId === P, said(pmAsk));
    const general = await outsider.send('POST', '/assistant/ask', { question: 'What is open across my projects?' });
    if (data(general)?.conversationId) created.push([outsider, data(general).conversationId]);
    check('G7', 'allowed', 'a question with no project â†’ 200 (every project the caller can open)', general.status === 200, said(general));
    for (const [who, id] of created) await who.send('DELETE', `/assistant/conversations/${id}`);
  }

  // â”€â”€ verdict â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const failedRefusals = results.filter((r) => !r.pass && r.kind === 'refused');
  const failedAllowed = results.filter((r) => !r.pass && r.kind === 'allowed');
  console.log(`\nSummary: ${results.filter((r) => r.pass).length}/${results.length} checks pass`);
  for (const guard of [...new Set(results.map((r) => r.guard))]) {
    const own = results.filter((r) => r.guard === guard);
    console.log(`  ${guard}: ${own.every((r) => r.pass) ? 'HOLDS' : 'FAILS'} (${own.filter((r) => r.kind === 'refused' && r.pass).length}/${own.filter((r) => r.kind === 'refused').length} refusals, ${own.filter((r) => r.kind === 'allowed' && r.pass).length}/${own.filter((r) => r.kind === 'allowed').length} allowed)`);
  }
  process.exitCode = failedRefusals.length ? 2 : failedAllowed.length ? 3 : 0;
});
