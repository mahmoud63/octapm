'use strict';

/**
 * The CERT-2 state-gap proof of the schedule and structure pairs: five
 * (route, field) pairs whose every injection in the sweep was refused by the
 * attacker's OWN record state (409) or own billing (402) before the product
 * looked at the foreign identifier (C:/Temp/octapm-cert/scratch/gap-pairs.json):
 *
 *   POST /projects/{projectId}/activities                engineerIds[]                (user)              hidden by 409 ACTIVITY_CODE_CONFLICT
 *   POST /projects/{projectId}/activities                dependencies[].predecessorId (activity)          hidden by 409 ACTIVITY_CODE_CONFLICT
 *   POST /projects/{projectId}/structure/wbs             ownerPartyId                 (project_party)     hidden by 409 WBS_NODE_DUPLICATE_CODE
 *   POST /projects/{projectId}/workflows/instances       templateId                   (workflow_template) hidden by 409 WORKFLOW_ALREADY_RUNNING
 *   POST /projects/{projectId}/doc-control/{type}/{id}/revisions
 *                                                        projectDocumentId            (project_document)  hidden by 409 DOCUMENT_REVISION_EXISTS
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/schedule-structure-state-proof.js [attacker=040] [victim=041]
 *
 * For each pair the attacker company's own people put their OWN record into
 * the state where the request is accepted — a fresh activity code, a fresh WBS
 * code, a fresh correspondence with no workflow running, a fresh drawing and a
 * revision code it does not have yet — and then, on that same open record:
 *   REFUSED  the victim company's id of that kind is refused with a 4xx (never
 *            a 5xx), with exactly the status, code and message an id that
 *            exists nowhere gets, and nothing is stored;
 *   ALLOWED  then the attacker's own id, with the SAME code / record, is
 *            accepted (2xx) and stored — which proves the record was open
 *            when the foreign id was refused (no 409 hid the reference).
 * The edit routes and alternative fields that carry the same reference are
 * proven the same way (PATCH /structure/wbs/{id} ownerPartyId; a revision's
 * documentId and storageKey; an engineer list mixing own and foreign people).
 *
 * After all cases: no answer is a 5xx; no answer carries company 041's canary
 * text, people's addresses, company name or any identifier of company 041
 * other than the one the request itself sent (the sweep's judge, inject.js:
 * an echo of the caller's own input is not a disclosure — the nowhere id is
 * echoed the same way, which the same-answer check proves); no row of the
 * attacker company names any of the victim's ids that did not before; and
 * the victim company's data did not change in any table (fingerprint).
 *
 * Re-runnable: every run makes its own records under a fresh stamp.
 * Exit code 0 when every check holds, 2 otherwise.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { as } = require('../lib/api');
const { buildPopulation } = require('../lib/spec');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');
const { byName, ownedModels, ownerSql, tableOf } = require('../lib/tenant-map');

const GROUP = 'schedule-structure';
const ATTACKER = process.argv[2] || '040';
const VICTIM = process.argv[3] || '041';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `SS${ATTACKER}${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const INPROCESS = process.env.CERT_INPROCESS === '1';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const results = [];
const answers = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const info = (text) => console.log(`      ${text}`);
const said = (res) => `${res.status} ${res.body?.error?.code || ''} ${res.body?.error?.message || ''}`.trim();
const ok2xx = (res) => res.status >= 200 && res.status < 300;
const is4xx = (res) => res.status >= 400 && res.status < 500;
const nowhereId = () => crypto.randomUUID();

/**
 * The answer with the request id dropped, the id the request sent read as
 * <sent>, and every other identifier read as <id> (a rolled-back record's
 * fresh id differs between two calls); company 041's identifiers are judged
 * separately, so normalising them here hides nothing.
 */
const normalised = (res, sent) => {
  const body = res.body && typeof res.body === 'object' ? JSON.parse(JSON.stringify(res.body)) : res.text;
  if (body?.error) delete body.error.requestId;
  return JSON.stringify(body ?? null).split(sent).join('<sent>').replace(UUID, '<id>');
};

// In process the product's local e-mail transport writes each message to the
// console; they are counted and kept out of the proof's output.
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
  console.log(`${GROUP} state proof — attacker ${ATTACKER}, victim ${VICTIM}, stamp ${STAMP}${INPROCESS ? ', in process (the working tree\'s code)' : ', AGAINST A SERVER (does not prove the working tree)'}\n`);
  const { companies } = buildPopulation();
  const attacker = companies.find((c) => c.code === ATTACKER);
  const victim = companies.find((c) => c.code === VICTIM);
  if (!attacker || !victim) throw new Error(`unknown company ${ATTACKER} or ${VICTIM}`);

  const db = await guard.connectCert();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const one = async (sql, params = []) => (await q(sql, params))[0] || null;
  const orgOf = async (code) => (await one('select id::text as id from "Organisation" where slug like $1', [`cert-${code}-%`]))?.id || null;
  const attackerOrg = await orgOf(ATTACKER);
  const victimOrg = await orgOf(VICTIM);
  if (!attackerOrg || !victimOrg) throw new Error('both companies must exist in the certification database');
  const codeOfOrg = (orgId) => (orgId === attackerOrg ? ATTACKER : orgId === victimOrg ? VICTIM : orgId ? `other(${orgId.slice(0, 8)})` : 'nowhere');

  // ── the projects: each company's first standard project ──────────────────
  const inventory = (code) => JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'inventory', `${code}.json`), 'utf8'));
  const standard = (inv) => Object.values(inv.projects).find((p) => p.depth === 'standard' && p.refs?.activities && p.refs?.parties);
  const A = standard(inventory(ATTACKER));
  const V = standard(inventory(VICTIM));
  if (!A || !V) throw new Error('both companies need a standard project with activities and parties');
  const projectOrg = async (projectId) => (await one('select "orgId"::text as org from "Project" where id = $1', [projectId]))?.org || null;
  check(`setup: project ${A.id} is company ${ATTACKER}'s and project ${V.id} is company ${VICTIM}'s`, (await projectOrg(A.id)) === attackerOrg && (await projectOrg(V.id)) === victimOrg);

  // ── the ids, each proven by its owner in the database ────────────────────
  const memberOf = async (userId, orgId) => Boolean(await one(`select 1 from "OrganizationMembership" where "userId" = $1 and "orgId" = $2 and status = 'active'`, [userId, orgId]));
  const userByEmail = async (email) => (await one('select id::text as id from "User" where email = $1', [email]))?.id || null;
  const own = {
    user: await userByEmail(`site@${attacker.domain}`),
    activity: (await one(`select id::text as id from "Activity" where "projectId" = $1 and "isActive" order by "sortOrder", "createdAt" limit 1`, [A.id]))?.id,
    party: (await one(`select id::text as id from "ProjectParty" where "projectId" = $1 and status = 'active' order by "createdAt" limit 1`, [A.id]))?.id,
    template: (await one(`select id::text as id from "WorkflowTemplate" where "orgId" = $1 and tool = 'correspondence' and status = 'active' and ("projectId" = $2 or "projectId" is null) order by ("projectId" is null), "createdAt" limit 1`, [attackerOrg, A.id]))?.id,
  };
  // The victim's: an active member, an active activity and party of its
  // project, its company-wide correspondence template (the one an unscoped
  // lookup would take: same tool, active, no project), and a clean, available
  // document of its project.
  const foreign = {
    user: await userByEmail(`site@${victim.domain}`),
    activity: (await one(`select id::text as id from "Activity" where "projectId" = $1 and "isActive" order by "sortOrder", "createdAt" limit 1`, [V.id]))?.id,
    party: (await one(`select id::text as id from "ProjectParty" where "projectId" = $1 and status = 'active' order by "createdAt" limit 1`, [V.id]))?.id,
    template: (await one(`select id::text as id from "WorkflowTemplate" where "orgId" = $1 and tool = 'correspondence' and status = 'active' order by ("projectId" is null) desc, "createdAt" limit 1`, [victimOrg]))?.id,
    document: await one(`select id::text as id, "storageKey" as "storageKey", status, "linkedEntityType", "linkedEntityId" from "ProjectDocument" where "projectId" = $1 and "orgId" = $2 and "scanStatus" = 'clean' and status = 'available' order by "createdAt" limit 1`, [V.id, victimOrg]),
  };
  const ownerOrg = {
    activity: async (id) => (await one('select p."orgId"::text as org from "Activity" t join "Project" p on p.id = t."projectId" where t.id = $1', [id]))?.org,
    party: async (id) => (await one('select p."orgId"::text as org from "ProjectParty" t join "Project" p on p.id = t."projectId" where t.id = $1', [id]))?.org,
    template: async (id) => (await one('select "orgId"::text as org from "WorkflowTemplate" where id = $1', [id]))?.org,
    document: async (id) => (await one('select "orgId"::text as org from "ProjectDocument" where id = $1', [id]))?.org,
  };
  check(`setup: user ${own.user} is an active member of company ${ATTACKER}`, own.user && (await memberOf(own.user, attackerOrg)));
  check(`setup: user ${foreign.user} is an active member of company ${VICTIM} and not of company ${ATTACKER}`, foreign.user && (await memberOf(foreign.user, victimOrg)) && !(await one('select 1 from "OrganizationMembership" where "userId" = $1 and "orgId" = $2', [foreign.user, attackerOrg])));
  for (const kind of ['activity', 'party', 'template']) {
    const mine = own[kind] ? codeOfOrg(await ownerOrg[kind](own[kind])) : 'missing';
    const theirs = foreign[kind] ? codeOfOrg(await ownerOrg[kind](foreign[kind])) : 'missing';
    check(`setup: ${kind} ${own[kind]} is company ${ATTACKER}'s and ${foreign[kind]} is company ${VICTIM}'s`, mine === ATTACKER && theirs === VICTIM, `owners ${mine} / ${theirs}`);
  }
  const docOwner = foreign.document ? codeOfOrg(await ownerOrg.document(foreign.document.id)) : 'missing';
  check(`setup: project document ${foreign.document?.id} (clean, available) is company ${VICTIM}'s`, docOwner === VICTIM, `owner ${docOwner}`);
  if (!Object.values(own).every(Boolean) || !Object.values(foreign).every(Boolean)) throw new Error('setup incomplete');
  const foreignIds = [foreign.user, foreign.activity, foreign.party, foreign.template, foreign.document.id, foreign.document.storageKey].filter(Boolean);
  console.log(`\nown: ${JSON.stringify(own)}\nforeign: ${JSON.stringify({ ...foreign, document: foreign.document.id })}\n`);

  // ── the rows of the attacker company that name a victim id ───────────────
  const SKIP = new Set(['RefreshSession', 'AuthAuditEvent', 'UserSetting', 'PushSubscription', 'InvitationToken', 'Organisation', 'User', 'OrganizationMembership']);
  const namingRows = async () => {
    const found = new Set();
    const patterns = foreignIds.map((id) => `%${id}%`);
    for (const modelName of ownedModels()) {
      if (SKIP.has(modelName)) continue;
      const owner = ownerSql(modelName);
      const model = byName.get(modelName);
      const pk = model.fields.find((f) => f.isId);
      if (!owner || !pk) continue;
      const idColumn = `"${pk.dbName || pk.name}"`;
      const rows = (await db.query(`select t.${idColumn}::text as id, to_jsonb(t)::text as body from "${tableOf(model)}" t join (${owner}) o on o.id = t.${idColumn}::text where o.org = $1 and to_jsonb(t)::text like any($2)`, [attackerOrg, patterns])).rows;
      for (const row of rows) for (const id of foreignIds) if (row.body.includes(id)) found.add(`${modelName} ${row.id} -> ${id}`);
    }
    return found;
  };
  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const print2 = await fingerprint.take(db);
    await db.query('rollback');
    return print2;
  };
  const namingBefore = await namingRows();
  const before = await snapshot();

  const pm = as(`pm@${attacker.domain}`);
  const AP = `/projects/${A.id}`;
  const send = async (label, method, route, body, sent = null) => {
    const res = await pm.send(method, route, body);
    answers.push({ label, route: `${method} ${route}`, status: res.status, text: res.text || '', sent });
    return res;
  };

  /** The shared judgement of one refused reference against the nowhere control. */
  const judge = ({ label, kind, bad, none, sentBad, sentNone, storedBad, storedNone }) => {
    check(`${label}: company ${VICTIM}'s ${kind} is refused with a 4xx, not a 5xx`, is4xx(bad), said(bad));
    check(`${label}: …exactly as an id that exists nowhere (status, code, message)`, said(bad) === said(none), `${said(bad)} | ${said(none)}`);
    check(`${label}: …and the whole answer is the nowhere answer once the id sent is read as its counterpart`, normalised(bad, sentBad) === normalised(none, sentNone), `${normalised(bad, sentBad).slice(0, 300)}\n        ${normalised(none, sentNone).slice(0, 300)}`);
    check(`${label}: …nothing stored`, !storedBad && !storedNone, [storedBad && `STORED (foreign): ${storedBad}`, storedNone && `STORED (nowhere): ${storedNone}`].filter(Boolean).join('; '));
    if ((bad.text || '').includes(sentBad)) info(`(the refusal echoes the id it was sent, as it echoes the nowhere id: ${bad.body?.error?.details ? JSON.stringify(bad.body.error.details).slice(0, 200) : ''})`);
  };

  // ── 1. POST /activities engineerIds[] ────────────────────────────────────
  {
    const label = 'POST /activities engineerIds[]';
    const code = `${STAMP}-E`;
    const body = (engineerIds) => ({ name: `${STAMP} engineer probe`, activityCode: code, category: 'civil', duration: 2, isMilestone: false, sortOrder: 900, engineerIds });
    const activityWithCode = async () => one('select id::text as id from "Activity" where "projectId" = $1 and "activityCode" = $2', [A.id, code]);
    const assignmentsOf = async (userId) => Number((await one('select count(*)::int n from "ActivityAssignment" where "userId" = $1', [userId])).n);
    const foreignAssignmentsBefore = await assignmentsOf(foreign.user);
    check(`${label}: setup — activity code ${code} is free in project ${ATTACKER}`, !(await activityWithCode()));
    const sentNone = nowhereId();
    const bad = await send(label, 'POST', `${AP}/activities`, body([foreign.user]), foreign.user);
    const storedBad = await activityWithCode();
    const none = await send(label, 'POST', `${AP}/activities`, body([sentNone]), sentNone);
    const storedNone = await activityWithCode();
    judge({ label, kind: 'user', bad, none, sentBad: foreign.user, sentNone, storedBad: storedBad && `Activity ${storedBad.id}`, storedNone: storedNone && `Activity ${storedNone.id}` });
    check(`${label}: …no assignment anywhere names company ${VICTIM}'s person`, (await assignmentsOf(foreign.user)) === foreignAssignmentsBefore, `${foreignAssignmentsBefore} -> ${await assignmentsOf(foreign.user)}`);
    // the foreign person beside one of the company's own
    const sentMixNone = nowhereId();
    const mix = await send(label, 'POST', `${AP}/activities`, body([own.user, foreign.user]), foreign.user);
    const mixNone = await send(label, 'POST', `${AP}/activities`, body([own.user, sentMixNone]), sentMixNone);
    check(`${label} [own, foreign]: refused exactly as [own, nowhere], nothing stored`, is4xx(mix) && said(mix) === said(mixNone) && !(await activityWithCode()), `${said(mix)} | ${said(mixNone)}`);
    // ALLOWED, with the same code: the code was free all along
    const ok = await send(label, 'POST', `${AP}/activities`, body([own.user]));
    const made = await activityWithCode();
    const stored = made ? await one('select "userId"::text as u from "ActivityAssignment" where "activityId" = $1', [made.id]) : null;
    check(`${label}: the company's own person, same code ${code}, is accepted (2xx) and stored`, ok2xx(ok) && stored?.u === own.user, `${said(ok)}; assignment ${stored?.u ?? 'none'}`);
  }

  // ── 2. POST /activities dependencies[].predecessorId ─────────────────────
  {
    const label = 'POST /activities dependencies[].predecessorId';
    const code = `${STAMP}-D`;
    const body = (predecessorId) => ({ name: `${STAMP} dependency probe`, activityCode: code, category: 'civil', duration: 2, isMilestone: false, sortOrder: 901, engineerIds: [own.user], dependencies: [{ predecessorId, relationshipType: 'FS', lagDays: 0 }] });
    const activityWithCode = async () => one('select id::text as id from "Activity" where "projectId" = $1 and "activityCode" = $2', [A.id, code]);
    const linksNaming = async (id) => Number((await one('select count(*)::int n from "ActivityDependency" where "predecessorId" = $1 or "successorId" = $1', [id])).n);
    const linksBefore = await linksNaming(foreign.activity);
    check(`${label}: setup — activity code ${code} is free in project ${ATTACKER}`, !(await activityWithCode()));
    const sentNone = nowhereId();
    const bad = await send(label, 'POST', `${AP}/activities`, body(foreign.activity), foreign.activity);
    const storedBad = await activityWithCode();
    const none = await send(label, 'POST', `${AP}/activities`, body(sentNone), sentNone);
    const storedNone = await activityWithCode();
    judge({ label, kind: 'activity', bad, none, sentBad: foreign.activity, sentNone, storedBad: storedBad && `Activity ${storedBad.id}`, storedNone: storedNone && `Activity ${storedNone.id}` });
    check(`${label}: …no dependency anywhere names company ${VICTIM}'s activity that did not before`, (await linksNaming(foreign.activity)) === linksBefore, `${linksBefore} -> ${await linksNaming(foreign.activity)}`);
    // the same reference through predecessorActivityId
    const alias = await send(label, 'POST', `${AP}/activities`, { ...body(undefined), dependencies: [{ predecessorActivityId: foreign.activity, relationshipType: 'FS' }] }, foreign.activity);
    const aliasNone = await send(label, 'POST', `${AP}/activities`, { ...body(undefined), dependencies: [{ predecessorActivityId: sentNone, relationshipType: 'FS' }] }, sentNone);
    check(`${label} (as predecessorActivityId): refused exactly as an id that exists nowhere, nothing stored`, is4xx(alias) && said(alias) === said(aliasNone) && !(await activityWithCode()), `${said(alias)} | ${said(aliasNone)}`);
    const ok = await send(label, 'POST', `${AP}/activities`, body(own.activity));
    const made = await activityWithCode();
    const link = made ? await one('select "predecessorId"::text as p from "ActivityDependency" where "successorId" = $1', [made.id]) : null;
    check(`${label}: the company's own activity, same code ${code}, is accepted (2xx) and stored`, ok2xx(ok) && link?.p === own.activity, `${said(ok)}; predecessor ${link?.p ?? 'none'}`);
  }

  // ── 3. POST /structure/wbs ownerPartyId ──────────────────────────────────
  {
    const label = 'POST /structure/wbs ownerPartyId';
    const code = `${STAMP}-W`;
    const body = (ownerPartyId) => ({ code, name: `${STAMP} package probe`, isPackage: true, ownerPartyId });
    const nodeWithCode = async () => one('select id::text as id, "ownerPartyId"::text as "ownerPartyId" from "WbsNode" where "projectId" = $1 and code = $2', [A.id, code]);
    const nodesNaming = async (id) => Number((await one('select count(*)::int n from "WbsNode" where "ownerPartyId" = $1 and "orgId" <> $2', [id, victimOrg])).n);
    check(`${label}: setup — WBS code ${code} is free in project ${ATTACKER}`, !(await nodeWithCode()));
    const sentNone = nowhereId();
    const bad = await send(label, 'POST', `${AP}/structure/wbs`, body(foreign.party), foreign.party);
    const storedBad = await nodeWithCode();
    const none = await send(label, 'POST', `${AP}/structure/wbs`, body(sentNone), sentNone);
    const storedNone = await nodeWithCode();
    judge({ label, kind: 'project party', bad, none, sentBad: foreign.party, sentNone, storedBad: storedBad && `WbsNode ${storedBad.id} ownerPartyId ${storedBad.ownerPartyId}`, storedNone: storedNone && `WbsNode ${storedNone.id}` });
    check(`${label}: …no node outside company ${VICTIM} names its party`, (await nodesNaming(foreign.party)) === 0, `${await nodesNaming(foreign.party)}`);
    const ok = await send(label, 'POST', `${AP}/structure/wbs`, body(own.party));
    const made = await nodeWithCode();
    check(`${label}: the company's own party, same code ${code}, is accepted (2xx) and stored`, ok2xx(ok) && made?.ownerPartyId === own.party, `${said(ok)}; ownerPartyId ${made?.ownerPartyId ?? 'none'}`);
    // the edit route carries the same field
    if (made) {
      const editLabel = 'PATCH /structure/wbs/{id} ownerPartyId';
      const sentEditNone = nowhereId();
      const edit = await send(editLabel, 'PATCH', `${AP}/structure/wbs/${made.id}`, { ownerPartyId: foreign.party }, foreign.party);
      const editNone = await send(editLabel, 'PATCH', `${AP}/structure/wbs/${made.id}`, { ownerPartyId: sentEditNone }, sentEditNone);
      const after = await nodeWithCode();
      check(`${editLabel}: company ${VICTIM}'s party is refused (4xx) exactly as an id that exists nowhere, and the node keeps its own`, is4xx(edit) && said(edit) === said(editNone) && after?.ownerPartyId === own.party, `${said(edit)} | ${said(editNone)}; node now ${after?.ownerPartyId}`);
      const editOwn = await send(editLabel, 'PATCH', `${AP}/structure/wbs/${made.id}`, { ownerPartyId: own.party, name: `${STAMP} package probe (edited)` });
      check(`${editLabel}: the company's own party is still accepted`, ok2xx(editOwn), said(editOwn));
    }
  }

  // ── 4. POST /workflows/instances templateId ──────────────────────────────
  {
    const label = 'POST /workflows/instances templateId';
    const corr = await send(`${label} (setup)`, 'POST', `${AP}/correspondence`, { direction: 'outgoing', type: 'letter', subject: `${STAMP} workflow probe`, date: new Date().toISOString().slice(0, 10), status: 'open', activityId: own.activity });
    const recordId = corr.body?.data?.id;
    check(`${label}: setup — a fresh correspondence of company ${ATTACKER} with no workflow running`, ok2xx(corr) && recordId && !(await one(`select 1 from "WorkflowInstance" where "recordId" = $1`, [recordId])), said(corr));
    if (!recordId) throw new Error('setup incomplete: correspondence');
    const instancesOf = async () => q('select id::text as id, "templateId"::text as "templateId", status from "WorkflowInstance" where "recordId" = $1', [recordId]);
    const runsNaming = async (id) => Number((await one('select count(*)::int n from "WorkflowInstance" where "templateId" = $1 and "orgId" <> $2', [id, victimOrg])).n);
    const body = (templateId) => ({ tool: 'correspondence', recordId, templateId });
    const sentNone = nowhereId();
    const bad = await send(label, 'POST', `${AP}/workflows/instances`, body(foreign.template), foreign.template);
    const storedBad = (await instancesOf())[0];
    const none = await send(label, 'POST', `${AP}/workflows/instances`, body(sentNone), sentNone);
    const storedNone = (await instancesOf())[0];
    judge({ label, kind: 'workflow template', bad, none, sentBad: foreign.template, sentNone, storedBad: storedBad && `WorkflowInstance ${storedBad.id} template ${storedBad.templateId}`, storedNone: storedNone && `WorkflowInstance ${storedNone.id}` });
    check(`${label}: …no run outside company ${VICTIM} names its template`, (await runsNaming(foreign.template)) === 0, `${await runsNaming(foreign.template)}`);
    const ok = await send(label, 'POST', `${AP}/workflows/instances`, body(own.template));
    const runs = await instancesOf();
    check(`${label}: the company's own template, same record, is accepted (2xx) and stored`, ok2xx(ok) && runs.length === 1 && runs[0].templateId === own.template, `${said(ok)}; runs ${JSON.stringify(runs)}`);
  }

  // ── 5. POST /doc-control/{type}/{id}/revisions projectDocumentId ─────────
  {
    const label = 'POST /doc-control/drawing/{id}/revisions projectDocumentId';
    const drawing = await send(`${label} (setup)`, 'POST', `${AP}/drawings`, { drawingNumber: `${STAMP}-DWG`, title: `${STAMP} revision probe`, status: 'active', activityId: own.activity, issueDate: new Date().toISOString().slice(0, 10) });
    const drawingId = drawing.body?.data?.id;
    const upload = drawingId ? await pm.upload('POST', `${AP}/workflow/uploads`, { field: 'files', filename: `${STAMP}-revision.txt`, contentType: 'text/plain', body: Buffer.from(`${STAMP} revision file\n`, 'utf8') }) : null;
    const ownDoc = (Array.isArray(upload) ? upload[0] : upload)?.documentId || null;
    const revisionCode = `R${STAMP}`;
    const revisionsOf = async () => q('select id::text as id, "projectDocumentId"::text as "projectDocumentId", "storageKey" from "DocumentRevision" where "recordId" = $1 and revision = $2', [drawingId, revisionCode]);
    check(`${label}: setup — a fresh drawing of company ${ATTACKER}, a document of its own, and a revision code it does not have`, ok2xx(drawing) && drawingId && ownDoc && (await revisionsOf()).length === 0, `${said(drawing)}; document ${ownDoc}`);
    if (!drawingId || !ownDoc) throw new Error('setup incomplete: drawing or document');
    const R = `${AP}/doc-control/drawing/${drawingId}/revisions`;
    const revisionsNaming = async () => Number((await one('select count(*)::int n from "DocumentRevision" where ("projectDocumentId" = $1 or "storageKey" = $1 or "storageKey" = $2) and "projectId" <> $3', [foreign.document.id, foreign.document.storageKey, V.id])).n);
    const victimDocBefore = await one('select status, "linkedEntityType", "linkedEntityId"::text as "linkedEntityId" from "ProjectDocument" where id = $1', [foreign.document.id]);
    const body = (extra) => ({ revision: revisionCode, title: `${STAMP} revision`, status: 'submitted', category: 'Drawings', ...extra });
    const sentNone = nowhereId();
    const bad = await send(label, 'POST', R, body({ projectDocumentId: foreign.document.id }), foreign.document.id);
    const storedBad = (await revisionsOf())[0];
    const none = await send(label, 'POST', R, body({ projectDocumentId: sentNone }), sentNone);
    const storedNone = (await revisionsOf())[0];
    judge({ label, kind: 'project document', bad, none, sentBad: foreign.document.id, sentNone, storedBad: storedBad && `DocumentRevision ${storedBad.id} -> ${storedBad.projectDocumentId}`, storedNone: storedNone && `DocumentRevision ${storedNone.id}` });
    // the same file named the other ways the route accepts
    const viaId = await send(label, 'POST', R, body({ documentId: foreign.document.id }), foreign.document.id);
    const viaKey = await send(label, 'POST', R, body({ storageKey: foreign.document.storageKey }), foreign.document.storageKey);
    const viaKeyNone = await send(label, 'POST', R, body({ storageKey: crypto.randomUUID() }));
    check(`${label} (as documentId / storageKey): refused exactly as an id that exists nowhere, nothing stored`, is4xx(viaId) && is4xx(viaKey) && said(viaId) === said(none) && said(viaKey) === said(viaKeyNone) && (await revisionsOf()).length === 0, `${said(viaId)} | ${said(viaKey)} | ${said(viaKeyNone)}`);
    check(`${label}: …no revision outside company ${VICTIM} names its document, and the document is not re-linked`, (await revisionsNaming()) === 0 && JSON.stringify(await one('select status, "linkedEntityType", "linkedEntityId"::text as "linkedEntityId" from "ProjectDocument" where id = $1', [foreign.document.id])) === JSON.stringify(victimDocBefore), `${await revisionsNaming()} revisions; ${JSON.stringify(victimDocBefore)}`);
    const ok = await send(label, 'POST', R, body({ projectDocumentId: ownDoc }));
    const stored = await revisionsOf();
    check(`${label}: the company's own document, same revision ${revisionCode}, is accepted (2xx) and stored`, ok2xx(ok) && stored.length === 1 && stored[0].projectDocumentId === ownDoc, `${said(ok)}; ${JSON.stringify(stored)}`);
  }

  // ── after: traces, server errors, the attacker's rows, the victim's data ──
  // Every identifier in the answers, looked up: which company owns it.
  const answerIds = [...new Set(answers.flatMap((a) => (a.text.match(UUID) || []).map((id) => id.toLowerCase())))];
  const victimOwned = new Set();
  for (const modelName of ownedModels()) {
    const owner = ownerSql(modelName);
    if (!owner || !answerIds.length) continue;
    for (const row of (await db.query(`select o.id from (${owner}) o where o.org = $1 and o.id = any($2)`, [victimOrg, answerIds])).rows) victimOwned.add(row.id.toLowerCase());
  }
  const traces = new RegExp([`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`].join('|'));
  const leaked = answers
    .map((a) => {
      const sent = String(a.sent || '').toLowerCase();
      const ids = (a.text.match(UUID) || []).map((id) => id.toLowerCase()).filter((id) => victimOwned.has(id) && id !== sent);
      const text = (a.text.match(traces) || [])[0];
      return ids.length || text ? `${a.status} ${a.label}: ${[...new Set(ids)].slice(0, 3).join(', ')} ${text || ''}` : null;
    })
    .filter(Boolean);
  check(`no answer to company ${ATTACKER} carries company ${VICTIM}'s canary text, addresses, company name or any identifier it did not send itself`, leaked.length === 0, leaked.slice(0, 6).join('\n        '));
  const errors = answers.filter((a) => a.status >= 500);
  check('no answer is a server error', errors.length === 0, errors.slice(0, 5).map((a) => `${a.status} ${a.route}`).join(', '));
  const namingAfter = await namingRows();
  const fresh = [...namingAfter].filter((row) => !namingBefore.has(row));
  check(`no row of company ${ATTACKER} names an id of company ${VICTIM} that did not before`, fresh.length === 0, fresh.slice(0, 6).join('\n        '));
  const after = await snapshot();
  const moved = fingerprint.compare(before, after).filter((c) => !c.noise && c.org === VICTIM);
  check(`company ${VICTIM}'s data did not change (every table)`, moved.length === 0, moved.slice(0, 8).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
  if (emails.length) info(`(${emails.length} e-mail(s) written by the product's local transport, all from the allowed requests)`);
  await db.end();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${GROUP} state proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
