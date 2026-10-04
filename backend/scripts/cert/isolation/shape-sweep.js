'use strict';

/**
 * The wrongly-shaped-identifier sweep (CERT-2): no identifier field may answer
 * a 5xx, whatever shape the value has.
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/shape-sweep.js
 *   CERT_INPROCESS=1 node scripts/cert/isolation/shape-sweep.js --attacker=044 --only="activities|workflows" --name=shape-sweep-subset
 *
 * The foreign-reference attack (inject.js, results in
 * <work>/results/isolation/cert2b-inject.json) found every (method, route,
 * field) where a company's accepted request carries one of its own
 * identifiers. For each such pair this sweep takes ONE accepted request of
 * the captured corpus (<work>/corpus/*.jsonl) — company 044's when it has one,
 * else the first company with active billing whose corpus has the pair —
 * matched exactly as inject.js matches it (the first entry whose field holds
 * the company's own identifier), and sends it again as the same person with
 * that one field replaced by the victim's identifier (the one inject.js used)
 * in each of these shapes:
 *
 *   ["<foreign>"]   [["<foreign>"]]   {"id":"<foreign>"}   12345   true   {"not":"x"}
 *
 * (an array element is replaced in place, so engineerIds[] = ["<foreign>"]
 * sends engineerIds: [["<foreign>"]]).
 *
 * Each answer is judged:
 *   SERVER_ERROR  5xx — a finding: a wrongly shaped value must be refused (4xx)
 *   LEAK          the answer carries the victim's canary text, people's
 *                 addresses, company name or another of its identifiers
 *   REFUSED       400/403/404/422
 *   OWN_STATE     409 or 402: the caller's own record (or billing) refused on
 *                 its own state before the field was judged — not judged,
 *                 listed per pair
 *   ACCEPTED      2xx: must store nothing that names the foreign identifier
 *                 (cross-company reference census before and after, attributed
 *                 to the foreign identifiers this sweep sent) and change
 *                 nothing of the victim (fingerprint, restricted to victims)
 *   OTHER_4XX     any other 4xx (405, 413, 429 …), listed
 *
 * Results: <work>/results/isolation/<name>.json. The last line is
 *   shape sweep: N requests, X 5xx, Y accepted, Z own-state
 * Exit code 0 when no answer is a 5xx or a leak, no new cross-company
 * reference names a foreign identifier sent here, and no victim's data
 * changed; 2 otherwise.
 *
 * Read-only on the database (one connection, read-only transactions); every
 * write goes through the API as the attacker's own people.
 */

const path = require('path');
const fs = require('fs');
const { as, multipart } = require('../lib/api');
const guard = require('../lib/cert-env');
const { buildMatcher } = require('../lib/routes');
const { buildIndex } = require('./index-ids');
const crossLinks = require('./cross-links');
const fingerprint = require('./fingerprint');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const arg = (name, fallback = null) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const NAME = arg('name', 'shape-sweep');
const PREFERRED = arg('attacker', '044');
const INJECT = arg('inject', 'cert2b-inject');
const ONLY = arg('only') ? new RegExp(arg('only')) : null;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UUID_ONE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SHAPES = [
  ['["id"]', (id) => [id]],
  ['[["id"]]', (id) => [[id]]],
  ['{"id":id}', (id) => ({ id })],
  ['12345', () => 12345],
  ['true', () => true],
  ['{"not":"x"}', () => ({ not: 'x' })],
];

// The same helpers as inject.js: where identifiers sit in a body, and one replaced by its trail.
const idFields = (value, trail = []) => {
  if (typeof value === 'string') return UUID_ONE.test(value) ? [[trail, value]] : [];
  if (Array.isArray(value)) return value.flatMap((item, i) => idFields(item, [...trail, i]));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => idFields(v, [...trail, k]));
  return [];
};
const withValue = (body, trail, replacement) => {
  const copy = JSON.parse(JSON.stringify(body));
  let node = copy;
  for (let i = 0; i < trail.length - 1; i += 1) node = node[trail[i]];
  node[trail[trail.length - 1]] = replacement;
  return copy;
};
const fieldName = (trail) => trail.map((part) => (typeof part === 'number' ? '[]' : part)).join('.').replace(/\.\[\]/g, '[]');

/**
 * The pairs another group owns (their services and routes): a 5xx there is
 * reported to them, not fixed here.
 */
const OTHER_GROUPS = [
  [/^\/inventory\//, 'inventory / goods-receipt (inventory.service.js, goods-receipt.service.js, routes/inventory.js)'],
  [/\/procurement\/purchase-orders\/\{orderId\}\/receipts$/, 'goods-receipt (goods-receipt.service.js via routes/procurement.js receipts)'],
  [/^\/projects\/\{projectId\}\/timesheets/, 'timesheets (timesheet.service.js, routes/timesheets.js)'],
  [/^\/projects\/\{projectId\}\/daily-logs/, 'daily logs (daily-log.service.js, routes/daily-logs.js)'],
];
const ownerGroup = (template) => OTHER_GROUPS.find(([re]) => re.test(template))?.[1] || null;

const verdictOf = (res) => {
  if (res.status === 0) return 'NOT_SENT';
  if (res.status >= 500) return 'SERVER_ERROR';
  if ([400, 403, 404, 422].includes(res.status)) return 'REFUSED';
  if (res.status === 409 || res.status === 402) return 'OWN_STATE';
  if (res.status >= 400) return 'OTHER_4XX';
  return 'ACCEPTED';
};

const main = async () => {
  const started = Date.now();
  const inject = JSON.parse(fs.readFileSync(path.join(WORK, 'results', 'isolation', `${INJECT}.json`), 'utf8'));
  const billingBlocked = new Set(inject.results.filter((r) => r.verdict === 'REFUSED_OWN_BILLING').map((r) => r.attacker));

  // Every (method, template, field) the injection found, with the row of each attacker.
  const pairs = new Map();
  for (const row of inject.results) {
    const key = `${row.method} ${row.template} ${row.field}`;
    if (ONLY && !ONLY.test(key)) continue;
    const pair = pairs.get(key) || pairs.set(key, { key, method: row.method, template: row.template, field: row.field, type: row.type, byAttacker: new Map() }).get(key);
    if (!pair.byAttacker.has(row.attacker)) pair.byAttacker.set(row.attacker, row);
  }
  console.log(`pairs: ${pairs.size} (from ${INJECT}); companies refused on their own billing (not used): ${[...billingBlocked].sort().join(', ') || 'none'}`);

  const db = await guard.connectCert();
  const readOnly = async (fn) => {
    await db.query('begin transaction isolation level repeatable read read only');
    try {
      return await fn();
    } finally {
      await db.query('rollback');
    }
  };

  // Who owns which identifier, now (the selection must hold the company's own id).
  const built = await readOnly(() => buildIndex(db));
  const ownerOf = (id) => built.index[String(id).toLowerCase()] || null;
  const victimCodes = new Set();

  // The corpus: the first accepted request per (company, pair) whose field holds that company's own id.
  const match = buildMatcher(JSON.parse(fs.readFileSync(path.join(WORK, 'routes.json'), 'utf8')));
  const corpusDir = arg('corpus', path.join(WORK, 'corpus'));
  const files = fs.readdirSync(corpusDir).filter((f) => f.endsWith('.jsonl'));
  const chosen = new Map(); // `${code} ${pairKey}` -> { entry, trail }
  const scanCorpus = (codes) => {
    for (const file of files) {
      for (const line of fs.readFileSync(path.join(corpusDir, file), 'utf8').split('\n')) {
        if (!line) continue;
        const code = /@c(\d{3})\.octapm-cert\.test"/.exec(line)?.[1];
        if (!code || !codes.has(code)) continue;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (entry.method === 'GET' || !(entry.status >= 200 && entry.status < 300) || !entry.actor) continue;
        if (/@c(\d{3})\.octapm-cert\.test$/.exec(entry.actor)?.[1] !== code) continue;
        const body = entry.file ? entry.file.fields : entry.json;
        if (!body || typeof body !== 'object') continue;
        const hit = match(entry.method, entry.route);
        if (!hit) continue;
        for (const [trail, value] of idFields(body)) {
          const key = `${entry.method} ${hit.template} ${fieldName(trail)}`;
          const pair = pairs.get(key);
          if (!pair || !pair.byAttacker.has(code) || chosen.has(`${code} ${key}`)) continue;
          const own = ownerOf(value);
          if (!own || own[0] !== code) continue;
          chosen.set(`${code} ${key}`, { entry, trail });
        }
      }
    }
  };
  scanCorpus(new Set([PREFERRED]));
  const missing = [...pairs.values()].filter((p) => !chosen.has(`${PREFERRED} ${p.key}`));
  if (missing.length) {
    const others = new Set();
    for (const p of missing) for (const code of p.byAttacker.keys()) if (code !== PREFERRED && !billingBlocked.has(code)) others.add(code);
    console.log(`${missing.length} pair(s) have no request of company ${PREFERRED}; looking in ${others.size} other companies' corpus`);
    scanCorpus(others);
  }

  const plan = [];
  const unplanned = [];
  for (const pair of pairs.values()) {
    const codes = [PREFERRED, ...[...pair.byAttacker.keys()].filter((c) => c !== PREFERRED && !billingBlocked.has(c)).sort()];
    const code = codes.find((c) => pair.byAttacker.has(c) && chosen.has(`${c} ${pair.key}`));
    if (!code) {
      unplanned.push(pair.key);
      continue;
    }
    const row = pair.byAttacker.get(code);
    victimCodes.add(row.victim);
    plan.push({ pair, attacker: code, victim: row.victim, foreign: row.foreign, injectRoute: row.route, ...chosen.get(`${code} ${pair.key}`) });
  }
  const foreignIds = new Set(plan.map((p) => p.foreign.toLowerCase()));
  // The victims' identifiers, to recognise one in an answer (the rest of the index is not needed).
  const victimIds = new Map();
  for (const [id, [code, type]] of Object.entries(built.index)) if (victimCodes.has(code)) victimIds.set(id, [code, type]);
  built.index = null;
  console.log(`planned: ${plan.length} pair(s) × ${SHAPES.length} shapes = ${plan.length * SHAPES.length} requests; companies: ${[...new Set(plan.map((p) => p.attacker))].join(', ')}; victims: ${[...victimCodes].join(', ')}${unplanned.length ? `; no corpus request for ${unplanned.length}: ${unplanned.join(' | ')}` : ''}`);

  const linksBefore = await readOnly(() => crossLinks.scan(db));
  const printBefore = await readOnly(() => fingerprint.take(db));

  const results = [];
  let done = 0;
  for (const item of plan) {
    const { entry, trail, pair } = item;
    const session = as(entry.actor, entry.org || null);
    for (const [shape, make] of SHAPES) {
      const value = make(item.foreign);
      let res;
      try {
        if (entry.file) {
          const fields = withValue(entry.file.fields, trail, value);
          res = await session.send(entry.method, entry.route, undefined, { form: multipart({ field: entry.file.field, filename: entry.file.filename || 'shape.pdf', contentType: entry.file.contentType, body: Buffer.from('%PDF-1.4 shape sweep'), fields }) });
        } else {
          res = await session.send(entry.method, entry.route, withValue(entry.json, trail, value));
        }
      } catch (error) {
        res = { status: 0, text: String(error.message || error), body: null };
      }
      done += 1;
      const text = res.text ?? '';
      const canary = new RegExp(`CANARY-${item.victim}-[A-Za-z0-9]`).test(text);
      const address = new RegExp(`@c${item.victim}\\.octapm-cert\\.test`).test(text);
      const companyName = text.includes(`(CERT-${item.victim})`);
      const disclosed = [...new Set((text.match(UUID) || []).map((id) => id.toLowerCase()).filter((id) => victimIds.has(id) && id !== item.foreign.toLowerCase()))];
      let verdict = verdictOf(res);
      if (verdict !== 'NOT_SENT' && (canary || address || companyName || disclosed.length)) verdict = 'LEAK';
      const message = String(res.body?.error?.message || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      results.push({
        attacker: item.attacker,
        victim: item.victim,
        actor: entry.actor,
        method: entry.method,
        template: pair.template,
        route: entry.route,
        field: pair.field,
        type: pair.type,
        trail: trail.join('.'),
        shape,
        foreign: item.foreign,
        status: res.status,
        code: res.body?.error?.code || null,
        verdict,
        echoesForeign: text.toLowerCase().includes(item.foreign.toLowerCase()),
        otherGroup: ownerGroup(pair.template),
        ...(verdict === 'SERVER_ERROR' ? { error: message.find((l) => /invocation|Argument|Error|Unknown|Invalid|must|expected/i.test(l))?.slice(0, 240) || message[0]?.slice(0, 240) || text.slice(0, 240), at: (message.find((l) => /\.js:\d+/.test(l)) || '').replace(/^.*[\\/](src[\\/])/, '$1').slice(0, 160) } : {}),
        ...(verdict === 'LEAK' ? { evidence: { canary, address, companyName, ids: disclosed.slice(0, 5).map((id) => `${id} (${victimIds.get(id)[1]})`) } } : {}),
        ...(verdict === 'ACCEPTED' || verdict === 'OTHER_4XX' ? { created: res.body?.data?.id || null, sample: text.slice(0, 300) } : {}),
      });
    }
    if (done % 300 === 0) console.log(`  ${done}/${plan.length * SHAPES.length}`);
  }

  const linksAfter = await readOnly(() => crossLinks.scan(db));
  const printAfter = await readOnly(() => fingerprint.take(db));
  await db.end();

  const linkKey = (l) => `${l.table}|${l.id}|${l.target}`;
  const had = new Set(linksBefore.map(linkKey));
  const newLinks = linksAfter.filter((l) => !had.has(linkKey(l)));
  const attackers = new Set(plan.map((p) => p.attacker));
  const namingSent = newLinks.filter((l) => foreignIds.has(String(l.target).toLowerCase()) || attackers.has(l.home));
  const victimChanges = fingerprint.compare(printBefore, printAfter).filter((c) => !c.noise && victimCodes.has(c.org));

  const tally = (items, k) => items.reduce((acc, item) => ({ ...acc, [k(item)]: (acc[k(item)] || 0) + 1 }), {});
  const byPair = new Map();
  for (const r of results) {
    const key = `${r.method} ${r.template} ${r.field}`;
    const entry = byPair.get(key) || byPair.set(key, { key, attacker: r.attacker, otherGroup: r.otherGroup, shapes: {} }).get(key);
    entry.shapes[r.shape] = `${r.status}${r.code ? ` ${r.code}` : ''}`;
    entry.verdicts = [...new Set([...(entry.verdicts || []), r.verdict])];
  }
  const ownStatePairs = [...byPair.values()].filter((p) => p.verdicts.includes('OWN_STATE')).map((p) => ({ pair: p.key, attacker: p.attacker, answers: [...new Set(Object.values(p.shapes))].join('; '), allShapesOwnState: p.verdicts.length === 1, otherGroup: p.otherGroup }));
  const serverErrors = results.filter((r) => r.verdict === 'SERVER_ERROR');
  const leaks = results.filter((r) => r.verdict === 'LEAK');
  const accepted = results.filter((r) => r.verdict === 'ACCEPTED');
  const ownState = results.filter((r) => r.verdict === 'OWN_STATE');
  const summary = {
    name: NAME,
    at: new Date().toISOString(),
    seconds: Math.round((Date.now() - started) / 1000),
    inject: INJECT,
    pairs: pairs.size,
    planned: plan.length,
    unplanned,
    requests: results.length,
    byVerdict: tally(results, (r) => r.verdict),
    serverErrorPairs: [...new Set(serverErrors.map((r) => `${r.method} ${r.template} ${r.field}`))].length,
    serverErrorsInOtherGroups: serverErrors.filter((r) => r.otherGroup).length,
    newCrossCompanyReferences: newLinks.length,
    newReferencesNamingSentOrFromAttacker: namingSent.length,
    victimTablesChanged: victimChanges.length,
  };
  const outDir = path.join(WORK, 'results', 'isolation');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${NAME}.json`), JSON.stringify({ summary, ownStatePairs, serverErrors, leaks, accepted, newLinks, victimChanges, pairs: [...byPair.values()], results }, null, 1));

  console.log(JSON.stringify(summary, null, 1));
  if (serverErrors.length) {
    console.log('\n5xx (method template [field] shape -> status: error @ where):');
    for (const r of serverErrors) console.log(`  ${r.method} ${r.template} [${r.field}] ${r.shape} -> ${r.status}: ${r.error} @ ${r.at}${r.otherGroup ? `  [other group: ${r.otherGroup}]` : ''}`);
  }
  if (leaks.length) {
    console.log('\nleaks:');
    for (const r of leaks) console.log(`  ${r.method} ${r.template} [${r.field}] ${r.shape} -> ${r.status} ${JSON.stringify(r.evidence)}`);
  }
  if (accepted.length) {
    console.log('\naccepted (2xx):');
    for (const [kind, n] of Object.entries(tally(accepted, (r) => `${r.method} ${r.template} [${r.field}] -> ${r.status}`))) console.log(`  ${n}×  ${kind}`);
  }
  const other4xx = results.filter((r) => r.verdict === 'OTHER_4XX');
  if (other4xx.length) {
    console.log('\nother 4xx:');
    for (const [kind, n] of Object.entries(tally(other4xx, (r) => `${r.method} ${r.template} [${r.field}] -> ${r.status} ${r.code || ''}`))) console.log(`  ${n}×  ${kind}`);
  }
  if (ownStatePairs.length) {
    console.log(`\nown-state pairs (409/402 from the caller's own record or billing; not judged): ${ownStatePairs.length}`);
    for (const p of ownStatePairs) console.log(`  ${p.allShapesOwnState ? 'all ' : 'some'}  ${p.pair} -> ${p.answers}${p.otherGroup ? `  [other group]` : ''}`);
  }
  if (namingSent.length) {
    console.log('\nnew cross-company references naming a foreign id sent here (or written in an attacker company):');
    for (const l of namingSent.slice(0, 40)) console.log(`  ${l.table} ${l.id} (company ${l.home}) -> ${l.targetType} ${l.target} (company ${l.targetCode})`);
  }
  if (victimChanges.length) console.log(`\nvictim data changed: ${victimChanges.map((c) => `${c.org}:${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', ')}`);
  console.log(`\nshape sweep: ${results.length} requests, ${serverErrors.length} 5xx, ${accepted.length} accepted, ${ownState.length} own-state`);
  process.exitCode = serverErrors.length || leaks.length || namingSent.length || victimChanges.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
