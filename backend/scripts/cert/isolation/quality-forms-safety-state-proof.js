'use strict';

/**
 * The live proof of the CERT-2 pairs of inspections, NCR closeout and safety
 * closeout that the injection sweep could not judge: every attempt was refused
 * by the attacker's OWN record state (409 FORM_INSTANCE_LOCKED,
 * FORM_DEFICIENCY_EXISTS, NCR_NOT_READY_FOR_CLOSEOUT,
 * SAFETY_NOT_READY_FOR_CLOSEOUT) before the product looked at the foreign id
 * (scratch/gap-pairs.json).
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/quality-forms-safety-state-proof.js [attacker=065] [victim=066]
 *
 * The pairs:
 *   PUT  /projects/{projectId}/forms/{instanceId}/responses                 responses[].itemId = form_item
 *   POST /projects/{projectId}/forms/{instanceId}/items/{itemId}/deficiency assigneeCompanyId = company
 *   POST /projects/{projectId}/forms/{instanceId}/items/{itemId}/deficiency assigneeUserId | managerUserId | finalApproverUserId = user
 *   POST /projects/{projectId}/forms/{instanceId}/signatures                itemId = form_item
 *   POST /projects/{projectId}/ncr/{ncrId}/close                            attachmentRefs[].storageKey = project_document
 *   POST /projects/{projectId}/safety/{incidentId}/close                    attachmentRefs[].storageKey = project_document
 *   POST /projects/{projectId}/safety/{incidentId}/submit                   attachmentRefs[].storageKey = project_document
 *
 * For each pair, on a record of the attacker's own put (through the API, by
 * the attacker's own people) into the state where the request is accepted —
 * a fresh scheduled inspection, an item with no deficiency yet, an open NCR,
 * an open incident:
 *   ALLOWED  the attacker company's own id is accepted and read back stored;
 *   REFUSED  the victim company's id is refused with a 4xx, exactly as an id
 *            that exists nowhere is (status, code and message), and nothing
 *            is stored: the record keeps its state, no row names the id;
 * and the sweep's own request on the sweep's own record is shown still to be
 * answered by that record's state (the reason the pair was hidden).
 *
 * No answer may be a 500 or carry the victim's ids, names, addresses or
 * canaries; no audit row, outbound event, notification, job or e-mail may come
 * from a refused request; the victim company's data must not change in any
 * table. Fresh records and a fresh stamp each run, so it can be run again.
 *
 * Exit code 0 when every check holds, 2 otherwise.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { as, multipart } = require('../lib/api');
const { buildPopulation } = require('../lib/spec');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');

const GROUP = 'quality-forms-safety';
const ATTACKER = process.argv[2] || '065';
const VICTIM = process.argv[3] || '066';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `QFS-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const INPROCESS = process.env.CERT_INPROCESS === '1';
const results = [];
const answers = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const said = (res) => `${res.status} ${res.body?.error?.code || ''} ${res.body?.error?.message || ''}`.trim();
const ok2xx = (res) => res.status >= 200 && res.status < 300;
const is4xx = (res) => res.status >= 400 && res.status < 500;
const nowhere = () => crypto.randomUUID();

// A 1x1 PNG (a drawn signature) and a minimal PDF (closeout evidence).
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'ascii');

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
  console.log(`${GROUP}: attacker ${ATTACKER}, victim ${VICTIM}, stamp ${STAMP}${INPROCESS ? ', in process (the working tree\'s code)' : ' — NOT in process: this asks the running API, which does not run the working tree\'s code, and e-mails cannot be counted'}\n`);
  const { companies } = buildPopulation();
  const attacker = companies.find((c) => c.code === ATTACKER);
  const victim = companies.find((c) => c.code === VICTIM);
  if (!attacker || !victim) throw new Error(`unknown company ${ATTACKER} or ${VICTIM}`);

  const db = await guard.connectCert();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const one = async (sql, params) => (await q(sql, params))[0]?.id || null;
  const orgOf = async (code) => one(`select id from "Organisation" where slug like $1`, [`cert-${code}-%`]);
  const attackerOrg = await orgOf(ATTACKER);
  const victimOrg = await orgOf(VICTIM);
  if (!attackerOrg || !victimOrg) throw new Error('both companies must exist in the certification database');

  // ── the sweep's requests (results/isolation/cert2b-inject.json, else cert2-inject.json) ──
  let sweep = [];
  for (const name of ['cert2b-inject.json', 'cert2-inject.json']) {
    try {
      sweep = JSON.parse(fs.readFileSync(path.join(WORK, 'results', 'isolation', name), 'utf8')).results
        .filter((r) => r.attacker === ATTACKER && r.victim === VICTIM);
      if (sweep.length) break;
    } catch { /* not there: the ids are read from the database */ }
  }
  const pairOf = (method, template, field) => sweep.find((r) => r.method === method && r.template === `/projects/{projectId}${template}` && r.field === field) || null;
  const swept = {
    responses: pairOf('PUT', '/forms/{instanceId}/responses', 'responses[].itemId'),
    assigneeCompanyId: pairOf('POST', '/forms/{instanceId}/items/{itemId}/deficiency', 'assigneeCompanyId'),
    assigneeUserId: pairOf('POST', '/forms/{instanceId}/items/{itemId}/deficiency', 'assigneeUserId'),
    managerUserId: pairOf('POST', '/forms/{instanceId}/items/{itemId}/deficiency', 'managerUserId'),
    finalApproverUserId: pairOf('POST', '/forms/{instanceId}/items/{itemId}/deficiency', 'finalApproverUserId'),
    signatures: pairOf('POST', '/forms/{instanceId}/signatures', 'itemId'),
    ncrClose: pairOf('POST', '/ncr/{ncrId}/close', 'attachmentRefs[].storageKey'),
    safetyClose: pairOf('POST', '/safety/{incidentId}/close', 'attachmentRefs[].storageKey'),
    safetySubmit: pairOf('POST', '/safety/{incidentId}/submit', 'attachmentRefs[].storageKey'),
  };
  for (const [name, row] of Object.entries(swept)) {
    console.log(`sweep ${name}: ${row ? `${row.method} ${row.route} [${row.field}] -> ${row.status} ${row.code} ${row.verdict}` : '(not in the sweep results; built from the database)'}`);
  }

  // ── the attacker's project, people, companies and templates ──────────────
  const sweptProject = Object.values(swept).find(Boolean)?.route.split('/')[2] || null;
  const projectId = (sweptProject && await one(`select id from "Project" where id = $1 and "orgId" = $2`, [sweptProject, attackerOrg]))
    || await one(`select p.id from "Project" p where p."orgId" = $1 and p.status = 'active' and exists (select 1 from "FormTemplate" t join "FormItem" i on i."templateId" = t.id where t."orgId" = p."orgId" and t.status = 'active' and (t."projectId" = p.id or t."projectId" is null) and i."responseType" = 'signature') order by p."createdAt" limit 1`, [attackerOrg]);
  const person = (local) => one(`select u.id from "User" u join "OrganizationMembership" m on m."userId" = u.id where m."orgId" = $1 and m.status = 'active' and u.email = $2`, [attackerOrg, `${local}@${attacker.domain}`]);
  const own = {
    project: projectId,
    site: await person('site'),
    pm: await person('pm'),
    quality: await person('quality'),
    planner: await person('planner'),
    company: await one(`select id from "Company" where "orgId" = $1 order by "createdAt" limit 1`, [attackerOrg]),
    company2: await one(`select id from "Company" where "orgId" = $1 order by "createdAt" offset 1 limit 1`, [attackerOrg]),
  };
  const visibleTemplate = (extra) => one(`select t.id from "FormTemplate" t where t."orgId" = $1 and t.status = 'active' and (t."projectId" = $2 or t."projectId" is null) and ${extra} order by (t."projectId" is null), t."createdAt" limit 1`, [attackerOrg, projectId]);
  const checkTemplate = await visibleTemplate(`(select count(*) from "FormItem" i where i."templateId" = t.id and i."responseType" in ('pass_fail', 'yes_no')) >= 2`);
  const signTemplate = await visibleTemplate(`exists (select 1 from "FormItem" i where i."templateId" = t.id and i."responseType" = 'signature')`);
  const checkItems = checkTemplate ? await q(`select i.id, i."responseType" from "FormItem" i join "FormSection" s on s.id = i."sectionId" where i."templateId" = $1 and i."responseType" in ('pass_fail', 'yes_no') order by s."sortOrder", i."sortOrder"`, [checkTemplate]) : [];
  const signItem = signTemplate ? await one(`select id from "FormItem" where "templateId" = $1 and "responseType" = 'signature' order by "sortOrder" limit 1`, [signTemplate]) : null;
  check('setup: the project is the attacker company\'s own', Boolean(projectId), projectId || 'none');
  check('setup: the attacker company has its own people, two companies, a checklist template and a signature template', Object.values(own).every(Boolean) && checkItems.length >= 2 && signItem, JSON.stringify({ ...own, checkTemplate, signTemplate, signItem }));
  if (!projectId || !Object.values(own).every(Boolean) || checkItems.length < 2 || !signItem) throw new Error('setup incomplete');

  // ── the victim's ids, each proven by its owner ───────────────────────────
  const victimOne = (sql) => one(sql, [victimOrg]);
  const foreign = {
    user: swept.assigneeUserId?.foreign || await victimOne(`select u.id from "User" u join "OrganizationMembership" m on m."userId" = u.id where m."orgId" = $1 and m.status = 'active' order by u.email limit 1`),
    company: swept.assigneeCompanyId?.foreign || await victimOne(`select id from "Company" where "orgId" = $1 order by "createdAt" limit 1`),
    formItem: swept.responses?.foreign || swept.signatures?.foreign || await victimOne(`select i.id from "FormItem" i join "FormTemplate" t on t.id = i."templateId" where t."orgId" = $1 and i."responseType" = 'pass_fail' order by i."createdAt" limit 1`),
    signatureItem: await victimOne(`select i.id from "FormItem" i join "FormTemplate" t on t.id = i."templateId" where t."orgId" = $1 and i."responseType" = 'signature' order by i."createdAt" limit 1`),
    document: swept.ncrClose?.foreign || swept.safetyClose?.foreign || await victimOne(`select id from "ProjectDocument" where "orgId" = $1 and "documentType" = 'workflow_attachment' order by "createdAt" limit 1`),
  };
  foreign.documentKey = (await q(`select "storageKey" as k from "ProjectDocument" where id = $1`, [foreign.document]))[0]?.k || null;
  const ownerOf = {
    user: (await q(`select (select count(*)::int from "OrganizationMembership" where "userId" = $1 and "orgId" = $2 and status <> 'left') as v, (select count(*)::int from "OrganizationMembership" where "userId" = $1 and "orgId" = $3 and status <> 'left') as a`, [foreign.user, victimOrg, attackerOrg]))[0],
    company: await one(`select "orgId" as id from "Company" where id = $1`, [foreign.company]),
    formItem: await one(`select t."orgId" as id from "FormItem" i join "FormTemplate" t on t.id = i."templateId" where i.id = $1`, [foreign.formItem]),
    signatureItem: await one(`select t."orgId" as id from "FormItem" i join "FormTemplate" t on t.id = i."templateId" where i.id = $1`, [foreign.signatureItem]),
    document: await one(`select "orgId" as id from "ProjectDocument" where id = $1`, [foreign.document]),
    documentKey: await one(`select "orgId" as id from "ProjectDocument" where "storageKey" = $1 or id = $1 order by ("orgId" = $2) desc limit 1`, [foreign.documentKey, attackerOrg]),
  };
  check('setup: the foreign person is a member of the victim company and not of the attacker company', ownerOf.user?.v === 1 && ownerOf.user?.a === 0, `${foreign.user} victim=${ownerOf.user?.v} attacker=${ownerOf.user?.a}`);
  for (const kind of ['company', 'formItem', 'signatureItem', 'document', 'documentKey']) {
    check(`setup: the foreign ${kind} is the victim company's`, ownerOf[kind] === victimOrg, `${foreign[kind]} -> ${ownerOf[kind]}`);
  }
  if (!(ownerOf.user?.v === 1 && ownerOf.user?.a === 0) || ['company', 'formItem', 'signatureItem', 'document', 'documentKey'].some((kind) => ownerOf[kind] !== victimOrg)) throw new Error('setup incomplete');
  const victimIds = [...new Set(Object.values(foreign))];
  // A victim name that the attacker company also uses (a starter template's item label) is not a trace.
  const ownNames = new Set((await q(`select name from "Company" where "orgId" = $1 union select u.name from "User" u join "OrganizationMembership" m on m."userId" = u.id where m."orgId" = $1 union select i.label as name from "FormItem" i join "FormTemplate" t on t.id = i."templateId" where t."orgId" = $1 union select "originalName" as name from "ProjectDocument" where "orgId" = $1`, [attackerOrg])).map((r) => r.name));
  const victimNames = (await q(`select name from "Company" where id = $1 union select name from "User" where id = $2 union select label as name from "FormItem" where id = any($3::text[]) union select "originalName" as name from "ProjectDocument" where id = $4`, [foreign.company, foreign.user, [foreign.formItem, foreign.signatureItem], foreign.document]))
    .map((r) => r.name).filter((name) => name && name.length > 6 && !ownNames.has(name));

  const people = { site: as(`site@${attacker.domain}`), quality: as(`quality@${attacker.domain}`), pm: as(`pm@${attacker.domain}`) };
  const P = `/projects/${projectId}`;
  const send = async (who, method, route, body, options = {}) => {
    const res = await people[who].send(method, route, body, options);
    answers.push({ route: `${method} ${route}`, status: res.status, text: res.text || '' });
    return res;
  };
  // The records the allowed requests made: every side row since the start must be one of theirs.
  const allowedIds = new Set();
  const keepIds = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(keepIds);
      return;
    }
    for (const key of ['id', 'documentId']) if (typeof value[key] === 'string') allowedIds.add(value[key]);
    for (const key of ['record', 'instance', 'signature', 'nextInstance']) keepIds(value[key]);
  };
  const keep = (res) => {
    if (ok2xx(res)) keepIds(res.body?.data);
    return res;
  };

  // ── before ───────────────────────────────────────────────────────────────
  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const taken = await fingerprint.take(db);
    await db.query('rollback');
    return taken;
  };
  const before = await snapshot();
  // Rows of the attacker company that name any of the victim's ids.
  const NAMING = {
    FormInstance: `select count(*)::int as n from "FormInstance" t where t."orgId" = $1`,
    FormItemResponse: `select count(*)::int as n from "FormItemResponse" t join "FormInstance" f on f.id = t."instanceId" where f."orgId" = $1`,
    Signature: `select count(*)::int as n from "Signature" t where t."orgId" = $1`,
    PunchItem: `select count(*)::int as n from "PunchItem" t where t."orgId" = $1`,
    NcrRecord: `select count(*)::int as n from "NcrRecord" t join "Project" p on p.id = t."projectId" where p."orgId" = $1`,
    SafetyIncident: `select count(*)::int as n from "SafetyIncident" t join "Project" p on p.id = t."projectId" where p."orgId" = $1`,
    WorkflowAttachment: `select count(*)::int as n from "WorkflowAttachment" t join "Project" p on p.id = t."projectId" where p."orgId" = $1`,
    WorkflowStatusHistory: `select count(*)::int as n from "WorkflowStatusHistory" t join "Project" p on p.id = t."projectId" where p."orgId" = $1`,
    ApprovalWorkflowEvent: `select count(*)::int as n from "ApprovalWorkflowEvent" t where t."orgId" = $1`,
    Attachment: `select count(*)::int as n from "Attachment" t where t."orgId" = $1`,
    ProjectDocument: `select count(*)::int as n from "ProjectDocument" t where t."orgId" = $1`,
  };
  const naming = async () => {
    const counts = {};
    for (const [table, sql] of Object.entries(NAMING)) {
      counts[table] = (await q(`${sql} and (${victimIds.map((_, i) => `to_jsonb(t)::text like '%' || $${i + 2} || '%'`).join(' or ')})`, [attackerOrg, ...victimIds]))[0].n;
    }
    return counts;
  };
  const namingBefore = await naming();
  const start = (await q(`select to_char((now() at time zone 'UTC') - interval '1 second', 'YYYY-MM-DD HH24:MI:SS.MS') as s`))[0].s;

  /** The victim's id refused with a 4xx, exactly as an id that exists nowhere is; no e-mail sent. */
  const refused = async (label, attempt, foreignId, expect) => {
    const sent = emails.length;
    const bad = await attempt(foreignId, 'REFUSED');
    const none = await attempt(nowhere(), 'REFUSED');
    check(`${label}: another company's id is refused (${expect})`, is4xx(bad) && said(bad).startsWith(expect), said(bad));
    check(`${label}: …exactly as an id that exists nowhere (status, code, message)`, said(bad) === said(none), `${said(bad)} | ${said(none)}`);
    if (INPROCESS) check(`${label}: no e-mail was sent`, emails.length === sent, `${emails.length - sent} sent`);
    return bad;
  };
  const allowed = async (label, attempt, ownId) => {
    const res = keep(await attempt(ownId, 'ALLOWED'));
    check(`${label}: the company's own id is accepted`, ok2xx(res), said(res));
    return res;
  };
  const value = async (sql, params) => (await q(sql, params))[0] || null;
  /** The sweep's own request on the sweep's own record, still answered by that record's state. */
  const reproduce = async (label, row, who, body) => {
    if (!row) return;
    const res = await send(who, row.method, row.route, body);
    check(`${label}: the sweep's own record still answers ${row.status} ${row.code} (its own state, before the id is looked at)`, `${res.status} ${res.body?.error?.code}` === `${row.status} ${row.code}`, said(res));
  };

  const newInstance = async (templateId, tag) => {
    const res = keep(await send('site', 'POST', `${P}/forms`, { templateId, title: `${STAMP} ${tag}`, assigneeUserId: own.site, assigneeCompanyId: own.company, inspectorUserId: own.quality, approverUserId: own.pm, dueDate: '2026-12-31' }));
    const id = res.body?.data?.id || null;
    const row = id ? await value(`select status, "orgId" from "FormInstance" where id = $1`, [id]) : null;
    check(`open state: a fresh inspection of the attacker's own (${tag}) is scheduled`, res.status === 201 && row?.status === 'scheduled' && row?.orgId === attackerOrg, `${said(res)} ${row?.status}`);
    if (!id) throw new Error(`could not create an inspection: ${said(res)}`);
    return id;
  };
  const answerFor = (item) => (item.responseType === 'yes_no' ? 'yes' : 'pass');

  // ── 1. PUT responses: responses[].itemId ─────────────────────────────────
  {
    const [itemA, itemB] = checkItems;
    const inst = await newInstance(checkTemplate, 'responses');
    const put = (extra = []) => (id, tag) => send('site', 'PUT', `${P}/forms/${inst}/responses`, { responses: [...extra, { itemId: id, value: answerFor(itemA), note: `${STAMP}-${tag} answer` }] });
    const label = 'PUT forms/{id}/responses responses[].itemId';
    await refused(label, put(), foreign.formItem, '400 FORM_ITEM_NOT_FOUND');
    await refused(`${label} (a batch whose second answer names it is refused whole)`, put([{ itemId: itemB.id, value: answerFor(itemB), note: `${STAMP}-REFUSED own answer in a refused batch` }]), foreign.formItem, '400 FORM_ITEM_NOT_FOUND');
    const kept = await q(`select "itemId" from "FormItemResponse" where "instanceId" = $1`, [inst]);
    const state = await value(`select status from "FormInstance" where id = $1`, [inst]);
    check(`${label}: the refused requests stored no answer (not even the batch's own) and left the inspection scheduled`, kept.length === 0 && state?.status === 'scheduled', `${kept.length} answers, ${state?.status}`);
    await allowed(label, put(), itemA.id);
    const stored = await value(`select value from "FormItemResponse" where "instanceId" = $1 and "itemId" = $2`, [inst, itemA.id]);
    check(`${label}: the own item's answer is stored`, stored?.value === answerFor(itemA), `FormItemResponse.value = ${stored?.value}`);
    await refused(`${label} (the inspection now in progress)`, put(), foreign.formItem, '400 FORM_ITEM_NOT_FOUND');
    const after = await q(`select "itemId" from "FormItemResponse" where "instanceId" = $1`, [inst]);
    check(`${label}: the inspection holds only the own answer`, after.length === 1 && after[0].itemId === itemA.id, JSON.stringify(after));
    await reproduce(label, swept.responses, 'site', { responses: [{ itemId: foreign.formItem, value: 'pass' }] });
  }

  // ── 2–5. POST deficiency: assigneeCompanyId, assigneeUserId, managerUserId, finalApproverUserId ──
  const DEFICIENCY = [
    ['assigneeCompanyId', 'company', '404 COMPANY_NOT_FOUND', own.company2],
    ['assigneeUserId', 'user', '404 USER_NOT_FOUND', own.planner],
    ['managerUserId', 'user', '404 USER_NOT_FOUND', own.planner],
    ['finalApproverUserId', 'user', '404 USER_NOT_FOUND', own.planner],
  ];
  const base = { priority: 'high', trade: 'Blockwork', locationText: `${STAMP} grid B4`, assigneeCompanyId: own.company, assigneeUserId: own.site, managerUserId: own.pm, finalApproverUserId: own.quality, dueDate: '2026-12-15' };
  for (const [field, kind, expect, ownId] of DEFICIENCY) {
    const inst = await newInstance(checkTemplate, `deficiency ${field}`);
    const item = checkItems[0];
    const raise = (id, tag) => send('site', 'POST', `${P}/forms/${inst}/items/${item.id}/deficiency`, { target: 'punch_item', ...base, title: `${STAMP}-${tag} deficiency ${field}`, [field]: id });
    const label = `POST forms/{id}/items/{itemId}/deficiency ${field}`;
    await refused(label, raise, foreign[kind], expect);
    const punch = await q(`select id from "PunchItem" where "sourceRecordId" = $1`, [inst]);
    const response = await value(`select "deficiencyRecordId" from "FormItemResponse" where "instanceId" = $1 and "itemId" = $2`, [inst, item.id]);
    check(`${label}: the refused requests raised no punch item and linked nothing to the item`, punch.length === 0 && !response?.deficiencyRecordId, `${punch.length} punch item(s), deficiencyRecordId ${response?.deficiencyRecordId || null}`);
    const made = await allowed(label, raise, ownId);
    const recordId = made.body?.data?.record?.id || null;
    const row = recordId ? await value(`select to_jsonb(t)->>$2 as v, "sourceRecordId", "orgId" from "PunchItem" t where id = $1`, [recordId, field]) : null;
    check(`${label}: the own id is stored on the raised punch item`, row?.v === ownId && row?.sourceRecordId === inst && row?.orgId === attackerOrg, `PunchItem.${field} = ${row?.v}`);
    const linked = await value(`select "deficiencyRecordId" from "FormItemResponse" where "instanceId" = $1 and "itemId" = $2`, [inst, item.id]);
    check(`${label}: the item now links the raised punch item`, linked?.deficiencyRecordId === recordId, `deficiencyRecordId ${linked?.deficiencyRecordId}`);
    // The state the sweep met: the item has its record now.
    const hidden = await raise(foreign[kind], 'REFUSED');
    check(`${label}: on the item that now has a record the request is answered 409 FORM_DEFICIENCY_EXISTS (the state that hid the pair)`, said(hidden).startsWith('409 FORM_DEFICIENCY_EXISTS'), said(hidden));
    await reproduce(label, swept[field], 'site', { target: 'punch_item', ...base, title: `${STAMP}-REFUSED sweep replay`, [field]: foreign[kind] });
  }
  // Beside the pairs: the observation target, and another company's item in the path.
  {
    const inst = await newInstance(checkTemplate, 'deficiency observation');
    const item = checkItems[1];
    const observe = (field) => (id, tag) => send('site', 'POST', `${P}/forms/${inst}/items/${item.id}/deficiency`, { target: 'observation', observationType: 'quality', hazard: `${STAMP}-${tag} hazard`, ...base, title: `${STAMP}-${tag} observation ${field}`, [field]: id });
    await refused('POST deficiency target=observation assigneeCompanyId (beside the pairs)', observe('assigneeCompanyId'), foreign.company, '404 COMPANY_NOT_FOUND');
    await refused('POST deficiency target=observation assigneeUserId (beside the pairs)', observe('assigneeUserId'), foreign.user, '404 USER_NOT_FOUND');
    const pathItem = (id, tag) => send('site', 'POST', `${P}/forms/${inst}/items/${id}/deficiency`, { target: 'punch_item', ...base, title: `${STAMP}-${tag} path item` });
    await refused('POST forms/{id}/items/{itemId}/deficiency with another company\'s item in the path (beside the pairs)', pathItem, foreign.formItem, '404 FORM_ITEM_NOT_FOUND');
    const punch = await q(`select id from "PunchItem" where "sourceRecordId" = $1`, [inst]);
    check('POST deficiency (beside the pairs): the refused requests raised nothing', punch.length === 0, `${punch.length} punch item(s)`);
    const observation = await allowed('POST deficiency target=observation assigneeUserId (beside the pairs)', observe('assigneeUserId'), own.planner);
    const row = await value(`select kind, "assigneeUserId" from "PunchItem" where id = $1`, [observation.body?.data?.record?.id || null]);
    check('POST deficiency target=observation: the own person is stored on the observation', row?.kind === 'observation' && row?.assigneeUserId === own.planner, JSON.stringify(row));
  }

  // ── 6. POST signatures: itemId ───────────────────────────────────────────
  {
    const inst = await newInstance(signTemplate, 'signatures');
    const sign = (id, tag) => send('quality', 'POST', `${P}/forms/${inst}/signatures`, { role: 'inspector', image: PNG, signerName: `${STAMP}-${tag} signer`, signerCompany: `${STAMP}-${tag} company`, itemId: id });
    const label = 'POST forms/{id}/signatures itemId';
    await refused(`${label} (another company's signature item)`, sign, foreign.signatureItem, '400 FORM_ITEM_NOT_FOUND');
    await refused(`${label} (the sweep's foreign item)`, sign, foreign.formItem, '400 FORM_ITEM_NOT_FOUND');
    const nothing = await value(`select (select count(*)::int from "Signature" where "instanceId" = $1) as signatures, (select count(*)::int from "ProjectDocument" where "linkedEntityId" = $1) as documents, (select count(*)::int from "Attachment" where "recordId" = $1) as attachments, (select count(*)::int from "FormItemResponse" where "instanceId" = $1) as answers, (select status from "FormInstance" where id = $1) as status`, [inst]);
    check(`${label}: the refused requests stored no signature, signature image, attachment or answer, and left the inspection scheduled`, nothing.signatures === 0 && nothing.documents === 0 && nothing.attachments === 0 && nothing.answers === 0 && nothing.status === 'scheduled', JSON.stringify(nothing));
    await allowed(label, sign, signItem);
    const stored = await q(`select "itemId", role from "Signature" where "instanceId" = $1`, [inst]);
    const answer = await value(`select value from "FormItemResponse" where "instanceId" = $1 and "itemId" = $2`, [inst, signItem]);
    check(`${label}: the own signature item is stored (signature and its answer)`, stored.length === 1 && stored[0].itemId === signItem && answer?.value === 'signed', `${JSON.stringify(stored)} answer=${answer?.value}`);
    await refused(`${label} (the inspection now in progress)`, sign, foreign.signatureItem, '400 FORM_ITEM_NOT_FOUND');
    const count = await value(`select count(*)::int as n from "Signature" where "instanceId" = $1`, [inst]);
    check(`${label}: the inspection still holds only the own signature`, count?.n === 1, `${count?.n} signatures`);
    await reproduce(label, swept.signatures, 'quality', { role: 'inspector', image: PNG, signerName: `${STAMP}-REFUSED sweep replay`, itemId: foreign.formItem });
  }

  // ── 7–9. NCR close, safety close, safety submit: attachmentRefs[].storageKey ──
  const upload = async (tag) => {
    const res = keep(await send('site', 'POST', `${P}/workflow/uploads`, undefined, { form: multipart({ field: 'files', filename: `${STAMP}-${tag}.pdf`, contentType: 'application/pdf', body: PDF }) }));
    const doc = Array.isArray(res.body?.data) ? res.body.data[0] : null;
    const row = doc ? await value(`select "orgId", "projectId" from "ProjectDocument" where id = $1`, [doc.documentId]) : null;
    check(`open state: the attacker's own evidence file for ${tag} is uploaded to its own project`, res.status === 201 && row?.orgId === attackerOrg && row?.projectId === projectId, `${said(res)} ${doc?.storageKey}`);
    if (!doc) throw new Error(`could not upload evidence: ${said(res)}`);
    return doc;
  };
  const evidence = (key, tag, doc) => ({ fileName: `${STAMP}-${tag}.pdf`, fileUrl: doc.fileUrl, storageKey: key, mimeType: 'application/pdf', sizeBytes: doc.sizeBytes, description: `${STAMP}-${tag} evidence` });
  const CLOSEOUTS = [
    { name: 'ncrClose', label: 'POST ncr/{id}/close attachmentRefs[].storageKey', table: 'NcrRecord', recordType: 'ncr', verb: 'close', notReady: 'NCR_NOT_READY_FOR_CLOSEOUT' },
    { name: 'safetyClose', label: 'POST safety/{id}/close attachmentRefs[].storageKey', table: 'SafetyIncident', recordType: 'safety_incident', verb: 'close', notReady: 'SAFETY_NOT_READY_FOR_CLOSEOUT' },
    { name: 'safetySubmit', label: 'POST safety/{id}/submit attachmentRefs[].storageKey', table: 'SafetyIncident', recordType: 'safety_incident', verb: 'submit', notReady: 'SAFETY_NOT_READY_FOR_CLOSEOUT' },
  ];
  for (const spec of CLOSEOUTS) {
    const isNcr = spec.table === 'NcrRecord';
    const made = keep(isNcr
      ? await send('site', 'POST', `${P}/ncr`, { severity: 'minor', description: `${STAMP} ${spec.name} NCR`, disposition: 'Repair to the method statement', responsible: `${STAMP} foreman`, assigneeUserId: own.site, assigneeCompanyId: own.company, dueDate: '2026-12-20', comment: `${STAMP} raised` })
      : await send('site', 'POST', `${P}/safety`, { incidentType: 'near_miss', title: `${STAMP} ${spec.name} incident`, date: '2026-10-02', responsible: `${STAMP} supervisor`, severity: 'low', dueDate: '2026-12-20', lostDays: 0, assigneeUserId: own.site, assigneeCompanyId: own.company, status: 'open', comment: `${STAMP} reported` }));
    const recordId = made.body?.data?.id || null;
    const opened = recordId ? await value(`select status from "${spec.table}" where id = $1`, [recordId]) : null;
    check(`open state: a fresh ${isNcr ? 'NCR' : 'safety incident'} of the attacker's own for ${spec.name} is open`, made.status === 201 && opened?.status === 'open', `${said(made)} ${opened?.status}`);
    if (!recordId) throw new Error(`could not create the record: ${said(made)}`);
    const doc = await upload(spec.name);
    const route = `${P}/${isNcr ? 'ncr' : 'safety'}/${recordId}/${spec.verb}`;
    const closeout = (extra = []) => (key, tag) => send('site', 'POST', route, { closureComment: `${STAMP}-${tag} closeout`, responsible: `${STAMP} foreman`, dueDate: '2026-12-20', attachmentRefs: [...extra, evidence(key, tag, doc)] });
    await refused(`${spec.label} (another company's document id)`, closeout(), foreign.document, '404 FILE_NOT_FOUND');
    await refused(`${spec.label} (another company's document storage key)`, closeout(), foreign.documentKey, '404 FILE_NOT_FOUND');
    await refused(`${spec.label} (beside the company's own evidence)`, closeout([evidence(doc.storageKey, 'REFUSED-own', doc)]), foreign.document, '404 FILE_NOT_FOUND');
    const kept = await value(`select status, "closureComment", (select count(*)::int from "WorkflowAttachment" w where w."recordId" = t.id) as files, (select count(*)::int from "WorkflowStatusHistory" h where h."recordId" = t.id and h."newStatus" = 'submitted') as moves from "${spec.table}" t where id = $1`, [recordId]);
    check(`${spec.label}: the refused requests left the record open with no closeout, no evidence and no status move`, kept?.status === 'open' && !kept?.closureComment && kept?.files === 0 && kept?.moves === 0, JSON.stringify(kept));
    await allowed(spec.label, closeout(), doc.storageKey);
    const stored = await q(`select "storageKey" from "WorkflowAttachment" where "recordId" = $1 and "recordType" = $2`, [recordId, spec.recordType]);
    const state = await value(`select status from "${spec.table}" where id = $1`, [recordId]);
    check(`${spec.label}: the own document is stored as the evidence and the record is submitted`, stored.length === 1 && stored[0].storageKey === doc.storageKey && state?.status === 'submitted', `${JSON.stringify(stored)} ${state?.status}`);
    const hidden = await closeout()(foreign.document, 'REFUSED');
    check(`${spec.label}: on the submitted record the request is answered 409 ${spec.notReady} (the state that hid the pair)`, said(hidden).startsWith(`409 ${spec.notReady}`), said(hidden));
    await reproduce(spec.label, swept[spec.name], 'site', { closureComment: `${STAMP}-REFUSED sweep replay`, responsible: `${STAMP} foreman`, dueDate: '2026-12-20', attachmentRefs: [{ fileName: `${STAMP}-REFUSED.pdf`, storageKey: foreign.document, mimeType: 'application/pdf', sizeBytes: 640 }] });
  }

  // ── nothing stored, nothing sent ─────────────────────────────────────────
  const namingAfter = await naming();
  check('no row of the attacker company names the victim\'s ids that did not before', JSON.stringify(namingBefore) === JSON.stringify(namingAfter), `${JSON.stringify(namingBefore)} -> ${JSON.stringify(namingAfter)}`);
  const refusedStamp = `%${STAMP}-REFUSED%`;
  const stamped = await q(`
    select 'FormInstance' as t, count(*)::int as n from "FormInstance" where to_jsonb("FormInstance")::text like $1
    union all select 'FormItemResponse', count(*)::int from "FormItemResponse" where note like $1
    union all select 'Signature', count(*)::int from "Signature" where "signerName" like $1 or "signerCompany" like $1
    union all select 'PunchItem', count(*)::int from "PunchItem" where to_jsonb("PunchItem")::text like $1
    union all select 'NcrRecord', count(*)::int from "NcrRecord" where coalesce("closureComment", '') like $1
    union all select 'SafetyIncident', count(*)::int from "SafetyIncident" where coalesce("closureComment", '') like $1
    union all select 'WorkflowAttachment', count(*)::int from "WorkflowAttachment" where "fileName" like $1 or coalesce(description, '') like $1
    union all select 'WorkflowStatusHistory', count(*)::int from "WorkflowStatusHistory" where coalesce(comment, '') like $1
    union all select 'ApprovalWorkflowEvent', count(*)::int from "ApprovalWorkflowEvent" where to_jsonb("ApprovalWorkflowEvent")::text like $1
    union all select 'ProjectDocument', count(*)::int from "ProjectDocument" where "originalName" like $1`, [refusedStamp]);
  check('no refused request left an answer, signature, punch item, closeout, evidence, history or approval event', stamped.every((r) => r.n === 0), stamped.map((r) => `${r.t} ${r.n}`).join(', '));
  // A signature's image is attached to its inspection: those attachment rows are the allowed signature's.
  for (const row of await q(`select id from "Attachment" where "orgId" = $1 and "createdAt" >= $2::timestamp and "recordId" = any($3::text[])`, [attackerOrg, start, [...allowedIds]])) allowedIds.add(row.id);
  const side = [];
  const seen = [];
  for (const table of ['AuditEvent', 'OutboundEvent', 'Notification', 'RecordHistorySnapshot']) {
    const rows = await q(`select "entityType" as type, "entityId" as id, to_jsonb(t)::text as body from "${table}" t where "orgId" = $1 and "createdAt" >= $2::timestamp`, [attackerOrg, start]);
    seen.push(`${table} ${rows.length}`);
    for (const row of rows) {
      if (victimIds.some((v) => row.body.includes(v))) side.push(`${table} ${row.type} ${row.id} names a victim id`);
      else if (row.body.includes(`${STAMP}-REFUSED`)) side.push(`${table} ${row.type} ${row.id} carries a refused request's stamp`);
      else if (row.id && !allowedIds.has(row.id)) side.push(`${table} ${row.type} ${row.id} is not one of the allowed requests' records`);
    }
  }
  const jobs = await q(`select id, coalesce("payloadJson"::text, '') as body from "BackgroundJob" where "orgId" = $1 and "createdAt" >= $2::timestamp`, [attackerOrg, start]);
  for (const job of jobs) if (victimIds.some((v) => job.body.includes(v)) || job.body.includes(`${STAMP}-REFUSED`)) side.push(`BackgroundJob ${job.id}`);
  seen.push(`BackgroundJob ${jobs.length}`);
  check('no audit row, history snapshot, outbound event, notification or job names the victim or comes from a refused request', side.length === 0, side.length ? side.slice(0, 6).join('; ') : `since the start: ${seen.join(', ')}`);
  const victimNotes = await q(`select count(*)::int as n from "Notification" where "orgId" = $1 and "createdAt" >= $2::timestamp`, [victimOrg, start]);
  check('no notification was written in the victim company', victimNotes[0].n === 0, `${victimNotes[0].n}`);
  if (INPROCESS) {
    const toVictim = emails.filter((line) => line.includes(`@c${VICTIM}.octapm-cert.test`));
    check('no e-mail went to the victim company\'s people', toVictim.length === 0, `${emails.length} e-mail(s) in all; ${toVictim.length} to @c${VICTIM}`);
  }

  // ── nothing returned, nothing of the victim's moved ──────────────────────
  const traces = [`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`, ...victimIds, ...victimNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))];
  const victimTraces = new RegExp(traces.join('|'));
  const leaked = answers.filter((a) => victimTraces.test(a.text));
  check('no answer to the attacker carries the victim company\'s ids, names, addresses or canaries', leaked.length === 0, leaked.slice(0, 5).map((a) => `${a.status} ${a.route} -> ${(a.text.match(victimTraces) || [])[0]}`).join('\n        '));
  const errors = answers.filter((a) => a.status >= 500);
  check('no answer is a server error', errors.length === 0, errors.slice(0, 5).map((a) => `${a.status} ${a.route}`).join(', '));
  const after = await snapshot();
  const moved = fingerprint.compare(before, after).filter((c) => !c.noise && c.org === VICTIM);
  check('the victim company\'s data did not change (every table)', moved.length === 0, moved.slice(0, 8).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
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
