'use strict';

/**
 * WP-3 mutation evidence check (read only; no database, no API, no product file touched). Drafted read-only on
 * 2026-10-10 from wp1-mutation-evidence.js for WP3-RUN-PLAN.md section 7.4; to be committed beside the lists as
 * backend/scripts/cert/cert3/wp3-mutation-evidence.js.
 *
 * For every proof-backed mutation of wp3-mutations.ev.json and wp3-fix-mutations.l34.json it reads the proof result
 * that Claude Main copied after that mutation's run (results\cert3\wp3-mutations\<id>.json) and says whether the named
 * catchers are FAIL in it (a check that ran and failed; a check left "not run" by a section error is NOT evidence),
 * which collateral went red, which other checks went red unexpectedly, and whether the run was on the final code
 * (observations.l34Fix.commit set). With a baseline (the unmutated full run on the same code) it also confirms that
 * the baseline exited 0 and that every catcher PASSED there, so a red catcher is a flip.
 *
 *   node wp3-mutation-evidence.js [<dir with <id>.json files>] [--baseline=<result.json>] [--lists-dir=<dir>]
 *   node wp3-mutation-evidence.js --as=<result.json> --id=<M1|M2b|L34-M1|...>     one result file judged as one entry
 *
 * Defaults: dir C:\Temp\octapm-cert\results\cert3\wp3-mutations; baseline
 * C:\Temp\octapm-cert\results\cert3\wp3-ev-proof.baseline.json when it exists; lists beside this script.
 * Limitation probes (no catchers: L34-M3, L34-M4) are expected to SURVIVE with exit 0. L34-M5 (contractDependent) is
 * judged on its catchers when the result's observations.l34Fix.contract carries a value, and as a limitation probe
 * while every contract field is null ('contract pending the L34 plan review').
 * Exit 0 when every entry found is as its list expects; 2 otherwise.
 */

const fs = require('fs');
const path = require('path');

const argOf = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
const LISTS_DIR = argOf('lists-dir') || __dirname;
const LISTS = ['wp3-mutations.ev.json', 'wp3-fix-mutations.l34.json'];
const dir = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'C:/Temp/octapm-cert/results/cert3/wp3-mutations';
const asFile = argOf('as');
const asId = argOf('id');
const baselineFile = argOf('baseline') || (fs.existsSync('C:/Temp/octapm-cert/results/cert3/wp3-ev-proof.baseline.json') ? 'C:/Temp/octapm-cert/results/cert3/wp3-ev-proof.baseline.json' : null);
const E6_PREFIX = 'section 6.2 WP-3 guard';
const E6_COUNT = 4;

const entries = [];
for (const list of LISTS) {
  const spec = JSON.parse(fs.readFileSync(path.join(LISTS_DIR, list), 'utf8'));
  for (const m of spec.mutations) {
    entries.push({ list, id: m.name.split(' ')[0], catchers: m.catchers || [], collateral: m.collateral || [], expectVerdict: m.expectVerdict || '', e6: m.e6 || '', contractDependent: m.contractDependent === true });
  }
}

const stateIn = (result) => {
  const byId = new Map((result.checks || []).map((c) => [c.id, c]));
  return (id) => {
    const c = byId.get(id);
    if (!c) return 'MISSING';
    if (c.notRun) return 'NOT RUN';
    return c.ok ? 'PASS' : 'FAIL';
  };
};
const baseline = baselineFile ? JSON.parse(fs.readFileSync(baselineFile, 'utf8')) : null;
const baselineState = baseline ? stateIn(baseline) : null;

const judge = (entry, file) => {
  const r = JSON.parse(fs.readFileSync(file, 'utf8'));
  const state = stateIn(r);
  const contract = r.observations?.l34Fix?.contract || null;
  const contractPending = !contract || Object.values(contract).every((v) => v === null);
  const catchers = entry.contractDependent && contractPending ? [] : entry.catchers;
  const known = new Set([...catchers, ...entry.collateral]);
  const unexpected = (r.checks || []).filter((c) => !c.ok && !c.notRun && !known.has(c.id)).map((c) => c.id);
  const notRun = (r.checks || []).filter((c) => c.notRun).map((c) => c.id);
  const catcherStates = Object.fromEntries(catchers.map((id) => [id, state(id)]));
  const collateralStates = Object.fromEntries(entry.collateral.map((id) => [id, state(id)]));
  const finalCode = Boolean(r.observations?.l34Fix?.commit);
  const flips = baselineState ? Object.fromEntries(catchers.map((id) => [id, baselineState(id)])) : null;
  let verdict;
  let ok;
  if (catchers.length === 0) {
    ok = r.exitCode === 0;
    verdict = ok ? `SURVIVED as expected (limitation probe${entry.contractDependent ? ': the L34 contract is still pending' : ''}; not evidence, a TEST GAP to record)` : `UNEXPECTED: exit ${r.exitCode} on a probe expected to survive; read the result`;
  } else {
    const allFail = catchers.every((id) => catcherStates[id] === 'FAIL');
    const flipped = !flips || Object.values(flips).every((s) => s === 'PASS');
    ok = allFail && flipped && finalCode;
    verdict = ok ? 'EVIDENCE: every named catcher FAIL (PASS in the baseline)' : `NO EVIDENCE: catchers ${JSON.stringify(catcherStates)}${flipped ? '' : `; baseline ${JSON.stringify(flips)}`}${finalCode ? '' : '; the run was not on the final code (observations.l34Fix.commit not set)'}`;
  }
  return {
    id: entry.id,
    list: entry.list,
    e6: entry.e6.startsWith(E6_PREFIX) ? entry.e6 : null,
    exitCode: r.exitCode,
    setupError: r.setupError ? { sectionErrors: (r.setupError.sectionErrors || []).length, failedSetupChecks: r.setupError.failedSetupChecks || [], notRun: notRun.length } : null,
    verdict,
    catchers: catcherStates,
    baseline: flips,
    collateral: collateralStates,
    collateralNotRed: Object.entries(collateralStates).filter(([, s]) => s !== 'FAIL').map(([id]) => id),
    unexpectedRed: unexpected,
    knownAnswers: r.observations?.tally?.knownAnswers || null,
    confirmFirst: r.observations?.tally?.confirmFirst || null,
    fiveXX: (r.answers?.fiveXX || []).length,
    l34Fix: r.observations?.l34Fix ? { commit: r.observations.l34Fix.commit, contractPending } : null,
    ok,
  };
};

const out = [];
if (baseline && baseline.exitCode !== 0) out.push({ id: 'baseline', verdict: `the baseline ${baselineFile} exited ${baseline.exitCode}: every mutant is void until the unmutated proof exits 0 on the same code`, ok: false });
if (asFile) {
  const entry = entries.find((e) => e.id === asId);
  if (!entry) { console.error(`--id=${asId}: no such entry (${entries.map((e) => e.id).join(' ')})`); process.exit(1); }
  out.push(judge(entry, asFile));
} else {
  for (const entry of entries) {
    const file = path.join(dir, `${entry.id}.json`);
    if (!fs.existsSync(file)) { out.push({ id: entry.id, list: entry.list, e6: entry.e6.startsWith(E6_PREFIX) ? entry.e6 : null, verdict: `no result file ${file}`, ok: false, missing: true }); continue; }
    out.push(judge(entry, file));
  }
}
for (const o of out) console.log(JSON.stringify(o));
const e6 = out.filter((o) => o.e6);
if (!asFile) console.log(`E6 (section 6.2 WP-3 guards): ${e6.filter((o) => o.ok).length}/${E6_COUNT} with evidence (${e6.map((o) => `${o.id} ${o.ok ? 'yes' : 'no'}`).join(', ')})${baseline ? '' : '; no baseline given: flips not confirmed'}`);
process.exit(out.every((o) => o.ok) ? 0 : 2);
