'use strict';

/**
 * Runs the known-answer construction lifecycle (the phase 21 stages) as the
 * people of one certification company, against the certification API.
 *
 *   node scripts/cert/run-certified-lifecycle.js 021                 # every stage, fresh project
 *   node scripts/cert/run-certified-lifecycle.js 021 --only=stage4   # one stage, on the project already in the state file
 *   node scripts/cert/run-certified-lifecycle.js 021 --from=stage8   # that stage and the ones after it
 *
 * The stages build one project from nothing — directory, team, programme,
 * bill, budget, procurement, stock, subcontract, change, progress, client
 * billing, labour, documents, quality, site, meetings — with figures chosen so
 * the answers are known on paper. Each stage is its own process; the ids it
 * creates go to the company's state file and the next stage reads them.
 *
 * The company must have the nine personas (a medium or large company). The
 * "outsider" the security stage needs is the PM of the next company.
 *
 * The stamp names every record the stages create (the companies "P21-<stamp>
 * ...", the project "OCTA PHASE21 GREENFIELD <stamp>", PO-<stamp>-A, ...). It
 * is C<code>, the certified run, unless P21_STAMP names a proving run in the
 * same company — C<code> plus a suffix that starts with a letter (CERT-3 WP-0;
 * in PowerShell, the variable removed afterwards so the next run is certified:
 *
 *   $env:P21_STAMP='C087R'; node scripts/cert/run-certified-lifecycle.js 087; Remove-Item Env:P21_STAMP
 *
 * builds a second, separate project in company 087). The state file and the
 * logs follow the stamp (state/p21-087R.json; logs/lifecycle/087R-<stage>.log,
 * 087R-summary.json, and this script's own output in 087R-run.log), so a
 * proving run never reads, continues or overwrites the certified run's. The
 * certified run's <code>-run.log is run-lifecycles.js's (it refuses any other
 * stamp), so this script writes a run log only for a proving run.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const fs = require('fs');
const { spawnSync } = require('child_process');
const { API, BASE } = require('./lib/api');
const { buildPopulation } = require('./lib/spec');

const STAGES = [
  'stage1-foundation.js',
  'stage2-schedule.js',
  'stage3-boq-budget.js',
  'stage4-procurement-inventory.js',
  'stage5-subcontract.js',
  'stage7-security.js',
  'stage8-change-directcost.js',
  'stage9-progress-ev.js',
  'stage10-client.js',
  'stage11-rfq.js',
  'stage12-three-way-match.js',
  'stage13-labour.js',
  'stage14-rfi.js',
  'stage15-document-control.js',
  'stage16-quality.js',
  'stage17-field-safety.js',
  'stage18-meetings-tasks.js',
  // The reconciliation of everything above, read back through the API only.
  'snapshot.js',
];

const code = process.argv[2];
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
const from = process.argv.find((a) => a.startsWith('--from='))?.split('=')[1];

const main = () => {
  if (!process.env.CERT_PASSWORD) throw new Error('CERT_PASSWORD is not set.');
  const { companies } = buildPopulation();
  const company = companies.find((c) => c.code === code);
  if (!company) throw new Error(`no certification company ${code}`);
  if (company.size === 'small') throw new Error(`company ${code} is small: it does not have the nine personas this lifecycle signs in as`);
  const outsider = companies[company.n % companies.length]; // the next company
  // The certified run is C<code>; a proving run is C<code><suffix> (CERT-3 WP-0).
  // A stamp of another company, or a suffix that does not start with a letter,
  // is refused: the state file is named after the stamp, so it could otherwise
  // land on another run's file.
  const stamp = process.env.P21_STAMP || `C${code}`;
  if (!new RegExp(`^C${code}([A-Z][A-Z0-9]*)?$`).test(stamp)) {
    throw new Error(`P21_STAMP=${stamp} is not a stamp of company ${code}: it is C${code} (the certified run) or C${code} and a suffix starting with a letter (a proving run, e.g. C${code}R)`);
  }
  const runName = stamp.slice(1); // 087 for the certified run, 087R for its proving run
  const work = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
  const stateDir = path.join(work, 'state');
  const logDir = path.join(work, 'logs', 'lifecycle');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  const context = path.join(stateDir, `p21-${runName}.json`);

  const env = {
    ...process.env,
    P21_API_BASE: BASE,
    P21_PASSWORD: process.env.CERT_PASSWORD,
    P21_EMAIL_DOMAIN: company.domain,
    P21_PARTY_DOMAIN: `parties.c${code}.octapm-cert.test`,
    P21_OUTSIDER_EMAIL: `pm@${outsider.domain}`,
    P21_CONTEXT: context,
    P21_STAMP: stamp,
  };

  let stages = STAGES;
  if (only) stages = STAGES.filter((s) => s.includes(only));
  if (from) stages = STAGES.slice(STAGES.findIndex((s) => s.includes(from)));
  if (!stages.length || (from && !STAGES.some((s) => s.includes(from)))) throw new Error('no stage matches');
  if (!only && !from && fs.existsSync(context)) {
    throw new Error(`${context} exists: company ${code} already has a project under stamp ${stamp}. Use --only or --from to continue it; a second full run would double its figures.`);
  }

  // A proving run's own output, under its stamp (087R-run.log): the certified
  // <code>-run.log is run-lifecycles.js's, written from this script's stdout.
  // Opened after every refusal above, so a refused attempt never empties it.
  const runLog = stamp === `C${code}` ? null : path.join(logDir, `${runName}-run.log`);
  if (runLog) fs.writeFileSync(runLog, '');
  const say = (text) => {
    console.log(text);
    if (runLog) fs.appendFileSync(runLog, `${text}\n`);
  };

  say(`company ${code} ${company.name}; stamp ${stamp}; API ${API}; state ${context}${runLog ? `; run log ${runLog}` : ''}`);
  const results = [];
  for (const stage of stages) {
    const started = Date.now();
    const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'phase21', stage)], { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const output = `${run.stdout || ''}${run.stderr || ''}`;
    // Named after the stamp: a proving run (087R-*) never overwrites the certified run's logs (087-*).
    fs.writeFileSync(path.join(logDir, `${runName}-${stage.replace('.js', '')}.log`), output);
    const passed = (output.match(/\[PASS\]/g) || []).length;
    const failed = (output.match(/\[FAIL\]/g) || []).length;
    const ok = run.status === 0;
    results.push({ stage, ok, exit: run.status, passed, failed, seconds: Math.round((Date.now() - started) / 1000) });
    say(`${ok ? 'ok  ' : 'FAIL'} ${stage}  checks ${passed} passed, ${failed} failed  ${results[results.length - 1].seconds}s`);
    if (!ok) {
      const tail = output.trim().split(/\r?\n/).slice(-12).join('\n');
      say(tail);
      break;
    }
  }
  // Named after the stamp, as the stage logs are: 087R-summary.json for a proving run.
  fs.writeFileSync(path.join(logDir, `${runName}-summary.json`), JSON.stringify({ company: code, stamp, results }, null, 1));
  process.exitCode = results.every((r) => r.ok) && results.length === stages.length ? 0 : 1;
};

main();
