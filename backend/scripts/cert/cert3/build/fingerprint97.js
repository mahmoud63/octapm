'use strict';

/**
 * CERT-3 exit criterion E2: building the deep companies (087, 052 and 006)
 * changes no other company. Compares two isolation fingerprints taken with
 *
 *   node scripts/cert/isolation/fingerprint.js take <name>
 *
 * before and after the build, and passes only when every changed (company,
 * table) pair outside the deep companies is in a request-noise table.
 *
 *   node scripts/cert/cert3/build/fingerprint97.js <before> <after>
 *
 * Exit 0 unchanged, 2 another company changed, 1 setup error.
 */

const fs = require('fs');
const path = require('path');
const { compare } = require('../../isolation/fingerprint');

const DEEP = new Set(['087', '052', '006']);
// Where isolation/fingerprint.js writes them.
const DIR = path.join(process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert', 'state', 'fingerprints');

const [before, after] = process.argv.slice(2);
try {
  if (!before || !after) throw new Error('usage: fingerprint97.js <before> <after>');
  const read = (name) => JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8'));
  const changes = compare(read(before), read(after));
  const others = changes.filter((c) => !DEEP.has(c.org));
  const real = others.filter((c) => !c.noise);
  const deep = changes.filter((c) => DEEP.has(c.org) && !c.noise);
  console.log(`deep companies changed in ${deep.length} (company, table) pairs (expected: the build)`);
  console.log(`the other companies: ${real.length} changed pairs outside the request-noise tables${real.length ? `: ${real.slice(0, 20).map((c) => `${c.org}/${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', ')}` : ''}; ${others.length - real.length} in noise tables`);
  fs.writeFileSync(path.join(DIR, `${before}--${after}.e2.json`), JSON.stringify({ deep, others }, null, 1));
  process.exitCode = real.length ? 2 : 0;
} catch (error) {
  console.error(`SETUP ERROR: ${error.message}`);
  process.exitCode = 1;
}
