'use strict';

/**
 * The cross-company replay attack.
 *
 * Every request a company's own people made successfully while their data was
 * being built is in the corpus: the method, the path with the company's real
 * identifiers, and a body the product accepted. This tool sends each of them
 * again, unchanged, as SOMEBODY FROM ANOTHER COMPANY — a PM and company
 * administrator of the next company, a person who also belongs to the victim
 * company but is signed in to a different one, and nobody at all.
 *
 * Because the body is one the product is known to accept, a refusal cannot be
 * a validation accident: it is the access rule. Every answer is examined:
 *
 *   REFUSED            401, 403 or 404 — the access rule
 *   REFUSED_VALIDATION 400 — the outsider's request failed validation that the owner's
 *                      identical request passed. Usually a reference check (defense in
 *                      depth), not the access rule: listed for triage, never counted as a pass
 *   REFUSED_LATE       any other 4xx (409, 422, …): the request got past the access rule and
 *                      was stopped by business logic or a constraint acting on the victim's
 *                      record — a finding until triaged
 *   SERVER_ERROR       5xx — a finding on its own (a database constraint that stopped the
 *                      write is defense in depth, not authorization)
 *   FILTERED           2xx read, byte-identical to the answer for a random id in the
 *                      victim's place: the caller's own company filter, no data, no oracle
 *   ANSWERED           any other 2xx read of a path bound to the victim's record —
 *                      a cross-company read until triaged
 *   NO_VICTIM_DATA     2xx read of a path with no victim identifier, holding nothing of the victim's
 *   LEAK               2xx/4xx whose body holds the victim's identifiers or canary text
 *   WRITE_ACCEPTED     a write answered 2xx — a cross-company write unless proven otherwise
 *
 * and the whole database is fingerprinted before and after: no company's data
 * may differ at all.
 *
 *   node scripts/cert/isolation/replay.js --name=run1                    # every victim
 *   node scripts/cert/isolation/replay.js --name=t --victims=022,023 --per-template=2
 *   node scripts/cert/isolation/replay.js --name=t --methods=GET
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const fs = require('fs');
const guard = require('../lib/cert-env');
const { canaryDisclosed, controlRoute, sameAnswer } = require('./judging');
const { as, raw, multipart, pool } = require('../lib/api');
const { buildMatcher } = require('../lib/routes');
const { buildPopulation } = require('../lib/spec');
const fingerprint = require('./fingerprint');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const arg = (name, fallback = null) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const list = (name) => arg(name)?.split(',') || null;
const NAME = arg('name', 'replay');
const VICTIMS = list('victims');
const METHODS = list('methods');
const PER_TEMPLATE = Number(arg('per-template', 2));
const CONCURRENCY = Number(arg('concurrency', 12));
const KINDS = list('attackers') || ['outsider', 'member-elsewhere', 'anonymous'];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const readCorpus = () => {
  const dir = arg('corpus', path.join(WORK, 'corpus'));
  const entries = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
    for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) {
      if (!line) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        /* a line cut short by a stopped process */
      }
    }
  }
  return entries;
};

const main = async () => {
  const population = buildPopulation();
  const byCode = new Map(population.companies.map((c) => [c.code, c]));
  const routes = JSON.parse(fs.readFileSync(path.join(WORK, 'routes.json'), 'utf8'));
  const match = buildMatcher(routes);
  const { index } = JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'id-index.json'), 'utf8'));
  const ownerOf = (id) => index[id.toLowerCase()]?.[0] || null;

  // ── the corpus, per victim and route ─────────────────────────────────────
  const corpus = readCorpus().filter((e) => e.status >= 200 && e.status < 300 && e.actor);
  const codeOfActor = (entry) => /@c(\d{3})\.octapm-cert\.test$/.exec(entry.actor)?.[1] || (entry.org ? ownerOf(entry.org) : null);
  const perVictim = new Map();
  let unmatched = 0;
  for (const entry of corpus) {
    const victim = codeOfActor(entry);
    if (!victim || (VICTIMS && !VICTIMS.includes(victim))) continue;
    if (METHODS && !METHODS.includes(entry.method)) continue;
    const hit = match(entry.method, entry.route);
    if (!hit) {
      unmatched += 1;
      continue;
    }
    // Only requests that name something of the victim's: an identifier of theirs in the path, the query or the body.
    const text = `${entry.route} ${entry.json ? JSON.stringify(entry.json) : ''} ${entry.file ? JSON.stringify(entry.file.fields || {}) : ''}`;
    const ids = text.match(UUID) || [];
    const victimIds = ids.filter((id) => ownerOf(id) === victim);
    const inPath = (entry.route.match(UUID) || []).some((id) => ownerOf(id) === victim);
    if (!victimIds.length) continue;
    const key = `${entry.method} ${hit.template}`;
    const groups = perVictim.get(victim) || perVictim.set(victim, new Map()).get(victim);
    const group = groups.get(key) || groups.set(key, []).get(key);
    if (group.length < PER_TEMPLATE) group.push({ ...entry, template: hit.template, victimIdInPath: inPath });
  }

  // ── who attacks whom ─────────────────────────────────────────────────────
  const attackersFor = (victim) => {
    const out = [];
    const company = byCode.get(victim);
    if (KINDS.includes('outsider')) {
      const next = population.companies[company.n % population.companies.length];
      out.push({ kind: 'outsider', label: `PM and administrator of company ${next.code}`, session: () => as(`pm@${next.domain}`) });
    }
    if (KINDS.includes('member-elsewhere')) {
      // A person who belongs to the victim company too, but is signed in to another of their companies.
      for (const person of population.multi) {
        const here = person.memberships.find((m) => m.code === victim);
        const elsewhere = person.memberships.find((m) => m.code !== victim && (m.isAdmin || m.role === 'pm')) || person.memberships.find((m) => m.code !== victim);
        if (here && elsewhere) {
          out.push({ kind: 'member-elsewhere', label: `${person.key}, a ${here.role} here, signed in to company ${elsewhere.code} as ${elsewhere.role}`, session: () => as(person.email, elsewhere.orgId) });
          break;
        }
      }
    }
    if (KINDS.includes('anonymous')) out.push({ kind: 'anonymous', label: 'nobody (no token)', session: null });
    return out;
  };

  const attacks = [];
  for (const [victim, groups] of perVictim) {
    const attackers = attackersFor(victim);
    for (const [key, examples] of groups) for (const example of examples) for (const attacker of attackers) attacks.push({ victim, key, example, attacker });
  }
  console.log(`corpus: ${corpus.length} successful requests (${unmatched} matched no route); victims: ${perVictim.size}; route templates attacked: ${new Set(attacks.map((a) => a.key)).size}; attacks: ${attacks.length}`);

  // ── before ───────────────────────────────────────────────────────────────
  const db = await guard.connectCert();
  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const print = await fingerprint.take(db);
    await db.query('rollback');
    return print;
  };
  const before = await snapshot();

  // ── the sweep ────────────────────────────────────────────────────────────
  const judge = (attack, res) => {
    const text = res.text ?? (res.body ? JSON.stringify(res.body) : '');
    const sentText = `${attack.example.route} ${JSON.stringify(attack.example.json || {})}`;
    // Canary text or an identifier the attacker sent comes back in echoes and validation errors; it is not a disclosure.
    const victimCanary = canaryDisclosed(text, sentText, attack.victim);
    const victimIds = [...new Set((text.match(UUID) || []).filter((id) => ownerOf(id) === attack.victim))];
    const sent = new Set((sentText.match(UUID) || []).map((id) => id.toLowerCase()));
    const disclosed = victimIds.filter((id) => !sent.has(id.toLowerCase()));
    const write = attack.example.method !== 'GET';
    if (victimCanary || disclosed.length) return { verdict: 'LEAK', evidence: { canary: victimCanary, ids: disclosed.slice(0, 5).map((id) => `${id} (${index[id.toLowerCase()][1]})`) } };
    if (res.status >= 500) return { verdict: 'SERVER_ERROR' };
    if ([401, 403, 404].includes(res.status)) return { verdict: 'REFUSED' };
    if (res.status === 400) return { verdict: 'REFUSED_VALIDATION' };
    if (res.status >= 400) return { verdict: 'REFUSED_LATE' };
    if (write) return { verdict: 'WRITE_ACCEPTED' };
    // A read of the victim's own record that was not refused counts as a
    // cross-company read until the random-id control below clears it.
    return { verdict: attack.example.victimIdInPath ? 'ANSWERED' : 'NO_VICTIM_DATA' };
  };

  let done = 0;
  const results = await pool(attacks, CONCURRENCY, async (attack) => {
    const { example, attacker } = attack;
    const options = {};
    if (example.file) options.form = multipart({ field: example.file.field, filename: example.file.filename || 'attack.pdf', contentType: example.file.contentType, body: Buffer.from('%PDF-1.4 attack'), fields: example.file.fields });
    let res;
    try {
      res = attacker.session
        ? await attacker.session().send(example.method, example.route, example.file ? undefined : example.json, options)
        : await raw(example.method, example.route, { json: example.file ? undefined : example.json, ...options });
    } catch (error) {
      res = { status: 0, text: String(error.message || error), body: null };
    }
    done += 1;
    if (done % 5000 === 0) console.log(`  ${done}/${attacks.length}`);
    let judged = res.status === 0 ? { verdict: 'NOT_SENT' } : judge(attack, res);
    // The random-id control (judging.js): the same answer for a random id in the
    // victim's place means the caller's own company filter answered.
    if (judged.verdict === 'ANSWERED') {
      const victimIds = [...new Set((example.route.match(UUID) || []).filter((id) => ownerOf(id) === attack.victim))];
      if (victimIds.length) {
        const control = controlRoute(example.route, victimIds);
        const other = await (attacker.session ? attacker.session().send('GET', control.route) : raw('GET', control.route)).catch(() => null);
        if (sameAnswer(res, other, control.swaps)) judged = { verdict: 'FILTERED', evidence: { sameAsRandomId: true } };
      }
    }
    return {
      victim: attack.victim,
      attacker: attacker.kind,
      attackerLabel: attacker.label,
      method: example.method,
      template: example.template,
      route: example.route,
      victimIdInPath: example.victimIdInPath,
      status: res.status,
      code: res.body?.error?.code || null,
      ...judged,
      ...(judged.verdict !== 'REFUSED' ? { sample: String(res.text ?? '').slice(0, 300) } : {}),
    };
  });

  // ── after ────────────────────────────────────────────────────────────────
  const after = await snapshot();
  await db.end();
  const changes = fingerprint.compare(before, after);
  const realChanges = changes.filter((c) => !c.noise);

  const tally = (items, key) => items.reduce((acc, item) => ({ ...acc, [key(item)]: (acc[key(item)] || 0) + 1 }), {});
  const summary = {
    name: NAME,
    at: new Date().toISOString(),
    victims: perVictim.size,
    routeTemplates: new Set(attacks.map((a) => a.key)).size,
    attacks: results.length,
    byVerdict: tally(results, (r) => r.verdict),
    byAttacker: tally(results, (r) => `${r.attacker}/${r.verdict}`),
    byStatus: tally(results, (r) => r.status),
    dataChanged: realChanges.length,
    dataChangedTables: tally(realChanges, (c) => c.table),
    noiseChanged: tally(changes.filter((c) => c.noise), (c) => c.table),
  };
  const outDir = path.join(WORK, 'results', 'isolation');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${NAME}.json`), JSON.stringify({ summary, changes: realChanges, results }, null, 0));
  console.log(JSON.stringify(summary, null, 1));
  const concerning = results.filter((r) => ['LEAK', 'WRITE_ACCEPTED', 'SERVER_ERROR', 'REFUSED_LATE', 'ANSWERED'].includes(r.verdict));
  const kinds = tally(concerning, (r) => `${r.verdict} ${r.attacker} ${r.method} ${r.template} -> ${r.status} ${r.code || ''}`);
  for (const [kind, n] of Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 60)) console.log(`  ${n}×  ${kind}`);
  // Validation refusals are not passes: each route/code pair is triaged by hand
  // (access rule missing and a reference check caught it, or a genuine pass).
  const triage = tally(results.filter((r) => r.verdict === 'REFUSED_VALIDATION'), (r) => `${r.method} ${r.template} -> 400 ${r.code || ''}`);
  if (Object.keys(triage).length) {
    console.log(`\nREFUSED_VALIDATION to triage (${Object.keys(triage).length} route/code pairs):`);
    for (const [kind, n] of Object.entries(triage).sort((a, b) => b[1] - a[1])) console.log(`  ${n}×  ${kind}`);
  }
  process.exitCode = concerning.length || realChanges.length ? 2 : 0;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
