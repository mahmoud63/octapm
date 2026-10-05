'use strict';

/**
 * The live proof of CERT-2 group "robustness-5": no input may answer 5xx —
 * Prisma/Postgres input errors, NUL and lone surrogates, dates, figures given
 * as arrays, search and dob.
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/robustness-5-proof.js [attacker=044] [victim=045]
 *   CERT_INPROCESS=1 node scripts/cert/isolation/robustness-5-proof.js 044 045 --only="dates|figures" --no-fingerprint
 *
 * Attacker company 044 acts on its own records; victim company 045 is read
 * only and must be untouched. Every REFUSED check is gated on the attacker's
 * own request succeeding on the same record (so a refusal is the guard
 * working, not the route being broken); where an identifier is involved a
 * foreign one (company 045's) is compared with one that exists nowhere; the
 * database is read back; no answer may carry a victim trace and none may be a
 * 5xx; company 045's data must not change (fingerprint, before and after).
 *
 * PART E — errors. A value of the request the database cannot take used to
 *   answer 500 with Prisma's own text (the certification API runs as
 *   development): a transmittal ref sent as an array (PrismaClientValidation-
 *   Error), a direct cost's tax of 1e17 (Postgres 22003 numeric overflow), an
 *   activity's earlyStart of 2147483648 (the engine's INT4 conversion error).
 *   Each was made 400 VALIDATION_ERROR "The request contains a value that cannot
 *   be stored." with no Prisma text, nothing stored; since robustness-6 the door
 *   refuses all three first, naming the field. A reporting period's code
 *   sent twice stays 409 CONFLICT, now without "Unique constraint …".
 * PART N — NUL and surrogates. A NUL nested 20 levels deep in a JSON field
 *   (the guard stopped at 12: 500 22P05), a lone UTF-16 surrogate in a text
 *   field (500 InvalidArg), a NUL in a multipart text field — caption,
 *   clientRequestId, recordId (500 22021) — and in a multipart file name, raw
 *   (busboy "Malformed part header", 500) or RFC 5987-encoded: each 400, nothing
 *   stored; an emoji (a well-formed surrogate pair) is stored as sent. The
 *   inbound-email webhook verifies the provider first (401 without the token)
 *   and then refuses a NUL with 400.
 * PART D — dates. "20261001", "2026-W40", "2026-275", "2026-10-01T10Z", [],
 *   ["<date>"], {"not":"x"} on a project's startDate, an RFI's dueDate, a
 *   transmittal's dueDate / transmittedOn / acknowledgedOn, a reporting
 *   period: each 400 naming the field, nothing stored (they were 500s, [] on
 *   transmittals too); the accepted shapes (YYYY-MM-DD, toISOString(),
 *   datetime-local, a space separator) are stored as Date reads them. dob:
 *   an array (500) and "20001001" (silently stored as null) are refused 400.
 *   /search reads updatedAfter / updatedBefore: "notadate", a value sent
 *   twice, ?x[k]=v and "2026-W40" (500) are refused 400; a project route's
 *   ?dueAfter=20261001 too.
 * PART F — figures as arrays. A transfer receipt's receivedQty [1,1] booked 0
 *   and wrote both units off; acceptedQty [1,1] on either goods-receipt door
 *   stored a receipt with no lines; a money field took ["5"] as 5. Each is now
 *   400 naming the field, nothing stored, the transfer still in transit.
 *
 * Final line "robustness-5 proof: N passed, M failed of T"; exit 0 on all pass.
 * Re-runnable: every record is fresh and carries this run's stamp.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { as, multipart, tokenFor, BASE } = require('../lib/api');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');

const GROUP = 'robustness-5';
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ATTACKER = positional[0] || '044';
const VICTIM = positional[1] || '045';
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7) || null;
const FINGERPRINT = !process.argv.includes('--no-fingerprint');
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `R5-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const INPROCESS = process.env.CERT_INPROCESS === '1';
const NOWHERE = '00000000-0000-4000-8000-00000000d1ed';
const NUL = '\u0000';
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
const DB_INPUT = 'The request contains a value that cannot be stored.';
const DISALLOWED = 'The request contains a disallowed character.';
/** Prisma's, the engine's or the database's own words, or a source path. */
const PRISMA_TEXT = /Invalid `|invocation|PrismaClient|PostgresError|ConnectorError|Unique constraint|Foreign key|\.service\.js|INT4|numeric field overflow|InvalidArg|Provided Date object/;

// The product's local e-mail transport and the development error log write to the console in process.
const print = console.log.bind(console);
console.log = (...args) => {
  const text = args.map(String).join(' ');
  if (text.startsWith('[email:local]')) return;
  print(...args);
};
console.error = () => {};

/** A raw multipart body sent as the person (a file name with a NUL cannot be built with FormData). */
let inprocessApp = null;
const rawMultipart = async (email, route, buffer, boundary) => {
  const token = await tokenFor(email);
  if (INPROCESS) {
    // eslint-disable-next-line global-require
    const request = require('supertest');
    // eslint-disable-next-line global-require
    inprocessApp = inprocessApp || require('../../../src/app').createApp();
    const res = await request(inprocessApp).post(`/api/v1${route}`).set('authorization', `Bearer ${token}`).set('content-type', `multipart/form-data; boundary=${boundary}`).send(buffer);
    let body = null;
    try { body = JSON.parse(res.text); } catch { body = null; }
    return { status: res.status, text: res.text, body };
  }
  const res = await fetch(`${BASE}/api/v1${route}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` }, body: buffer });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: res.status, text, body };
};
const multipartWithName = (fileHeader, fields = {}) => {
  const boundary = `----r5${crypto.randomBytes(6).toString('hex')}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'));
  parts.push(Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; `, 'latin1'), fileHeader, Buffer.from(`\r\nContent-Type: text/plain\r\n\r\nrobustness five\r\n--${boundary}--\r\n`, 'latin1')]));
  return { boundary, buffer: Buffer.concat(parts) };
};

const main = async () => {
  console.log(`${GROUP} proof — attacker ${ATTACKER}, victim ${VICTIM}, stamp ${STAMP}${INPROCESS ? ', in process (the working tree\'s code)' : ' — NOT in process: this asks a running API, which does not prove the working tree'}${ONLY ? `, only /${ONLY}/` : ''}${FINGERPRINT ? '' : ', no fingerprint'}\n`);
  const inventory = (code) => JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'inventory', `${code}.json`), 'utf8'));
  const A = Object.values(inventory(ATTACKER).projects).find((p) => p.depth === 'standard' && p.refs?.activities && p.refs?.inventory?.warehouses?.site && p.refs?.inventory?.warehouses?.laydown);
  if (!A) throw new Error(`company ${ATTACKER} needs a standard project with activities and site/laydown warehouses`);
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
    transferLine: await val('select l.id from "StockTransferLine" l where l."orgId" = $1 order by l.id limit 1', [victimOrg]),
  };
  check(`setup: company ${VICTIM}'s project, RFI and transfer line are known and are ${VICTIM}'s`, Boolean(foreign.project && foreign.rfi && foreign.transferLine));
  const foreignIds = Object.values(foreign).filter(Boolean);

  const who = (role) => as(`${role}@c${ATTACKER}.octapm-cert.test`);
  const pm = who('pm');
  const site = who('site');
  const cost = who('cost');
  const store = who('warehouse');
  const procurement = who('procurement');
  const ask = async (person, method, route, body, options) => {
    const res = await person.send(method, route, body, options);
    // What the request itself carried: an id it sent and the answer echoes (a filter) is not a disclosure.
    answers.push({ route: `${method} ${route.split('?')[0]}`, status: res.status, text: res.text || '', sent: `${route} ${body === undefined ? '' : JSON.stringify(body)}` });
    return res;
  };
  const record = (route, res) => {
    answers.push({ route, status: res.status, text: res.text || '' });
    return res;
  };
  const noPrisma = (res) => !PRISMA_TEXT.test(res.text || '');

  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    try {
      return await fingerprint.take(db);
    } finally {
      await db.query('rollback');
    }
  };
  const runStart = FINGERPRINT ? await snapshot() : null;

  // ── PART E: errors from the caller's input reaching the database ────────────
  currentCase = 'errors';
  if (want('errors')) {
    console.log('\n── errors: a value the database cannot take is a 400 with no Prisma text ──');
    // E1 PrismaClientValidationError: an array where one string belongs.
    const gate = await ask(pm, 'POST', `${AP}/transmittals`, { subject: `${STAMP} E1 ref own`, sender: 'R5 proof', recipient: 'R5 proof', ref: `${STAMP}-E1` });
    const arr = await ask(pm, 'POST', `${AP}/transmittals`, { subject: `${STAMP} E1 ref array`, sender: 'R5 proof', recipient: 'R5 proof', ref: [`${STAMP}-a`, `${STAMP}-b`] });
    // Since robustness-6 the door refuses these three before the database sees them (ref has a
    // string check, tax and earlyStart a column bound): 400 VALIDATION_ERROR naming the field. The
    // handler's generic sentence for a value the database cannot take is proved live there (J2, E1).
    gated(gate, 'E1 POST transmittals ref ["a","b"] (was a PrismaClientValidationError 500): 400 VALIDATION_ERROR naming ref at the door (robustness-6), no Prisma text',
      refusedNaming(arr, 'ref') && noPrisma(arr), `${said(arr)} ${JSON.stringify(fieldsNamed(arr))} prismaText=${!noPrisma(arr)}`);
    const e1Rows = await q('select subject, ref from "Transmittal" where "projectId" = $1 and subject like $2 order by subject', [A.id, `${STAMP} E1%`]);
    check('E1 read back: the own transmittal is stored with its ref, nothing of the refused one', e1Rows.length === 1 && e1Rows[0].ref === `${STAMP}-E1`, JSON.stringify(e1Rows));

    // E2 Postgres 22003: a direct cost's tax beyond Decimal(18,2).
    const costGate = await ask(cost, 'POST', `${AP}/direct-costs`, { type: 'invoice', description: `${STAMP} E2 own`, costDate: day(0), tax: 0, lines: [{ description: `${STAMP} E2 line`, quantity: 1, unitCost: 5 }] });
    const over = await ask(cost, 'POST', `${AP}/direct-costs`, { type: 'invoice', description: `${STAMP} E2 overflow`, costDate: day(0), tax: 1e17, lines: [{ description: `${STAMP} E2 line`, quantity: 1, unitCost: 5 }] });
    gated(costGate, 'E2 POST direct-costs tax 1e17 (was Postgres 22003 numeric overflow, 500): 400 VALIDATION_ERROR naming tax at the door (robustness-6), no Prisma text',
      refusedNaming(over, 'tax') && noPrisma(over), `${said(over)} ${JSON.stringify(fieldsNamed(over))} prismaText=${!noPrisma(over)}`);
    const e2Rows = await q('select description from "DirectCost" where "projectId" = $1 and description like $2', [A.id, `${STAMP} E2%`]);
    check('E2 read back: only the own direct cost is stored', e2Rows.length === 1 && e2Rows[0].description === `${STAMP} E2 own`, JSON.stringify(e2Rows));

    // E3 the engine's INT4 conversion: an activity's earlyStart of 2^31.
    const activityId = Object.values(A.refs.activities)[0];
    const before = await one('select "earlyStart", "updatedAt" from "Activity" where id = $1', [activityId]);
    const big = await ask(pm, 'PATCH', `${AP}/activities/${activityId}`, { earlyStart: 2147483648 });
    const after = await one('select "earlyStart", "updatedAt" from "Activity" where id = $1', [activityId]);
    const actGate = await ask(pm, 'PATCH', `${AP}/activities/${activityId}`, { earlyStart: Number(before?.earlyStart ?? 0) });
    gated(actGate, 'E3 PATCH activity earlyStart 2147483648 (was the engine\'s INT4 conversion error, 500): 400 VALIDATION_ERROR naming earlyStart at the door (robustness-6), no Prisma text, the activity untouched',
      refusedNaming(big, 'earlyStart') && noPrisma(big) && JSON.stringify(before) === JSON.stringify(after), `${said(big)} ${JSON.stringify(fieldsNamed(big))}; before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);

    // E4 P2002 stays 409, without Prisma's words.
    const code = `${STAMP}`.slice(0, 40);
    const first = await ask(cost, 'POST', `${AP}/reports/periods`, { code, label: `${STAMP} E4`, periodStart: '2026-09-01', periodEnd: '2026-09-30' });
    const twice = await ask(cost, 'POST', `${AP}/reports/periods`, { code, label: `${STAMP} E4 again`, periodStart: '2026-09-01', periodEnd: '2026-09-30' });
    gated(first, 'E4 POST reports/periods with a code that exists: 409 CONFLICT, the catalogue sentence, no "Unique constraint" or Prisma text',
      twice.status === 409 && twice.body?.error?.code === 'CONFLICT' && noPrisma(twice), `${said(twice)} prismaText=${!noPrisma(twice)}`);
    check('E4 read back: exactly one period carries the code', Number(await val('select count(*)::int from "ReportingPeriod" where "projectId" = $1 and code = $2', [A.id, code])) === 1);
  }

  // ── PART N: NUL and lone surrogates ─────────────────────────────────────────
  currentCase = 'nul and surrogates';
  let ownRfi = null;
  if (want('nul')) {
    console.log('\n── NUL and surrogates: refused at any depth, in multipart, in the inbound webhook ──');
    const deep = (depth, leaf) => { let v = leaf; for (let i = 0; i < depth; i += 1) v = { n: v }; return v; };
    const deepGate = await ask(pm, 'POST', `${AP}/transmittals`, { subject: `${STAMP} N1 deep own`, sender: 'R5', recipient: 'R5', documentsJson: { list: deep(20, 'clean leaf') } });
    const deepNul = await ask(pm, 'POST', `${AP}/transmittals`, { subject: `${STAMP} N1 deep nul`, sender: 'R5', recipient: 'R5', documentsJson: { list: deep(20, `a${NUL}b`) } });
    const deepKey = await ask(pm, 'POST', `${AP}/transmittals`, { subject: `${STAMP} N1 deep key`, sender: 'R5', recipient: 'R5', documentsJson: { list: deep(30, { [`k${NUL}`]: 1 }) } });
    gated(deepGate, 'N1 a NUL 20 levels deep in a JSON field (value) and 30 deep (key): 400 VALIDATION_ERROR, the disallowed-character sentence',
      [deepNul, deepKey].every((r) => r.status === 400 && r.body?.error?.message === DISALLOWED), `${said(deepNul)} | ${said(deepKey)}`);
    const n1 = await q('select subject, "documentsJson"::text as docs from "Transmittal" where "projectId" = $1 and subject like $2', [A.id, `${STAMP} N1%`]);
    check('N1 read back: only the clean transmittal is stored, its 20-deep leaf as sent', n1.length === 1 && n1[0].subject === `${STAMP} N1 deep own` && n1[0].docs.includes('clean leaf'), JSON.stringify(n1.map((r) => r.subject)));

    const emoji = `${STAMP} N2 own \ud83d\udc4d façade`;
    const rfiGate = await ask(site, 'POST', `${AP}/rfi`, { subject: emoji, question: 'Is the slab ready? \ud83d\udc4d' });
    ownRfi = rfiGate.body?.data?.id || null;
    const lone = [];
    for (const [label, text] of [['high', `${STAMP} N2 \ud800 x`], ['low', `${STAMP} N2 \udc00 x`], ['high at end', `${STAMP} N2 \udbff`]]) {
      lone.push([label, await ask(site, 'POST', `${AP}/rfi`, { subject: text, question: 'q?' })]);
    }
    const loneQuestion = await ask(site, 'POST', `${AP}/rfi`, { subject: `${STAMP} N2 in question`, question: 'q \udfff' });
    gated(rfiGate, 'N2 a lone surrogate in an RFI subject or question (was 500 InvalidArg): 400 VALIDATION_ERROR, the disallowed-character sentence',
      [...lone.map(([, r]) => r), loneQuestion].every((r) => r.status === 400 && r.body?.error?.message === DISALLOWED), [...lone.map(([l, r]) => `${l}: ${said(r)}`), `question: ${said(loneQuestion)}`].join(' | '));
    const n2 = await q('select subject from "Rfi" where "projectId" = $1 and subject like $2', [A.id, `${STAMP} N2%`]);
    check('N2 read back: only the own RFI is stored, its emoji and accents exactly as sent', n2.length === 1 && n2[0].subject === emoji, JSON.stringify(n2));

    // N3 multipart text fields and file names, on the own RFI.
    if (ownRfi) {
      const upload = (fields, filename = 'r5.txt') => ({ form: multipart({ field: 'files', filename, contentType: 'text/plain', body: Buffer.from('robustness five'), fields }) });
      const attached = async () => Number(await val('select count(*)::int from "Attachment" where "recordType" = $1 and "recordId" = $2', ['rfi', ownRfi]));
      const before = await attached();
      const bad = [];
      bad.push(['caption', await ask(site, 'POST', `${AP}/attachments`, undefined, upload({ recordType: 'rfi', recordId: ownRfi, caption: `a${NUL}b` }))]);
      bad.push(['clientRequestId', await ask(site, 'POST', `${AP}/attachments`, undefined, upload({ recordType: 'rfi', recordId: ownRfi, clientRequestId: `${STAMP}${NUL}` }))]);
      bad.push(['recordId', await ask(site, 'POST', `${AP}/attachments`, undefined, upload({ recordType: 'rfi', recordId: `${ownRfi}${NUL}` }))]);
      const encoded = multipartWithName(Buffer.from(`filename*=UTF-8''a%00b.txt`, 'latin1'), { recordType: 'rfi', recordId: ownRfi });
      bad.push(['file name (RFC 5987)', record('POST attachments', await rawMultipart(`site@c${ATTACKER}.octapm-cert.test`, `${AP}/attachments`, encoded.buffer, encoded.boundary))]);
      const rawName = multipartWithName(Buffer.concat([Buffer.from('filename="a', 'latin1'), Buffer.from([0]), Buffer.from('b.txt"', 'latin1')]), { recordType: 'rfi', recordId: ownRfi });
      const rawRes = record('POST attachments', await rawMultipart(`site@c${ATTACKER}.octapm-cert.test`, `${AP}/attachments`, rawName.buffer, rawName.boundary));
      const afterBad = await attached();
      const uploadGate = await ask(site, 'POST', `${AP}/attachments`, undefined, upload({ recordType: 'rfi', recordId: ownRfi, caption: `${STAMP} N3 own`, clientRequestId: `${STAMP}-N3` }));
      gated(uploadGate, 'N3 a NUL in a multipart caption, clientRequestId, recordId or file name (RFC 5987): 400 VALIDATION_ERROR, the disallowed-character sentence (were 500 22021)',
        bad.every(([, r]) => r.status === 400 && r.body?.error?.message === DISALLOWED), bad.map(([f, r]) => `${f}: ${said(r)}`).join(' | '));
      gated(uploadGate, 'N3 a NUL in a raw part header (busboy "Malformed part header", was 500): 400 VALIDATION_ERROR "The multipart body is malformed."',
        rawRes.status === 400 && rawRes.body?.error?.code === 'VALIDATION_ERROR' && rawRes.body?.error?.message === 'The multipart body is malformed.', said(rawRes));
      check('N3 read back: no attachment from the refused uploads, the own upload stored with its caption', afterBad === before && (await attached()) === before + 1 && (await val('select caption from "Attachment" where "recordType" = $1 and "recordId" = $2 and "clientRequestId" = $3', ['rfi', ownRfi, `${STAMP}-N3`])) === `${STAMP} N3 own`, `before ${before}, after refusals ${afterBad}`);
      const f = await ask(site, 'POST', `${AP}/attachments`, undefined, upload({ recordType: 'rfi', recordId: foreign.rfi, caption: `${STAMP} N3 foreign` }));
      const n = await ask(site, 'POST', `${AP}/attachments`, undefined, upload({ recordType: 'rfi', recordId: NOWHERE, caption: `${STAMP} N3 nowhere` }));
      check(`N3 a clean upload on company ${VICTIM}'s RFI is answered exactly as on an RFI that exists nowhere (a 4xx), nothing stored`,
        said(f) === said(n) && f.status >= 400 && f.status < 500 && Number(await val('select count(*)::int from "Attachment" where caption like $1', [`${STAMP} N3 %`])) === 1, `foreign ${said(f)} | nowhere ${said(n)}`);
    } else {
      check('N3 multipart: the own RFI to attach to was created', false, said(rfiGate));
    }

    // N4 the inbound-email webhook: the provider is verified first, then the same guard.
    if (INPROCESS) {
      if (!process.env.INBOUND_EMAIL_WEBHOOK_TOKEN) process.env.INBOUND_EMAIL_WEBHOOK_TOKEN = `r5-proof-${crypto.randomBytes(8).toString('hex')}`;
      const token = encodeURIComponent(process.env.INBOUND_EMAIL_WEBHOOK_TOKEN);
      const mail = (subject) => ({ from: 'r5.proof@example.test', to: 'nobody@example.test', subject, text: `${STAMP} body`, messageId: `${STAMP}-${crypto.randomBytes(3).toString('hex')}` });
      const anon = as(`pm@c${ATTACKER}.octapm-cert.test`);
      const unauth = await ask(anon, 'POST', '/public/inbound-email/generic', mail(`${STAMP} N4 a${NUL}b`), { token: null });
      const nulMail = await ask(anon, 'POST', `/public/inbound-email/generic?token=${token}`, mail(`${STAMP} N4 a${NUL}b`), { token: null });
      const surMail = await ask(anon, 'POST', `/public/inbound-email/generic?token=${token}`, mail(`${STAMP} N4 \ud800`), { token: null });
      const cleanMail = await ask(anon, 'POST', `/public/inbound-email/generic?token=${token}`, mail(`${STAMP} N4 clean`), { token: null });
      check('N4 inbound e-mail without the provider token: 401 first, whatever the payload carries', unauth.status === 401, said(unauth));
      gated(cleanMail, 'N4 inbound e-mail with the token and a NUL or a lone surrogate: 400 VALIDATION_ERROR (the same guard, after verification)',
        [nulMail, surMail].every((r) => r.status === 400 && r.body?.error?.message === DISALLOWED), `${said(nulMail)} | ${said(surMail)}`);
      check('N4 read back: no inbound e-mail stored for the refused payloads', Number(await val('select count(*)::int from "InboundEmail" where subject like $1', [`${STAMP} N4%`])) === 0);
    }
  }

  // ── PART D: dates ────────────────────────────────────────────────────────────
  currentCase = 'dates';
  if (want('dates')) {
    console.log('\n── dates: one string, a date Date can read, or a 400 naming the field ──');
    const WRONG = [['"20261001"', '20261001'], ['"2026-W40"', '2026-W40'], ['"2026-275"', '2026-275'], ['"2026-10-01T10Z"', '2026-10-01T10Z'], ['"2026-02-30"', '2026-02-30'], ['"notadate"', 'notadate'], ['[]', []], ['["2026-10-01"]', ['2026-10-01']], ['{"not":"x"}', { not: 'x' }]];

    // D1 a project's startDate (PATCH).
    const startBefore = await one('select "startDate", "updatedAt" from "Project" where id = $1', [A.id]);
    const d1 = [];
    for (const [label, value] of WRONG) d1.push([label, await ask(pm, 'PATCH', AP, { startDate: value })]);
    const startAfter = await one('select "startDate", "updatedAt" from "Project" where id = $1', [A.id]);
    const own = startBefore?.startDate ? new Date(startBefore.startDate).toISOString().slice(0, 10) : day(0);
    const projectGate = await ask(pm, 'PATCH', AP, { startDate: own });
    gated(projectGate, `D1 PATCH project startDate in ${WRONG.length} wrong shapes (compact, week, ordinal, hour-only, impossible, arrays, object): each 400 naming startDate, the project untouched`,
      d1.every(([, r]) => refusedNaming(r, 'startDate')) && JSON.stringify(startBefore) === JSON.stringify(startAfter), d1.filter(([, r]) => !refusedNaming(r, 'startDate')).map(([l, r]) => `${l}: ${said(r)}`).join(' | '));

    // D2 an RFI's dueDate (POST), and the accepted shapes stored as Date reads them.
    const d2 = [];
    for (const [label, value] of WRONG) d2.push([label, await ask(site, 'POST', `${AP}/rfi`, { subject: `${STAMP} D2 wrong ${label}`, question: 'q?', dueDate: value })]);
    const accepted = [['YYYY-MM-DD', day(30)], ['toISOString()', new Date(`${day(31)}T09:30:00.000Z`).toISOString()], ['datetime-local', `${day(32)}T09:30`], ['space separator', `${day(33)} 09:30:00`], ['offset', `${day(34)}T09:30:00+02:00`]];
    const d2ok = [];
    for (const [label, value] of accepted) d2ok.push([label, value, await ask(site, 'POST', `${AP}/rfi`, { subject: `${STAMP} D2 ok ${label}`, question: 'q?', dueDate: value })]);
    const rfiGate = d2ok[0][2];
    gated(rfiGate, 'D2 POST rfi dueDate in every wrong shape: 400 naming dueDate (compact/week/ordinal were 500)',
      d2.every(([, r]) => refusedNaming(r, 'dueDate')), d2.filter(([, r]) => !refusedNaming(r, 'dueDate')).map(([l, r]) => `${l}: ${said(r)}`).join(' | '));
    check('D2 every accepted date shape is accepted (2xx)', d2ok.every(([, , r]) => ok2xx(r)), d2ok.map(([l, , r]) => `${l}: ${said(r)}`).join(' | '));
    // Prisma stores a DateTime as the UTC wall clock in a timestamp without time zone; read it as such
    // (node-postgres would read the bare timestamp as local time).
    const d2rows = await q(`select subject, to_char("dueDate", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "dueDate" from "Rfi" where "projectId" = $1 and subject like $2`, [A.id, `${STAMP} D2 %`]);
    const storedAsRead = d2ok.every(([label, value]) => {
      const row = d2rows.find((r) => r.subject === `${STAMP} D2 ok ${label}`);
      return row && row.dueDate && new Date(row.dueDate).getTime() === new Date(value).getTime();
    });
    check('D2 read back: nothing of the wrong shapes is stored; each accepted date is stored as Date reads it', d2rows.every((r) => r.subject.startsWith(`${STAMP} D2 ok `)) && d2rows.length === accepted.length && storedAsRead, JSON.stringify(d2rows.map((r) => [r.subject, r.dueDate])));

    // D3 a transmittal's three dates ([] was 500 here too).
    const d3 = [];
    for (const field of ['dueDate', 'transmittedOn', 'acknowledgedOn']) {
      for (const [label, value] of WRONG) d3.push([field, label, await ask(pm, 'POST', `${AP}/transmittals`, { subject: `${STAMP} D3 ${field} ${label}`, sender: 'R5', recipient: 'R5', [field]: value })]);
    }
    const trGate = await ask(pm, 'POST', `${AP}/transmittals`, { subject: `${STAMP} D3 own`, sender: 'R5', recipient: 'R5', dueDate: day(10), transmittedOn: day(0), acknowledgedOn: day(1) });
    gated(trGate, 'D3 POST transmittals dueDate / transmittedOn / acknowledgedOn in every wrong shape: 400 naming the field',
      d3.every(([field, , r]) => refusedNaming(r, field)), d3.filter(([field, , r]) => !refusedNaming(r, field)).map(([f, l, r]) => `${f} ${l}: ${said(r)}`).join(' | '));
    const d3rows = await q(`select subject, to_char("dueDate", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "dueDate" from "Transmittal" where "projectId" = $1 and subject like $2`, [A.id, `${STAMP} D3%`]);
    check('D3 read back: only the own transmittal is stored, its due date as sent', d3rows.length === 1 && d3rows[0].dueDate === new Date(day(10)).toISOString(), JSON.stringify(d3rows));

    // D4 a reporting period.
    const periodGate = await ask(cost, 'POST', `${AP}/reports/periods`, { code: `${STAMP}-D4`.slice(0, 40), periodStart: '2026-08-01', periodEnd: '2026-08-31' });
    const d4 = [];
    for (const [label, value] of WRONG) d4.push([label, await ask(cost, 'POST', `${AP}/reports/periods`, { code: `${STAMP}-D4x`.slice(0, 40), periodStart: value, periodEnd: '2026-08-31' })]);
    gated(periodGate, 'D4 POST reports/periods periodStart in every wrong shape: 400 naming periodStart, no period stored',
      d4.every(([, r]) => refusedNaming(r, 'periodStart')) && Number(await val('select count(*)::int from "ReportingPeriod" where "projectId" = $1 and code = $2', [A.id, `${STAMP}-D4x`.slice(0, 40)])) === 0,
      d4.filter(([, r]) => !refusedNaming(r, 'periodStart')).map(([l, r]) => `${l}: ${said(r)}`).join(' | '));

    // D5 dob: an array was a 500, "20001001" was stored silently as no date.
    const me = await one('select u.id, u.name, s."dateOfBirth", s.language from "User" u left join "UserSetting" s on s."userId" = u.id where u.email = $1', [`pm@c${ATTACKER}.octapm-cert.test`]);
    const account = (dob) => ({ name: me.name.slice(0, 30), dob, language: me.language || 'en' });
    const dobOf = `select to_char("dateOfBirth", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "dateOfBirth" from "UserSetting" where "userId" = $1`;
    const dobBefore = await one(dobOf, [me.id]);
    const d5 = [];
    for (const [label, value] of [['["2000-01-01","2000-01-02"]', ['2000-01-01', '2000-01-02']], ['"20001001"', '20001001'], ['"2000-02-30"', '2000-02-30'], ['"2000-W40"', '2000-W40'], ['{"not":"x"}', { not: 'x' }]]) d5.push([label, await ask(pm, 'PATCH', '/auth/me/account', account(value))]);
    const dobAfter = await one(dobOf, [me.id]);
    const dobGate = await ask(pm, 'PATCH', '/auth/me/account', account('1990-05-17'));
    const dobStored = (await one(dobOf, [me.id]))?.dateOfBirth;
    const restore = await ask(pm, 'PATCH', '/auth/me/account', account(dobBefore?.dateOfBirth ? dobBefore.dateOfBirth.slice(0, 10) : null));
    const dobRestored = (await one(dobOf, [me.id]))?.dateOfBirth ?? null;
    gated(dobGate, 'D5 PATCH /auth/me/account dob as an array, compact, impossible, week or object: 400 naming dob, the stored date of birth untouched',
      d5.every(([, r]) => refusedNaming(r, 'dob')) && JSON.stringify(dobBefore) === JSON.stringify(dobAfter), d5.filter(([, r]) => !refusedNaming(r, 'dob')).map(([l, r]) => `${l}: ${said(r)}`).join(' | '));
    check('D5 read back: the own dob is stored as sent, then put back as it was', dobStored === '1990-05-17T00:00:00.000Z' && ok2xx(restore) && dobRestored === (dobBefore?.dateOfBirth ?? null), `${dobStored}; restore ${said(restore)} -> ${dobRestored} (was ${dobBefore?.dateOfBirth ?? null})`);

    // D6 /search's date aliases and a project route's date query.
    const searchGate = await ask(pm, 'GET', '/search?q=slab&updatedAfter=2026-01-01&updatedBefore=2026-12-31');
    const d6 = [];
    for (const [field, qs] of [['updatedAfter', 'updatedAfter=notadate'], ['updatedAfter', 'updatedAfter=2026-01-01&updatedAfter=2026-02-01'], ['updatedAfter', 'updatedAfter%5Bk%5D=v'], ['updatedBefore', 'updatedBefore=2026-W40'], ['updatedBefore', 'updatedBefore=20261001'], ['from', 'from=2026-275'], ['dateTo', 'dateTo=2026-02-30']]) d6.push([field, qs, await ask(pm, 'GET', `/search?q=slab&${qs}`)]);
    gated(searchGate, 'D6 GET /search updatedAfter/updatedBefore "notadate", sent twice, as an object, week or compact (500s), and from/dateTo ordinal or impossible: 400 naming the parameter at the door',
      d6.every(([field, , r]) => refusedNaming(r, field)), d6.filter(([field, , r]) => !refusedNaming(r, field)).map(([, qs, r]) => `${qs}: ${said(r)}`).join(' | '));
    const sf = await ask(pm, 'GET', `/search?q=slab&projectId=${foreign.project}`);
    const sn = await ask(pm, 'GET', `/search?q=slab&projectId=${NOWHERE}`);
    check(`D6 /search with company ${VICTIM}'s project is answered exactly as with a project that exists nowhere`, said(sf) === said(sn) && sf.status < 500, `foreign ${said(sf)} | nowhere ${said(sn)}`);
    const rfiQueryGate = await ask(pm, 'GET', `${AP}/rfi?dueAfter=2026-01-01`);
    const rq = [];
    for (const v of ['20261001', '2026-W40', '2026-275']) rq.push([v, await ask(pm, 'GET', `${AP}/rfi?dueAfter=${v}`)]);
    gated(rfiQueryGate, 'D6 GET rfi?dueAfter compact / week / ordinal: 400 naming dueAfter', rq.every(([, r]) => refusedNaming(r, 'dueAfter')), rq.map(([v, r]) => `${v}: ${said(r)}`).join(' | '));
  }

  // ── PART F: figures as arrays ────────────────────────────────────────────────
  currentCase = 'figures';
  if (want('figures')) {
    console.log('\n── figures: one value, or a 400 naming the field ──');
    const ARRAYS = [['[1,1]', [1, 1]], ['[5]', [5]], ['[]', []], ['{"n":1}', { n: 1 }], ['true', true]];
    const inv = A.refs.inventory;
    const siteWh = inv.warehouses.site;
    const laydownWh = inv.warehouses.laydown;
    const item = await ask(store, 'POST', '/inventory/items', { sku: `${STAMP}-I`, name: `R5 proof item ${STAMP}`, unit: 'nr' });
    const itemId = item.body?.data?.id;
    const stocked = await ask(store, 'POST', '/inventory/stock/receive', { itemId, warehouseId: siteWh, quantity: 10, unitCost: 5, reference: `${STAMP} stock` });
    const made = await ask(store, 'POST', '/inventory/transfers', { fromWarehouseId: siteWh, toWarehouseId: laydownWh, reason: `${STAMP} transfer`, lines: [{ itemId, quantity: 2 }] });
    const transferId = made.body?.data?.id;
    const dispatched = transferId ? await ask(store, 'POST', `/inventory/transfers/${transferId}/dispatch`, {}) : { status: 0 };
    check('F setup: a fresh item is stocked (10) and a transfer of 2 is created and dispatched', [item, stocked, made].every(ok2xx) && dispatched.status === 200, [item, stocked, made, dispatched].map(said).join(' | '));
    const lineId = transferId ? await val('select id from "StockTransferLine" where "transferId" = $1', [transferId]) : null;
    const transferState = async () => (await q('select t.status, l."receivedQty" as r, l."damagedQty" as d from "StockTransfer" t join "StockTransferLine" l on l."transferId" = t.id where t.id = $1', [transferId])).map((row) => `${row.status}:${Number(row.r)}:${Number(row.d)}`).join(',');
    const inTransit = await transferState();
    const f1 = [];
    for (const [label, value] of ARRAYS) f1.push([label, await ask(store, 'POST', `/inventory/transfers/${transferId}/receive`, { lines: [{ id: lineId, receivedQty: value, damagedQty: 0 }] })]);
    const f1State = await transferState();
    const tf = await ask(store, 'POST', `/inventory/transfers/${transferId}/receive`, { lines: [{ id: foreign.transferLine, receivedQty: 2, damagedQty: 0 }] });
    const tn = await ask(store, 'POST', `/inventory/transfers/${transferId}/receive`, { lines: [{ id: NOWHERE, receivedQty: 2, damagedQty: 0 }] });
    const stillInTransit = await transferState();
    const receiveGate = await ask(store, 'POST', `/inventory/transfers/${transferId}/receive`, { lines: [{ id: lineId, receivedQty: 2, damagedQty: 0 }] });
    gated(receiveGate, 'F1 POST transfer receive receivedQty [1,1] [5] [] {"n":1} true: each 400 naming lines[0].receivedQty ([1,1] booked 0 and wrote 2 off), the transfer still in transit',
      f1.every(([, r]) => refusedNaming(r, 'lines[0].receivedQty')) && f1State === inTransit && inTransit === 'in_transit:0:0',`${f1.filter(([, r]) => !refusedNaming(r, 'lines[0].receivedQty')).map(([l, r]) => `${l}: ${said(r)}`).join(' | ')} state ${inTransit} -> ${f1State}`);
    check(`F1 a receipt naming company ${VICTIM}'s transfer line is answered exactly as one naming a line that exists nowhere, the transfer untouched`, said(tf) === said(tn) && tf.status >= 400 && tf.status < 500 && stillInTransit === inTransit, `foreign ${said(tf)} | nowhere ${said(tn)}`);
    const received = await transferState();
    check('F1 read back: the in-transit transfer had nothing received; the own receipt books 2 received, none damaged', inTransit === 'in_transit:0:0' && received === 'received:2:0', `${inTransit} -> ${received}`);

    // F2 both goods-receipt doors.
    const supplierId = inv.supplierId;
    const activityId = await val('select id from "Activity" where "projectId" = $1 and "isActive" order by "createdAt" limit 1', [A.id]);
    const order = await ask(procurement, 'POST', `${AP}/procurement/purchase-orders`, { supplierId, status: 'draft', currency: 'USD', orderDate: day(0), requiredBy: day(21), promisedDate: day(14), item: `R5 proof order ${STAMP}`, notes: STAMP, lines: [{ lineNumber: 1, activityId, itemCode: `${STAMP}-C`, description: `R5 proof line ${STAMP}`, unit: 'nr', orderedQty: 10, unitCost: 5 }] });
    const orderId = order.body?.data?.id;
    const steps = [];
    for (const [step, person] of [['submit', procurement], ['approve', pm], ['issue', procurement]]) steps.push(orderId ? await ask(person, 'POST', `${AP}/purchase-orders/${orderId}/${step}`, {}) : { status: 0 });
    const poLineId = orderId ? await val('select id from "ProcurementPoLine" where "orderId" = $1', [orderId]) : null;
    check('F2 setup: a fresh order of 10 is created, submitted, approved and issued', ok2xx(order) && steps.every((r) => r.status === 200) && poLineId, [order, ...steps].map(said).join(' | '));
    const f2 = [];
    for (const [label, value] of ARRAYS) {
      f2.push(['inventory door', label, await ask(store, 'POST', '/inventory/goods-receipt', { orderId, warehouseId: siteWh, receiptNumber: `${STAMP}-G-${f2.length}`, lines: [{ poLineId, acceptedQty: value }] })]);
      f2.push(['procurement door', label, await ask(store, 'POST', `${AP}/procurement/purchase-orders/${orderId}/receipts`, { receiptNumber: `${STAMP}-P-${f2.length}`, warehouseId: siteWh, lines: [{ poLineId, acceptedQty: value }] })]);
    }
    const refusedReceipts = Number(await val('select count(*)::int from "DeliveryReceipt" where "receiptNumber" like $1', [`${STAMP}-%`]));
    const receiptGate = await ask(store, 'POST', '/inventory/goods-receipt', { orderId, warehouseId: siteWh, receiptNumber: `${STAMP}-OWN`, lines: [{ poLineId, acceptedQty: 1 }] });
    gated(receiptGate, 'F2 goods receipt acceptedQty [1,1] [5] [] {"n":1} true on both doors: each 400 naming lines[0].acceptedQty (were a receipt with no lines), no receipt stored',
      f2.every(([, , r]) => refusedNaming(r, 'lines[0].acceptedQty')) && refusedReceipts === 0, `${f2.filter(([, , r]) => !refusedNaming(r, 'lines[0].acceptedQty')).map(([d, l, r]) => `${d} ${l}: ${said(r)}`).join(' | ')} stored ${refusedReceipts}`);
    const ownReceipt = await one('select (select count(*)::int from "DeliveryReceiptLine" l where l."receiptId" = r.id) as lines from "DeliveryReceipt" r where r."receiptNumber" = $1', [`${STAMP}-OWN`]);
    check('F2 read back: the own receipt is stored with its one line, the order line has 1 received', ownReceipt?.lines === 1 && Number(await val('select "receivedQty" from "ProcurementPoLine" where id = $1', [poLineId])) === 1, JSON.stringify(ownReceipt));

    // F3 a money field (moneyBody).
    const f3 = [];
    for (const [label, value] of [['["5"]', ['5']], ['[5]', [5]], ['[]', []], ['{"n":1}', { n: 1 }]]) f3.push([label, await ask(cost, 'POST', `${AP}/cost/burn-rate`, { amount: value, date: day(0), note: `${STAMP} F3 ${label}` })]);
    const moneyGate = await ask(cost, 'POST', `${AP}/cost/burn-rate`, { amount: '5', date: day(0), note: `${STAMP} F3 own` });
    gated(moneyGate, 'F3 POST cost/burn-rate amount ["5"] [5] [] {"n":1}: each 400 naming amount (["5"] was taken as 5)', f3.every(([, r]) => refusedNaming(r, 'amount')), f3.filter(([, r]) => !refusedNaming(r, 'amount')).map(([l, r]) => `${l}: ${said(r)}`).join(' | '));
    const f3rows = await q('select note, amount::text as amount from "BurnRateEntry" where "projectId" = $1 and note like $2', [A.id, `${STAMP} F3%`]);
    check('F3 read back: only the own burn-rate entry is stored, 5.00', f3rows.length === 1 && f3rows[0].note === `${STAMP} F3 own` && Number(f3rows[0].amount) === 5, JSON.stringify(f3rows));
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
  console.log('\nper case:');
  for (const [name, e] of byCase) console.log(`  ${e.failed ? 'FAIL' : 'ok  '}  ${name}: ${e.passed} passed, ${e.failed} failed`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${GROUP} proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.log(error);
  process.exit(1);
});
