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

// The proofs of every isolation fix, in process. The lead scripts first: they
// stage the party-visibility set-up the isolation proofs reuse.
const PROOFS = [
  'leads/l2-workflow-upload-download.js', 'leads/l23-register-ignores-party-routing.js', 'leads/l24-unlinked-documents.js',
  'leads/l25-project-contract-value-to-guests.js', 'leads/l40-submittal-rfi-status-bypass.js', 'leads/l41-workflow-runs-expose-commercial-figures.js',
  'leads/l42-party-routing-not-enforced-on-detail.js', 'leads/l43-project-audit-not-filtered.js', 'leads/l44-commitment-subresources-skip-party-visibility.js',
  'leads/l45-custom-field-values-no-record-check.js', 'leads/l46-assistant-body-project-no-access-check.js', 'leads/x-files-1-rfi-submittal-detail-party-routing.js',
  'leads/x-files-2-revision-upload-party-and-status.js', 'leads/x-party-1-audit-history-cursor-ignored.js', 'leads/x-party-2-guest-rewrites-submittal-review-routes.js',
  'isolation/documents-proof.js', 'isolation/rfi-submittal-routing-proof.js', 'isolation/commercial-visibility-proof.js', 'isolation/audit-customfields-assistant-proof.js',
  'isolation/documents-links-proof.js', 'isolation/rfi-submittal-2-proof.js', 'isolation/commercial-2-proof.js', 'isolation/specs-photos-proof.js',
  'isolation/audit-assistant-2-proof.js', 'isolation/dashboard-modules-proof.js', 'isolation/burn-rate-proof.js', 'isolation/submittal-reviewer-files-proof.js',
  'isolation/reference-proof.js', 'isolation/inventory-reference-proof.js', 'isolation/shared-identity-proof.js',
  'isolation/procurement-bids-proof.js', 'isolation/progress-reports-proof.js', 'isolation/documents-refs-proof.js', 'isolation/people-templates-proof.js',
  'isolation/punch-rfi-tasks-proof.js', 'isolation/workflow-activity-proof.js', 'isolation/team-membership-proof.js',
  'isolation/schedule-structure-state-proof.js', 'isolation/procurement-rfq-state-proof.js', 'isolation/commercial-state-proof.js',
  'isolation/inventory-timesheets-state-proof.js', 'isolation/daily-logs-state-proof.js', 'isolation/quality-forms-safety-state-proof.js',
  'isolation/people-refs-2-state-proof.js', 'isolation/inventory-3-proof.js', 'isolation/people-evidence-3-proof.js',
  'isolation/oracles-shapes-3-proof.js', 'isolation/shape-ids-proof.js',
  'isolation/evidence-4-proof.js', 'isolation/queries-4-proof.js', 'isolation/bodies-4-proof.js',
  'isolation/evidence-lines-5-proof.js', 'isolation/robustness-5-proof.js', 'isolation/alerts-money-5-proof.js',
  'isolation/evidence-6-proof.js', 'isolation/robustness-6-proof.js', 'isolation/alerts-6-proof.js',
  'isolation/availability-7-proof.js', 'isolation/trivial-7-proof.js',
];

const STEPS = [
  { name: 'prove-tools', args: [`${ISO}/prove-tools.js`], mustPass: true },
  { name: 'prove-judging', args: [`${ISO}/prove-judging.js`], mustPass: true },
  { name: 'index-ids', args: [`${ISO}/index-ids.js`], mustPass: true },
  { name: 'links-start', args: [`${ISO}/cross-links.js`, 'take', `${TAG}-start`] },
  // The owners' own first reads create what a first read creates (lazily made
  // evaluations, checklists); measured apart, so the read sweep's fingerprint
  // holds the attacks alone.
  { name: 'fp-before-warmup', args: [`${ISO}/fingerprint.js`, 'take', `${TAG}-before-warmup`], mustPass: true },
  { name: 'owner-warmup', args: [`${ISO}/read-sweep.js`, `--name=${TAG}-owner-warmup`, '--owner-only'] },
  { name: 'fp-before-reads', args: [`${ISO}/fingerprint.js`, 'take', `${TAG}-before-reads`], mustPass: true },
  { name: 'fp-compare-warmup', args: [`${ISO}/fingerprint.js`, 'compare', `${TAG}-before-warmup`, `${TAG}-before-reads`] },
  { name: 'read-sweep', args: [`${ISO}/read-sweep.js`, `--name=${TAG}-reads`], result: `${TAG}-reads` },
  { name: 'fp-after-reads', args: [`${ISO}/fingerprint.js`, 'take', `${TAG}-after-reads`], mustPass: true },
  { name: 'fp-compare-reads', args: [`${ISO}/fingerprint.js`, 'compare', `${TAG}-before-reads`, `${TAG}-after-reads`] },
  { name: 'file-attacks', args: [`${ISO}/file-attacks.js`, `--name=${TAG}-files`], result: `${TAG}-files` },
  { name: 'replay', args: [`${ISO}/replay.js`, `--name=${TAG}-replay`], result: `${TAG}-replay` },
  { name: 'inject', args: [`${ISO}/inject.js`, `--name=${TAG}-inject`], result: `${TAG}-inject` },
  { name: 'links-end', args: [`${ISO}/cross-links.js`, 'take', `${TAG}-end`] },
  { name: 'links-compare', args: [`${ISO}/cross-links.js`, 'compare', `${TAG}-start`, `${TAG}-end`] },
  // Who made every row the read window changed: each must belong to its own company.
  { name: 'reads-attribution', args: () => [`${ISO}/attribute-changes.js`, `--diff=${TAG}-before-reads--${TAG}-after-reads`, `--from=${stepStarted['fp-before-reads']}`, `--to=${stepStarted['fp-after-reads']}`, `--name=${TAG}-reads-attribution`] },
  { name: 'warmup-attribution', args: () => [`${ISO}/attribute-changes.js`, `--diff=${TAG}-before-warmup--${TAG}-before-reads`, `--from=${stepStarted['fp-before-warmup']}`, `--to=${stepStarted['fp-before-reads']}`, `--name=${TAG}-warmup-attribution`] },
  // The injection again in two halves with the victims fingerprinted (every company is both attacker and victim in the full sweep).
  { name: 'victim-state', args: [`${ISO}/inject-victim-state.js`, `--tag=${TAG}`] },
  // Coverage behind refusals that were not the check itself (own billing 402, own record state 409).
  { name: 'coverage', args: [`${ISO}/cert2-coverage.js`, `--tag=${TAG}`] },
  // From here on the steps add records of their own to the companies they use.
  { name: 'realtime', args: [`${ISO}/realtime-proof.js`, '--pairs=5'] },
  { name: 'shape-sweep', inprocess: true, args: [`${ISO}/shape-sweep.js`, `--name=${TAG}-shapes`, `--inject=${TAG}-inject`] },
  { name: 'query-shape-sweep', inprocess: true, args: [`${ISO}/query-shape-sweep.js`, `--name=${TAG}-query-shapes`, `--reads=${TAG}-reads`] },
  { name: 'date-sweep', inprocess: true, args: [`${ISO}/date-sweep.js`, `--name=${TAG}-dates`, `--reads=${TAG}-reads`] },
  // Every proof of the CERT-2 fixes, in process on the final code (the injection pairs no sweep can reach in an accepting state, among them).
  ...PROOFS.map((proof) => ({ name: `proof-${path.basename(proof, '.js')}`, inprocess: true, args: [`scripts/cert/${proof}`] })),
  { name: 'tally', args: [`${ISO}/cert2-tally.js`, `--tag=${TAG}`] },
];

const stepStarted = {};

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
    stepStarted[step.name] = new Date(started).toISOString();
    const args = typeof step.args === 'function' ? step.args() : step.args;
    // In-process steps load the product from the working tree on the certification database.
    const env = { ...process.env };
    if (step.inprocess) env.CERT_INPROCESS = '1';
    delete env.DATABASE_URL;
    // Output goes straight to the step's log: in process, the e-mail a script
    // sends (an invitation link it must follow) is written there, and the
    // script reads it back while it runs (CERT_API_LOG).
    const logFile = path.join(LOGS, `${step.name}.log`);
    if (step.inprocess) env.CERT_API_LOG = logFile;
    const fd = fs.openSync(logFile, 'w');
    const run = spawnSync(process.execPath, args, { cwd: path.join(__dirname, '..', '..'), env, stdio: ['ignore', fd, fd] });
    fs.closeSync(fd);
    const output = fs.readFileSync(logFile, 'utf8');
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
