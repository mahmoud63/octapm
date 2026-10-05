'use strict';

/**
 * The live proof of CERT-2 group "robustness-6": the last 5xx classes — date
 * instants, deep JSON, multipart objects, code faults told from input errors,
 * text and figure chains.
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/robustness-6-proof.js [attacker=044] [victim=045]
 *   CERT_INPROCESS=1 node scripts/cert/isolation/robustness-6-proof.js 044 045 --only="dates|deep" --no-fingerprint
 *
 * Attacker company 044 acts on its own records; victim company 045 is read
 * only and must be untouched. Every REFUSED check is gated on the attacker's
 * own request succeeding on the same record (or, where no record of the kind
 * exists anywhere, on the own request getting past the door to the service's
 * own answer); where an identifier is involved a foreign one (company 045's) is
 * compared with one that exists nowhere; the database is read back; no answer
 * may carry a victim trace and none may be a 5xx; company 045's data must not
 * change (fingerprint, before and after).
 *
 * PART D — instants. dateInput checked the written year, not the instant's:
 *   "9999-12-31T23:59:59-14:00" is 10000-01-01T13:59:59Z, which the query
 *   engine cannot convert (500 at the write and in a filter); "0001-01-01T00:00
 *   :00+14:00" is year 0 and was stored before the common era. On an RFI's
 *   dueDate, a transmittal's dueDate / transmittedOn, ?dueAfter, /search's
 *   date parameters and dob: each 400 naming the field, nothing stored, no
 *   reference drawn; the edges inside (…+14:00 on the last day, …+14:00 at
 *   14:00 on the first) are stored as Date reads them.
 * PART J — deep JSON and conversion keys. A body nested 5,000 levels answered
 *   500 (Maximum call stack size exceeded); it is refused 400 at 257 levels,
 *   fast; a body at the limit passes the guard and what Prisma cannot store
 *   is still a 400 (the handler's value refusal, live). An object with its
 *   own toString / valueOf key made every conversion throw (500) — refused
 *   400 anywhere in the body, also before the inbound-email door verifies
 *   the provider.
 * PART M — multipart. A field named x[k] (multer's object with no prototype)
 *   answered 500 on attachments and sheet revisions; x[k], x[] and a field
 *   sent twice are refused 400 naming the field, nothing stored; repeated
 *   tags (the mobile app's) are still stored as a list.
 * PART E — errors, on the query engine itself: Prisma's value refusals are 400
 *   and its schema-usage faults (unknown argument / field / include, missing
 *   argument) are 500, never with Prisma's text; the engine's refusal to
 *   convert a year-10000 Date or a Decimal NaN is 400.
 * PART T — text chains. A transmittal's subject / sender / recipient / ref /
 *   notes, an RFI's subject, and the text fields services trim (NCR
 *   description, defect trade, material-test labName, ITP notes, safety
 *   severity, cash-flow note, budget-revision notes, weekly-report remarks):
 *   an array, an object, a number or a boolean is refused 400 naming the
 *   field before any reference is drawn (they were 400 after the draw, 500 in
 *   trim(), or stored as "[object Object]").
 * PART F — figures. Integers bounded to INT4 (activity earlyStart … duration
 *   2147483648), money to Decimal(18,2) ("1e400" on a direct cost's tax and
 *   line amount, an RFI's costImpactAmount, a commitment's value — stored as
 *   0 or NULL before), the public bid portal's line rate ([1,1] was priced
 *   11): each 400 naming the field, nothing stored.
 * PART P — performance: the guard on a 2.2 MB legitimate body, against HEAD's.
 *
 * Final line "robustness-6 proof: N passed, M failed of T"; exit 0 on all pass.
 * Re-runnable: every record is fresh and carries this run's stamp.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { as, raw, multipart } = require('../lib/api');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');

const GROUP = 'robustness-6';
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ATTACKER = positional[0] || '044';
const VICTIM = positional[1] || '045';
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7) || null;
const FINGERPRINT = !process.argv.includes('--no-fingerprint');
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `R6-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const INPROCESS = process.env.CERT_INPROCESS === '1';
const NOWHERE = '00000000-0000-4000-8000-00000000d1ed';
const WORKTREE = path.join(__dirname, '..', '..', '..', '..');
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const results = [];
const answers = [];
let currentCase = 'setup';
const check = (name, ok, detail = '') => {
  results.push({ case: currentCase, name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n        ${detail}` : ''}`);
};
const want = (name) => !ONLY || new RegExp(ONLY).test(name);
const firstLine = (text) => String(text || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
const said = (res) => `${res.status} ${res.body?.error?.code || ''} ${firstLine(res.body?.error?.message).slice(0, 100)}`.trim();
const ok2xx = (res) => Boolean(res) && res.status >= 200 && res.status < 300;
const gated = (gate, name, ok, detail = '') =>
  check(`${name} [gated]`, ok2xx(gate) && ok, ok2xx(gate) ? detail : `NOT GATED — the own request was not accepted (${gate ? said(gate) : 'nothing sent'}); ${detail}`);
/** The fields a 400 VALIDATION_ERROR names (outside production the details are sent). */
const fieldsNamed = (res) => (res?.body?.error?.code === 'VALIDATION_ERROR' ? (res.body.error.details || []).map((d) => d.field) : []);
const refusedNaming = (res, field) => res.status === 400 && res.body?.error?.code === 'VALIDATION_ERROR' && fieldsNamed(res).includes(field);
const failing = (list, field) => list.filter(([, r]) => !refusedNaming(r, field)).map(([l, r]) => `${l}: ${said(r)} ${JSON.stringify(fieldsNamed(r))}`).join(' | ');
const DB_INPUT = 'The request contains a value that cannot be stored.';
const DEPTH = 'The request body is nested more than 256 levels deep.';
const KEY = 'The request contains a field named toString or valueOf, which is not allowed.';
/** Prisma's, the engine's or the database's own words, or a source path. */
const PRISMA_TEXT = /Invalid `|invocation|PrismaClient|PostgresError|ConnectorError|Unique constraint|Foreign key|\.service\.js|INT4|numeric field overflow|InvalidArg|Provided Date object|Unknown argument|is missing\.|ArgumentValue|\$type|Maximum call stack|Cannot convert object/;

// The product's local e-mail transport and the development error log write to the console in process.
const print = console.log.bind(console);
console.log = (...args) => {
  const text = args.map(String).join(' ');
  if (text.startsWith('[email:local]')) return;
  print(...args);
};
console.error = () => {};

const main = async () => {
  print(`${GROUP} proof — attacker ${ATTACKER}, victim ${VICTIM}, stamp ${STAMP}${INPROCESS ? ', in process (the working tree\'s code)' : ' — NOT in process: this asks a running API, which does not prove the working tree'}${ONLY ? `, only /${ONLY}/` : ''}${FINGERPRINT ? '' : ', no fingerprint'}\n`);
  const inventory = (code) => JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'inventory', `${code}.json`), 'utf8'));
  const inv = inventory(ATTACKER);
  const A = Object.values(inv.projects).find((p) => p.depth === 'standard' && p.refs?.activities && p.refs?.inventory?.warehouses?.site);
  if (!A) throw new Error(`company ${ATTACKER} needs a standard project with activities`);
  const AP = `/projects/${A.id}`;

  const db = await guard.connectCert();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => (await q(sql, args))[0] || null;
  const val = async (sql, args = []) => { const row = await one(sql, args); return row ? Object.values(row)[0] : null; };
  const orgOf = async (code) => val('select id from "Organisation" where slug like $1', [`cert-${code}-%`]);
  const attackerOrg = await orgOf(ATTACKER);
  const victimOrg = await orgOf(VICTIM);
  check(`setup: both companies exist (${ATTACKER} ${attackerOrg}, ${VICTIM} ${victimOrg})`, Boolean(attackerOrg && victimOrg));
  check(`setup: project ${A.id} is company ${ATTACKER}'s`, (await val('select "orgId" from "Project" where id = $1', [A.id])) === attackerOrg);
  const foreign = {
    project: await val('select id from "Project" where "orgId" = $1 order by "createdAt" limit 1', [victimOrg]),
    rfi: await val('select r.id from "Rfi" r join "Project" p on p.id = r."projectId" where p."orgId" = $1 order by r."createdAt" limit 1', [victimOrg]),
    activity: await val('select a.id from "Activity" a join "Project" p on p.id = a."projectId" where p."orgId" = $1 order by a."createdAt" limit 1', [victimOrg]),
    packageLine: await val('select id from "BidPackageLine" where "orgId" = $1 order by "createdAt" limit 1', [victimOrg]),
  };
  check(`setup: company ${VICTIM}'s project, RFI, activity and bid line are known`, Boolean(foreign.project && foreign.rfi && foreign.activity && foreign.packageLine), JSON.stringify(foreign));
  const foreignIds = Object.values(foreign).filter(Boolean);

  const who = (role) => as(`${role}@c${ATTACKER}.octapm-cert.test`);
  const pm = who('pm');
  const site = who('site');
  const cost = who('cost');
  const ask = async (person, method, route, body, options) => {
    const res = await person.send(method, route, body, options);
    answers.push({ route: `${method} ${route.split('?')[0]}`, status: res.status, text: res.text || '', sent: `${route} ${body === undefined ? '' : typeof body === 'string' ? body.slice(0, 2000) : JSON.stringify(body)}` });
    return res;
  };
  const anonymous = async (method, route, json) => {
    const res = await raw(method, route, { json });
    answers.push({ route: `anonymous ${method} ${route.replace(/bids\/[^/?]+/, 'bids/<token>').split('?')[0]}`, status: res.status, text: res.text || '', sent: JSON.stringify(json || '') });
    return res;
  };
  const noPrisma = (res) => !PRISMA_TEXT.test(res.text || '');
  const counter = async (table, prefix) => Number(await val('select next from "ReferenceCounter" where scope = $1', [`projectId:${A.id}|${table}|${prefix}`]) || 0);
  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    try {
      return await fingerprint.take(db);
    } finally {
      await db.query('rollback');
    }
  };
  const runStart = FINGERPRINT ? await snapshot() : null;
  // Prisma keeps a DateTime as the UTC wall clock in a timestamp without time zone: read it as such.
  const utc = (column) => `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"BC')`;

  // ── PART D: instants ────────────────────────────────────────────────────────
  currentCase = 'dates';
  if (want('dates')) {
    print('\n── dates: the instant\'s year (UTC) is 1..9999, not only the written one ──');
    const OUT = [['…23:59:59-14:00 (10000-01-01T13:59:59Z)', '9999-12-31T23:59:59-14:00'], ['…23:00-0100 (10000-01-01T00:00Z)', '9999-12-31T23:00-0100'], ['0001-01-01T00:00:00+14:00 (year 0)', '0001-01-01T00:00:00+14:00'], ['0001-01-01T13:59:59+14:00 (one second before year 1)', '0001-01-01T13:59:59+14:00']];

    // D1 an RFI's dueDate: nothing stored, no reference drawn; the edges inside stored as read.
    const rfiCounter0 = await counter('Rfi', 'RFI');
    const d1 = [];
    for (const [label, value] of OUT) d1.push([label, await ask(site, 'POST', `${AP}/rfi`, { subject: `${STAMP} D1 out ${label}`, question: 'q?', dueDate: value })]);
    const rfiCounter1 = await counter('Rfi', 'RFI');
    const IN = [['last day +14:00', '9999-12-31T23:59:59+14:00', '9999-12-31T09:59:59.000ZAD'], ['first day +14:00 at 14:00', '0001-01-01T14:00:00+14:00', '0001-01-01T00:00:00.000ZAD']];
    const d1in = [];
    for (const [label, value] of IN) d1in.push([label, await ask(site, 'POST', `${AP}/rfi`, { subject: `${STAMP} D1 in ${label}`, question: 'q?', dueDate: value })]);
    gated(d1in[0][1], `D1 POST rfi dueDate at ${OUT.length} instants outside years 1-9999 (were 500 / stored as year 0): each 400 naming dueDate`, d1.every(([, r]) => refusedNaming(r, 'dueDate')), failing(d1, 'dueDate'));
    const d1rows = await q(`select subject, ${utc('"dueDate"')} as due from "Rfi" where "projectId" = $1 and subject like $2`, [A.id, `${STAMP} D1 %`]);
    check('D1 read back: nothing of the refused RFIs, no RFI reference drawn for them; the inside edges stored as Date reads them',
      d1rows.every((r) => r.subject.includes(' D1 in ')) && rfiCounter1 === rfiCounter0 && IN.every(([label, , stored]) => d1rows.find((r) => r.subject === `${STAMP} D1 in ${label}`)?.due === stored),
      `${JSON.stringify(d1rows)}; counter ${rfiCounter0} -> ${rfiCounter1}`);

    // D2 a transmittal's dates.
    const trCounter0 = await counter('Transmittal', 'TRM');
    const d2 = [];
    for (const field of ['dueDate', 'transmittedOn', 'acknowledgedOn']) for (const [label, value] of OUT.slice(0, 3)) d2.push([`${field} ${label}`, await ask(pm, 'POST', `${AP}/transmittals`, { subject: `${STAMP} D2 ${field} ${label}`, sender: 'R6', recipient: 'R6', [field]: value }), field]);
    const trCounter1 = await counter('Transmittal', 'TRM');
    const d2gate = await ask(pm, 'POST', `${AP}/transmittals`, { subject: `${STAMP} D2 own`, sender: 'R6', recipient: 'R6', dueDate: '9999-12-31T22:00-0100' });
    gated(d2gate, 'D2 POST transmittals dueDate / transmittedOn / acknowledgedOn at an instant outside years 1-9999: each 400 naming the field, no reference drawn',
      d2.every(([, r, f]) => refusedNaming(r, f)) && trCounter1 === trCounter0, `${d2.filter(([, r, f]) => !refusedNaming(r, f)).map(([l, r]) => `${l}: ${said(r)}`).join(' | ')} counter ${trCounter0} -> ${trCounter1}`);
    const d2rows = await q(`select subject, ${utc('"dueDate"')} as due from "Transmittal" where "projectId" = $1 and subject like $2`, [A.id, `${STAMP} D2%`]);
    check('D2 read back: only the own transmittal, its due date 9999-12-31T23:00Z (the -01:00 edge inside)', d2rows.length === 1 && d2rows[0].due === '9999-12-31T23:00:00.000ZAD', JSON.stringify(d2rows));

    // D3 a filter: ?dueAfter.
    const d3gate = await ask(pm, 'GET', `${AP}/rfi?dueAfter=${encodeURIComponent('9999-12-31T23:59:59Z')}`);
    const d3 = [];
    for (const [label, value] of OUT) d3.push([label, await ask(pm, 'GET', `${AP}/rfi?dueAfter=${encodeURIComponent(value)}`)]);
    gated(d3gate, 'D3 GET rfi?dueAfter at an instant outside years 1-9999 (was 500 in the filter): each 400 naming dueAfter', d3.every(([, r]) => refusedNaming(r, 'dueAfter')), failing(d3, 'dueAfter'));

    // D4 /search's date parameters; a victim project with the bad date is answered as a project that exists nowhere.
    const d4gate = await ask(pm, 'GET', `/search?q=slab&updatedAfter=${encodeURIComponent('0001-01-01T14:00:00+14:00')}&dateTo=${encodeURIComponent('9999-12-31T23:59:59+14:00')}`);
    const d4 = [];
    for (const field of ['updatedAfter', 'updatedBefore', 'dateFrom', 'dateTo', 'from', 'to']) for (const [label, value] of [OUT[0], OUT[2]]) d4.push([`${field} ${label}`, await ask(pm, 'GET', `/search?q=slab&${field}=${encodeURIComponent(value)}`), field]);
    gated(d4gate, 'D4 GET /search updatedAfter / updatedBefore / dateFrom / dateTo / from / to at an instant outside years 1-9999 (were 500): each 400 naming the parameter',
      d4.every(([, r, f]) => refusedNaming(r, f)), d4.filter(([, r, f]) => !refusedNaming(r, f)).map(([l, r]) => `${l}: ${said(r)}`).join(' | '));
    const d4f = await ask(pm, 'GET', `/search?q=slab&projectId=${foreign.project}&dateTo=${encodeURIComponent(OUT[0][1])}`);
    const d4n = await ask(pm, 'GET', `/search?q=slab&projectId=${NOWHERE}&dateTo=${encodeURIComponent(OUT[0][1])}`);
    check(`D4 /search with company ${VICTIM}'s project and the bad instant is answered exactly as with a project that exists nowhere (400 at the door)`, said(d4f) === said(d4n) && d4f.status === 400, `foreign ${said(d4f)} | nowhere ${said(d4n)}`);

    // D5 dob.
    const me = await one('select u.id, u.name, s.language from "User" u left join "UserSetting" s on s."userId" = u.id where u.email = $1', [`pm@c${ATTACKER}.octapm-cert.test`]);
    const dobOf = `select ${utc('"dateOfBirth"')} as dob from "UserSetting" where "userId" = $1`;
    const account = (dob) => ({ name: me.name.slice(0, 30), dob, language: me.language || 'en' });
    const dobBefore = (await one(dobOf, [me.id]))?.dob ?? null;
    const d5 = [];
    for (const [label, value] of OUT) d5.push([label, await ask(pm, 'PATCH', '/auth/me/account', account(value))]);
    const dobAfter = (await one(dobOf, [me.id]))?.dob ?? null;
    const d5gate = await ask(pm, 'PATCH', '/auth/me/account', account('1990-05-17'));
    const dobStored = (await one(dobOf, [me.id]))?.dob ?? null;
    const restore = await ask(pm, 'PATCH', '/auth/me/account', account(dobBefore ? dobBefore.slice(0, 10) : null));
    const dobRestored = (await one(dobOf, [me.id]))?.dob ?? null;
    gated(d5gate, 'D5 PATCH /auth/me/account dob at an instant outside years 1-9999 (was 500): each 400 naming dob, the stored date of birth untouched', d5.every(([, r]) => refusedNaming(r, 'dob')) && dobBefore === dobAfter, failing(d5, 'dob'));
    check('D5 read back: the own dob stored as sent, then put back as it was', dobStored === '1990-05-17T00:00:00.000ZAD' && ok2xx(restore) && dobRestored === dobBefore, `${dobStored}; restore ${said(restore)} -> ${dobRestored} (was ${dobBefore})`);
  }

  // ── PART J: deep JSON and conversion keys ───────────────────────────────────
  currentCase = 'deep json';
  if (want('deep')) {
    print('\n── deep JSON: refused past 256 levels, fast; toString / valueOf keys refused ──');
    // Built as text: JSON.stringify itself recurses (the client overflows at a few thousand levels).
    // The body is level 1, documentsJson's outermost object level 2: a body nested `bodyLevels` deep.
    const transmittalAt = (bodyLevels, subject) => `{"subject":"${subject}","sender":"R6","recipient":"R6","documentsJson":${'{"n":'.repeat(bodyLevels - 1)}"leaf"${'}'.repeat(bodyLevels - 1)}}`;
    const j1gate = await ask(pm, 'POST', `${AP}/transmittals`, transmittalAt(60, `${STAMP} J1 own`));
    const over = await ask(pm, 'POST', `${AP}/transmittals`, transmittalAt(257, `${STAMP} J1 257`));
    const t0 = Date.now();
    const deep5k = await ask(pm, 'POST', `${AP}/transmittals`, transmittalAt(5000, `${STAMP} J1 5000`));
    const deepArray = await ask(site, 'POST', `${AP}/rfi`, `{"subject":${'['.repeat(100000)}1${']'.repeat(100000)},"question":"q"}`);
    const elapsed = Date.now() - t0;
    gated(j1gate, 'J1 a body nested 257 and 5,000 levels (objects) and 100,000 (arrays in an RFI subject) (5,000 was 500 "Maximum call stack size exceeded"): 400 VALIDATION_ERROR, the depth sentence',
      [over, deep5k, deepArray].every((r) => r.status === 400 && r.body?.error?.message === DEPTH), [over, deep5k, deepArray].map(said).join(' | '));
    check(`J1 the 5,000- and 100,000-level bodies are refused in ${elapsed} ms (under 3 s together)`, elapsed < 3000, `${elapsed} ms`);
    const j1rows = await q('select subject, jsonb_path_query_first("documentsJson"::jsonb, \'strict $.**\') is not null as has from "Transmittal" where "projectId" = $1 and subject like $2', [A.id, `${STAMP} J1%`]);
    check('J1 read back: only the own 60-level transmittal is stored, with its document tree', j1rows.length === 1 && j1rows[0].subject === `${STAMP} J1 own`, JSON.stringify(j1rows));
    const rfiDeep = Number(await val('select count(*)::int from "Rfi" where "projectId" = $1 and question = $2 and "createdAt" > now() - interval \'1 hour\' and subject like $3', [A.id, 'q', '%[%']));
    check('J1 read back: no RFI from the 100,000-level body', rfiDeep === 0, String(rfiDeep));

    // J2 a body exactly at the limit passes the guard; Prisma's own JSON limit (~128) refuses it — the handler's value refusal, live.
    const atLimit = await ask(pm, 'POST', `${AP}/transmittals`, transmittalAt(256, `${STAMP} J2 256`));
    gated(j1gate, 'J2 a body nested exactly 256 levels passes the guard; the query engine cannot store a JSON that deep: 400 VALIDATION_ERROR, the generic sentence, no Prisma text (never 500)',
      atLimit.status === 400 && atLimit.body?.error?.message === DB_INPUT && noPrisma(atLimit), `${said(atLimit)} prismaText=${!noPrisma(atLimit)}`);
    check('J2 read back: nothing stored for it', Number(await val('select count(*)::int from "Transmittal" where "projectId" = $1 and subject = $2', [A.id, `${STAMP} J2 256`])) === 0);

    // J3 own toString / valueOf keys.
    const j3gate = await ask(site, 'POST', `${AP}/rfi`, { subject: `${STAMP} J3 toString`, question: 'valueOf' });
    const j3 = [
      ['RFI subject {"toString":null}', await ask(site, 'POST', `${AP}/rfi`, `{"subject":{"toString":null},"question":"${STAMP} J3 a"}`)],
      ['RFI owner {"toString":0} (an isString().trim() chain)', await ask(site, 'POST', `${AP}/rfi`, `{"subject":"${STAMP} J3 b","question":"q","owner":{"toString":0}}`)],
      ['transmittal method {"toString":"x"} (an isIn chain)', await ask(pm, 'POST', `${AP}/transmittals`, `{"subject":"${STAMP} J3 c","sender":"R6","recipient":"R6","method":{"toString":"x"}}`)],
      ['direct cost lines[0].amount {"valueOf":1,"toString":false}', await ask(cost, 'POST', `${AP}/direct-costs`, `{"type":"invoice","description":"${STAMP} J3 d","costDate":"${day(0)}","lines":[{"description":"l","amount":{"valueOf":1,"toString":false}}]}`)],
      ['a key deep in documentsJson', await ask(pm, 'POST', `${AP}/transmittals`, `{"subject":"${STAMP} J3 e","sender":"R6","recipient":"R6","documentsJson":{"a":[{"b":{"valueOf":null}}]}}`)],
    ];
    gated(j3gate, 'J3 an object with its own toString / valueOf key, at any depth (were 500 "Cannot convert object to primitive value"): 400 VALIDATION_ERROR, the key sentence',
      j3.every(([, r]) => r.status === 400 && r.body?.error?.message === KEY), j3.filter(([, r]) => r.body?.error?.message !== KEY).map(([l, r]) => `${l}: ${said(r)}`).join(' | '));
    const j3f = await ask(site, 'POST', `${AP}/rfi`, { subject: { toString: null }, question: 'q', activityId: foreign.activity });
    const j3n = await ask(site, 'POST', `${AP}/rfi`, { subject: { toString: null }, question: 'q', activityId: NOWHERE });
    check(`J3 with company ${VICTIM}'s activity beside the key, the answer is exactly the one with an activity that exists nowhere`, said(j3f) === said(j3n) && j3f.status === 400, `foreign ${said(j3f)} | nowhere ${said(j3n)}`);
    const j3rows = Number(await val('select count(*)::int from "Rfi" where "projectId" = $1 and (question like $2 or subject like $3)', [A.id, `${STAMP} J3 a%`, `${STAMP} J3 b%`])) + Number(await val('select count(*)::int from "Transmittal" where "projectId" = $1 and subject like $2', [A.id, `${STAMP} J3 %`])) + Number(await val('select count(*)::int from "DirectCost" where "projectId" = $1 and description like $2', [A.id, `${STAMP} J3 %`]));
    check('J3 read back: nothing of the refused requests; the own RFI\'s subject is the word "toString" and its question "valueOf"', j3rows === 0 && (await val('select question from "Rfi" where "projectId" = $1 and subject = $2', [A.id, `${STAMP} J3 toString`])) === 'valueOf', `stored refused rows ${j3rows}`);

    // J4 the inbound-email door: a body the verification cannot read is refused before verification.
    if (INPROCESS) {
      if (!process.env.INBOUND_MAILGUN_SIGNING_KEY) process.env.INBOUND_MAILGUN_SIGNING_KEY = `r6-proof-${crypto.randomBytes(8).toString('hex')}`;
      const wrongSignature = await anonymous('POST', '/public/inbound-email/mailgun', { signature: { timestamp: '1', token: 't', signature: 'not-it' } });
      const keyed = await anonymous('POST', '/public/inbound-email/mailgun', JSON.parse('{"signature":{"timestamp":{"toString":null},"token":"t","signature":"s"}}'));
      const deepMail = await anonymous('POST', '/public/inbound-email/mailgun', `{"signature":{"timestamp":"1","token":"t","signature":"s"},"x":${'['.repeat(5000)}1${']'.repeat(5000)}}`);
      check('J4 inbound e-mail (mailgun): a wrongly signed payload is 401 (verification reached)', wrongSignature.status === 401, said(wrongSignature));
      check('J4 inbound e-mail: a signature whose timestamp has its own toString key (was 500 in `${timestamp}${token}`), and a body nested 5,000 levels: 400 before verification',
        keyed.status === 400 && keyed.body?.error?.message === KEY && deepMail.status === 400 && deepMail.body?.error?.message === DEPTH, `${said(keyed)} | ${said(deepMail)}`);
    }
  }

  // ── PART M: multipart ────────────────────────────────────────────────────────
  currentCase = 'multipart';
  if (want('multipart')) {
    print('\n── multipart: one string per field (tags and documentIds may repeat) ──');
    const rfi = await ask(site, 'POST', `${AP}/rfi`, { subject: `${STAMP} M own`, question: 'q?' });
    const rfiId = rfi.body?.data?.id;
    check('M setup: the own RFI to attach to is created', ok2xx(rfi) && Boolean(rfiId), said(rfi));
    const form = (fields, repeated = []) => {
      const f = multipart({ field: 'files', filename: `${STAMP.toLowerCase()}.png`, contentType: 'image/png', body: PNG_1X1, fields });
      for (const [k, v] of repeated) f.append(k, v);
      return { form: f };
    };
    const attached = async () => Number(await val('select count(*)::int from "Attachment" where "recordType" = $1 and "recordId" = $2', ['rfi', rfiId]));
    const before = await attached();
    const base = { recordType: 'rfi', recordId: rfiId, caption: `${STAMP} M refused` };
    const m1 = [];
    for (const field of ['caption', 'recordId', 'recordType', 'clientRequestId']) {
      const fields = { ...base };
      delete fields[field];
      fields[`${field}[k]`] = field === 'recordId' ? rfiId : field === 'recordType' ? 'rfi' : `${STAMP}-x`;
      m1.push([`${field}[k]`, await ask(site, 'POST', `${AP}/attachments`, undefined, form(fields)), field]);
    }
    m1.push(['caption[]', await ask(site, 'POST', `${AP}/attachments`, undefined, form({ recordType: 'rfi', recordId: rfiId, 'caption[]': 'x' })), 'caption']);
    m1.push(['caption sent twice', await ask(site, 'POST', `${AP}/attachments`, undefined, form({ recordType: 'rfi', recordId: rfiId }, [['caption', 'a'], ['caption', 'b']])), 'caption']);
    m1.push(['tags[k]', await ask(site, 'POST', `${AP}/attachments`, undefined, form({ recordType: 'rfi', recordId: rfiId, 'tags[k]': 'x' })), 'tags']);
    const afterRefused = await attached();
    const gate = await ask(site, 'POST', `${AP}/attachments`, undefined, form({ recordType: 'rfi', recordId: rfiId, caption: `${STAMP} M own photo`, clientRequestId: `${STAMP}-M` }, [['tags', 'pour'], ['tags', 'slab']]));
    gated(gate, 'M1 POST attachments with caption[k] / recordId[k] / recordType[k] / clientRequestId[k] (were 500), caption[], caption twice, tags[k]: each 400 naming the field',
      m1.every(([, r, f]) => refusedNaming(r, f)), m1.filter(([, r, f]) => !refusedNaming(r, f)).map(([l, r]) => `${l}: ${said(r)} ${JSON.stringify(fieldsNamed(r))}`).join(' | '));
    const photo = await one('select p.caption, p.tags from "Photo" p join "Attachment" a on a."documentId" = p."documentId" where a."recordType" = $1 and a."recordId" = $2 and a."clientRequestId" = $3', ['rfi', rfiId, `${STAMP}-M`]);
    check('M1 read back: nothing attached by the refused uploads; the own upload (tags repeated, as the mobile app sends them) stored with its caption and both tags',
      afterRefused === before && (await attached()) === before + 1 && JSON.stringify(photo?.tags) === JSON.stringify(['pour', 'slab']), `attachments ${before} -> ${afterRefused} -> ${await attached()}; photo ${JSON.stringify(photo)}`);
    const mf = await ask(site, 'POST', `${AP}/attachments`, undefined, form({ recordType: 'rfi', 'recordId[k]': foreign.rfi }));
    const mn = await ask(site, 'POST', `${AP}/attachments`, undefined, form({ recordType: 'rfi', 'recordId[k]': NOWHERE }));
    check(`M1 recordId[k] holding company ${VICTIM}'s RFI is answered exactly as one holding an RFI that exists nowhere (400 at the guard)`, said(mf) === said(mn) && mf.status === 400 && JSON.stringify(fieldsNamed(mf)) === JSON.stringify(fieldsNamed(mn)), `foreign ${said(mf)} | nowhere ${said(mn)}`);

    // M2 a sheet revision's pageNumber[k]. No sheet exists in the population (the drawing-set job never ran):
    // the gate is the same upload with pageNumber=1 getting past the door to the service's own answer.
    const sheets = Number(await val('select count(*)::int from "Sheet" where "orgId" = any($1::text[])', [[attackerOrg, victimOrg]]));
    const pdf = (fields) => ({ form: multipart({ field: 'file', filename: `${STAMP.toLowerCase()}.pdf`, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4\n%%EOF\n'), fields }) });
    const sheetId = (await val('select id from "Sheet" where "projectId" = $1 limit 1', [A.id])) || NOWHERE;
    const m2gate = await ask(pm, 'POST', `${AP}/drawings/sheets/${sheetId}/revisions`, undefined, pdf({ revision: 'Z9', pageNumber: '1' }));
    const m2 = await ask(pm, 'POST', `${AP}/drawings/sheets/${sheetId}/revisions`, undefined, pdf({ revision: 'Z9', 'pageNumber[k]': '1' }));
    const m2b = await ask(pm, 'POST', `${AP}/drawings/sheets/${sheetId}/revisions`, undefined, pdf({ 'revision[k]': 'Z9', pageNumber: '1' }));
    const pastDoor = m2gate.status !== 400 && m2gate.status < 500;
    // pageNumber's chain is a figure's: scalarFigure, then bail — with the multipart guard off it is still refused.
    check(`M2a POST sheet revisions pageNumber[k] (was 500): 400 naming pageNumber; the same upload with pageNumber=1 gets past the door (${said(m2gate)}; ${sheets} sheet(s) exist in either company)`,
      refusedNaming(m2, 'pageNumber') && pastDoor, `${said(m2)} ${JSON.stringify(fieldsNamed(m2))} | gate ${said(m2gate)}`);
    check('M2b POST sheet revisions revision[k] (an isString().trim() chain): 400 naming revision', refusedNaming(m2b, 'revision') && pastDoor, `${said(m2b)} | gate ${said(m2gate)}`);
  }

  // ── PART E: errors on the query engine itself ────────────────────────────────
  currentCase = 'errors';
  if (want('errors') && INPROCESS) {
    print('\n── errors: a value refusal is 400, a schema-usage fault 500, never Prisma\'s text ──');
    // eslint-disable-next-line global-require
    const { prisma } = require('../../../src/config/db');
    // eslint-disable-next-line global-require
    const { toClientError } = require('../../../src/middleware/error-handler');
    // eslint-disable-next-line global-require
    const { Prisma } = require('@prisma/client');
    // Every query is a read whose arguments the query engine refuses at validation: no SQL is sent.
    const CASES = [
      ['value', 'an invalid Date', () => prisma.project.findFirst({ where: { createdAt: new Date('x') } })],
      ['value', 'an array where a string belongs', () => prisma.project.findFirst({ where: { name: ['a', 'b'] } })],
      ['value', 'a string where an Int belongs', () => prisma.project.findMany({ take: 'x' })],
      ['value', 'a string that is not a DateTime', () => prisma.project.findFirst({ where: { createdAt: 'notadate' } })],
      ['value', 'a word outside an enum', () => prisma.projectParty.findFirst({ where: { role: 'bogus' } })],
      ['value', 'a string that is not a Decimal', () => prisma.directCost.findFirst({ where: { tax: 'abc' } })],
      ['value', 'a year-10000 Date (the engine cannot convert it)', () => prisma.project.findFirst({ where: { createdAt: new Date('9999-12-31T23:59:59-14:00') } })],
      ['value', 'a Decimal NaN', () => prisma.directCost.findFirst({ where: { tax: new Prisma.Decimal(NaN) } })],
      ['fault', 'an unknown argument', () => prisma.project.findFirst({ where: { bogusColumn: 1 } })],
      ['fault', 'a missing argument', () => prisma.project.findUnique({})],
      ['fault', 'an unknown field in select', () => prisma.project.findFirst({ select: { bogusField: true } })],
      ['fault', 'an unknown relation in include', () => prisma.project.findFirst({ include: { bogusRelation: true } })],
      ['fault', 'select and include together', () => prisma.project.findFirst({ select: { id: true }, include: { org: true } })],
    ];
    const rows = [];
    for (const [kind, label, run] of CASES) {
      try {
        await run();
        rows.push({ kind, label, status: null, text: '(no error)' });
      } catch (error) {
        const client = toClientError(error);
        rows.push({ kind, label, status: client.status, code: client.code, message: client.message, name: error.name });
      }
    }
    const wrong = rows.filter((r) => r.status !== (r.kind === 'value' ? 400 : 500));
    check(`E1 ${rows.filter((r) => r.kind === 'value').length} value refusals of the query engine answer 400 VALIDATION_ERROR and ${rows.filter((r) => r.kind === 'fault').length} schema-usage faults 500 INTERNAL_ERROR (every PrismaClientValidationError was 400; the year-10000 Date and the Decimal NaN were 500)`,
      wrong.length === 0 && rows.filter((r) => r.kind === 'value').every((r) => r.code === 'VALIDATION_ERROR' && r.message === DB_INPUT) && rows.filter((r) => r.kind === 'fault').every((r) => r.code === 'INTERNAL_ERROR'),
      wrong.map((r) => `${r.label}: ${r.status} ${r.name || ''}`).join(' | '));
    check('E1 no client message carries Prisma\'s text', rows.every((r) => !PRISMA_TEXT.test(String(r.message || ''))), rows.map((r) => r.message).join(' | '));
  }

  // ── PART T: text chains ──────────────────────────────────────────────────────
  currentCase = 'text';
  if (want('text')) {
    print('\n── text: one string, refused at the door before any reference is drawn ──');
    const tr0 = await counter('Transmittal', 'TRM');
    const t1 = [
      ['subject ["a","b"]', await ask(pm, 'POST', `${AP}/transmittals`, { subject: [`${STAMP} T1`, 'b'], sender: 'R6', recipient: 'R6' }), 'subject'],
      ['sender {"a":1}', await ask(pm, 'POST', `${AP}/transmittals`, { subject: `${STAMP} T1 sender`, sender: { a: 1 }, recipient: 'R6' }), 'sender'],
      ['recipient 12345', await ask(pm, 'POST', `${AP}/transmittals`, { subject: `${STAMP} T1 recipient`, sender: 'R6', recipient: 12345 }), 'recipient'],
      ['ref ["x","y"]', await ask(pm, 'POST', `${AP}/transmittals`, { subject: `${STAMP} T1 ref`, sender: 'R6', recipient: 'R6', ref: ['x', 'y'] }), 'ref'],
      ['notes {"a":1}', await ask(pm, 'POST', `${AP}/transmittals`, { subject: `${STAMP} T1 notes`, sender: 'R6', recipient: 'R6', notes: { a: 1 } }), 'notes'],
    ];
    const tr1 = await counter('Transmittal', 'TRM');
    const t1gate = await ask(pm, 'POST', `${AP}/transmittals`, { subject: `${STAMP} T1 own`, sender: 'R6', recipient: 'R6', ref: `${STAMP}-T1`, notes: 'own notes' });
    const tr2 = await counter('Transmittal', 'TRM');
    gated(t1gate, 'T1 POST transmittals subject / sender / recipient / ref / notes as an array, object or number (ref and subject were 400 only at the write, sender stored "[object Object]", notes 500): each 400 naming the field',
      t1.every(([, r, f]) => refusedNaming(r, f)), t1.filter(([, r, f]) => !refusedNaming(r, f)).map(([l, r]) => `${l}: ${said(r)}`).join(' | '));
    const t1rows = await q('select subject, ref, notes from "Transmittal" where "projectId" = $1 and subject like $2', [A.id, `${STAMP} T1%`]);
    check('T1 read back: no transmittal reference drawn for a refused request (the counter moves only for the own one); only the own transmittal stored, with its ref and notes',
      tr1 === tr0 && tr2 === tr0 + 1 && t1rows.length === 1 && t1rows[0].ref === `${STAMP}-T1` && t1rows[0].notes === 'own notes', `counter ${tr0} -> ${tr1} -> ${tr2}; ${JSON.stringify(t1rows)}`);
    const t1f = await ask(pm, 'POST', `${AP}/transmittals`, { subject: [`${STAMP} T1f`], sender: 'R6', recipient: 'R6', activityId: foreign.activity });
    const t1n = await ask(pm, 'POST', `${AP}/transmittals`, { subject: [`${STAMP} T1n`], sender: 'R6', recipient: 'R6', activityId: NOWHERE });
    check(`T1 with company ${VICTIM}'s activity beside a refused subject, the answer is exactly the one with an activity that exists nowhere, and no reference is drawn`, said(t1f) === said(t1n) && t1f.status === 400 && JSON.stringify(fieldsNamed(t1f)) === JSON.stringify(fieldsNamed(t1n)) && (await counter('Transmittal', 'TRM')) === tr2, `foreign ${said(t1f)} ${JSON.stringify(fieldsNamed(t1f))} | nowhere ${said(t1n)} ${JSON.stringify(fieldsNamed(t1n))}`);

    // T2 PATCH: an object as the subject was read by Prisma as an update operation ("Unknown argument") — a 500 now that a fault is a fault.
    const ownTr = t1gate.body?.data?.id;
    const t2 = [
      ['subject {"a":1}', await ask(pm, 'PATCH', `${AP}/transmittals/${ownTr}`, { subject: { a: 1 } }), 'subject'],
      ['sender ["a"]', await ask(pm, 'PATCH', `${AP}/transmittals/${ownTr}`, { sender: ['a'] }), 'sender'],
      ['notes {"a":1}', await ask(pm, 'PATCH', `${AP}/transmittals/${ownTr}`, { notes: { a: 1 } }), 'notes'],
    ];
    const t2mid = await one('select subject, sender, notes from "Transmittal" where id = $1', [ownTr]);
    const t2gate = await ask(pm, 'PATCH', `${AP}/transmittals/${ownTr}`, { subject: `${STAMP} T1 own (edited)` });
    gated(t2gate, 'T2 PATCH transmittal subject / sender / notes as an object or array (subject: Prisma "Unknown argument"; notes: 500 in trim()): each 400 naming the field, the transmittal untouched',
      t2.every(([, r, f]) => refusedNaming(r, f)) && t2mid?.subject === `${STAMP} T1 own` && t2mid?.notes === 'own notes', `${t2.filter(([, r, f]) => !refusedNaming(r, f)).map(([l, r]) => `${l}: ${said(r)}`).join(' | ')} row ${JSON.stringify(t2mid)}`);

    // T3 an RFI's subject as a deep object was stored as "[object Object]".
    const rfi0 = await counter('Rfi', 'RFI');
    const t3 = await ask(site, 'POST', `${AP}/rfi`, { subject: { a: { b: 1 } }, question: `${STAMP} T3 object` });
    const t3b = await ask(site, 'POST', `${AP}/rfi`, { subject: [`${STAMP} T3`], question: `${STAMP} T3 array` });
    const rfi1 = await counter('Rfi', 'RFI');
    const t3gate = await ask(site, 'POST', `${AP}/rfi`, { subject: `${STAMP} T3 own`, question: `${STAMP} T3 own` });
    gated(t3gate, 'T3 POST rfi subject as {"a":{"b":1}} (was stored as "[object Object]") or ["x"]: 400 naming subject, no RFI reference drawn',
      refusedNaming(t3, 'subject') && refusedNaming(t3b, 'subject') && rfi1 === rfi0, `${said(t3)} | ${said(t3b)}; counter ${rfi0} -> ${rfi1}`);
    const t3rows = await q('select subject from "Rfi" where "projectId" = $1 and question like $2', [A.id, `${STAMP} T3%`]);
    check('T3 read back: no "[object Object]" subject; only the own RFI', t3rows.length === 1 && t3rows[0].subject === `${STAMP} T3 own`, JSON.stringify(t3rows));

    // T4 text the services trim(): a TypeError (500) on an object, array, number or boolean — the NCR's after its reference was drawn.
    const ncr0 = await counter('NcrRecord', 'NCR');
    const weekly = await one('select id, remarks from "WeeklyReport" where "projectId" = $1 order by "createdAt" limit 1', [A.id]);
    const T4 = [
      ['NCR description {"a":1}', 'POST', `${AP}/ncr`, { severity: 'minor', description: { a: 1 } }, 'description', { severity: 'minor', description: `${STAMP} T4 ncr own` }],
      ['NCR disposition ["a","b"]', 'POST', `${AP}/ncr`, { severity: 'minor', description: `${STAMP} T4 ncr refused`, disposition: ['a', 'b'] }, 'disposition', null],
      ['defect trade {"a":1}', 'POST', `${AP}/defects`, { title: `${STAMP} T4 defect`, trade: { a: 1 } }, 'trade', { title: `${STAMP} T4 defect own`, trade: 'Concrete' }],
      ['material test labName 12345', 'POST', `${AP}/material-tests`, { testType: `${STAMP} T4 mt`, labName: 12345 }, 'labName', { testType: `${STAMP} T4 mt own`, labName: 'Own lab' }],
      ['ITP notes true', 'POST', `${AP}/itp`, { title: `${STAMP} T4 itp`, notes: true }, 'notes', { title: `${STAMP} T4 itp own`, notes: 'own' }],
      ['safety severity {"a":1}', 'POST', `${AP}/safety`, { incidentType: 'near_miss', title: `${STAMP} T4 safety`, severity: { a: 1 } }, 'severity', { incidentType: 'near_miss', title: `${STAMP} T4 safety own`, severity: 'low' }],
      ['cash-flow note {"a":1}', 'POST', `${AP}/cash-flow`, { period: '2091-01', inflow: 1, outflow: 1, note: { a: 1 } }, 'note', { period: '2091-02', inflow: 1, outflow: 1, note: `${STAMP} T4 own` }],
      ['budget revision notes ["a"]', 'POST', `${AP}/budget-revisions`, { title: `${STAMP} T4 br`, changeType: 'addition', amount: 1, notes: ['a'] }, 'notes', { title: `${STAMP} T4 br own`, changeType: 'addition', amount: 1, notes: 'own' }],
      ...(weekly ? [['weekly report remarks {"a":1} (Prisma "Unknown argument" — a 500 once a fault is a fault)', 'PATCH', `${AP}/weekly-reports/${weekly.id}`, { remarks: { a: 1 } }, 'remarks', { remarks: weekly.remarks ?? `${STAMP} T4 own` }]] : []),
    ];
    const t4 = [];
    for (const [label, method, route, body, field, own] of T4) {
      const person = /cash-flow|budget-revisions/.test(route) ? cost : pm;
      const refused = await ask(person, method, route, body);
      const gate = own ? await ask(person, method, route, own) : null;
      t4.push([label, refused, field, gate]);
    }
    const ncr1 = await counter('NcrRecord', 'NCR');
    const gates = t4.filter(([, , , g]) => g);
    check(`T4 ${t4.length} text fields services trim() (each was 500): each 400 naming the field; the own request on each door accepted [gated]`,
      gates.every(([, , , g]) => ok2xx(g)) && t4.every(([, r, f]) => refusedNaming(r, f)), `${t4.filter(([, r, f]) => !refusedNaming(r, f)).map(([l, r]) => `${l}: ${said(r)}`).join(' | ')} | gates ${gates.filter(([, , , g]) => !ok2xx(g)).map(([l, , , g]) => `${l}: ${said(g)}`).join(' | ')}`);
    const t4rows = Number(await val('select count(*)::int from "NcrRecord" where "projectId" = $1 and description like $2', [A.id, `${STAMP} T4 ncr%`]));
    check('T4 read back: of the NCRs only the own one, and the NCR counter moved once (the refused description no longer draws a reference before failing)', t4rows === 1 && ncr1 === ncr0 + 1, `ncr rows ${t4rows}; counter ${ncr0} -> ${ncr1}`);
  }

  // ── PART F: figures ──────────────────────────────────────────────────────────
  currentCase = 'figures';
  if (want('figures')) {
    print('\n── figures: integers within INT4, money within Decimal(18,2), finite ──');
    const activityId = Object.values(A.refs.activities)[0];
    const actBefore = await one('select "earlyStart", "earlyFinish", "lateStart", "lateFinish", "totalFloat", duration, "updatedAt" from "Activity" where id = $1', [activityId]);
    const f1 = [];
    for (const field of ['earlyStart', 'earlyFinish', 'lateStart', 'lateFinish', 'totalFloat', 'duration', 'sortOrder']) f1.push([`${field} 2147483648`, await ask(pm, 'PATCH', `${AP}/activities/${activityId}`, { [field]: 2147483648 }), field]);
    f1.push(['dependencies[0].lagDays -2147483649', await ask(pm, 'PATCH', `${AP}/activities/${activityId}`, { dependencies: [{ predecessorId: Object.values(A.refs.activities)[1], type: 'FS', lagDays: -2147483649 }] }), 'dependencies[0].lagDays']);
    const actAfter = await one('select "earlyStart", "earlyFinish", "lateStart", "lateFinish", "totalFloat", duration, "updatedAt" from "Activity" where id = $1', [activityId]);
    const f1gate = await ask(pm, 'PATCH', `${AP}/activities/${activityId}`, { duration: Number(actBefore?.duration ?? 1) });
    gated(f1gate, 'F1 PATCH activity earlyStart … duration, sortOrder 2147483648 and a lag of -2147483649 (were refused only by the query engine at the write): each 400 naming the field at the door, the activity untouched',
      f1.every(([, r, f]) => refusedNaming(r, f)) && JSON.stringify(actBefore) === JSON.stringify(actAfter), `${failing(f1.map(([l, r]) => [l, r]), '')} ${f1.filter(([, r, f]) => !refusedNaming(r, f)).map(([l, r]) => `${l}: ${said(r)} ${JSON.stringify(fieldsNamed(r))}`).join(' | ')}`);

    const f2gate = await ask(cost, 'POST', `${AP}/direct-costs`, { type: 'invoice', description: `${STAMP} F2 own`, costDate: day(0), tax: '9999999999.99', lines: [{ description: 'l', amount: '12.5' }] });
    const f2 = [
      ['tax "1e400" (stored as 0.00)', await ask(cost, 'POST', `${AP}/direct-costs`, { type: 'invoice', description: `${STAMP} F2 tax`, costDate: day(0), tax: '1e400', lines: [{ description: 'l', amount: 5 }] }), 'tax'],
      ['tax 1e16', await ask(cost, 'POST', `${AP}/direct-costs`, { type: 'invoice', description: `${STAMP} F2 tax16`, costDate: day(0), tax: 1e16, lines: [{ description: 'l', amount: 5 }] }), 'tax'],
      ['lines[0].amount "1e400"', await ask(cost, 'POST', `${AP}/direct-costs`, { type: 'invoice', description: `${STAMP} F2 amount`, costDate: day(0), lines: [{ description: 'l', amount: '1e400' }] }), 'lines[0].amount'],
      ['lines[0].unitCost "9999999999999999.99" (reads as 1e16)', await ask(cost, 'POST', `${AP}/direct-costs`, { type: 'invoice', description: `${STAMP} F2 unit`, costDate: day(0), lines: [{ description: 'l', quantity: 1, unitCost: '9999999999999999.99' }] }), 'lines[0].unitCost'],
    ];
    gated(f2gate, 'F2 POST direct-costs tax / lines[].amount / lines[].unitCost "1e400", 1e16, "9999999999999999.99": each 400 naming the field', f2.every(([, r, f]) => refusedNaming(r, f)), f2.filter(([, r, f]) => !refusedNaming(r, f)).map(([l, r]) => `${l}: ${said(r)}`).join(' | '));
    const f2rows = await q('select description, tax::text as tax from "DirectCost" where "projectId" = $1 and description like $2', [A.id, `${STAMP} F2%`]);
    check('F2 read back: only the own direct cost, its tax 9999999999.99 as sent', f2rows.length === 1 && f2rows[0].description === `${STAMP} F2 own` && f2rows[0].tax === '9999999999.99', JSON.stringify(f2rows));

    const f3gate = await ask(site, 'POST', `${AP}/rfi`, { subject: `${STAMP} F3 own`, question: 'q', costImpactAmount: '1250.50' });
    const f3 = await ask(site, 'POST', `${AP}/rfi`, { subject: `${STAMP} F3 1e400`, question: 'q', costImpactAmount: '1e400' });
    gated(f3gate, 'F3 POST rfi costImpactAmount "1e400" (stored as NULL): 400 naming costImpactAmount', refusedNaming(f3, 'costImpactAmount'), said(f3));
    const f3rows = await q('select subject, "costImpactAmount"::text as amount from "Rfi" where "projectId" = $1 and subject like $2', [A.id, `${STAMP} F3%`]);
    check('F3 read back: only the own RFI, its cost impact 1250.50', f3rows.length === 1 && f3rows[0].amount === '1250.50', JSON.stringify(f3rows));

    // F4 the public bid portal's line rate: [1,1] was priced 11.
    const procurement = who('procurement');
    const supplier = inv.company?.refs?.directory?.supplier;
    const pkgRes = await ask(pm, 'POST', `${AP}/bids`, { title: `${STAMP} F4 package`, dueAt: new Date(Date.now() + 21 * 86_400_000).toISOString() });
    const pkg = pkgRes.body?.data;
    const lineRes = pkg ? await ask(pm, 'POST', `${AP}/bids/${pkg.id}/lines`, { description: `${STAMP} F4 line`, qty: 10, unit: 'm', estimateRate: 5 }) : { status: 0 };
    const line = pkg ? await one('select id from "BidPackageLine" where "packageId" = $1 order by "lineNumber" limit 1', [pkg.id]) : null;
    const invited = pkg && supplier ? await ask(pm, 'POST', `${AP}/bids/${pkg.id}/invitations`, { invitations: [{ vendorCompanyId: supplier, contactName: `R6 bidder ${STAMP}`, contactEmail: `bidder.${STAMP.toLowerCase()}@bidders.c${ATTACKER}.octapm-cert.test` }] }) : { status: 0 };
    const invitation = invited.body?.data?.items?.[0];
    const published = pkg ? await ask(pm, 'POST', `${AP}/bids/${pkg.id}/publish`, {}) : { status: 0 };
    const resent = invitation ? await ask(pm, 'POST', `${AP}/bids/${pkg.id}/invitations/${invitation.id}/resend`, {}) : { status: 0 };
    const token = /\/bid\/([A-Za-z0-9_-]+)/.exec(resent.body?.data?.portalUrl || '')?.[1];
    check('F4 setup: a fresh bid package with one line of 10, published, its bidder\'s portal link', [pkgRes, lineRes, invited, published, resent].every(ok2xx) && Boolean(line && token), [pkgRes, lineRes, invited, published, resent].map(said).join(' | '));
    void procurement;
    if (token && line) {
      const f4 = [];
      for (const [label, rate] of [['[1,1]', [1, 1]], ['["5"]', ['5']], ['{"n":1}', { n: 1 }], ['true', true], ['"1e400"', '1e400'], ['-1', -1]]) {
        f4.push([label, await anonymous('PUT', `/public/bids/${token}/bid`, { lines: [{ packageLineId: line.id, rate, included: true }] })]);
      }
      const bidAfterRefused = await one('select b.total::text as total, (select count(*)::int from "BidLine" l where l."bidId" = b.id) as lines from "Bid" b join "BidInvitation" i on i.id = b."invitationId" where i.id = $1', [invitation.id]);
      const f4gate = await anonymous('PUT', `/public/bids/${token}/bid`, { lines: [{ packageLineId: line.id, rate: '1,250.00', included: true, note: 'own' }] });
      gated(f4gate, 'F4 PUT /public/bids/{token}/bid lines[0].rate [1,1] (priced 11) ["5"] {"n":1} true "1e400" -1: each 400 naming lines[0].rate, no bid priced',
        f4.every(([, r]) => refusedNaming(r, 'lines[0].rate')) && !bidAfterRefused, `${failing(f4, 'lines[0].rate')}; bid after refusals ${JSON.stringify(bidAfterRefused)}`);
      const priced = await one('select l.rate::text as rate, l.amount::text as amount, l.note from "BidLine" l join "Bid" b on b.id = l."bidId" where b."invitationId" = $1', [invitation.id]);
      check('F4 read back: the own bid prices the line at 1250.00 (the portal\'s "1,250.00"), amount 12500.00', priced?.rate === '1250.00' && priced?.amount === '12500.00' && priced?.note === 'own', JSON.stringify(priced));
      const f4f = await anonymous('PUT', `/public/bids/${token}/bid`, { lines: [{ packageLineId: foreign.packageLine, rate: [1, 1] }] });
      const f4n = await anonymous('PUT', `/public/bids/${token}/bid`, { lines: [{ packageLineId: NOWHERE, rate: [1, 1] }] });
      check(`F4 a rate [1,1] on company ${VICTIM}'s bid line is answered exactly as on a line that exists nowhere`, said(f4f) === said(f4n) && f4f.status === 400, `foreign ${said(f4f)} | nowhere ${said(f4n)}`);
    }

    // F5 a commitment's change-order value and a change event's conversion value: unbounded isFloat.
    const commitment = await one('select id from "Commitment" where "projectId" = $1 and status in ($2, $3) order by "createdAt" limit 1', [A.id, 'approved', 'executed']);
    const ce = await ask(pm, 'POST', `${AP}/change-events`, { title: `${STAMP} F5 event`, romAmount: '1e400', lines: [{ description: 'l', quantity: 1, unitCost: '1e400' }] });
    const ceOwn = await ask(pm, 'POST', `${AP}/change-events`, { title: `${STAMP} F5 event own`, romAmount: 100 });
    gated(ceOwn, 'F5 POST change-events romAmount and lines[0].unitCost "1e400": 400 naming both', refusedNaming(ce, 'romAmount') && refusedNaming(ce, 'lines[0].unitCost'), `${said(ce)} ${JSON.stringify(fieldsNamed(ce))}`);
    check('F5 read back: only the own change event', Number(await val('select count(*)::int from "ChangeEvent" where "projectId" = $1 and title like $2', [A.id, `${STAMP} F5 event%`])) === 1);
    if (commitment) {
      const cco = await ask(pm, 'POST', `${AP}/commitments/${commitment.id}/change-orders`, { title: `${STAMP} F5 cco`, value: '1e400' });
      const ccoOwn = await ask(pm, 'POST', `${AP}/commitments/${commitment.id}/change-orders`, { title: `${STAMP} F5 cco own`, value: -250.5 });
      gated(ccoOwn, 'F5 POST commitment change-orders value "1e400" (an unbounded isFloat): 400 naming value; a negative value (a deduction) still accepted', refusedNaming(cco, 'value'), said(cco));
    }
  }

  // ── PART P: performance ──────────────────────────────────────────────────────
  currentCase = 'performance';
  if (want('performance')) {
    print('\n── performance: the guard on a legitimate 2.2 MB body, against HEAD\'s ──');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r6-guard-'));
    fs.mkdirSync(path.join(dir, 'middleware'));
    fs.mkdirSync(path.join(dir, 'utils'));
    fs.writeFileSync(path.join(dir, 'middleware', 'head.js'), execFileSync('git', ['show', 'HEAD:backend/src/middleware/reject-null-bytes.js'], { cwd: WORKTREE }));
    fs.writeFileSync(path.join(dir, 'utils', 'http-error.js'), `module.exports = require(${JSON.stringify(path.join(__dirname, '..', '..', '..', 'src', 'utils', 'http-error'))});`);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const head = require(path.join(dir, 'middleware', 'head.js')).rejectNullBytes;
    // eslint-disable-next-line global-require
    const now = require('../../../src/middleware/reject-null-bytes').rejectNullBytes;
    const text = (n) => 'Supply and install reinforced concrete grade C40 to slab L2 '.repeat(2).slice(0, n);
    const bodyOf = () => ({ revisionLabel: 'Rev B', rows: Array.from({ length: 10000 }, (_, i) => ({ itemCode: `A.${i}`, section: `S${i % 40}`, description: text(80), unit: 'm3', qty: i * 1.5, rate: 125.5, amount: i * 188.25, notes: null, tags: ['civil', 'slab'] })) });
    const body = bodyOf();
    const time = (fn, runs) => {
      const samples = [];
      for (let i = 0; i < runs; i += 1) {
        const req = { originalUrl: '/api/v1/projects/p/boq/import', url: '/', query: {}, body, headers: { 'content-type': 'application/json' } };
        let passed = false;
        const t = process.hrtime.bigint();
        fn(req, {}, (err) => { passed = !err; });
        samples.push(Number(process.hrtime.bigint() - t) / 1e6);
        if (!passed) throw new Error('the guard refused a legitimate body');
      }
      return samples.sort((a, b) => a - b)[Math.floor(runs / 2)];
    };
    time(head, 3);
    time(now, 3);
    const headMs = time(head, 15);
    const nowMs = time(now, 15);
    const headMs2 = time(head, 15);
    const nowMs2 = time(now, 15);
    const h = Math.min(headMs, headMs2);
    const n = Math.min(nowMs, nowMs2);
    check(`P1 the guard on a legitimate ${(Buffer.byteLength(JSON.stringify(body)) / 1048576).toFixed(1)} MB body (10,000 BOQ rows): median ${n.toFixed(2)} ms against HEAD's ${h.toFixed(2)} ms (no more than 1.5x + 2 ms)`, n <= h * 1.5 + 2, `now ${nowMs.toFixed(2)}/${nowMs2.toFixed(2)} ms, HEAD ${headMs.toFixed(2)}/${headMs2.toFixed(2)} ms`);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── whole run ───────────────────────────────────────────────────────────────
  currentCase = 'whole run';
  const victimTraces = new RegExp([`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`, victimOrg, ...foreignIds].join('|'), 'g');
  const tracesOf = (a) => [...new Set(a.text.match(victimTraces) || [])].filter((trace) => !String(a.sent || '').includes(trace));
  const leaked = answers.filter((a) => tracesOf(a).length);
  const echoed = answers.filter((a) => !tracesOf(a).length && (a.text.match(victimTraces) || []).length);
  check(`no answer to company ${ATTACKER} carries company ${VICTIM}'s ids, names, addresses or canaries it was not sent (${answers.length} answers; ${echoed.length} echo an id the request itself sent)`, leaked.length === 0, leaked.slice(0, 6).map((a) => `${a.status} ${a.route} -> ${tracesOf(a)[0]}`).join('\n        '));
  const errors = answers.filter((a) => a.status >= 500 || a.status === 0);
  check('no answer is a server error (5xx)', errors.length === 0, errors.slice(0, 10).map((a) => `${a.status} ${a.route} ${firstLine(a.text).slice(0, 120)}`).join('\n        '));
  const prisma = answers.filter((a) => PRISMA_TEXT.test(a.text));
  check('no answer carries Prisma\'s, the engine\'s or the database\'s own words', prisma.length === 0, prisma.slice(0, 6).map((a) => `${a.status} ${a.route}`).join(' | '));
  if (FINGERPRINT) {
    const runEnd = await snapshot();
    const victimMoved = fingerprint.compare(runStart, runEnd).filter((c) => !c.noise && c.org === VICTIM);
    check(`company ${VICTIM}'s data did not change (every table, whole run)`, victimMoved.length === 0, victimMoved.slice(0, 8).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
  }
  await db.end();

  const byCase = new Map();
  for (const r of results) {
    const e = byCase.get(r.case) || { passed: 0, failed: 0 };
    e[r.ok ? 'passed' : 'failed'] += 1;
    byCase.set(r.case, e);
  }
  print('\nper case:');
  for (const [name, e] of byCase) print(`  ${e.failed ? 'FAIL' : 'ok  '}  ${name}: ${e.passed} passed, ${e.failed} failed`);
  const failed = results.filter((r) => !r.ok);
  print(`\n${GROUP} proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  print(error);
  process.exit(1);
});
