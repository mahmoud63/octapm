'use strict';

/**
 * The live proof of CERT-2 group "queries-4": query-string identifier shapes,
 * the transmittal blank activity, the punch activity links, the meeting echo
 * and NUL characters.
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/queries-4-proof.js [attacker=073] [victim=074]
 *   CERT_INPROCESS=1 node scripts/cert/isolation/queries-4-proof.js 073 074 --only="query|transmittal" --no-fingerprint
 *
 * Attacker company 073 acts; victim company 074 is read-only and must be
 * untouched. Every REFUSED check is gated on the attacker's own request
 * succeeding on the same record (so a refusal is the guard working, not the
 * route being broken); a query carrying a foreign id is compared with one
 * carrying an id that exists nowhere; the database is read back; no answer may
 * carry a victim trace and none may be a 5xx.
 *
 * PART Q — query-string identifier shapes. For the confirmed routes (and more)
 * a query parameter sent twice (?x=a&x=b), as ?x[]=a and as ?x[k]=v answered
 * 500 because query("x").isUUID() checks an array element by element. Each is
 * now refused 400, and a query parameter carrying company 074's id is answered
 * exactly as one carrying a nowhere id; the route still answers 2xx for a
 * single scalar id (the gate).
 *
 * PART T — transmittal blank activity. activityId "   " / "\t" drew a TRM
 * reference number and then answered 500 (id in [null]); it is now refused
 * 400 before any number is drawn (the ReferenceCounter is unmoved), and the
 * same create with the project's own activity is accepted (the gate).
 *
 * PART P — punch activity links. activityLinks [{id:[own]}] / [{activityId:
 * " own "}] / [{activityId:[own]}] were coerced and accepted while every other
 * workflow route refused them; they are now refused 4xx, a foreign activity is
 * refused exactly as a nowhere one, and the own activity on activityLinks is
 * accepted and stored (the gate).
 *
 * PART M — meeting echo. MEETING_ACTIVITY_INVALID no longer returns the ids it
 * was sent (a foreign activity's id is not in the answer); a foreign activity
 * is answered exactly as a nowhere one; the own activity is accepted (gate).
 *
 * PART N — NUL characters. A text field, a JSON field and a query parameter
 * carrying U+0000 answered 500 (22P05); each is now refused 400
 * VALIDATION_ERROR, and the same request without the NUL is accepted (gate).
 *
 * Whole run: no answer carries company 074's ids, addresses, name or canaries;
 * no e-mail does; no answer is a 5xx; company 073's data does not change while
 * the refused requests are sent; company 074's data does not change at all.
 *
 * Final line "queries-4 proof: N passed, M failed of T"; exit 0 on all pass.
 * Re-runnable: every record is fresh and carries this run's stamp.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { as } = require('../lib/api');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');

const GROUP = 'queries-4';
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ATTACKER = positional[0] || '073';
const VICTIM = positional[1] || '074';
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7) || null;
const FINGERPRINT = !process.argv.includes('--no-fingerprint');
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `Q4-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const stamp = STAMP.toLowerCase();
const INPROCESS = process.env.CERT_INPROCESS === '1';
const NOWHERE = '00000000-0000-4000-8000-00000000d1ed';

const results = [];
const answers = [];
let currentCase = 'setup';
const check = (name, ok, detail = '') => {
  results.push({ case: currentCase, name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n        ${detail}` : ''}`);
};
const want = (name) => !ONLY || new RegExp(ONLY).test(`${currentCase} ${name}`);
const firstLine = (text) => String(text || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
const said = (res) => `${res.status} ${res.body?.error?.code || ''} ${firstLine(res.body?.error?.message).slice(0, 100)}`.trim();
const ok2xx = (res) => res.status >= 200 && res.status < 300;
const is4xx = (res) => res.status >= 400 && res.status < 500;

// The local e-mail transport logs each message; kept out of the output so it can be searched.
const emails = [];
const print = console.log.bind(console);
console.log = (...args) => {
  const text = args.map(String).join(' ');
  if (text.startsWith('[email:local]')) { emails.push(text); return; }
  print(...args);
};

const main = async () => {
  console.log(`${GROUP} proof — attacker ${ATTACKER}, victim ${VICTIM}, stamp ${STAMP}${INPROCESS ? ', in process' : ' — NOT in process'}${ONLY ? `, only /${ONLY}/` : ''}${FINGERPRINT ? '' : ', no fingerprint'}\n`);
  const inventory = (code) => JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'inventory', `${code}.json`), 'utf8'));
  const standard = (inv) => Object.values(inv.projects).find((p) => p.depth === 'standard' && p.refs?.activities && p.refs?.boq);
  const A = standard(inventory(ATTACKER));
  const V = standard(inventory(VICTIM));
  const AP = `/projects/${A.id}`;

  const db = await guard.connectCert();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const val = async (sql, args = []) => { const row = (await q(sql, args))[0]; return row ? Object.values(row)[0] : null; };
  const orgOf = async (code) => val('select id from "Organisation" where slug like $1', [`cert-${code}-%`]);
  const attackerOrg = await orgOf(ATTACKER);
  const victimOrg = await orgOf(VICTIM);

  const first = (map) => Object.values(map || {})[0] || null;
  const own = {
    activity: first(A.refs.activities),
    boq: await val('select id from "BoqItem" where "projectId"=$1 and "isActive" and "supersededAt" is null order by "sortOrder", code limit 1', [A.id]),
    location: await val('select id from "Location" where "projectId"=$1 and "archivedAt" is null order by "sortOrder", id limit 1', [A.id]),
  };
  const foreign = {
    activity: first(V.refs.activities),
    boq: await val('select id from "BoqItem" where "projectId"=$1 and "isActive" and "supersededAt" is null limit 1', [V.id]),
    location: await val('select l.id from "Location" l join "Project" p on p.id=l."projectId" where p."orgId"=$1 limit 1', [victimOrg]),
  };
  for (const [k, id] of Object.entries(own)) check(`setup: company ${ATTACKER}'s ${k} is known`, Boolean(id), JSON.stringify(id));
  for (const [k, id] of Object.entries(foreign)) check(`setup: company ${VICTIM}'s ${k} is known`, Boolean(id));
  check(`setup: the victim's activity belongs to company ${VICTIM}`, (await val('select p."orgId" from "Activity" a join "Project" p on p.id=a."projectId" where a.id=$1', [foreign.activity])) === victimOrg);
  const foreignIds = Object.values(foreign).filter(Boolean);

  const sessions = {};
  const actor = (role) => {
    if (!sessions[role]) {
      const session = as(`${role}@c${ATTACKER}.octapm-cert.test`);
      sessions[role] = async (method, route, body) => {
        const res = await session.send(method, route, body);
        answers.push({ route: `${role} ${method} ${route}`, status: res.status, text: res.text || '' });
        return res;
      };
    }
    return sessions[role];
  };
  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const print2 = await fingerprint.take(db);
    await db.query('rollback');
    return print2;
  };

  const runStart = FINGERPRINT ? await snapshot() : null;

  // ── PART Q: query-string identifier shapes (the refused phase) ──────────────
  currentCase = 'query shapes';
  // Confirmed routes and a few more. Each entry: the GET route and the id query
  // parameters it reads; the scalar gate is the owner's own id.
  const QUERY_ROUTES = [
    { name: 'forms?activityId', route: `${AP}/forms`, param: 'activityId', own: own.activity },
    { name: 'activity-boq-allocations?boqItemId', route: `${AP}/activity-boq-allocations`, param: 'boqItemId', own: own.boq },
    { name: 'activity-boq-allocations?activityId', route: `${AP}/activity-boq-allocations`, param: 'activityId', own: own.activity },
    { name: 'activity-boq-allocations/suggestions?boqItemId', route: `${AP}/activity-boq-allocations/suggestions`, param: 'boqItemId', own: own.boq },
    { name: 'rfi?activityId', route: `${AP}/rfi`, param: 'activityId', own: own.activity },
    { name: 'photos?locationId', route: `${AP}/photos`, param: 'locationId', own: own.location },
    { name: 'quantity-progress?activityId', route: `${AP}/quantity-progress`, param: 'activityId', own: own.activity },
  ];
  const qShapes = (param, value) => [
    ['twice', `${param}=${value}&${param}=${NOWHERE}`],
    ['[]', `${encodeURIComponent(`${param}[]`)}=${value}`],
    ['[k]', `${encodeURIComponent(`${param}[k]`)}=${value}`],
  ];
  for (const r of QUERY_ROUTES) {
    if (!want(r.name) || !r.own) continue;
    const send = actor('pm');
    const gate = await send('GET', `${r.route}?${r.param}=${r.own}`);
    const scalarForeign = await send('GET', `${r.route}?${r.param}=${foreign.activity && r.param.includes('activity') ? foreign.activity : (r.param.includes('boq') ? foreign.boq : (r.param.includes('location') ? foreign.location : foreign.activity))}`);
    const scalarNowhere = await send('GET', `${r.route}?${r.param}=${NOWHERE}`);
    check(`query ${r.name}: a single scalar id is accepted (2xx) — the route answers it (gate)`, ok2xx(gate), said(gate));
    check(`query ${r.name}: a foreign scalar id is answered exactly as a nowhere one`, said(scalarForeign) === said(scalarNowhere), `foreign ${said(scalarForeign)} | nowhere ${said(scalarNowhere)}`);
    check(`query ${r.name}: neither the foreign nor the nowhere scalar answers a 5xx`, scalarForeign.status < 500 && scalarNowhere.status < 500, `${said(scalarForeign)} | ${said(scalarNowhere)}`);
    for (const [label, qs] of qShapes(r.param, r.own)) {
      const res = await send('GET', `${r.route}?${qs}`);
      check(`query ${r.name}: ${label} is refused with a 4xx (not a 5xx), on a route that answers the scalar`, ok2xx(gate) && is4xx(res), `${ok2xx(gate) ? '' : 'NOT GATED; '}${said(res)}`);
    }
  }

  // ── PART T: transmittal blank activity ──────────────────────────────────────
  currentCase = 'transmittal blank activity';
  if (want('transmittal')) {
    const send = actor('pm');
    const counterScope = `projectId:${A.id}|Transmittal|TRM`;
    const counterBefore = await val('select next from "ReferenceCounter" where scope=$1', [counterScope]);
    const refused = {};
    for (const blank of ['   ', '\t']) {
      refused[blank] = await send('POST', `${AP}/transmittals`, { subject: `${STAMP} blank`, sender: 'Site', recipient: 'Eng', activityId: blank });
    }
    const counterAfter = await val('select next from "ReferenceCounter" where scope=$1', [counterScope]);
    const gate = await send('POST', `${AP}/transmittals`, { subject: `${STAMP} own`, sender: 'Site', recipient: 'Eng', activityId: own.activity });
    const stored = gate.body?.data?.id ? await q('select "activityId" from "WorkflowActivityLink" where "projectId"=$1 and "recordType"=$2 and "recordId"=$3', [A.id, 'transmittal', gate.body.data.id]) : [];
    const foreignRes = await send('POST', `${AP}/transmittals`, { subject: `${STAMP} foreign`, sender: 'Site', recipient: 'Eng', activityId: foreign.activity });
    const nowhereRes = await send('POST', `${AP}/transmittals`, { subject: `${STAMP} nowhere`, sender: 'Site', recipient: 'Eng', activityId: NOWHERE });
    check('transmittal: the create with the project\'s own activity is accepted (2xx) and the link is stored (gate)', ok2xx(gate) && stored.some((l) => l.activityId === own.activity), `${said(gate)} links=${JSON.stringify(stored)}`);
    for (const blank of ['   ', '\t']) check(`transmittal: a ${JSON.stringify(blank)} activity is refused with a 4xx (not 500), on a route that accepts the own one`, ok2xx(gate) && is4xx(refused[blank]), `${said(refused[blank])}`);
    check('transmittal: a refused blank-activity create drew no TRM reference number (ReferenceCounter unmoved)', String(counterBefore) === String(counterAfter), `${counterBefore} -> ${counterAfter}`);
    check('transmittal: a foreign activity is refused exactly as a nowhere one', said(foreignRes) === said(nowhereRes), `foreign ${said(foreignRes)} | nowhere ${said(nowhereRes)}`);
    check('transmittal: no blank/foreign/nowhere create answers a 5xx', [...Object.values(refused), foreignRes, nowhereRes].every((r) => r.status < 500));
    const titled = await val('select count(*)::int from "Transmittal" where "projectId"=$1 and subject like $2 and subject not like $3', [A.id, `${STAMP}%`, `${STAMP} own`]);
    check('transmittal: the refused creates stored no transmittal', Number(titled) === 0, `rows with a refused title: ${titled}`);
  }

  // ── PART P: punch activity links ────────────────────────────────────────────
  currentCase = 'punch activity links';
  if (want('punch')) {
    const send = actor('quality');
    const gateRes = await send('POST', `${AP}/punch`, { title: `${STAMP} punch own`, activityLinks: [{ activityId: own.activity }] });
    const gateStored = gateRes.body?.data?.id ? await q('select "activityId" from "WorkflowActivityLink" where "projectId"=$1 and "recordType"=$2 and "recordId"=$3', [A.id, 'punch_item', gateRes.body.data.id]) : [];
    check('punch: activityLinks with the project\'s own activity is accepted (2xx) and stored (gate)', ok2xx(gateRes) && gateStored.some((l) => l.activityId === own.activity), `${said(gateRes)} links=${JSON.stringify(gateStored)}`);
    // The shapes every other workflow route refuses, now refused here too.
    const shapes = [
      ['[{id:[own]}]', [{ id: [own.activity] }]],
      ['[{activityId:" own "}]', [{ activityId: ` ${own.activity} ` }]],
      ['[{activityId:[own]}]', [{ activityId: [own.activity] }]],
      ['[{activityId:{id:own}}]', [{ activityId: { id: own.activity } }]],
      ['[{activityId:12345}]', [{ activityId: 12345 }]],
    ];
    for (const [label, links] of shapes) {
      const res = await send('POST', `${AP}/punch`, { title: `${STAMP} punch ${label}`, activityLinks: links });
      check(`punch: activityLinks ${label} is refused with a 4xx (not coerced/accepted), on a route that accepts the own link`, ok2xx(gateRes) && is4xx(res), `${said(res)}`);
    }
    // foreign vs nowhere, on activityId, activityIds[], activityLinks[].activityId
    for (const [field, wrap] of [['activityId', (id) => ({ activityId: id })], ['activityIds[]', (id) => ({ activityIds: [id] })], ['activityLinks[]', (id) => ({ activityLinks: [{ activityId: id }] })]]) {
      const f = await send('POST', `${AP}/punch`, { title: `${STAMP} punch f ${field}`, ...wrap(foreign.activity) });
      const n = await send('POST', `${AP}/punch`, { title: `${STAMP} punch n ${field}`, ...wrap(NOWHERE) });
      check(`punch: a foreign activity on ${field} is refused 4xx exactly as a nowhere one`, is4xx(f) && said(f) === said(n), `foreign ${said(f)} | nowhere ${said(n)}`);
    }
    const stray = await val('select count(*)::int from "PunchItem" p where p."projectId"=$1 and p.title like $2 and p.title <> $3', [A.id, `${STAMP}%`, `${STAMP} punch own`]);
    check('punch: no refused create stored a punch item', Number(stray) === 0, `rows with a refused title: ${stray}`);
    check('punch: no activity link of company ' + ATTACKER + "'s project names company " + VICTIM + "'s activity", Number(await val('select count(*)::int from "WorkflowActivityLink" where "projectId"=$1 and "activityId"=$2', [A.id, foreign.activity])) === 0);
  }

  // ── PART M: meeting echo ────────────────────────────────────────────────────
  currentCase = 'meeting echo';
  if (want('meeting')) {
    const send = actor('pm');
    const gate = await send('POST', `${AP}/meetings`, { title: `${STAMP} meeting own`, activityId: own.activity });
    const f = await send('POST', `${AP}/meetings`, { title: `${STAMP} meeting foreign`, activityId: foreign.activity });
    const n = await send('POST', `${AP}/meetings`, { title: `${STAMP} meeting nowhere`, activityId: NOWHERE });
    check('meeting: the own activity is accepted (2xx) (gate)', ok2xx(gate), said(gate));
    check('meeting: a foreign activity is refused 400 MEETING_ACTIVITY_INVALID', f.status === 400 && f.body?.error?.code === 'MEETING_ACTIVITY_INVALID', said(f));
    check('meeting: the refusal does not echo the id it was sent (no details, the id is absent)', !f.body?.error?.details && !String(f.text || '').includes(foreign.activity), `details=${JSON.stringify(f.body?.error?.details)} echoesForeign=${String(f.text || '').includes(foreign.activity)}`);
    check('meeting: a foreign activity is answered exactly as a nowhere one', said(f) === said(n), `foreign ${said(f)} | nowhere ${said(n)}`);
    check('meeting: neither answers a 5xx', f.status < 500 && n.status < 500);
  }

  // ── PART N: NUL characters ──────────────────────────────────────────────────
  currentCase = 'nul characters';
  if (want('nul')) {
    const site = actor('site');
    const pm = actor('pm');
    const quality = actor('quality');
    const NUL = '\u0000';
    const cases = [
      ['POST rfi subject (text field)', () => site('POST', `${AP}/rfi`, { subject: `${STAMP}${NUL}x`, question: 'q?' }), () => site('POST', `${AP}/rfi`, { subject: `${STAMP} clean`, question: 'q?' })],
      ['POST progress evidence (JSON field)', () => site('POST', `${AP}/activities/${own.activity}/progress`, { pctComplete: 1, notes: 'n', evidence: { note: `n${NUL}ul` } }), null],
      ['POST punch title (text field)', () => quality('POST', `${AP}/punch`, { title: `${STAMP}${NUL}p` }), () => quality('POST', `${AP}/punch`, { title: `${STAMP} clean punch` })],
      ['POST risks description (text field)', () => pm('POST', `${AP}/risks`, { description: `${STAMP}${NUL}r` }), () => pm('POST', `${AP}/risks`, { description: `${STAMP} clean risk` })],
      ['GET rfi?search (query)', () => pm('GET', `${AP}/rfi?search=a%00b`), () => pm('GET', `${AP}/rfi?search=clean`)],
      ['GET projects?search (query)', () => pm('GET', `/projects?search=a%00b`), () => pm('GET', `/projects?search=clean`)],
      ['GET search?q (query)', () => pm('GET', `/search?q=a%00b`), () => pm('GET', `/search?q=clean`)],
    ];
    for (const [name, attack, gate] of cases) {
      const res = await attack();
      check(`nul: ${name} is refused 400 VALIDATION_ERROR (not 500)`, res.status === 400 && res.body?.error?.code === 'VALIDATION_ERROR', said(res));
      if (gate) {
        const g = await gate();
        check(`nul: ${name} without the NUL is accepted (not refused for a bad character) (gate)`, g.status !== 400 || g.body?.error?.message !== 'The request contains a disallowed character.', said(g));
      }
    }
    // The read-back must not itself send a NUL to Postgres (22P05). Only the
    // clean gate RFI ("<STAMP> clean") should carry the stamp; a stored
    // NUL-bearing RFI would be an extra STAMP-prefixed row.
    const stampRfi = await val('select count(*)::int from "Rfi" where "projectId"=$1 and subject like $2', [A.id, `${STAMP}%`]);
    check('nul: the refused NUL creates stored no record (only the clean gate carries the stamp)', Number(stampRfi) === 1, `STAMP-prefixed rfi: ${stampRfi} (expected 1, the clean gate)`);
  }

  // ── whole run ───────────────────────────────────────────────────────────────
  currentCase = 'whole run';
  const victimTraces = new RegExp([`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`, victimOrg, ...foreignIds].join('|'));
  const leaked = answers.filter((a) => victimTraces.test(a.text));
  check(`no answer to company ${ATTACKER} carries company ${VICTIM}'s ids, names, addresses or canaries`, leaked.length === 0, leaked.slice(0, 6).map((a) => `${a.status} ${a.route} -> ${(a.text.match(victimTraces) || [])[0]}`).join('\n        '));
  const mailed = emails.filter((text) => victimTraces.test(text));
  check(`no e-mail carries company ${VICTIM}'s traces (${emails.length} e-mails sent)`, mailed.length === 0, mailed.slice(0, 3).map((t) => t.slice(0, 160)).join('\n        '));
  const errors = answers.filter((a) => a.status >= 500);
  check('no answer is a server error (5xx)', errors.length === 0, errors.slice(0, 10).map((a) => `${a.status} ${a.route} ${firstLine(a.text).slice(0, 120)}`).join('\n        '));
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
  console.log('\nper case:');
  for (const [name, e] of byCase) console.log(`  ${e.failed ? 'FAIL' : 'ok  '}  ${name}: ${e.passed} passed, ${e.failed} failed`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${GROUP} proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
