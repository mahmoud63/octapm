'use strict';

/**
 * CERT-2, tenant isolation, from zero: every instrument proved, then every
 * sweep run over the whole certified population, one after another, with
 * nothing else touching the certification database.
 *
 *   node scripts/cert/run-cert2.js [--tag=cert2]
 *
 * Steps (each its own process, its output in logs/cert2/<step>.log):
 *   prove-tools      the fingerprint and the cross-link scan can see a change
 *   prove-judging    the rules that read an answer see what they must
 *   index-ids        the id index of the population as it is now
 *   links-start      every cross-company reference in the database (absolute)
 *   fp-before-reads  fingerprint
 *   read-sweep       every GET route, bound to each victim, as outsiders
 *   fp-after-reads   fingerprint, and the comparison: a read changes nothing
 *   file-attacks     every route serving a stored file, bound to each victim's
 *                    real files (its own fingerprint around the attacks)
 *   replay          every captured request replayed as outsiders (its own
 *                    fingerprint before and after)
 *   inject           another company's ids put into each company's own
 *                    requests (its own cross-link scan before and after)
 *   links-end        the census again, and the comparison with the start
 *
 * A sweep that finds something exits 2: that is a result, not a failure of
 * the run, and the next step still runs. results/isolation/<tag>-summary.json
 * holds every step's exit code and each sweep's verdict counts.
 *
 * Long: run it through run-with-watchdog.js, detached (start-detached.ps1).
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const arg = (name, fallback = null) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const TAG = arg('tag', 'cert2');
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const LOGS = path.join(WORK, 'logs', TAG);
const RESULTS = path.join(WORK, 'results', 'isolation');
const ISO = 'scripts/cert/isolation';

const STEPS = [
  { name: 'prove-tools', args: [`${ISO}/prove-tools.js`], mustPass: true },
  { name: 'prove-judging', args: [`${ISO}/prove-judging.js`], mustPass: true },
  { name: 'index-ids', args: [`${ISO}/index-ids.js`], mustPass: true },
  { name: 'links-start', args: [`${ISO}/cross-links.js`, 'take', `${TAG}-start`] },
  { name: 'fp-before-reads', args: [`${ISO}/fingerprint.js`, 'take', `${TAG}-before-reads`], mustPass: true },
  { name: 'read-sweep', args: [`${ISO}/read-sweep.js`, `--name=${TAG}-reads`], result: `${TAG}-reads` },
  { name: 'fp-after-reads', args: [`${ISO}/fingerprint.js`, 'take', `${TAG}-after-reads`], mustPass: true },
  { name: 'fp-compare-reads', args: [`${ISO}/fingerprint.js`, 'compare', `${TAG}-before-reads`, `${TAG}-after-reads`] },
  { name: 'file-attacks', args: [`${ISO}/file-attacks.js`, `--name=${TAG}-files`], result: `${TAG}-files` },
  { name: 'replay', args: [`${ISO}/replay.js`, `--name=${TAG}-replay`], result: `${TAG}-replay` },
  { name: 'inject', args: [`${ISO}/inject.js`, `--name=${TAG}-inject`], result: `${TAG}-inject` },
  { name: 'links-end', args: [`${ISO}/cross-links.js`, 'take', `${TAG}-end`] },
  { name: 'links-compare', args: [`${ISO}/cross-links.js`, 'compare', `${TAG}-start`, `${TAG}-end`] },
];

const main = () => {
  fs.mkdirSync(LOGS, { recursive: true });
  const summary = { tag: TAG, startedAt: new Date().toISOString(), steps: [] };
  const save = () => {
    fs.mkdirSync(RESULTS, { recursive: true });
    fs.writeFileSync(path.join(RESULTS, `${TAG}-summary.json`), JSON.stringify(summary, null, 1));
  };
  for (const step of STEPS) {
    const started = Date.now();
    console.log(`[${new Date().toISOString()}] ${step.name} …`);
    const run = spawnSync(process.execPath, step.args, { cwd: path.join(__dirname, '..', '..'), env: process.env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const output = `${run.stdout || ''}${run.stderr || ''}`;
    fs.writeFileSync(path.join(LOGS, `${step.name}.log`), output);
    const entry = { step: step.name, exit: run.status, minutes: Math.round((Date.now() - started) / 6000) / 10, tail: output.trim().split(/\r?\n/).slice(-6) };
    if (step.result) {
      try {
        entry.summary = JSON.parse(fs.readFileSync(path.join(RESULTS, `${step.result}.json`), 'utf8')).summary;
      } catch (error) {
        entry.summary = { unreadable: error.message };
      }
    }
    summary.steps.push(entry);
    save();
    console.log(`    exit ${run.status} in ${entry.minutes} min${entry.summary?.byVerdict ? `  ${JSON.stringify(entry.summary.byVerdict)}` : ''}`);
    if (step.mustPass && run.status !== 0) {
      summary.stoppedAt = step.name;
      save();
      console.log(`${step.name} must pass and did not; stopping (see ${path.join(LOGS, `${step.name}.log`)})`);
      process.exitCode = 1;
      return;
    }
  }
  summary.finishedAt = new Date().toISOString();
  save();
  const findings = summary.steps.filter((s) => s.exit !== 0).map((s) => `${s.step}=${s.exit}`);
  console.log(findings.length ? `steps reporting findings: ${findings.join(', ')}` : 'every step clean');
  process.exitCode = findings.length ? 2 : 0;
};

main();
