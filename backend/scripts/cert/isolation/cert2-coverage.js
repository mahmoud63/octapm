'use strict';

/**
 * Coverage behind the refusals that were not the reference check itself.
 *
 * An attack refused by the caller's own billing (402) or its own record's
 * state (409) never reached the check under test. For each route (replay) and
 * each route and field (injection), this lists whether at least one attack was
 * judged by the check itself (REFUSED / FILTERED / NO_VICTIM_DATA). A route or
 * field reached only through such refusals is a coverage gap, listed by name.
 * It also lists every 400 by route, with its code, for triage.
 *
 *   node scripts/cert/isolation/cert2-coverage.js --tag=cert2b
 */

const fs = require('fs');
const path = require('path');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const arg = (name, fallback = null) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const TAG = arg('tag', 'cert2');
const DIR = path.join(WORK, 'results', 'isolation');
const load = (kind) => JSON.parse(fs.readFileSync(path.join(DIR, `${TAG}-${kind}.json`), 'utf8')).results;

const JUDGED = new Set(['REFUSED', 'FILTERED', 'NO_VICTIM_DATA']);
const UNJUDGED = new Set(['REFUSED_OWN_BILLING', 'REFUSED_OWN_STATE']);

const coverage = (rows, key) => {
  const by = new Map();
  for (const r of rows) {
    const k = key(r);
    const e = by.get(k) || by.set(k, { judged: 0, unjudged: 0, validation: 0, other: {} }).get(k);
    if (JUDGED.has(r.verdict)) e.judged += 1;
    else if (UNJUDGED.has(r.verdict)) e.unjudged += 1;
    else if (r.verdict === 'REFUSED_VALIDATION') e.validation += 1;
    else e.other[r.verdict] = (e.other[r.verdict] || 0) + 1;
  }
  return by;
};

const main = () => {
  const replay = load('replay');
  const inject = load('inject');
  const out = {};
  for (const [name, rows, key] of [
    ['replay', replay, (r) => `${r.method} ${r.template}`],
    ['inject', inject, (r) => `${r.method} ${r.template} [${r.field}]`],
  ]) {
    const by = coverage(rows, key);
    const onlyUnjudged = [...by.entries()].filter(([, e]) => !e.judged && e.unjudged).map(([k, e]) => ({ route: k, unjudged: e.unjudged, validation: e.validation }));
    const onlyValidation = [...by.entries()].filter(([, e]) => !e.judged && !e.unjudged && e.validation).map(([k, e]) => ({ route: k, validation: e.validation }));
    const other = [...by.entries()].filter(([, e]) => Object.keys(e.other).length).map(([k, e]) => ({ route: k, ...e.other }));
    out[name] = {
      routes: by.size,
      judgedByTheCheck: [...by.values()].filter((e) => e.judged).length,
      reachedOnlyThroughOwnBillingOrState: onlyUnjudged,
      reachedOnlyThroughValidation: onlyValidation,
      otherVerdicts: other,
    };
    console.log(`${name}: ${by.size} routes${name === 'inject' ? ' and fields' : ''}; judged by the check itself: ${out[name].judgedByTheCheck}; only own billing/state: ${onlyUnjudged.length}; only 400: ${onlyValidation.length}; other verdicts: ${other.length}`);
    for (const g of onlyUnjudged) console.log(`   own billing/state only: ${g.route} (${g.unjudged})`);
    for (const g of onlyValidation) console.log(`   400 only: ${g.route} (${g.validation})`);
    for (const g of other) console.log(`   other: ${JSON.stringify(g)}`);
  }
  const validation = [...replay, ...inject].filter((r) => r.verdict === 'REFUSED_VALIDATION');
  const byCode = validation.reduce((acc, r) => {
    const k = `${r.method} ${r.template} -> ${r.status} ${r.code || ''} (${r.attacker})`;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  out.validation = byCode;
  console.log(`\n400 answers (${validation.length}) by route and code:`);
  for (const [k, n] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) console.log(`  ${n}×  ${k}`);
  fs.writeFileSync(path.join(DIR, `${TAG}-coverage.json`), JSON.stringify(out, null, 1));
};

main();
