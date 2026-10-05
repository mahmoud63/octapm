'use strict';

/**
 * The CERT-2 proof of group evidence-6: the cost of reading evidence links,
 * the links a raw-text match refused although they name the caller's own
 * file, the figures of daily reports, site diaries and meetings, and the UAT
 * runner's meeting.
 *
 *   $env:DATABASE_URL = $null; $env:CERT_INPROCESS = "1"; node scripts/cert/isolation/evidence-6-proof.js [attacker=067] [victim=068]
 *   … [--only=<section regex, e.g. "^2">] [--no-fingerprint] [--max-kb=<n>]   (for mutation runs; a full run takes none:
 *   --max-kb leaves out the texts larger than n KB, which a quadratic reading would take hours over)
 *
 * What each did before the fix (reproduced in process, 067 -> 068):
 *   1. progress.service linkForms (round 5) parsed every whitespace token of
 *      every evidence text as a URL and kept the paths in an array it searched
 *      for each new one (forms.includes): evidence.notes of 50,000 '/n<i>'
 *      tokens (380 KB) answered 500 (P2028, the transaction expired) after
 *      7.5 s on single progress, a daily report's progress and photos and a
 *      site diary's photos, 6.2 s on bulk progress, the event loop blocked
 *      throughout; 20,000 tokens took about a second. The scan ran inside the
 *      request's transaction. fileKey's /\.+$/ tried every run of dots: a key
 *      of 100,000 dots and a letter took 3.5 s (since HEAD).
 *   2. A file link was judged by every key its text held as written: the own
 *      file written '…/uploads/x/../<own>' was refused for the key 'x', a link
 *      field with a tab or a line break inside the own key or project for the
 *      part before it, and a note quoting the own link ("…", <…>, “…”) for
 *      the key with the closing quote (400 INVALID_SITE_PHOTO_REFERENCE).
 *   3. 44 figure chains of the three routers took [1,1], [5] and [] (201,
 *      stored as 0, 5 and 0); an equipment line of 1e300 (or 1e15) hours was
 *      stored and its approval refused for ever (the cost overflows); a site
 *      diary's workers '99999999999999999999' answered 500; temperatures,
 *      rainfall, quantities, counts and photo sizes had no bound (1e300
 *      stored); a meeting address given as a list was stored joined
 *      ('a@x,b@x') on an attendee, an action item and a distribution.
 *   4. The UAT runner's meeting (e2e/uat/run-uat-regression.mjs
 *      runMeetingMinutesFlow) sent attendanceStatus 'present' and an agenda
 *      status 'closed' — words the API has never taken — and was refused.
 *
 * For every door, on a record of the attacker company that accepts the
 * request (the GATE: the same request naming the attacker's own record, or
 * carrying a figure as one value, succeeds on the same record, read back):
 *   TIMED    the request is answered (2xx, or the refusal a missing key gets)
 *            in well under a second, the event loop never held long, the text
 *            stored whole; the scan itself measured against HEAD (f16c14f);
 *   ALLOWED  the own file, however written, is accepted and stored;
 *   REFUSED  the victim's file is refused with a 4xx and nothing is stored;
 *   NOWHERE  one that exists nowhere gets exactly the same answer;
 *   SHAPE    a figure that is not one value, or out of its range, is refused
 *            400 VALIDATION_ERROR naming the field, nothing stored.
 * No answer is a 5xx or carries the victim's ids (beyond the ones the request
 * itself sent), names, addresses or canaries; no row of the attacker company
 * names a victim id afterwards that did not before; the victim company's
 * data does not change in any table (fingerprint taken after the setup).
 *
 * Re-runnable: every record the checks write to is new, every request carries
 * a fresh stamp. Exit 0 when every check holds, 2 otherwise.
 */

process.env.REQUEST_LOG_FORMAT = process.env.REQUEST_LOG_FORMAT || 'off';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');
const api = require('../lib/api');
const { buildPopulation } = require('../lib/spec');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const ATTACKER = positional[0] || '067';
const VICTIM = positional[1] || '068';
const ONLY = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7) || null;
const FINGERPRINT = !process.argv.includes('--no-fingerprint');
const MAX_KB = Number(process.argv.find((arg) => arg.startsWith('--max-kb='))?.slice(9)) || Infinity;
const fits = (text) => Buffer.byteLength(text) <= MAX_KB * 1024;
const GROUP = 'evidence-6';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `EV6-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const stamp = STAMP.toLowerCase();
const INPROCESS = process.env.CERT_INPROCESS === '1';
const HEAD = 'f16c14f';
const BACKEND = path.join(__dirname, '..', '..', '..');
const SERVICES = path.join(BACKEND, 'src', 'services');
const REPO = path.join(BACKEND, '..');
// The fifth round's progress.service, kept by the evidence-6 fix (measured when present; not a check).
const ROUND5 = process.env.EV6_ROUND5 || 'C:/Temp/evidence-6-bak/orig/backend/src/services/progress.service.js';
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
const fieldsNamed = (res) => (invalidInput(res) ? (res.body.error.details || []).map((d) => d.field) : []);
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
const ms = (start) => Number(process.hrtime.bigint() - start) / 1e6;
/** A text of at least `bytes` bytes: tokens make(i) joined by spaces. */
const fill = (bytes, make) => {
  const parts = [];
  let size = 0;
  for (let i = 0; size < bytes; i += 1) {
    const token = make(i);
    parts.push(token);
    size += token.length + 1;
  }
  return parts.join(' ');
};
const kb = (text) => `${Math.round(Buffer.byteLength(text) / 1024)} KB`;

// The local e-mail transport writes to the console in process; keep it out of the output.
const print = console.log.bind(console);
console.log = (...args) => {
  const text = args.map(String).join(' ');
  if (text.startsWith('[email:local]')) return;
  print(...args);
};

/** A copy of progress.service from other source, loaded beside the real one (its requires resolve there). */
const loadService = (source, tag) => {
  const filename = path.join(SERVICES, `progress.service.${tag}.js`);
  const copy = new Module(filename, module);
  copy.filename = filename;
  copy.paths = Module._nodeModulePaths(SERVICES);
  copy._compile(source, filename);
  return copy.exports;
};
/**
 * Where the evidence links are read: each URL progress.service's formsOf
 * builds is sampled (the first 20 of a request), and its stack — async frames
 * included — says whether it was built inside prisma's interactive
 * transaction (_transactionWithCallback). The fix reads before the
 * transaction; the fifth round read inside it.
 */
const linkReads = { tracking: false, seen: 0, inside: 0, sampled: 0, where: '', request() { this.sampled = 0; } };
const NativeURL = globalThis.URL;
globalThis.URL = class TrackedURL extends NativeURL {
  constructor(...args) {
    super(...args);
    if (!linkReads.tracking || linkReads.sampled >= 20) return;
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 60;
    const stack = new Error().stack || '';
    Error.stackTraceLimit = limit;
    // formsOf reads a link (the fifth round's linkForms did, inline in a mutation run).
    if (!/\bformsOf\b|\blinkForms\b/.test(stack)) return;
    linkReads.sampled += 1;
    linkReads.seen += 1;
    if (stack.includes('_transactionWithCallback')) {
      linkReads.inside += 1;
      if (!linkReads.where) linkReads.where = stack.split('\n').filter((l) => /services|routes/.test(l)).slice(0, 4).map((l) => l.trim()).join(' < ');
    }
  }
};
/** No lookup is made for evidence that names no file; a lookup would answer nothing. */
const NO_DATABASE = {
  projectDocument: { findMany: async () => [] },
  photo: { findMany: async () => [] },
  documentRevision: { findMany: async () => [] },
};

const main = async () => {
  console.log(`${GROUP} proof — attacker ${ATTACKER}, victim ${VICTIM}, stamp ${STAMP}${INPROCESS ? ', in process (the working tree\'s code)' : ' — NOT in process: a running API does not run the working tree\'s code'}${ONLY ? `, only /${ONLY}/` : ''}${FINGERPRINT ? '' : ', no fingerprint'}${MAX_KB < Infinity ? `, texts up to ${MAX_KB} KB` : ''}\n`);
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

  // What no answer may carry (filled once the victim's ids are known).
  const victimIds = [];
  const traces = [`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`];
  let victimTraces = new RegExp(traces.join('|'));
  /**
   * An answer leaks when it carries the victim's traces, or a victim id the
   * request itself did not send — an id it sent with a tab or a line break
   * inside (a link field drops them, and a refusal names the key it read) is
   * one it sent.
   */
  const leakOf = (text, sent) => {
    if (victimTraces.test(text)) return (text.match(victimTraces) || [])[0];
    const written = sent.replace(/\\[trn]/g, '');
    return victimIds.find((id) => text.includes(id) && !written.includes(id)) || null;
  };

  const sessions = {};
  const who = (role, code = ATTACKER) => {
    const key = `${role}@${code}`;
    if (!sessions[key]) {
      const session = api.as(`${role}@c${code}.octapm-cert.test`);
      sessions[key] = async (method, route, body, options = {}) => {
        const res = await session.send(method, route, body, options);
        const sent = `${route} ${JSON.stringify(body ?? null)}`;
        const text = res.text || '';
        // A long answer (the timed requests echo megabytes of their own text) is judged here and kept short.
        if (text.length + sent.length > 200_000) {
          answers.push({ route: `${role}@${code} ${method} ${route}`, status: res.status, text: text.slice(0, 2000), sent: sent.slice(0, 2000), leak: leakOf(text, sent) });
        } else {
          answers.push({ route: `${role}@${code} ${method} ${route}`, status: res.status, text, sent });
        }
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

  // Two own site photos, uploaded now the way the site-reporting form uploads them.
  const form = new FormData();
  for (const tag of ['a', 'b']) form.append('files', new Blob([PNG_1X1], { type: 'image/png' }), `${stamp}-${tag}.png`);
  const uploaded = await pm('POST', `${AP}/site-reporting/uploads`, undefined, { form });
  const [webPhoto = null, secondPhoto = null] = Array.isArray(uploaded.body?.data) ? uploaded.body.data : [];
  const ownDoc = webPhoto?.documentId;
  const ownDoc2 = secondPhoto?.documentId;
  const ownRows = ownDoc && ownDoc2 ? await q('select "projectId"::text as project, "orgId"::text as org, status from "ProjectDocument" where id = any($1::text[])', [[ownDoc, ownDoc2]]) : [];
  check(`setup: two site photos uploaded to company ${ATTACKER}'s project (${ownDoc}, ${ownDoc2}, available)`, uploaded.status === 201 && ownRows.length === 2 && ownRows.every((r) => r.project === A.id && r.org === attackerOrg && r.status === 'available'), `${said(uploaded)} ${JSON.stringify(ownRows)}`);
  const foreignDocRow = await one(`select id::text as id, "storageKey" as "storageKey", "orgId"::text as org, "fileName" as "fileName", "originalName" as "originalName" from "ProjectDocument" where "orgId" = $1 and "projectId" = $2 order by ("documentType" = 'site_photo') desc, "createdAt" limit 1`, [victimOrg, V.id]);
  const foreignDoc = foreignDocRow?.id;
  let victimEquipment = await val('select e.id::text from "Equipment" e join "Project" p on p.id = e."projectId" where p."orgId" = $1 and e."projectId" = $2 order by e."createdAt" limit 1', [victimOrg, V.id]);
  if (!victimEquipment) victimEquipment = (await must(vPm, 'POST', `/projects/${V.id}/equipment`, { name: `EV6 victim equipment ${STAMP}`, rateType: 'hourly', rate: 10 }, 'victim equipment')).id;
  check(`setup: document ${foreignDoc} and equipment ${victimEquipment} are company ${VICTIM}'s (project ${V.id})`, foreignDocRow?.org === victimOrg && Boolean(victimEquipment) && (await val('select "orgId"::text from "Project" where id = $1', [V.id])) === victimOrg);
  if (!ownDoc || !ownDoc2 || !foreignDoc || !victimEquipment) throw new Error('setup incomplete');
  victimIds.push(...[foreignUser, foreignDoc, foreignDocRow.storageKey, V.id, victimEquipment, victimOrg].filter(Boolean));
  for (const name of [foreignDocRow.fileName, foreignDocRow.originalName]) if (name && name.length > 6) traces.push(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  victimTraces = new RegExp(traces.join('|'));

  const freshActivity = async (tag) => (await must(planner, 'POST', `${AP}/activities`, { name: `EV6 ${STAMP} ${tag}`, duration: 3, engineerIds: [siteEngineer] }, `activity ${tag}`)).id;
  const ownEquipment = (await must(pm, 'POST', `${AP}/equipment`, { name: `EV6 ${STAMP} crane`, rateType: 'hourly', rate: 12 }, 'own equipment')).id;
  let dateSalt = 0;
  const nextDate = (year) => {
    dateSalt += 1;
    return new Date(Date.UTC(year, 0, 1) + ((parseInt(stamp.slice(-4), 16) + dateSalt * 7) % 360) * 86_400_000).toISOString().slice(0, 10);
  };

  const NAMING = {
    DailyReport: 'select count(*)::int as n from "DailyReport" t join "Project" p on p.id = t."projectId" where p."orgId" = $1',
    SiteDiary: 'select count(*)::int as n from "SiteDiary" t join "Project" p on p.id = t."projectId" where p."orgId" = $1',
    ProgressSubmission: 'select count(*)::int as n from "ProgressSubmission" t join "Project" p on p.id = t."projectId" where p."orgId" = $1',
    ActivityEquipmentUsage: 'select count(*)::int as n from "ActivityEquipmentUsage" t join "Project" p on p.id = t."projectId" where p."orgId" = $1',
    Meeting: 'select count(*)::int as n from "Meeting" t where t."orgId" = $1',
    MeetingAgendaItem: 'select count(*)::int as n from "MeetingAgendaItem" t where t."orgId" = $1',
  };
  const naming = async () => {
    const counts = {};
    for (const [table, sql] of Object.entries(NAMING)) {
      counts[table] = (await q(`${sql} and (${victimIds.map((_, i) => `strpos(to_jsonb(t)::text, $${i + 2}) > 0`).join(' or ')})`, [attackerOrg, ...victimIds]))[0].n;
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

  let counter = 0;
  // Ends in a letter: n1z is not a prefix of n10z.
  const nextMarker = () => `${stamp}-n${(counter += 1)}z`;
  const storedBy = async (marker) => {
    const like = `%${marker}%`;
    return {
      submissions: Number(await val('select count(*)::int from "ProgressSubmission" where "projectId" = $1 and notes like $2', [A.id, like])),
      reportPhotos: Number(await val('select count(*)::int from "DailyReport" where "projectId" = $1 and notes like $2 and jsonb_array_length(coalesce("photosJson", \'[]\'::jsonb)) > 0', [A.id, like])),
      reports: Number(await val('select count(*)::int from "DailyReport" where "projectId" = $1 and notes like $2', [A.id, like])),
      diaryPhotos: Number(await val('select count(*)::int from "SiteDiary" where "projectId" = $1 and notes like $2 and jsonb_array_length(coalesce("photosJson", \'[]\'::jsonb)) > 0', [A.id, like])),
      diaries: Number(await val('select count(*)::int from "SiteDiary" where "projectId" = $1 and notes like $2', [A.id, like])),
    };
  };
  const nothing = (s) => s.submissions === 0 && s.reports === 0 && s.diaries === 0;

  // ══ 1. the cost of reading evidence ═══════════════════════════════════════
  section = '1 timed evidence';
  console.log('\n── 1. long evidence texts: answered in well under a second, the scan outside the transaction, measured against HEAD ──');
  if (runs()) {
    // The five doors evidence text comes in by; the text goes where each door reads free text.
    // [door, prepare() → the record it writes to, send(record, text, marker), stored(record, marker) → the stored text's length]
    // One activity per door (made once, before any timing): every timed request is told apart by its marker.
    const submissionNotes = (a, marker) => val('select length("evidenceJson"->>\'notes\') from "ProgressSubmission" where "activityId" = $1 and notes = $2', [a, `${STAMP} ${marker}`]);
    const doorActivity = {};
    const activityFor = (door) => async () => {
      doorActivity[door] = doorActivity[door] || (await freshActivity(`T ${door}`));
      return doorActivity[door];
    };
    const timedDoors = [
      ['progress (single)', activityFor('single'), (a, text, marker) => pm('POST', `${AP}/activities/${a}/progress`, { pctComplete: 7, progressMethod: 'percent', status: 'submitted', notes: `${STAMP} ${marker}`, evidence: { notes: text } }), submissionNotes],
      ['progress (bulk)', activityFor('bulk'), (a, text, marker) => pm('POST', `${AP}/activities/bulk-progress`, { updates: [{ activityId: a, pctComplete: 6, progressMethod: 'percent', status: 'submitted', notes: `${STAMP} ${marker}`, evidence: { notes: text } }] }), submissionNotes],
      ['daily report progress', activityFor('daily progress'), (a, text, marker) => pm('POST', `${AP}/daily-reports`, { activityId: a, date: nextDate(2021), status: 'submitted', notes: `${STAMP} ${marker}`, progress: { method: 'percent', pctComplete: 4, notes: `${STAMP} ${marker}`, evidence: { notes: text } } }), submissionNotes],
      ['daily report photos', activityFor('daily photos'), (a, text, marker) => pm('POST', `${AP}/daily-reports`, { activityId: a, date: nextDate(2021), status: 'draft', notes: `${STAMP} ${marker}`, photos: [{ url: 'https://example.test/site.jpg', caption: text }] }), (a, marker) => val('select length("photosJson"->0->>\'caption\') from "DailyReport" where "activityId" = $1 and notes = $2', [a, `${STAMP} ${marker}`])],
      ['site diary photos', async () => null, (_none, text, marker) => pm('POST', `${AP}/site-diaries`, { date: nextDate(2021), status: 'draft', notes: `${STAMP} ${marker}`, photos: [{ url: 'https://example.test/site.jpg', caption: text }] }), (_none, marker) => val('select length("photosJson"->0->>\'caption\') from "SiteDiary" where "projectId" = $1 and notes = $2', [A.id, `${STAMP} ${marker}`])],
    ];
    const ownLinks = fill(2 * 1024 * 1024, (i) => `/api/v1/projects/${A.id}/site-reporting/x${i.toString(36)}/../uploads/${ownDoc}`);
    // [label, text, doors (all when null), what the answer is, the bound on the whole request]
    const TEXTS = [
      ['246 KB of short "/n" tokens', fill(246 * 1024, (i) => `/n${i.toString(36)}`), null, 'stored', 1000],
      ['50,000 "/n<i>" tokens', Array.from({ length: 50_000 }, (_, i) => `/n${i}`).join(' '), null, 'stored', 1000],
      ['2 MB of short "/n" tokens', fill(2 * 1024 * 1024, (i) => `/n${i.toString(36)}`), null, 'stored', 1000],
      ['2 MB of distinct own file links with dot segments (each read)', ownLinks, null, 'stored', 1500],
      ['8.5 MB of short "/n" tokens', fill(8.5 * 1024 * 1024, (i) => `/n${i.toString(36)}`), ['progress (single)'], 'stored', 3000],
      ['an own upload link whose key is 100,000 dots and a letter', `see /api/v1/projects/${A.id}/site-reporting/uploads/${'.'.repeat(100_000)}x`, null, 'missing', 1000],
    ];
    linkReads.tracking = true;
    for (const [label, text, only, expect, bound] of TEXTS.filter(([, text]) => fits(text))) {
      for (const [doorName, prepare, send, storedLength] of timedDoors) {
        if (only && !only.includes(doorName)) continue;
        const record = await prepare();
        const marker = nextMarker();
        linkReads.request();
        let worst = 0;
        let last = Date.now();
        const timer = setInterval(() => {
          const now = Date.now();
          worst = Math.max(worst, now - last - 5);
          last = now;
        }, 5);
        const started = process.hrtime.bigint();
        const res = await send(record, text, marker);
        const took = ms(started);
        clearInterval(timer);
        const length = expect === 'stored' ? Number(await storedLength(record, marker)) : null;
        const kept = expect === 'stored' ? ok2xx(res) && length === text.length : res.status === 400 && res.body?.error?.code === 'INVALID_SITE_PHOTO_REFERENCE' && nothing(await storedBy(marker));
        check(`TIMED ${doorName}: ${label} (${kb(text)}) — ${expect === 'stored' ? 'accepted and stored whole' : 'refused 400 as a missing key, nothing stored'} in ${Math.round(took)} ms (< ${bound} ms), the event loop held at most ${worst} ms (< 250 ms)`, kept && took < bound && worst < 250, `${said(res)}; stored length ${length} of ${text.length}`);
      }
    }
    linkReads.tracking = false;
    check(`OUTSIDE the evidence links of the timed requests were read (${linkReads.seen} reads sampled) and none inside a database transaction`, linkReads.seen > 0 && linkReads.inside === 0, `${linkReads.inside} of ${linkReads.seen} inside: ${linkReads.where}`);

    // The scan alone, as HEAD (f16c14f) and the fifth round read the same evidence.
    const current = require('../../../src/services/progress.service');
    let head = null;
    try {
      head = loadService(execFileSync('git', ['show', `${HEAD}:backend/src/services/progress.service.js`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }), `head-${HEAD}`);
    } catch (error) {
      console.log(`  (HEAD ${HEAD} could not be loaded: ${error.message.split('\n')[0]})`);
    }
    const round5 = fs.existsSync(ROUND5) ? loadService(fs.readFileSync(ROUND5, 'utf8'), 'round-5') : null;
    const scanTime = async (service, evidence) => {
      const started = process.hrtime.bigint();
      let outcome;
      try {
        await service.prepareEvidence({ orgId: attackerOrg, projectId: A.id, evidence }, NO_DATABASE);
        outcome = 'read';
      } catch (error) {
        outcome = error.code || error.message;
      }
      return { took: ms(started), outcome };
    };
    for (const [label, text, roundFive] of [
      ['8.5 MB of short "/n" tokens', fill(8.5 * 1024 * 1024, (i) => `/n${i.toString(36)}`), false],
      ['50,000 "/n<i>" tokens', Array.from({ length: 50_000 }, (_, i) => `/n${i}`).join(' '), true],
      ['20,000 "/n<i>" tokens', Array.from({ length: 20_000 }, (_, i) => `/n${i}`).join(' '), true],
    ].filter(([, text]) => fits(text))) {
      for (const [where, evidence] of [['notes', { notes: text }], ['a photo caption', { photos: [{ url: 'https://example.test/site.jpg', caption: text }] }]]) {
        const now = await scanTime(current, evidence);
        const then = head ? await scanTime(head, evidence) : null;
        const fifth = round5 && roundFive ? await scanTime(round5, evidence) : null;
        console.log(`  scan of ${label} in ${where}: now ${now.took.toFixed(1)} ms; HEAD ${HEAD} ${then ? `${then.took.toFixed(1)} ms` : 'n/a'}${fifth ? `; round 5 ${fifth.took.toFixed(0)} ms` : ''}`);
        check(`TIMED the scan of ${label} (${kb(text)}) in ${where}: ${now.took.toFixed(1)} ms, within HEAD's ${then ? then.took.toFixed(1) : '?'} ms and 50 ms`, Boolean(then) && now.outcome === 'read' && now.took <= Math.max(50, then.took + 50), `now ${JSON.stringify(now)} HEAD ${JSON.stringify(then)}`);
      }
    }
    // The fileKey dots: a capture of 100,000 dots and a letter.
    const dots = { photos: [{ url: `/api/v1/projects/${A.id}/site-reporting/uploads/${'.'.repeat(100_000)}x` }] };
    const dotsNow = await scanTime(current, dots);
    const dotsHead = head ? await scanTime(head, dots) : null;
    console.log(`  scan of a key of 100,000 dots and a letter: now ${dotsNow.took.toFixed(1)} ms (${dotsNow.outcome}); HEAD ${dotsHead ? `${dotsHead.took.toFixed(0)} ms (${dotsHead.outcome})` : 'n/a'}`);
    check(`TIMED a key of 100,000 dots and a letter is read in ${dotsNow.took.toFixed(1)} ms (< 50 ms; HEAD ${dotsHead ? dotsHead.took.toFixed(0) : '?'} ms) and refused as a missing key`, dotsNow.took < 50 && dotsNow.outcome === 'INVALID_SITE_PHOTO_REFERENCE', JSON.stringify(dotsNow));

    // Read before the transaction: the reading prepareEvidence is handed is used as it is, never read again inside.
    const reading = current.scanEvidence({ projectId: A.id, evidence: { notes: 'x' } });
    const handed = { ...reading, shape: { keys: [ownDoc], photoIds: [], revisionIds: [], otherProject: false } };
    let looked = null;
    await current.prepareEvidence({ orgId: attackerOrg, projectId: A.id, evidence: reading.evidence, scanned: handed }, { ...NO_DATABASE, projectDocument: { findMany: async ({ where }) => { looked = where.OR[0].id.in; return []; } } }).catch(() => null);
    check('READ AHEAD prepareEvidence uses the reading made before the transaction for the same evidence (it looks up the keys of that reading, it does not read the text again)', JSON.stringify(looked) === JSON.stringify([ownDoc]), `looked up ${JSON.stringify(looked)}`);
  }

  // ══ 2. the own file, however a client writes it ═══════════════════════════
  section = '2 resolved links';
  console.log('\n── 2. a link that resolves to a file link is judged by what it resolves to: the own file accepted, another company\'s refused as nowhere ──');
  if (runs()) {
    const acts = {};
    for (const name of ['single', 'bulk', 'daily-progress', 'daily-photos', 'daily-patch']) acts[name] = await freshActivity(`S2 door ${name}`);
    const draftReport = (await must(pm, 'POST', `${AP}/daily-reports`, { activityId: acts['daily-patch'], date: nextDate(2022), status: 'draft', notes: `${STAMP} S2 patch report` }, 'report to patch')).id;
    const draftDiary = (await must(pm, 'POST', `${AP}/site-diaries`, { date: nextDate(2022), status: 'draft', notes: `${STAMP} S2 patch diary` }, 'diary to patch')).id;
    const DOORS = [
      ['progress (single)', (photo, marker) => pm('POST', `${AP}/activities/${acts.single}/progress`, { pctComplete: 7, progressMethod: 'percent', status: 'submitted', notes: `${STAMP} ${marker}`, evidence: { photos: [photo] } }), (s) => s.submissions === 1],
      ['progress (bulk)', (photo, marker) => pm('POST', `${AP}/activities/bulk-progress`, { updates: [{ activityId: acts.bulk, pctComplete: 6, progressMethod: 'percent', status: 'submitted', notes: `${STAMP} ${marker}`, evidence: { photos: [photo] } }] }), (s) => s.submissions === 1],
      ['daily report progress', (photo, marker) => pm('POST', `${AP}/daily-reports`, { activityId: acts['daily-progress'], date: nextDate(2022), shift: 'day', status: 'submitted', notes: `${STAMP} ${marker}`, progress: { method: 'percent', pctComplete: 4, notes: `${STAMP} ${marker}`, evidence: { photos: [photo] } } }), (s) => s.submissions === 1 && s.reports === 1],
      ['daily report photos (and its progress)', (photo, marker) => pm('POST', `${AP}/daily-reports`, { activityId: acts['daily-photos'], date: nextDate(2022), shift: 'day', status: 'submitted', pctProgress: 3, notes: `${STAMP} ${marker}`, photos: [photo] }), (s) => s.reportPhotos === 1 && s.submissions === 1],
      ['daily report photos (PATCH)', (photo, marker) => pm('PATCH', `${AP}/daily-reports/${draftReport}`, { notes: `${STAMP} ${marker}`, photos: [photo] }), (s) => s.reportPhotos === 1],
      ['site diary photos', (photo, marker) => pm('POST', `${AP}/site-diaries`, { date: nextDate(2022), shift: 'day', status: 'draft', notes: `${STAMP} ${marker}`, photos: [photo] }), (s) => s.diaryPhotos === 1],
      ['site diary photos (PATCH)', (photo, marker) => pm('PATCH', `${AP}/site-diaries/${draftDiary}`, { notes: `${STAMP} ${marker}`, photos: [photo] }), (s) => s.diaryPhotos === 1],
    ];
    const upload = (p, d) => `/api/v1/projects/${p}/site-reporting/uploads/${d}`;
    const cut = (id, at) => [id.slice(0, at), id.slice(at)];
    // [label, photo(ids…), the victim's ids, the own ids (the gate)]
    const CASES = [
      ['"x/../<key>" (round 5 refused the own file for the key "x")', (d) => ({ url: `/api/v1/projects/${A.id}/site-reporting/uploads/x/../${d}` }), [foreignDoc], [ownDoc]],
      ['a tab inside the key of a url', (d) => ({ url: upload(A.id, cut(d, 13).join('\t')) }), [foreignDoc], [ownDoc]],
      ['a CRLF inside the key of a fileUrl (the UAT runner\'s link field)', (d) => ({ fileUrl: upload(A.id, cut(d, 20).join('\r\n')), fileName: 'a.jpg' }), [foreignDoc], [ownDoc]],
      ['a line break inside the project of a downloadUrl', (p, d) => ({ downloadUrl: `https://api.octapm.test/api/v1/projects/${cut(p, 8).join('\n')}/workflow/uploads/${d}` }), [V.id, foreignDoc], [A.id, ownDoc]],
      ['a photo that is a link, a tab inside its key and "./" before it', (d) => `/api/v1/projects/${A.id}/site-reporting/./uploads/${cut(d, 4).join('\t')}`, [foreignDoc], [ownDoc]],
      ['an identifier in a segment "../" removes: "…/uploads/<id>/../<own>"', (d) => ({ url: `${upload(A.id, d)}/../${ownDoc}` }), [foreignDoc], [ownDoc2]],
      ['a project in segments "../" removes: "…/projects/<p>/…/uploads/<d>/../../../../<own project>/…/<own>"', (p, d) => ({ url: `${upload(p, d)}/../../../../${A.id}/site-reporting/uploads/${ownDoc}` }), [V.id, foreignDoc], [A.id, ownDoc2]],
      ['a query naming a file beside the own link', (p, d) => ({ url: `${upload(A.id, ownDoc)}?next=${upload(p, d)}` }), [V.id, foreignDoc], [A.id, ownDoc2]],
      ['a caption quoting the link (“…”, "…", <…>; round 5 refused the own file quoted)', (d) => ({ url: 'https://example.test/site.jpg', caption: `see \u201c${upload(A.id, d)}\u201d, "https://api.octapm.test${upload(A.id, d)}". <${upload(A.id, d)}>` }), [foreignDoc], [ownDoc]],
    ];
    const readsBefore = { seen: linkReads.seen, inside: linkReads.inside };
    linkReads.tracking = true;
    for (const [doorName, send, storedOk] of DOORS) {
      for (const [label, make, foreignIds, ownIds] of CASES) {
        const mForeign = nextMarker();
        linkReads.request();
        const bad = await send(make(...foreignIds), mForeign);
        const badStored = await storedBy(mForeign);
        const noneIds = foreignIds.map(() => nowhere());
        const mNone = nextMarker();
        linkReads.request();
        const none = await send(make(...noneIds), mNone);
        const noneStored = await storedBy(mNone);
        const mOwn = nextMarker();
        linkReads.request();
        const gateRes = await send(make(...ownIds), mOwn);
        const gate = ok2xx(gateRes) && storedOk(await storedBy(mOwn)) ? gateRes : { ...gateRes, status: 0 };
        check(`ALLOWED ${doorName}: ${label}, naming company ${ATTACKER}'s own file, is accepted and stored`, ok2xx(gate), said(gateRes));
        check(`REFUSED ${doorName}: ${label}, naming company ${VICTIM}'s, is refused with a 4xx and nothing is stored${gateNote(gate)}`, ok2xx(gate) && is4xx(bad) && nothing(badStored), `${said(bad)}; stored ${JSON.stringify(badStored)}`);
        check(`NOWHERE ${doorName}: ${label} — exactly as one naming nowhere (the whole answer)${gateNote(gate)}`, ok2xx(gate) && answerOf(bad, foreignIds) === answerOf(none, noneIds) && nothing(noneStored), `${answerOf(bad, foreignIds).slice(0, 240)} | ${answerOf(none, noneIds).slice(0, 240)}`);
      }
    }
    linkReads.tracking = false;
    const seen = linkReads.seen - readsBefore.seen;
    const inside = linkReads.inside - readsBefore.inside;
    check(`OUTSIDE on all seven doors — a daily report's progress naming the report's own photos included — the links were read (${seen} reads sampled) and none inside a database transaction`, seen > 0 && inside === 0, `${inside} of ${seen} inside: ${linkReads.where}`);
  }

  // ══ 3. figures ════════════════════════════════════════════════════════════
  section = '3 figures';
  console.log('\n── 3. every figure of the three routers is one value: [1,1], [5] and [] refused 400 naming the field; out-of-range figures refused at the door ──');
  if (runs()) {
    const figureActivity = await freshActivity('FIGURES');
    const draftReport = (await must(pm, 'POST', `${AP}/daily-reports`, { activityId: figureActivity, date: nextDate(2023), status: 'draft', notes: `${STAMP} FIGURES report` }, 'report to patch')).id;
    const draftDiary = (await must(pm, 'POST', `${AP}/site-diaries`, { date: nextDate(2023), status: 'draft', notes: `${STAMP} FIGURES diary` }, 'diary to patch')).id;
    const meetingToPatch = (await must(pm, 'POST', `${AP}/meetings`, { title: `EV6 ${STAMP} FIGURES` }, 'meeting to patch')).id;
    const reportRow = (m) => one('select id::text as id, "pctProgress" as "pctProgress", "weatherJson" as weather, "manpowerJson" as manpower, "materialsJson" as materials, "equipmentJson" as equipment, "photosJson" as photos from "DailyReport" where "projectId" = $1 and notes = $2', [A.id, m]);
    const diaryRow = (m) => one('select workers, "weatherJson" as weather, "manpowerJson" as manpower, "materialsJson" as materials, "equipmentJson" as equipment, "photosJson" as photos from "SiteDiary" where "projectId" = $1 and notes = $2', [A.id, m]);
    const at = (row, keys) => keys.reduce((value, key) => (value == null ? value : value[key]), row);
    const submissionOf = async (m) => {
      const report = await reportRow(m);
      return report ? one('select "pctComplete" as "pctComplete", "quantityComplete" as "quantityComplete", "quantityPlanned" as "quantityPlanned" from "ProgressSubmission" where "dailyReportId" = $1', [report.id]) : null;
    };
    // [field as the refusal names it, body(value), the scalar the gate sends, where it is stored (row → value)]
    const REPORT = [
      ['pctProgress', (v) => ({ pctProgress: v }), 10, (r) => r?.pctProgress],
      ['weather.temperatureC', (v) => ({ weather: { summary: 'Clear', temperatureC: v } }), 21.5, (r) => at(r, ['weather', 'temperatureC'])],
      ['weather.rainfallMm', (v) => ({ weather: { summary: 'Rain', rainfallMm: v } }), 2, (r) => at(r, ['weather', 'rainfallMm'])],
      ['manpower[0].workers', (v) => ({ manpower: [{ trade: 'crew', workers: v, hours: 8 }] }), 6, (r) => at(r, ['manpower', 0, 'workers'])],
      ['manpower[0].hours', (v) => ({ manpower: [{ trade: 'crew', workers: 2, hours: v }] }), 8, (r) => at(r, ['manpower', 0, 'hours'])],
      ['materials[0].qty', (v) => ({ materials: [{ name: 'cement', qty: v, unit: 'bag' }] }), 3, (r) => at(r, ['materials', 0, 'qty'])],
      ['equipment[0].hours', (v) => ({ equipment: [{ name: 'site equipment', hours: v }] }), 2, (r) => at(r, ['equipment', 0, 'hours'])],
      ['photos[0].size', (v) => ({ photos: [{ url: 'https://example.test/site.jpg', size: v }] }), 1024, (r) => at(r, ['photos', 0, 'size'])],
      ['photos[0].sizeBytes', (v) => ({ photos: [{ url: 'https://example.test/site.jpg', sizeBytes: v }] }), 2048, (r) => at(r, ['photos', 0, 'size'])],
      ['progress.pctComplete', (v) => ({ progress: { method: 'percent', pctComplete: v } }), 5, null, (s) => s?.pctComplete],
      ['progress.quantityComplete', (v) => ({ progress: { method: 'percent', pctComplete: 5, quantityComplete: v } }), 3, null, (s) => s?.quantityComplete],
      ['progress.quantityPlanned', (v) => ({ progress: { method: 'percent', pctComplete: 5, quantityPlanned: v } }), 10, null, (s) => s?.quantityPlanned],
    ];
    const DIARY = [
      ['weatherDetails.temperatureC', (v) => ({ weatherDetails: { summary: 'Clear', temperatureC: v } }), 19, (r) => at(r, ['weather', 'temperatureC'])],
      ['weatherDetails.rainfallMm', (v) => ({ weatherDetails: { summary: 'Rain', rainfallMm: v } }), 4, (r) => at(r, ['weather', 'rainfallMm'])],
      ['workers', (v) => ({ workers: v }), 12, (r) => r?.workers],
      ['manpower[0].workers', (v) => ({ manpower: [{ trade: 'crew', workers: v, hours: 8 }] }), 5, (r) => at(r, ['manpower', 0, 'workers'])],
      ['manpower[0].hours', (v) => ({ manpower: [{ trade: 'crew', workers: 2, hours: v }] }), 7, (r) => at(r, ['manpower', 0, 'hours'])],
      ['materials[0].qty', (v) => ({ materials: [{ name: 'sand', qty: v, unit: 'm3' }] }), 4, (r) => at(r, ['materials', 0, 'qty'])],
      ['equipment[0].hours', (v) => ({ equipment: [{ name: 'site equipment', hours: v }] }), 3, (r) => at(r, ['equipment', 0, 'hours'])],
      ['photos[0].size', (v) => ({ photos: [{ url: 'https://example.test/site.jpg', size: v }] }), 512, (r) => at(r, ['photos', 0, 'size'])],
      ['photos[0].sizeBytes', (v) => ({ photos: [{ url: 'https://example.test/site.jpg', sizeBytes: v }] }), 256, (r) => at(r, ['photos', 0, 'size'])],
    ];
    const meetingSort = (v) => ({ agendaItems: [{ title: 'Access', sortOrder: v, status: 'open' }] });
    const sortOf = async (meetingId) => val('select "sortOrder" from "MeetingAgendaItem" where "meetingId" = $1 order by "createdAt" limit 1', [meetingId]);
    // [door, field, send(value, marker), stored(marker) → the stored figure, or undefined when nothing is stored]
    const CHAINS = [
      ...REPORT.map(([field, set, , where, sub]) => ['POST daily report', field, (v, m) => pm('POST', `${AP}/daily-reports`, { activityId: figureActivity, date: nextDate(2023), status: sub ? 'submitted' : 'draft', notes: m, ...set(v) }), async (m) => {
        const row = await reportRow(m);
        if (!row) return undefined;
        return sub ? sub(await submissionOf(m)) : where(row);
      }]),
      ...REPORT.map(([field, set, , where]) => ['PATCH daily report', field, (v, m) => pm('PATCH', `${AP}/daily-reports/${draftReport}`, { notes: m, ...set(v) }), async (m) => {
        const row = await one('select "pctProgress" as "pctProgress", "weatherJson" as weather, "manpowerJson" as manpower, "materialsJson" as materials, "equipmentJson" as equipment, "photosJson" as photos from "DailyReport" where id = $1 and notes = $2', [draftReport, m]);
        if (!row) return undefined;
        return where ? where(row) : null;
      }]),
      ...DIARY.map(([field, set, , where]) => ['POST site diary', field, (v, m) => pm('POST', `${AP}/site-diaries`, { date: nextDate(2023), status: 'draft', notes: m, ...set(v) }), async (m) => {
        const row = await diaryRow(m);
        return row ? where(row) : undefined;
      }]),
      ...DIARY.map(([field, set, , where]) => ['PATCH site diary', field, (v, m) => pm('PATCH', `${AP}/site-diaries/${draftDiary}`, { notes: m, ...set(v) }), async (m) => {
        const row = await one('select workers, "weatherJson" as weather, "manpowerJson" as manpower, "materialsJson" as materials, "equipmentJson" as equipment, "photosJson" as photos from "SiteDiary" where id = $1 and notes = $2', [draftDiary, m]);
        return row ? where(row) : undefined;
      }]),
      ['POST meeting', 'agendaItems[0].sortOrder', (v, m) => pm('POST', `${AP}/meetings`, { title: m, ...meetingSort(v) }), async (m) => {
        const id = await val('select id::text from "Meeting" where "projectId" = $1 and title = $2', [A.id, m]);
        return id ? sortOf(id) : undefined;
      }],
      ['PATCH meeting', 'agendaItems[0].sortOrder', (v, m) => pm('PATCH', `${AP}/meetings/${meetingToPatch}`, { objective: m, ...meetingSort(v) }), async (m) => {
        const changed = await val('select count(*)::int from "Meeting" where id = $1 and objective = $2', [meetingToPatch, m]);
        return Number(changed) ? sortOf(meetingToPatch) : undefined;
      }],
    ];
    const gateOf = new Map([...REPORT, ...DIARY].map(([field, , scalar]) => [field, scalar]));
    gateOf.set('agendaItems[0].sortOrder', 2);
    check(`the routers' 44 body figure chains are all driven (24 daily report, 18 site diary, 2 meeting): ${CHAINS.length}`, CHAINS.length === 44);
    const BAD = [['[1,1]', [1, 1]], ['[5]', [5]], ['[]', []]];
    for (const [door, field, send, stored] of CHAINS) {
      const refused = [];
      for (const [label, value] of BAD) {
        const marker = `EV6 ${STAMP} ${nextMarker()}`;
        const res = await send(value, marker);
        refused.push({ label, res, stored: await stored(marker) });
      }
      const scalar = gateOf.get(field);
      const gateMarker = `EV6 ${STAMP} ${nextMarker()}`;
      const gateRes = await send(scalar, gateMarker);
      const kept = await stored(gateMarker);
      const gate = ok2xx(gateRes) && kept !== undefined && (kept === null || Number(kept) === scalar) ? gateRes : { ...gateRes, status: 0 };
      const wrong = refused.filter((r) => !(invalidInput(r.res) && fieldsNamed(r.res).includes(field) && r.stored === undefined));
      check(`SHAPE (${door}) ${field}: [1,1], [5] and [] are each refused 400 VALIDATION_ERROR on ${field}, nothing stored; ${scalar} is stored as ${scalar}${gateNote(gate)}`, ok2xx(gate) && wrong.length === 0, `${wrong.map((r) => `${r.label} -> ${said(r.res)}${r.stored !== undefined ? ` STORED ${JSON.stringify(r.stored)}` : ''}`).join(' | ')}${ok2xx(gate) ? '' : ` | gate ${said(gateRes)} stored ${JSON.stringify(kept)}`}`);
    }

    // Out of range: what is accepted can be approved; the diary's workers fit their column.
    const approveReport = async (equipment) => {
      const a = await freshActivity('APPROVE');
      const m = `EV6 ${STAMP} ${nextMarker()}`;
      const created = await pm('POST', `${AP}/daily-reports`, { activityId: a, date: nextDate(2023), status: 'submitted', pctProgress: 5, notes: m, equipment });
      const id = created.body?.data?.id || null;
      const approved = id ? await pm('POST', `${AP}/daily-reports/${id}/approve`, {}) : null;
      const usage = id ? await one('select hours, "equipmentId"::text as equipment, "costAmount"::text as cost from "ActivityEquipmentUsage" where "dailyReportId" = $1', [id]) : null;
      return { created, approved, usage, stored: Number(await val('select count(*)::int from "DailyReport" where "projectId" = $1 and notes = $2', [A.id, m])) };
    };
    const day = await approveReport([{ equipmentId: ownEquipment, name: 'crane', hours: 24 }]);
    check('ALLOWED an equipment line of 24 hours (a day) is accepted, approved, and its usage posted against the own equipment (24 h, 288.00)', day.created.status === 201 && ok2xx(day.approved) && day.approved.body?.data?.status === 'approved' && Number(day.usage?.hours) === 24 && day.usage?.equipment === ownEquipment && day.usage?.cost === '288.00', `${said(day.created)} | ${day.approved ? said(day.approved) : '-'} | ${JSON.stringify(day.usage)}`);
    // A line's bound is 744 hours (24 x 31), not a day's 24: one line carries the web progress
    // tab's whole day of equipment hours (CERT-2 trivial-7, which superseded this round's 24.5).
    for (const hours of [1e300, 1e15, 744.5]) {
      const r = await approveReport([{ equipmentId: ownEquipment, name: 'crane', hours }]);
      check(`SHAPE (POST daily report) an equipment line of ${hours} hours is refused 400 VALIDATION_ERROR on equipment[0].hours at the door, nothing stored (round 5: stored, its approval refused for ever)${gateNote(day.created)}`, ok2xx(day.created) && invalidInput(r.created) && fieldsNamed(r.created).includes('equipment[0].hours') && r.stored === 0, `${said(r.created)} stored ${r.stored}`);
    }
    for (const [record, send, countOf] of [
      ['daily report', (lines, m) => pm('POST', `${AP}/daily-reports`, { activityId: figureActivity, date: nextDate(2023), status: 'draft', notes: m, ...lines }), (m) => val('select count(*)::int from "DailyReport" where "projectId" = $1 and notes = $2', [A.id, m])],
      ['site diary', (lines, m) => pm('POST', `${AP}/site-diaries`, { date: nextDate(2023), status: 'draft', notes: m, ...lines }), (m) => val('select count(*)::int from "SiteDiary" where "projectId" = $1 and notes = $2', [A.id, m])],
    ]) {
      for (const [label, lines, field, ok] of [
        ['manpower hours 24', { manpower: [{ trade: 'crew', workers: 3, hours: 24 }] }, null, true],
        ['manpower hours 25', { manpower: [{ trade: 'crew', workers: 3, hours: 25 }] }, 'manpower[0].hours', false],
        ['equipment hours 1e300', { equipment: [{ name: 'site equipment', hours: 1e300 }] }, 'equipment[0].hours', false],
      ]) {
        const m = `EV6 ${STAMP} ${nextMarker()}`;
        const res = await send(lines, m);
        const count = Number(await countOf(m));
        check(ok ? `ALLOWED (POST ${record}) ${label} is accepted and stored` : `SHAPE (POST ${record}) ${label} is refused 400 VALIDATION_ERROR on ${field}, nothing stored`, ok ? res.status === 201 && count === 1 : invalidInput(res) && fieldsNamed(res).includes(field) && count === 0, `${said(res)} stored ${count}`);
      }
    }
    for (const [label, workers, ok] of [['2147483647 (the column\'s largest)', 2147483647, true], ['3000000000', 3000000000, false], ['"99999999999999999999" (round 5: 500)', '99999999999999999999', false]]) {
      const m = `EV6 ${STAMP} ${nextMarker()}`;
      const res = await pm('POST', `${AP}/site-diaries`, { date: nextDate(2023), status: 'draft', notes: m, workers });
      const kept = await val('select workers from "SiteDiary" where "projectId" = $1 and notes = $2', [A.id, m]);
      check(ok ? `ALLOWED (POST site diary) workers ${label} is stored` : `SHAPE (POST site diary) workers ${label} is refused 400 VALIDATION_ERROR on workers — no 5xx, nothing stored`, ok ? res.status === 201 && Number(kept) === workers : invalidInput(res) && fieldsNamed(res).includes('workers') && kept === null, `${said(res)} stored ${kept}`);
    }
    for (const [label, quantity, ok] of [['99,999,999,999 (QUANTITY_MAX)', 99_999_999_999, true], ['1e300', 1e300, false]]) {
      const a = await freshActivity('QTY');
      const m = `EV6 ${STAMP} ${nextMarker()}`;
      const res = await pm('POST', `${AP}/daily-reports`, { activityId: a, date: nextDate(2023), status: 'submitted', notes: m, progress: { method: 'percent', pctComplete: 5, quantityComplete: quantity } });
      const kept = await val('select s."quantityComplete" from "ProgressSubmission" s join "DailyReport" d on d.id = s."dailyReportId" where d."projectId" = $1 and d.notes = $2', [A.id, m]);
      check(ok ? `ALLOWED (POST daily report) progress.quantityComplete ${label} is stored` : `SHAPE (POST daily report) progress.quantityComplete ${label} is refused 400 VALIDATION_ERROR, nothing stored`, ok ? res.status === 201 && Number(kept) === quantity : invalidInput(res) && fieldsNamed(res).includes('progress.quantityComplete') && kept === null, `${said(res)} stored ${kept}`);
    }

    // Every other figure of a site record is finite and bounded, as on every other route.
    for (const [record, send, countOf, weather] of [
      ['daily report', (lines, m) => pm('POST', `${AP}/daily-reports`, { activityId: figureActivity, date: nextDate(2023), status: 'draft', notes: m, ...lines }), (m) => val('select count(*)::int from "DailyReport" where "projectId" = $1 and notes = $2', [A.id, m]), 'weather'],
      ['site diary', (lines, m) => pm('POST', `${AP}/site-diaries`, { date: nextDate(2023), status: 'draft', notes: m, ...lines }), (m) => val('select count(*)::int from "SiteDiary" where "projectId" = $1 and notes = $2', [A.id, m]), 'weatherDetails'],
    ]) {
      for (const [label, lines, field, ok] of [
        ['a temperature of -100 °C and 10,000 mm of rain', { [weather]: { summary: 'Storm', temperatureC: -100, rainfallMm: 10000 } }, null, true],
        ['a temperature of 101 °C', { [weather]: { summary: 'Heat', temperatureC: 101 } }, `${weather}.temperatureC`, false],
        ['1e20 mm of rain', { [weather]: { summary: 'Rain', rainfallMm: 1e20 } }, `${weather}.rainfallMm`, false],
        ['a material quantity of 99,999,999,999', { materials: [{ name: 'sand', qty: 99_999_999_999, unit: 'm3' }] }, null, true],
        ['a material quantity of 1e300', { materials: [{ name: 'sand', qty: 1e300, unit: 'm3' }] }, 'materials[0].qty', false],
        ['2,147,483,648 workers on a line', { manpower: [{ trade: 'crew', workers: 2147483648, hours: 8 }] }, 'manpower[0].workers', false],
        ['a photo of 2,147,483,648 bytes', { photos: [{ url: 'https://example.test/site.jpg', size: 2147483648 }] }, 'photos[0].size', false],
      ]) {
        const m = `EV6 ${STAMP} ${nextMarker()}`;
        const res = await send(lines, m);
        const count = Number(await countOf(m));
        check(ok ? `ALLOWED (POST ${record}) ${label} is accepted and stored` : `SHAPE (POST ${record}) ${label} is refused 400 VALIDATION_ERROR on ${field}, nothing stored`, ok ? res.status === 201 && count === 1 : invalidInput(res) && fieldsNamed(res).includes(field) && count === 0, `${said(res)} stored ${count}`);
      }
    }
    // A meeting's address is one address: a list was stored joined ('a@x,b@x').
    const addressMeeting = (await must(pm, 'POST', `${AP}/meetings`, { title: `EV6 ${STAMP} addresses` }, 'meeting to distribute')).id;
    for (const [label, body, field, where] of [
      ['an attendee', (email) => ({ attendees: [{ name: 'Attendee', email }] }), 'attendees[0].email', 'select a.email as address from "MeetingAttendee" a join "Meeting" m on m.id = a."meetingId" where m."projectId" = $1 and m.title = $2'],
      ['an action item owner', (email) => ({ actionItems: [{ title: 'Sketch', ownerName: 'Owner', ownerEmail: email, dueDate: '2026-11-02', createTask: false }] }), 'actionItems[0].ownerEmail', 'select i."ownerEmail" as address from "MeetingActionItem" i join "Meeting" m on m.id = i."meetingId" where m."projectId" = $1 and m.title = $2'],
    ]) {
      const title = `EV6 ${STAMP} ${nextMarker()}`;
      const listed = await pm('POST', `${AP}/meetings`, { title, ...body([`a.${stamp}@example.test`, `b.${stamp}@example.test`]) });
      const storedListed = await q(where, [A.id, title]);
      const single = await pm('POST', `${AP}/meetings`, { title, ...body(`a.${stamp}@example.test`) });
      const storedSingle = await q(where, [A.id, title]);
      check(`SHAPE (POST meeting) ${label}'s address as a list is refused 400 VALIDATION_ERROR on ${field}, nothing stored (round 5: stored "a,b"); one address is stored as sent${gateNote(single)}`, ok2xx(single) && invalidInput(listed) && fieldsNamed(listed).includes(field) && storedListed.length === 0 && storedSingle.length === 1 && storedSingle[0].address === `a.${stamp}@example.test`, `${said(listed)} ${JSON.stringify(storedListed)} | ${said(single)} ${JSON.stringify(storedSingle)}`);
    }
    const distributions = async () => Number(await val('select count(*)::int from "MeetingDistribution" where "meetingId" = $1', [addressMeeting]));
    const beforeList = await distributions();
    const listedRecipient = await pm('POST', `${AP}/meetings/${addressMeeting}/distribute`, { includeAttendees: false, recipients: [{ name: 'Owner', email: [`r.${stamp}@example.test`, `s.${stamp}@example.test`] }] });
    const afterList = await distributions();
    const oneRecipient = await pm('POST', `${AP}/meetings/${addressMeeting}/distribute`, { includeAttendees: false, recipients: [{ name: 'Owner', email: `r.${stamp}@example.test` }] });
    check(`SHAPE (distribute) a recipient's address as a list is refused 400 VALIDATION_ERROR on recipients[0].email, nothing distributed; one address is distributed${gateNote(oneRecipient)}`, ok2xx(oneRecipient) && invalidInput(listedRecipient) && fieldsNamed(listedRecipient).includes('recipients[0].email') && afterList === beforeList && (await distributions()) > afterList, `${said(listedRecipient)} ${beforeList}->${afterList} | ${said(oneRecipient)}`);

    // What the clients send: the UAT runner's report (approved as the runner approves it), the web form's report and diary.
    const uatActivity = await freshActivity('UAT');
    const runId = `ev6-${stamp}`;
    const uat = await pm('POST', `${AP}/daily-reports`, {
      activityId: uatActivity, date: nextDate(2026), shift: 'day', pctProgress: 80,
      weather: { summary: 'Clear', condition: 'clear', temperatureC: 22, delayImpact: false },
      manpower: [{ trade: 'Concrete', workers: 8, hours: 8 }], materials: [{ name: 'Concrete', qty: 35, unit: 'm3' }], equipment: [{ name: 'Pump', hours: 6 }],
      issues: [{ title: 'Access coordination', severity: 'low', status: 'closed' }],
      photos: [{ fileName: `uat-evidence-${runId}.jpg`, fileUrl: 'https://example.com/uat-evidence.jpg', mimeType: 'image/jpeg', sizeBytes: 1024, description: 'Synthetic UAT evidence reference' }],
      notes: 'UAT daily report.', clientRequestId: `uat-${runId}`, clientCreatedAt: '2026-02-15T08:00:00.000Z', deviceId: 'uat-tablet-01', status: 'submitted',
    });
    const uatApproved = uat.body?.data?.id ? await pm('POST', `${AP}/daily-reports/${uat.body.data.id}/approve`, {}) : { status: 0 };
    const uatRow = await one('select "manpowerJson" as manpower, "equipmentJson" as equipment, "pctProgress" as pct from "DailyReport" where "projectId" = $1 and "clientRequestId" = $2', [A.id, `uat-${runId}`]);
    check('ALLOWED the UAT runner\'s daily report (e2e/uat/run-uat-regression.mjs) is created with its figures as sent and approved', uat.status === 201 && ok2xx(uatApproved) && uatApproved.body?.data?.status === 'approved' && uatRow?.manpower?.[0]?.workers === 8 && uatRow?.manpower?.[0]?.hours === 8 && uatRow?.equipment?.[0]?.hours === 6 && uatRow?.pct === 80, `${said(uat)} | ${said(uatApproved)} | ${JSON.stringify(uatRow)}`);
    const webActivity = await freshActivity('WEB');
    const webDaily = await pm('POST', `${AP}/daily-reports`, {
      activityId: webActivity, date: nextDate(2026), shift: 'day', pctProgress: 10, weather: { summary: 'Clear' },
      manpower: [{ trade: 'crew', workers: 6, hours: 8 }], equipment: [{ equipmentId: ownEquipment, name: 'crane', hours: 3 }, { name: 'site equipment', hours: 1 }],
      materials: [{ name: 'material', qty: 2, unit: 'unit' }], issues: [], photos: [webPhoto], notes: `${STAMP} web daily`, status: 'submitted',
      clientRequestId: `daily-${crypto.randomUUID()}`, clientCreatedAt: new Date().toISOString(), deviceId: `web-${stamp}`,
      progress: { method: 'percent', pctComplete: 10, evidence: { photos: [webPhoto] } },
    });
    check('ALLOWED the web site-reporting form\'s daily report (site-reporting-dashboard.tsx: Number(...) figures, the upload\'s answer as photos) is created (201)', webDaily.status === 201, said(webDaily));
    const webDiary = await pm('POST', `${AP}/site-diaries`, {
      date: nextDate(2026), shift: 'day', weather: 'Clear', weatherDetails: { summary: 'Clear' }, workers: 12, visitors: '', workDone: `${STAMP} slab`, issues: '', issueItems: [], instructions: '',
      manpower: [{ trade: 'crew', workers: 4, hours: 8 }], equipment: [{ equipmentId: ownEquipment, name: 'crane', hours: 2 }], materials: [{ name: 'material', qty: 2, unit: 'unit' }],
      photos: [webPhoto], notes: `${STAMP} web diary`, status: 'submitted', clientRequestId: `diary-${crypto.randomUUID()}`, clientCreatedAt: new Date().toISOString(), deviceId: `web-${stamp}`,
    });
    check('ALLOWED the web site-reporting form\'s site diary is created (201)', webDiary.status === 201, said(webDiary));
  }

  // ══ 4. the UAT runner's meeting ═══════════════════════════════════════════
  section = '4 uat meeting';
  console.log('\n── 4. the UAT runner\'s meeting uses the words the meeting API and the web meetings page use ──');
  if (runs()) {
    const meetingService = require('../../../src/services/meeting.service');
    const runner = fs.readFileSync(path.join(REPO, 'e2e', 'uat', 'run-uat-regression.mjs'), 'utf8');
    const start = runner.indexOf('async function runMeetingMinutesFlow');
    const flow = start === -1 ? '' : runner.slice(start, runner.indexOf('\nasync function ', start + 10) === -1 ? undefined : runner.indexOf('\nasync function ', start + 10));
    const attendance = [...flow.matchAll(/attendanceStatus:\s*"([^"]+)"/g)].map((m) => m[1]);
    const agendaBlock = /agendaItems:\s*\[([\s\S]*?)\]/.exec(flow)?.[1] || '';
    const agenda = [...agendaBlock.matchAll(/status:\s*"([^"]+)"/g)].map((m) => m[1]);
    check(`the runner's meeting sends attendance ${JSON.stringify(attendance)} and agenda ${JSON.stringify(agenda)} — each a word the API takes (${meetingService.ATTENDANCE_STATUSES.join('/')}; ${meetingService.AGENDA_STATUSES.join('/')})`, attendance.length === 2 && agenda.length === 1 && attendance.every((w) => meetingService.ATTENDANCE_STATUSES.includes(w)) && agenda.every((w) => meetingService.AGENDA_STATUSES.includes(w)));
    const web = fs.readFileSync(path.join(REPO, 'frontend', 'src', 'features', 'meetings', 'data', 'schema.ts'), 'utf8');
    const webAttendance = (/attendanceStatus:\s*([^\n]+)/.exec(web)?.[1].match(/'([a-z_]+)'/g) || []).map((w) => w.slice(1, -1));
    const webAgenda = (/status:\s*('open'[^\n]+)/.exec(web)?.[1].match(/'([a-z_]+)'/g) || []).map((w) => w.slice(1, -1));
    check(`the web meetings page's words are the API's: attendance ${JSON.stringify(webAttendance)}, agenda ${JSON.stringify(webAgenda)} (frontend/src/features/meetings/data/schema.ts) — the API is not widened`, JSON.stringify([...webAttendance].sort()) === JSON.stringify([...meetingService.ATTENDANCE_STATUSES].sort()) && JSON.stringify([...webAgenda].sort()) === JSON.stringify([...meetingService.AGENDA_STATUSES].sort()));

    const uatActivity = await freshActivity('UAT MEETING');
    const suffix = stamp.replace(/[^a-z0-9]/g, '').slice(-10);
    const body = (attendanceStatus, agendaStatus) => ({
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
    // The runner's words before evidence-6: still refused — the API was not widened to take them.
    const old = await pm('POST', `${AP}/meetings`, { ...body('present', 'closed'), title: `UAT coordination minutes ${suffix} old` });
    check('the words the runner sent before (\'present\', \'closed\') are still refused 400 VALIDATION_ERROR on those three fields only — the API is not widened', invalidInput(old) && JSON.stringify(fieldsNamed(old).sort()) === JSON.stringify(['agendaItems[0].status', 'attendees[0].attendanceStatus', 'attendees[1].attendanceStatus']), said(old));
    const meeting = await pm('POST', `${AP}/meetings`, body(attendance[0], agenda[0]));
    const created = meeting.body?.data;
    const stored = created?.id ? await q('select "attendanceStatus" as status from "MeetingAttendee" where "meetingId" = $1', [created.id]) : [];
    check(`ALLOWED the runner's meeting, as it now sends it, is created (201) with a meeting number, its agenda item (${agenda[0]}), decision and action item linked to a task with its due date; both attendees stored ${attendance[0]}`, meeting.status === 201 && created?.meetingNumber && created?.agendaItems?.length === 1 && created.agendaItems[0].status === agenda[0] && created?.decisions?.length === 1 && created?.actionItems?.[0]?.taskId && created.actionItems[0].task?.taskNumber && String(created.actionItems[0].dueDate).startsWith('2026-02-21') && stored.length === 2 && stored.every((r) => r.status === attendance[0]), `${said(meeting)} ${JSON.stringify(stored)}`);
    const distribution = created?.id ? await pm('POST', `${AP}/meetings/${created.id}/distribute`, { includeAttendees: true, message: 'UAT minutes distributed for contractual record.', recipients: [{ name: 'UAT Owner', email: `owner.${suffix}@pmcopilots.test`, companyName: 'UAT Owner' }] }) : { status: 0 };
    const comment = created?.id ? await pm('POST', `${AP}/meetings/${created.id}/comments`, { body: 'UAT owner distribution acknowledged.', activityId: uatActivity }) : { status: 0 };
    check('ALLOWED the runner\'s meeting is distributed (status distributed) and commented as the runner does', ok2xx(distribution) && distribution.body?.data?.meeting?.status === 'distributed' && comment.status === 201, `${said(distribution)} | ${said(comment)}`);
    // The web meetings page's payload (meetings-dashboard.tsx toPayload): sortOrder index + 1, its words.
    const webMeeting = await pm('POST', `${AP}/meetings`, {
      title: `EV6 ${STAMP} web meeting`, meetingType: 'coordination', status: 'draft', location: null, scheduledAt: new Date('2026-03-02T09:30').toISOString(), nextMeetingAt: null, activityId: null, objective: null, minutesText: null,
      attendees: [{ name: 'Site Engineer', email: null, companyName: null, role: 'attendee', attendanceStatus: 'attended', distributionRequired: true }],
      agendaItems: [{ activityId: null, sortOrder: 1, title: 'Access', notes: null, status: 'covered' }, { activityId: null, sortOrder: 2, title: 'Pump', notes: null, status: 'deferred' }],
      decisions: [{ activityId: null, title: 'Gate', decision: 'Use the south gate', impact: null, decidedAt: new Date().toISOString() }],
      actionItems: [{ activityId: null, taskId: null, itemNumber: 'AI-001', title: 'Sketch', description: null, ownerName: 'Site', ownerEmail: null, dueDate: '2026-03-09', priority: 'medium', status: 'open', createTask: false }],
    });
    check('ALLOWED the web meetings page\'s payload (sortOrder 1 and 2, its words) is created (201)', webMeeting.status === 201 && webMeeting.body?.data?.agendaItems?.map((i) => i.sortOrder).join(',') === '1,2', said(webMeeting));
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
  const leaked = attack.map((a) => [a, a.leak !== undefined ? a.leak : leakOf(a.text, a.sent)]).filter(([, l]) => l);
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
