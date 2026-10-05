'use strict';

/**
 * The live proof of the CERT-2 injection pairs of punch items, RFIs, risks,
 * drawings and tasks: each record may point only at its own project's
 * locations, activities and punch items, and its own company's directory and
 * people.
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/punch-rfi-tasks-proof.js [attacker=026] [victim=027]
 *
 * The pairs (cert2-inject, all answered 2xx):
 *   POST /projects/{projectId}/punch            assigneeUserId | managerUserId | finalApproverUserId = user
 *   POST /projects/{projectId}/punch            assigneeCompanyId = company
 *   POST /projects/{projectId}/punch            locationId = location | activityId = activity
 *   POST /projects/{projectId}/punch/distribute itemIds[] = punch_item | userIds[] = user
 *   POST /projects/{projectId}/rfi              activityId = activity
 *   POST /projects/{projectId}/risks            activityId = activity
 *   POST /projects/{projectId}/drawings         activityId = activity
 *   POST /projects/{projectId}/tasks            projectId (in the body) = project
 *
 * What the sweep's requests did (reproduced in process before the fix):
 *   - punch: the request reused an earlier item's offline key, so it was a
 *     replay — answered 201 with that item, the foreign id never looked at;
 *     a fresh request was refused. But /punch/bulk stored an item's OWN
 *     references unchecked (only the defaults were checked) and answered with
 *     the other company's location, activity, company and people, e-mail
 *     address included.
 *   - distribute: another company's punch item or person was dropped without
 *     a word (nothing distributed, nobody of theirs notified or e-mailed).
 *   - rfi / risks / drawings: an activityId beside activity links was ignored
 *     (the links win) and never checked; tasks: a body projectId on a
 *     project's own mount was ignored.
 *
 * For each pair, with requests built like the sweep's (its project and
 * foreign ids when results/isolation/cert2-inject.json has the pair):
 *   - the victim's id is REFUSED, exactly as an id that exists nowhere is;
 *   - nothing is stored, sent or returned: no row of the attacker's company
 *     names the victim's ids afterwards that did not before, no row carries a
 *     refused request's stamp, no audit row, outbound event, notification,
 *     distribution event or background job was written for anything but the
 *     allowed requests, no e-mail was sent by a refused request, no answer
 *     carries the victim's names, addresses or canaries;
 *   - the same request with the attacker's OWN id still succeeds and stores it.
 * No answer may be a 500, and the victim's data must not change in any table.
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

const ATTACKER = process.argv[2] || '026';
const VICTIM = process.argv[3] || '027';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `PRT-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const INPROCESS = process.env.CERT_INPROCESS === '1';
const results = [];
const answers = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const said = (res) => `${res.status} ${res.body?.error?.code || ''} ${res.body?.error?.message || ''}`.trim();
const ok2xx = (res) => res.status >= 200 && res.status < 300;
const nowhere = () => crypto.randomUUID();

// In process, the product's local e-mail transport writes each message to the
// console: every one is counted (and kept out of the proof's output).
const emails = [];
const print = console.log.bind(console);
console.log = (...args) => {
  const text = args.map(String).join(' ');
  if (text.startsWith('[email:local]')) {
    emails.push(text.split('\n')[0]);
    return;
  }
  print(...args);
};

const main = async () => {
  console.log(`attacker ${ATTACKER}, victim ${VICTIM}, stamp ${STAMP}${INPROCESS ? ', in process (the working tree\'s code)' : ' — NOT in process: this asks the running API, which does not run the working tree\'s code, and e-mails cannot be counted'}\n`);
  const { companies } = buildPopulation();
  const attacker = companies.find((c) => c.code === ATTACKER);
  const victim = companies.find((c) => c.code === VICTIM);
  if (!attacker || !victim) throw new Error(`unknown company ${ATTACKER} or ${VICTIM}`);

  const db = await guard.connectCert();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const orgOf = async (code) => (await q(`select id from "Organisation" where slug like $1`, [`cert-${code}-%`]))[0]?.id;
  const attackerOrg = await orgOf(ATTACKER);
  const victimOrg = await orgOf(VICTIM);
  if (!attackerOrg || !victimOrg) throw new Error('both companies must exist in the certification database');

  // ── the sweep's requests, or ones built the same way ─────────────────────
  let sweep = [];
  try {
    sweep = JSON.parse(fs.readFileSync(path.join(WORK, 'results', 'isolation', 'cert2-inject.json'), 'utf8')).results
      .filter((r) => r.attacker === ATTACKER && r.victim === VICTIM && r.method === 'POST');
  } catch { /* no sweep results: the ids are read from the database */ }
  // A results file of an earlier population names rows that no longer exist
  // (the population is regenerated): it is used only while its project is still
  // the attacker company's own.
  const sweepProject = sweep.find((r) => r.route)?.route.split('/')[2] || null;
  if (sweepProject && !(await q(`select 1 from "Project" where id = $1 and "orgId" = $2`, [sweepProject, attackerOrg])).length) {
    console.log(`the sweep results name project ${sweepProject}, which is not company ${ATTACKER}'s in this population: the ids are read from the database`);
    sweep = [];
  }
  const pairOf = (template, field) => sweep.find((r) => r.template === `/projects/{projectId}${template}` && r.field === field) || null;
  const swept = {
    assigneeUserId: pairOf('/punch', 'assigneeUserId'),
    managerUserId: pairOf('/punch', 'managerUserId'),
    finalApproverUserId: pairOf('/punch', 'finalApproverUserId'),
    assigneeCompanyId: pairOf('/punch', 'assigneeCompanyId'),
    locationId: pairOf('/punch', 'locationId'),
    activityId: pairOf('/punch', 'activityId'),
    itemIds: pairOf('/punch/distribute', 'itemIds[]'),
    userIds: pairOf('/punch/distribute', 'userIds[]'),
    rfi: pairOf('/rfi', 'activityId'),
    risk: pairOf('/risks', 'activityId'),
    drawing: pairOf('/drawings', 'activityId'),
    task: pairOf('/tasks', 'projectId'),
  };
  for (const [name, row] of Object.entries(swept)) {
    console.log(`sweep ${name}: ${row ? `${row.method} ${row.template} [${row.field}] -> ${row.status} ${row.verdict}` : '(not in the sweep results; built from the database)'}`);
  }

  // ── own ids (the attacker's project) and foreign ids (the victim's) ──────
  const sweptProject = Object.values(swept).find(Boolean)?.route.split('/')[2] || null;
  const projectId = sweptProject || (await q(`select p.id from "Project" p where p."orgId" = $1 and exists (select 1 from "Location" l where l."projectId" = p.id) and exists (select 1 from "Activity" a where a."projectId" = p.id and a."isActive") order by p."createdAt" limit 1`, [attackerOrg]))[0]?.id;
  const ownProject = (await q(`select id from "Project" where id = $1 and "orgId" = $2`, [projectId, attackerOrg]))[0]?.id;
  const one = async (sql, params) => (await q(sql, params))[0]?.id || null;
  const own = {
    location: await one(`select id from "Location" where "projectId" = $1 order by "createdAt" limit 1`, [projectId]),
    activity: await one(`select id from "Activity" where "projectId" = $1 and "isActive" order by "createdAt" limit 1`, [projectId]),
    activity2: await one(`select id from "Activity" where "projectId" = $1 and "isActive" order by "createdAt" offset 1 limit 1`, [projectId]),
    company: await one(`select id from "Company" where "orgId" = $1 order by "createdAt" limit 1`, [attackerOrg]),
    user: await one(`select u.id from "User" u join "OrganizationMembership" m on m."userId" = u.id where m."orgId" = $1 and m.status = 'active' and u.email = $2`, [attackerOrg, `site@${attacker.domain}`]),
    user2: await one(`select u.id from "User" u join "OrganizationMembership" m on m."userId" = u.id where m."orgId" = $1 and m.status = 'active' and u.email = $2`, [attackerOrg, `planner@${attacker.domain}`]),
  };
  const victimRow = async (sql) => one(sql, [victimOrg]);
  const foreign = {
    user: swept.assigneeUserId?.foreign || swept.userIds?.foreign || await victimRow(`select u.id from "User" u join "OrganizationMembership" m on m."userId" = u.id where m."orgId" = $1 and m.status = 'active' order by u.email limit 1`),
    company: swept.assigneeCompanyId?.foreign || await victimRow(`select id from "Company" where "orgId" = $1 order by "createdAt" limit 1`),
    location: swept.locationId?.foreign || await victimRow(`select l.id from "Location" l join "Project" p on p.id = l."projectId" where p."orgId" = $1 order by l."createdAt" limit 1`),
    activity: swept.activityId?.foreign || swept.rfi?.foreign || await victimRow(`select a.id from "Activity" a join "Project" p on p.id = a."projectId" where p."orgId" = $1 order by a."createdAt" limit 1`),
    punchItem: swept.itemIds?.foreign || await victimRow(`select id from "PunchItem" where "orgId" = $1 order by "createdAt" limit 1`),
    project: swept.task?.foreign || await victimRow(`select id from "Project" where "orgId" = $1 order by "createdAt" limit 1`),
  };
  const ownerOrg = {
    user: await one(`select "orgId" as id from "OrganizationMembership" where "userId" = $1 and "orgId" = $2`, [foreign.user, victimOrg]),
    company: await one(`select "orgId" as id from "Company" where id = $1`, [foreign.company]),
    location: await one(`select p."orgId" as id from "Location" l join "Project" p on p.id = l."projectId" where l.id = $1`, [foreign.location]),
    activity: await one(`select p."orgId" as id from "Activity" a join "Project" p on p.id = a."projectId" where a.id = $1`, [foreign.activity]),
    punchItem: await one(`select "orgId" as id from "PunchItem" where id = $1`, [foreign.punchItem]),
    project: await one(`select "orgId" as id from "Project" where id = $1`, [foreign.project]),
  };
  check('setup: the project is the attacker company\'s own', Boolean(ownProject), projectId);
  check('setup: the attacker project has its own location, two activities, a company and two people', Object.values(own).every(Boolean), JSON.stringify(own));
  for (const [kind, id] of Object.entries(foreign)) check(`setup: the foreign ${kind} is the victim company's`, ownerOrg[kind] === victimOrg, id);
  if (!ownProject || !Object.values(own).every(Boolean) || Object.keys(foreign).some((kind) => ownerOrg[kind] !== victimOrg)) throw new Error('setup incomplete');
  const foreignNames = await q(`select name from "Company" where id = $1 and name not in (select name from "Company" where "orgId" = $2)`, [foreign.company, attackerOrg]);
  const victimPunchBefore = (await q(`select "distributedAt" from "PunchItem" where id = $1`, [foreign.punchItem]))[0];

  const pm = as(`pm@${attacker.domain}`);
  const P = `/projects/${projectId}`;
  const send = async (method, route, body) => {
    const res = await pm.send(method, route, body);
    answers.push({ route: `${method} ${route}`, status: res.status, text: res.text || '' });
    return res;
  };
  const allowedIds = new Set();
  const keep = (res) => {
    const data = res.body?.data;
    for (const id of [data?.id, ...(Array.isArray(data?.items) ? data.items : []).map((item) => item?.id)]) if (id) allowedIds.add(id);
    return res;
  };

  // The offline replay the sweep sent: the sweep's own item (its key and its
  // fields), or — when the database no longer has it — one made now.
  const REF_FIELDS = ['locationId', 'activityId', 'assigneeCompanyId', 'assigneeUserId', 'managerUserId', 'finalApproverUserId'];
  const sweptItem = swept.assigneeUserId?.created || swept.locationId?.created || null;
  let origin = sweptItem ? (await q(`select * from "PunchItem" where id = $1 and "projectId" = $2 and "clientRequestId" is not null`, [sweptItem, projectId]))[0] : null;
  if (!origin) {
    const made = keep(await send('POST', `${P}/punch`, { title: `${STAMP} origin`, kind: 'punch', locationId: own.location, activityId: own.activity, assigneeCompanyId: own.company, assigneeUserId: own.user, managerUserId: own.user2, finalApproverUserId: own.user2, clientRequestId: `${STAMP}-ORIGIN` }));
    origin = made.body?.data?.id ? (await q(`select * from "PunchItem" where id = $1`, [made.body.data.id]))[0] : null;
  }
  check('setup: an item of the attacker\'s own with an offline key to replay', Boolean(origin?.clientRequestId), origin ? `${origin.ref} ${origin.clientRequestId}` : 'none');
  if (!origin) throw new Error('setup incomplete');
  const originBody = {
    title: origin.title,
    description: origin.description || undefined,
    kind: origin.kind,
    priority: origin.priority,
    trade: origin.trade || undefined,
    locationText: origin.locationText || undefined,
    ...Object.fromEntries(REF_FIELDS.map((field) => [field, origin[field] || undefined])),
    dueDate: origin.dueDate ? new Date(origin.dueDate).toISOString().slice(0, 10) : undefined,
    clientRequestId: origin.clientRequestId,
  };
  // Two open items of the attacker's own to distribute.
  const openItem = async (n) => keep(await send('POST', `${P}/punch`, { title: `${STAMP}-ALLOWED distribute ${n}`, status: 'open', assigneeUserId: own.user, assigneeCompanyId: own.company }));
  const ownItems = [(await openItem(1)).body?.data?.id, (await openItem(2)).body?.data?.id];
  check('setup: two open items of the attacker\'s own to distribute', ownItems.every(Boolean), ownItems.join(', '));
  const ownItemsBefore = await q(`select id, "distributedAt" from "PunchItem" where id = any($1::text[]) order by id`, [ownItems]);

  const victimIds = Object.values(foreign);
  // The product's timestamps are UTC wall-clock times in columns without a
  // time zone: the window starts at the database's own UTC clock.
  const start = (await q(`select to_char((now() at time zone 'UTC') - interval '1 second', 'YYYY-MM-DD HH24:MI:SS.MS') as s`))[0].s;
  for (const id of ownItems) allowedIds.add(id);
  allowedIds.add(origin.id);

  // ── before ───────────────────────────────────────────────────────────────
  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const taken = await fingerprint.take(db);
    await db.query('rollback');
    return taken;
  };
  const before = await snapshot();
  const NAMING = {
    PunchItem: `select count(*)::int as n from "PunchItem" t where t."orgId" = $1`,
    PunchItemEvent: `select count(*)::int as n from "PunchItemEvent" t where t."orgId" = $1`,
    Rfi: `select count(*)::int as n from "Rfi" t join "Project" p on p.id = t."projectId" where p."orgId" = $1`,
    Risk: `select count(*)::int as n from "Risk" t join "Project" p on p.id = t."projectId" where p."orgId" = $1`,
    RiskActivityLink: `select count(*)::int as n from "RiskActivityLink" t join "Project" p on p.id = t."projectId" where p."orgId" = $1`,
    DrawingRecord: `select count(*)::int as n from "DrawingRecord" t join "Project" p on p.id = t."projectId" where p."orgId" = $1`,
    WorkflowActivityLink: `select count(*)::int as n from "WorkflowActivityLink" t join "Project" p on p.id = t."projectId" where p."orgId" = $1`,
    Task: `select count(*)::int as n from "Task" t where t."orgId" = $1`,
  };
  const naming = async () => {
    const counts = {};
    for (const [table, sql] of Object.entries(NAMING)) {
      counts[table] = (await q(`${sql} and (${victimIds.map((_, i) => `to_jsonb(t)::text like '%' || $${i + 2} || '%'`).join(' or ')})`, [attackerOrg, ...victimIds]))[0].n;
    }
    return counts;
  };
  const namingBefore = await naming();

  /** The victim's id refused, exactly as an id that exists nowhere is; and no e-mail sent. */
  const refused = async (label, attempt, foreignId, expect) => {
    const sent = emails.length;
    const bad = await attempt(foreignId, 'REFUSED');
    const none = await attempt(nowhere(), 'REFUSED');
    check(`${label}: another company's id is refused (${expect})`, said(bad).startsWith(expect), said(bad));
    check(`${label}: …exactly as an id that exists nowhere`, said(bad) === said(none), `${said(bad)} | ${said(none)}`);
    if (INPROCESS) check(`${label}: no e-mail was sent`, emails.length === sent, `${emails.length - sent} sent`);
    return bad;
  };
  const allowed = async (label, attempt, ownId) => {
    const res = keep(await attempt(ownId, 'ALLOWED'));
    check(`${label}: the company's own id is accepted`, ok2xx(res), said(res));
    return res;
  };
  const stored = async (label, table, id, column, expected) => {
    const row = id ? (await q(`select to_jsonb(t)->>$2 as v from "${table}" t where id = $1`, [id, column]))[0] : null;
    check(`${label}: the own id is stored`, row?.v === expected, `${table}.${column} = ${row?.v}`);
  };

  // ── 1–3. a punch item's people, company, location and activity ─────────
  const PUNCH = [
    ['assigneeUserId', 'user', '404 USER_NOT_FOUND'],
    ['managerUserId', 'user', '404 USER_NOT_FOUND'],
    ['finalApproverUserId', 'user', '404 USER_NOT_FOUND'],
    ['assigneeCompanyId', 'company', '404 COMPANY_NOT_FOUND'],
    ['locationId', 'location', '404 LOCATION_NOT_FOUND'],
    ['activityId', 'activity', '404 ACTIVITY_NOT_FOUND'],
  ];
  const ownFor = { user: own.user, company: own.company, location: own.location, activity: own.activity };
  for (const [field, kind, expect] of PUNCH) {
    // The sweep's own request: the earlier item's body and offline key, one id replaced.
    const replay = (id) => send('POST', `${P}/punch`, { ...originBody, [field]: id });
    await refused(`punch ${field} (the sweep pair: a replay of an earlier item's key)`, replay, foreign[kind], expect);
    const again = keep(await replay(origin[field] || ownFor[kind]));
    check(`punch ${field}: the true replay (the original's own ids) still returns the original`, again.status === 201 && again.body?.data?.replayed === true && again.body?.data?.id === origin.id, `${said(again)} replayed=${again.body?.data?.replayed} id=${again.body?.data?.id}`);
    const fresh = (id, tag) => send('POST', `${P}/punch`, { title: `${STAMP}-${tag} ${field}`, clientRequestId: `${STAMP}-${tag}-${field}-${crypto.randomBytes(2).toString('hex')}`, [field]: id });
    await refused(`punch ${field} (a new item)`, fresh, foreign[kind], expect);
    const made = await allowed(`punch ${field} (a new item)`, fresh, ownFor[kind]);
    await stored(`punch ${field} (a new item)`, 'PunchItem', made.body?.data?.id, field, ownFor[kind]);
    // Beside the pair: an item of a bulk batch (its own fields were never checked).
    const bulk = (id, tag) => send('POST', `${P}/punch/bulk`, { items: [{ title: `${STAMP}-${tag} bulk own ${field}` }, { title: `${STAMP}-${tag} bulk ${field}`, clientRequestId: `${STAMP}-${tag}-bulk-${field}-${crypto.randomBytes(2).toString('hex')}`, [field]: id }], defaults: {} });
    await refused(`punch/bulk items[].${field} (a batch whose second item names it is refused whole)`, bulk, foreign[kind], expect);
    const batch = await allowed(`punch/bulk items[].${field}`, bulk, ownFor[kind]);
    await stored(`punch/bulk items[].${field}`, 'PunchItem', batch.body?.data?.items?.find((item) => item.title.includes(`bulk ${field}`))?.id, field, ownFor[kind]);
  }

  // A bulk item's reference that is not an identifier at all is refused at the
  // door (it would slip past an id check and reach the database).
  for (const value of [12345, { id: foreign.activity }]) {
    const odd = await send('POST', `${P}/punch/bulk`, { items: [{ title: `${STAMP}-REFUSED bulk odd`, activityId: value }] });
    check(`punch/bulk items[].activityId = ${JSON.stringify(value)} (not an identifier) is refused (400 VALIDATION_ERROR)`, said(odd).startsWith('400 VALIDATION_ERROR'), said(odd));
  }

  // ── 4. distribution ──────────────────────────────────────────────────────
  const MESSAGE = (tag) => `${STAMP}-${tag} please clear before handover`;
  const distribute = (body) => send('POST', `${P}/punch/distribute`, { kind: 'punch', ...body });
  await refused('punch/distribute itemIds[] (the sweep pair)', (id, tag) => distribute({ itemIds: [id, ownItems[1]], userIds: [own.user], message: MESSAGE(tag) }), foreign.punchItem, '404 PUNCH_ITEM_NOT_FOUND');
  await refused('punch/distribute userIds[] (the sweep pair)', (id, tag) => distribute({ itemIds: ownItems, userIds: [id], message: MESSAGE(tag) }), foreign.user, '404 USER_NOT_FOUND');
  await refused('punch/distribute companyIds[] (beside the pairs)', (id, tag) => distribute({ itemIds: [ownItems[0]], companyIds: [id], message: MESSAGE(tag) }), foreign.company, '404 COMPANY_NOT_FOUND');
  const ownItemsMid = await q(`select id, "distributedAt" from "PunchItem" where id = any($1::text[]) order by id`, [ownItems]);
  check('punch/distribute: the refused requests distributed none of the attacker\'s own items either', JSON.stringify(ownItemsMid) === JSON.stringify(ownItemsBefore), JSON.stringify(ownItemsMid.map((r) => r.distributedAt)));
  const victimPunchAfter = (await q(`select "distributedAt" from "PunchItem" where id = $1`, [foreign.punchItem]))[0];
  check('punch/distribute: the victim\'s punch item was not distributed', String(victimPunchAfter?.distributedAt) === String(victimPunchBefore?.distributedAt), `${victimPunchBefore?.distributedAt} -> ${victimPunchAfter?.distributedAt}`);
  const sentBefore = emails.length;
  const dist = await allowed('punch/distribute itemIds[] and userIds[]', (id, tag) => distribute({ itemIds: ownItems, userIds: [id], message: MESSAGE(tag) }), own.user2);
  check('punch/distribute: both own items went to the named person', dist.body?.data?.items === 2 && (dist.body?.data?.recipients || []).some((r) => r.userId === own.user2 && r.delivered), JSON.stringify(dist.body?.data || {}));
  if (INPROCESS) check('punch/distribute: the allowed distribution sent its e-mails', emails.length > sentBefore, `${emails.length - sentBefore} sent`);
  const ownItemsAfter = await q(`select id, "distributedAt" from "PunchItem" where id = any($1::text[])`, [ownItems]);
  check('punch/distribute: the own items are stamped distributed', ownItemsAfter.length === 2 && ownItemsAfter.every((r) => r.distributedAt), JSON.stringify(ownItemsAfter.map((r) => r.distributedAt)));

  // ── 5. an RFI's activity ─────────────────────────────────────────────────
  const WORKFLOW_ACTIVITY = '400 WORKFLOW_ACTIVITY_NOT_FOUND';
  const rfi = (links) => (id, tag) => send('POST', `${P}/rfi`, { subject: `${STAMP}-${tag} rfi`, question: 'Founding level against the borehole log?', priority: 'normal', activityId: id, ...(links ? { activityLinks: [{ activityId: own.activity2, relationType: 'impacted', scheduleImpactDays: 2 }] } : {}) });
  await refused('rfi activityId beside activityLinks (the sweep pair)', rfi(true), foreign.activity, WORKFLOW_ACTIVITY);
  await refused('rfi activityId alone', rfi(false), foreign.activity, WORKFLOW_ACTIVITY);
  const ownRfi = await allowed('rfi activityId beside activityLinks', rfi(true), own.activity);
  await stored('rfi activityId beside activityLinks (the links name the primary)', 'Rfi', ownRfi.body?.data?.id, 'activityId', own.activity2);
  const ownRfiAlone = await allowed('rfi activityId alone', rfi(false), own.activity);
  await stored('rfi activityId alone', 'Rfi', ownRfiAlone.body?.data?.id, 'activityId', own.activity);
  // PATCH without activity links stores activityId as sent.
  const rfiPatch = (id) => send('PATCH', `${P}/rfi/${ownRfiAlone.body?.data?.id}`, { activityId: id });
  await refused('rfi PATCH activityId', rfiPatch, foreign.activity, WORKFLOW_ACTIVITY);
  await stored('rfi PATCH activityId (the refused update left the own activity)', 'Rfi', ownRfiAlone.body?.data?.id, 'activityId', own.activity);
  await allowed('rfi PATCH activityId', rfiPatch, own.activity2);
  await stored('rfi PATCH activityId', 'Rfi', ownRfiAlone.body?.data?.id, 'activityId', own.activity2);

  // ── 6. a risk's activity ─────────────────────────────────────────────────
  const RISK_ACTIVITY = '400 RISK_ACTIVITY_INVALID';
  const risk = (links) => (id, tag) => send('POST', `${P}/risks`, { description: `${STAMP}-${tag} risk`, probability: 'low', impact: 'medium', status: 'open', activityId: id, ...(links ? { activityLinks: [{ activityId: own.activity2, relationType: 'affects', scheduleImpactDays: 2, costImpact: 1500 }] } : {}) });
  await refused('risks activityId beside activityLinks (the sweep pair)', risk(true), foreign.activity, RISK_ACTIVITY);
  await refused('risks activityId alone', risk(false), foreign.activity, RISK_ACTIVITY);
  const ownRisk = await allowed('risks activityId beside activityLinks', risk(true), own.activity);
  const riskId = ownRisk.body?.data?.id;
  const riskLinks = riskId ? (await q(`select "activityId" from "RiskActivityLink" where "riskId" = $1`, [riskId])).map((r) => r.activityId) : [];
  check('risks activityId beside activityLinks: the own links are stored', riskLinks.length === 1 && riskLinks[0] === own.activity2, JSON.stringify(riskLinks));
  if (riskId) {
    const patch = (id, tag) => send('PATCH', `${P}/risks/${riskId}`, { mitigation: `${STAMP}-${tag} patch`, activityId: id, activityLinks: [{ activityId: own.activity2, relationType: 'affects' }] });
    await refused('PATCH risks activityId beside activityLinks', patch, foreign.activity, RISK_ACTIVITY);
    // Read back at once: the allowed update that follows would overwrite what a refused one stored.
    const kept = (await q(`select mitigation, "updatedAt" from "Risk" where id = $1`, [riskId]))[0];
    check('PATCH risks activityId beside activityLinks: the refused update stored nothing', !String(kept?.mitigation).includes(`${STAMP}-REFUSED`), `mitigation ${kept?.mitigation}`);
    await allowed('PATCH risks activityId beside activityLinks', patch, own.activity);
  }

  // ── 7. a drawing's activity ──────────────────────────────────────────────
  const drawing = (links) => (id, tag) => send('POST', `${P}/drawings`, { drawingNumber: `${STAMP}-${tag}-${crypto.randomBytes(2).toString('hex')}`, title: `${STAMP}-${tag} drawing`, status: 'active', activityId: id, ...(links ? { activityIds: [own.activity2] } : {}) });
  await refused('drawings activityId beside activityIds (the sweep pair)', drawing(true), foreign.activity, WORKFLOW_ACTIVITY);
  await refused('drawings activityId alone', drawing(false), foreign.activity, WORKFLOW_ACTIVITY);
  const ownDrawing = await allowed('drawings activityId beside activityIds', drawing(true), own.activity);
  await stored('drawings activityId beside activityIds (the links name the primary)', 'DrawingRecord', ownDrawing.body?.data?.id, 'activityId', own.activity2);
  const drawingId = ownDrawing.body?.data?.id;
  if (drawingId) {
    const patch = (id, tag) => send('PATCH', `${P}/drawings/${drawingId}`, { title: `${STAMP}-${tag} drawing patch`, activityId: id, activityIds: [own.activity2] });
    await refused('PATCH drawings activityId beside activityIds', patch, foreign.activity, WORKFLOW_ACTIVITY);
    const kept = (await q(`select title from "DrawingRecord" where id = $1`, [drawingId]))[0];
    check('PATCH drawings activityId beside activityIds: the refused update stored nothing', !String(kept?.title).includes(`${STAMP}-REFUSED`), `title ${kept?.title}`);
    await allowed('PATCH drawings activityId beside activityIds', patch, own.activity);
  }

  // ── 8. a task's project ──────────────────────────────────────────────────
  const task = (id, tag) => send('POST', `${P}/tasks`, { title: `${STAMP}-${tag} task`, label: 'field', priority: 'high', status: 'todo', projectId: id, activityId: own.activity });
  const flat = await send('POST', '/tasks', { title: `${STAMP}-REFUSED task on the company mount`, projectId: foreign.project });
  await refused('tasks projectId in the body (the sweep pair)', task, foreign.project, said(flat));
  check('tasks projectId: the project mount answers as the /tasks mount answers another company\'s project (404 PROJECT_NOT_FOUND)', said(flat).startsWith('404 PROJECT_NOT_FOUND'), said(flat));
  const ownTask = await allowed('tasks projectId in the body', task, projectId);
  await stored('tasks projectId in the body', 'Task', ownTask.body?.data?.id, 'projectId', projectId);
  const bare = keep(await send('POST', `${P}/tasks`, { title: `${STAMP}-ALLOWED task without a body project` }));
  check('tasks: a task without a body project is still made on the route\'s project', ok2xx(bare) && bare.body?.data?.projectId === projectId, said(bare));

  // ── nothing stored, nothing sent ─────────────────────────────────────────
  const namingAfter = await naming();
  check('no row of the attacker company names the victim\'s ids that did not before', JSON.stringify(namingBefore) === JSON.stringify(namingAfter), `${JSON.stringify(namingBefore)} -> ${JSON.stringify(namingAfter)}`);
  const stamped = await q(`
    select 'PunchItem' as t, count(*)::int as n from "PunchItem" where title like $1
    union all select 'PunchItemEvent', count(*)::int from "PunchItemEvent" where "metadataJson"::text like $2
    union all select 'Rfi', count(*)::int from "Rfi" where subject like $1
    union all select 'Risk', count(*)::int from "Risk" where description like $1 or mitigation like $1
    union all select 'DrawingRecord', count(*)::int from "DrawingRecord" where title like $1
    union all select 'Task', count(*)::int from "Task" where title like $1`, [`${STAMP}-REFUSED%`, `%${STAMP}-REFUSED%`]);
  check('no refused request left a punch item, distribution, RFI, risk, drawing or task', stamped.every((r) => r.n === 0), stamped.map((r) => `${r.t} ${r.n}`).join(', '));
  const side = [];
  const seen = [];
  for (const table of ['AuditEvent', 'OutboundEvent', 'Notification']) {
    const rows = await q(`select "entityType" as type, "entityId" as id, to_jsonb(t)::text as body from "${table}" t where "orgId" = $1 and "createdAt" >= $2::timestamp`, [attackerOrg, start]);
    seen.push(`${table} ${rows.length}`);
    for (const row of rows) {
      if (victimIds.some((v) => row.body.includes(v))) side.push(`${table} ${row.type} ${row.id} names a victim id`);
      else if (row.body.includes(`${STAMP}-REFUSED`)) side.push(`${table} ${row.type} ${row.id} carries a refused request's stamp`);
      else if (row.id && !allowedIds.has(row.id)) side.push(`${table} ${row.type} ${row.id} is not one of the allowed requests' records`);
    }
  }
  const events = await q(`select "punchItemId" as id, action, coalesce("metadataJson"::text, '') as body from "PunchItemEvent" where "orgId" = $1 and "createdAt" >= $2::timestamp`, [attackerOrg, start]);
  for (const event of events) {
    if (!allowedIds.has(event.id) || victimIds.some((v) => event.body.includes(v)) || event.body.includes(`${STAMP}-REFUSED`)) side.push(`PunchItemEvent ${event.action} ${event.id}`);
  }
  seen.push(`PunchItemEvent ${events.length}`);
  const victimNotes = await q(`select count(*)::int as n from "Notification" where "recipientUserId" = $1 and "createdAt" >= $2::timestamp`, [foreign.user, start]);
  if (victimNotes[0].n) side.push(`${victimNotes[0].n} notification(s) to the victim's person`);
  const jobs = await q(`select id, coalesce("payloadJson"::text, '') as body from "BackgroundJob" where "orgId" = $1 and "createdAt" >= $2::timestamp`, [attackerOrg, start]);
  for (const job of jobs) if (victimIds.some((v) => job.body.includes(v)) || job.body.includes(`${STAMP}-REFUSED`)) side.push(`BackgroundJob ${job.id}`);
  seen.push(`BackgroundJob ${jobs.length}`);
  check('no audit row, outbound event, notification, distribution event or job was written for a refused request', side.length === 0, side.length ? side.slice(0, 6).join('; ') : `since the start: ${seen.join(', ')} — each of an allowed request's record`);
  if (INPROCESS) {
    const toVictim = emails.filter((line) => line.includes(`@c${VICTIM}.octapm-cert.test`));
    check('no e-mail went to the victim company\'s people', toVictim.length === 0, `${emails.length} e-mail(s) in all; ${toVictim.length} to @c${VICTIM}`);
  }

  // ── nothing returned, nothing of the victim's moved ──────────────────────
  const traces = [`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`];
  for (const { name } of foreignNames) if (name && name.length > 6) traces.push(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const victimTraces = new RegExp(traces.join('|'));
  const leaked = answers.filter((a) => victimTraces.test(a.text));
  check('no answer to the attacker carries the victim company\'s names, addresses or canaries', leaked.length === 0, leaked.slice(0, 5).map((a) => `${a.status} ${a.route}`).join(', '));
  const errors = answers.filter((a) => a.status >= 500);
  check('no answer is a server error', errors.length === 0, errors.slice(0, 5).map((a) => `${a.status} ${a.route}`).join(', '));
  const after = await snapshot();
  const moved = fingerprint.compare(before, after).filter((c) => !c.noise && c.org === VICTIM);
  check('the victim company\'s data did not change (every table)', moved.length === 0, moved.slice(0, 8).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
  await db.end();

  const failed = results.filter((r) => !r.ok);
  console.log(`\npunch-rfi-tasks proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
