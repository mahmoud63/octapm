'use strict';

/**
 * WP-1 confirm-first reproduction: activation keeps the activity code and
 * budget, and the mapping suggests by code (fix plan
 * C:\Temp\octapm-cert\scratch\wp1-blocker-fix-plan.md §2.7, as the integration
 * owner adjusted it after the Codex plan review (H1-H3); CERT-3 plan §4 WP-1
 * confirm-first "Activation nulls activityCode, budget 0, name-only mapping";
 * plan §5 defect fixes "activation keeps the activity code and budget, and
 * suggests mapping by code"; prep wp1-prep.md §4 row 4).
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp1-activation-code-repro.js
 *
 * In process (CERT_INPROCESS=1) on the certification database, through the
 * lock runner only. On a fresh scratch project of company 087 ("CERT3 WP1
 * activation code repro <stamp>", created by 087's PM, the planner and the
 * site engineer put on its team) the planner builds two activities by hand:
 *
 *   A100  code A100, WBS "1 Substructure", category civil, duration 5,
 *         the site engineer
 *   A110  code A110, category civil, duration 10, budget 60,000, FS A100,
 *         the site engineer
 *
 * A two-task XER is imported: task_id 1001 / 1002, task_code A100 / A110,
 * 40 h and 80 h, A100 FS A110, no zero-duration row (so the reproduction does
 * not depend on HR-S2), with task names that differ from the hand-built ones
 * (a name match cannot explain a correct suggestion). Then:
 *
 *   B.import       staged (201): p6ActivityId A100 / A110, keys 1001 / 1002
 *   B.submit       the planner submits (200 under_review)
 *   B.approve      the PM approves (200 approved)
 *   B.mapByCode    GET mapping: both pairs are activity_code with confidence 1,
 *                  the old code = the staged P6 id, A100 -> 1001, A110 -> 1002
 *                  (HEAD: A100 wbs_code, A110 unmatched)
 *   B.mapComplete  nothing unmapped, nothing new
 *   B.activate     the PM activates with the suggested pairs: 200, both
 *                  activities updated in place, none new or retired
 *   B.code         A100 / A110 keep their activityCode (HEAD: null)
 *   B.budget       A110 keeps budget 60,000 and A100 its own (HEAD: 0)
 *   B.category     both keep category civil (HEAD: null)
 *   B.file         the file still drives the schedule: durations 5 and 10,
 *                  p6ActivityId = the task_code, the names are the file's
 *   G.5xx          no answer was a 5xx
 *
 * When the suggestion is not the complete code mapping (HEAD), activating with
 * it would only be refused for the unmapped activity, so the activation uses
 * the explicit code pairs instead (A100 -> the row whose P6 id is A100, ...),
 * and the result records which pairs were sent: the data-loss checks then run
 * on what an activation by code writes.
 *
 * The scratch project is archived at the end (DELETE /projects/:id), whatever
 * happened.
 *
 * Exit 0 when every check holds (the fixed behaviour), 2 when one fails (the
 * defect is present), 1 on a setup error. Results:
 * C:\Temp\octapm-cert\results\cert3\wp1-activation-code-repro.json.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const guard = require('../lib/cert-env');
process.env.DATABASE_URL = guard.certDatabaseUrl();
// The background machinery and the per-request log stay off in process.
for (const name of ['JOB_WORKER_ENABLED', 'SCHEDULERS_ENABLED', 'EXCEPTIONS_ENGINE_ENABLED']) process.env[name] = 'false';
process.env.REQUEST_LOG_FORMAT = 'off';

const crypto = require('crypto');
const fs = require('fs');
const api = require('../lib/api');
const { buildPopulation } = require('../lib/spec');
const files = require('./build/files');

const NAME = 'wp1-activation-code-repro';
const COMPANY = '087';
const RESULTS = `C:/Temp/octapm-cert/results/cert3/${NAME}.json`;
const STAMP = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${crypto.randomBytes(2).toString('hex')}`;
const PROJECT_NAME = `CERT3 WP1 activation code repro ${STAMP}`;
const START = '2026-01-05'; // a Monday; the file's day 0
const WBS = '1 Substructure';
const BUDGET_A110 = 60000;
/** The hand-built programme and the file: same codes, different names. */
const HAND = {
  A100: { name: `Hand-built site clearance ${STAMP}`, duration: 5 },
  A110: { name: `Hand-built excavation ${STAMP}`, duration: 10 },
};
const FILE = {
  A100: { taskId: '1001', name: `File: mobilisation and setting out ${STAMP}`, hours: 40, days: 5 },
  A110: { taskId: '1002', name: `File: bulk earthworks to formation ${STAMP}`, hours: 80, days: 10 },
};
const CODES = ['A100', 'A110'];
/** Fixed before the first run: setup, the eleven checks listed above (G.5xx included). */
const EXPECTED_CHECKS = 12;

const results = [];
const answers = [];
const observed = {};
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 3000) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n        ${String(detail).slice(0, 1500)}` : ''}`);
};
const said = (res) => (res ? `${res.status} ${res.body?.error?.code || ''}`.trim() : 'no answer');
const keep = (label, res) => {
  if (res) answers.push({ label, status: res.status, said: said(res) });
  return res;
};
const listOf = (data) => (Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

const cleanup = [];
const ctx = { db: null, pm: null, projectId: null };

const main = async () => {
  if (process.env.CERT_INPROCESS !== '1') throw new Error('run through C:\\Temp\\octapm-cert\\run-locked.js (CERT_INPROCESS=1)');
  if (!process.env.CERT_PASSWORD) throw new Error('CERT_PASSWORD is not set');
  const company = buildPopulation().companies.find((c) => c.code === COMPANY);
  if (!company) throw new Error(`no company ${COMPANY} in the population`);
  const db = await guard.connectCert();
  ctx.db = db;
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const orgs = await q('select id, slug, name from "Organisation" where slug like $1', [`cert-${COMPANY}-%`]);
  if (orgs.length !== 1) throw new Error(`company ${COMPANY}: ${orgs.length} organisations, exactly one expected`);
  const org = guard.assertCertOrganisation(orgs[0]);
  const userId = async (email) => {
    const rows = await q('select id from "User" where email = $1', [email]);
    if (rows.length !== 1) throw new Error(`${email}: ${rows.length} users`);
    return rows[0].id;
  };
  const pmEmail = `pm@${company.domain}`;
  const plannerEmail = `planner@${company.domain}`;
  const siteEmail = `site@${company.domain}`;
  const pm = api.as({ email: pmEmail, orgId: org.id });
  const planner = api.as({ email: plannerEmail, orgId: org.id });
  ctx.pm = pm;
  const plannerId = await userId(plannerEmail);
  const siteId = await userId(siteEmail);
  console.log(`${NAME}: company ${COMPANY} ${org.name} (${org.id}); stamp ${STAMP}; in process\n`);

  // ── setup: the scratch project, its team, the hand-built programme ──────
  console.log('── setup ──');
  const created = keep('PM creates the scratch project', await pm.send('POST', '/projects', {
    name: PROJECT_NAME, startDate: START, endDate: '2026-12-31', projectCalendar: 'five_day',
  }));
  ctx.projectId = created.status === 201 ? created.body?.data?.id || null : null;
  if (ctx.projectId) {
    cleanup.push(async () => {
      const res = keep('cleanup: PM archives the scratch project', await pm.send('DELETE', `/projects/${ctx.projectId}`));
      const row = (await q('select "archivedAt"::text as a from "Project" where id = $1', [ctx.projectId]))[0];
      return `scratch project ${ctx.projectId} archive ${said(res)}, archivedAt ${row?.a || 'NOT SET'}`;
    });
  }
  observed.projectId = ctx.projectId;
  const P = `/projects/${ctx.projectId}`;
  const teamPlanner = ctx.projectId ? keep('PM puts the planner on the team', await pm.send('POST', `${P}/team`, { userId: plannerId, role: 'planning_eng' })) : null;
  const teamSite = ctx.projectId ? keep('PM puts the site engineer on the team', await pm.send('POST', `${P}/team`, { userId: siteId, role: 'site_engineer' })) : null;
  const makeA100 = ctx.projectId ? keep('planner creates A100', await planner.send('POST', `${P}/activities`, {
    name: HAND.A100.name, activityCode: 'A100', wbsCode: WBS, category: 'civil', duration: HAND.A100.duration, sortOrder: 0, engineerIds: [siteId],
  })) : null;
  const ids = { A100: makeA100?.status === 201 ? makeA100.body?.data?.id || null : null, A110: null };
  const makeA110 = ids.A100 ? keep('planner creates A110', await planner.send('POST', `${P}/activities`, {
    name: HAND.A110.name, activityCode: 'A110', category: 'civil', duration: HAND.A110.duration, budget: BUDGET_A110, sortOrder: 1, engineerIds: [siteId],
    dependencies: [{ predecessorId: ids.A100, relationshipType: 'FS', lagDays: 0 }],
  })) : null;
  ids.A110 = makeA110?.status === 201 ? makeA110.body?.data?.id || null : null;
  observed.ids = ids;
  // The pre-state, as the PM (a BOQ reader: the budget is not withheld) reads it.
  const read = async (label, id) => (id ? keep(label, await pm.send('GET', `${P}/activities/${id}`)) : null);
  const pre = { A100: (await read('PM reads A100 before', ids.A100))?.body?.data || null, A110: (await read('PM reads A110 before', ids.A110))?.body?.data || null };
  observed.pre = Object.fromEntries(CODES.map((c) => [c, pre[c] && { activityCode: pre[c].activityCode, p6ActivityId: pre[c].p6ActivityId, wbsCode: pre[c].wbsCode, category: pre[c].category, budget: pre[c].budget, duration: pre[c].duration, name: pre[c].name, engineers: listOf(pre[c].assignedEngineers).map((e) => e.id), dependencies: listOf(pre[c].dependencies).length }]));
  check('setup: the PM creates the scratch project and puts the planner and the site engineer on its team; the planner builds A100 (A100, WBS 1 Substructure, civil, 5 days) and A110 (A110, civil, 10 days, budget 60,000, FS A100), each with the site engineer; the PM reads them back so',
    created.status === 201 && Boolean(ctx.projectId) && [200, 201].includes(teamPlanner?.status) && [200, 201].includes(teamSite?.status)
      && makeA100?.status === 201 && makeA110?.status === 201
      && pre.A100?.activityCode === 'A100' && pre.A100?.wbsCode === WBS && pre.A100?.category === 'civil' && num(pre.A100?.duration) === 5
      && pre.A110?.activityCode === 'A110' && pre.A110?.category === 'civil' && num(pre.A110?.duration) === 10 && num(pre.A110?.budget) === BUDGET_A110
      && !pre.A100?.p6ActivityId && !pre.A110?.p6ActivityId
      && listOf(pre.A110?.dependencies).length === 1
      && CODES.every((c) => listOf(pre[c]?.assignedEngineers).some((e) => e.id === siteId)),
    `project ${said(created)}; team planner ${said(teamPlanner)}, site ${said(teamSite)}; A100 ${said(makeA100)} ${makeA100?.body?.error?.message || ''}; A110 ${said(makeA110)} ${makeA110?.body?.error?.message || ''}; read ${JSON.stringify(observed.pre)}`);
  if (!results.every((r) => r.ok)) throw new Error('setup incomplete');

  // ── the file: same codes, different names ───────────────────────────────
  console.log('\n── import ──');
  const model = files.programme({
    name: 'WP1-activation-code-repro',
    start: START,
    wbs: { SUB: WBS },
    tasks: CODES.map((code) => ({ code, name: FILE[code].name, wbs: 'SUB', hours: FILE[code].hours })),
    links: [{ pred: 'A100', succ: 'A110', type: 'FS', lagHours: 0 }],
    note: 'activation code/budget reproduction: two tasks, no zero-duration row, names unlike the hand-built ones',
  });
  const xer = files.xer(model, { filename: `CERT3-WP1-activation-code-repro-${STAMP}.xer` });
  // The writer numbers TASK rows 1000 x project + index + 1: the keys the activation maps to.
  const xerTaskIds = String(xer.body).split('\r\n').filter((line) => /^%R\t100\d\t/.test(line)).map((line) => line.split('\t')[1]);
  if (JSON.stringify(xerTaskIds) !== JSON.stringify(CODES.map((c) => FILE[c].taskId))) throw new Error(`the XER's task_ids are ${xerTaskIds.join(', ')}, not 1001, 1002`);
  const imported = keep('planner imports the XER', await planner.send('POST', `${P}/import/xer`, undefined, {
    form: api.multipart({ filename: xer.filename, contentType: xer.contentType, body: xer.body }),
  }));
  const revisionId = imported.status === 201 ? imported.body?.data?.revisionId || null : null;
  observed.revisionId = revisionId;
  const RV = `${P}/schedule/revisions/${revisionId}`;
  const revision = revisionId ? keep('PM reads the staged revision', await pm.send('GET', RV)) : null;
  const staged = listOf(revision?.body?.data?.snapshotJson?.activities);
  const stagedOf = (code) => staged.find((a) => a.p6ActivityId === code) || null;
  observed.staged = Object.fromEntries(CODES.map((c) => [c, stagedOf(c) && { draftKey: stagedOf(c).draftKey, sourceActivityId: stagedOf(c).sourceActivityId, name: stagedOf(c).name, duration: stagedOf(c).duration, activityCode: stagedOf(c).activityCode ?? null, budget: stagedOf(c).budget ?? null, category: stagedOf(c).category ?? null }]));
  check('B.import: the planner\'s XER is staged (201, a draft xer revision of 2 activities, 1 link): the file\'s codes as p6ActivityId A100 / A110 under keys 1001 / 1002, durations 5 / 10, the file\'s names (unlike the hand-built ones)',
    imported.status === 201 && Boolean(revisionId) && Number(imported.body?.data?.dependencyCount) === 1
      && revision?.status === 200 && revision.body?.data?.status === 'draft' && revision.body?.data?.source === 'xer' && staged.length === 2
      && CODES.every((c) => stagedOf(c)?.draftKey === FILE[c].taskId && num(stagedOf(c)?.duration) === FILE[c].days && stagedOf(c)?.name === FILE[c].name && stagedOf(c)?.name !== HAND[c].name),
    `import ${said(imported)} ${JSON.stringify(imported.body?.data || imported.body?.error || {}).slice(0, 300)}; revision ${said(revision)} ${revision?.body?.data?.status}; staged ${JSON.stringify(observed.staged)}`);
  if (!results.every((r) => r.ok)) throw new Error('setup incomplete: the file was not staged as written');

  // ── review and approval ─────────────────────────────────────────────────
  console.log('\n── review and approval ──');
  const submitted = keep('planner submits for review', await planner.send('POST', `${RV}/submit-review`, { comment: `WP1 activation code repro ${STAMP}` }));
  check('B.submit: the planner submits the staged revision for review (200 under_review)',
    submitted.status === 200 && submitted.body?.data?.status === 'under_review', `${said(submitted)} ${submitted.body?.data?.status || ''} ${submitted.body?.error?.message || ''}`);
  if (!results.every((r) => r.ok)) throw new Error('setup incomplete: the revision could not be submitted');
  const approved = keep('PM approves', await pm.send('POST', `${RV}/approve`, { comment: `WP1 activation code repro ${STAMP}` }));
  check('B.approve: the PM approves it (200 approved; the file has no zero-duration row, so HR-S2 is not involved)',
    approved.status === 200 && approved.body?.data?.status === 'approved', `${said(approved)} ${approved.body?.data?.status || ''} ${approved.body?.error?.message || ''}`);
  if (!results.every((r) => r.ok)) throw new Error('setup incomplete: the revision could not be approved');

  // ── the mapping the product suggests ────────────────────────────────────
  console.log('\n── mapping ──');
  const mapping = keep('PM reads the mapping', await pm.send('GET', `${RV}/mapping`));
  const m = mapping.body?.data || {};
  const suggested = listOf(m.suggestedMappings);
  const pairOf = (code) => suggested.find((s) => s.oldActivityId === ids[code]) || null;
  observed.mapping = {
    said: said(mapping),
    counts: m.counts,
    suggested: suggested.map((s) => ({ old: s.oldActivity?.activityCode, oldId: s.oldActivityId, key: s.newActivityKey, newP6: s.newActivity?.p6ActivityId, matchType: s.matchType, confidence: s.confidence })),
    unmappedExisting: listOf(m.unmappedExisting).map((a) => a.activityCode || a.id),
    newActivities: listOf(m.newActivities).map((a) => a.p6ActivityId || a.key),
  };
  check('B.mapByCode: GET mapping suggests both hand-built activities by code: matchType activity_code, confidence 1, the old activity\'s code = the staged row\'s P6 id, A100 -> 1001 and A110 -> 1002 (HEAD: A100 by wbs_code, A110 unmatched)',
    mapping.status === 200 && suggested.length === 2
      && CODES.every((c) => {
        const pair = pairOf(c);
        return pair?.matchType === 'activity_code' && Number(pair?.confidence) === 1 && pair?.newActivityKey === FILE[c].taskId
          && pair?.oldActivity?.activityCode === c && pair?.newActivity?.p6ActivityId === c;
      }),
    `${said(mapping)}; ${JSON.stringify(observed.mapping.suggested)}`);
  check('B.mapComplete: nothing is left unmapped and nothing is new (unmappedExisting [], newActivities [])',
    mapping.status === 200 && listOf(m.unmappedExisting).length === 0 && listOf(m.newActivities).length === 0,
    `unmappedExisting ${JSON.stringify(observed.mapping.unmappedExisting)}; newActivities ${JSON.stringify(observed.mapping.newActivities)}`);

  // ── activation ──────────────────────────────────────────────────────────
  console.log('\n── activation ──');
  // The staged rows by P6 id, from the mapping's own identities (paired or new).
  const stagedKeyByCode = new Map();
  for (const s of suggested) if (s.newActivity?.p6ActivityId) stagedKeyByCode.set(s.newActivity.p6ActivityId, s.newActivityKey);
  for (const n of listOf(m.newActivities)) if (n.p6ActivityId && !stagedKeyByCode.has(n.p6ActivityId)) stagedKeyByCode.set(n.p6ActivityId, n.key);
  const byCode = CODES.map((c) => ({ oldActivityId: ids[c], newActivityKey: stagedKeyByCode.get(c) || null }));
  const suggestedPairs = suggested.map(({ oldActivityId, newActivityKey }) => ({ oldActivityId, newActivityKey }));
  const suggestionIsTheCodeMapping = suggestedPairs.length === CODES.length
    && byCode.every((p) => suggestedPairs.some((s) => s.oldActivityId === p.oldActivityId && s.newActivityKey === p.newActivityKey));
  if (!suggestionIsTheCodeMapping && byCode.some((p) => !p.newActivityKey)) throw new Error(`setup incomplete: the staged rows cannot be paired by code (${JSON.stringify(byCode)})`);
  const mappingsSent = suggestionIsTheCodeMapping ? suggestedPairs : byCode;
  observed.activationMappings = { sent: suggestionIsTheCodeMapping ? 'the suggested pairs' : 'the explicit code pairs (the suggestion was not the code mapping)', pairs: mappingsSent };
  const activated = keep('PM activates', await pm.send('POST', `${RV}/activate`, { mappings: mappingsSent, comment: `WP1 activation code repro ${STAMP}` }));
  const activation = activated.body?.data?.activation || {};
  const isActivated = activated.status === 200 && activated.body?.data?.revision?.isActive === true;
  observed.activation = { said: said(activated), updated: activation.updatedActivities, new: activation.newActivities, retired: activation.retiredActivities, dependencyCount: activation.dependencyCount };
  check(`B.activate: the PM activates with ${observed.activationMappings.sent}: 200, the revision active, both hand-built activities updated in place (same ids), none new or retired, 1 dependency`,
    isActivated && sameSet(listOf(activation.updatedActivities), [ids.A100, ids.A110])
      && listOf(activation.newActivities).length === 0 && listOf(activation.retiredActivities).length === 0 && Number(activation.dependencyCount) === 1,
    `${said(activated)} ${activated.body?.error?.message || ''}; ${JSON.stringify(observed.activation)}`);

  // ── what the activation kept ────────────────────────────────────────────
  console.log('\n── after the activation ──');
  const post = { A100: (await read('PM reads A100 after', ids.A100))?.body?.data || null, A110: (await read('PM reads A110 after', ids.A110))?.body?.data || null };
  observed.post = Object.fromEntries(CODES.map((c) => [c, post[c] && { id: post[c].id, activityCode: post[c].activityCode, p6ActivityId: post[c].p6ActivityId, category: post[c].category, budget: post[c].budget, duration: post[c].duration, name: post[c].name, wbsCode: post[c].wbsCode }]));
  const notRun = isActivated ? '' : `not judged: the activation answered ${said(activated)}, so these rows are the hand-built ones; `;
  check('B.code: after the activation A100 and A110 keep their activity codes, A100 and A110 (HEAD: null)',
    isActivated && post.A100?.activityCode === 'A100' && post.A110?.activityCode === 'A110',
    `${notRun}A100 ${JSON.stringify(post.A100?.activityCode)}, A110 ${JSON.stringify(post.A110?.activityCode)}`);
  check('B.budget: after the activation A110 keeps budget 60,000 and A100 keeps its own (HEAD: 0)',
    isActivated && num(post.A110?.budget) === BUDGET_A110 && num(post.A100?.budget) === num(pre.A100?.budget) && post.A100?.budget !== undefined,
    `${notRun}A110 ${JSON.stringify(post.A110?.budget)} (before ${JSON.stringify(pre.A110?.budget)}), A100 ${JSON.stringify(post.A100?.budget)} (before ${JSON.stringify(pre.A100?.budget)})`);
  check('B.category: after the activation both keep category civil (the file states none; HEAD: null)',
    isActivated && post.A100?.category === 'civil' && post.A110?.category === 'civil',
    `${notRun}A100 ${JSON.stringify(post.A100?.category)}, A110 ${JSON.stringify(post.A110?.category)}`);
  check('B.file: the file still drives the schedule: the same ids, durations 5 and 10, p6ActivityId = the task_code (A100, A110), the names are the file\'s',
    isActivated && CODES.every((c) => post[c]?.id === ids[c] && num(post[c]?.duration) === FILE[c].days && post[c]?.p6ActivityId === c && post[c]?.name === FILE[c].name),
    `${notRun}${JSON.stringify(observed.post)}`);
};

const finish = async (error = null) => {
  const cleaned = [];
  for (const step of cleanup.reverse()) {
    try {
      cleaned.push(String(await step()));
    } catch (e) {
      cleaned.push(`cleanup failed: ${e.message}`);
    }
  }
  console.log(`\ncleanup: ${cleaned.join('; ') || 'nothing to remove'}`);
  // G.5xx, after main and cleanup: every answer seen, the cleanup's too.
  if (!error || results.length) {
    const fives = answers.filter((a) => a.status >= 500);
    check('G.5xx: no answer was a 5xx', fives.length === 0, fives.map((a) => `${a.label} ${a.said}`).join(', '));
  }
  if (ctx.db) await ctx.db.end().catch(() => {});
  const failed = results.filter((r) => !r.ok).length;
  const complete = results.length === EXPECTED_CHECKS;
  const ok = !error && failed === 0 && complete;
  const out = {
    proof: NAME,
    kind: 'confirm-first reproduction (activation keeps the code and budget; mapping by code)',
    plan: 'C:/Temp/octapm-cert/scratch/wp1-blocker-fix-plan.md §2.7 (adjusted: wp1-fix-plan-adjudication.md H1-H3)',
    company: COMPANY,
    project: PROJECT_NAME,
    stamp: STAMP,
    at: new Date().toISOString(),
    expected: EXPECTED_CHECKS,
    total: results.length,
    passed: results.length - failed,
    failed,
    exitCode: error ? 1 : ok ? 0 : 2,
    verdict: error ? 'SETUP_ERROR' : ok ? 'FIXED_BEHAVIOUR_HOLDS' : 'DEFECT_PRESENT',
    error: error ? String(error.stack || error.message) : null,
    observed,
    answers: answers.reduce((acc, a) => ({ ...acc, [a.status]: (acc[a.status] || 0) + 1 }), {}),
    cleanup: cleaned,
    results,
  };
  try {
    fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
    fs.writeFileSync(RESULTS, `${JSON.stringify(out, null, 2)}\n`);
  } catch (e) {
    console.error(`could not write ${RESULTS}: ${e.message}`);
  }
  console.log(`\n${NAME}: ${results.length - failed} passed, ${failed} failed of ${results.length} (fixed count ${EXPECTED_CHECKS})${complete ? '' : ' — INCOMPLETE'}; exit ${out.exitCode}`);
  process.exitCode = out.exitCode;
};

main()
  .then(() => finish())
  .catch(async (error) => {
    console.error(`SCRIPT ERROR: ${error.stack || error.message}`);
    await finish(error);
  })
  .finally(() => {
    // The in-process app keeps database handles open; leave once the result is written.
    setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
  });
