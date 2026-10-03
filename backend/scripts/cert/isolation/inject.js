'use strict';

/**
 * The foreign-reference attack.
 *
 * A company's person sends a request the product is known to accept from them
 * — the same method, the same path in THEIR OWN company, the same body — with
 * one identifier in the body replaced by another company's identifier of the
 * same kind: another company's activity, vendor, cost code, user, document,
 * warehouse… one field at a time, so the unchecked field is named exactly.
 *
 * The product must refuse the reference: 400, 403, 404 or 422 (for a
 * reference, the reference check IS the rule). Anything else is examined:
 *   LEAK                 the answer shows the other company's data (its
 *                        canary text, its people's addresses, its identifiers)
 *   ACCEPTED             the answer shows nothing, but a row of the attacker's
 *                        may now point at the other company's record — the
 *                        cross-company reference scan before and after says so.
 *   REFUSED_OWN_STATE    409: the attacker's own record (in the path) refused on its
 *                        own state before the reference was judged — a coverage gap,
 *                        listed; the reference census still catches anything stored
 *   REFUSED_OWN_BILLING  402 SUBSCRIPTION_REQUIRED: the caller's own billing gate
 *   REFUSED_LATE         another 4xx: the foreign identifier got past the reference
 *                        check and was stopped later — a finding until triaged
 *   SERVER_ERROR         5xx — typically a foreign-key constraint that stopped the
 *                        write: defense in depth, not authorization, so a finding
 *
 *   node scripts/cert/isolation/inject.js --name=inject1
 *   node scripts/cert/isolation/inject.js --name=t --attackers=022,023 --per-field=1
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const fs = require('fs');
const guard = require('../lib/cert-env');
const { as, multipart, pool } = require('../lib/api');
const { buildMatcher } = require('../lib/routes');
const { buildPopulation } = require('../lib/spec');
const crossLinks = require('./cross-links');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const arg = (name, fallback = null) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const NAME = arg('name', 'inject');
const ATTACKERS = arg('attackers')?.split(',') || null;
const PER_FIELD = Number(arg('per-field', 1));
const CONCURRENCY = Number(arg('concurrency', 10));
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UUID_ONE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every place in a JSON body where an identifier sits: [path, value]. */
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
/** A field's name without array positions: lines[].costCodeId */
const fieldName = (trail) => trail.map((part) => (typeof part === 'number' ? '[]' : part)).join('.').replace(/\.\[\]/g, '[]');

const main = async () => {
  const population = buildPopulation();
  const byCode = new Map(population.companies.map((c) => [c.code, c]));
  const match = buildMatcher(JSON.parse(fs.readFileSync(path.join(WORK, 'routes.json'), 'utf8')));
  const { index } = JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'id-index.json'), 'utf8'));
  const entryOf = (id) => index[id.toLowerCase()] || null;

  // The victim's identifiers by type (the victim of company N is company N+1).
  const idsByCompanyType = new Map();
  for (const [id, [code, type]] of Object.entries(index)) {
    const key = `${code} ${type}`;
    const bucket = idsByCompanyType.get(key) || idsByCompanyType.set(key, []).get(key);
    if (bucket.length < 5) bucket.push(id);
  }

  // The attacker's own accepted writes that carry one of their own identifiers in the body.
  const corpusDir = arg('corpus', path.join(WORK, 'corpus'));
  const attacks = [];
  const seen = new Map();
  for (const file of fs.readdirSync(corpusDir).filter((f) => f.endsWith('.jsonl'))) {
    for (const line of fs.readFileSync(path.join(corpusDir, file), 'utf8').split('\n')) {
      if (!line) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.method === 'GET' || !(entry.status >= 200 && entry.status < 300) || !entry.actor) continue;
      const code = /@c(\d{3})\.octapm-cert\.test$/.exec(entry.actor)?.[1];
      if (!code || (ATTACKERS && !ATTACKERS.includes(code))) continue;
      const body = entry.file ? entry.file.fields : entry.json;
      if (!body || typeof body !== 'object') continue;
      const hit = match(entry.method, entry.route);
      if (!hit) continue;
      const victim = population.companies[byCode.get(code).n % population.companies.length];
      for (const [trail, value] of idFields(body)) {
        const own = entryOf(value);
        if (!own || own[0] !== code) continue; // only fields that hold the attacker's own identifier
        const type = own[1];
        const foreign = idsByCompanyType.get(`${victim.code} ${type}`)?.[0];
        if (!foreign) continue;
        const key = `${code} ${entry.method} ${hit.template} ${fieldName(trail)}`;
        const count = seen.get(key) || 0;
        if (count >= PER_FIELD) continue;
        seen.set(key, count + 1);
        attacks.push({ attacker: code, victim: victim.code, entry, template: hit.template, field: fieldName(trail), type, trail, foreign, multipart: Boolean(entry.file) });
      }
    }
  }
  console.log(`attacks: ${attacks.length}; attackers: ${new Set(attacks.map((a) => a.attacker)).size}; (route, field) pairs: ${new Set(attacks.map((a) => `${a.entry.method} ${a.template} ${a.field}`)).size}`);

  const db = await guard.connectCert();
  const scan = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const links = await crossLinks.scan(db);
    await db.query('rollback');
    return links;
  };
  const before = await scan();

  let done = 0;
  const results = await pool(attacks, CONCURRENCY, async (attack) => {
    const { entry } = attack;
    const session = as(entry.actor, entry.org || null);
    let res;
    try {
      if (attack.multipart) {
        const fields = withValue(entry.file.fields, attack.trail, attack.foreign);
        res = await session.send(entry.method, entry.route, undefined, { form: multipart({ field: entry.file.field, filename: entry.file.filename || 'attack.pdf', contentType: entry.file.contentType, body: Buffer.from('%PDF-1.4 attack'), fields }) });
      } else {
        res = await session.send(entry.method, entry.route, withValue(entry.json, attack.trail, attack.foreign));
      }
    } catch (error) {
      res = { status: 0, text: String(error.message || error), body: null };
    }
    done += 1;
    if (done % 2000 === 0) console.log(`  ${done}/${attacks.length}`);
    const text = res.text ?? '';
    const canary = new RegExp(`CANARY-${attack.victim}-[A-Za-z0-9]`).test(text);
    const address = new RegExp(`@c${attack.victim}\\.octapm-cert\\.test`).test(text);
    const companyName = text.includes(`(CERT-${attack.victim})`);
    const disclosed = [...new Set((text.match(UUID) || []).filter((id) => entryOf(id)?.[0] === attack.victim && id.toLowerCase() !== attack.foreign.toLowerCase()))];
    let verdict;
    if (res.status === 0) verdict = 'NOT_SENT';
    else if (canary || address || companyName || disclosed.length) verdict = 'LEAK';
    else if (res.status >= 500) verdict = 'SERVER_ERROR';
    else if ([400, 403, 404, 422].includes(res.status)) verdict = 'REFUSED';
    // The caller's own billing gate, before the reference is looked at.
    else if (res.status === 402 && res.body?.error?.code === 'SUBSCRIPTION_REQUIRED') verdict = 'REFUSED_OWN_BILLING';
    // The path names the attacker's own record; a 409 is that record's own state
    // (locked, approved, duplicate) refusing first. The foreign reference was not
    // judged: listed as a coverage gap, and the reference census still catches
    // anything stored.
    else if (res.status === 409) verdict = 'REFUSED_OWN_STATE';
    else if (res.status >= 400) verdict = 'REFUSED_LATE';
    // A batch route that answers 2xx but refuses each item as not found — e.g.
    // POST /specifications/index: { documents: [{ error: 'Document not found', sections: 0 }] }
    // — refused the reference (proven NO_EFFECT in the CERT-2 fixes).
    else if (Array.isArray(res.body?.data?.documents) && res.body.data.documents.length
      && res.body.data.documents.every((d) => /not found/i.test(String(d?.error || '')) && !Number(d?.sections))) verdict = 'REFUSED';
    else verdict = 'ACCEPTED';
    return {
      attacker: attack.attacker,
      victim: attack.victim,
      method: entry.method,
      template: attack.template,
      route: entry.route,
      field: attack.field,
      type: attack.type,
      foreign: attack.foreign,
      status: res.status,
      code: res.body?.error?.code || null,
      verdict,
      ...(verdict === 'LEAK' ? { evidence: { canary, address, companyName, ids: disclosed.slice(0, 5).map((id) => `${id} (${entryOf(id)[1]})`) } } : {}),
      ...(verdict !== 'REFUSED' ? { sample: text.slice(0, 400), created: res.body?.data?.id || null } : {}),
    };
  });

  const after = await scan();
  await db.end();
  const key = (l) => `${l.table}|${l.id}|${l.target}`;
  const had = new Set(before.map(key));
  const newLinks = after.filter((l) => !had.has(key(l)));

  const tally = (items, k) => items.reduce((acc, item) => ({ ...acc, [k(item)]: (acc[k(item)] || 0) + 1 }), {});
  const summary = {
    name: NAME,
    at: new Date().toISOString(),
    attacks: results.length,
    routeFieldPairs: new Set(results.map((r) => `${r.method} ${r.template} ${r.field}`)).size,
    byVerdict: tally(results, (r) => r.verdict),
    crossCompanyReferencesBefore: before.length,
    crossCompanyReferencesAfter: after.length,
    newCrossCompanyReferences: newLinks.length,
    newReferencesByKind: tally(newLinks, (l) => `${l.table} -> ${l.targetType}`),
  };
  const outDir = path.join(WORK, 'results', 'isolation');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${NAME}.json`), JSON.stringify({ summary, newLinks, results }));
  console.log(JSON.stringify(summary, null, 1));
  const concerning = results.filter((r) => ['LEAK', 'ACCEPTED', 'SERVER_ERROR', 'REFUSED_LATE'].includes(r.verdict));
  for (const [kind, n] of Object.entries(tally(concerning, (r) => `${r.verdict} ${r.method} ${r.template} [${r.field} = another company's ${r.type}] -> ${r.status} ${r.code || ''}`)).sort((a, b) => b[1] - a[1]).slice(0, 80)) console.log(`  ${n}×  ${kind}`);
  process.exitCode = concerning.length || newLinks.length ? 2 : 0;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
