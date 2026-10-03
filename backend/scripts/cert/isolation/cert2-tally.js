'use strict';

/**
 * The figures of the CERT-2 report, from one run's result files
 * (results/isolation/<tag>-{reads,replay,files,inject,summary}.json):
 * routes tested, attacks by kind, every verdict that is not a plain refusal
 * by route, server errors, and the state checks.
 *
 *   node scripts/cert/isolation/cert2-tally.js --tag=cert2b
 *
 * It judges nothing itself: the sweeps' verdicts stand, and every row that is
 * not REFUSED is listed by route so it can be triaged.
 */

const fs = require('fs');
const path = require('path');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const arg = (name, fallback = null) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const TAG = arg('tag', 'cert2');
const DIR = path.join(WORK, 'results', 'isolation');
const load = (kind) => {
  const file = path.join(DIR, `${TAG}-${kind}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};
const tally = (rows, key) => rows.reduce((acc, row) => ({ ...acc, [key(row)]: (acc[key(row)] || 0) + 1 }), {});
const top = (counts, n = 40) => Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n);

const main = () => {
  const reads = load('reads');
  const replay = load('replay');
  const files = load('files');
  const inject = load('inject');
  const summary = load('summary');
  const R = reads?.results || [];
  const P = replay?.results || [];
  const F = files?.results || [];
  const I = inject?.results || [];

  const routes = new Set([
    ...R.map((r) => `GET ${r.template}`),
    ...P.map((r) => `${r.method} ${r.template}`),
    ...F.map((r) => `GET ${r.template}`),
    ...I.map((r) => `${r.method} ${r.template}`),
  ]);
  const replayReads = P.filter((r) => r.method === 'GET');
  const replayWrites = P.filter((r) => r.method !== 'GET');
  const directId = R.filter((r) => r.attacker !== 'outsider-query').length + P.filter((r) => r.victimIdInPath).length + F.length;
  const all = [...R.map((r) => ({ ...r, sweep: 'reads', method: 'GET' })), ...P.map((r) => ({ ...r, sweep: 'replay' })), ...F.map((r) => ({ ...r, sweep: 'files', method: 'GET' })), ...I.map((r) => ({ ...r, sweep: 'inject' }))];
  const errors = all.filter((r) => r.status >= 500 || r.verdict === 'SERVER_ERROR');
  const leaks = all.filter((r) => r.verdict === 'LEAK');
  const answered = all.filter((r) => r.verdict === 'ANSWERED');
  const writes = all.filter((r) => r.verdict === 'WRITE_ACCEPTED' || (r.sweep === 'inject' && r.verdict === 'ACCEPTED'));
  const steps = Object.fromEntries((summary?.steps || []).map((s) => [s.step, s]));

  const out = {
    tag: TAG,
    routesTested: routes.size,
    routesBySweep: {
      reads: new Set(R.map((r) => r.template)).size,
      replay: new Set(P.map((r) => `${r.method} ${r.template}`)).size,
      files: new Set(F.map((r) => r.template)).size,
      inject: new Set(I.map((r) => `${r.method} ${r.template}`)).size,
      injectRouteFieldPairs: inject?.summary?.routeFieldPairs ?? null,
    },
    attacks: {
      directId,
      read: R.length + replayReads.length,
      write: replayWrites.length,
      foreignReference: I.length,
      file: F.length,
      total: all.length,
    },
    verdicts: {
      reads: reads?.summary?.byVerdict,
      replay: replay?.summary?.byVerdict,
      files: files?.summary?.byVerdict,
      inject: inject?.summary?.byVerdict,
    },
    state: {
      readsFingerprint: steps['fp-compare-reads'] ? { exit: steps['fp-compare-reads'].exit, tail: steps['fp-compare-reads'].tail } : null,
      replayDataChanged: replay?.summary?.dataChanged ?? null,
      replayDataChangedTables: replay?.summary?.dataChangedTables ?? null,
      filesDataChanged: files?.summary?.dataChanged ?? null,
      crossCompanyReferencesStart: inject?.summary?.crossCompanyReferencesBefore ?? null,
      crossCompanyReferencesAfterInject: inject?.summary?.crossCompanyReferencesAfter ?? null,
      newCrossCompanyReferences: inject?.summary?.newCrossCompanyReferences ?? null,
      linksCompare: steps['links-compare'] ? { exit: steps['links-compare'].exit, tail: steps['links-compare'].tail } : null,
      stepExits: Object.fromEntries((summary?.steps || []).map((s) => [s.step, s.exit])),
    },
    serverErrors: errors.length,
    leaks: leaks.length,
    answered: answered.length,
    writesAccepted: writes.length,
    triage: {
      serverErrors: top(tally(errors, (r) => `${r.sweep} ${r.method} ${r.template} -> ${r.status} ${r.code || ''}`)),
      leaks: top(tally(leaks, (r) => `${r.sweep} ${r.method} ${r.template}${r.field ? ` [${r.field}]` : ''} -> ${r.status}`)),
      answered: top(tally(answered, (r) => `${r.sweep} ${r.method} ${r.template} (${r.attacker}) -> ${r.status}`)),
      writesAccepted: top(tally(writes, (r) => `${r.sweep} ${r.method} ${r.template}${r.field ? ` [${r.field}=${r.type}]` : ''} -> ${r.status}`)),
      refusedLate: top(tally(all.filter((r) => r.verdict === 'REFUSED_LATE'), (r) => `${r.sweep} ${r.method} ${r.template}${r.field ? ` [${r.field}]` : ''} -> ${r.status} ${r.code || ''}`), 30),
      refusedValidation: top(tally(all.filter((r) => r.verdict === 'REFUSED_VALIDATION'), (r) => `${r.sweep} ${r.method} ${r.template} -> ${r.status} ${r.code || ''}`), 20),
      filtered: top(tally(all.filter((r) => r.verdict === 'FILTERED'), (r) => `${r.sweep} ${r.method} ${r.template}`), 20),
      ownState: top(tally(all.filter((r) => /OWN/.test(r.verdict || '')), (r) => `${r.verdict} ${r.method} ${r.template} -> ${r.status} ${r.code || ''}`), 20),
    },
  };
  const file = path.join(DIR, `${TAG}-tally.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
};

main();
