'use strict';

/**
 * WP-7 mutation evidence check (read only; no database, no API, no product file touched). Drafted read-only on
 * 2026-10-10 from wp4-mutation-evidence.js (the integration owner's WP-4 L1 ruling, PREP5-ADJUDICATION.md) for
 * WP7-RUN-PLAN.md section 7.3-7.4; to be committed beside the lists as backend/scripts/cert/cert3/wp7-mutation-evidence.js.
 *
 * WHY A BASELINE, NOT THE EXIT CODE. At HEAD the unmutated WP-7 proof exits 0 (no WP-7 rule decided, DECIDED_RED empty),
 * so the runner's CAUGHT (any non-zero exit) points the right way; but an exit 2 says only that SOMETHING failed, and an
 * exit 1 (a section error) is scored CAUGHT too. A mutant is judged here by its NAMED CATCHERS flipping from PASS in a
 * baseline to FAIL under the mutant, on the same tree, as WP-4's are:
 *
 *   baseline   the unmutated full run (no flags) on the same code, copied by Claude Main:
 *              results/cert3/wp7-eot-proof.baseline-head.json  for wp7-mutations.contract.json and .optional.json
 *              results/cert3/wp7-eot-proof.baseline.json       for wp7-fix-mutations.contract.json (--fix-baseline=)
 *              It must be a full run (meta.filter empty, activeChecks = expectedChecks), with no setup error and G.5xx
 *              green, and every FAIL in it must be a decided-rule red (meta.decidedRed: none at HEAD; a landed fix's
 *              checks must hold, so none on the final code either) or named with --accept-baseline-red=<id,...> (a red
 *              classified in the journal with its register row, WP-4 L5); otherwise the baseline is VOID and so is
 *              every mutant judged on it.
 *   mutant     results/cert3/wp7-mutations/<id>.json, the proof result copied after that mutant's run (<dir> to change).
 *              It must be a full run on the same code as its baseline: the same FIXES (meta.fixes), the same answer
 *              book (meta.answerBook), the same fixed count and check ids, and started after the baseline finished.
 *
 *   CAUGHT       every named catcher is PASS in the baseline (a known answer: status PASS, i.e. its value, not BLOCKED
 *                or STORED-PRE-FIX) and FAIL under the mutant (ran and failed; "not run" is never evidence), and nothing
 *                else moved unexplained: every other FAIL under the mutant is a named collateral id or a FAIL already in
 *                the baseline, and no baseline FAIL turned green. A racy catcher (the entry's racy[]; none in WP-7: the
 *                PROMO rounds are made deterministic by the blocker queue) that did not flip is reported, not failed,
 *                when every deterministic catcher flipped.
 *   CAUGHT, FLAGGED  the catchers flipped but another check went red that the list does not name, or a baseline red
 *                turned green: not evidence until Claude Main classifies it (names it as collateral with its derivation,
 *                or fixes the proof) and re-runs this check. ok false.
 *   SURVIVED     every catcher ran and is still PASS under the mutant. ok false (except an entry with no catchers whose
 *                expectVerdict starts SURVIVED: a limitation probe, ok when nothing moved).
 *   NO EVIDENCE  anything else: no result file, a void or mismatched baseline, a stale result, a fix entry whose fix is
 *                not set in the baseline (fixRule), a catcher not PASS in the baseline, a catcher not run or missing
 *                under the mutant, or only some catchers flipped.
 *   A mutant whose run ended in a setup error (exit 1) still counts when its catchers ran and failed (the WP-1 C1 / I1
 *   precedent); the setup error is reported. Status shifts that are not red (a known answer BLOCKED -> PASS, a
 *   confirm-first classification CONFIRMED -> PARTIAL) are listed: named in the entry's shifts[], racy, or unnamed
 *   (a note, not a flag).
 *
 * E6 (plan section 6.2 WP-7, two guards) counts the contract and fix lists only; the OPTIONAL rule mutants (WP7ADJ Q5)
 * are judged and reported apart, never tallied. A guard counts when every judged entry it names is CAUGHT (clean),
 * unless one of them supersedes the others (the WP-4 shape): guard 2, the approved-EOT lock, is M-STAT now and
 * M-STAT + M-EOTLOCK (its figures half, `joins`) once the HR-C10 fix lands (WP7ADJ Q4).
 *
 *   node wp7-mutation-evidence.js [<dir with <id>.json files>] [--baseline=<file>] [--fix-baseline=<file>]
 *        [--lists=contract|optional|fix|...] [--ids=<id,...>] [--accept-baseline-red=<id,...>]
 *        [--unit-results=<runner out.json,...>] [--lists-dir=<dir>]
 *   --ids judges only those entries (exact ids): e.g. M-70 re-run on the HR-C11 fix tree into its own directory and
 *   judged against that baseline, while the HEAD batch's other entries keep their verdicts from the HEAD run of this check.
 *   node wp7-mutation-evidence.js --as=<result.json> --id=<M-70|M-STAT|...> [--baseline=<file>]     one file, one entry
 *
 * --unit-results: the runner's own output files of the unit lists (mutate-multi.js <out.json> --lists=wp7-unit or
 * wp7fix-unit): a unit entry is CAUGHT BY NAMED TESTS when every title in its tests[] appears in a jest failure line
 * the runner kept (mocked: reported as a lead, plan section 1.4; it changes the exit code only when given).
 * Exit 0 when every judged entry is as its list expects (and the unit results, when given); 2 otherwise; 1 on bad usage.
 */

const fs = require('fs');
const path = require('path');

const argOf = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
const RESULTS = 'C:/Temp/octapm-cert/results/cert3';
const LISTS_DIR = argOf('lists-dir') || __dirname;
const LIST_FILES = { contract: 'wp7-mutations.contract.json', optional: 'wp7-mutations.optional.json', fix: 'wp7-fix-mutations.contract.json' };
const UNIT_FILES = { 'wp7-unit': 'wp7-mutations.unit.json', 'wp7fix-unit': 'wp7-fix-mutations.unit.json' };
const dir = process.argv.slice(2).find((a) => !a.startsWith('--')) || `${RESULTS}/wp7-mutations`;
const asFile = argOf('as');
const asId = argOf('id');
const which = (argOf('lists') || 'contract,optional,fix').split(',').map((s) => s.trim()).filter(Boolean);
const onlyIds = argOf('ids') ? new Set(argOf('ids').split(',').map((s) => s.trim()).filter(Boolean)) : null;
const HEAD_BASELINE = argOf('baseline') || `${RESULTS}/wp7-eot-proof.baseline-head.json`;
const BASELINE = { contract: HEAD_BASELINE, optional: HEAD_BASELINE, fix: argOf('fix-baseline') || `${RESULTS}/wp7-eot-proof.baseline.json` };
const ACCEPTED_RED = new Set((argOf('accept-baseline-red') || '').split(',').map((s) => s.trim()).filter(Boolean));
const unitResultFiles = (argOf('unit-results') || '').split(',').map((s) => s.trim()).filter(Boolean);
/** Known answers and classifications that move by luck between two runs: none in WP-7 (the PROMO-TX rounds queue behind a blocker). */
const RACY = new Set([]);
const E6_RE = /^section 6\.2 WP-7 guard (\d) of 2 \(([^;,)]+)/;
const GUARDS = ['1', '2'];

for (const w of which) if (!LIST_FILES[w]) { console.error(`--lists=${w}: contract, optional or fix`); process.exit(1); }

// ---- the lists -----------------------------------------------------------------------------------------------------
const entries = [];
for (const [key, file] of Object.entries(LIST_FILES)) {
  const spec = JSON.parse(fs.readFileSync(path.join(LISTS_DIR, file), 'utf8'));
  for (const m of spec.mutations || []) {
    entries.push({
      list: key, file, id: m.name.split(' ')[0], catchers: m.catchers || [], collateral: m.collateral || [], shifts: (m.shifts || []).map((s) => s.id),
      racy: m.racy || [], expectVerdict: m.expectVerdict || '', e6: key === 'optional' ? '' : m.e6 || '', supersedes: m.supersedes || null, joins: m.joins || null, fixRule: m.fixRule || null,
    });
  }
}

// ---- reading a result ------------------------------------------------------------------------------------------------
const load = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v === undefined ? null : v));
const view = (r) => {
  const byId = new Map((r.checks || []).map((c) => [c.id, c]));
  const ka = r.observations?.knownAnswers || {};
  const cfs = r.observations?.confirmFirst || {};
  const state = (id) => { const c = byId.get(id); if (!c) return 'MISSING'; if (c.notRun) return 'NOT RUN'; return c.ok ? 'PASS' : 'FAIL'; };
  /** the finer status: a known answer's PASS / BLOCKED / STORED-PRE-FIX / FAIL, a confirm-first classification, else the state */
  const status = (id) => {
    const s = state(id);
    if (s === 'MISSING' || s === 'NOT RUN') return s;
    if (ka[id]?.status) return `${ka[id].status}${ka[id].verdict === 'wrong' ? ' (wrong)' : ''}`;
    if (cfs[id]?.classification) return `${cfs[id].classification}${s === 'FAIL' ? ' (FAIL)' : ''}`;
    return s;
  };
  const failing = () => (r.checks || []).filter((c) => !c.ok && !c.notRun).map((c) => c.id);
  const notRun = () => (r.checks || []).filter((c) => c.notRun).map((c) => c.id);
  const ids = () => (r.checks || []).map((c) => c.id);
  return { r, state, status, failing, notRun, ids, isKa: (id) => Boolean(ka[id]) };
};
const fullRun = (r) => {
  const f = r.meta?.filter || {};
  return !f.only && !f.skip && !f.project && r.meta?.activeChecks === r.meta?.expectedChecks;
};

// ---- baselines -------------------------------------------------------------------------------------------------------
const baselines = {};
const baselineOf = (key, fileOverride = null) => {
  const file = fileOverride || BASELINE[key];
  if (baselines[file]) return baselines[file];
  const b = { file, ok: false, problems: [] };
  baselines[file] = b;
  if (!fs.existsSync(file)) { b.problems.push(`no baseline ${file}`); return b; }
  b.v = view(load(file));
  const { r } = b.v;
  if (!fullRun(r)) b.problems.push(`not a full run (filter ${JSON.stringify(r.meta?.filter)}, ${r.meta?.activeChecks} of ${r.meta?.expectedChecks} active)`);
  if (r.setupError || r.exitCode === 1) b.problems.push(`setup error (exit ${r.exitCode}): ${JSON.stringify(r.setupError || {}).slice(0, 300)}`);
  if (b.v.state('G.5xx') !== 'PASS') b.problems.push('G.5xx is not green');
  const decided = new Set(Object.keys(r.meta?.decidedRed || {}));
  b.decidedRed = [...decided];
  b.failing = b.v.failing();
  b.extraRed = b.failing.filter((id) => !decided.has(id) && !ACCEPTED_RED.has(id));
  b.acceptedRed = b.failing.filter((id) => ACCEPTED_RED.has(id));
  if (b.extraRed.length) b.problems.push(`reds outside the decided rules: ${b.extraRed.join(', ')} (classify them, then take a new baseline or name them with --accept-baseline-red)`);
  b.fixes = r.meta?.fixes || null;
  b.ok = b.problems.length === 0;
  return b;
};

// ---- judging one entry -------------------------------------------------------------------------------------------------
const judge = (entry, file, baselineFile = null) => {
  const out = { id: entry.id, list: entry.file, e6: E6_RE.test(entry.e6) ? entry.e6 : null, tallied: entry.list !== 'optional' };
  const b = baselineOf(entry.list, baselineFile);
  out.baseline = b.file;
  if (!fs.existsSync(file)) return { ...out, verdict: `NO EVIDENCE: no result file ${file}`, ok: false, missing: true };
  const m = view(load(file));
  const { r } = m;
  out.exitCode = r.exitCode;
  out.startedAt = r.startedAt;
  out.setupError = r.setupError ? { sectionErrors: (r.setupError.sectionErrors || []).map((s) => s.title), failedSetupChecks: r.setupError.failedSetupChecks || [], notRun: m.notRun().length } : null;
  out.fixes = r.meta?.fixes ? Object.fromEntries(Object.entries(r.meta.fixes).map(([k, v]) => [k, v?.commit || null])) : null;
  const pairing = [];
  if (!b.ok) pairing.push(`baseline VOID: ${b.problems.join('; ')}`);
  else {
    const br = b.v.r;
    if (!fullRun(r)) pairing.push(`the mutant run is not a full run (filter ${JSON.stringify(r.meta?.filter)})`);
    if (canonical(r.meta?.fixes) !== canonical(br.meta?.fixes)) pairing.push(`FIXES differ from the baseline's (mutant ${canonical(r.meta?.fixes)}, baseline ${canonical(br.meta?.fixes)}): not the same code`);
    if (r.meta?.answerBook !== br.meta?.answerBook) pairing.push('the answer book differs from the baseline\'s');
    if (r.meta?.expectedChecks !== br.meta?.expectedChecks || canonical([...m.ids()].sort()) !== canonical([...b.v.ids()].sort())) pairing.push('the check list differs from the baseline\'s (a proof change: take a new baseline)');
    if (!(Date.parse(r.startedAt) >= Date.parse(br.finishedAt))) pairing.push(`stale: the mutant run (${r.startedAt}) started before the baseline finished (${br.finishedAt}); re-run it on the baseline's code`);
    if (entry.fixRule && !br.meta?.fixes?.[entry.fixRule]?.commit) pairing.push(`the fix ${entry.fixRule} is not set in the baseline (FIXES['${entry.fixRule}']): a fix mutation is judged only on the code that carries its fix`);
  }
  if (pairing.length) return { ...out, verdict: `NO EVIDENCE: ${pairing.join('; ')}`, ok: false };

  const catcherRows = entry.catchers.map((id) => {
    const base = b.v.state(id);
    const baseStatus = b.v.status(id);
    const baseValue = base === 'PASS' && (!b.v.isKa(id) || baseStatus === 'PASS');
    const mut = m.state(id);
    return { id, baseline: baseStatus, mutant: m.status(id), baseValue, flipped: baseValue && mut === 'FAIL', racy: entry.racy.includes(id), mutState: mut };
  });
  out.catchers = Object.fromEntries(catcherRows.map((c) => [c.id, `${c.baseline} -> ${c.mutant}`]));
  const baselineFailing = new Set(b.failing);
  const known = new Set([...entry.catchers, ...entry.collateral]);
  const mutFailing = m.failing();
  out.collateral = Object.fromEntries(entry.collateral.map((id) => [id, m.status(id)]));
  out.collateralNotRed = entry.collateral.filter((id) => m.state(id) !== 'FAIL');
  out.unexpectedRed = mutFailing.filter((id) => !known.has(id) && !baselineFailing.has(id));
  out.baselineRedTurnedGreen = b.failing.filter((id) => m.state(id) === 'PASS');
  out.notRunUnderMutant = m.notRun();
  // non-red status shifts (both runs pass the check, the finer status differs)
  const shifts = [];
  for (const id of b.v.ids()) {
    if (known.has(id) || mutFailing.includes(id) || baselineFailing.has(id)) continue;
    const s0 = b.v.status(id);
    const s1 = m.status(id);
    if (s0 !== s1 && m.state(id) === 'PASS') shifts.push({ id, from: s0, to: s1, kind: entry.shifts.includes(id) ? 'named' : RACY.has(id) ? 'racy' : 'unnamed' });
  }
  out.shifts = shifts;
  out.namedShiftsNotSeen = entry.shifts.filter((id) => !shifts.some((s) => s.id === id));
  out.knownAnswers = r.observations?.tally?.knownAnswers || null;
  out.confirmFirst = r.observations?.tally?.confirmFirst || null;
  out.residue = r.observations?.runObservations?.residue ? { unnamedWeatherRows: r.observations.runObservations.residue.unnamedWeatherRows } : null;
  out.fiveXX = (r.answers?.fiveXX || []).length;

  let verdict;
  let ok;
  if (!entry.catchers.length) {
    ok = /^SURVIVED/.test(entry.expectVerdict) && !out.unexpectedRed.length && !out.baselineRedTurnedGreen.length;
    verdict = ok ? 'SURVIVED as expected (limitation probe: not evidence, a TEST GAP to record)' : `UNEXPECTED: a probe expected to survive moved (${[...out.unexpectedRed, ...out.baselineRedTurnedGreen].join(', ') || 'see the result'})`;
    return { ...out, verdict, ok };
  }
  const notBaselineValue = catcherRows.filter((c) => !c.baseValue);
  const notRun = catcherRows.filter((c) => c.mutState === 'NOT RUN' || c.mutState === 'MISSING');
  const deterministic = catcherRows.filter((c) => !c.racy);
  const racyNotFlipped = catcherRows.filter((c) => c.racy && !c.flipped && c.mutState === 'PASS');
  const allFlipped = catcherRows.every((c) => c.flipped);
  const deterministicFlipped = deterministic.length > 0 && deterministic.every((c) => c.flipped);
  if (notBaselineValue.length) {
    ok = false;
    verdict = `NO EVIDENCE: catcher(s) not PASS in the baseline: ${notBaselineValue.map((c) => `${c.id} ${c.baseline}`).join(', ')} (a mutant can only be scored on a catcher green at baseline: the fix it needs has not landed, or the baseline is wrong)`;
  } else if (notRun.length) {
    ok = false;
    verdict = `NO EVIDENCE: catcher(s) not run or missing under the mutant: ${notRun.map((c) => `${c.id} ${c.mutState}`).join(', ')}${out.setupError ? ' (setup error: read the section errors)' : ''}`;
  } else if (allFlipped || (deterministicFlipped && catcherRows.filter((c) => c.racy && !c.flipped).every((c) => racyNotFlipped.includes(c)))) {
    const flags = [];
    if (out.unexpectedRed.length) flags.push(`unexpected red ${out.unexpectedRed.join(', ')}`);
    if (out.baselineRedTurnedGreen.length) flags.push(`baseline red turned green ${out.baselineRedTurnedGreen.join(', ')}`);
    ok = flags.length === 0;
    const notes = [];
    if (racyNotFlipped.length) notes.push(`racy catcher(s) not flipped: ${racyNotFlipped.map((c) => c.id).join(', ')} (reported; one marked rerun allowed)`);
    if (out.setupError) notes.push(`setup error after the catch (${out.setupError.sectionErrors.join('; ') || 'see the result'}): counts, the catchers ran and failed (WP-1 C1 / I1 precedent)`);
    if (out.collateralNotRed.length) notes.push(`named collateral not red: ${out.collateralNotRed.join(', ')} (allowed)`);
    if (shifts.some((s) => s.kind === 'unnamed')) notes.push(`unnamed shift(s) ${shifts.filter((s) => s.kind === 'unnamed').map((s) => `${s.id} ${s.from} -> ${s.to}`).join(', ')}`);
    verdict = `${ok ? 'CAUGHT' : 'CAUGHT, FLAGGED'}: every named catcher PASS in the baseline and FAIL under the mutant${flags.length ? `; ${flags.join('; ')}` : ''}${notes.length ? `; ${notes.join('; ')}` : ''}`;
  } else if (catcherRows.every((c) => c.mutState === 'PASS')) {
    ok = false;
    verdict = 'SURVIVED: every named catcher ran and is still PASS under the mutant';
  } else {
    ok = false;
    verdict = `NO EVIDENCE: only some catchers flipped (${catcherRows.map((c) => `${c.id} ${c.baseline} -> ${c.mutant}`).join(', ')})`;
  }
  return { ...out, verdict, ok };
};

// ---- unit results (mocked; a lead) -------------------------------------------------------------------------------------
const judgeUnits = () => {
  const records = [];
  for (const f of unitResultFiles) {
    if (!fs.existsSync(f)) { records.push({ file: f, missing: true }); continue; }
    for (const rec of load(f)) records.push({ ...rec, file: f });
  }
  const out = [];
  for (const [key, file] of Object.entries(UNIT_FILES)) {
    const spec = JSON.parse(fs.readFileSync(path.join(LISTS_DIR, file), 'utf8'));
    for (const m of spec.mutations || []) {
      const id = m.name.split(' ')[0];
      const rec = records.find((x) => x.list === key && String(x.name || '').split(' ')[0] === id);
      if (!rec) continue;
      const tests = m.tests || [];
      const fails = rec.fails || [];
      const found = tests.map((t) => ({ title: t, failed: fails.some((l) => l.includes(t.slice(0, 60))) }));
      let verdict;
      let ok;
      if (rec.verdict === 'NOT APPLIED') { ok = false; verdict = `NOT APPLIED (${rec.detail || ''})`; }
      else if (rec.exit === 0) { ok = false; verdict = 'SURVIVED: the suite passed under the mutant'; }
      else if (found.every((x) => x.failed)) { ok = true; verdict = 'CAUGHT BY NAMED TESTS (mocked: a lead, not evidence)'; }
      else { ok = false; verdict = `NO EVIDENCE: the suite failed but not on the named test(s)${m.requires || spec.requires ? ' (titles from the fix plan: reconcile with the fix diff)' : ''}`; }
      out.push({ id, list: file, exit: rec.exit, verdict, tests: found, otherFails: fails.filter((l) => !tests.some((t) => l.includes(t.slice(0, 60)))).length, ok });
    }
  }
  return { records: records.length, entries: out };
};

// ---- run --------------------------------------------------------------------------------------------------------------
const results = [];
if (asFile) {
  const entry = entries.find((e) => e.id === asId);
  if (!entry) { console.error(`--id=${asId}: no such entry (${entries.map((e) => e.id).join(' ')})`); process.exit(1); }
  results.push(judge(entry, asFile, argOf('baseline') || null));
} else {
  if (onlyIds) for (const id of onlyIds) if (!entries.some((e) => e.id === id && which.includes(e.list))) { console.error(`--ids: no entry ${id} in --lists=${which.join(',')}`); process.exit(1); }
  for (const entry of entries.filter((e) => which.includes(e.list) && (!onlyIds || onlyIds.has(e.id)))) results.push(judge(entry, path.join(dir, `${entry.id}.json`)));
}
for (const [file, b] of Object.entries(baselines)) {
  console.log(JSON.stringify({ baseline: file, ok: b.ok, problems: b.problems, exitCode: b.v?.r?.exitCode ?? null, decidedRedFailing: (b.failing || []).filter((id) => (b.decidedRed || []).includes(id)), acceptedRed: b.acceptedRed || [], fixes: b.fixes ? Object.fromEntries(Object.entries(b.fixes).map(([k, v]) => [k, v?.commit || null])) : null }));
}
for (const o of results) console.log(JSON.stringify(o));
const units = unitResultFiles.length ? judgeUnits() : null;
if (units) for (const u of units.entries) console.log(JSON.stringify({ unit: true, ...u }));

if (!asFile) {
  // E6: per section 6.2 guard, the judged entries that name it (contract and fix lists; never the optional list). A
  // judged entry that supersedes the others stands alone; otherwise every judged entry of the guard must be CAUGHT.
  const guards = {};
  for (const e of entries.filter((x) => which.includes(x.list) && x.list !== 'optional' && (!onlyIds || onlyIds.has(x.id)))) {
    const g = E6_RE.exec(e.e6);
    if (!g) continue;
    (guards[g[1]] = guards[g[1]] || { name: g[2], entries: [] }).entries.push(e);
  }
  const rows = [];
  for (const n of GUARDS) {
    const g = guards[n];
    if (!g) { rows.push({ n, name: null, ids: null, ok: false, note: `not judged here (${onlyIds ? 'outside --ids' : 'its list was not judged, or its entry is still pending'})` }); continue; }
    const winner = g.entries.find((e) => e.supersedes);
    const counted = winner ? [winner] : g.entries;
    const res = counted.map((e) => ({ id: e.id, r: results.find((o) => o.id === e.id) }));
    const ok = res.every((x) => x.r?.ok);
    rows.push({ n, name: g.name, ids: counted.map((e) => e.id).join(' + '), ok, note: res.map((x) => `${x.id} ${x.r ? x.r.verdict.split(':')[0] : 'no result'}`).join(', ') });
  }
  console.log(`E6 (section 6.2 WP-7 guards${onlyIds ? `, judged here for --ids=${[...onlyIds].join(',')}` : ''}): ${rows.filter((x) => x.ok).length}/2 with evidence (${rows.map((x) => `${x.n} ${x.name || '-'} ${x.ids || '-'} ${x.ok ? 'yes' : `no: ${x.note}`}`).join('; ')})`);
  const tallyOf = (list) => list.reduce((acc, o) => { const k = o.verdict.split(':')[0]; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  const opt = results.filter((o) => !o.tallied);
  if (opt.length) console.log(`optional rule mutants (WP7ADJ Q5, run and recorded, never tallied): ${JSON.stringify(tallyOf(opt))} (${opt.map((o) => `${o.id} ${o.verdict.split(':')[0]}`).join(', ')})`);
  console.log(`entries: ${JSON.stringify(tallyOf(results))}${units ? `; unit: ${units.entries.filter((u) => u.ok).length}/${units.entries.length} caught by named tests (mocked, not evidence)` : ''}`);
}
const allOk = results.every((o) => o.ok) && (!units || units.entries.every((u) => u.ok));
process.exit(allOk ? 0 : 2);
