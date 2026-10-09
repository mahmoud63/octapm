'use strict';

/**
 * WP-1 confirm-first reproduction: a zero-duration element (a milestone) is
 * not a date error (HR-S2, owner decision; fix plan
 * C:\Temp\octapm-cert\scratch\wp1-blocker-fix-plan.md §1.7; CERT-3 plan
 * §4 WP-1 confirm-first "Milestones block approval and baseline"; prep
 * wp1-prep.md §4 row 1).
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/wp1-milestone-repro.js
 *
 * In process (CERT_INPROCESS=1) on the certification database, through the
 * lock runner only. On a fresh scratch project of company 087 ("CERT3 WP1
 * milestone repro <stamp>", created by 087's PM, the planner put on its team),
 * a two-activity XER is imported: A100 (40 h = 5 days) FS -> M900 (0 h, a
 * finish milestone, early start = early finish = 2026-01-12). Then:
 *
 *   A.import          the file stages M900 with duration 0 and start = finish
 *   A.submit          the planner submits it for review (200 under_review)
 *   A.approve         the PM approves it: 200 approved (HEAD: 400
 *                     SCHEDULE_NOT_READY, date_sanity names M900)
 *   A.activate        the PM activates it with the suggested mapping (none:
 *                     nothing is active yet): 200, two new activities
 *   A.M.pointInTime   CPM stores M900 with duration 0 and startDate = endDate
 *                     (the precondition), and A100 with a finish after its start
 *   A.readiness       the revision's readiness: date_sanity passes, no row
 *   A.rename          PATCH M900 { name } as the planner: 200, dates unchanged
 *                     (HEAD: 400 INVALID_DATES)
 *   A.g1              PATCH M900 { endDate: its start - 1 day }: 400
 *                     INVALID_DATES, nothing written (updatedAt unchanged)
 *   A.g2              PATCH A100 (duration 5) { endDate: its start }: 400
 *                     INVALID_DATES, nothing written
 *   G.5xx             no answer was a 5xx
 *
 * When the approval is refused (HEAD), the activation cannot run: A.activate
 * fails and, so that the date guards are still exercised (prep §4: "after any
 * activation or a hand-built M900 of duration 0"), the planner builds the same
 * two activities by hand (CPM dates them the same way) and the remaining
 * checks run on those, A.readiness on the staged revision.
 *
 * The scratch project is archived at the end (DELETE /projects/:id, the
 * product's archive), whatever happened.
 *
 * Exit 0 when every check holds (the fixed behaviour), 2 when one fails (the
 * defect is present), 1 on a setup error. Results:
 * C:\Temp\octapm-cert\results\cert3\wp1-milestone-repro.json.
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

const NAME = 'wp1-milestone-repro';
const COMPANY = '087';
const RESULTS = `C:/Temp/octapm-cert/results/cert3/${NAME}.json`;
const STAMP = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${crypto.randomBytes(2).toString('hex')}`;
const PROJECT_NAME = `CERT3 WP1 milestone repro ${STAMP}`;
const START = '2026-01-05'; // a Monday; the file's day 0
const DAY_MS = 86_400_000;
/** Fixed before the first run: the ten checks listed above and G.5xx. */
const EXPECTED_CHECKS = 11;

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
const checkOf = (readiness, key) => (Array.isArray(readiness?.checks) ? readiness.checks.find((c) => c.key === key) || null : null);
const sameInstant = (a, b) => Boolean(a) && Boolean(b) && Date.parse(a) === Date.parse(b);
const isoDayBefore = (iso) => new Date(Date.parse(iso) - DAY_MS).toISOString();

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
  const pm = api.as({ email: pmEmail, orgId: org.id });
  const planner = api.as({ email: plannerEmail, orgId: org.id });
  ctx.pm = pm;
  const plannerId = await userId(plannerEmail);
  console.log(`${NAME}: company ${COMPANY} ${org.name} (${org.id}); stamp ${STAMP}; in process\n`);

  /** The stored row as written (text, no driver time-zone reading): what a refusal must leave alone. */
  const storedActivity = async (id) => (await q(
    'select name, duration, "startDate"::text as s, "endDate"::text as e, "updatedAt"::text as u from "Activity" where id = $1',
    [id],
  ))[0] || null;

  // ── setup: the scratch project and its planner ──────────────────────────
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
  const P = `/projects/${ctx.projectId}`;
  const team = ctx.projectId ? keep('PM puts the planner on the team', await pm.send('POST', `${P}/team`, { userId: plannerId, role: 'planning_eng' })) : null;
  const project = ctx.projectId ? keep('PM reads the project', await pm.send('GET', P)) : null;
  check('setup: the PM creates the scratch project (201, five-day calendar, start 2026-01-05) and puts the planner on its team as planning engineer',
    created.status === 201 && Boolean(ctx.projectId) && [200, 201].includes(team?.status) && team?.body?.data?.assignmentRole === 'planning_eng'
      && project?.status === 200 && project.body?.data?.name === PROJECT_NAME && String(project.body?.data?.startDate || '').slice(0, 10) === START,
    `project ${said(created)} ${ctx.projectId}; team ${said(team)} ${team?.body?.data?.assignmentRole}; read ${said(project)} start ${project?.body?.data?.startDate}`);
  if (!results.every((r) => r.ok)) throw new Error('setup incomplete');
  observed.projectId = ctx.projectId;

  // ── the file: A100 (5 days) FS -> M900 (0 days) ─────────────────────────
  console.log('\n── import ──');
  const model = files.programme({
    name: 'WP1-milestone-repro',
    start: START,
    wbs: { SUB: '1 Substructure' },
    tasks: [
      { code: 'A100', name: `Repro activity A (5 days) ${STAMP}`, wbs: 'SUB', hours: 40 },
      { code: 'M900', name: `Repro milestone M (0 days) ${STAMP}`, wbs: 'SUB', hours: 0 },
    ],
    links: [{ pred: 'A100', succ: 'M900', type: 'FS', lagHours: 0 }],
    note: 'HR-S2 reproduction: a five-day task and a zero-duration finish milestone after it',
  });
  const fileM = model.activities.find((a) => a.code === 'M900');
  if (!fileM || fileM.dates.es !== fileM.dates.ef || fileM.hours !== 0) throw new Error(`the generated file's M900 is not a point in time: ${JSON.stringify(fileM)}`);
  const xer = files.xer(model, { filename: `CERT3-WP1-milestone-repro-${STAMP}.xer` });
  const imported = keep('planner imports the XER', await planner.send('POST', `${P}/import/xer`, undefined, {
    form: api.multipart({ filename: xer.filename, contentType: xer.contentType, body: xer.body }),
  }));
  const revisionId = imported.status === 201 ? imported.body?.data?.revisionId || null : null;
  const RV = `${P}/schedule/revisions/${revisionId}`;
  const revision = revisionId ? keep('PM reads the staged revision', await pm.send('GET', RV)) : null;
  const staged = listOf(revision?.body?.data?.snapshotJson?.activities);
  const stagedM = staged.find((a) => a.p6ActivityId === 'M900') || null;
  const stagedA = staged.find((a) => a.p6ActivityId === 'A100') || null;
  observed.revisionId = revisionId;
  observed.staged = { A100: stagedA && { draftKey: stagedA.draftKey, duration: stagedA.duration, startDate: stagedA.startDate, endDate: stagedA.endDate }, M900: stagedM && { draftKey: stagedM.draftKey, duration: stagedM.duration, startDate: stagedM.startDate, endDate: stagedM.endDate } };
  check(`A.import: the planner's XER is staged (201, a draft xer revision of 2 activities, 1 link); M900 is staged with duration 0 and start = finish (${fileM.dates.es}), A100 with duration 5`,
    imported.status === 201 && Boolean(revisionId) && Number(imported.body?.data?.dependencyCount) === 1
      && revision?.status === 200 && revision.body?.data?.status === 'draft' && revision.body?.data?.source === 'xer' && staged.length === 2
      && Number(stagedM?.duration) === 0 && sameInstant(stagedM?.startDate, stagedM?.endDate)
      && Number(stagedA?.duration) === 5 && Date.parse(stagedA?.endDate) > Date.parse(stagedA?.startDate),
    `import ${said(imported)} ${JSON.stringify(imported.body?.data || imported.body?.error || {}).slice(0, 300)}; revision ${said(revision)} ${revision?.body?.data?.status} ${revision?.body?.data?.source}; staged ${JSON.stringify(observed.staged)}`);
  if (!results.every((r) => r.ok)) throw new Error('setup incomplete: the file was not staged as written');

  // ── review and approval ─────────────────────────────────────────────────
  console.log('\n── review and approval ──');
  const submitted = keep('planner submits for review', await planner.send('POST', `${RV}/submit-review`, { comment: `WP1 milestone repro ${STAMP}` }));
  check('A.submit: the planner submits the staged revision for review (200 under_review)',
    submitted.status === 200 && submitted.body?.data?.status === 'under_review', `${said(submitted)} ${submitted.body?.data?.status || ''}`);
  if (!results.every((r) => r.ok)) throw new Error('setup incomplete: the revision could not be submitted');

  const approved = keep('PM approves', await pm.send('POST', `${RV}/approve`, { comment: `WP1 milestone repro ${STAMP}` }));
  const refusedSanity = checkOf(approved.body?.error?.details, 'date_sanity');
  const approvedOk = approved.status === 200 && approved.body?.data?.status === 'approved';
  observed.approve = { said: said(approved), dateSanity: refusedSanity ? { passed: refusedSanity.passed, invalidRows: refusedSanity.details?.invalidRows } : null };
  check('A.approve: the PM approves the revision with the zero-duration milestone: 200 approved (HEAD: 400 SCHEDULE_NOT_READY, date_sanity finish_date_before_start_date on M900)',
    approvedOk,
    `${said(approved)} ${approved.body?.data?.status || ''}; ${refusedSanity ? `date_sanity passed ${refusedSanity.passed}, invalidRows ${JSON.stringify(refusedSanity.details?.invalidRows)}` : 'no readiness in the answer'}; ${approved.body?.error?.message || ''}`);

  // ── activation (or, when the approval is refused, the same network by hand) ──
  console.log('\n── activation ──');
  let ids = { A100: null, M900: null };
  if (approvedOk) {
    const mapping = keep('PM reads the mapping', await pm.send('GET', `${RV}/mapping`));
    const suggested = listOf(mapping.body?.data?.suggestedMappings);
    const mappings = suggested.map(({ oldActivityId, newActivityKey }) => ({ oldActivityId, newActivityKey }));
    const activated = keep('PM activates with the suggested mapping', await pm.send('POST', `${RV}/activate`, { mappings, comment: `WP1 milestone repro ${STAMP}` }));
    const activation = activated.body?.data?.activation || {};
    const newIds = listOf(activation.newActivities);
    const rows = listOf((keep('PM lists the activities', await pm.send('GET', `${P}/activities`)))?.body?.data);
    const mine = rows.filter((a) => newIds.includes(a.id));
    ids = { A100: mine.find((a) => a.p6ActivityId === 'A100')?.id || null, M900: mine.find((a) => a.p6ActivityId === 'M900')?.id || null };
    observed.activation = { mappingSaid: said(mapping), suggested: suggested.length, said: said(activated), newActivities: newIds, updated: activation.updatedActivities, retired: activation.retiredActivities, dependencyCount: activation.dependencyCount };
    check('A.activate: with nothing active the suggested mapping is empty and the file\'s two rows are new; the PM activates with it: 200, revision active, 2 new activities (A100 and M900), none updated or retired, 1 dependency',
      mapping.status === 200 && suggested.length === 0 && listOf(mapping.body?.data?.newActivities).length === 2 && listOf(mapping.body?.data?.unmappedExisting).length === 0
        && activated.status === 200 && activated.body?.data?.revision?.isActive === true
        && newIds.length === 2 && listOf(activation.updatedActivities).length === 0 && listOf(activation.retiredActivities).length === 0
        && Number(activation.dependencyCount) === 1 && Boolean(ids.A100) && Boolean(ids.M900),
      `mapping ${said(mapping)} suggested ${suggested.length} new ${listOf(mapping.body?.data?.newActivities).length}; activate ${said(activated)} ${activated.body?.error?.message || ''}; activation ${JSON.stringify(observed.activation)}; ids ${JSON.stringify(ids)}`);
  } else {
    // HEAD: the approval is refused, so nothing can be activated. The same network by
    // hand (prep §4 row 1), so the date guards below still run; CPM dates it the same way.
    const makeA = keep('fallback: planner creates A100 by hand', await planner.send('POST', `${P}/activities`, {
      name: `Repro activity A (5 days) ${STAMP}`, activityCode: 'A100', wbsCode: '1 Substructure', duration: 5, sortOrder: 0, engineerIds: [plannerId],
    }));
    ids.A100 = makeA.status === 201 ? makeA.body?.data?.id || null : null;
    const makeM = ids.A100 ? keep('fallback: planner creates M900 by hand', await planner.send('POST', `${P}/activities`, {
      name: `Repro milestone M (0 days) ${STAMP}`, activityCode: 'M900', wbsCode: '1 Substructure', duration: 0, isMilestone: true, sortOrder: 1, engineerIds: [plannerId],
      dependencies: [{ predecessorId: ids.A100, relationshipType: 'FS', lagDays: 0 }],
    })) : null;
    ids.M900 = makeM?.status === 201 ? makeM.body?.data?.id || null : null;
    observed.fallback = { A100: said(makeA), M900: said(makeM) };
    check('A.activate: the approved revision is activated with the suggested mapping',
      false, `not run: the approval answered ${said(approved)}, so there is nothing to activate; fallback: the same network built by hand (A100 ${said(makeA)}, M900 ${said(makeM)}) for the checks that follow`);
    if (!ids.A100 || !ids.M900) throw new Error(`setup incomplete: the fallback network could not be built (A100 ${said(makeA)}, M900 ${said(makeM)})`);
  }
  observed.ids = ids;
  if (!ids.A100 || !ids.M900) throw new Error('setup incomplete: no activities A100 and M900 to check');
  const AA = `${P}/activities/${ids.A100}`;
  const AM = `${P}/activities/${ids.M900}`;

  // ── M900 as CPM stores it ───────────────────────────────────────────────
  const m0 = keep('PM reads M900', await pm.send('GET', AM));
  const a0 = keep('PM reads A100', await pm.send('GET', AA));
  const M = m0.body?.data || {};
  const A = a0.body?.data || {};
  observed.afterCpm = { M900: { duration: M.duration, startDate: M.startDate, endDate: M.endDate, earlyStart: M.earlyStart, earlyFinish: M.earlyFinish }, A100: { duration: A.duration, startDate: A.startDate, endDate: A.endDate } };
  check('A.M.pointInTime: the precondition: CPM stores M900 with duration 0 and startDate = endDate (a point in time), and A100 (duration 5) with a finish after its start',
    m0.status === 200 && a0.status === 200 && Number(M.duration) === 0 && sameInstant(M.startDate, M.endDate)
      && Number(A.duration) === 5 && Date.parse(A.endDate) > Date.parse(A.startDate),
    `M900 ${said(m0)} ${JSON.stringify(observed.afterCpm.M900)}; A100 ${said(a0)} ${JSON.stringify(observed.afterCpm.A100)}`);

  // ── readiness ───────────────────────────────────────────────────────────
  const ready = keep('PM reads the readiness', await pm.send('GET', `${RV}/readiness`));
  const sanity = checkOf(ready.body?.data, 'date_sanity');
  observed.readiness = { said: said(ready), revisionStatus: ready.body?.data?.status, dateSanity: sanity ? { passed: sanity.passed, invalidRows: sanity.details?.invalidRows, message: sanity.message } : null };
  check(`A.readiness: the revision's readiness (${approvedOk ? 'the active revision' : 'the staged revision: the approval was refused'}) passes date_sanity with no invalid row (HEAD: false, M900 finish_date_before_start_date)`,
    ready.status === 200 && sanity?.passed === true && Array.isArray(sanity?.details?.invalidRows) && sanity.details.invalidRows.length === 0,
    `${said(ready)}; date_sanity ${JSON.stringify(observed.readiness.dateSanity)}`);

  // ── the planner renames M900 ────────────────────────────────────────────
  console.log('\n── edits ──');
  const newName = `Repro milestone M renamed ${STAMP}`;
  const renamed = keep('planner renames M900', await planner.send('PATCH', AM, { name: newName }));
  const m1 = keep('PM reads M900 after the rename', await pm.send('GET', AM));
  const M1 = m1.body?.data || {};
  check('A.rename: the planner renames M900 (PATCH { name }): 200, the name is stored and the dates are unchanged and still equal (HEAD: 400 INVALID_DATES)',
    renamed.status === 200 && m1.status === 200 && M1.name === newName && sameInstant(M1.startDate, M.startDate) && sameInstant(M1.endDate, M.endDate) && sameInstant(M1.startDate, M1.endDate),
    `${said(renamed)} ${renamed.body?.error?.message || ''}; read ${said(m1)} name ${JSON.stringify(M1.name)} start ${M1.startDate} end ${M1.endDate}`);

  // g1: a finish before the start of the milestone is still refused, before any write.
  const mBefore = await storedActivity(ids.M900);
  const g1End = isoDayBefore(M.startDate);
  const g1 = keep('planner moves M900\'s finish a day before its start', await planner.send('PATCH', AM, { endDate: g1End }));
  const mAfter = await storedActivity(ids.M900);
  check(`A.g1: PATCH M900 { endDate: its start - 1 day (${g1End}) }: 400 INVALID_DATES, and the stored row is unchanged (endDate, updatedAt)`,
    said(g1) === '400 INVALID_DATES' && Boolean(mBefore) && JSON.stringify(mAfter) === JSON.stringify(mBefore),
    `${said(g1)}; before ${JSON.stringify(mBefore)}; after ${JSON.stringify(mAfter)}`);

  // g2: a finish on the start of an activity that has a duration is still refused.
  const aBefore = await storedActivity(ids.A100);
  const g2 = keep('planner moves A100\'s finish onto its start', await planner.send('PATCH', AA, { endDate: A.startDate }));
  const aAfter = await storedActivity(ids.A100);
  check(`A.g2: PATCH A100 (duration 5) { endDate: its start (${A.startDate}) }: 400 INVALID_DATES, and the stored row is unchanged (endDate, updatedAt)`,
    said(g2) === '400 INVALID_DATES' && Boolean(aBefore) && Number(aBefore.duration) === 5 && JSON.stringify(aAfter) === JSON.stringify(aBefore),
    `${said(g2)}; before ${JSON.stringify(aBefore)}; after ${JSON.stringify(aAfter)}`);
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
    kind: 'confirm-first reproduction (HR-S2)',
    plan: 'C:/Temp/octapm-cert/scratch/wp1-blocker-fix-plan.md §1.7',
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
