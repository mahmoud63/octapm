'use strict';

/**
 * The CERT-2 proof of group people-evidence-3: the people a daily report and an
 * activity name, the documents progress evidence names, and the shape of a
 * timesheet's crew.
 *
 *   $env:DATABASE_URL = $null; $env:CERT_INPROCESS = "1"; node scripts/cert/isolation/people-evidence-3-proof.js [attacker=067] [victim=068]
 *   … [--only=<section regex, e.g. "^2">] [--no-fingerprint]   (for mutation runs; a full run takes neither)
 *
 * What each did before the fix (reproduced in process, 067 -> 068):
 *   1. POST /daily-reports engineerId = another company's person answered 201
 *      and stored it (GET served it back); one who exists nowhere answered 500
 *      P2003 (an existence oracle); ["<id>"] answered 500 at the create. PATCH
 *      likewise. A photo's uploadedBy (a person) was stored as given.
 *   2. Progress evidence naming a document in another shape than
 *      photos[{key}] — {photos:{key}}, {photos:[[{key}]]}, {photos:["<id>"]},
 *      {documents:[{documentId}]}, {key} … — answered 2xx and stored another
 *      company's document id in ProgressSubmission.evidenceJson, on the single,
 *      bulk and daily-report paths (and through `evidenceJson`).
 *   3. An activity's engineers were checked against User.orgId: a member of
 *      this company whose home workspace is another was refused.
 *   4. POST /timesheets crewId ["<id>"] / [["<id>"]] answered 500.
 *
 * For every door, on a record of the attacker company that accepts the
 * request (the GATE: the same request with the attacker's own id succeeds on
 * the same record, read back from the database):
 *   REFUSED  the victim's id is refused with a 4xx and nothing is stored;
 *   NOWHERE  an id that exists nowhere gets exactly the same answer (status,
 *            code, message — the whole body, with the request id and the id
 *            the request itself sent set aside);
 *   SHAPE    a value that is not in the accepted shape is refused as invalid
 *            input (400 VALIDATION_ERROR), whoever's id it carries, never a 5xx;
 *   ALLOWED  the attacker's own id, and a person who belongs to both
 *            companies, are accepted and stored.
 * No answer is a 5xx or carries the victim's ids (beyond the ones the request
 * itself sent), names, addresses or canaries; no row of the attacker company
 * names a victim id afterwards that did not before; the victim company's data
 * does not change in any table (fingerprint taken after the setup).
 *
 * Re-runnable: every record is new (fresh activities, crew, people, upload),
 * every request carries a fresh stamp. Exit 0 when every check holds, 2
 * otherwise.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const api = require('../lib/api');
const invitations = require('../lib/invitations');
const { buildPopulation } = require('../lib/spec');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const ATTACKER = positional[0] || '067';
const VICTIM = positional[1] || '068';
const ONLY = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7) || null;
const FINGERPRINT = !process.argv.includes('--no-fingerprint');
const GROUP = 'people-evidence-3';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `PE3-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
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
const said = (res) => `${res.status} ${res.body?.error?.code || ''} ${firstLine(res.body?.error?.message).slice(0, 140)}`.trim();
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
      sessions[key] = async (method, route, body, options) => {
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
  const ownEngineer = await userByEmail(`planner@${attacker.domain}`);
  const ownEngineer2 = await userByEmail(`site@${attacker.domain}`);
  const pmId = await userByEmail(`pm@${attacker.domain}`);
  const foreignUser = await userByEmail(`pm@${victim.domain}`);
  check(`setup: ${ownEngineer} (planner@) and ${ownEngineer2} (site@) are active members of company ${ATTACKER}`, (await memberOf(ownEngineer, attackerOrg)) === 'active' && (await memberOf(ownEngineer2, attackerOrg)) === 'active');
  check(`setup: ${foreignUser} (pm@ of ${VICTIM}) is an active member of company ${VICTIM} and not a member of company ${ATTACKER}`, (await memberOf(foreignUser, victimOrg)) === 'active' && (await memberOf(foreignUser, attackerOrg)) === null);

  // A person of both companies: home workspace the victim's, also a member of the attacker's.
  const password = process.env.CERT_PASSWORD;
  const bothEmail = `pe3.both.${stamp}@shared.octapm-cert.test`;
  // Made in the victim's company the one way D-ID-1 allows: it invites the new e-mail, which accepts with its own name and password.
  const homeMade = await invitations.createByInvitation({ inviter: { send: vPm }, email: bothEmail, role: 'site_engineer', name: `PE3 both ${STAMP}`, password, db });
  const madeHome = homeMade.accepted || homeMade.invited;
  // The attacker's company invites the person; they accept with their own session (L38).
  const joined = await invitations.joinByInvitation({ inviter: api.as(`pm@c${ATTACKER}.octapm-cert.test`), email: bothEmail, role: 'site_engineer', via: 'users', name: `PE3 both ${STAMP}` });
  const madeHere = joined.accepted || joined.invited;
  const both = await userByEmail(bothEmail);
  const bothHome = await val('select "orgId"::text from "User" where id = $1', [both]);
  check(`setup: ${both} is a person whose home workspace is company ${VICTIM} and who is an active member of company ${ATTACKER} too`, Boolean(homeMade.userId) && joined.accepted?.status === 200 && bothHome === victimOrg && (await memberOf(both, attackerOrg)) === 'active' && (await memberOf(both, victimOrg)) === 'active', `${said(madeHome)} | ${said(madeHere)} | home ${bothHome}`);

  // An own site photo, uploaded now the way the site-reporting form uploads it.
  const uploaded = await pm('POST', `${AP}/site-reporting/uploads`, undefined, {
    form: api.multipart({ field: 'files', filename: `${stamp}.png`, contentType: 'image/png', body: PNG_1X1 }),
  });
  const webPhoto = (Array.isArray(uploaded.body?.data) ? uploaded.body.data : [])[0] || null;
  const ownDoc = webPhoto?.documentId;
  const ownDocRow = ownDoc ? await one('select "projectId"::text as project, "orgId"::text as org, "uploadedBy"::text as uploader from "ProjectDocument" where id = $1', [ownDoc]) : null;
  check(`setup: a site photo ${ownDoc} is uploaded to company ${ATTACKER}'s project by its pm`, ownDocRow?.project === A.id && ownDocRow?.org === attackerOrg && ownDocRow?.uploader === pmId, said(uploaded));
  const foreignDocRow = await one(`select id::text as id, "storageKey" as "storageKey", "orgId"::text as org, "fileName" as "fileName", "originalName" as "originalName" from "ProjectDocument" where "orgId" = $1 order by ("documentType" = 'site_photo') desc, "createdAt" limit 1`, [victimOrg]);
  const foreignDoc = foreignDocRow?.id;
  check(`setup: document ${foreignDoc} is company ${VICTIM}'s`, foreignDocRow?.org === victimOrg);
  const victimProjectOrg = await val('select "orgId"::text from "Project" where id = $1', [V.id]);
  check(`setup: project ${V.id} is company ${VICTIM}'s`, victimProjectOrg === victimOrg);
  const foreignCrew = await val('select c.id::text from "Crew" c where c."orgId" = $1 order by c."createdAt" limit 1', [victimOrg]);
  if (foreignCrew) check(`setup: crew ${foreignCrew} is company ${VICTIM}'s`, (await val('select "orgId"::text from "Crew" where id = $1', [foreignCrew])) === victimOrg);
  if (!ownEngineer || !ownEngineer2 || !foreignUser || !both || !ownDoc || !foreignDoc) throw new Error('setup incomplete');

  // Fresh records of the attacker company.
  const freshActivity = async (tag, engineers = [ownEngineer2]) => (await must(planner, 'POST', `${AP}/activities`, { name: `PE3 ${STAMP} ${tag}`, duration: 3, engineerIds: engineers }, `activity ${tag}`)).id;
  const crew = await must(pm, 'POST', `${AP}/timesheets/crews`, { name: `PE3 crew ${STAMP}`, status: 'active' }, 'crew');
  const ownCrew = crew?.id;
  const dateIn = (year, salt) => new Date(Date.UTC(year, 0, 1) + ((parseInt(stamp.slice(-4), 16) + salt) % 360) * 86_400_000).toISOString().slice(0, 10);

  // ── what no answer may carry, and no row of the attacker may name ─────────
  const victimIds = [foreignUser, foreignDoc, foreignDocRow.storageKey, V.id, foreignCrew, victimOrg].filter(Boolean);
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
    ProgressSubmission: 'select count(*)::int as n from "ProgressSubmission" t join "Project" p on p.id = t."projectId" where p."orgId" = $1',
    ActivityProgress: 'select count(*)::int as n from "ActivityProgress" t join "Activity" a on a.id = t."activityId" join "Project" p on p.id = a."projectId" where p."orgId" = $1',
    ActivityAssignment: 'select count(*)::int as n from "ActivityAssignment" t join "Activity" a on a.id = t."activityId" join "Project" p on p.id = a."projectId" where p."orgId" = $1',
    Timesheet: 'select count(*)::int as n from "Timesheet" t where t."orgId" = $1',
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

  const ID_SHAPES = [['["id"]', (id) => [id]], ['[["id"]]', (id) => [[id]]], ['{"id":id}', (id) => ({ id })], ['12345', () => 12345]];

  // ══ 1. daily reports: engineerId (and the photos' uploader) ════════════════
  section = '1 daily-report people';
  console.log('\n── 1. daily reports: engineerId (POST, PATCH), photos[].uploadedBy ──');
  if (runs()) {
    const activity = await freshActivity('DR');
    const DATE = dateIn(2023, 11);
    const reportBy = async (notes) => one('select id::text as id, "engineerId"::text as engineer, "photosJson"::text as photos from "DailyReport" where "projectId" = $1 and notes = $2 order by "createdAt" limit 1', [A.id, notes]);
    const reportById = async (id) => (id ? one('select id::text as id, "engineerId"::text as engineer, "photosJson"::text as photos from "DailyReport" where "projectId" = $1 and id = $2', [A.id, id]) : null);
    const create = (notes, extra) => pm('POST', `${AP}/daily-reports`, { activityId: activity, date: DATE, shift: 'day', status: 'draft', notes, ...extra });

    const ownNotes = `${STAMP} DR own`;
    const ok = await create(ownNotes, { engineerId: ownEngineer });
    const ownRow = await reportBy(ownNotes);
    check(`ALLOWED (POST): the company's own member ${ownEngineer} is the engineer (201, stored)`, ok.status === 201 && ownRow?.engineer === ownEngineer, `${said(ok)}; stored ${ownRow?.engineer}`);
    const sharedNotes = `${STAMP} DR both`;
    const okBoth = await create(sharedNotes, { engineerId: both });
    check(`ALLOWED (POST): a member whose home workspace is company ${VICTIM} is the engineer too (membership, not home)`, okBoth.status === 201 && (await reportBy(sharedNotes))?.engineer === both, said(okBoth));

    // Refused on a fresh note each, then the same note with the own engineer (the gate).
    const refusedCreate = async (label, value) => {
      const notes = `${STAMP} DR-R ${label}`;
      const res = await create(notes, { engineerId: value });
      const stored = await reportBy(notes);
      const gate = await create(notes, { engineerId: ownEngineer });
      const gated = await reportById(gate.body?.data?.id);
      return { res, stored, gate: ok2xx(gate) && gated?.engineer === ownEngineer ? gate : { ...gate, status: 0 } };
    };
    const bad = await refusedCreate('foreign', foreignUser);
    const none = await refusedCreate('nowhere', nowhere());
    check(`REFUSED (POST): company ${VICTIM}'s person is refused with a 4xx and no report is stored${gateNote(bad.gate)}`, ok2xx(bad.gate) && is4xx(bad.res) && !bad.stored, `${said(bad.res)}${bad.stored ? `; STORED DailyReport ${bad.stored.id} engineer ${bad.stored.engineer}` : ''}`);
    check(`NOWHERE (POST): …exactly as a person who exists nowhere (the whole answer; no 5xx)${gateNote(none.gate)}`, ok2xx(none.gate) && answerOf(bad.res, [foreignUser]) === answerOf(none.res) && is4xx(none.res) && !none.stored, `${answerOf(bad.res, [foreignUser]).slice(0, 300)} | ${answerOf(none.res).slice(0, 300)}`);
    for (const [label, make] of ID_SHAPES) {
      const res = await refusedCreate(`shape ${label}`, make(foreignUser));
      check(`SHAPE (POST): engineerId ${label} is refused as invalid input (400 VALIDATION_ERROR; no 5xx) and stores nothing${gateNote(res.gate)}`, ok2xx(res.gate) && invalidInput(res.res) && !res.stored, said(res.res));
    }
    // Read back: the report names the own engineer only.
    const read = ownRow ? await pm('GET', `${AP}/daily-reports/${ownRow.id}`) : { status: 0 };
    check(`read-back: GET /daily-reports/{id} names the own engineer, nothing of company ${VICTIM}`, read.status === 200 && read.body?.data?.engineerId === ownEngineer && !leakOf({ text: read.text || '', sent: '' }), said(read));

    // PATCH on the own draft: refused ones change nothing; the own second engineer is then accepted (the gate).
    if (ownRow) {
      const patch = (body) => pm('PATCH', `${AP}/daily-reports/${ownRow.id}`, body);
      const was = await reportBy(ownNotes);
      const pBad = await patch({ engineerId: foreignUser });
      const afterBad = await reportBy(ownNotes);
      const pNone = await patch({ engineerId: nowhere() });
      const pShapes = [];
      for (const [label, make] of ID_SHAPES) pShapes.push([label, await patch({ engineerId: make(foreignUser) })]);
      const kept = await reportBy(ownNotes);
      const pGate = await patch({ engineerId: ownEngineer2 });
      const moved = await reportBy(ownNotes);
      const gate = ok2xx(pGate) && moved?.engineer === ownEngineer2 ? pGate : { ...pGate, status: 0 };
      check(`ALLOWED (PATCH): the company's other member ${ownEngineer2} is accepted (200) and stored`, ok2xx(gate), `${said(pGate)}; stored ${moved?.engineer}`);
      check(`REFUSED (PATCH): company ${VICTIM}'s person is refused with a 4xx and the report keeps its engineer${gateNote(gate)}`, ok2xx(gate) && is4xx(pBad) && afterBad?.engineer === was?.engineer, `${said(pBad)}; engineer now ${afterBad?.engineer}`);
      check(`NOWHERE (PATCH): …exactly as a person who exists nowhere (the whole answer; no 5xx)${gateNote(gate)}`, ok2xx(gate) && answerOf(pBad, [foreignUser]) === answerOf(pNone) && is4xx(pNone), `${answerOf(pBad, [foreignUser]).slice(0, 300)} | ${answerOf(pNone).slice(0, 300)}`);
      for (const [label, res] of pShapes) check(`SHAPE (PATCH): engineerId ${label} is refused as invalid input (400 VALIDATION_ERROR; no 5xx)${gateNote(gate)}`, ok2xx(gate) && invalidInput(res), said(res));
      check('REFUSED (PATCH): …after every refusal the report still names its own engineer', kept?.engineer === was?.engineer, `engineer ${kept?.engineer}`);
      const pBoth = await patch({ engineerId: both });
      check(`ALLOWED (PATCH): a member whose home workspace is company ${VICTIM} is accepted as the engineer (membership, not home)`, ok2xx(pBoth) && (await reportBy(ownNotes))?.engineer === both, said(pBoth));
    }

    // A photo's uploader is the document's, never what the request says.
    const photoReport = async (label, uploadedBy) => {
      const notes = `${STAMP} DR-P ${label}`;
      const res = await create(notes, { photos: [{ ...webPhoto, uploadedBy }] });
      return { res, row: await reportBy(notes) };
    };
    const pForeign = await photoReport('uploader foreign', foreignUser);
    const pNowhere = await photoReport('uploader nowhere', nowhere());
    check(`photos[].uploadedBy = company ${VICTIM}'s person: the report is accepted with the document's own uploader (${pmId}), the victim's person is not stored`, ok2xx(pForeign.res) && pForeign.row && pForeign.row.photos.includes(pmId) && !pForeign.row.photos.includes(foreignUser), `${said(pForeign.res)}; photos ${pForeign.row?.photos?.slice(0, 300)}`);
    check('photos[].uploadedBy: …answered as for a person who exists nowhere, who is not stored either', ok2xx(pNowhere.res) && pNowhere.res.status === pForeign.res.status && pNowhere.row && pNowhere.row.photos.includes(pmId), `${said(pNowhere.res)}; photos ${pNowhere.row?.photos?.slice(0, 300)}`);

    // Photos that are not in the accepted shape, and links into another company's project.
    const photoGate = async (notes) => {
      const gate = await create(notes, { photos: [webPhoto] });
      const row = await reportById(gate.body?.data?.id);
      return ok2xx(gate) && row?.photos?.includes(ownDoc) ? gate : { ...gate, status: 0 };
    };
    const PHOTO_SHAPES = [
      ['photos ["id"] (a bare id is not a link)', (id) => ({ photos: [id] }), invalidInput, 'is refused as invalid input (400 VALIDATION_ERROR)'],
      ['photos [[{key:id}]]', (id) => ({ photos: [[{ key: id }]] }), invalidInput, 'is refused as invalid input (400 VALIDATION_ERROR)'],
      ['photos [{url:id}]', (id) => ({ photos: [{ url: id }] }), invalidInput, 'is refused as invalid input (400 VALIDATION_ERROR)'],
      ['photos [{key:id}]', (id) => ({ photos: [{ key: id }] }), (res) => res.status === 400 && res.body?.error?.code === 'INVALID_SITE_PHOTO_REFERENCE', 'is refused (400 INVALID_SITE_PHOTO_REFERENCE)'],
    ];
    for (const [label, make, expected, wording] of PHOTO_SHAPES) {
      const sentFor = {};
      const res = {};
      for (const [whose, id] of [['own', ownDoc], ['foreign', foreignDoc], ['nowhere', nowhere()]]) {
        if (whose === 'own' && label.startsWith('photos [{key')) continue; // the own document by key is the gate itself
        const notes = `${STAMP} DR-R ${label} ${whose}`;
        res[whose] = await create(notes, make(id));
        sentFor[whose] = id;
        res[`${whose}Stored`] = await reportBy(notes);
      }
      const gate = await photoGate(`${STAMP} DR-G ${label}`);
      check(`SHAPE (POST photos): ${label} naming company ${VICTIM}'s document ${wording} and stores nothing${gateNote(gate)}`, ok2xx(gate) && expected(res.foreign) && !res.foreignStored, said(res.foreign));
      check(`SHAPE (POST photos): ${label} — the own, the victim's and a nowhere id are answered alike${gateNote(gate)}`, ok2xx(gate) && answerOf(res.foreign, [sentFor.foreign]) === answerOf(res.nowhere, [sentFor.nowhere]) && (!res.own || answerOf(res.own, [sentFor.own]) === answerOf(res.nowhere, [sentFor.nowhere])) && !res.nowhereStored && !res.ownStored, `${answerOf(res.foreign, [sentFor.foreign]).slice(0, 200)} | ${answerOf(res.nowhere, [sentFor.nowhere]).slice(0, 200)}${res.own ? ` | own ${answerOf(res.own, [sentFor.own]).slice(0, 200)}` : ''}`);
    }
    const link = (project, doc) => `/api/v1/projects/${project}/site-reporting/uploads/${doc}`;
    const lForeign = await create(`${STAMP} DR-R link foreign`, { photos: [{ url: link(V.id, foreignDoc) }] });
    const lNowhereId = [nowhere(), nowhere()];
    const lNowhere = await create(`${STAMP} DR-R link nowhere`, { photos: [{ url: link(...lNowhereId) }] });
    const lOwnProject = await create(`${STAMP} DR-R link own project foreign doc`, { photos: [{ url: link(A.id, foreignDoc) }] });
    const lGate = await photoGate(`${STAMP} DR-G link`);
    check(`REFUSED (POST photos): a link into company ${VICTIM}'s project is refused with a 4xx, as a link into a project that exists nowhere (the whole answer)${gateNote(lGate)}`, ok2xx(lGate) && is4xx(lForeign) && answerOf(lForeign, [V.id, foreignDoc]) === answerOf(lNowhere, lNowhereId) && !(await reportBy(`${STAMP} DR-R link foreign`)), `${answerOf(lForeign, [V.id, foreignDoc]).slice(0, 200)} | ${answerOf(lNowhere, lNowhereId).slice(0, 200)}`);
    check(`REFUSED (POST photos): a link into the own project naming company ${VICTIM}'s document is refused with a 4xx and nothing is stored${gateNote(lGate)}`, ok2xx(lGate) && is4xx(lOwnProject) && !(await reportBy(`${STAMP} DR-R link own project foreign doc`)), said(lOwnProject));
  }

  // ══ 2. progress evidence: every shape, three paths ═══════════════════════
  section = '2 progress evidence';
  console.log('\n── 2. progress evidence: single, bulk and daily-report paths ──');
  if (runs()) {
    const PATHS = {
      single: (activity) => (evidenceField, evidence, notes) => pm('POST', `${AP}/activities/${activity}/progress`, { pctComplete: 7, progressMethod: 'percent', status: 'submitted', notes, [evidenceField]: evidence }),
      bulk: (activity) => (evidenceField, evidence, notes) => pm('POST', `${AP}/activities/bulk-progress`, { updates: [{ activityId: activity, pctComplete: 6, progressMethod: 'percent', status: 'submitted', notes, [evidenceField]: evidence }] }),
      daily: (activity, date) => (evidenceField, evidence, notes) => pm('POST', `${AP}/daily-reports`, { activityId: activity, date, shift: 'day', status: 'submitted', notes, progress: { method: 'percent', pctComplete: 4, notes, [evidenceField]: evidence } }),
    };
    const submissionsBy = async (notes) => q('select id::text as id, "evidenceJson"::text as evidence from "ProgressSubmission" where "projectId" = $1 and notes = $2', [A.id, notes]);
    const reportsBy = async (notes) => Number(await val('select count(*)::int from "DailyReport" where "projectId" = $1 and notes = $2', [A.id, notes]));
    const storedNothing = async (notes) => (await submissionsBy(notes)).length === 0 && (await reportsBy(notes)) === 0;

    // [label, evidence(id), field, expected kind]
    const SHAPES = [
      ['{photos:{key:id}}', (id) => ({ photos: { key: id } })],
      ['{photos:[[{key:id}]]}', (id) => ({ photos: [[{ key: id }]] })],
      ['{photos:["id"]}', (id) => ({ photos: [id] })],
      ['{documents:[{documentId:id}]}', (id) => ({ documents: [{ documentId: id }] })],
      ['{key:id}', (id) => ({ key: id })],
      ['{documentId:id, photos:[]}', (id) => ({ documentId: id, photos: [] })],
      ['{photos:[{id:id}]}', (id) => ({ photos: [{ id }] })],
      ['{photos:[{url:id}]}', (id) => ({ photos: [{ url: id }] })],
      ['{measurementSheet:id}', (id) => ({ measurementSheet: id })],
      ['{photos:[{key:id, extra:{id}}]}', (id) => ({ photos: [{ key: id, extra: { id } }] })],
      ['{photos:[{caption:[id]}]}', (id) => ({ photos: [{ caption: [id] }] })],
      ['{"<id>": "x"} (an id as a name)', (id) => ({ [id]: 'x' })],
      ['{key:"<id>.png"} (a key beside photos[], not an id alone)', (id) => ({ key: `${id}.png` })],
      ['{photos:[{documentRef:"<id>.png"}]} (a field a photo does not have)', (id) => ({ photos: [{ documentRef: `${id}.png` }] })],
      ['{photos:[{key:["id"]}]} (a document field that is not one text)', (id) => ({ photos: [{ key: [id] }] }), 'INVALID_SITE_PHOTO_REFERENCE'],
    ];
    const canonical = (id) => ({ notes: `PE3 ${STAMP} photographed on site`, photos: [{ key: id, url: webPhoto.url, name: `${stamp}.png`, type: 'photo' }] });

    for (const [pathName, makePath] of Object.entries(PATHS)) {
      const activity = await freshActivity(`EV-${pathName}`);
      const send = makePath(activity, dateIn(2022, pathName.length));
      const shaped = [];
      // Every shape, own / foreign / nowhere, before the gate.
      for (const [label, make, code = 'VALIDATION_ERROR'] of SHAPES) {
        const row = { label, code, res: {}, sent: {}, stored: {} };
        for (const [whose, id] of [['own', ownDoc], ['foreign', foreignDoc], ['nowhere', nowhere()]]) {
          const notes = `${STAMP}-R ${pathName} ${label} ${whose}`;
          row.res[whose] = await send('evidence', make(id), notes);
          row.sent[whose] = id;
          row.stored[whose] = !(await storedNothing(notes));
        }
        shaped.push(row);
      }
      // The well-shaped references that name no document of this project.
      const refs = [];
      const refCase = async (label, makeFor) => {
        const row = { label, res: {}, sent: {}, stored: {} };
        for (const [whose, ids] of [['foreign', makeFor.foreign], ['nowhere', makeFor.nowhere]]) {
          const notes = `${STAMP}-R ${pathName} ${label} ${whose}`;
          row.res[whose] = await send(makeFor.field || 'evidence', makeFor.evidence(...ids), notes);
          row.sent[whose] = ids;
          row.stored[whose] = !(await storedNothing(notes));
        }
        refs.push(row);
      };
      const n1 = nowhere();
      await refCase('photos[{key}]', { evidence: (id) => ({ photos: [{ key: id }] }), foreign: [foreignDoc], nowhere: [n1] });
      await refCase('photos[{documentId}] beside an own key', { evidence: (id) => ({ photos: [{ key: ownDoc, documentId: id }] }), foreign: [foreignDoc], nowhere: [nowhere()] });
      await refCase('photos[{storageKey}] = the victim document\'s storage key', { evidence: (id) => ({ photos: [{ storageKey: id }] }), foreign: [foreignDocRow.storageKey || foreignDoc], nowhere: [nowhere()] });
      await refCase('photos[{url}] = a link into the victim\'s project', { evidence: (p, d) => ({ photos: [{ url: `/api/v1/projects/${p}/site-reporting/uploads/${d}` }] }), foreign: [V.id, foreignDoc], nowhere: [nowhere(), nowhere()] });
      await refCase('photos[{url}] = a link into the victim\'s project naming the own document', { evidence: (p) => ({ photos: [{ url: `/api/v1/projects/${p}/site-reporting/uploads/${ownDoc}` }] }), foreign: [V.id], nowhere: [nowhere()] });
      await refCase('photos[{url}] = a link into the own project naming the victim\'s document', { evidence: (d) => ({ photos: [{ url: `/api/v1/projects/${A.id}/site-reporting/uploads/${d}` }] }), foreign: [foreignDoc], nowhere: [nowhere()] });
      await refCase('notes = a link into the victim\'s project', { evidence: (p, d) => ({ notes: `see /api/v1/projects/${p}/site-reporting/uploads/${d}` }), foreign: [V.id, foreignDoc], nowhere: [nowhere(), nowhere()] });
      await refCase('evidenceJson {photos:[{key}]} (beside the route\'s check)', { field: 'evidenceJson', evidence: (id) => ({ photos: [{ key: id }] }), foreign: [foreignDoc], nowhere: [nowhere()] });
      await refCase('evidenceJson ["id"] (a list in place of the object)', { field: 'evidenceJson', evidence: (id) => [id], foreign: [foreignDoc], nowhere: [nowhere()] });
      await refCase('evidenceJson "id" (text in place of the object)', { field: 'evidenceJson', evidence: (id) => id, foreign: [foreignDoc], nowhere: [nowhere()] });

      // The uploader of a photo is the document's: another company's person is not stored.
      const uploaderNotes = `${STAMP}-A ${pathName} uploader foreign`;
      const uploaderRes = await send('evidence', { photos: [{ ...webPhoto, uploadedBy: foreignUser }] }, uploaderNotes);
      const uploaderRows = await submissionsBy(uploaderNotes);
      const uploaderNowhereNotes = `${STAMP}-A ${pathName} uploader nowhere`;
      const uploaderNowhere = await send('evidence', { photos: [{ ...webPhoto, uploadedBy: nowhere() }] }, uploaderNowhereNotes);

      // The gate: the company's own document, as the product's clients send it, on the same activity.
      const gateNotes = `${STAMP}-G ${pathName}`;
      const gateRes = await send('evidence', canonical(ownDoc), gateNotes);
      const gateRows = await submissionsBy(gateNotes);
      const gate = ok2xx(gateRes) && gateRows.length === 1 && gateRows[0].evidence.includes(ownDoc) ? gateRes : { ...gateRes, status: 0 };
      check(`${pathName}: ALLOWED — the company's own document as the clients send it is accepted and stored as the evidence`, ok2xx(gate), `${said(gateRes)}; stored ${gateRows.map((r) => r.evidence).join(' ').slice(0, 200)}`);
      const webNotes = `${STAMP}-G ${pathName} upload answer`;
      const web = await send('evidence', { photos: [webPhoto] }, webNotes);
      check(`${pathName}: ALLOWED — the site-reporting form's own evidence (the upload's whole answer) is accepted and stored`, ok2xx(web) && (await submissionsBy(webNotes)).some((r) => r.evidence.includes(ownDoc)), said(web));

      for (const row of shaped) {
        check(`${pathName}: SHAPE ${row.label} naming company ${VICTIM}'s document is refused (400 ${row.code}) and stores nothing${gateNote(gate)}`, ok2xx(gate) && row.res.foreign.status === 400 && row.res.foreign.body?.error?.code === row.code && !row.stored.foreign, `${said(row.res.foreign)}${row.stored.foreign ? ' — STORED' : ''}`);
        check(`${pathName}: SHAPE ${row.label} — the own document, the victim's and a nowhere id are answered alike and none is stored${gateNote(gate)}`, ok2xx(gate) && answerOf(row.res.own, [row.sent.own]) === answerOf(row.res.foreign, [row.sent.foreign]) && answerOf(row.res.foreign, [row.sent.foreign]) === answerOf(row.res.nowhere, [row.sent.nowhere]) && !row.stored.own && !row.stored.nowhere, `own ${said(row.res.own)}${row.stored.own ? ' STORED' : ''} | foreign ${said(row.res.foreign)} | nowhere ${said(row.res.nowhere)}${row.stored.nowhere ? ' STORED' : ''}`);
      }
      for (const row of refs) {
        check(`${pathName}: REFUSED ${row.label} naming company ${VICTIM}'s document is refused with a 4xx and stores nothing${gateNote(gate)}`, ok2xx(gate) && is4xx(row.res.foreign) && !row.stored.foreign, `${said(row.res.foreign)}${row.stored.foreign ? ' — STORED' : ''}`);
        check(`${pathName}: NOWHERE ${row.label} — exactly as one that exists nowhere (the whole answer)${gateNote(gate)}`, ok2xx(gate) && answerOf(row.res.foreign, row.sent.foreign) === answerOf(row.res.nowhere, row.sent.nowhere) && !row.stored.nowhere, `${answerOf(row.res.foreign, row.sent.foreign).slice(0, 220)} | ${answerOf(row.res.nowhere, row.sent.nowhere).slice(0, 220)}`);
      }
      check(`${pathName}: photos[].uploadedBy = company ${VICTIM}'s person — accepted with the document's own uploader; the victim's person is not stored${gateNote(gate)}`, ok2xx(gate) && ok2xx(uploaderRes) && uploaderRows.length === 1 && uploaderRows[0].evidence.includes(pmId) && !uploaderRows[0].evidence.includes(foreignUser), `${said(uploaderRes)}; ${uploaderRows.map((r) => r.evidence).join(' ').slice(0, 300)}`);
      check(`${pathName}: photos[].uploadedBy — answered as for a person who exists nowhere${gateNote(gate)}`, ok2xx(gate) && uploaderNowhere.status === uploaderRes.status, `${said(uploaderRes)} | ${said(uploaderNowhere)}`);
    }

    // A bulk batch whose second update names the victim's document in another shape is refused whole.
    const activity = await freshActivity('EV-batch');
    const batchNotes = `${STAMP}-R bulk batch`;
    const mixed = await pm('POST', `${AP}/activities/bulk-progress`, {
      updates: [
        { activityId: activity, pctComplete: 8, progressMethod: 'percent', status: 'submitted', notes: batchNotes, evidence: canonical(ownDoc) },
        { activityId: activity, pctComplete: 9, progressMethod: 'percent', status: 'submitted', notes: batchNotes, evidence: { photos: { key: foreignDoc } } },
      ],
    });
    check('bulk: a batch whose second update names the victim\'s document in another shape is refused whole (400 VALIDATION_ERROR, nothing written)', invalidInput(mixed) && mixed.body?.error?.details?.batch?.index === 1 && (await storedNothing(batchNotes)), `${said(mixed)} ${JSON.stringify(mixed.body?.error?.details?.batch || {})}`);

    const leftovers = await q(`select 'ProgressSubmission' as t, count(*)::int as n from "ProgressSubmission" where "projectId" = $1 and notes like $2
      union all select 'DailyReport', count(*)::int from "DailyReport" where "projectId" = $1 and notes like $2`, [A.id, `${STAMP}-R%`]);
    check('no refused evidence request left a submission or a daily report', leftovers.every((r) => r.n === 0), leftovers.map((r) => `${r.t} ${r.n}`).join(', '));
  }

  // ══ 3. activity engineers: by membership ═══════════════════════════════════
  section = '3 activity engineers';
  console.log('\n── 3. activity engineers: membership, not the home workspace ──');
  if (runs()) {
    const activityByName = async (name) => one('select a.id::text as id, (select string_agg(aa."userId"::text, \',\' order by aa."userId") from "ActivityAssignment" aa where aa."activityId" = a.id) as engineers from "Activity" a where a."projectId" = $1 and a.name = $2', [A.id, name]);
    const create = (name, engineerIds) => planner('POST', `${AP}/activities`, { name, duration: 2, engineerIds });

    const bothName = `PE3 ${STAMP} ENG both`;
    const okBoth = await create(bothName, [both]);
    const bothRow = await activityByName(bothName);
    check(`ALLOWED (POST): a member of company ${ATTACKER} whose home workspace is company ${VICTIM} is an engineer (201, stored)`, okBoth.status === 201 && bothRow?.engineers === both, `${said(okBoth)}; engineers ${bothRow?.engineers}`);

    const refusedCreate = async (label, engineerIds) => {
      const name = `PE3 ${STAMP} ENG-R ${label}`;
      const res = await create(name, engineerIds);
      const stored = await activityByName(name);
      const gate = await create(name, [ownEngineer]);
      const gated = await activityByName(name);
      return { res, stored, gate: ok2xx(gate) && gated?.engineers === ownEngineer ? gate : { ...gate, status: 0 } };
    };
    const bad = await refusedCreate('foreign', [foreignUser]);
    const none = await refusedCreate('nowhere', [nowhere()]);
    const mixed = await refusedCreate('mixed', [ownEngineer, foreignUser]);
    check(`REFUSED (POST): company ${VICTIM}'s person is refused with a 4xx and no activity is stored${gateNote(bad.gate)}`, ok2xx(bad.gate) && is4xx(bad.res) && !bad.stored, `${said(bad.res)}${bad.stored ? `; STORED ${JSON.stringify(bad.stored)}` : ''}`);
    check(`NOWHERE (POST): …exactly as a person who exists nowhere (the whole answer)${gateNote(none.gate)}`, ok2xx(none.gate) && answerOf(bad.res, [foreignUser]) === answerOf(none.res) && !none.stored, `${answerOf(bad.res, [foreignUser])} | ${answerOf(none.res)}`);
    check(`REFUSED (POST): …and beside an own member, the same${gateNote(mixed.gate)}`, ok2xx(mixed.gate) && answerOf(mixed.res, [foreignUser]) === answerOf(none.res) && !mixed.stored, answerOf(mixed.res, [foreignUser]));

    // PATCH an own activity.
    const ownName = `PE3 ${STAMP} ENG own`;
    const own = await create(ownName, [ownEngineer]);
    const ownId = own.body?.data?.id;
    const patch = (engineerIds) => planner('PATCH', `${AP}/activities/${ownId}`, { engineerIds });
    const pBad = await patch([foreignUser]);
    const pNone = await patch([nowhere()]);
    const kept = await activityByName(ownName);
    const pOwn = await patch([ownEngineer2]);
    const movedOwn = await activityByName(ownName);
    const gate = ok2xx(pOwn) && movedOwn?.engineers === ownEngineer2 ? pOwn : { ...pOwn, status: 0 };
    check(`ALLOWED (PATCH): the company's other member ${ownEngineer2} is assigned (200, stored)`, ok2xx(gate), `${said(pOwn)}; engineers ${movedOwn?.engineers}`);
    const pBoth = await patch([ownEngineer, both]);
    const moved = await activityByName(ownName);
    const wanted = [ownEngineer, both].sort().join(',');
    check(`ALLOWED (PATCH): the member whose home workspace is company ${VICTIM} is assigned beside an own member (200, stored)`, ok2xx(pBoth) && moved?.engineers === wanted, `${said(pBoth)}; engineers ${moved?.engineers}`);
    check(`REFUSED (PATCH): company ${VICTIM}'s person is refused with a 4xx and the activity keeps its engineers${gateNote(gate)}`, ok2xx(gate) && is4xx(pBad) && kept?.engineers === ownEngineer, `${said(pBad)}; engineers ${kept?.engineers}`);
    check(`NOWHERE (PATCH): …exactly as a person who exists nowhere (the whole answer)${gateNote(gate)}`, ok2xx(gate) && answerOf(pBad, [foreignUser]) === answerOf(pNone), `${answerOf(pBad, [foreignUser])} | ${answerOf(pNone)}`);

    // The standing is the one held here: company A deactivates the person; their home company does not.
    const off = await pm('PATCH', `/users/${both}/deactivate`, {});
    const offName = `PE3 ${STAMP} ENG off`;
    const afterOff = await create(offName, [both]);
    const offNowhere = await create(`${offName} nowhere`, [nowhere()]);
    const offGate = await create(offName, [ownEngineer]);
    const standingHome = await memberOf(both, victimOrg);
    const accountStatus = await val('select status from "User" where id = $1', [both]);
    check(`a member company ${ATTACKER} has deactivated is refused as an engineer there, exactly as a person who exists nowhere${gateNote(offGate)}`, ok2xx(offGate) && ok2xx(off) && is4xx(afterOff) && answerOf(afterOff, [both]) === answerOf(offNowhere), `deactivate ${said(off)}; ${said(afterOff)} | ${said(offNowhere)}`);
    check(`…while the person stays an active member of their home company ${VICTIM}`, standingHome === 'active' && accountStatus === 'active', `membership ${standingHome}; account ${accountStatus}`);
    const pOff = await patch([both]);
    check(`…and cannot be assigned on an existing activity either${gateNote(gate)}`, ok2xx(gate) && is4xx(pOff) && answerOf(pOff, [both]) === answerOf(pNone), said(pOff));
  }

  // ══ 4. timesheets: crewId shapes ═══════════════════════════════════════════
  section = '4 timesheet crew';
  console.log('\n── 4. timesheets: crewId (POST), crewId and activityId filters ──');
  if (runs()) {
    const date = dateIn(2023, 101);
    const sheetBy = async (key) => one('select id::text as id, "crewId"::text as crew from "Timesheet" where "projectId" = $1 and "clientRequestId" = $2', [A.id, key]);
    const create = (key, crewId) => pm('POST', `${AP}/timesheets`, { date, crewId, clientRequestId: key, notes: `PE3 ${STAMP}` });
    const shaped = [];
    for (const [label, make] of ID_SHAPES) {
      const row = { label, res: {}, sent: {}, stored: {} };
      for (const [whose, id] of [['own', ownCrew], ['foreign', foreignCrew || nowhere()], ['nowhere', nowhere()]]) {
        const key = `${STAMP}-ts-${label.replace(/[^a-z0-9]+/gi, '')}-${whose}`;
        row.res[whose] = await create(key, make(id));
        row.sent[whose] = id;
        row.stored[whose] = Boolean(await sheetBy(key));
      }
      shaped.push(row);
    }
    const plainForeign = foreignCrew ? await create(`${STAMP}-ts-foreign`, foreignCrew) : null;
    const plainNowhere = await create(`${STAMP}-ts-nowhere`, nowhere());
    const gateKey = `${STAMP}-ts-own`;
    const gateRes = await create(gateKey, ownCrew);
    const gated = await sheetBy(gateKey);
    const gate = gateRes.status === 201 && gated?.crew === ownCrew ? gateRes : { ...gateRes, status: 0 };
    check('ALLOWED: a timesheet of the company\'s own crew is accepted (201) and stored with the crew', ok2xx(gate), `${said(gateRes)}; crew ${gated?.crew}`);
    for (const row of shaped) {
      check(`SHAPE: crewId ${row.label} is refused as invalid input (400 VALIDATION_ERROR; no 5xx) — own, the victim's and a nowhere crew alike — and stores nothing${gateNote(gate)}`, ok2xx(gate) && ['own', 'foreign', 'nowhere'].every((w) => invalidInput(row.res[w]) && !row.stored[w]) && answerOf(row.res.own, [row.sent.own]) === answerOf(row.res.foreign, [row.sent.foreign]) && answerOf(row.res.foreign, [row.sent.foreign]) === answerOf(row.res.nowhere, [row.sent.nowhere]), ['own', 'foreign', 'nowhere'].map((w) => `${w} ${said(row.res[w])}${row.stored[w] ? ' STORED' : ''}`).join(' | '));
    }
    if (plainForeign) {
      check(`REFUSED: company ${VICTIM}'s crew is refused with a 4xx, exactly as a crew that exists nowhere, and no timesheet is stored${gateNote(gate)}`, ok2xx(gate) && is4xx(plainForeign) && answerOf(plainForeign, [foreignCrew]) === answerOf(plainNowhere) && !(await sheetBy(`${STAMP}-ts-foreign`)), `${answerOf(plainForeign, [foreignCrew])} | ${answerOf(plainNowhere)}`);
    }
    // The list filters take one id: a repeated one is invalid input, never a 5xx.
    const tsList = await pm('GET', `${AP}/timesheets?crewId=${ownCrew}&crewId=${foreignCrew || nowhere()}`);
    check('GET /timesheets?crewId=…&crewId=… is refused as invalid input (400 VALIDATION_ERROR), never a 5xx', invalidInput(tsList), said(tsList));
    const drList = await pm('GET', `${AP}/daily-reports?activityId=${nowhere()}&activityId=${nowhere()}`);
    check('GET /daily-reports?activityId=…&activityId=… is refused as invalid input (400 VALIDATION_ERROR), never a 5xx', invalidInput(drList), said(drList));
    const drStatus = await pm('GET', `${AP}/daily-reports?status=draft&status=submitted`);
    check('GET /daily-reports?status=…&status=… is refused as invalid input (400 VALIDATION_ERROR), never a 5xx', invalidInput(drStatus), said(drStatus));
    for (const route of [`${AP}/timesheets?status=draft&status=approved`, `${AP}/timesheets/crews?status=active&status=inactive`, `${AP}/timesheets/workers?status=active&status=inactive`, `${AP}/timesheets/export.xlsx?status=draft&status=approved`]) {
      const res = await pm('GET', route);
      check(`GET ${route.replace(AP, '')} (a repeated status) is refused as invalid input (400 VALIDATION_ERROR), never a 5xx`, invalidInput(res), said(res));
    }
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
