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
  const { companies } = buildPopulation();
  const company = companies.find((c) => c.code === code);
  if (!company) throw new Error(`no certification company ${code}`);
  if (company.size === 'small') throw new Error(`company ${code} is small: it does not have the nine personas this lifecycle signs in as`);
  const outsider = companies[company.n % companies.length]; // the next company
  const work = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
  const stateDir = path.join(work, 'state');
  const logDir = path.join(work, 'logs', 'lifecycle');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  const context = path.join(stateDir, `p21-${code}.json`);

  const env = {
    ...process.env,
    P21_API_BASE: BASE,
    P21_PASSWORD: process.env.CERT_PASSWORD,
    P21_EMAIL_DOMAIN: company.domain,
    P21_PARTY_DOMAIN: `parties.c${code}.octapm-cert.test`,
    P21_OUTSIDER_EMAIL: `pm@${outsider.domain}`,
    P21_CONTEXT: context,
    P21_STAMP: `C${code}`,
  };

  let stages = STAGES;
  if (only) stages = STAGES.filter((s) => s.includes(only));
  if (from) stages = STAGES.slice(STAGES.findIndex((s) => s.includes(from)));
  if (!stages.length || (from && !STAGES.some((s) => s.includes(from)))) throw new Error('no stage matches');
  if (!only && !from && fs.existsSync(context)) {
    throw new Error(`${context} exists: company ${code} already has a certified project. Use --only or --from to continue it; a second full run would double its figures.`);
  }

  console.log(`company ${code} ${company.name}; API ${API}; state ${context}`);
  const results = [];
  for (const stage of stages) {
    const started = Date.now();
    const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'phase21', stage)], { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const output = `${run.stdout || ''}${run.stderr || ''}`;
    fs.writeFileSync(path.join(logDir, `${code}-${stage.replace('.js', '')}.log`), output);
    const passed = (output.match(/\[PASS\]/g) || []).length;
    const failed = (output.match(/\[FAIL\]/g) || []).length;
    const ok = run.status === 0;
    results.push({ stage, ok, exit: run.status, passed, failed, seconds: Math.round((Date.now() - started) / 1000) });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${stage}  checks ${passed} passed, ${failed} failed  ${results[results.length - 1].seconds}s`);
    if (!ok) {
      const tail = output.trim().split(/\r?\n/).slice(-12).join('\n');
      console.log(tail);
      break;
    }
  }
  fs.writeFileSync(path.join(logDir, `${code}-summary.json`), JSON.stringify({ company: code, results }, null, 1));
  process.exitCode = results.every((r) => r.ok) && results.length === stages.length ? 0 : 1;
};

main();
