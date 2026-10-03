'use strict';

/**
 * The live proof of the CERT-2 injection pairs of progress and site reports:
 * a progress submission (one activity, a bulk batch, or the one a daily report
 * makes) may name only its own project's documents as photo evidence, and a
 * weekly report may list only its own project's activities.
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/progress-reports-proof.js [attacker=024] [victim=025]
 *
 * The pairs (cert2-inject, all answered 2xx and stored the other company's id):
 *   POST /projects/{projectId}/activities/{id}/progress   evidence.photos[].key            = project_document
 *   POST /projects/{projectId}/activities/bulk-progress   updates[].evidence.photos[].key  = project_document
 *   POST /projects/{projectId}/daily-reports              progress.evidence.photos[].key   = project_document
 *   POST /projects/{projectId}/weekly-reports             activitiesCompleted[]            = activity
 *   POST /projects/{projectId}/weekly-reports             activitiesInProgress[]           = activity
 * and, beside them, the same lists on PATCH /weekly-reports/{id} and the other
 * document fields of a photo (documentId, storageKey).
 *
 * The requests are built like the sweep's: the attacker company's project
 * manager writes to the attacker's own project, with the victim company's id
 * in the one field (the project, activity and foreign ids are the sweep's own
 * when results/isolation/cert2-inject.json has the pair). For each pair:
 *   - the victim's id is REFUSED, exactly as an id that exists nowhere is;
 *   - nothing is stored: no row of the attacker's company names the victim's
 *     ids afterwards that did not before, no row carries a refused request's
 *     stamp, and no audit row, outbound event, notification or background job
 *     was written for anything but the allowed requests;
 *   - nothing is returned: no answer carries the victim's names or canaries;
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

const ATTACKER = process.argv[2] || '024';
const VICTIM = process.argv[3] || '025';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `PRP-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const results = [];
const answers = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const said = (res) => `${res.status} ${res.body?.error?.code || ''} ${res.body?.error?.message || ''}`.trim();
const ok2xx = (res) => res.status >= 200 && res.status < 300;
const nowhere = () => crypto.randomUUID();

const main = async () => {
  console.log(`attacker ${ATTACKER}, victim ${VICTIM}, stamp ${STAMP}${process.env.CERT_INPROCESS === '1' ? ', in process (the working tree\'s code)' : ' — NOT in process: this asks the running API, which does not run the working tree\'s code'}\n`);
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

  // ── the sweep's request, or one built the same way ───────────────────────
  let sweep = [];
  try {
    sweep = JSON.parse(fs.readFileSync(path.join(WORK, 'results', 'isolation', 'cert2-inject.json'), 'utf8')).results
      .filter((r) => r.attacker === ATTACKER && r.victim === VICTIM);
  } catch { /* no sweep results: the ids are read from the database */ }
  const pairOf = (template, field) => sweep.find((r) => r.template === template && r.field === field && r.status < 300);
  const swept = {
    single: pairOf('/projects/{projectId}/activities/{id}/progress', 'evidence.photos[].key'),
    bulk: pairOf('/projects/{projectId}/activities/bulk-progress', 'updates[].evidence.photos[].key'),
    daily: pairOf('/projects/{projectId}/daily-reports', 'progress.evidence.photos[].key'),
    completed: pairOf('/projects/{projectId}/weekly-reports', 'activitiesCompleted[]'),
    inProgress: pairOf('/projects/{projectId}/weekly-reports', 'activitiesInProgress[]'),
  };
  for (const [name, row] of Object.entries(swept)) {
    console.log(`sweep ${name}: ${row ? `${row.method} ${row.template} [${row.field}] -> ${row.status} ${row.verdict}` : '(not in the sweep results; built from the database)'}`);
  }

  let projectId = swept.single?.route.split('/')[2] || null;
  let activityId = swept.single?.route.split('/')[4] || null;
  if (!projectId || !activityId) {
    const row = (await q(`select a.id, a."projectId" from "Activity" a join "Project" p on p.id = a."projectId"
        join "ActivityProgressMethod" m on m."activityId" = a.id
       where p."orgId" = $1 and m.method = 'percent' and not m."evidenceRequired" order by a."createdAt" limit 1`, [attackerOrg]))[0];
    if (!row) throw new Error('the attacker company has no percent-method activity');
    projectId = row.projectId;
    activityId = row.id;
  }
  const foreignDoc = swept.single?.foreign || (await q(`select d.id from "ProjectDocument" d where d."orgId" = $1 order by d."createdAt" limit 1`, [victimOrg]))[0]?.id;
  const foreignActivity = swept.completed?.foreign || (await q(`select a.id from "Activity" a join "Project" p on p.id = a."projectId" where p."orgId" = $1 order by a."createdAt" limit 1`, [victimOrg]))[0]?.id;
  const victimPhoto = (await q(`select id from "ProjectDocument" where "orgId" = $1 and "documentType" = 'site_photo' and id <> $2 order by "createdAt" limit 1`, [victimOrg, foreignDoc || '']))[0]?.id;
  const foreignDocRow = (await q(`select d.id, d."storageKey", d."fileName", d."originalName", d."orgId" from "ProjectDocument" d where d.id = $1`, [foreignDoc]))[0];
  const foreignActivityRow = (await q(`select a.id, p."orgId" from "Activity" a join "Project" p on p.id = a."projectId" where a.id = $1`, [foreignActivity]))[0];
  const ownPhoto = (await q(`select id from "ProjectDocument" where "projectId" = $1 and "orgId" = $2 and "documentType" = 'site_photo' and status = 'available' and "scanStatus" = 'clean' order by "createdAt" limit 1`, [projectId, attackerOrg]))[0]?.id;
  const ownProject = (await q(`select id from "Project" where id = $1 and "orgId" = $2`, [projectId, attackerOrg]))[0]?.id;
  check('setup: the project and activity are the attacker company\'s own', Boolean(ownProject && activityId), `${projectId} / ${activityId}`);
  check('setup: the foreign document is the victim company\'s', foreignDocRow?.orgId === victimOrg, foreignDoc);
  check('setup: the foreign activity is the victim company\'s', foreignActivityRow?.orgId === victimOrg, foreignActivity);
  check('setup: the attacker project has a site photo of its own', Boolean(ownPhoto), ownPhoto || 'none');
  if (!ownProject || !foreignDocRow || !foreignActivityRow || !ownPhoto) throw new Error('setup incomplete');

  const pm = as(`pm@${attacker.domain}`);
  const site = as(`site@${attacker.domain}`);
  const P = `/projects/${projectId}`;
  const send = async (who, method, route, body) => {
    const res = await who.send(method, route, body);
    answers.push({ route: `${method} ${route}`, status: res.status, text: res.text || '' });
    return res;
  };

  // A photo uploaded now, the way the site-reporting form uploads one: its
  // answer (documentId, key, storageKey, url …) is what the form then sends.
  const uploaded = await site.send('POST', `${P}/site-reporting/uploads`, undefined, {
    form: require('../lib/api').multipart({ field: 'files', filename: `${STAMP.toLowerCase()}.png`, contentType: 'image/png', body: PNG_1X1 }),
  });
  const webPhoto = (Array.isArray(uploaded.body?.data) ? uploaded.body.data : uploaded.body?.data?.files || [])[0] || null;
  check('setup: a site photo is uploaded to the attacker project', Boolean(webPhoto?.documentId), said(uploaded));

  const victimIds = [foreignDoc, foreignDocRow.storageKey, victimPhoto, foreignActivity].filter(Boolean);
  // The product's timestamps are UTC wall-clock times in columns without a
  // time zone: the window starts at the database's own UTC clock.
  const start = (await q(`select to_char((now() at time zone 'UTC') - interval '1 second', 'YYYY-MM-DD HH24:MI:SS.MS') as s`))[0].s;
  const allowedIds = new Set([webPhoto?.documentId].filter(Boolean));

  // ── before ───────────────────────────────────────────────────────────────
  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const print = await fingerprint.take(db);
    await db.query('rollback');
    return print;
  };
  const before = await snapshot();
  const naming = async () => {
    const counts = {};
    for (const table of ['ProgressSubmission', 'ActivityProgress', 'DailyReport', 'WeeklyReport']) {
      const joined = table === 'ActivityProgress' ? `join "Activity" x on x.id = t."activityId" join "Project" p on p.id = x."projectId"` : `join "Project" p on p.id = t."projectId"`;
      counts[table] = (await q(`select count(*)::int as n from "${table}" t ${joined} where p."orgId" = $1 and (${victimIds.map((_, i) => `to_jsonb(t)::text like '%' || $${i + 2} || '%'`).join(' or ')})`, [attackerOrg, ...victimIds]))[0].n;
    }
    return counts;
  };
  const namingBefore = await naming();

  /** The victim's id refused, exactly as an id that exists nowhere is. */
  const refused = async (label, attempt, foreign, expect) => {
    const bad = await attempt(foreign, 'REFUSED');
    const none = await attempt(nowhere(), 'REFUSED');
    check(`${label}: another company's id is refused (${expect})`, said(bad).startsWith(expect), said(bad));
    check(`${label}: …exactly as an id that exists nowhere`, said(bad) === said(none), `${said(bad)} | ${said(none)}`);
    return bad;
  };
  const allowed = async (label, attempt, own) => {
    const res = await attempt(own, 'ALLOWED');
    check(`${label}: the company's own id is accepted`, ok2xx(res), said(res));
    return res;
  };
  const photo = (key) => ({ photos: [{ key, url: `${P}/site-reporting/uploads/${key}`, name: 'site.png', type: 'photo' }] });
  const PHOTO_REFUSAL = '400 INVALID_SITE_PHOTO_REFERENCE';

  // ── 1. one activity's progress ───────────────────────────────────────────
  const single = (evidence) => (id, kind) => send(pm, 'POST', `${P}/activities/${activityId}/progress`, { pctComplete: 30, notes: `${STAMP}-${kind} single`, evidence: evidence(id) });
  await refused('activities/{id}/progress evidence.photos[].key (the sweep pair)', single(photo), foreignDoc, PHOTO_REFUSAL);
  if (victimPhoto) await refused('activities/{id}/progress key = the victim\'s site photo', single(photo), victimPhoto, PHOTO_REFUSAL);
  await refused('activities/{id}/progress key = the victim document\'s storage key', single(photo), foreignDocRow.storageKey, PHOTO_REFUSAL);
  await refused('activities/{id}/progress documentId beside an own key', single((id) => ({ photos: [{ key: ownPhoto, documentId: id }] })), foreignDoc, PHOTO_REFUSAL);
  const ownSingle = await allowed('activities/{id}/progress evidence.photos[].key', single(photo), ownPhoto);
  const singleId = ownSingle.body?.data?.submission?.id;
  if (singleId) allowedIds.add(singleId);
  const storedSingle = singleId ? (await q(`select "evidenceJson"::text as e from "ProgressSubmission" where id = $1`, [singleId]))[0]?.e : '';
  check('activities/{id}/progress: the own document is stored as the evidence', String(storedSingle).includes(ownPhoto), storedSingle);

  // ── 2. bulk progress ─────────────────────────────────────────────────────
  const bulk = (id, kind) => send(pm, 'POST', `${P}/activities/bulk-progress`, { updates: [{ activityId, pctComplete: 31, notes: `${STAMP}-${kind} bulk`, evidence: photo(id) }] });
  await refused('bulk-progress updates[].evidence.photos[].key (the sweep pair)', bulk, foreignDoc, PHOTO_REFUSAL);
  const mixed = await send(pm, 'POST', `${P}/activities/bulk-progress`, {
    updates: [
      { activityId, pctComplete: 32, notes: `${STAMP}-REFUSED bulk own first`, evidence: photo(ownPhoto) },
      { activityId, pctComplete: 33, notes: `${STAMP}-REFUSED bulk foreign second`, evidence: photo(foreignDoc) },
    ],
  });
  check('bulk-progress: a batch whose second update names the victim\'s document is refused whole', said(mixed).startsWith(PHOTO_REFUSAL) && mixed.body?.error?.details?.batch?.index === 1, `${said(mixed)} ${JSON.stringify(mixed.body?.error?.details?.batch || {})}`);
  const ownBulk = await allowed('bulk-progress updates[].evidence.photos[].key', bulk, ownPhoto);
  for (const s of ownBulk.body?.data?.submissions || []) allowedIds.add(s.id);

  // ── 3. the progress a daily report makes ─────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const daily = (id, kind) => send(pm, 'POST', `${P}/daily-reports`, { activityId, date: today, shift: 'day', notes: `${STAMP}-${kind} daily`, progress: { method: 'percent', pctComplete: 34, evidence: photo(id) } });
  await refused('daily-reports progress.evidence.photos[].key (the sweep pair)', daily, foreignDoc, PHOTO_REFUSAL);
  const ownDaily = await allowed('daily-reports progress.evidence.photos[].key', daily, ownPhoto);
  const addReport = async (res) => {
    const id = res.body?.data?.id;
    if (!id) return null;
    allowedIds.add(id);
    for (const s of res.body?.data?.progressSubmissions || []) allowedIds.add(s.id);
    return (await q(`select "evidenceJson"::text as e from "ProgressSubmission" where "dailyReportId" = $1`, [id]))[0]?.e || '';
  };
  const storedDaily = await addReport(ownDaily);
  check('daily-reports: the own document is stored as the linked submission\'s evidence', String(storedDaily).includes(ownPhoto), storedDaily);
  // The site-reporting form sends the upload's whole answer, in the report's photos and as the evidence.
  if (webPhoto) {
    const web = await send(pm, 'POST', `${P}/daily-reports`, { activityId, date: today, shift: 'day', notes: `${STAMP}-ALLOWED web form`, photos: [webPhoto], progress: { method: 'percent', pctComplete: 35, evidence: { photos: [webPhoto] } } });
    check('daily-reports: the site-reporting form\'s own request (upload answer as photos and evidence) is accepted', ok2xx(web), said(web));
    await addReport(web);
  }

  // ── 4/5. weekly reports ──────────────────────────────────────────────────
  const WEEK = { weekStartDate: '2026-09-21', weekEndDate: '2026-09-27' };
  const ACTIVITY_REFUSAL = '404 ACTIVITY_NOT_FOUND';
  const weeklyIds = [];
  for (const field of ['activitiesCompleted', 'activitiesInProgress']) {
    const weekly = (id, kind) => send(pm, 'POST', `${P}/weekly-reports`, { ...WEEK, remarks: `${STAMP}-${kind} ${field}`, [field]: [id] });
    await refused(`weekly-reports ${field}[] (the sweep pair)`, weekly, foreignActivity, ACTIVITY_REFUSAL);
    const shaped = (id, kind) => send(pm, 'POST', `${P}/weekly-reports`, { ...WEEK, remarks: `${STAMP}-${kind} ${field} shaped`, [field]: [{ id }] });
    await refused(`weekly-reports ${field}[] as an object naming the activity`, shaped, foreignActivity, '400 VALIDATION_ERROR');
    const own = await allowed(`weekly-reports ${field}[]`, weekly, activityId);
    const id = own.body?.data?.id;
    if (id) {
      weeklyIds.push(id);
      allowedIds.add(id);
      const row = (await q(`select "${field}"::text as list from "WeeklyReport" where id = $1`, [id]))[0];
      check(`weekly-reports ${field}: the own activity is stored`, String(row?.list).includes(activityId), row?.list);
    }
  }
  // …and the same lists on an update.
  const reportId = weeklyIds[0];
  if (reportId) {
    for (const field of ['activitiesCompleted', 'activitiesInProgress']) {
      const patch = (id, kind) => send(pm, 'PATCH', `${P}/weekly-reports/${reportId}`, { remarks: `${STAMP}-${kind} patch ${field}`, [field]: [id] });
      await refused(`PATCH weekly-reports ${field}[]`, patch, foreignActivity, ACTIVITY_REFUSAL);
      // Read back at once: a later allowed update would overwrite what a refused one stored.
      const kept = (await q(`select "${field}"::text as list, remarks from "WeeklyReport" where id = $1`, [reportId]))[0];
      check(`PATCH weekly-reports ${field}[]: the refused update stored nothing`, !String(kept?.list).includes(foreignActivity) && !String(kept?.remarks).includes(`${STAMP}-REFUSED`), `${kept?.list} / ${kept?.remarks}`);
      const shaped = (id, kind) => send(pm, 'PATCH', `${P}/weekly-reports/${reportId}`, { remarks: `${STAMP}-${kind} patch ${field} shaped`, [field]: [{ id }] });
      await refused(`PATCH weekly-reports ${field}[] as an object naming the activity`, shaped, foreignActivity, '400 VALIDATION_ERROR');
      const keptShaped = (await q(`select "${field}"::text as list, remarks from "WeeklyReport" where id = $1`, [reportId]))[0];
      check(`PATCH weekly-reports ${field}[] as an object: the refused update stored nothing`, !String(keptShaped?.list).includes(foreignActivity) && !String(keptShaped?.remarks).includes(`${STAMP}-REFUSED`), `${keptShaped?.list} / ${keptShaped?.remarks}`);
      await allowed(`PATCH weekly-reports ${field}[]`, patch, activityId);
    }
  } else {
    check('PATCH weekly-reports: a report of the attacker\'s own was made to update', false);
  }

  // ── nothing stored ───────────────────────────────────────────────────────
  const namingAfter = await naming();
  check('no row of the attacker company names the victim\'s ids that did not before', JSON.stringify(namingBefore) === JSON.stringify(namingAfter), `${JSON.stringify(namingBefore)} -> ${JSON.stringify(namingAfter)}`);
  const stamped = await q(`
    select 'ProgressSubmission' as t, count(*)::int as n from "ProgressSubmission" where notes like $1
    union all select 'DailyReport', count(*)::int from "DailyReport" where notes like $1
    union all select 'WeeklyReport', count(*)::int from "WeeklyReport" where remarks like $1`, [`${STAMP}-REFUSED%`]);
  check('no refused request left a submission, daily report or weekly report', stamped.every((r) => r.n === 0), stamped.map((r) => `${r.t} ${r.n}`).join(', '));
  const side = [];
  const seen = [];
  for (const table of ['AuditEvent', 'OutboundEvent', 'Notification']) {
    const rows = await q(`select "entityType" as type, "entityId" as id, to_jsonb(t)::text as body from "${table}" t where "orgId" = $1 and "createdAt" >= $2::timestamp`, [attackerOrg, start]);
    seen.push(`${table} ${rows.length}`);
    for (const row of rows) {
      if (victimIds.some((v) => row.body.includes(v))) side.push(`${table} ${row.type} ${row.id} names a victim id`);
      else if (row.id && !allowedIds.has(row.id)) side.push(`${table} ${row.type} ${row.id} is not one of the allowed requests' records`);
    }
  }
  const jobs = await q(`select id, "payloadJson"::text as body from "BackgroundJob" where "orgId" = $1 and "createdAt" >= $2::timestamp`, [attackerOrg, start]);
  for (const job of jobs) if (victimIds.some((v) => job.body.includes(v)) || job.body.includes(`${STAMP}-REFUSED`)) side.push(`BackgroundJob ${job.id}`);
  seen.push(`BackgroundJob ${jobs.length}`);
  check('no audit row, outbound event, notification or job was written for a refused request', side.length === 0, side.length ? side.slice(0, 6).join('; ') : `since the start: ${seen.join(', ')} — each of an allowed request's record`);

  // ── nothing returned, nothing of the victim's moved ──────────────────────
  const traces = [`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`];
  for (const name of [foreignDocRow.fileName, foreignDocRow.originalName]) if (name && name.length > 6) traces.push(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const victimTraces = new RegExp(traces.join('|'));
  const leaked = answers.filter((a) => victimTraces.test(a.text));
  check('no answer to the attacker carries the victim company\'s names, files or canaries', leaked.length === 0, leaked.slice(0, 5).map((a) => `${a.status} ${a.route}`).join(', '));
  const errors = answers.filter((a) => a.status >= 500);
  check('no answer is a server error', errors.length === 0, errors.slice(0, 5).map((a) => `${a.status} ${a.route}`).join(', '));
  const after = await snapshot();
  const moved = fingerprint.compare(before, after).filter((c) => !c.noise && c.org === VICTIM);
  check('the victim company\'s data did not change (every table)', moved.length === 0, moved.slice(0, 8).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
  await db.end();

  const failed = results.filter((r) => !r.ok);
  console.log(`\nprogress-reports proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
