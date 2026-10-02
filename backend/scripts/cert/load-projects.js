'use strict';

/**
 * Layer 2a of the certification population: every company's projects and
 * project teams, created through the API by the company's own PM — so the
 * plan limit, the subscription gate and the product's own project defaults
 * all apply, exactly as they would for a customer.
 *
 *   node scripts/cert/load-projects.js                       # every company
 *   node scripts/cert/load-projects.js --only=001,045        # named companies
 *   node scripts/cert/load-projects.js --skip=021,027        # all but these
 *
 * Idempotent: a project is recognised by its contract number (CN-NNN-PP) and
 * is not created twice. The first project of a company that runs the
 * certified lifecycle is not created here — that lifecycle builds its own.
 *
 * Stages that would stop further loading (on hold, completed, archived) are
 * recorded in the state file and applied last, by finalize-population.js.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const fs = require('fs');
const { as, pool, ApiError } = require('./lib/api');
const { buildPopulation, rngFor } = require('./lib/spec');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
// Every request goes to the corpus the cross-company attacks replay.
process.env.CERT_CAPTURE_DIR = process.env.CERT_CAPTURE_DIR || path.join(WORK, 'corpus');
const STATE = path.join(WORK, 'state', 'projects.json');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]?.split(',') || null;
const ONLY = arg('only');
const SKIP = arg('skip') || [];
const CONCURRENCY = Number(arg('concurrency')?.[0] || 6);

const readState = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {});
const writeState = (state) => {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
};

/** Every project the PM can see, by contract number. */
const existingProjects = async (pm) => {
  const found = new Map();
  let cursor = null;
  for (;;) {
    const page = await pm.GET(`/projects?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const project of page.items || []) if (project.contractNumber) found.set(project.contractNumber, project);
    cursor = page.pagination?.nextCursor || null;
    if (!cursor) break;
  }
  return found;
};

/** Who is put on a project: the personas, then a share of the staff that grows with the job's position in the list. */
const teamFor = (company, index) => {
  const rng = rngFor(`team:${company.code}:${index}`);
  const personas = company.people.filter((p) => p.persona && p.persona !== 'pm');
  const staff = company.people.filter((p) => !p.persona && !p.isOwner);
  const share = Math.min(staff.length, 2 + ((company.n + index * 5) % 9));
  return [...personas, ...rng.shuffle(staff).slice(0, share)];
};

const loadCompany = async (company, state) => {
  const pm = as(`pm@${company.domain}`);
  const mine = (state[company.code] = state[company.code] || {});
  const existing = await existingProjects(pm);
  const report = { code: company.code, created: 0, present: 0, team: 0, notes: [] };

  for (const [index, spec] of company.projects.entries()) {
    if (index === 0 && spec.depth === 'certified') continue; // built by the certified lifecycle
    let project = existing.get(spec.contractNumber);
    if (project) {
      report.present += 1;
    } else {
      try {
        project = await pm.POST('/projects', {
          name: spec.name,
          type: spec.type,
          location: spec.location,
          clientName: spec.clientName,
          contractType: spec.contractType,
          contractNumber: spec.contractNumber,
          startDate: spec.startDate,
          endDate: spec.endDate,
          duration: spec.duration,
          durationUnit: spec.durationUnit,
          contractValue: spec.contractValue,
          currency: spec.currency,
          defaultRetentionRate: spec.defaultRetentionRate,
          projectCalendar: spec.projectCalendar,
          ...(spec.reportingCutoffDay ? { reportingCutoffDay: spec.reportingCutoffDay } : {}),
        });
        report.created += 1;
      } catch (error) {
        if (error instanceof ApiError) {
          report.notes.push(`${spec.key}: ${error.status} ${error.code} ${error.serverMessage}`);
          continue;
        }
        throw error;
      }
    }
    const entry = (mine[spec.key] = mine[spec.key] || {});
    Object.assign(entry, { id: project.id, name: spec.name, stage: spec.stage, depth: spec.depth, canary: spec.canary, currency: spec.currency, timezone: spec.timezone });

    // The project's own time zone, where it has one (otherwise it falls back to the company's).
    if (spec.timezone && !entry.timezoneSet) {
      await pm.PUT(`/projects/${project.id}/daily-logs/settings`, { timezone: spec.timezone });
      entry.timezoneSet = true;
    }

    // The team.
    entry.team = entry.team || {};
    for (const person of teamFor(company, index)) {
      if (entry.team[person.id]) continue;
      // The team route's role list has eight of the nine roles: a quality engineer is added with their company role.
      const res = await pm.send('POST', `/projects/${project.id}/team`, { userId: person.id });
      if (res.status === 200 || res.status === 201) {
        entry.team[person.id] = person.role;
        report.team += 1;
      } else {
        report.notes.push(`${spec.key} team ${person.email}: ${res.status} ${res.body?.error?.code}`);
      }
    }
  }
  return report;
};

const main = async () => {
  const { companies } = buildPopulation();
  const chosen = companies.filter((c) => (!ONLY || ONLY.includes(c.code)) && !SKIP.includes(c.code));
  const state = readState();
  let done = 0;
  const reports = await pool(chosen, CONCURRENCY, async (company) => {
    let report;
    try {
      report = await loadCompany(company, state);
    } catch (error) {
      report = { code: company.code, created: 0, present: 0, team: 0, notes: [`ABORTED: ${error.message}`] };
    }
    done += 1;
    if (done % 10 === 0) {
      writeState(state);
      console.log(`  ${done}/${chosen.length} companies`);
    }
    return report;
  });
  writeState(state);
  const total = reports.reduce((sum, r) => ({ created: sum.created + r.created, present: sum.present + r.present, team: sum.team + r.team }), { created: 0, present: 0, team: 0 });
  const noted = reports.filter((r) => r.notes.length);
  console.log(`projects created ${total.created}, already present ${total.present}, team assignments made ${total.team}`);
  console.log(`companies with notes: ${noted.length}`);
  for (const r of noted.slice(0, 40)) console.log(`  ${r.code}: ${r.notes.slice(0, 4).join(' | ')}${r.notes.length > 4 ? ` (+${r.notes.length - 4} more)` : ''}`);
  fs.writeFileSync(path.join(WORK, 'logs', 'load-projects-report.json'), JSON.stringify(reports, null, 1));
  process.exitCode = noted.some((r) => r.notes.some((n) => n.startsWith('ABORTED'))) ? 1 : 0;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
