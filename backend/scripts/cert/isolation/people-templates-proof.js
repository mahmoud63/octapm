'use strict';

/**
 * The proof of the CERT-2 people-templates pairs: a report's delivery, a
 * submittal review route and a workflow template may name only people of the
 * caller's own company (and a workflow template only its own permission
 * templates); a report preview / export and a due-date scan may name only a
 * project of the caller's own company (the shared check is
 * services/tenant-references.service.js; the project check is the one the
 * report assistant already makes).
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/people-templates-proof.js [attacker=023] [victim=024] [--only=schedules,submittal,workflow,preview,scan]
 *
 * The CERT-2 injection sweep (results/isolation/cert2-inject.json) found
 *   POST /reports/{reportId}/schedules                    recipients.userIds[]        201, stored on report_schedule
 *   POST /projects/{projectId}/submittals/workflow-templates  steps[].assignees[].userId  201, stored on submittal_workflow_template
 *   POST /projects/{projectId}/workflows/templates         steps[].assignees[].userId  201, stored on workflow_template
 *   POST /reports/preview                                  projectId                   200, nothing stored
 *   POST /notifications/scan-due                           projectId                   201, nothing stored seen
 *
 * For each pair, built as the sweep built it (the same person of the attacker
 * company, the same body on its own records, one id replaced):
 *   ALLOWED  the attacker company's own id is accepted (and stored / answered);
 *   REFUSED  the victim company's id is refused with the route's 404 *_NOT_FOUND,
 *            nothing is stored, and the id is not echoed back;
 *   NOWHERE  an id that exists nowhere gets exactly the same answer.
 * The sibling writes that carry the same field are proven the same way: a
 * schedule's edit (PATCH), a delivered run's recipients (POST .../runs), a
 * template's edit (PATCH), a workflow action step's people, a workflow
 * permission-template assignee, and the unsaved-definition export.
 *
 * Before the fix this script is the reproduction: a refusal that fails prints
 * the stored row and the company the person it names belongs to, and the two
 * project pairs print what the answer held and what was created, for whom.
 *
 * No answer may be a 500 or carry the victim's ids, names, addresses or
 * canaries, and the victim company's data must not change in any table.
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

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ATTACKER = positional[0] || '023';
const VICTIM = positional[1] || '024';
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1]?.split(',') || null;
const runs = (section) => !ONLY || ONLY.includes(section);
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = crypto.randomBytes(3).toString('hex');
const results = [];
const answers = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const note = (text) => console.log(`      ${text}`);
const said = (res) => `${res.status} ${res.body?.error?.code || ''} ${res.body?.error?.message || ''}`.trim();
const refused = (res, code) => res.status === 404 && res.body?.error?.code === code;

const main = async () => {
  const { companies } = buildPopulation();
  const attacker = companies.find((c) => c.code === ATTACKER);
  const victim = companies.find((c) => c.code === VICTIM);
  const inventory = (code) => JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'inventory', `${code}.json`), 'utf8'));
  const standard = (inv) => Object.values(inv.projects).find((p) => p.depth === 'standard' && p.refs?.activities);
  const A = standard(inventory(ATTACKER));
  const V = standard(inventory(VICTIM));
  if (!A || !V) throw new Error('both companies need a standard project with activities');

  // The people the sweep acted as: the planner for reports and submittal routes, the PM for workflows and the due scan.
  const persona = (company, key) => company.people.find((p) => p.persona === key);
  const planner = as(`planner@${attacker.domain}`);
  const pm = as(`pm@${attacker.domain}`);
  const vicPm = as(`pm@${victim.domain}`);
  const send = async (who, method, route, body, options) => {
    const res = await who.send(method, route, body, options);
    answers.push({ route: `${method} ${route}`, status: res.status, text: res.text || '' });
    return res;
  };
  const nowhere = () => crypto.randomUUID();
  const AP = `/projects/${A.id}`;

  const db = await guard.connectCert();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const orgIdOf = async (code) => (await q('select id::text as id from "Organisation" where slug like $1', [`cert-${code}-%`]))[0]?.id;
  const aOrg = await orgIdOf(ATTACKER);
  const vOrg = await orgIdOf(VICTIM);
  /** The companies (NNN) a person is a member of. */
  const companiesOf = async (userId) =>
    (await q(`select o.slug from "OrganizationMembership" m join "Organisation" o on o.id = m."orgId" where m."userId" = $1 and m.status <> 'left' order by o.slug`, [userId]))
      .map((row) => /^cert-(\d{3})-/.exec(row.slug)?.[1] || row.slug);
  const projectOwner = async (projectId) => /^cert-(\d{3})-/.exec((await q('select o.slug from "Project" p join "Organisation" o on o.id = p."orgId" where p.id = $1', [projectId]))[0]?.slug || '')?.[1] || 'nowhere';
  const templateOwner = async (id) => /^cert-(\d{3})-/.exec((await q('select o.slug from "PermissionTemplate" t join "Organisation" o on o.id = t."orgId" where t.id = $1', [id]))[0]?.slug || '')?.[1] || 'nowhere';

  // ── the ids: the attacker's own and the victim's, each proven by its owner ──
  const ownUser = persona(attacker, 'planner')?.id || persona(attacker, 'pm').id;
  const ownPm = persona(attacker, 'pm').id;
  const foreignUser = persona(victim, 'pm').id;
  const ownPermissionTemplate = (await q('select id::text as id from "PermissionTemplate" where "orgId" = $1 order by "createdAt" limit 1', [aOrg]))[0]?.id || null;
  const foreignPermissionTemplate = (await q('select id::text as id from "PermissionTemplate" where "orgId" = $1 order by "createdAt" limit 1', [vOrg]))[0]?.id || null;
  {
    const own = await companiesOf(ownUser);
    const ownPmCompanies = await companiesOf(ownPm);
    const foreign = await companiesOf(foreignUser);
    check(`setup: ${ownUser} and ${ownPm} are members of ${ATTACKER}`, own.includes(ATTACKER) && ownPmCompanies.includes(ATTACKER), `${own.join(',')} / ${ownPmCompanies.join(',')}`);
    check(`setup: ${foreignUser} is a member of ${VICTIM} and not of ${ATTACKER}`, foreign.includes(VICTIM) && !foreign.includes(ATTACKER), foreign.join(','));
    check(`setup: project ${A.id} is ${ATTACKER}'s and ${V.id} is ${VICTIM}'s`, (await projectOwner(A.id)) === ATTACKER && (await projectOwner(V.id)) === VICTIM);
    check(`setup: permission template ${ownPermissionTemplate} is ${ATTACKER}'s and ${foreignPermissionTemplate} is ${VICTIM}'s`, (await templateOwner(ownPermissionTemplate)) === ATTACKER && (await templateOwner(foreignPermissionTemplate)) === VICTIM);
  }
  const foreignIds = [foreignUser, V.id, foreignPermissionTemplate].filter(Boolean);
  const storedNames = async (text) => {
    const found = [...new Set((text || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [])].filter((id) => foreignIds.includes(id));
    const parts = [];
    for (const id of found) parts.push(id === foreignUser ? `user ${id} (a member of ${(await companiesOf(id)).join(',')} only)` : id === foreignPermissionTemplate ? `permission template ${id} of company ${await templateOwner(id)}` : `project ${id} of company ${await projectOwner(id)}`);
    return parts.join('; ');
  };

  console.log(`\nattacker ${ATTACKER} (${A.id}), victim ${VICTIM} (${V.id})${process.env.CERT_INPROCESS === '1' ? ', in process' : ', AGAINST A SERVER (does not prove the working tree)'}${ONLY ? `, only ${ONLY.join(',')}` : ''}\n`);

  // What the victim's project holds, seen by the victim's own PM (a read, made
  // before the snapshot so its sign-in is not counted against the victim).
  const activityBody = (projectId) => ({ source: 'activity', projectId, limit: 50 });
  const victimOwn = runs('preview') ? await vicPm.send('POST', '/reports/preview', activityBody(V.id)) : null;

  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const print = await fingerprint.take(db);
    await db.query('rollback');
    return print;
  };
  const before = await snapshot();

  // ── 1. report schedules (and a delivered run's recipients) ────────────────
  if (runs('schedules')) {
    const made = await send(planner, 'POST', '/reports', { name: `Proof schedule report ${STAMP}`, source: 'task', visibility: 'private', columns: ['taskNumber', 'title', 'status'] });
    if (made.status !== 201) throw new Error(`setup report: ${said(made)}`);
    const reportId = made.body.data.id;
    const body = (userId) => ({ frequency: 'weekly', dayOfWeek: 1, hour: 7, minute: 0, timezone: 'UTC', format: 'xlsx', recipients: { userIds: [userId], roles: [], emails: [] }, enabled: false });
    const schedulesNaming = async (userId) => Number((await q(`select count(*)::int n from "ReportSchedule" where "orgId" = $1 and "recipientsJson"::text like $2`, [aOrg, `%${userId}%`]))[0].n);
    const storedSchedules = async (userId) => (await q(`select id::text as id, "recipientsJson"::text as r from "ReportSchedule" where "reportId" = $1 and "recipientsJson"::text like $2`, [reportId, `%${userId}%`]));
    // ALLOWED
    const ok = await send(planner, 'POST', `/reports/${reportId}/schedules`, body(ownUser));
    const ownRows = await storedSchedules(ownUser);
    check('report schedule recipients.userIds: the company\'s own person is accepted (201) and stored', ok.status === 201 && ownRows.length === 1, `${said(ok)}; stored ${ownRows.length}`);
    // REFUSED
    const foreignBefore = await schedulesNaming(foreignUser);
    const bad = await send(planner, 'POST', `/reports/${reportId}/schedules`, body(foreignUser));
    const badRows = await storedSchedules(foreignUser);
    check(`report schedule recipients.userIds: company ${VICTIM}'s person is refused (404 USER_NOT_FOUND)`, refused(bad, 'USER_NOT_FOUND'), said(bad));
    check('report schedule recipients.userIds: …nothing stored', !badRows.length && (await schedulesNaming(foreignUser)) === foreignBefore, badRows.length ? `STORED: ReportSchedule ${badRows[0].id} (company ${ATTACKER}) recipients ${badRows[0].r} -> ${await storedNames(badRows[0].r)}` : '');
    check('report schedule recipients.userIds: …and the foreign id is not answered back', !(bad.text || '').includes(foreignUser), `${bad.status}`);
    // NOWHERE
    const none = await send(planner, 'POST', `/reports/${reportId}/schedules`, body(nowhere()));
    check('report schedule recipients.userIds: …exactly as an id that exists nowhere', said(bad) === said(none), `${said(bad)} | ${said(none)}`);
    // the edit route
    if (ok.status === 201) {
      const scheduleId = ok.body.data.id;
      const edit = await send(planner, 'PATCH', `/reports/${reportId}/schedules/${scheduleId}`, { recipients: { userIds: [foreignUser], roles: [], emails: [] } });
      const after = (await q('select "recipientsJson"::text as r from "ReportSchedule" where id = $1', [scheduleId]))[0]?.r || '';
      check(`report schedule (PATCH): company ${VICTIM}'s person is refused (404 USER_NOT_FOUND) and the schedule keeps its own`, refused(edit, 'USER_NOT_FOUND') && after.includes(ownUser) && !after.includes(foreignUser), `${said(edit)}; now ${after}`);
      const editOwn = await send(planner, 'PATCH', `/reports/${reportId}/schedules/${scheduleId}`, { recipients: { userIds: [ownPm], roles: [], emails: [] } });
      check('report schedule (PATCH): the company\'s own person is still accepted', editOwn.status === 200, said(editOwn));
    }
    // a delivered run's recipients
    const runsNaming = async (userId) => Number((await q(`select count(*)::int n from "ReportRun" where "reportId" = $1 and "recipientsJson"::text like $2`, [reportId, `%${userId}%`]))[0].n);
    const runBody = (userId) => ({ format: 'xlsx', deliver: true, recipients: { userIds: [userId], roles: [], emails: [] } });
    const runOk = await send(planner, 'POST', `/reports/${reportId}/runs`, runBody(ownUser));
    check('report run (deliver) recipients.userIds: the company\'s own person is accepted (201)', runOk.status === 201 && (await runsNaming(ownUser)) >= 1, said(runOk));
    const runsBefore = await runsNaming(foreignUser);
    const notesBefore = Number((await q('select count(*)::int n from "Notification" where "recipientUserId" = $1', [foreignUser]))[0].n);
    const runBad = await send(planner, 'POST', `/reports/${reportId}/runs`, runBody(foreignUser));
    const runsAfter = await runsNaming(foreignUser);
    const notesAfter = Number((await q('select count(*)::int n from "Notification" where "recipientUserId" = $1', [foreignUser]))[0].n);
    check(`report run (deliver) recipients.userIds: company ${VICTIM}'s person is refused (404 USER_NOT_FOUND), no run stored, nobody notified`, refused(runBad, 'USER_NOT_FOUND') && runsAfter === runsBefore && notesAfter === notesBefore, `${said(runBad)}; runs naming them ${runsBefore}->${runsAfter}; their notifications ${notesBefore}->${notesAfter}`);
    const runNone = await send(planner, 'POST', `/reports/${reportId}/runs`, runBody(nowhere()));
    check('report run (deliver): …exactly as an id that exists nowhere', said(runBad) === said(runNone), `${said(runBad)} | ${said(runNone)}`);
  }

  // ── 2. submittal review routes ────────────────────────────────────────────
  if (runs('submittal')) {
    const route = (name, userId) => ({
      name,
      description: `Two steps: technical check, then the project manager — ${STAMP}`,
      isDefault: false,
      steps: [
        { name: `Technical check ${STAMP}`, mode: 'sequential', days: 5, assignees: [{ type: 'user', userId }] },
        { name: `Project manager ${STAMP}`, mode: 'sequential', days: 3, assignees: [{ type: 'user', userId: ownPm }] },
      ],
    });
    const byName = async (name) => (await q('select id::text as id, "stepsJson"::text as s from "SubmittalWorkflowTemplate" where "projectId" = $1 and name = $2', [A.id, name]))[0] || null;
    const ownName = `Proof route own ${STAMP}`;
    const ok = await send(planner, 'POST', `${AP}/submittals/workflow-templates`, route(ownName, ownUser));
    const ownRow = await byName(ownName);
    check('submittal route steps[].assignees[].userId: the company\'s own person is accepted (201) and stored', ok.status === 201 && (ownRow?.s || '').includes(ownUser), `${said(ok)}; stored ${ownRow ? 'yes' : 'nothing'}`);
    const badName = `Proof route foreign ${STAMP}`;
    const bad = await send(planner, 'POST', `${AP}/submittals/workflow-templates`, route(badName, foreignUser));
    const badRow = await byName(badName);
    check(`submittal route steps[].assignees[].userId: company ${VICTIM}'s person is refused (404 USER_NOT_FOUND)`, refused(bad, 'USER_NOT_FOUND'), said(bad));
    check('submittal route steps[].assignees[].userId: …nothing stored', !badRow, badRow ? `STORED: SubmittalWorkflowTemplate ${badRow.id} (company ${ATTACKER}) steps name ${await storedNames(badRow.s)}` : '');
    check('submittal route steps[].assignees[].userId: …and the foreign id is not answered back', !(bad.text || '').includes(foreignUser), `${bad.status}`);
    const noneName = `Proof route nowhere ${STAMP}`;
    const none = await send(planner, 'POST', `${AP}/submittals/workflow-templates`, route(noneName, nowhere()));
    check('submittal route steps[].assignees[].userId: …exactly as an id that exists nowhere', said(bad) === said(none) && !(await byName(noneName)), `${said(bad)} | ${said(none)}`);
    if (ownRow) {
      const edit = await send(planner, 'PATCH', `${AP}/submittals/workflow-templates/${ownRow.id}`, { steps: route(ownName, foreignUser).steps });
      const after = (await byName(ownName))?.s || '';
      check(`submittal route (PATCH): company ${VICTIM}'s person is refused (404 USER_NOT_FOUND) and the route keeps its own`, refused(edit, 'USER_NOT_FOUND') && after.includes(ownUser) && !after.includes(foreignUser), `${said(edit)}`);
      const editOwn = await send(planner, 'PATCH', `${AP}/submittals/workflow-templates/${ownRow.id}`, { steps: route(ownName, ownPm).steps, description: `edited ${STAMP}` });
      check('submittal route (PATCH): the company\'s own person is still accepted', editOwn.status === 200, said(editOwn));
      const rename = await send(planner, 'PATCH', `${AP}/submittals/workflow-templates/${ownRow.id}`, { description: `renamed ${STAMP}` });
      check('submittal route (PATCH) without steps: still accepted', rename.status === 200, said(rename));
    }
  }

  // ── 3. workflow templates ─────────────────────────────────────────────────
  if (runs('workflow')) {
    const responseStep = (key, name, assignees, next) => ({ key, name, type: 'response', assignees, days: 3, responses: [{ key: 'forward', label: 'Forward', next, tone: 'positive' }, { key: 'return', label: 'Return', next: 'end_fail', tone: 'negative', requireComment: true }] });
    const template = (name, { siteReviewer = ownUser, notifyUserIds = null, permissionTemplateId = null } = {}) => ({
      tool: 'correspondence',
      name,
      description: `Site review, then the PM closes. ${STAMP}`,
      isDefault: false,
      priority: 0,
      rules: [],
      steps: [
        responseStep('site_review', 'Site review', [{ type: 'user', userId: siteReviewer }, ...(permissionTemplateId ? [{ type: 'permission_template', templateId: permissionTemplateId }] : [])], notifyUserIds ? 'tell' : 'pm_closeout'),
        ...(notifyUserIds ? [{ key: 'tell', name: 'Tell the office', type: 'action', action: { type: 'notify', userIds: notifyUserIds, message: 'Forwarded' }, next: 'pm_closeout' }] : []),
        responseStep('pm_closeout', 'PM close-out', [{ type: 'user', userId: ownPm }], 'end_success'),
      ],
    });
    const byName = async (name) => (await q('select id::text as id, "stepsJson"::text as s from "WorkflowTemplate" where "projectId" = $1 and name = $2', [A.id, name]))[0] || null;
    const cases = [
      ['steps[].assignees[].userId', 'USER_NOT_FOUND', (id) => ({ siteReviewer: id }), ownUser, foreignUser],
      ['steps[].action.userIds[]', 'USER_NOT_FOUND', (id) => ({ notifyUserIds: [id] }), ownUser, foreignUser],
      ['steps[].assignees[].templateId (permission template)', 'PERMISSION_TEMPLATE_NOT_FOUND', (id) => ({ permissionTemplateId: id }), ownPermissionTemplate, foreignPermissionTemplate],
    ];
    let ownTemplateRow = null;
    for (const [field, code, shape, own, foreign] of cases) {
      const label = `workflow template ${field}`;
      if (!own || !foreign) {
        check(`${label}: ids available`, false, `own ${own} foreign ${foreign}`);
        continue;
      }
      const ownName = `Proof workflow own ${field} ${STAMP}`;
      const ok = await send(pm, 'POST', `${AP}/workflows/templates`, template(ownName, shape(own)));
      const ownRow = await byName(ownName);
      if (!ownTemplateRow && ownRow) ownTemplateRow = { ...ownRow, name: ownName };
      check(`${label}: the company's own id is accepted (201) and stored`, ok.status === 201 && (ownRow?.s || '').includes(own), `${said(ok)}; stored ${ownRow ? 'yes' : 'nothing'}`);
      const badName = `Proof workflow foreign ${field} ${STAMP}`;
      const bad = await send(pm, 'POST', `${AP}/workflows/templates`, template(badName, shape(foreign)));
      const badRow = await byName(badName);
      check(`${label}: company ${VICTIM}'s id is refused (404 ${code})`, refused(bad, code), said(bad));
      check(`${label}: …nothing stored`, !badRow, badRow ? `STORED: WorkflowTemplate ${badRow.id} (company ${ATTACKER}) steps name ${await storedNames(badRow.s)}` : '');
      check(`${label}: …and the foreign id is not answered back`, !(bad.text || '').includes(foreign), `${bad.status}`);
      const noneName = `Proof workflow nowhere ${field} ${STAMP}`;
      const none = await send(pm, 'POST', `${AP}/workflows/templates`, template(noneName, shape(nowhere())));
      check(`${label}: …exactly as an id that exists nowhere`, said(bad) === said(none) && !(await byName(noneName)), `${said(bad)} | ${said(none)}`);
    }
    if (ownTemplateRow) {
      const edit = await send(pm, 'PATCH', `${AP}/workflows/templates/${ownTemplateRow.id}`, { steps: template(ownTemplateRow.name, { siteReviewer: foreignUser }).steps });
      const after = (await byName(ownTemplateRow.name))?.s || '';
      check(`workflow template (PATCH): company ${VICTIM}'s person is refused (404 USER_NOT_FOUND) and the template keeps its own`, refused(edit, 'USER_NOT_FOUND') && after === ownTemplateRow.s, said(edit));
      const editOwn = await send(pm, 'PATCH', `${AP}/workflows/templates/${ownTemplateRow.id}`, { steps: template(ownTemplateRow.name, { siteReviewer: ownPm }).steps });
      check('workflow template (PATCH): the company\'s own person is still accepted', editOwn.status === 200, said(editOwn));
      const rename = await send(pm, 'PATCH', `${AP}/workflows/templates/${ownTemplateRow.id}`, { description: `renamed ${STAMP}` });
      check('workflow template (PATCH) without steps: still accepted', rename.status === 200, said(rename));
    }
  }

  // ── 4. report preview and the unsaved-definition export ──────────────────
  if (runs('preview')) {
    const sweepBody = (projectId) => ({ source: 'task', projectId, columns: ['taskNumber', 'title', 'status', 'priority', 'assignee.name', 'dueDate', 'overdue'], filters: [{ field: 'status', op: 'nin', value: ['canceled'] }], limit: 20 });
    const stable = (res) => JSON.stringify({ ...(res.body?.data || res.body || {}), generatedAt: undefined });
    note(`the victim's own PM previewing activities of ${V.id}: ${victimOwn.status}, ${victimOwn.body?.data?.total ?? '?'} rows`);
    // ALLOWED
    const ok = await send(planner, 'POST', '/reports/preview', sweepBody(A.id));
    check('report preview projectId: the company\'s own project is answered (200, 1 project in scope)', ok.status === 200 && ok.body?.data?.projects?.inScope === 1, `${said(ok)}; projects ${JSON.stringify(ok.body?.data?.projects)}`);
    const okAct = await send(planner, 'POST', '/reports/preview', activityBody(A.id));
    note(`own project activities: ${okAct.status}, ${okAct.body?.data?.total ?? '?'} rows`);
    // REFUSED
    const bad = await send(planner, 'POST', '/reports/preview', sweepBody(V.id));
    const badAct = await send(planner, 'POST', '/reports/preview', activityBody(V.id));
    const none = await send(planner, 'POST', '/reports/preview', sweepBody(nowhere()));
    if (bad.status === 200) note(`REPRODUCTION: company ${VICTIM}'s project answered ${bad.status} with ${bad.body?.data?.total} rows, projects ${JSON.stringify(bad.body?.data?.projects)}; activities ${badAct.body?.data?.total} rows (the victim sees ${victimOwn.body?.data?.total}); same answer as an id that exists nowhere: ${stable(bad) === stable(none)}`);
    check(`report preview projectId: company ${VICTIM}'s project is refused (404 PROJECT_NOT_FOUND)`, refused(bad, 'PROJECT_NOT_FOUND') && refused(badAct, 'PROJECT_NOT_FOUND'), `${said(bad)} | ${said(badAct)}`);
    check('report preview projectId: …nothing of it answered (no rows)', !(bad.body?.data?.rows || []).length && !(badAct.body?.data?.rows || []).length, `${(bad.body?.data?.rows || []).length} / ${(badAct.body?.data?.rows || []).length} rows`);
    check('report preview projectId: …exactly as an id that exists nowhere', said(bad) === said(none), `${said(bad)} | ${said(none)}`);
    // the unsaved-definition export carries the same projectId
    const exportBody = (projectId) => ({ ...sweepBody(projectId), name: `Proof export ${STAMP}`, format: 'xlsx' });
    const exOk = await send(planner, 'POST', '/reports/export', exportBody(A.id), { binary: true });
    check('report export projectId: the company\'s own project is exported (200)', exOk.status === 200, `${exOk.status}`);
    const exBad = await send(planner, 'POST', '/reports/export', exportBody(V.id), { binary: true });
    const exNone = await send(planner, 'POST', '/reports/export', exportBody(nowhere()), { binary: true });
    check(`report export projectId: company ${VICTIM}'s project is refused (404 PROJECT_NOT_FOUND), as an id that exists nowhere`, refused(exBad, 'PROJECT_NOT_FOUND') && said(exBad) === said(exNone), `${said(exBad)} | ${said(exNone)}`);
  }

  // ── 5. the due-date scan ──────────────────────────────────────────────────
  if (runs('scan')) {
    const count = async (sql, args) => Number((await q(sql, args))[0].n);
    const tally = async (projectId) => ({
      onProject: await count('select count(*)::int n from "Notification" where "projectId" = $1', [projectId]),
      attackerOrg: await count('select count(*)::int n from "Notification" where "orgId" = $1', [aOrg]),
      victimOrg: await count('select count(*)::int n from "Notification" where "orgId" = $1', [vOrg]),
      victimPeople: await count('select count(*)::int n from "Notification" n join "OrganizationMembership" m on m."userId" = n."recipientUserId" and m."orgId" = $1', [vOrg]),
    });
    const body = (projectId) => ({ projectId, horizonDays: 7 });
    // ALLOWED
    const ok = await send(pm, 'POST', '/notifications/scan-due', body(A.id));
    check('due scan projectId: the company\'s own project is scanned (201, 1 project)', ok.status === 201 && ok.body?.data?.projects === 1, `${said(ok)}; ${JSON.stringify(ok.body?.data)}`);
    // REFUSED
    const t0 = await tally(V.id);
    const bad = await send(pm, 'POST', '/notifications/scan-due', body(V.id));
    const t1 = await tally(V.id);
    const none = await send(pm, 'POST', '/notifications/scan-due', body(nowhere()));
    note(`foreign scan answered ${bad.status} ${JSON.stringify(bad.body?.data ?? bad.body?.error)}; notifications before -> after: ${JSON.stringify(t0)} -> ${JSON.stringify(t1)}`);
    check(`due scan projectId: company ${VICTIM}'s project is refused (404 PROJECT_NOT_FOUND)`, refused(bad, 'PROJECT_NOT_FOUND'), said(bad));
    check('due scan projectId: …nothing created, for anyone', JSON.stringify(t0) === JSON.stringify(t1), `${JSON.stringify(t0)} -> ${JSON.stringify(t1)}`);
    check('due scan projectId: …exactly as an id that exists nowhere', said(bad) === said(none), `${said(bad)} | ${said(none)}`);
    const all = await send(pm, 'POST', '/notifications/scan-due', { horizonDays: 7 });
    check('due scan with no project: the company\'s own projects are scanned (201)', all.status === 201 && all.body?.data?.projects >= 1, `${said(all)}; ${JSON.stringify(all.body?.data)}`);
  }

  // ── after ────────────────────────────────────────────────────────────────
  const victimTraces = new RegExp([`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`, ...foreignIds].join('|'));
  const leaked = answers.filter((a) => victimTraces.test(a.text));
  check(`no answer to company ${ATTACKER} carries company ${VICTIM}'s ids, names, addresses or canaries`, leaked.length === 0, leaked.slice(0, 6).map((a) => `${a.status} ${a.route} -> ${(a.text.match(victimTraces) || [])[0]}`).join('\n        '));
  const errors = answers.filter((a) => a.status >= 500);
  check('no answer is a server error', errors.length === 0, errors.slice(0, 5).map((a) => `${a.status} ${a.route}`).join(', '));
  const after = await snapshot();
  const moved = fingerprint.compare(before, after).filter((c) => !c.noise && c.org === VICTIM);
  check(`company ${VICTIM}'s data did not change (every table)`, moved.length === 0, moved.slice(0, 8).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
  await db.end();

  const failed = results.filter((r) => !r.ok);
  console.log(`\npeople-templates proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
