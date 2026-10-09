'use strict';

/**
 * Runs the known-answer lifecycle for every certified company, a few at a
 * time, and reports each company's result.
 *
 *   node scripts/cert/run-lifecycles.js                      # every company whose first project is `certified`
 *   node scripts/cert/run-lifecycles.js --codes=021,027 --parallel=2
 *
 * Each company runs as its own run-certified-lifecycle.js process (its stage
 * logs and <code>-summary.json go to logs/lifecycle/); this script's own log
 * of each run is logs/lifecycle/<code>-run.log. A company that already has a
 * certified project (state/p21-<code>.json) is refused by that script rather
 * than run twice. Exit code 0 only if every company passed every stage.
 *
 * Certified runs only (CERT-3 WP-0): when P21_STAMP is set it must be C<code>
 * for every company asked for, or nothing runs (exit 1). A proving run
 * (P21_STAMP=C087R) is run-certified-lifecycle.js's alone: its logs are
 * 087R-*, and this script's <code>-run.log and <code>-summary.json are the
 * certified run's, never truncated or read for another stamp.
 *
 * Long: run it through run-with-watchdog.js, detached (start-detached.ps1).
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const fs = require('fs');
const { spawn } = require('child_process');
const { buildPopulation } = require('./lib/spec');

const arg = (name, fallback = null) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const LOGS = path.join(WORK, 'logs', 'lifecycle');
const PARALLEL = Number(arg('parallel', 3));

const certified = buildPopulation().companies.filter((c) => c.projects?.[0]?.depth === 'certified').map((c) => c.code);
const codes = arg('codes')?.split(',') || certified;
const unknown = codes.filter((code) => !certified.includes(code));
if (unknown.length) {
  console.error(`not certified companies: ${unknown.join(', ')} (certified: ${certified.join(',')})`);
  process.exit(64);
}

// The stamp each child runs under, as run-certified-lifecycle.js reads it
// (an empty P21_STAMP is the certified C<code> there too). Anything but C<code>
// is a proving run: refused here, before any log is opened, so the certified
// run's <code>-run.log and <code>-summary.json are never truncated or read.
const stampOf = (code) => process.env.P21_STAMP || `C${code}`;
const notCertified = codes.filter((code) => stampOf(code) !== `C${code}`);
if (notCertified.length) {
  console.error(
    `P21_STAMP=${process.env.P21_STAMP} is not the certified stamp C<code> of ${notCertified.join(', ')}: this script runs certified lifecycles only and writes <code>-run.log / <code>-summary.json. ` +
      `For a proving run use run-certified-lifecycle.js, one company at a time: $env:P21_STAMP='C087R'; node scripts/cert/run-certified-lifecycle.js 087; Remove-Item Env:P21_STAMP`,
  );
  process.exit(1);
}
// The run's own name, after the stamp (087 for C087): with the refusal above it is always the code.
const runName = (code) => stampOf(code).slice(1);

const runOne = (code) =>
  new Promise((resolve) => {
    fs.mkdirSync(LOGS, { recursive: true });
    const log = fs.openSync(path.join(LOGS, `${runName(code)}-run.log`), 'w');
    const started = Date.now();
    const child = spawn(process.execPath, [path.join(__dirname, 'run-certified-lifecycle.js'), code], { cwd: path.join(__dirname, '..', '..'), env: process.env, stdio: ['ignore', log, log] });
    child.on('exit', (exit) => {
      fs.closeSync(log);
      const minutes = Math.round((Date.now() - started) / 6000) / 10;
      console.log(`${exit === 0 ? 'ok  ' : 'FAIL'} ${code}  exit ${exit}  ${minutes} min`);
      resolve({ code, exit, minutes });
    });
  });

const main = async () => {
  console.log(`lifecycles for ${codes.length} companies, ${PARALLEL} at a time: ${codes.join(',')}`);
  const queue = [...codes];
  const done = [];
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
      while (queue.length) done.push(await runOne(queue.shift()));
    }),
  );

  console.log('\ncompany  stages ok/run  checks passed  failed  first failing stage');
  let allOk = true;
  for (const code of codes) {
    const run = done.find((d) => d.code === code);
    let summary = null;
    try {
      summary = JSON.parse(fs.readFileSync(path.join(LOGS, `${runName(code)}-summary.json`), 'utf8'));
    } catch {
      /* the run died before writing it */
    }
    const results = summary?.results || [];
    const ok = results.filter((r) => r.ok).length;
    const passed = results.reduce((n, r) => n + (r.passed || 0), 0);
    const failed = results.reduce((n, r) => n + (r.failed || 0), 0);
    const firstFail = results.find((r) => !r.ok)?.stage || (run?.exit === 0 ? '' : '(see run log)');
    allOk = allOk && run?.exit === 0;
    console.log(`${code}      ${String(ok).padStart(2)}/${String(results.length).padEnd(2)}       ${String(passed).padStart(6)}  ${String(failed).padStart(6)}  ${firstFail}`);
  }
  process.exitCode = allOk ? 0 : 1;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
