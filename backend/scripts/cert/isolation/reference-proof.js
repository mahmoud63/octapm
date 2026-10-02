'use strict';

/**
 * The live proof that a record can point only at its own company's people,
 * companies and project records (certification findings L3, L4, L6, L7, L8,
 * L9; the shared check is services/tenant-references.service.js).
 *
 *   node scripts/cert/isolation/reference-proof.js [attacker=030] [victim=040]
 *   CERT_INPROCESS=1 node scripts/cert/isolation/reference-proof.js     (the working tree's code, no server)
 *
 * For each field: the attacker company's own id is ACCEPTED (so a fix that
 * refused everything would fail here), the victim company's id is REFUSED,
 * and an id that exists nowhere gets exactly the same refusal. No answer may
 * be a 500 or carry the victim's names, addresses or canaries, and the
 * victim's data must not change in any table.
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

const ATTACKER = process.argv[2] || '030';
const VICTIM = process.argv[3] || '040';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = crypto.randomBytes(3).toString('hex');
const results = [];
const answers = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const listOf = (data) => (Array.isArray(data) ? data : data?.items || data?.rows || []);
const said = (res) => `${res.status} ${res.body?.error?.code || ''} ${res.body?.error?.message || ''}`.trim();

const main = async () => {
  const { companies } = buildPopulation();
  const attacker = companies.find((c) => c.code === ATTACKER);
  const victim = companies.find((c) => c.code === VICTIM);
  const projects = JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'projects.json'), 'utf8'));
  const inventory = (code) => JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'inventory', `${code}.json`), 'utf8'));
  const firstStandard = (code) => Object.entries(inventory(code).projects).find(([, p]) => p.depth === 'standard' && p.refs?.activities)?.[1];
  const A = firstStandard(ATTACKER);
  const V = firstStandard(VICTIM);
  if (!A || !V) throw new Error('both companies need a standard project with foundation records');
  void projects;

  const atk = as(`pm@${attacker.domain}`);
  const vic = as(`pm@${victim.domain}`);
  const send = async (who, method, route, body) => {
    const res = await who.send(method, route, body);
    if (who === atk) answers.push({ route: `${method} ${route}`, status: res.status, text: res.text || '' });
    return res;
  };
  const nowhere = () => crypto.randomUUID();

  // ── ids: own, foreign, nowhere ───────────────────────────────────────────
  const ownUser = attacker.people.find((p) => p.persona === 'planner').id;
  const foreignUser = victim.people.find((p) => p.persona === 'finance').id;
  const ownCompany = listOf((await atk.send('GET', '/companies?limit=5')).body?.data)[0]?.id;
  const foreignCompany = listOf((await vic.send('GET', '/companies?limit=5')).body?.data)[0]?.id;
  const ownActivity = Object.values(A.refs.activities)[0];
  const foreignActivity = Object.values(V.refs.activities)[0];
  const AP = `/projects/${A.id}`;
  const VP = `/projects/${V.id}`;
  const made = async (who, method, route, body, label) => {
    const res = await who.send(method, route, body);
    if (res.status !== 201 && res.status !== 200) throw new Error(`setup ${label}: ${said(res)}`);
    return res.body.data;
  };
  const ownPackage = await made(atk, 'POST', `${AP}/submittals/packages`, { name: `Own package ${STAMP}` }, 'own package');
  const foreignPackage = await made(vic, 'POST', `${VP}/submittals/packages`, { name: `CANARY-${VICTIM}-PROOF package ${STAMP}` }, 'victim package');
  const ownTemplate = await made(atk, 'POST', `${AP}/submittals/workflow-templates`, { name: `Own route ${STAMP}`, steps: [{ name: 'Review', mode: 'sequential', days: 5, assignees: [{ type: 'role', role: 'pm' }] }] }, 'own template').catch(async () => ({ id: null }));
  const foreignTemplate = await made(vic, 'POST', `${VP}/submittals/workflow-templates`, { name: `CANARY-${VICTIM}-PROOF route ${STAMP}`, steps: [{ name: 'Review', mode: 'sequential', days: 5, assignees: [{ type: 'role', role: 'pm' }] }] }, 'victim template').catch(async () => ({ id: null }));
  const vRfi = await made(vic, 'POST', `${VP}/rfi`, { subject: `CANARY-${VICTIM}-PROOF RFI ${STAMP}`, question: 'internal' }, 'victim rfi');
  await made(vic, 'POST', `${VP}/rfi/${vRfi.id}/responses`, { body: `CANARY-${VICTIM}-PROOF-SECRET ${STAMP}` }, 'victim response');
  const foreignResponse = listOf((await vic.send('GET', `${VP}/rfi/${vRfi.id}/responses`)).body?.data)[0]?.id;
  const aRfi = await made(atk, 'POST', `${AP}/rfi`, { subject: `Own RFI ${STAMP}`, question: 'probe' }, 'own rfi');
  await made(atk, 'POST', `${AP}/rfi/${aRfi.id}/responses`, { body: `own answer ${STAMP}` }, 'own response');
  const ownResponse = listOf((await atk.send('GET', `${AP}/rfi/${aRfi.id}/responses`)).body?.data)[0]?.id;
  const templates = listOf((await atk.send('GET', `${AP}/forms/templates`)).body?.data);
  const formTemplate = templates.find((t) => t.status === 'active' || !t.status)?.id || templates[0]?.id;
  const submittal = await made(atk, 'POST', `${AP}/submittals`, { title: `Own submittal ${STAMP}` }, 'own submittal');

  // ── before ───────────────────────────────────────────────────────────────
  const db = await guard.connectCert();
  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const print = await fingerprint.take(db);
    await db.query('rollback');
    return print;
  };
  const before = await snapshot();

  /** One field: own accepted, foreign refused, nowhere refused the same way. */
  const field = async (label, attempt, own, foreign, expectCode) => {
    if (!own || !foreign) {
      check(`${label}: ids available`, false, `own ${own} foreign ${foreign}`);
      return;
    }
    const okRes = await attempt(own);
    check(`${label}: the company's own id is accepted`, okRes.status >= 200 && okRes.status < 300, said(okRes));
    const bad = await attempt(foreign);
    const none = await attempt(nowhere());
    check(`${label}: another company's id is refused (404 ${expectCode})`, bad.status === 404 && bad.body?.error?.code === expectCode, said(bad));
    check(`${label}: …exactly as an id that exists nowhere`, said(bad) === said(none), `${said(bad)} | ${said(none)}`);
  };

  console.log(`attacker ${ATTACKER} (${A.id}), victim ${VICTIM} (${V.id})${process.env.CERT_INPROCESS === '1' ? ', in process' : ''}\n`);

  // L3 — inspections (forms)
  for (const key of ['assigneeUserId', 'inspectorUserId', 'approverUserId']) {
    await field(`inspection ${key} (L3)`, (id) => send(atk, 'POST', `${AP}/forms`, { templateId: formTemplate, title: `Proof ${key} ${STAMP}`, [key]: id }), ownUser, foreignUser, 'USER_NOT_FOUND');
  }
  // L4 — prime contract client
  await field('prime contract clientCompanyId (L4)', (id) => send(atk, 'PATCH', `${AP}/prime-contract`, { clientCompanyId: id }), ownCompany, foreignCompany, 'COMPANY_NOT_FOUND');
  // L6 — risks
  for (const key of ['ownerUserId', 'reviewerUserId', 'approverUserId', 'assigneeUserId', 'ballInCourtUserId']) {
    await field(`risk ${key} (L6)`, (id) => send(atk, 'POST', `${AP}/risks`, { description: `Proof ${key} ${STAMP}`, [key]: id }), ownUser, foreignUser, 'USER_NOT_FOUND');
  }
  await field('risk assigneeCompanyId (L6)', (id) => send(atk, 'POST', `${AP}/risks`, { description: `Proof company ${STAMP}`, assigneeCompanyId: id }), ownCompany, foreignCompany, 'COMPANY_NOT_FOUND');
  // L7 — submittal people, package manager and activity
  await field('submittal managerUserId (L7)', (id) => send(atk, 'PUT', `${AP}/submittals/${submittal.id}/people`, { managerUserId: id }), ownUser, foreignUser, 'USER_NOT_FOUND');
  await field('submittal distributionUserIds (L7)', (id) => send(atk, 'PUT', `${AP}/submittals/${submittal.id}/people`, { distributionUserIds: [id] }), ownUser, foreignUser, 'USER_NOT_FOUND');
  await field('package managerUserId (L7)', (id) => send(atk, 'POST', `${AP}/submittals/packages`, { name: `Proof package ${STAMP}`, managerUserId: id }), ownUser, foreignUser, 'USER_NOT_FOUND');
  await field('package activityId (L7)', (id) => send(atk, 'POST', `${AP}/submittals/packages`, { name: `Proof package act ${STAMP}`, activityId: id }), ownActivity, foreignActivity, 'ACTIVITY_NOT_FOUND');
  // L8 — submittal package and workflow template
  await field('submittal packageId (L8)', (id) => send(atk, 'PATCH', `${AP}/submittals/${submittal.id}`, { packageId: id }), ownPackage.id, foreignPackage.id, 'SUBMITTAL_PACKAGE_NOT_FOUND');
  if (ownTemplate.id && foreignTemplate.id) {
    await field('submittal workflowTemplateId (L8)', (id) => send(atk, 'PATCH', `${AP}/submittals/${submittal.id}`, { workflowTemplateId: id }), ownTemplate.id, foreignTemplate.id, 'SUBMITTAL_TEMPLATE_NOT_FOUND');
  } else {
    check('submittal workflowTemplateId (L8): templates could be made', false, 'the workflow-template route refused the setup');
  }
  const pkgView = await vic.send('GET', `${VP}/submittals/packages/${foreignPackage.id}`);
  const members = listOf(pkgView.body?.data?.items || pkgView.body?.data?.submittals);
  check('the victim package lists none of the attacker company\'s submittals (L8)', !members.some((m) => m.id === submittal.id), `${members.length} member(s)`);
  // L9 — RFI official response
  await field('RFI officialResponseId (L9)', (id) => send(atk, 'PATCH', `${AP}/rfi/${aRfi.id}`, { officialResponseId: id }), ownResponse, foreignResponse, 'RFI_RESPONSE_NOT_FOUND');
  const converted = await send(atk, 'POST', `${AP}/rfi/${aRfi.id}/convert-to-change`, {});
  check('converting the RFI to a change carries no other company\'s response (L9)', !/PROOF-SECRET/.test(converted.text || ''), said(converted));

  // ── after ────────────────────────────────────────────────────────────────
  const victimTraces = new RegExp([`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`].join('|'));
  const leaked = answers.filter((a) => victimTraces.test(a.text));
  check('no answer to the attacker carries the victim company\'s names, addresses or canaries', leaked.length === 0, leaked.slice(0, 5).map((a) => `${a.status} ${a.route}`).join(', '));
  const errors = answers.filter((a) => a.status >= 500);
  check('no answer is a server error', errors.length === 0, errors.slice(0, 5).map((a) => `${a.status} ${a.route}`).join(', '));
  const after = await snapshot();
  // The victim's own set-up writes happened before the first snapshot; nothing after it may touch the victim.
  const moved = fingerprint.compare(before, after).filter((c) => !c.noise && c.org === VICTIM);
  check('the victim company\'s data did not change (every table)', moved.length === 0, moved.slice(0, 8).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
  await db.end();

  const failed = results.filter((r) => !r.ok);
  console.log(`\nreference proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
