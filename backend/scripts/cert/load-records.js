'use strict';

/**
 * Layer 2b of the certification population: the records inside each project,
 * created through the API by the company's own people.
 *
 *   node scripts/cert/load-records.js                                  # every company, every driver
 *   node scripts/cert/load-records.js --only=001,045                   # named companies
 *   node scripts/cert/load-records.js --drivers=foundation,quality     # named drivers, in the order given
 *   node scripts/cert/load-records.js --projects=045-02                # named projects
 *   node scripts/cert/load-records.js --redo=quality                   # run a driver again where it already ran
 *
 * A driver (drivers/<name>.js) makes one area's records. What each driver
 * made is kept per company in state/inventory/<code>.json: the ids by record
 * type, and the names later drivers need. A driver that already ran for a
 * project is not run again, so the loader can be stopped and resumed.
 *
 * A driver that is refused does not stop the load: the refusal is written to
 * the inventory and the report, and drivers that need it are skipped for
 * that project.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const fs = require('fs');
const { pool } = require('./lib/api');
const { buildPopulation } = require('./lib/spec');
const { buildContext } = require('./drivers/_context');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
// Every request the drivers make goes to the corpus the cross-company attacks replay.
process.env.CERT_CAPTURE_DIR = process.env.CERT_CAPTURE_DIR || path.join(WORK, 'corpus');
const PROJECTS = path.join(WORK, 'state', 'projects.json');
const INVENTORY = path.join(WORK, 'state', 'inventory');

/** The order drivers run in. A driver file that is missing is simply not run. */
const ORDER = [
  'foundation', 'structure', 'procurement', 'inventory', 'subcontract', 'change-cost', 'progress', 'client-billing',
  'quality-field', 'documents', 'collaboration-admin',
];

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]?.split(',') || null;
const ONLY = arg('only');
const SKIP = arg('skip') || [];
const DRIVERS = arg('drivers');
const ONLY_PROJECTS = arg('projects');
const REDO = arg('redo') || [];
const CONCURRENCY = Number(arg('concurrency')?.[0] || 6);

const loadDrivers = () => {
  const names = DRIVERS || ORDER;
  const out = [];
  for (const name of names) {
    const file = path.join(__dirname, 'drivers', `${name}.js`);
    if (!fs.existsSync(file)) {
      if (DRIVERS) throw new Error(`no driver ${name}`);
      continue;
    }
    // eslint-disable-next-line global-require, import/no-dynamic-require
    out.push(require(file));
  }
  return out;
};

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);

const loadCompany = async (company, projects, drivers) => {
  const file = path.join(INVENTORY, `${company.code}.json`);
  const state = readJson(file, { code: company.code, company: {}, projects: {} });
  const save = () => fs.writeFileSync(file, JSON.stringify(state, null, 1));
  const report = { code: company.code, ran: 0, skipped: 0, failed: [], notes: 0 };

  for (const spec of company.projects) {
    const made = projects[company.code]?.[spec.key];
    if (!made?.id) continue; // not created by load-projects (the certified project, or a refusal)
    if (ONLY_PROJECTS && !ONLY_PROJECTS.includes(spec.key)) continue;
    const projectState = (state.projects[spec.key] = state.projects[spec.key] || { id: made.id, depth: spec.depth, drivers: {} });
    projectState.id = made.id;

    for (const driver of drivers) {
      if (!(driver.depths || ['standard']).includes(spec.depth)) continue;
      const done = projectState.drivers[driver.name];
      if (done?.ok && !REDO.includes(driver.name)) {
        report.skipped += 1;
        continue;
      }
      const missing = (driver.needs || []).filter((need) => !projectState.drivers[need]?.ok);
      if (missing.length) {
        projectState.drivers[driver.name] = { ok: false, error: `needs ${missing.join(', ')}` };
        continue;
      }
      const ctx = buildContext({ company, projectKey: spec.key, projectState, companyState: state.company, driverName: driver.name });
      const started = Date.now();
      try {
        await driver.run(ctx);
        projectState.drivers[driver.name] = { ok: true, ms: Date.now() - started, notes: ctx.notes };
        report.ran += 1;
        report.notes += ctx.notes.length;
      } catch (error) {
        projectState.drivers[driver.name] = { ok: false, ms: Date.now() - started, error: String(error.message || error).slice(0, 600), notes: ctx.notes };
        report.failed.push(`${spec.key}/${driver.name}: ${String(error.message || error).slice(0, 240)}`);
      }
      save();
    }
  }
  save();
  return report;
};

const main = async () => {
  fs.mkdirSync(INVENTORY, { recursive: true });
  const { companies } = buildPopulation();
  const projects = readJson(PROJECTS, {});
  const drivers = loadDrivers();
  const chosen = companies.filter((c) => (!ONLY || ONLY.includes(c.code)) && !SKIP.includes(c.code));
  console.log(`drivers: ${drivers.map((d) => d.name).join(', ')}; companies: ${chosen.length}`);
  let done = 0;
  const reports = await pool(chosen, CONCURRENCY, async (company) => {
    const report = await loadCompany(company, projects, drivers);
    done += 1;
    if (done % 10 === 0) console.log(`  ${done}/${chosen.length} companies`);
    return report;
  });
  const total = reports.reduce((sum, r) => ({ ran: sum.ran + r.ran, skipped: sum.skipped + r.skipped, failed: sum.failed + r.failed.length, notes: sum.notes + r.notes }), { ran: 0, skipped: 0, failed: 0, notes: 0 });
  console.log(`driver runs: ${total.ran} done, ${total.skipped} already done, ${total.failed} failed, ${total.notes} notes`);
  const failures = reports.flatMap((r) => r.failed);
  const kinds = {};
  for (const failure of failures) {
    const key = failure.replace(/^[^/]+\//, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>').slice(0, 160);
    kinds[key] = (kinds[key] || 0) + 1;
  }
  for (const [kind, n] of Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${n}×  ${kind}`);
  fs.writeFileSync(path.join(WORK, 'logs', `load-records-report-${Date.now()}.json`), JSON.stringify(reports, null, 1));
  process.exitCode = total.failed ? 1 : 0;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
