'use strict';

/**
 * The CERT-2 proof of group evidence-lines-5: file links as a client resolves
 * them, keys that cannot name a document, the shape of a site record's lines,
 * what a meeting's refusals carry, the dates of daily reports, site diaries
 * and meetings, and the UAT runner's photo.
 *
 *   $env:DATABASE_URL = $null; $env:CERT_INPROCESS = "1"; node scripts/cert/isolation/evidence-lines-5-proof.js [attacker=067] [victim=068]
 *   … [--only=<section regex, e.g. "^2">] [--no-fingerprint]   (for mutation runs; a full run takes neither)
 *
 * What each did before the fix (reproduced in process, 067 -> 068):
 *   1. FILE_LINK matched the literal text: a './' segment, backslashes for
 *      slashes, a tab inside the path, an escaped project id and the bidder
 *      portal's document link — each of which the WHATWG URL parser (browsers,
 *      fetch, axios) or Express resolves to the stored file — named another
 *      company's document or photo and were stored (200/201) on single and
 *      bulk progress, a daily report's progress and photos and a site diary's
 *      photos.
 *   2. A link key decoded to a NUL ('%00') reached projectDocument.findMany:
 *      500 (Postgres 22021) on the same five doors.
 *   3. equipment: ['<id>'], materials: ['<id>'] and
 *      equipment: [{ equipment: { id } }] were stored (201) on daily reports
 *      and site diaries, another company's id with them; and
 *      { equipmentId: <own>, id: 'row-1' } was refused, though the approval
 *      reads row.equipmentId || row.id.
 *   4. MEETING_USER_INVALID, MEETING_PARTY_INVALID, MEETING_TASK_INVALID and
 *      the distribution refusals answered with the ids they were sent.
 *   5. A date given as a list (["2026-10-01"]) or a number (20261001) was
 *      stored (201) on every body date of the three routers; a photo's takenAt
 *      and uploadedAt were stored in the compact, week and ordinal forms
 *      ('20261001', '2026-W40', '2026-275') new Date() cannot read.
 *   6. The UAT runner's photo { fileName, fileUrl, mimeType, sizeBytes,
 *      description } was accepted (201) on a daily report and a site diary
 *      and dropped unseen.
 *
 * For every door, on a record of the attacker company that accepts the
 * request (the GATE: the same request naming the attacker's own record
 * succeeds on the same record, read back from the database):
 *   REFUSED  the victim's record is refused with a 4xx and nothing is stored;
 *   NOWHERE  one that exists nowhere gets exactly the same answer (the whole
 *            body, the request id and the ids the request itself sent set
 *            aside);
 *   SHAPE    a value that is not in the accepted shape is refused as invalid
 *            input (400 VALIDATION_ERROR), whoever's id it carries;
 *   ALLOWED  what the product's clients send — the web site-reporting form,
 *            the web meetings page, the UAT runner, the certification drivers —
 *            is accepted and stored as sent.
 * No answer is a 5xx or carries the victim's ids (beyond the ones the request
 * itself sent), names, addresses or canaries; no meeting refusal carries even
 * the ids it was sent; no row of the attacker company names a victim id
 * afterwards that did not before; the victim company's data does not change in
 * any table (fingerprint taken after the setup).
 *
 * Re-runnable: every record the checks write to is new (activities, uploads,
 * equipment, materials, reports, diaries, meetings), every request carries a
 * fresh stamp. Exit 0 when every check holds, 2 otherwise.
 */

process.env.REQUEST_LOG_FORMAT = process.env.REQUEST_LOG_FORMAT || 'off';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const api = require('../lib/api');
const { buildPopulation } = require('../lib/spec');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const ATTACKER = positional[0] || '067';
const VICTIM = positional[1] || '068';
const ONLY = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7) || null;
const FINGERPRINT = !process.argv.includes('--no-fingerprint');
const GROUP = 'evidence-lines-5';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `EL5-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const stamp = STAMP.toLowerCase();
const INPROCESS = process.env.CERT_INPROCESS === '1';
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const results = [];
const answers = [];
let section = 'setup';
const check = (name, ok, detail = '') => {
  results.push({ section, name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n        ${detail}` : ''}`);
};
const firstLine = (text) => String(text || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
const said = (res) => `${res.status} ${res.body?.error?.code || ''} ${firstLine(res.body?.error?.message).slice(0, 140)}${res.body?.error?.code === 'VALIDATION_ERROR' && Array.isArray(res.body.error.details) ? ` [${res.body.error.details.map((d) => d.field).join(', ')}]` : ''}`.trim();
const ok2xx = (res) => res.status >= 200 && res.status < 300;
const is4xx = (res) => res.status >= 400 && res.status < 500;
const invalidInput = (res) => res.status === 400 && res.body?.error?.code === 'VALIDATION_ERROR';
const nowhere = () => crypto.randomUUID();
/** The whole answer, with the request id and the ids the request itself sent set aside. */
const answerOf = (res, sent = []) => {
  const body = res.body && typeof res.body === 'object' ? JSON.parse(JSON.stringify(res.body)) : res.text;
  if (body?.error) delete body.error.requestId;
  let text = JSON.stringify(body);
  for (const id of sent.filter(Boolean)) text = text.split(id).join('<sent>');
  return `${res.status} ${text}`;
};
const gateNote = (gate) => (gate && ok2xx(gate) ? '' : ` [NOT GATED: the own request on the same record answered ${gate ? said(gate) : 'nothing'}]`);
/** JSON with its keys in order, so a stored jsonb compares with what was sent. */
const canonical = (value) => JSON.stringify(value, (_key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
const withMarker = (url, marker) => `${url}${url.includes('?') ? '&' : '?'}el5=${marker}`;
const fieldsNamed = (res) => (invalidInput(res) ? (res.body.error.details || []).map((d) => d.field) : []);
// '0' is %30, 'a' %61: Express decodes the route parameter to the plain id.
const escaped = (id) => `%${id.charCodeAt(0).toString(16)}${id.slice(1)}`;

// The local e-mail transport writes to the console in process; keep it out of the output.
const print = console.log.bind(console);
console.log = (...args) => {
  const text = args.map(String).join(' ');
  if (text.startsWith('[email:local]')) return;
  print(...args);
};

const main = async () => {
  console.log(`${GROUP} proof — attacker ${ATTACKER}, victim ${VICTIM}, stamp ${STAMP}${INPROCESS ? ', in process (the working tree\'s code)' : ' — NOT in process: a running API does not run the working tree\'s code'}${ONLY ? `, only /${ONLY}/` : ''}${FINGERPRINT ? '' : ', no fingerprint'}\n`);
  const runs = () => !ONLY || new RegExp(ONLY).test(section);
  const startedAt = new Date();
  const { companies } = buildPopulation();
  const attacker = companies.find((c) => c.code === ATTACKER);
  const victim = companies.find((c) => c.code === VICTIM);
  if (!attacker || !victim) throw new Error(`unknown company ${ATTACKER} or ${VICTIM}`);
  const inventory = (code) => JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'inventory', `${code}.json`), 'utf8'));
  const standard = (inv) => Object.values(inv.projects).find((p) => p.depth === 'standard' && p.refs?.activities);
  const A = standard(inventory(ATTACKER));
  const V = standard(inventory(VICTIM));
  if (!A || !V) throw new Error('both companies need a standard project');
  const AP = `/projects/${A.id}`;

  const db = await guard.connectCert();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const one = async (sql, params = []) => (await q(sql, params))[0] || null;
  const val = async (sql, params = []) => {
    const row = await one(sql, params);
    return row ? Object.values(row)[0] : null;
  };
  const orgOf = async (code) => val('select id::text from "Organisation" where slug like $1', [`cert-${code}-%`]);
  const attackerOrg = await orgOf(ATTACKER);
  const victimOrg = await orgOf(VICTIM);
  if (!attackerOrg || !victimOrg) throw new Error('both companies must exist in the certification database');

  const sessions = {};
  const who = (role, code = ATTACKER) => {
    const key = `${role}@${code}`;
    if (!sessions[key]) {
      const session = api.as(`${role}@c${code}.octapm-cert.test`);
      sessions[key] = async (method, route, body, options = {}) => {
        const res = await session.send(method, route, body, options);
        answers.push({ route: `${role}@${code} ${method} ${route}`, status: res.status, text: res.text || '', sent: `${route} ${JSON.stringify(body ?? null)}` });
        return res;
      };
    }
    return sessions[key];
  };
  const pm = who('pm');
  const planner = who('planner');
  const vPm = who('pm', VICTIM);
  const must = async (send, method, route, body, what) => {
    const res = await send(method, route, body);
    if (!ok2xx(res)) throw new Error(`setup ${what}: ${said(res)} ${(res.text || '').slice(0, 300)}`);
    return res.body?.data;
  };

  // ── the ids, each proven by its owner ─────────────────────────────────────
  const userByEmail = async (email) => val('select id::text from "User" where email = $1', [email]);
  const memberOf = async (userId, orgId) => val('select status from "OrganizationMembership" where "userId" = $1 and "orgId" = $2', [userId, orgId]);
  const pmId = await userByEmail(`pm@${attacker.domain}`);
  const siteEngineer = await userByEmail(`site@${attacker.domain}`);
  const foreignUser = await userByEmail(`pm@${victim.domain}`);
  check(`setup: ${pmId} (pm@) and ${siteEngineer} (site@) are active members of company ${ATTACKER}; ${foreignUser} (pm@ of ${VICTIM}) is a member of company ${VICTIM} only`, (await memberOf(pmId, attackerOrg)) === 'active' && (await memberOf(siteEngineer, attackerOrg)) === 'active' && (await memberOf(foreignUser, victimOrg)) === 'active' && (await memberOf(foreignUser, attackerOrg)) === null);

  // Own site photos, uploaded now the way the site-reporting form uploads them.
  const form = new FormData();
  for (const tag of ['a', 'b']) form.append('files', new Blob([PNG_1X1], { type: 'image/png' }), `${stamp}-${tag}.png`);
  const uploaded = await pm('POST', `${AP}/site-reporting/uploads`, undefined, { form });
  const [webPhoto = null] = Array.isArray(uploaded.body?.data) ? uploaded.body.data : [];
  const ownDoc = webPhoto?.documentId;
  const ownDocRow = ownDoc ? await one('select "projectId"::text as project, "orgId"::text as org, "uploadedBy"::text as uploader, status from "ProjectDocument" where id = $1', [ownDoc]) : null;
  check(`setup: site photos uploaded to company ${ATTACKER}'s project by its pm (${ownDoc}, available)`, uploaded.status === 201 && ownDocRow?.project === A.id && ownDocRow?.org === attackerOrg && ownDocRow?.uploader === pmId && ownDocRow?.status === 'available', `${said(uploaded)} ${JSON.stringify(ownDocRow)}`);
  const ownPhoto = await val('select id::text from "Photo" where "orgId" = $1 and "projectId" = $2 order by "createdAt" limit 1', [attackerOrg, A.id]);
  // A party a distribution reaches by its contact (no members to notify).
  const ownParty = await val(`select p.id::text from "ProjectParty" p where p."projectId" = $1 and p.status = 'active' and p."contactEmail" is not null
      and not exists (select 1 from "ProjectPartyMember" m where m."projectPartyId" = p.id and m.status = 'active') order by p."createdAt" limit 1`, [A.id]);
  const ownTask = await val('select id::text from "Task" where "projectId" = $1 and "orgId" = $2 and "archivedAt" is null order by "createdAt" limit 1', [A.id, attackerOrg]);
  check(`setup: company ${ATTACKER}'s project has a photo ${ownPhoto}, an active party ${ownParty} and a task ${ownTask}`, Boolean(ownPhoto && ownParty && ownTask));
  const foreignDocRow = await one(`select id::text as id, "storageKey" as "storageKey", "orgId"::text as org, "fileName" as "fileName", "originalName" as "originalName" from "ProjectDocument" where "orgId" = $1 and "projectId" = $2 order by ("documentType" = 'site_photo') desc, "createdAt" limit 1`, [victimOrg, V.id]);
  const foreignDoc = foreignDocRow?.id;
  const foreignPhoto = await one('select id::text as id, "documentId"::text as doc from "Photo" where "orgId" = $1 and "projectId" = $2 order by "createdAt" limit 1', [victimOrg, V.id]);
  const foreignMaterial = await val('select m.id::text from "ActivityMaterial" m join "Project" p on p.id = m."projectId" where p."orgId" = $1 and m."projectId" = $2 order by m."createdAt" limit 1', [victimOrg, V.id]);
  let victimEquipment = await val('select e.id::text from "Equipment" e join "Project" p on p.id = e."projectId" where p."orgId" = $1 and e."projectId" = $2 order by e."createdAt" limit 1', [victimOrg, V.id]);
  if (!victimEquipment) victimEquipment = (await must(vPm, 'POST', `/projects/${V.id}/equipment`, { name: `EL5 victim equipment ${STAMP}`, rateType: 'hourly', rate: 10 }, 'victim equipment')).id;
  const foreignParty = await val(`select id::text from "ProjectParty" where "projectId" = $1 and status = 'active' order by "createdAt" limit 1`, [V.id]);
  const foreignTask = await val('select id::text from "Task" where "projectId" = $1 and "orgId" = $2 and "archivedAt" is null order by "createdAt" limit 1', [V.id, victimOrg]);
  check(`setup: document ${foreignDoc}, photo ${foreignPhoto?.id}, material ${foreignMaterial}, equipment ${victimEquipment}, party ${foreignParty} and task ${foreignTask} are company ${VICTIM}'s (project ${V.id})`, foreignDocRow?.org === victimOrg && Boolean(foreignPhoto?.id && foreignMaterial && victimEquipment && foreignParty && foreignTask) && (await val('select "orgId"::text from "Project" where id = $1', [V.id])) === victimOrg);
  if (!ownDoc || !ownPhoto || !ownParty || !ownTask || !foreignDoc || !foreignPhoto || !foreignMaterial || !victimEquipment || !foreignParty || !foreignTask) throw new Error('setup incomplete');

  // Fresh records of the attacker company.
  const freshActivity = async (tag) => (await must(planner, 'POST', `${AP}/activities`, { name: `EL5 ${STAMP} ${tag}`, duration: 3, engineerIds: [siteEngineer] }, `activity ${tag}`)).id;
  const ownEquipment = (await must(pm, 'POST', `${AP}/equipment`, { name: `EL5 ${STAMP} crane`, rateType: 'hourly', rate: 12 }, 'own equipment')).id;
  const materialActivity = await freshActivity('MAT');
  const ownMaterial = (await must(pm, 'POST', `${AP}/activities/${materialActivity}/materials`, { name: `EL5 ${STAMP} cement`, unit: 'BAG', qty: 5 }, 'own material'))?.id;
  check(`setup: equipment ${ownEquipment} and material ${ownMaterial} are new records of company ${ATTACKER}'s project`, (await val('select "projectId"::text from "Equipment" where id = $1', [ownEquipment])) === A.id && (await val('select "projectId"::text from "ActivityMaterial" where id = $1', [ownMaterial])) === A.id);
  let dateSalt = 0;
  const nextDate = (year) => {
    dateSalt += 1;
    return new Date(Date.UTC(year, 0, 1) + ((parseInt(stamp.slice(-4), 16) + dateSalt * 7) % 360) * 86_400_000).toISOString().slice(0, 10);
  };

  // ── what no answer may carry, and no row of the attacker may name ─────────
  const victimIds = [foreignUser, foreignDoc, foreignDocRow.storageKey, V.id, foreignPhoto.id, foreignPhoto.doc, foreignMaterial, victimEquipment, victimOrg, foreignParty, foreignTask].filter(Boolean);
  const traces = [`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`];
  for (const name of [foreignDocRow.fileName, foreignDocRow.originalName]) if (name && name.length > 6) traces.push(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const victimTraces = new RegExp(traces.join('|'));
  /** An answer leaks when it carries the victim's traces, or a victim id the request itself did not send. */
  const leakOf = (a) => {
    if (victimTraces.test(a.text)) return (a.text.match(victimTraces) || [])[0];
    return victimIds.find((id) => a.text.includes(id) && !a.sent.includes(id)) || null;
  };
  const NAMING = {
    DailyReport: 'select count(*)::int as n from "DailyReport" t join "Project" p on p.id = t."projectId" where p."orgId" = $1',
    SiteDiary: 'select count(*)::int as n from "SiteDiary" t join "Project" p on p.id = t."projectId" where p."orgId" = $1',
    ProgressSubmission: 'select count(*)::int as n from "ProgressSubmission" t join "Project" p on p.id = t."projectId" where p."orgId" = $1',
    ActivityProgress: 'select count(*)::int as n from "ActivityProgress" t join "Activity" a on a.id = t."activityId" join "Project" p on p.id = a."projectId" where p."orgId" = $1',
    ActivityEquipmentUsage: 'select count(*)::int as n from "ActivityEquipmentUsage" t join "Project" p on p.id = t."projectId" where p."orgId" = $1',
    Meeting: 'select count(*)::int as n from "Meeting" t where t."orgId" = $1',
    MeetingAttendee: 'select count(*)::int as n from "MeetingAttendee" t where t."orgId" = $1',
    MeetingActionItem: 'select count(*)::int as n from "MeetingActionItem" t where t."orgId" = $1',
    MeetingDistribution: 'select count(*)::int as n from "MeetingDistribution" t where t."orgId" = $1',
    AuditEvent: 'select count(*)::int as n from "AuditEvent" t where t."orgId" = $1',
  };
  const naming = async () => {
    const counts = {};
    for (const [table, sql] of Object.entries(NAMING)) {
      counts[table] = (await q(`${sql} and (${victimIds.map((_, i) => `to_jsonb(t)::text like '%' || $${i + 2} || '%'`).join(' or ')})`, [attackerOrg, ...victimIds]))[0].n;
    }
    return counts;
  };
  const snapshot = async () => {
    if (!FINGERPRINT) return null;
    await db.query('begin transaction isolation level repeatable read read only');
    const taken = await fingerprint.take(db);
    await db.query('rollback');
    return taken;
  };
  const before = await snapshot();
  const namingBefore = await naming();

  // ── the doors evidence comes in by, and what each stored ─────────────────
  let counter = 0;
  // Ends in a letter: n1z is not a prefix of n10z, so a LIKE on one never matches another.
  const nextMarker = () => `${stamp}-n${(counter += 1)}z`;
  const storedBy = async (marker) => {
    const like = `%${marker}%`;
    return {
      submissions: Number(await val('select count(*)::int from "ProgressSubmission" where "projectId" = $1 and ("evidenceJson"::text like $2 or notes like $2)', [A.id, like])),
      reportPhotos: Number(await val('select count(*)::int from "DailyReport" where "projectId" = $1 and "photosJson"::text like $2', [A.id, like])),
      reports: Number(await val('select count(*)::int from "DailyReport" where "projectId" = $1 and (notes like $2 or "photosJson"::text like $2)', [A.id, like])),
      diaryPhotos: Number(await val('select count(*)::int from "SiteDiary" where "projectId" = $1 and "photosJson"::text like $2', [A.id, like])),
      diaries: Number(await val('select count(*)::int from "SiteDiary" where "projectId" = $1 and (notes like $2 or "photosJson"::text like $2)', [A.id, like])),
    };
  };
  const nothing = (s) => s.submissions === 0 && s.reports === 0 && s.diaries === 0;
  const makeDoors = async (tag) => {
    const acts = {};
    for (const name of ['single', 'bulk', 'daily-progress', 'daily-photos', 'daily-patch']) acts[name] = await freshActivity(`${tag} door ${name}`);
    const draftReport = (await must(pm, 'POST', `${AP}/daily-reports`, { activityId: acts['daily-patch'], date: nextDate(2022), status: 'draft', notes: `${STAMP} ${tag} patch report` }, 'report to patch')).id;
    const draftDiary = (await must(pm, 'POST', `${AP}/site-diaries`, { date: nextDate(2022), status: 'draft', notes: `${STAMP} ${tag} patch diary` }, 'diary to patch')).id;
    return [
      ['progress (single)', (photo, marker) => pm('POST', `${AP}/activities/${acts.single}/progress`, { pctComplete: 7, progressMethod: 'percent', status: 'submitted', notes: `${STAMP} ${marker}`, evidence: { photos: [photo] } }), (s) => s.submissions === 1],
      ['progress (bulk)', (photo, marker) => pm('POST', `${AP}/activities/bulk-progress`, { updates: [{ activityId: acts.bulk, pctComplete: 6, progressMethod: 'percent', status: 'submitted', notes: `${STAMP} ${marker}`, evidence: { photos: [photo] } }] }), (s) => s.submissions === 1],
      ['daily report progress', (photo, marker) => pm('POST', `${AP}/daily-reports`, { activityId: acts['daily-progress'], date: nextDate(2022), shift: 'day', status: 'submitted', notes: `${STAMP} ${marker}`, progress: { method: 'percent', pctComplete: 4, notes: `${STAMP} ${marker}`, evidence: { photos: [photo] } } }), (s) => s.submissions === 1 && s.reports === 1],
      ['daily report photos', (photo, marker) => pm('POST', `${AP}/daily-reports`, { activityId: acts['daily-photos'], date: nextDate(2022), shift: 'day', status: 'draft', notes: `${STAMP} ${marker}`, photos: [photo] }), (s) => s.reportPhotos === 1],
      ['daily report photos (PATCH)', (photo, marker) => pm('PATCH', `${AP}/daily-reports/${draftReport}`, { notes: `${STAMP} ${marker}`, photos: [photo] }), (s) => s.reportPhotos === 1],
      ['site diary photos', (photo, marker) => pm('POST', `${AP}/site-diaries`, { date: nextDate(2022), shift: 'day', status: 'draft', notes: `${STAMP} ${marker}`, photos: [photo] }), (s) => s.diaryPhotos === 1],
      ['site diary photos (PATCH)', (photo, marker) => pm('PATCH', `${AP}/site-diaries/${draftDiary}`, { notes: `${STAMP} ${marker}`, photos: [photo] }), (s) => s.diaryPhotos === 1],
    ];
  };
  const upload = (p, d) => `/api/v1/projects/${p}/site-reporting/uploads/${d}`;
  const TOKEN = `el5${crypto.randomBytes(12).toString('hex')}`;

  // ══ 1. file links as a client resolves them ═══════════════════════════════
  section = '1 normalised file links';
  console.log('\n── 1. file links as a client resolves them: another company\'s file refused as nowhere, the own accepted ──');
  if (runs()) {
    const DOORS = await makeDoors('S1');
    // [label, photo(marker, ids…), foreign ids, own ids (the gate)]
    const CASES = [
      ['a "./" segment in an upload link', (m, d) => ({ url: withMarker(`/api/v1/projects/${A.id}/site-reporting/./uploads/${d}`, m) }), [foreignDoc], [ownDoc]],
      ['backslashes for slashes, into the victim\'s project on another host', (m, p, d) => ({ url: withMarker(`https://h\\api\\v1\\projects\\${p}\\site-reporting\\uploads\\${d}`, m) }), [V.id, foreignDoc], [A.id, ownDoc]],
      ['a tab inside the path, into the victim\'s project', (m, p, d) => ({ url: withMarker(`/api/v1/projects/${p}/site-re\tporting/uploads/${d}`, m) }), [V.id, foreignDoc], [A.id, ownDoc]],
      ['a "./" segment in a photo file link', (m, id) => ({ url: withMarker(`/projects/${A.id}/photos/./${id}/file`, m) }), [foreignPhoto.id], [ownPhoto]],
      ['a "./" photo link into the victim\'s project (the mobile path)', (m, p, id) => ({ url: withMarker(`/projects/${p}/photos/./${id}/file`, m) }), [V.id, foreignPhoto.id], [A.id, ownPhoto]],
      ['an escaped project id (Express decodes it)', (m, p, d) => ({ url: withMarker(`/api/v1/projects/${escaped(p)}/site-reporting/uploads/${d}`, m) }), [V.id, foreignDoc], [A.id, ownDoc]],
      ['a fileUrl with a "%2e" segment (the UAT runner\'s link field)', (m, d) => ({ fileUrl: withMarker(`https://api.octapm.test/api/v1/projects/${A.id}/workflow/%2e/uploads/${d}`, m), fileName: 'a.jpg' }), [foreignDoc], [ownDoc]],
      ['a caption whose link a line break ends', (m, d) => ({ url: withMarker('https://example.test/site.jpg', m), caption: `see ${upload(A.id, d)}\nmore` }), [foreignDoc], [ownDoc]],
      ['the bidder portal\'s document link', (m, d) => ({ url: withMarker(`/api/v1/public/bids/${TOKEN}/documents/${d}`, m) }), [foreignDoc], [ownDoc]],
    ];
    for (const [doorName, send, storedOk] of DOORS) {
      for (const [label, make, foreignIds, ownIds] of CASES) {
        const mForeign = nextMarker();
        const bad = await send(make(mForeign, ...foreignIds), mForeign);
        const badStored = await storedBy(mForeign);
        const noneIds = foreignIds.map(() => nowhere());
        const mNone = nextMarker();
        const none = await send(make(mNone, ...noneIds), mNone);
        const noneStored = await storedBy(mNone);
        const mOwn = nextMarker();
        const gateRes = await send(make(mOwn, ...ownIds), mOwn);
        const gate = ok2xx(gateRes) && storedOk(await storedBy(mOwn)) ? gateRes : { ...gateRes, status: 0 };
        check(`ALLOWED ${doorName}: ${label} naming company ${ATTACKER}'s own file is accepted and stored`, ok2xx(gate), said(gateRes));
        check(`REFUSED ${doorName}: ${label} naming company ${VICTIM}'s file is refused with a 4xx and nothing is stored${gateNote(gate)}`, ok2xx(gate) && is4xx(bad) && nothing(badStored), `${said(bad)}; stored ${JSON.stringify(badStored)}`);
        check(`NOWHERE ${doorName}: ${label} — exactly as one naming a file that exists nowhere (the whole answer)${gateNote(gate)}`, ok2xx(gate) && answerOf(bad, foreignIds) === answerOf(none, noneIds) && nothing(noneStored), `${answerOf(bad, foreignIds).slice(0, 240)} | ${answerOf(none, noneIds).slice(0, 240)}`);
      }
    }
  }

  // ══ 2. keys no document has ═══════════════════════════════════════════════
  section = '2 control-character keys';
  console.log('\n── 2. a link key that decodes to a control character: refused as a missing key, never a 5xx ──');
  if (runs()) {
    const DOORS = await makeDoors('S2');
    const KEYS = [
      ['%00 (a NUL)', '%00'],
      ['a NUL inside the own document\'s id', `${ownDoc.slice(0, 8)}%00${ownDoc.slice(8)}`],
      ['%01 (a control character)', 'ab%01cd'],
      ['%2F (a slash in the key)', `${ownDoc}%2Fx`],
    ];
    for (const [doorName, send, storedOk] of DOORS) {
      const mOwn = nextMarker();
      const gateRes = await send({ url: withMarker(upload(A.id, ownDoc), mOwn) }, mOwn);
      const gate = ok2xx(gateRes) && storedOk(await storedBy(mOwn)) ? gateRes : { ...gateRes, status: 0 };
      const mNone = nextMarker();
      const none = await send({ url: withMarker(upload(A.id, nowhere()), mNone) }, mNone);
      for (const [label, key] of KEYS) {
        for (const route of ['site-reporting', 'workflow']) {
          const marker = nextMarker();
          const res = await send({ url: withMarker(`/api/v1/projects/${A.id}/${route}/uploads/${key}`, marker) }, marker);
          const stored = await storedBy(marker);
          check(`REFUSED ${doorName}: a ${route} key ${label} is refused 400 INVALID_SITE_PHOTO_REFERENCE as a key that exists nowhere is (status, code, message), nothing stored, no 5xx${gateNote(gate)}`, ok2xx(gate) && res.status === 400 && res.body?.error?.code === 'INVALID_SITE_PHOTO_REFERENCE' && res.body?.error?.code === none.body?.error?.code && res.body?.error?.message === none.body?.error?.message && none.status === 400 && nothing(stored), `${said(res)} | nowhere ${said(none)}; stored ${JSON.stringify(stored)}`);
        }
      }
    }
  }

  // ══ 3. the shape of a site record's lines ═════════════════════════════════
  section = '3 line shapes';
  console.log('\n── 3. daily reports and site diaries: a line is an object of texts, numbers and flags ──');
  if (runs()) {
    const lineActivity = await freshActivity('LINES');
    const rowByNotes = async (table, notes) => one(`select id::text as id, "equipmentJson"::text as equipment, "materialsJson"::text as materials from "${table}" where "projectId" = $1 and notes = $2 order by "createdAt" limit 1`, [A.id, notes]);
    const rowById = async (table, id) => one(`select notes, "equipmentJson"::text as equipment, "materialsJson"::text as materials from "${table}" where id = $1`, [id]);
    const RECORDS = [
      ['daily report', 'DailyReport', (notes, lines) => pm('POST', `${AP}/daily-reports`, { activityId: lineActivity, date: nextDate(2023), status: 'draft', notes, ...lines }), async () => (await must(pm, 'POST', `${AP}/daily-reports`, { activityId: lineActivity, date: nextDate(2023), status: 'draft', notes: `${STAMP} LINES draft ${nextMarker()}` }, 'report to patch')).id, (id, body) => pm('PATCH', `${AP}/daily-reports/${id}`, body)],
      ['site diary', 'SiteDiary', (notes, lines) => pm('POST', `${AP}/site-diaries`, { date: nextDate(2023), status: 'draft', notes, ...lines }), async () => (await must(pm, 'POST', `${AP}/site-diaries`, { date: nextDate(2023), status: 'draft', notes: `${STAMP} LINES draft ${nextMarker()}` }, 'diary to patch')).id, (id, body) => pm('PATCH', `${AP}/site-diaries/${id}`, body)],
    ];
    // [label, lines(id), the own, the victim's id, the field refused, the own line (the gate), what the gate stores]
    const SHAPES = [
      ['equipment: ["<id>"]', (id) => ({ equipment: [id] }), ownEquipment, victimEquipment, 'equipment[0]', { equipment: [{ equipmentId: ownEquipment, name: 'crane', hours: 2 }] }, 'equipment'],
      ['materials: ["<id>"]', (id) => ({ materials: [id] }), ownMaterial, foreignMaterial, 'materials[0]', { materials: [{ materialId: ownMaterial, name: 'cement', qty: 2, unit: 'bag' }] }, 'materials'],
      ['equipment: [{ equipment: { id } }]', (id) => ({ equipment: [{ equipment: { id }, hours: 2 }] }), ownEquipment, victimEquipment, 'equipment[0].equipment', { equipment: [{ equipmentId: ownEquipment, name: 'crane', hours: 2 }] }, 'equipment'],
      ['materials: [{ material: { id } }]', (id) => ({ materials: [{ material: { id }, qty: 1 }] }), ownMaterial, foreignMaterial, 'materials[0].material', { materials: [{ materialId: ownMaterial, name: 'cement', qty: 2, unit: 'bag' }] }, 'materials'],
    ];
    for (const [record, table, create, makeDraft, patch] of RECORDS) {
      for (const [label, lines, ownId, foreignId, field, ownLines, column] of SHAPES) {
        // POST: own, victim's and nowhere alike; the same notes with the own line are then accepted (the gate).
        const res = {};
        const notes = `${STAMP} LINES ${record} ${label} ${nextMarker()}`;
        for (const [whose, id] of [['own', ownId], ['foreign', foreignId], ['nowhere', nowhere()]]) res[whose] = { res: await create(notes, lines(id)), id };
        const stored = await rowByNotes(table, notes);
        const gateRes = await create(notes, ownLines);
        const gated = await rowByNotes(table, notes);
        const gate = gateRes.status === 201 && gated?.[column]?.includes(column === 'equipment' ? ownEquipment : ownMaterial) ? gateRes : { ...gateRes, status: 0 };
        check(`SHAPE (POST ${record}): ${label} is refused as invalid input (400 VALIDATION_ERROR on ${field}) and nothing is stored${gateNote(gate)}`, ok2xx(gate) && ['own', 'foreign', 'nowhere'].every((w) => invalidInput(res[w].res) && fieldsNamed(res[w].res).includes(field)) && !stored, ['own', 'foreign', 'nowhere'].map((w) => `${w} ${said(res[w].res)} ${fieldsNamed(res[w].res)}`).join(' | '));
        check(`NOWHERE (POST ${record}): ${label} — the own, company ${VICTIM}'s and a nowhere id are answered alike (the whole answer)${gateNote(gate)}`, ok2xx(gate) && answerOf(res.own.res, [res.own.id]) === answerOf(res.foreign.res, [res.foreign.id]) && answerOf(res.foreign.res, [res.foreign.id]) === answerOf(res.nowhere.res, [res.nowhere.id]), `${answerOf(res.foreign.res, [res.foreign.id]).slice(0, 240)} | ${answerOf(res.nowhere.res, [res.nowhere.id]).slice(0, 240)}`);
        // PATCH on an own draft: refused ones change nothing; the own line is then accepted.
        const draftId = await makeDraft();
        const was = await rowById(table, draftId);
        const pRes = {};
        const pMarker = `${STAMP} LINES-P ${nextMarker()}`;
        for (const [whose, id] of [['own', ownId], ['foreign', foreignId], ['nowhere', nowhere()]]) pRes[whose] = { res: await patch(draftId, { notes: pMarker, ...lines(id) }), id };
        const kept = await rowById(table, draftId);
        const pGateRes = await patch(draftId, { notes: pMarker, ...ownLines });
        const moved = await rowById(table, draftId);
        const pGate = ok2xx(pGateRes) && moved?.notes === pMarker ? pGateRes : { ...pGateRes, status: 0 };
        check(`SHAPE (PATCH ${record}): ${label} is refused as invalid input (400 VALIDATION_ERROR on ${field}) and the record is unchanged${gateNote(pGate)}`, ok2xx(pGate) && ['own', 'foreign', 'nowhere'].every((w) => invalidInput(pRes[w].res) && fieldsNamed(pRes[w].res).includes(field)) && canonical(kept) === canonical(was), ['own', 'foreign', 'nowhere'].map((w) => `${w} ${said(pRes[w].res)}`).join(' | '));
        check(`NOWHERE (PATCH ${record}): ${label} — the own, company ${VICTIM}'s and a nowhere id are answered alike${gateNote(pGate)}`, ok2xx(pGate) && answerOf(pRes.own.res, [pRes.own.id]) === answerOf(pRes.foreign.res, [pRes.foreign.id]) && answerOf(pRes.foreign.res, [pRes.foreign.id]) === answerOf(pRes.nowhere.res, [pRes.nowhere.id]), `${answerOf(pRes.foreign.res, [pRes.foreign.id]).slice(0, 240)} | ${answerOf(pRes.nowhere.res, [pRes.nowhere.id]).slice(0, 240)}`);
      }

      // An equipment line names its equipmentId, else its id — as the approval reads it.
      const rowNotes = `${STAMP} LINES row-1 ${record} ${nextMarker()}`;
      const rowLines = { equipment: [{ equipmentId: ownEquipment, id: 'row-1', name: 'crane', hours: 2 }, { name: 'site equipment', hours: 1 }] };
      const rowRes = await create(rowNotes, rowLines);
      const rowStored = await rowByNotes(table, rowNotes);
      check(`ALLOWED (POST ${record}): { equipmentId: <own>, id: 'row-1' } names the own equipment — accepted (201) and stored as sent`, rowRes.status === 201 && rowStored && canonical(JSON.parse(rowStored.equipment)) === canonical(rowLines.equipment), `${said(rowRes)}; ${JSON.stringify(rowStored)}`);
      const idRes = {};
      const idNotes = `${STAMP} LINES id ${record} ${nextMarker()}`;
      for (const [whose, id] of [['row', 'row-1'], ['foreign', victimEquipment], ['nowhere', nowhere()]]) idRes[whose] = { res: await create(idNotes, { equipment: [{ id, name: 'crane', hours: 1 }] }), id };
      const idStored = await rowByNotes(table, idNotes);
      check(`REFUSED (POST ${record}): an equipment line { id } without an equipmentId names that id — 'row-1', company ${VICTIM}'s and a nowhere equipment are refused alike (400 EQUIPMENT_USAGE_LINK_INVALID), nothing stored${gateNote(rowRes)}`, ok2xx(rowRes) && ['row', 'foreign', 'nowhere'].every((w) => idRes[w].res.status === 400 && idRes[w].res.body?.error?.code === 'EQUIPMENT_USAGE_LINK_INVALID') && new Set(['row', 'foreign', 'nowhere'].map((w) => answerOf(idRes[w].res, [idRes[w].id]))).size === 1 && !idStored, ['row', 'foreign', 'nowhere'].map((w) => said(idRes[w].res)).join(' | '));
    }

    // The approval posts the own equipment a { equipmentId, id: 'row-1' } line names.
    const approveActivity = await freshActivity('APPROVE');
    const submitted = await pm('POST', `${AP}/daily-reports`, { activityId: approveActivity, date: nextDate(2023), status: 'submitted', notes: `${STAMP} approve row-1`, equipment: [{ equipmentId: ownEquipment, id: 'row-1', name: 'crane', hours: 2 }] });
    const approved = submitted.body?.data?.id ? await pm('POST', `${AP}/daily-reports/${submitted.body.data.id}/approve`, {}) : { status: 0 };
    const posted = submitted.body?.data?.id ? await val('select "equipmentId"::text from "ActivityEquipmentUsage" where "dailyReportId" = $1', [submitted.body.data.id]) : null;
    check('ALLOWED approval: the report with { equipmentId: <own>, id: \'row-1\' } is approved and its usage posted against the own equipment', submitted.status === 201 && ok2xx(approved) && approved.body?.data?.status === 'approved' && posted === ownEquipment, `${said(submitted)} | ${said(approved)}; posted ${posted}`);
  }

  // ══ 4. a meeting's refusals ═══════════════════════════════════════════════
  section = '4 meeting refusals';
  console.log('\n── 4. meetings: a person, party or task outside the project is refused without the id ──');
  if (runs()) {
    const meetingsTitled = async (title) => Number(await val('select count(*)::int from "Meeting" where "projectId" = $1 and title = $2', [A.id, title]));
    const noIdIn = (res, ids) => ids.every((id) => !(res.text || '').includes(id));
    // [label, payload(id), code, own id (the gate), victim id]
    const MEETING_CASES = [
      ['an attendee person', (id) => ({ attendees: [{ userId: id, name: 'Attendee', role: 'attendee' }] }), 'MEETING_USER_INVALID', pmId, foreignUser],
      ['the chair', (id) => ({ chairId: id }), 'MEETING_USER_INVALID', pmId, foreignUser],
      ['an action item owner', (id) => ({ actionItems: [{ title: 'Issue sketch', ownerId: id, dueDate: '2026-11-02', createTask: false }] }), 'MEETING_USER_INVALID', pmId, foreignUser],
      ['an attendee party', (id) => ({ attendees: [{ projectPartyId: id, name: 'Party rep', role: 'attendee' }] }), 'MEETING_PARTY_INVALID', ownParty, foreignParty],
      ['an action item task', (id) => ({ actionItems: [{ title: 'Follow up', ownerName: 'Site', dueDate: '2026-11-02', taskId: id, createTask: false }] }), 'MEETING_TASK_INVALID', ownTask, foreignTask],
    ];
    const patchMeeting = (await must(pm, 'POST', `${AP}/meetings`, { title: `EL5 ${STAMP} patch target`, meetingType: 'coordination' }, 'meeting to patch')).id;
    for (const [label, payload, code, ownId, foreignId] of MEETING_CASES) {
      const title = `EL5 ${STAMP} ${label} ${nextMarker()}`;
      const noneId = nowhere();
      const bad = await pm('POST', `${AP}/meetings`, { title, ...payload(foreignId) });
      const none = await pm('POST', `${AP}/meetings`, { title, ...payload(noneId) });
      const storedBad = await meetingsTitled(title);
      const gateRes = await pm('POST', `${AP}/meetings`, { title, ...payload(ownId) });
      const gate = gateRes.status === 201 && (await meetingsTitled(title)) === 1 ? gateRes : { ...gateRes, status: 0 };
      check(`REFUSED (POST meeting): ${label} of company ${VICTIM} is refused 400 ${code}, no meeting stored${gateNote(gate)}`, ok2xx(gate) && bad.status === 400 && bad.body?.error?.code === code && storedBad === 0, said(bad));
      check(`NOWHERE (POST meeting): ${label} — exactly as one that exists nowhere, and the answer carries neither id${gateNote(gate)}`, ok2xx(gate) && answerOf(bad) === answerOf(none) && noIdIn(bad, [foreignId]) && noIdIn(none, [noneId]) && bad.body?.error?.details === undefined, `${answerOf(bad).slice(0, 240)} | ${answerOf(none).slice(0, 240)}`);
      const objective = `EL5 ${STAMP} patched ${nextMarker()}`;
      const pBad = await pm('PATCH', `${AP}/meetings/${patchMeeting}`, { objective, ...payload(foreignId) });
      const pNone = await pm('PATCH', `${AP}/meetings/${patchMeeting}`, { objective, ...payload(nowhere()) });
      const kept = await val('select objective from "Meeting" where id = $1', [patchMeeting]);
      const pGateRes = await pm('PATCH', `${AP}/meetings/${patchMeeting}`, { objective, ...payload(ownId) });
      const pGate = ok2xx(pGateRes) && (await val('select objective from "Meeting" where id = $1', [patchMeeting])) === objective ? pGateRes : { ...pGateRes, status: 0 };
      check(`REFUSED (PATCH meeting): ${label} of company ${VICTIM} is refused 400 ${code} without the id, exactly as a nowhere one, the meeting unchanged${gateNote(pGate)}`, ok2xx(pGate) && pBad.status === 400 && pBad.body?.error?.code === code && kept !== objective && answerOf(pBad) === answerOf(pNone) && noIdIn(pBad, [foreignId]), `${said(pBad)} | ${said(pNone)}`);
    }
    // Distribution: to a person or a party outside the project.
    const distMeeting = (await must(pm, 'POST', `${AP}/meetings`, { title: `EL5 ${STAMP} distribution`, meetingType: 'coordination' }, 'meeting to distribute')).id;
    const distributions = async () => Number(await val('select count(*)::int from "MeetingDistribution" where "meetingId" = $1', [distMeeting]));
    for (const [label, payload, code, ownId, foreignId] of [
      ['userIds', (id) => ({ includeAttendees: false, userIds: [id] }), 'MEETING_DISTRIBUTION_USER_INVALID', pmId, foreignUser],
      ['recipientUserIds', (id) => ({ includeAttendees: false, recipientUserIds: [id] }), 'MEETING_DISTRIBUTION_USER_INVALID', pmId, foreignUser],
      ['projectPartyIds', (id) => ({ includeAttendees: false, projectPartyIds: [id] }), 'MEETING_DISTRIBUTION_PARTY_INVALID', ownParty, foreignParty],
    ]) {
      const countBefore = await distributions();
      const bad = await pm('POST', `${AP}/meetings/${distMeeting}/distribute`, payload(foreignId));
      const none = await pm('POST', `${AP}/meetings/${distMeeting}/distribute`, payload(nowhere()));
      const countAfter = await distributions();
      const gateRes = await pm('POST', `${AP}/meetings/${distMeeting}/distribute`, payload(ownId));
      const gate = ok2xx(gateRes) && (await distributions()) > countAfter ? gateRes : { ...gateRes, status: 0 };
      check(`REFUSED (distribute ${label}): company ${VICTIM}'s recipient is refused 400 ${code} without the id, exactly as a nowhere one, nothing distributed${gateNote(gate)}`, ok2xx(gate) && bad.status === 400 && bad.body?.error?.code === code && answerOf(bad) === answerOf(none) && noIdIn(bad, [foreignId]) && countAfter === countBefore, `${said(bad)} | ${said(none)} | gate ${said(gateRes)}`);
    }
  }

  // ══ 5. the dates of daily reports, site diaries and meetings ══════════════
  section = '5 dates';
  console.log('\n── 5. every body date: one text a Date reads — a list, a number, a compact, week or ordinal form refused 400 ──');
  if (runs()) {
    const dateActivity = await freshActivity('DATES');
    const draftReport = (await must(pm, 'POST', `${AP}/daily-reports`, { activityId: dateActivity, date: nextDate(2024), status: 'draft', notes: `${STAMP} DATES report` }, 'report to patch')).id;
    const draftDiary = (await must(pm, 'POST', `${AP}/site-diaries`, { date: nextDate(2024), status: 'draft', notes: `${STAMP} DATES diary` }, 'diary to patch')).id;
    const meetingToPatch = (await must(pm, 'POST', `${AP}/meetings`, { title: `EL5 ${STAMP} DATES` }, 'meeting to patch')).id;
    const photo = (field) => (v) => ({ photos: [{ url: 'https://example.test/site.jpg', [field]: v }] });
    const top = (field) => (v) => ({ [field]: v });
    const progress = (field) => (v) => ({ progress: { method: 'percent', pctComplete: 2, [field]: v } });
    const reportFields = [['date', top('date')], ['photos[0].takenAt', photo('takenAt')], ['photos[0].uploadedAt', photo('uploadedAt')], ['clientCreatedAt', top('clientCreatedAt')], ['progress.actualStart', progress('actualStart')], ['progress.actualFinish', progress('actualFinish')]];
    const diaryFields = [['date', top('date')], ['photos[0].takenAt', photo('takenAt')], ['photos[0].uploadedAt', photo('uploadedAt')], ['clientCreatedAt', top('clientCreatedAt')]];
    const meetingFields = [
      ['scheduledAt', top('scheduledAt')], ['startedAt', top('startedAt')], ['endedAt', top('endedAt')], ['nextMeetingAt', top('nextMeetingAt')],
      ['attendees[0].attendedAt', (v) => ({ attendees: [{ name: 'Attendee', attendedAt: v }] })],
      ['decisions[0].decidedAt', (v) => ({ decisions: [{ title: 'Gate', decision: 'Use the south gate', decidedAt: v }] })],
      ['actionItems[0].dueDate', (v) => ({ actionItems: [{ title: 'Sketch', ownerName: 'Site', dueDate: v, createTask: false }] })],
    ];
    // [door, field, body(value, marker), stored(marker)]
    const CHAINS = [
      ...reportFields.map(([field, set]) => ['POST daily report', field, (v, m) => pm('POST', `${AP}/daily-reports`, { activityId: dateActivity, date: nextDate(2024), status: 'draft', notes: m, ...set(v) }), async (m) => Number(await val('select count(*)::int from "DailyReport" where "projectId" = $1 and notes = $2', [A.id, m]))]),
      ...reportFields.map(([field, set]) => ['PATCH daily report', field, (v, m) => pm('PATCH', `${AP}/daily-reports/${draftReport}`, { notes: m, ...set(v) }), async (m) => Number(await val('select count(*)::int from "DailyReport" where id = $1 and notes = $2', [draftReport, m]))]),
      ...diaryFields.map(([field, set]) => ['POST site diary', field, (v, m) => pm('POST', `${AP}/site-diaries`, { date: nextDate(2024), status: 'draft', notes: m, ...set(v) }), async (m) => Number(await val('select count(*)::int from "SiteDiary" where "projectId" = $1 and notes = $2', [A.id, m]))]),
      ...diaryFields.map(([field, set]) => ['PATCH site diary', field, (v, m) => pm('PATCH', `${AP}/site-diaries/${draftDiary}`, { notes: m, ...set(v) }), async (m) => Number(await val('select count(*)::int from "SiteDiary" where id = $1 and notes = $2', [draftDiary, m]))]),
      ...meetingFields.map(([field, set]) => ['POST meeting', field, (v, m) => pm('POST', `${AP}/meetings`, { title: m, ...set(v) }), async (m) => Number(await val('select count(*)::int from "Meeting" where "projectId" = $1 and title = $2', [A.id, m]))]),
      ...meetingFields.map(([field, set]) => ['PATCH meeting', field, (v, m) => pm('PATCH', `${AP}/meetings/${meetingToPatch}`, { objective: m, ...set(v) }), async (m) => Number(await val('select count(*)::int from "Meeting" where id = $1 and objective = $2', [meetingToPatch, m]))]),
    ];
    check(`the routers' 34 body date chains are all driven (12 daily report, 8 site diary, 14 meeting): ${CHAINS.length}`, CHAINS.length === 34);
    const BAD = [['20261001', '20261001'], ['2026-W40', '2026-W40'], ['2026-275', '2026-275'], ['["2026-10-01"]', ['2026-10-01']], ['20261001 (a number)', 20261001]];
    for (const [door, field, send, stored] of CHAINS) {
      const refused = [];
      for (const [label, value] of BAD) {
        const marker = `EL5 ${STAMP} ${nextMarker()}`;
        const res = await send(value, marker);
        refused.push({ label, res, stored: await stored(marker) });
      }
      const gateMarker = `EL5 ${STAMP} ${nextMarker()}`;
      const gateRes = await send(field === 'date' || field.endsWith('dueDate') ? nextDate(2025) : '2026-10-01T08:00:00.000Z', gateMarker);
      const gate = ok2xx(gateRes) && (await stored(gateMarker)) === 1 ? gateRes : { ...gateRes, status: 0 };
      const wrong = refused.filter((r) => !(invalidInput(r.res) && fieldsNamed(r.res).includes(field) && r.stored === 0));
      check(`SHAPE (${door}) ${field}: '20261001', '2026-W40', '2026-275', ["2026-10-01"] and 20261001 are each refused 400 VALIDATION_ERROR on ${field}, nothing stored${gateNote(gate)}`, ok2xx(gate) && wrong.length === 0, wrong.map((r) => `${r.label} -> ${said(r.res)} ${fieldsNamed(r.res)}${r.stored ? ' STORED' : ''}`).join(' | '));
    }
  }

  // ══ 6. what the clients send ══════════════════════════════════════════════
  section = '6 client shapes';
  console.log('\n── 6. the UAT runner, the web pages and the drivers: accepted and stored as sent ──');
  if (runs()) {
    const runId = `el5-${stamp}`;
    const evidenceAttachment = () => [{ fileName: `uat-evidence-${runId}.jpg`, fileUrl: 'https://example.com/uat-evidence.jpg', mimeType: 'image/jpeg', sizeBytes: 1024, description: 'Synthetic UAT evidence reference' }];
    const keptPhoto = { key: null, url: 'https://example.com/uat-evidence.jpg', filename: `uat-evidence-${runId}.jpg`, originalName: null, mimeType: 'image/jpeg', size: 1024, storage: null, caption: null, takenAt: null, uploadedBy: null, uploadedAt: null, description: 'Synthetic UAT evidence reference' };
    // The UAT runner's daily report (e2e/uat/run-uat-regression.mjs runScheduleCostIpcFlow), as it sends it, then approved.
    const uatActivity = await freshActivity('UAT');
    const uatReport = await pm('POST', `${AP}/daily-reports`, {
      activityId: uatActivity, date: '2026-02-15', shift: 'day', pctProgress: 80,
      weather: { summary: 'Clear', condition: 'clear', temperatureC: 22, delayImpact: false },
      manpower: [{ trade: 'Concrete', workers: 8, hours: 8 }], materials: [{ name: 'Concrete', qty: 35, unit: 'm3' }], equipment: [{ name: 'Pump', hours: 6 }],
      issues: [{ title: 'Access coordination', severity: 'low', status: 'closed' }],
      photos: evidenceAttachment(), notes: 'UAT daily report.', clientRequestId: `uat-${runId}`, clientCreatedAt: '2026-02-15T08:00:00.000Z', deviceId: 'uat-tablet-01', status: 'submitted',
    });
    const uatRow = await one('select id::text as id, "photosJson" as photos from "DailyReport" where "projectId" = $1 and "clientRequestId" = $2', [A.id, `uat-${runId}`]);
    check('ALLOWED UAT daily report: the runner\'s photo is kept — its fileUrl the url, its fileName the filename, its sizeBytes the size, its description kept (201, stored, answered)', uatReport.status === 201 && canonical(uatRow?.photos) === canonical([keptPhoto]) && canonical(uatReport.body?.data?.photos) === canonical([keptPhoto]), `${said(uatReport)}; stored ${JSON.stringify(uatRow?.photos)}`);
    const uatApproved = uatRow ? await pm('POST', `${AP}/daily-reports/${uatRow.id}/approve`, {}) : { status: 0 };
    const uatEvidence = uatRow ? await val('select "evidenceJson"::text from "ProgressSubmission" where "dailyReportId" = $1', [uatRow.id]) : null;
    check('ALLOWED UAT daily report: …approved as the runner approves it; its progress evidence carries the kept photo', ok2xx(uatApproved) && uatApproved.body?.data?.status === 'approved' && String(uatEvidence).includes('https://example.com/uat-evidence.jpg'), `${said(uatApproved)}; evidence ${String(uatEvidence).slice(0, 200)}`);
    const uatDiaryNotes = `${STAMP} UAT diary`;
    const uatDiary = await pm('POST', `${AP}/site-diaries`, { date: '2026-02-15', status: 'draft', notes: uatDiaryNotes, photos: evidenceAttachment() });
    const uatDiaryRow = await one('select "photosJson" as photos from "SiteDiary" where "projectId" = $1 and notes = $2', [A.id, uatDiaryNotes]);
    check('ALLOWED UAT photo on a site diary: kept as on a daily report (201, stored)', uatDiary.status === 201 && canonical(uatDiaryRow?.photos) === canonical([keptPhoto]), `${said(uatDiary)}; stored ${JSON.stringify(uatDiaryRow?.photos)}`);
    // The runner's photo naming another company's document by its fileUrl: refused as nowhere; the own accepted.
    for (const [record, send, column] of [['daily report', (photos, notes) => pm('POST', `${AP}/daily-reports`, { activityId: uatActivity, date: nextDate(2026), status: 'draft', notes, photos }), 'DailyReport'], ['site diary', (photos, notes) => pm('POST', `${AP}/site-diaries`, { date: nextDate(2026), status: 'draft', notes, photos }), 'SiteDiary']]) {
      const asUat = (d) => [{ ...evidenceAttachment()[0], fileUrl: upload(A.id, d) }];
      const notes = `${STAMP} UAT fileUrl ${record} ${nextMarker()}`;
      const noneId = nowhere();
      const bad = await send(asUat(foreignDoc), notes);
      const none = await send(asUat(noneId), notes);
      const storedBad = Number(await val(`select count(*)::int from "${column}" where "projectId" = $1 and notes = $2`, [A.id, notes]));
      const gateRes = await send(asUat(ownDoc), notes);
      const gate = gateRes.status === 201 && Number(await val(`select count(*)::int from "${column}" where "projectId" = $1 and notes = $2 and "photosJson"::text like $3`, [A.id, notes, `%${ownDoc}%`])) === 1 ? gateRes : { ...gateRes, status: 0 };
      check(`REFUSED ${record}: the runner's photo whose fileUrl names company ${VICTIM}'s document is refused exactly as a nowhere one, nothing stored${gateNote(gate)}`, ok2xx(gate) && is4xx(bad) && storedBad === 0 && answerOf(bad, [foreignDoc]) === answerOf(none, [noneId]), `${answerOf(bad, [foreignDoc]).slice(0, 200)} | ${answerOf(none, [noneId]).slice(0, 200)}`);
    }

    // The web site-reporting form (site-reporting-dashboard.tsx): the upload's answer as photos, the project's equipment picked.
    const webActivity = await freshActivity('WEB');
    const meta = (kind) => ({ clientRequestId: `${kind}-${crypto.randomUUID()}`, clientCreatedAt: new Date().toISOString(), deviceId: `web-${stamp}` });
    const dailyMeta = meta('daily');
    const webDaily = await pm('POST', `${AP}/daily-reports`, {
      activityId: webActivity, date: nextDate(2026), shift: 'day', pctProgress: 10, weather: { summary: 'Clear' },
      manpower: [{ trade: 'crew', workers: 6, hours: 8 }], equipment: [{ equipmentId: ownEquipment, name: 'crane', hours: 3 }, { name: 'site equipment', hours: 1 }],
      materials: [{ name: 'material', qty: 2, unit: 'unit' }], issues: [{ description: `${STAMP} access`, severity: 'medium', status: 'open' }],
      photos: [webPhoto], notes: `${STAMP} web daily`, status: 'submitted', ...dailyMeta,
      progress: { method: 'percent', pctComplete: 10, evidence: { photos: [webPhoto] } },
    });
    const webDailyRow = await one('select "equipmentJson"::text as equipment, "photosJson" as photos from "DailyReport" where "projectId" = $1 and "clientRequestId" = $2', [A.id, dailyMeta.clientRequestId]);
    check('ALLOWED web daily report: the upload\'s answer as photos (its url and key, the document\'s uploader) and the project\'s equipment — accepted (201) and stored', webDaily.status === 201 && webDailyRow?.equipment.includes(ownEquipment) && webDailyRow?.photos?.[0]?.key === ownDoc && webDailyRow?.photos?.[0]?.url === webPhoto.url && webDailyRow?.photos?.[0]?.uploadedBy === pmId, `${said(webDaily)}; ${JSON.stringify(webDailyRow).slice(0, 300)}`);
    const diaryMeta = meta('diary');
    const webDiary = await pm('POST', `${AP}/site-diaries`, {
      date: nextDate(2026), shift: 'day', weather: 'Clear', weatherDetails: { summary: 'Clear' }, workers: 12, visitors: '', workDone: `${STAMP} slab`, issues: '', issueItems: [], instructions: '',
      manpower: [{ trade: 'crew', workers: 4, hours: 8 }], equipment: [{ equipmentId: ownEquipment, name: 'crane', hours: 2 }], materials: [{ name: 'material', qty: 2, unit: 'unit' }],
      photos: [webPhoto], notes: `${STAMP} web diary`, status: 'submitted', ...diaryMeta,
    });
    const webDiaryRow = await one('select "equipmentJson"::text as equipment, "photosJson" as photos from "SiteDiary" where "projectId" = $1 and "clientRequestId" = $2', [A.id, diaryMeta.clientRequestId]);
    check('ALLOWED web site diary: the upload\'s answer as photos and the project\'s equipment — accepted (201) and stored', webDiary.status === 201 && webDiaryRow?.equipment.includes(ownEquipment) && webDiaryRow?.photos?.[0]?.key === ownDoc, `${said(webDiary)}; ${JSON.stringify(webDiaryRow).slice(0, 300)}`);
    // The certification driver's report (drivers/progress.js): photos [{ key, filename, caption }].
    const driverReport = await pm('POST', `${AP}/daily-reports`, { activityId: webActivity, date: nextDate(2026), shift: 'night', photos: [{ key: webPhoto.key, filename: webPhoto.filename, caption: `${STAMP} progress photo` }], notes: `${STAMP} driver report`, status: 'draft' });
    check('ALLOWED driver daily report photos [{ key, filename, caption }] are accepted (201) and stored', driverReport.status === 201 && (await val('select "photosJson"::text from "DailyReport" where "projectId" = $1 and notes = $2', [A.id, `${STAMP} driver report`]))?.includes(ownDoc), said(driverReport));

    // The UAT runner's meeting (runMeetingMinutesFlow), distribution and comment, as it sends them.
    const suffix = stamp.replace(/[^a-z0-9]/g, '').slice(-10);
    const uatMeetingBody = (attendanceStatus, agendaStatus) => ({
      title: `UAT coordination minutes ${suffix}`, meetingType: 'coordination', status: 'draft', activityId: uatActivity,
      scheduledAt: '2026-02-18T15:00:00.000Z', startedAt: '2026-02-18T15:05:00.000Z', endedAt: '2026-02-18T15:45:00.000Z',
      location: 'Site conference room', objective: 'Coordinate concrete access and decision traceability.', minutesText: 'Reviewed pour access, approvals, and owner distribution.',
      attendees: [
        { userId: pmId, name: 'UAT Project Manager', role: 'chair', attendanceStatus, distributionRequired: true, activityId: uatActivity },
        { name: 'UAT Consultant', email: `consultant.${suffix}@pmcopilots.test`, companyName: 'UAT Consultant', role: 'consultant', attendanceStatus, distributionRequired: true, activityId: uatActivity },
      ],
      agendaItems: [{ title: 'Concrete pour access', notes: 'Review gate sequence and pump location.', status: agendaStatus, activityId: uatActivity }],
      decisions: [{ title: 'Access gate sequence approved', decision: 'Use south gate for concrete pump staging during the UAT pour.', impact: 'Keeps concrete pour aligned with approved schedule activity.', activityId: uatActivity }],
      actionItems: [{ title: 'Issue gate access sketch', description: 'Send the agreed staging sketch to the field crew.', ownerName: 'UAT Site Engineer', ownerEmail: `site.${suffix}@pmcopilots.test`, dueDate: '2026-02-21', priority: 'high', activityId: uatActivity, createTask: true }],
    });
    // The runner sends attendanceStatus 'present' and an agenda status 'closed', words the meeting routes have never
    // taken (ATTENDANCE_STATUSES, AGENDA_STATUSES at HEAD): refused for those three fields only — never for a date.
    const literal = await pm('POST', `${AP}/meetings`, uatMeetingBody('present', 'closed'));
    check('UAT meeting as the runner sends it: refused (400 VALIDATION_ERROR) for its attendance and agenda words only — none of its dates (pre-existing, reported)', invalidInput(literal) && canonical(fieldsNamed(literal).sort()) === canonical(['agendaItems[0].status', 'attendees[0].attendanceStatus', 'attendees[1].attendanceStatus']), said(literal));
    const uatMeeting = await pm('POST', `${AP}/meetings`, uatMeetingBody('attended', 'covered'));
    const uatMeetingId = uatMeeting.body?.data?.id;
    check('ALLOWED UAT meeting (its words as the API takes them): created (201) with its ISO dates, its agenda item, decision and action item (linked to a task, its due date kept)', uatMeeting.status === 201 && uatMeeting.body?.data?.actionItems?.[0]?.taskId && String(uatMeeting.body?.data?.actionItems?.[0]?.dueDate).startsWith('2026-02-21') && uatMeeting.body?.data?.decisions?.length === 1 && uatMeeting.body?.data?.scheduledAt === '2026-02-18T15:00:00.000Z', said(uatMeeting));
    const uatDistribution = uatMeetingId ? await pm('POST', `${AP}/meetings/${uatMeetingId}/distribute`, { includeAttendees: true, message: 'UAT minutes distributed for contractual record.', recipients: [{ name: 'UAT Owner', email: `owner.${suffix}@pmcopilots.test`, companyName: 'UAT Owner' }] }) : { status: 0 };
    const uatComment = uatMeetingId ? await pm('POST', `${AP}/meetings/${uatMeetingId}/comments`, { body: 'UAT owner distribution acknowledged.', activityId: uatActivity }) : { status: 0 };
    check('ALLOWED UAT meeting: distributed (status distributed) and commented as the runner does', ok2xx(uatDistribution) && uatDistribution.body?.data?.meeting?.status === 'distributed' && uatComment.status === 201, `${said(uatDistribution)} | ${said(uatComment)}`);
    // The web meetings page (meetings-dashboard.tsx toPayload): dates as ISO or null, a date input's YYYY-MM-DD due date.
    const webMeeting = await pm('POST', `${AP}/meetings`, {
      title: `EL5 ${STAMP} web meeting`, meetingType: 'coordination', status: 'draft', location: null, scheduledAt: new Date('2026-03-02T09:30').toISOString(), nextMeetingAt: null, activityId: null, objective: null, minutesText: null,
      attendees: [{ name: 'Site Engineer', email: null, companyName: null, role: 'attendee', attendanceStatus: 'invited', distributionRequired: true }],
      agendaItems: [{ activityId: null, sortOrder: 1, title: 'Access', notes: null, status: 'open' }],
      decisions: [{ activityId: null, title: 'Gate', decision: 'Use the south gate', impact: null, decidedAt: new Date().toISOString() }],
      actionItems: [{ activityId: null, taskId: null, itemNumber: 'AI-001', title: 'Sketch', description: null, ownerName: 'Site', ownerEmail: null, dueDate: '2026-03-09', priority: 'medium', status: 'open', createTask: false }],
    });
    check('ALLOWED web meeting: the meetings page\'s payload (ISO dates, nulls, a YYYY-MM-DD due date) is created (201)', webMeeting.status === 201, said(webMeeting));
  }

  // ── after ────────────────────────────────────────────────────────────────
  section = 'after';
  console.log('\n── after ──');
  const namingAfter = await naming();
  const grew = Object.keys(NAMING).filter((t) => namingAfter[t] !== namingBefore[t]);
  check(`no row of company ${ATTACKER} names company ${VICTIM}'s ids that did not before`, grew.length === 0, grew.map((t) => `${t} ${namingBefore[t]}->${namingAfter[t]}`).join(', '));
  const told = Number(await val(`select count(*)::int from "Notification" n where n."recipientUserId" = $1 and n."createdAt" >= ($2::timestamptz at time zone 'UTC')
      and (n."orgId" = $3 or n."actorId" in (select "userId" from "OrganizationMembership" where "orgId" = $3))`, [foreignUser, startedAt.toISOString(), attackerOrg]));
  check(`nobody of company ${VICTIM} was notified by company ${ATTACKER}'s requests`, told === 0, `${told} notices to ${foreignUser}`);
  const attack = answers.filter((a) => !a.route.startsWith(`pm@${VICTIM}`));
  const leaked = attack.map((a) => [a, leakOf(a)]).filter(([, l]) => l);
  check(`no answer to company ${ATTACKER} carries company ${VICTIM}'s ids (beyond those it sent), names, addresses or canaries (${attack.length} answers)`, leaked.length === 0, leaked.slice(0, 6).map(([a, l]) => `${a.status} ${a.route} -> ${l}`).join('\n        '));
  const errors = answers.filter((a) => a.status >= 500);
  check(`no answer is a server error (${answers.length} answers)`, errors.length === 0, errors.slice(0, 8).map((a) => `${a.status} ${a.route} ${firstLine(a.text).slice(0, 160)}`).join('\n        '));
  if (FINGERPRINT) {
    const after = await snapshot();
    const moved = fingerprint.compare(before, after).filter((c) => !c.noise && c.org === VICTIM);
    check(`company ${VICTIM}'s data did not change (every table)`, moved.length === 0, moved.slice(0, 8).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
  }
  await db.end();

  const bySection = new Map();
  for (const r of results) {
    const entry = bySection.get(r.section) || { passed: 0, failed: 0 };
    entry[r.ok ? 'passed' : 'failed'] += 1;
    bySection.set(r.section, entry);
  }
  console.log('\nper section:');
  for (const [name, entry] of bySection) console.log(`  ${entry.failed ? 'FAIL' : 'ok  '}  ${name}: ${entry.passed} passed, ${entry.failed} failed`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${GROUP} proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
