'use strict';

/**
 * WP-1 mutation evidence check (read only; no database, no API, no product file touched).
 *
 * For every proof-backed mutation of wp1-mutations.{cpm,gates,imports}.json it reads the proof result that
 * Claude Main copied after that mutation's run (run plan §7.4: results\cert3\wp1-mutations\<id>.json) and says
 * whether the named catchers are FAIL in it (a check that ran and failed; a check left "not run" by a section
 * error is NOT evidence), which collateral went red, and which other checks went red unexpectedly.
 *
 *   node scripts/cert/cert3/wp1-mutation-evidence.js [<dir with <id>.json files>]            all entries
 *   node scripts/cert/cert3/wp1-mutation-evidence.js --as=<result.json> --id=<C1|G2|...>     one result file judged as one entry
 *
 * Default dir: C:\Temp\octapm-cert\results\cert3\wp1-mutations. Exit 0 when every entry found is as its list
 * expects (CAUGHT by its named catchers, or SURVIVED with exit 0 for the C4 / C5 limitation probes); 2 otherwise.
 */

const fs = require('fs');
const path = require('path');

const C3 = __dirname;
const LISTS = ['wp1-mutations.cpm.json', 'wp1-mutations.gates.json', 'wp1-mutations.imports.json'];
const argOf = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
const dir = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'C:/Temp/octapm-cert/results/cert3/wp1-mutations';
const asFile = argOf('as');
const asId = argOf('id');

const entries = [];
for (const list of LISTS) {
  const spec = JSON.parse(fs.readFileSync(path.join(C3, list), 'utf8'));
  for (const m of spec.mutations) entries.push({ list, id: m.name.split(' ')[0], catchers: m.catchers || [], collateral: m.collateral || [], expectVerdict: m.expectVerdict || '', e6: m.e6 || '' });
}

const judge = (entry, file) => {
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byId = new Map((r.checks || []).map((c) => [c.id, c]));
  const state = (id) => {
    const c = byId.get(id);
    if (!c) return 'MISSING';
    if (c.notRun) return 'NOT RUN';
    return c.ok ? 'PASS' : 'FAIL';
  };
  const known = new Set([...entry.catchers, ...entry.collateral]);
  const unexpected = (r.checks || []).filter((c) => !c.ok && !c.notRun && !known.has(c.id)).map((c) => c.id);
  const notRun = (r.checks || []).filter((c) => c.notRun).length;
  const catcherStates = Object.fromEntries(entry.catchers.map((id) => [id, state(id)]));
  const collateralStates = Object.fromEntries(entry.collateral.map((id) => [id, state(id)]));
  const tally = r.observations?.tally || null;
  let verdict;
  if (entry.catchers.length === 0) {
    // C4 / C5: limitation probes, expected to survive (exit 0); a red run is read, never counted as evidence
    verdict = r.exitCode === 0 ? 'SURVIVED as expected (limitation probe, not E6)' : `UNEXPECTED: exit ${r.exitCode} on a probe expected to survive; read the result`;
  } else {
    const allFail = entry.catchers.every((id) => catcherStates[id] === 'FAIL');
    verdict = allFail ? 'EVIDENCE: every named catcher FAIL' : `NO EVIDENCE: catchers ${JSON.stringify(catcherStates)}`;
  }
  return {
    id: entry.id,
    list: entry.list,
    e6: entry.e6.startsWith('§6.2 WP-1 guard') ? entry.e6 : null,
    exitCode: r.exitCode,
    setupError: r.setupError ? { sectionErrors: (r.setupError.sectionErrors || []).length, notRun } : null,
    verdict,
    catchers: catcherStates,
    collateral: collateralStates,
    unexpectedRed: unexpected,
    knownAnswers: tally?.knownAnswers || null,
    fiveXX: (r.answers?.fiveXX || []).length,
    ok: entry.catchers.length === 0 ? r.exitCode === 0 : entry.catchers.every((id) => catcherStates[id] === 'FAIL'),
  };
};

const out = [];
if (asFile) {
  const entry = entries.find((e) => e.id === asId);
  if (!entry) { console.error(`--id=${asId}: no such entry (${entries.map((e) => e.id).join(' ')})`); process.exit(1); }
  out.push(judge(entry, asFile));
} else {
  for (const entry of entries) {
    const file = path.join(dir, `${entry.id}.json`);
    if (!fs.existsSync(file)) { out.push({ id: entry.id, list: entry.list, e6: entry.e6.startsWith('§6.2 WP-1 guard') ? entry.e6 : null, verdict: `no result file ${file}`, ok: false, missing: true }); continue; }
    out.push(judge(entry, file));
  }
}
for (const o of out) console.log(JSON.stringify(o));
const e6 = out.filter((o) => o.e6);
if (!asFile) console.log(`E6 (§6.2 WP-1 guards): ${e6.filter((o) => o.ok).length}/5 with evidence (${e6.map((o) => `${o.id} ${o.ok ? 'yes' : 'no'}`).join(', ')})`);
process.exit(out.every((o) => o.ok) ? 0 : 2);
