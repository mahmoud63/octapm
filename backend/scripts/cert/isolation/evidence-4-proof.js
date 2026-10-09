'use strict';

/**
 * The CERT-2 proof of group evidence-4: the links and photo fields progress,
 * daily-report and site-diary evidence accepts, the ids a site record's lines
 * name, a site diary's people and photos, and what an edit re-checks.
 *
 *   $env:DATABASE_URL = $null; $env:CERT_INPROCESS = "1"; node scripts/cert/isolation/evidence-4-proof.js [attacker=067] [victim=068]
 *   … [--only=<section regex, e.g. "^2">] [--no-fingerprint]   (for mutation runs; a full run takes neither)
 *
 * What each did before the fix (reproduced in process, 067 -> 068):
 *   1. Any link holding /projects/<id>, on any host, was taken for a link into
 *      the product and every other identifier in it for a document: an
 *      Autodesk Construction Cloud folder link, an in-app link to the project's
 *      own RFI were refused 400 INVALID_SITE_PHOTO_REFERENCE — the web progress
 *      tab's evidence URL, a daily report's photo, on every path.
 *   2. The UAT runner's photo { fileName, fileUrl, mimeType, sizeBytes,
 *      description } was refused 400 VALIDATION_ERROR (its description).
 *   3. A daily report's update re-checked its stored photos when it sent none:
 *      a report whose site photo had since been cited by a change order (no
 *      longer `available`) could not be edited at all (PATCH {notes} 400).
 *   4. A daily report's equipment[].equipmentId and materials[].materialId were
 *      stored as given on create and update — another company's equipment and
 *      material, and ids that exist nowhere (201).
 *   5. A site diary stored its photos as given — another company's person as
 *      an uploader, a bare id as a link, a link into another company's project
 *      — and another company's person as its engineer (201) while one who
 *      exists nowhere answered 500 P2003; its equipment and material lines as
 *      given.
 *   6. A NUL character in evidence notes answers 500 (Postgres 22P05). That
 *      refusal belongs to the app-level guard another group adds: until it
 *      lands the check is reported DEPENDENT, not counted as passed.
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
 *   ALLOWED  what the product's clients send — links to other products and to
 *            the product's own pages, the own files, every client's photo
 *            shape — is accepted and stored as sent.
 * No answer is a 5xx (the DEPENDENT ones set aside and listed) or carries the
 * victim's ids (beyond the ones the request itself sent), names, addresses or
 * canaries; no row of the attacker company names a victim id afterwards that
 * did not before; the victim company's data does not change in any table
 * (fingerprint taken after the setup).
 *
 * Re-runnable: every record the checks write to is new (activities, uploads,
 * equipment, materials, reports, diaries, a person), every request carries a
 * fresh stamp. Exit 0 when every check holds, 2 otherwise.
 */

process.env.REQUEST_LOG_FORMAT = process.env.REQUEST_LOG_FORMAT || 'off';

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
const GROUP = 'evidence-4';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `EV4-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const stamp = STAMP.toLowerCase();
const INPROCESS = process.env.CERT_INPROCESS === '1';
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const results = [];
const answers = [];
const dependent = [];
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
/** JSON with its keys in order, so a stored jsonb compares with what was sent. */
const canonical = (value) => JSON.stringify(value, (_key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
const withMarker = (url, marker) => `${url}${url.includes('?') ? '&' : '?'}ev4=${marker}`;

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
        const { dependent: awaitsGuard = false, ...rest } = options;
        const res = await session.send(method, route, body, rest);
        answers.push({ route: `${role}@${code} ${method} ${route}`, status: res.status, text: res.text || '', sent: `${route} ${JSON.stringify(body ?? null)}`, dependent: awaitsGuard });
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
  const bothEmail = `ev4.both.${stamp}@shared.octapm-cert.test`;
  // Made in the victim's company the one way D-ID-1 allows: it invites the new e-mail, which accepts with its own name and password.
  const homeMade = await invitations.createByInvitation({ inviter: { send: vPm }, email: bothEmail, role: 'site_engineer', name: `EV4 both ${STAMP}`, password, db });
  const madeHome = homeMade.accepted || homeMade.invited;
  // The attacker's company invites the person; they accept with their own session (L38).
  const joined = await invitations.joinByInvitation({ inviter: api.as(`pm@c${ATTACKER}.octapm-cert.test`), email: bothEmail, role: 'site_engineer', via: 'users', name: `EV4 both ${STAMP}` });
  const madeHere = joined.accepted || joined.invited;
  const both = await userByEmail(bothEmail);
  const bothHome = await val('select "orgId"::text from "User" where id = $1', [both]);
  check(`setup: ${both} is a person whose home workspace is company ${VICTIM} and who is an active member of company ${ATTACKER} too`, Boolean(homeMade.userId) && joined.accepted?.status === 200 && bothHome === victimOrg && (await memberOf(both, attackerOrg)) === 'active' && (await memberOf(both, victimOrg)) === 'active', `${said(madeHome)} | ${said(madeHere)} | home ${bothHome}`);

  // Own site photos, uploaded now the way the site-reporting form uploads them
  // (several files in one request, as the form does: one upload of the hourly allowance).
  const form = new FormData();
  for (const tag of ['a', 'linked']) form.append('files', new Blob([PNG_1X1], { type: 'image/png' }), `${stamp}-${tag}.png`);
  const uploaded = await pm('POST', `${AP}/site-reporting/uploads`, undefined, { form });
  const [webPhoto = null, linkedPhoto = null] = Array.isArray(uploaded.body?.data) ? uploaded.body.data : [];
  check('setup: two site photos uploaded in one request', uploaded.status === 201 && Boolean(webPhoto && linkedPhoto), said(uploaded));
  const ownDoc = webPhoto?.documentId;
  const linkedDoc = linkedPhoto?.documentId;
  for (const doc of [ownDoc, linkedDoc]) {
    const row = doc ? await one('select "projectId"::text as project, "orgId"::text as org, "uploadedBy"::text as uploader, status from "ProjectDocument" where id = $1', [doc]) : null;
    check(`setup: a site photo ${doc} is uploaded to company ${ATTACKER}'s project by its pm (available)`, row?.project === A.id && row?.org === attackerOrg && row?.uploader === pmId && row?.status === 'available', JSON.stringify(row));
  }
  // The project's own files a link may name, and the victim's.
  const ownPhoto = await val('select id::text from "Photo" where "orgId" = $1 and "projectId" = $2 order by "createdAt" limit 1', [attackerOrg, A.id]);
  const ownRevision = await val('select id::text from "DocumentRevision" where "projectId" = $1 order by "createdAt" limit 1', [A.id]);
  const ownWorkflowDoc = await val(`select id::text from "ProjectDocument" where "projectId" = $1 and "orgId" = $2 and "documentType" = 'workflow_attachment' order by "createdAt" limit 1`, [A.id, attackerOrg]);
  const ownRfi = await val('select id::text from "Rfi" where "projectId" = $1 order by "createdAt" limit 1', [A.id]);
  check(`setup: company ${ATTACKER}'s project has a photo ${ownPhoto}, a document revision ${ownRevision}, a workflow document ${ownWorkflowDoc} and an RFI ${ownRfi}`, Boolean(ownPhoto && ownRevision && ownWorkflowDoc && ownRfi));
  const foreignDocRow = await one(`select id::text as id, "storageKey" as "storageKey", "orgId"::text as org, "projectId"::text as project, "fileName" as "fileName", "originalName" as "originalName" from "ProjectDocument" where "orgId" = $1 and "projectId" = $2 order by ("documentType" = 'site_photo') desc, "createdAt" limit 1`, [victimOrg, V.id]);
  const foreignDoc = foreignDocRow?.id;
  const foreignPhoto = await one('select id::text as id, "documentId"::text as doc from "Photo" where "orgId" = $1 and "projectId" = $2 order by "createdAt" limit 1', [victimOrg, V.id]);
  const foreignRevision = await val('select r.id::text from "DocumentRevision" r join "Project" p on p.id = r."projectId" where p."orgId" = $1 and r."projectId" = $2 order by r."createdAt" limit 1', [victimOrg, V.id]);
  const foreignMaterial = await val('select m.id::text from "ActivityMaterial" m join "Project" p on p.id = m."projectId" where p."orgId" = $1 and m."projectId" = $2 order by m."createdAt" limit 1', [victimOrg, V.id]);
  let victimEquipment = await val('select e.id::text from "Equipment" e join "Project" p on p.id = e."projectId" where p."orgId" = $1 and e."projectId" = $2 order by e."createdAt" limit 1', [victimOrg, V.id]);
  if (!victimEquipment) victimEquipment = (await must(vPm, 'POST', `/projects/${V.id}/equipment`, { name: `EV4 victim equipment ${STAMP}`, rateType: 'hourly', rate: 10 }, 'victim equipment')).id;
  check(`setup: document ${foreignDoc}, photo ${foreignPhoto?.id}, revision ${foreignRevision}, material ${foreignMaterial} and equipment ${victimEquipment} are company ${VICTIM}'s (project ${V.id})`, foreignDocRow?.org === victimOrg && Boolean(foreignPhoto?.id && foreignRevision && foreignMaterial && victimEquipment) && (await val('select "orgId"::text from "Project" where id = $1', [V.id])) === victimOrg);
  if (!ownDoc || !linkedDoc || !foreignDoc || !foreignPhoto || !ownPhoto || !ownRevision || !ownWorkflowDoc || !ownRfi || !foreignRevision || !foreignMaterial || !victimEquipment || !both) throw new Error('setup incomplete');

  // Fresh records of the attacker company.
  const freshActivity = async (tag) => (await must(planner, 'POST', `${AP}/activities`, { name: `EV4 ${STAMP} ${tag}`, duration: 3, engineerIds: [ownEngineer2] }, `activity ${tag}`)).id;
  const ownEquipment = (await must(pm, 'POST', `${AP}/equipment`, { name: `EV4 ${STAMP} crane`, rateType: 'hourly', rate: 12 }, 'own equipment')).id;
  const materialActivity = await freshActivity('MAT');
  const ownMaterial = (await must(pm, 'POST', `${AP}/activities/${materialActivity}/materials`, { name: `EV4 ${STAMP} cement`, unit: 'BAG', qty: 5 }, 'own material'))?.id;
  check(`setup: equipment ${ownEquipment} and material ${ownMaterial} are new records of company ${ATTACKER}'s project`, (await val('select "projectId"::text from "Equipment" where id = $1', [ownEquipment])) === A.id && (await val('select "projectId"::text from "ActivityMaterial" where id = $1', [ownMaterial])) === A.id);
  const dateIn = (year, salt) => new Date(Date.UTC(year, 0, 1) + ((parseInt(stamp.slice(-4), 16) + salt) % 360) * 86_400_000).toISOString().slice(0, 10);

  // ── what no answer may carry, and no row of the attacker may name ─────────
  const victimIds = [foreignUser, foreignDoc, foreignDocRow.storageKey, V.id, foreignPhoto.id, foreignPhoto.doc, foreignRevision, foreignMaterial, victimEquipment, victimOrg].filter(Boolean);
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

  // ── the five doors evidence comes in by, and what each stored ─────────────
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
  const acts = {};
  const makeDoors = async () => {
    for (const name of ['single', 'bulk', 'daily-progress', 'daily-photos']) acts[name] = await freshActivity(`door ${name}`);
    return [
      ['progress (single)', (photo, marker) => pm('POST', `${AP}/activities/${acts.single}/progress`, { pctComplete: 7, progressMethod: 'percent', status: 'submitted', notes: `${STAMP} ${marker}`, evidence: { photos: [photo] } }), (s) => s.submissions === 1],
      ['progress (bulk)', (photo, marker) => pm('POST', `${AP}/activities/bulk-progress`, { updates: [{ activityId: acts.bulk, pctComplete: 6, progressMethod: 'percent', status: 'submitted', notes: `${STAMP} ${marker}`, evidence: { photos: [photo] } }] }), (s) => s.submissions === 1],
      ['daily report progress', (photo, marker) => pm('POST', `${AP}/daily-reports`, { activityId: acts['daily-progress'], date: dateIn(2022, 7), shift: 'day', status: 'submitted', notes: `${STAMP} ${marker}`, progress: { method: 'percent', pctComplete: 4, notes: `${STAMP} ${marker}`, evidence: { photos: [photo] } } }), (s) => s.submissions === 1 && s.reports === 1],
      ['daily report photos', (photo, marker) => pm('POST', `${AP}/daily-reports`, { activityId: acts['daily-photos'], date: dateIn(2022, 8), shift: 'day', status: 'draft', notes: `${STAMP} ${marker}`, photos: [photo] }), (s) => s.reportPhotos === 1],
      ['site diary photos', (photo, marker) => pm('POST', `${AP}/site-diaries`, { date: dateIn(2022, 9), shift: 'day', status: 'draft', notes: `${STAMP} ${marker}`, photos: [photo] }), (s) => s.diaryPhotos === 1],
    ];
  };

  // ══ 1. links that are not the product's files, and the own files ══════════
  section = '1 legitimate links';
  console.log('\n── 1. links to other products, to the product\'s pages and to the own files: accepted and stored ──');
  let DOORS = null;
  if (runs()) {
    DOORS = await makeDoors();
    const LINKS = [
      ['an Autodesk Construction Cloud folder link', `https://acc.autodesk.com/docs/files/projects/${nowhere()}?folderUrn=urn:adsk.wipprod:fs.folder:co.${stamp}&viewModel=detail&moduleId=folders`],
      ['an in-app link to the project\'s own RFI', `https://app.octapm.test/o/${attacker.slug || 'acme'}/projects/${A.id}/rfi/${ownRfi}`],
      ['an in-app link to an activity of the project', `https://app.octapm.test/projects/${A.id}/schedule?activity=${acts.single}`],
      ['the own site photo\'s upload link, absolute on the API host', `https://api.octapm.test/api/v1/projects/${A.id}/site-reporting/uploads/${ownDoc}`],
      ['the own photo\'s file link, below the API base (the mobile client)', `/projects/${A.id}/photos/${ownPhoto}/file`],
      ['the own revision\'s download link', `/api/v1/projects/${A.id}/doc-control/revisions/${ownRevision}/download`],
      ['the own workflow document\'s download link', `/api/v1/projects/${A.id}/attachments/documents/${ownWorkflowDoc}`],
      ['the own workflow document\'s upload link', `/api/v1/projects/${A.id}/workflow/uploads/${ownWorkflowDoc}`],
    ];
    for (const [doorName, send, storedOk] of DOORS) {
      for (const [label, url] of LINKS) {
        const marker = nextMarker();
        const sent = withMarker(url, marker);
        const res = await send({ url: sent }, marker);
        const s = await storedBy(marker);
        check(`ALLOWED ${doorName}: ${label} is accepted and stored as written`, ok2xx(res) && storedOk(s), `${said(res)}; stored ${JSON.stringify(s)}`);
      }
    }
  }

  // ══ 2. the product's file links naming another company's file ═════════════
  section = '2 file links refused';
  console.log('\n── 2. the product\'s file links naming another company\'s file: refused as nowhere, nothing stored ──');
  if (runs()) {
    if (!DOORS) DOORS = await makeDoors();
    // [label, photo(link ids…, marker), foreign ids, own ids (the gate)]
    const upload = (p, d) => `/api/v1/projects/${p}/site-reporting/uploads/${d}`;
    const CASES = [
      ['a site-reporting upload link into the own project', (m, d) => ({ url: withMarker(upload(A.id, d), m) }), [foreignDoc], [ownDoc]],
      ['an upload link into the victim\'s project, absolute on the API host', (m, p, d) => ({ url: withMarker(`https://api.octapm.test${upload(p, d)}`, m) }), [V.id, foreignDoc], [A.id, ownDoc]],
      ['a photo file link (the mobile client\'s path)', (m, id) => ({ url: withMarker(`/projects/${A.id}/photos/${id}/file`, m) }), [foreignPhoto.id], [ownPhoto]],
      ['a revision download link on the API host', (m, id) => ({ url: withMarker(`https://api.octapm.test/api/v1/projects/${A.id}/doc-control/revisions/${id}/download`, m) }), [foreignRevision], [ownRevision]],
      ['an attachment document download link', (m, id) => ({ url: withMarker(`/api/v1/projects/${A.id}/attachments/documents/${id}`, m) }), [foreignDoc], [ownWorkflowDoc]],
      ['a workflow upload link on another host, in a caption', (m, id) => ({ url: withMarker('https://example.test/site.jpg', m), caption: `see https://files.example.test/api/v1/projects/${A.id}/workflow/uploads/${id}` }), [foreignDoc], [ownWorkflowDoc]],
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
        check(`REFUSED ${doorName}: ${label} naming company ${VICTIM}'s file is refused with a 4xx and nothing is stored${gateNote(gate)}`, ok2xx(gate) && is4xx(bad) && nothing(badStored), `${said(bad)}; stored ${JSON.stringify(badStored)}`);
        check(`NOWHERE ${doorName}: ${label} — exactly as one naming a file that exists nowhere (the whole answer)${gateNote(gate)}`, ok2xx(gate) && answerOf(bad, foreignIds) === answerOf(none, noneIds) && nothing(noneStored), `${answerOf(bad, foreignIds).slice(0, 240)} | ${answerOf(none, noneIds).slice(0, 240)}`);
      }
    }
  }

  // ══ 3. every client's shape ════════════════════════════════════════════════
  section = '3 client shapes';
  console.log('\n── 3. what each client sends: accepted and stored ──');
  if (runs()) {
    const submissionsLike = async (text) => q('select id::text as id, status, "evidenceJson" as evidence from "ProgressSubmission" where "projectId" = $1 and "evidenceJson"::text like $2', [A.id, `%${text}%`]);
    const runId = `ev4-${stamp}`;
    const evidenceAttachment = () => [{ fileName: `uat-evidence-${runId}.jpg`, fileUrl: 'https://example.com/uat-evidence.jpg', mimeType: 'image/jpeg', sizeBytes: 1024, description: 'Synthetic UAT evidence reference' }];

    // The UAT runner (e2e/uat/run-uat-regression.mjs runScheduleCostIpcFlow), as it sends them.
    const uatActivity = await freshActivity('UAT');
    const uatBulk = await pm('POST', `${AP}/activities/bulk-progress`, { updates: [{ activityId: uatActivity, pctComplete: 80, actualCost: 82000, progressMethod: 'percent', status: 'submitted', source: 'manual', notes: 'UAT progress update.', evidence: { photos: evidenceAttachment() } }] });
    const uatRows = await submissionsLike(`uat-evidence-${runId}`);
    check('ALLOWED UAT bulk progress: the runner\'s photo { fileName, fileUrl, mimeType, sizeBytes, description } is accepted (submitted >= 1) and stored as sent', ok2xx(uatBulk) && uatBulk.body?.data?.submitted >= 1 && uatRows.length === 1 && canonical(uatRows[0].evidence) === canonical({ photos: evidenceAttachment() }), `${said(uatBulk)}; stored ${JSON.stringify(uatRows.map((r) => r.evidence)).slice(0, 300)}`);
    const uatSubmission = uatBulk.body?.data?.submissions?.[0];
    const uatApproved = uatSubmission ? await pm('POST', `${AP}/activities/${uatActivity}/progress-submissions/${uatSubmission.id}/approve`, {}) : { status: 0 };
    check('ALLOWED UAT: …and the submission is approved as the runner approves it', ok2xx(uatApproved) && uatApproved.body?.data?.status === 'approved', said(uatApproved));
    const uatReport = await pm('POST', `${AP}/daily-reports`, {
      activityId: uatActivity,
      date: dateIn(2026, 3),
      shift: 'day',
      pctProgress: 80,
      weather: { summary: 'Clear', condition: 'clear', temperatureC: 22, delayImpact: false },
      manpower: [{ trade: 'Concrete', workers: 8, hours: 8 }],
      materials: [{ name: 'Concrete', qty: 35, unit: 'm3' }],
      equipment: [{ name: 'Pump', hours: 6 }],
      issues: [{ title: 'Access coordination', severity: 'low', status: 'closed' }],
      photos: evidenceAttachment(),
      notes: 'UAT daily report.',
      clientRequestId: `uat-${runId}`,
      clientCreatedAt: '2026-02-15T08:00:00.000Z',
      deviceId: 'uat-tablet-01',
      status: 'submitted',
    });
    check('ALLOWED UAT daily report: the runner\'s report (its photo shape included) is accepted (201) and stored', uatReport.status === 201 && Boolean(await val('select id::text from "DailyReport" where "projectId" = $1 and "clientRequestId" = $2', [A.id, `uat-${runId}`])), said(uatReport));
    const uatReportApproved = uatReport.body?.data?.id ? await pm('POST', `${AP}/daily-reports/${uatReport.body.data.id}/approve`, {}) : { status: 0 };
    check('ALLOWED UAT daily report: …and approved as the runner approves it', ok2xx(uatReportApproved) && uatReportApproved.body?.data?.status === 'approved', said(uatReportApproved));
    const uatSingle = await pm('POST', `${AP}/activities/${uatActivity}/progress`, { pctComplete: 85, progressMethod: 'percent', status: 'submitted', notes: `${STAMP} UAT single`, evidence: { photos: evidenceAttachment() } });
    // Read by its own notes: since evidence-lines-5 the daily report above keeps the runner's photo, so its linked
    // submission's evidence carries the runner's file name too, and a count by that name no longer picks this one out.
    const uatSingleRows = await q('select "evidenceJson" as evidence from "ProgressSubmission" where "projectId" = $1 and notes = $2', [A.id, `${STAMP} UAT single`]);
    check('ALLOWED UAT photo shape on the single progress path is accepted and stored as sent', ok2xx(uatSingle) && uatSingleRows.length === 1 && canonical(uatSingleRows[0].evidence) === canonical({ photos: evidenceAttachment() }), `${said(uatSingle)}; stored ${JSON.stringify(uatSingleRows.map((r) => r.evidence)).slice(0, 300)}`);

    // The web site-reporting form (site-reporting-dashboard.tsx): the upload's answer as photos, picked equipment.
    const webActivity = await freshActivity('WEB');
    const meta = (kind) => ({ clientRequestId: `${kind}-${crypto.randomUUID()}`, clientCreatedAt: new Date().toISOString(), deviceId: `web-${stamp}` });
    const dailyMeta = meta('daily');
    const webDaily = await pm('POST', `${AP}/daily-reports`, {
      activityId: webActivity,
      date: dateIn(2026, 5),
      shift: 'day',
      pctProgress: 10,
      weather: { summary: 'Clear' },
      manpower: [{ trade: 'crew', workers: 6, hours: 8 }],
      equipment: [{ equipmentId: ownEquipment, name: 'crane', hours: 3 }, { name: 'site equipment', hours: 1 }],
      materials: [{ name: 'material', qty: 2, unit: 'unit' }],
      issues: [{ description: `${STAMP} access`, severity: 'medium', status: 'open' }],
      photos: [webPhoto],
      notes: `${STAMP} web daily`,
      status: 'submitted',
      ...dailyMeta,
      progress: { method: 'percent', pctComplete: 10, evidence: { photos: [webPhoto] } },
    });
    const webDailyRow = await one('select id::text as id, "equipmentJson"::text as equipment, "photosJson"::text as photos from "DailyReport" where "projectId" = $1 and "clientRequestId" = $2', [A.id, dailyMeta.clientRequestId]);
    const webDailyEvidence = webDailyRow ? await val('select "evidenceJson"::text from "ProgressSubmission" where "dailyReportId" = $1', [webDailyRow.id]) : null;
    check('ALLOWED web daily report: the upload\'s answer as photos and as progress evidence, the project\'s equipment picked — accepted (201) and stored', webDaily.status === 201 && webDailyRow?.equipment.includes(ownEquipment) && webDailyRow?.photos.includes(ownDoc) && String(webDailyEvidence).includes(ownDoc), `${said(webDaily)}; ${JSON.stringify(webDailyRow).slice(0, 300)}`);
    const diaryMeta = meta('diary');
    const webDiary = await pm('POST', `${AP}/site-diaries`, {
      date: dateIn(2026, 6),
      shift: 'day',
      weather: 'Clear',
      weatherDetails: { summary: 'Clear' },
      workers: 12,
      visitors: '',
      workDone: `${STAMP} slab`,
      issues: '',
      issueItems: [],
      instructions: '',
      manpower: [{ trade: 'crew', workers: 4, hours: 8 }],
      equipment: [{ equipmentId: ownEquipment, name: 'crane', hours: 2 }],
      materials: [{ name: 'material', qty: 2, unit: 'unit' }],
      photos: [webPhoto],
      notes: `${STAMP} web diary`,
      status: 'submitted',
      ...diaryMeta,
    });
    const webDiaryRow = await one('select "equipmentJson"::text as equipment, "photosJson"::text as photos, "engineerId"::text as engineer from "SiteDiary" where "projectId" = $1 and "clientRequestId" = $2', [A.id, diaryMeta.clientRequestId]);
    check('ALLOWED web site diary: the upload\'s answer as photos, the project\'s equipment picked — accepted (201) and stored, the uploader the document\'s', webDiary.status === 201 && webDiaryRow?.equipment.includes(ownEquipment) && webDiaryRow?.photos.includes(ownDoc) && webDiaryRow?.photos.includes(pmId), `${said(webDiary)}; ${JSON.stringify(webDiaryRow).slice(0, 300)}`);

    // The web progress tab (progress-tab.tsx): a typed evidence URL, and its daily report.
    const tabMarker = nextMarker();
    const tabUrl = withMarker(`https://acc.autodesk.com/docs/files/projects/${nowhere()}?folderUrn=urn:adsk.wipprod:fs.folder:co.x`, tabMarker);
    const tab = await pm('POST', `${AP}/activities/${webActivity}/progress`, { method: 'percent', pctComplete: 12, inspectionStatus: 'pending', evidence: { photos: [{ url: tabUrl }] } });
    const tabRows = await submissionsLike(tabMarker);
    check('ALLOWED web progress tab: { method, pctComplete, inspectionStatus, evidence: { photos: [{ url }] } } with a typed link is accepted and stored as typed', ok2xx(tab) && tabRows.length === 1 && canonical(tabRows[0].evidence) === canonical({ photos: [{ url: tabUrl }] }), said(tab));
    const tabDailyMarker = nextMarker();
    const tabDaily = await pm('POST', `${AP}/daily-reports`, {
      activityId: webActivity,
      date: dateIn(2026, 7),
      pctProgress: 15,
      manpower: [{ trade: 'crew', workers: 5, hours: 8 }],
      equipment: [{ name: 'site equipment', hours: 4 }],
      materials: [{ name: 'rebar', qty: 3, unit: 'unit' }],
      photos: [{ url: withMarker(`https://app.octapm.test/projects/${A.id}/rfi/${ownRfi}`, tabDailyMarker) }],
      notes: `${STAMP} tab daily`,
    });
    check('ALLOWED web progress tab daily report: a typed photo link into the product\'s own pages is accepted (201) and stored', tabDaily.status === 201 && (await storedBy(tabDailyMarker)).reportPhotos === 1, said(tabDaily));

    // The certification drivers (drivers/progress.js, drivers/client-billing.js).
    const driverActivity = await freshActivity('DRV');
    const driverEvidence = { notes: `${STAMP} photographed on site`, photos: [{ key: webPhoto.key, url: webPhoto.url, name: webPhoto.filename, type: 'photo' }] };
    const driver = await pm('POST', `${AP}/activities/${driverActivity}/progress`, { pctComplete: 9, progressMethod: 'percent', status: 'submitted', notes: `${STAMP} driver`, evidence: driverEvidence });
    const driverRows = await submissionsLike(`${STAMP} photographed on site`);
    check('ALLOWED driver evidence { notes, photos: [{ key, url, name, type }] } is accepted and stored as sent', ok2xx(driver) && driverRows.length === 1 && canonical(driverRows[0].evidence) === canonical(driverEvidence), said(driver));
    const billingEvidence = { measurementSheet: `MS-${STAMP}`, method: "joint measurement with the client's QS" };
    const billing = await pm('POST', `${AP}/activities/${driverActivity}/progress`, { pctComplete: 10, progressMethod: 'percent', status: 'submitted', source: 'manual', notes: `${STAMP} billing`, evidence: billingEvidence });
    check('ALLOWED driver evidence { measurementSheet, method } is accepted and stored as sent', ok2xx(billing) && (await submissionsLike(`MS-${STAMP}`)).length === 1, said(billing));
    const driverReport = await pm('POST', `${AP}/daily-reports`, { activityId: driverActivity, date: dateIn(2026, 9), shift: 'night', photos: [{ key: webPhoto.key, filename: webPhoto.filename, caption: `${STAMP} progress photo` }], notes: `${STAMP} driver report`, status: 'draft' });
    check('ALLOWED driver daily report photos [{ key, filename, caption }] are accepted (201) and stored', driverReport.status === 201 && (await val('select "photosJson"::text from "DailyReport" where "projectId" = $1 and notes = $2', [A.id, `${STAMP} driver report`]))?.includes(ownDoc), said(driverReport));

    // The mobile client (mobile/src/api/site-types.ts ProgressInput) sends no evidence.
    const mobile = await pm('POST', `${AP}/activities/${driverActivity}/progress`, { pctComplete: 11, notes: `${STAMP} mobile`, status: 'submitted', source: 'mobile', progressMethod: 'percent' });
    check('ALLOWED mobile ProgressInput { pctComplete, notes, status, source, progressMethod } is accepted', ok2xx(mobile), said(mobile));
  }

  // ══ 4. equipment and material lines ════════════════════════════════════════
  section = '4 equipment and material lines';
  console.log('\n── 4. daily reports and site diaries: equipment[].equipmentId / .id and materials[].materialId ──');
  if (runs()) {
    const lineActivity = await freshActivity('LINES');
    const reportBy = async (notes) => one('select id::text as id, "equipmentJson"::text as equipment, "materialsJson"::text as materials from "DailyReport" where "projectId" = $1 and notes = $2 order by "createdAt" limit 1', [A.id, notes]);
    const diaryBy = async (notes) => one('select id::text as id, "equipmentJson"::text as equipment, "materialsJson"::text as materials from "SiteDiary" where "projectId" = $1 and notes = $2 order by "createdAt" limit 1', [A.id, notes]);
    const KINDS = [
      ['equipment[].equipmentId', (id) => ({ equipment: [{ equipmentId: id, name: 'crane', hours: 2 }] }), victimEquipment, ownEquipment, 'equipment'],
      ['equipment[].id (the approval reads it too)', (id) => ({ equipment: [{ id, name: 'crane', hours: 2 }] }), victimEquipment, ownEquipment, 'equipment'],
      ['materials[].materialId', (id) => ({ materials: [{ materialId: id, name: 'cement', qty: 2, unit: 'bag' }] }), foreignMaterial, ownMaterial, 'materials'],
    ];
    const SHAPES = [
      ['equipment[].equipmentId ["id"]', (id) => ({ equipment: [{ equipmentId: [id], hours: 1 }] })],
      ['equipment[].id ["id"]', (id) => ({ equipment: [{ id: [id], hours: 1 }] })],
      ['materials[].materialId ["id"]', (id) => ({ materials: [{ materialId: [id], qty: 1 }] })],
    ];
    const RECORDS = [
      ['daily report', (notes, lines) => pm('POST', `${AP}/daily-reports`, { activityId: lineActivity, date: dateIn(2023, 31), shift: 'day', status: 'draft', notes, ...lines }), reportBy, async () => (await must(pm, 'POST', `${AP}/daily-reports`, { activityId: lineActivity, date: dateIn(2023, 32), status: 'draft', notes: `${STAMP} LINES patch ${nextMarker()}` }, 'report to patch')).id, (id, lines) => pm('PATCH', `${AP}/daily-reports/${id}`, lines), async (id) => one('select "equipmentJson"::text as equipment, "materialsJson"::text as materials from "DailyReport" where id = $1', [id])],
      ['site diary', (notes, lines) => pm('POST', `${AP}/site-diaries`, { date: dateIn(2023, 33), shift: 'day', status: 'draft', notes, ...lines }), diaryBy, async () => (await must(pm, 'POST', `${AP}/site-diaries`, { date: dateIn(2023, 34), status: 'draft', notes: `${STAMP} LINES patch ${nextMarker()}` }, 'diary to patch')).id, (id, lines) => pm('PATCH', `${AP}/site-diaries/${id}`, lines), async (id) => one('select "equipmentJson"::text as equipment, "materialsJson"::text as materials from "SiteDiary" where id = $1', [id])],
    ];
    for (const [record, create, byNotes, makeOwn, patch, read] of RECORDS) {
      for (const [label, lines, foreignId, ownId, column] of KINDS) {
        // POST: refused ones store nothing; the same notes with the own record are then accepted (the gate).
        const notes = `${STAMP} LINES ${record} ${label} ${nextMarker()}`;
        const bad = await create(notes, lines(foreignId));
        const badStored = await byNotes(notes);
        const noneId = nowhere();
        const none = await create(notes, lines(noneId));
        const noneStored = await byNotes(notes);
        const gateRes = await create(notes, lines(ownId));
        const gated = await byNotes(notes);
        const gate = gateRes.status === 201 && gated?.[column]?.includes(ownId) ? gateRes : { ...gateRes, status: 0 };
        check(`ALLOWED (POST ${record}): ${label} naming the project's own record is accepted (201) and stored`, ok2xx(gate), `${said(gateRes)}; stored ${JSON.stringify(gated)}`);
        check(`REFUSED (POST ${record}): ${label} naming company ${VICTIM}'s record is refused with a 4xx and nothing is stored${gateNote(gate)}`, ok2xx(gate) && is4xx(bad) && !badStored, `${said(bad)}${badStored ? `; STORED ${JSON.stringify(badStored)}` : ''}`);
        check(`NOWHERE (POST ${record}): ${label} — exactly as a record that exists nowhere (the whole answer)${gateNote(gate)}`, ok2xx(gate) && answerOf(bad, [foreignId]) === answerOf(none, [noneId]) && !noneStored, `${answerOf(bad, [foreignId]).slice(0, 260)} | ${answerOf(none, [noneId]).slice(0, 260)}`);
        // PATCH on an own draft: refused ones change nothing; the own record is then accepted.
        const draftId = await makeOwn();
        const was = await read(draftId);
        const pBad = await patch(draftId, lines(foreignId));
        const pNoneId = nowhere();
        const pNone = await patch(draftId, lines(pNoneId));
        const kept = await read(draftId);
        const pGate = await patch(draftId, lines(ownId));
        const moved = await read(draftId);
        const gate2 = ok2xx(pGate) && moved?.[column]?.includes(ownId) ? pGate : { ...pGate, status: 0 };
        check(`ALLOWED (PATCH ${record}): ${label} naming the project's own record is accepted and stored`, ok2xx(gate2), `${said(pGate)}; ${JSON.stringify(moved)}`);
        check(`REFUSED (PATCH ${record}): ${label} naming company ${VICTIM}'s record is refused with a 4xx and the lines are unchanged${gateNote(gate2)}`, ok2xx(gate2) && is4xx(pBad) && canonical(kept) === canonical(was), `${said(pBad)}; ${JSON.stringify(kept)}`);
        check(`NOWHERE (PATCH ${record}): ${label} — exactly as a record that exists nowhere${gateNote(gate2)}`, ok2xx(gate2) && answerOf(pBad, [foreignId]) === answerOf(pNone, [pNoneId]), `${answerOf(pBad, [foreignId]).slice(0, 260)} | ${answerOf(pNone, [pNoneId]).slice(0, 260)}`);
      }
      for (const [label, lines] of SHAPES) {
        const res = {};
        for (const [whose, id] of [['own', label.startsWith('materials') ? ownMaterial : ownEquipment], ['foreign', label.startsWith('materials') ? foreignMaterial : victimEquipment], ['nowhere', nowhere()]]) {
          const notes = `${STAMP} LINES-S ${record} ${label} ${whose} ${nextMarker()}`;
          res[whose] = { res: await create(notes, lines(id)), stored: await byNotes(notes), id };
        }
        check(`SHAPE (POST ${record}): ${label} is refused as invalid input (400 VALIDATION_ERROR) — own, the victim's and a nowhere record alike — and stores nothing`, ['own', 'foreign', 'nowhere'].every((w) => invalidInput(res[w].res) && !res[w].stored) && answerOf(res.own.res, [res.own.id]) === answerOf(res.foreign.res, [res.foreign.id]) && answerOf(res.foreign.res, [res.foreign.id]) === answerOf(res.nowhere.res, [res.nowhere.id]), ['own', 'foreign', 'nowhere'].map((w) => `${w} ${said(res[w].res)}${res[w].stored ? ' STORED' : ''}`).join(' | '));
      }
    }

    // The approval still checks the equipment a report names (and posts the own equipment).
    const doomed = (await must(pm, 'POST', `${AP}/equipment`, { name: `EV4 ${STAMP} doomed`, rateType: 'hourly', rate: 5 }, 'equipment to delete')).id;
    const approveActivity = await freshActivity('APPROVE');
    const okReport = await pm('POST', `${AP}/daily-reports`, { activityId: approveActivity, date: dateIn(2023, 41), status: 'submitted', notes: `${STAMP} approve own`, equipment: [{ equipmentId: ownEquipment, name: 'crane', hours: 2 }] });
    const okApproved = okReport.body?.data?.id ? await pm('POST', `${AP}/daily-reports/${okReport.body.data.id}/approve`, {}) : { status: 0 };
    const posted = okReport.body?.data?.id ? await val('select "equipmentId"::text from "ActivityEquipmentUsage" where "dailyReportId" = $1', [okReport.body.data.id]) : null;
    check('ALLOWED approval: a report naming the project\'s own equipment is approved and its usage posted against that equipment', ok2xx(okApproved) && okApproved.body?.data?.status === 'approved' && posted === ownEquipment, `${said(okReport)} | ${said(okApproved)}; posted ${posted}`);
    const laterReport = await pm('POST', `${AP}/daily-reports`, { activityId: approveActivity, date: dateIn(2023, 42), status: 'submitted', notes: `${STAMP} approve deleted`, equipment: [{ equipmentId: doomed, name: 'doomed', hours: 2 }] });
    const deleted = await pm('DELETE', `${AP}/equipment/${doomed}`);
    const refusedApproval = laterReport.body?.data?.id ? await pm('POST', `${AP}/daily-reports/${laterReport.body.data.id}/approve`, {}) : { status: 0 };
    const stillSubmitted = laterReport.body?.data?.id ? await val('select status from "DailyReport" where id = $1', [laterReport.body.data.id]) : null;
    check('KEPT approval check: a report whose equipment has since been deleted is refused at approval (400 EQUIPMENT_USAGE_LINK_INVALID) and stays submitted', laterReport.status === 201 && ok2xx(deleted) && refusedApproval.status === 400 && refusedApproval.body?.error?.code === 'EQUIPMENT_USAGE_LINK_INVALID' && stillSubmitted === 'submitted', `${said(laterReport)} | delete ${said(deleted)} | ${said(refusedApproval)}; status ${stillSubmitted}`);
  }

  // ══ 5. site diaries: the engineer and the photos ═══════════════════════════
  section = '5 site diary people and photos';
  console.log('\n── 5. site diaries: engineerId (POST, PATCH), photos[].uploadedBy, photo shapes ──');
  if (runs()) {
    const diaryBy = async (notes) => one('select id::text as id, "engineerId"::text as engineer, "photosJson"::text as photos from "SiteDiary" where "projectId" = $1 and notes = $2 order by "createdAt" limit 1', [A.id, notes]);
    const diaryById = async (id) => (id ? one('select id::text as id, "engineerId"::text as engineer, "photosJson"::text as photos from "SiteDiary" where "projectId" = $1 and id = $2', [A.id, id]) : null);
    const create = (notes, extra) => pm('POST', `${AP}/site-diaries`, { date: dateIn(2023, 51), shift: 'day', status: 'draft', notes, ...extra });
    const ownNotes = `${STAMP} SD own`;
    const ok = await create(ownNotes, { engineerId: ownEngineer });
    const ownRow = await diaryBy(ownNotes);
    check(`ALLOWED (POST): the company's own member ${ownEngineer} is the diary's engineer (201, stored)`, ok.status === 201 && ownRow?.engineer === ownEngineer, `${said(ok)}; stored ${ownRow?.engineer}`);
    const bothNotes = `${STAMP} SD both`;
    const okBoth = await create(bothNotes, { engineerId: both });
    check(`ALLOWED (POST): a member whose home workspace is company ${VICTIM} is the engineer too (membership, not home)`, okBoth.status === 201 && (await diaryBy(bothNotes))?.engineer === both, said(okBoth));
    const refusedCreate = async (label, value) => {
      const notes = `${STAMP} SD-R ${label}`;
      const res = await create(notes, { engineerId: value });
      const stored = await diaryBy(notes);
      const gate = await create(notes, { engineerId: ownEngineer });
      const gated = await diaryById(gate.body?.data?.id);
      return { res, stored, gate: ok2xx(gate) && gated?.engineer === ownEngineer ? gate : { ...gate, status: 0 } };
    };
    const bad = await refusedCreate('foreign', foreignUser);
    const noneId = nowhere();
    const none = await refusedCreate('nowhere', noneId);
    check(`REFUSED (POST): company ${VICTIM}'s person is refused with a 4xx and no diary is stored${gateNote(bad.gate)}`, ok2xx(bad.gate) && is4xx(bad.res) && !bad.stored, `${said(bad.res)}${bad.stored ? `; STORED SiteDiary ${bad.stored.id} engineer ${bad.stored.engineer}` : ''}`);
    check(`NOWHERE (POST): …exactly as a person who exists nowhere (the whole answer; no 5xx)${gateNote(none.gate)}`, ok2xx(none.gate) && answerOf(bad.res, [foreignUser]) === answerOf(none.res, [noneId]) && is4xx(none.res) && !none.stored, `${answerOf(bad.res, [foreignUser]).slice(0, 300)} | ${answerOf(none.res, [noneId]).slice(0, 300)}`);
    for (const [label, make] of [['["id"]', (id) => [id]], ['[["id"]]', (id) => [[id]]], ['{"id":id}', (id) => ({ id })], ['12345', () => 12345]]) {
      const res = await refusedCreate(`shape ${label}`, make(foreignUser));
      check(`SHAPE (POST): engineerId ${label} is refused as invalid input (400 VALIDATION_ERROR; no 5xx) and stores nothing${gateNote(res.gate)}`, ok2xx(res.gate) && invalidInput(res.res) && !res.stored, said(res.res));
    }
    if (ownRow) {
      const patch = (body) => pm('PATCH', `${AP}/site-diaries/${ownRow.id}`, body);
      const pBad = await patch({ engineerId: foreignUser });
      const pNoneId = nowhere();
      const pNone = await patch({ engineerId: pNoneId });
      const kept = await diaryById(ownRow.id);
      const pGate = await patch({ engineerId: ownEngineer2 });
      const moved = await diaryById(ownRow.id);
      const gate = ok2xx(pGate) && moved?.engineer === ownEngineer2 ? pGate : { ...pGate, status: 0 };
      check(`ALLOWED (PATCH): the company's other member ${ownEngineer2} is accepted and stored`, ok2xx(gate), `${said(pGate)}; stored ${moved?.engineer}`);
      check(`REFUSED (PATCH): company ${VICTIM}'s person is refused with a 4xx and the diary keeps its engineer${gateNote(gate)}`, ok2xx(gate) && is4xx(pBad) && kept?.engineer === ownEngineer, `${said(pBad)}; engineer ${kept?.engineer}`);
      check(`NOWHERE (PATCH): …exactly as a person who exists nowhere (no 5xx)${gateNote(gate)}`, ok2xx(gate) && answerOf(pBad, [foreignUser]) === answerOf(pNone, [pNoneId]) && is4xx(pNone), `${answerOf(pBad, [foreignUser]).slice(0, 300)} | ${answerOf(pNone, [pNoneId]).slice(0, 300)}`);
      const pBoth = await patch({ engineerId: both });
      check(`ALLOWED (PATCH): a member whose home workspace is company ${VICTIM} is accepted as the engineer`, ok2xx(pBoth) && (await diaryById(ownRow.id))?.engineer === both, said(pBoth));
      const read = await pm('GET', `${AP}/site-diaries/${ownRow.id}`);
      check(`read-back: GET /site-diaries/{id} carries nothing of company ${VICTIM}`, read.status === 200 && !leakOf({ text: read.text || '', sent: '' }), said(read));
    }

    // A photo's uploader is the document's, never what the request says.
    const uploaderOf = async (label, uploadedBy) => {
      const notes = `${STAMP} SD-P ${label}`;
      const res = await create(notes, { photos: [{ ...webPhoto, uploadedBy }] });
      return { res, row: await diaryBy(notes) };
    };
    const uForeign = await uploaderOf('uploader foreign', foreignUser);
    const uNowhere = await uploaderOf('uploader nowhere', nowhere());
    check(`photos[].uploadedBy = company ${VICTIM}'s person: the diary is accepted with the document's own uploader (${pmId}); the victim's person is not stored`, ok2xx(uForeign.res) && uForeign.row?.photos.includes(pmId) && !uForeign.row.photos.includes(foreignUser), `${said(uForeign.res)}; photos ${uForeign.row?.photos?.slice(0, 300)}`);
    check('photos[].uploadedBy: …answered as for a person who exists nowhere, who is not stored either', ok2xx(uNowhere.res) && uNowhere.res.status === uForeign.res.status && uNowhere.row?.photos.includes(pmId), `${said(uNowhere.res)}; photos ${uNowhere.row?.photos?.slice(0, 300)}`);

    const photoGate = async (notes) => {
      const gate = await create(notes, { photos: [webPhoto] });
      const row = await diaryById(gate.body?.data?.id);
      return ok2xx(gate) && row?.photos?.includes(ownDoc) ? gate : { ...gate, status: 0 };
    };
    const PHOTO_SHAPES = [
      ['photos ["id"] (a bare id is not a link)', (id) => ({ photos: [id] }), invalidInput, 'is refused as invalid input (400 VALIDATION_ERROR)'],
      ['photos [{url:id}]', (id) => ({ photos: [{ url: id }] }), invalidInput, 'is refused as invalid input (400 VALIDATION_ERROR)'],
      ['photos [[{key:id}]]', (id) => ({ photos: [[{ key: id }]] }), invalidInput, 'is refused as invalid input (400 VALIDATION_ERROR)'],
      ['photos [{key:id}]', (id) => ({ photos: [{ key: id }] }), (res) => res.status === 400 && res.body?.error?.code === 'INVALID_SITE_PHOTO_REFERENCE', 'is refused (400 INVALID_SITE_PHOTO_REFERENCE)'],
    ];
    for (const [label, make, expected, wording] of PHOTO_SHAPES) {
      const res = {};
      const sentFor = {};
      for (const [whose, id] of [['own', ownDoc], ['foreign', foreignDoc], ['nowhere', nowhere()]]) {
        if (whose === 'own' && label.startsWith('photos [{key')) continue; // the own document by key is the gate itself
        const notes = `${STAMP} SD-R ${label} ${whose}`;
        res[whose] = await create(notes, make(id));
        sentFor[whose] = id;
        res[`${whose}Stored`] = await diaryBy(notes);
      }
      const gate = await photoGate(`${STAMP} SD-G ${label}`);
      check(`SHAPE (POST diary photos): ${label} naming company ${VICTIM}'s document ${wording} and stores nothing${gateNote(gate)}`, ok2xx(gate) && expected(res.foreign) && !res.foreignStored, said(res.foreign));
      check(`SHAPE (POST diary photos): ${label} — the own, the victim's and a nowhere id are answered alike${gateNote(gate)}`, ok2xx(gate) && answerOf(res.foreign, [sentFor.foreign]) === answerOf(res.nowhere, [sentFor.nowhere]) && (!res.own || answerOf(res.own, [sentFor.own]) === answerOf(res.nowhere, [sentFor.nowhere])) && !res.nowhereStored && !res.ownStored, `${answerOf(res.foreign, [sentFor.foreign]).slice(0, 200)} | ${answerOf(res.nowhere, [sentFor.nowhere]).slice(0, 200)}`);
    }
  }

  // ══ 6. an edit re-checks only what it sends ════════════════════════════════
  section = '6 edits without photos';
  console.log('\n── 6. an update that sends no photos: a report or diary whose stored photo no longer passes can still be edited ──');
  if (runs()) {
    const editActivity = await freshActivity('EDIT');
    const accMarker = nextMarker();
    const accUrl = withMarker(`https://acc.autodesk.com/docs/files/projects/${nowhere()}?folderUrn=urn:adsk.wipprod:fs.folder:co.y`, accMarker);
    const accReport = await pm('POST', `${AP}/daily-reports`, { activityId: editActivity, date: dateIn(2024, 61), status: 'draft', notes: `${STAMP} edit acc`, photos: [{ url: accUrl }] });
    const accId = accReport.body?.data?.id;
    const accBefore = accId ? await val('select "photosJson"::text from "DailyReport" where id = $1', [accId]) : null;
    const accEdit = accId ? await pm('PATCH', `${AP}/daily-reports/${accId}`, { notes: `${STAMP} edit acc edited` }) : { status: 0 };
    const accAfter = accId ? await one('select notes, "photosJson"::text as photos from "DailyReport" where id = $1', [accId]) : null;
    check('ALLOWED: a report with an external link edited without photos is saved (200), its photos unchanged', accReport.status === 201 && ok2xx(accEdit) && accAfter?.notes === `${STAMP} edit acc edited` && accAfter?.photos === accBefore && accBefore?.includes(accMarker), `${said(accReport)} | ${said(accEdit)}`);

    // A site photo named by a report and a diary, then cited by a change order: no longer `available`.
    const linkedReport = await pm('POST', `${AP}/daily-reports`, { activityId: editActivity, date: dateIn(2024, 62), status: 'draft', notes: `${STAMP} edit linked`, photos: [{ key: linkedPhoto.key, filename: linkedPhoto.filename }] });
    const linkedDiary = await pm('POST', `${AP}/site-diaries`, { date: dateIn(2024, 63), status: 'draft', notes: `${STAMP} edit linked diary`, photos: [{ key: linkedPhoto.key, filename: linkedPhoto.filename }] });
    const cited = await pm('POST', `${AP}/change-orders`, { description: `EV4 ${STAMP} cites the site photo`, value: 10, attachmentRefs: [{ documentId: linkedDoc }] });
    const linkedStatus = await val('select status from "ProjectDocument" where id = $1', [linkedDoc]);
    check('setup: the site photo is named by a draft report and a draft diary, then cited by a change order (its status is now "linked")', linkedReport.status === 201 && linkedDiary.status === 201 && cited.status === 201 && linkedStatus === 'linked', `${said(linkedReport)} | ${said(linkedDiary)} | ${said(cited)}; ${linkedStatus}`);
    for (const [record, id, route, table] of [['report', linkedReport.body?.data?.id, 'daily-reports', 'DailyReport'], ['diary', linkedDiary.body?.data?.id, 'site-diaries', 'SiteDiary']]) {
      if (!id) continue;
      const read = async () => one(`select notes, "photosJson"::text as photos from "${table}" where id = $1`, [id]);
      const was = await read();
      const edit = await pm('PATCH', `${AP}/${route}/${id}`, { notes: `${STAMP} ${record} edited without photos` });
      const after = await read();
      check(`REGRESSION ${record}: an edit that sends no photos is saved (200) though its stored photo is no longer available; the photos stay as stored`, ok2xx(edit) && after?.notes === `${STAMP} ${record} edited without photos` && after?.photos === was?.photos && was?.photos.includes(linkedDoc), `${said(edit)}; photos ${after?.photos?.slice(0, 200)}`);
      // What an edit sends is checked: another company's document is refused as nowhere; the own one is accepted.
      const pBad = await pm('PATCH', `${AP}/${route}/${id}`, { photos: [{ key: foreignDoc }] });
      const pNoneId = nowhere();
      const pNone = await pm('PATCH', `${AP}/${route}/${id}`, { photos: [{ key: pNoneId }] });
      const pShape = await pm('PATCH', `${AP}/${route}/${id}`, { photos: [{ url: foreignDoc }] });
      const kept = await read();
      const pGate = await pm('PATCH', `${AP}/${route}/${id}`, { photos: [webPhoto] });
      const moved = await read();
      const gate = ok2xx(pGate) && moved?.photos.includes(ownDoc) ? pGate : { ...pGate, status: 0 };
      check(`ALLOWED ${record}: an edit that sends the own available site photo is saved and stored`, ok2xx(gate), `${said(pGate)}`);
      check(`REFUSED ${record}: an edit that sends company ${VICTIM}'s document is refused with a 4xx and the photos are unchanged${gateNote(gate)}`, ok2xx(gate) && is4xx(pBad) && kept?.photos === after?.photos, `${said(pBad)}`);
      check(`NOWHERE ${record}: …exactly as a document that exists nowhere${gateNote(gate)}`, ok2xx(gate) && answerOf(pBad, [foreignDoc]) === answerOf(pNone, [pNoneId]), `${answerOf(pBad, [foreignDoc]).slice(0, 240)} | ${answerOf(pNone, [pNoneId]).slice(0, 240)}`);
      check(`SHAPE ${record}: an edit that sends a bare id as a photo's link is refused as invalid input (400 VALIDATION_ERROR), the photos unchanged${gateNote(gate)}`, ok2xx(gate) && invalidInput(pShape) && kept?.photos === after?.photos, `${said(pShape)}`);
    }
  }

  // ══ 7. a NUL character in evidence (DEPENDENT on the app-level guard) ══════
  section = '7 nul character';
  console.log('\n── 7. a NUL character in evidence notes: refused as invalid input, never a 5xx (DEPENDENT) ──');
  if (runs()) {
    const nulActivity = await freshActivity('NUL');
    const NUL_DOORS = [
      ['progress evidence notes', () => pm('POST', `${AP}/activities/${nulActivity}/progress`, { pctComplete: 5, progressMethod: 'percent', status: 'submitted', notes: `${STAMP} nul`, evidence: { notes: 'a\u0000b' } }, { dependent: true })],
      ['a daily report photo\'s caption', () => pm('POST', `${AP}/daily-reports`, { activityId: nulActivity, date: dateIn(2024, 71), status: 'draft', notes: `${STAMP} nul report`, photos: [{ url: 'https://example.test/a.jpg', caption: 'a\u0000b' }] }, { dependent: true })],
    ];
    for (const [label, send] of NUL_DOORS) {
      const res = await send();
      const storedNul = Number(await val('select count(*)::int from "ProgressSubmission" where "projectId" = $1 and notes = $2', [A.id, `${STAMP} nul`])) + Number(await val('select count(*)::int from "DailyReport" where "projectId" = $1 and notes = $2', [A.id, `${STAMP} nul report`]));
      const name = `NUL: ${label} 'a\\u0000b' is refused with a 400 and nothing is stored`;
      if (res.status >= 500) {
        dependent.push(`${name} — answered ${said(res)}; awaits the app-level NUL guard (another group)`);
        console.log(`DEPENDENT  ${name}\n        answered ${said(res)} — awaits the app-level NUL guard (another group's middleware)`);
      } else {
        check(name, res.status === 400 && storedNul === 0, `${said(res)}; stored ${storedNul}`);
      }
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
  const errors = answers.filter((a) => a.status >= 500 && !a.dependent);
  check(`no answer is a server error (${answers.length} answers; ${answers.filter((a) => a.dependent && a.status >= 500).length} DEPENDENT NUL 5xx set aside)`, errors.length === 0, errors.slice(0, 8).map((a) => `${a.status} ${a.route} ${firstLine(a.text).slice(0, 160)}`).join('\n        '));
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
  if (dependent.length) {
    console.log(`\nDEPENDENT (not counted; each expects 400 once the app-level NUL guard lands): ${dependent.length}`);
    for (const line of dependent) console.log(`  - ${line}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${GROUP} proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
