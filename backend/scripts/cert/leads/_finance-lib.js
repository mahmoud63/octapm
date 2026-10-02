'use strict';

/**
 * Shared plumbing for the finance lead reproductions (L34-L37).
 *
 * Everything goes through the certification API (lib/api.js). Each lead script
 * creates its own project, so its figures are its own; nothing here reads or
 * writes a database.
 *
 * Exit codes of a lead script: 0 = the product behaves correctly, 2 = the
 * defect is present, 3 = the reproduction could not be set up (not a verdict).
 */

const { as } = require('../lib/api');
const { buildPopulation } = require('../lib/spec');

const population = buildPopulation();
const companyOf = (code) => {
  const company = population.companies.find((c) => c.code === code);
  if (!company) throw new Error(`No certification company ${code}`);
  return company;
};
const personOf = (code, persona) => {
  const company = companyOf(code);
  const person = company.people.find((p) => p.persona === persona);
  if (!person) throw new Error(`Company ${code} has no ${persona}`);
  return person;
};
const who = (code, persona) => as(personOf(code, persona).email);

const compact = (value, max = 700) => {
  if (value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}… (${text.length} chars)` : text;
};

const section = (title) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 90 - title.length))}`);
const say = (...parts) => console.log(...parts);

class SetupError extends Error {}

/**
 * One request, printed: who, what was sent, the status and what came back.
 * `show` picks what to print of a successful answer (default: a compact dump).
 * Never throws on a status.
 */
const call = async (session, method, route, body, { show = null, quiet = false, max = 700 } = {}) => {
  const res = await session.send(method, route, body);
  const data = res.body && typeof res.body === 'object' && 'data' in res.body ? res.body.data : res.body;
  if (!quiet) {
    console.log(`→ ${session.email}  ${method} ${route}${body !== undefined ? `  ${compact(body, 500)}` : ''}`);
    const ok = res.status >= 200 && res.status < 300;
    const shown = ok ? (show ? show(data) : data) : res.body?.error ?? res.text;
    console.log(`← ${res.status}  ${compact(shown, max)}`);
  }
  return { status: res.status, data, body: res.body, ok: res.status >= 200 && res.status < 300, error: res.body?.error ?? null };
};

/** A request the reproduction depends on: a refusal ends the run as "could not set up". */
const must = async (session, method, route, body, options = {}) => {
  const res = await call(session, method, route, body, options);
  if (!res.ok) throw new SetupError(`${method} ${route} was refused (${res.status} ${res.error?.code ?? ''} ${res.error?.message ?? ''}) — the reproduction cannot continue.`);
  return res.data;
};

const today = () => new Date().toISOString().slice(0, 10);
const dayOffset = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(2, 14);
const cents = (value) => Math.round(Number(value || 0) * 100);
const eq = (a, b) => cents(a) === cents(b);
const listOf = (data, ...keys) => {
  if (Array.isArray(data)) return data;
  for (const key of ['items', ...keys]) if (Array.isArray(data?.[key])) return data[key];
  return [];
};

/**
 * A new project in a certification company, made by its PM, with the named
 * personas on the team. Returns { id, P }.
 */
const newProject = async (code, label, { team = [], contractValue = 1000000, extra = {} } = {}) => {
  const pm = who(code, 'pm');
  const project = await must(
    pm,
    'POST',
    '/projects',
    { name: `${label} ${stamp()}`, startDate: dayOffset(-120), endDate: dayOffset(240), contractValue, currency: 'EUR', ...extra },
    { show: (d) => ({ id: d.id, name: d.name, status: d.status, timezone: d.timezone }) }
  );
  for (const persona of team) {
    const person = personOf(code, persona);
    const res = await call(pm, 'POST', `/projects/${project.id}/team`, { userId: person.id }, { quiet: true });
    if (!res.ok) throw new SetupError(`Adding ${persona} to the project was refused: ${res.status} ${res.error?.code}`);
  }
  if (team.length) say(`   team added: ${team.join(', ')}`);
  return { id: project.id, P: `/projects/${project.id}`, name: project.name, timezone: project.timezone };
};

/** The company's cost-code master as { code: id }, switched on for the project. */
const projectCostCodes = async (code, P) => {
  const pm = who(code, 'pm');
  const library = listOf(await must(pm, 'GET', '/company/cost-codes?includeArchived=false', undefined, { quiet: true }));
  const map = Object.fromEntries(library.map((row) => [row.code, row.id]));
  await must(pm, 'PUT', `${P}/budget/cost-codes`, { costCodeIds: Object.values(map) }, { quiet: true });
  return map;
};

/** Ends a lead script: the verdict line and the exit code. */
const verdict = (lead, outcome, sentence) => {
  console.log(`\nVERDICT ${lead}: ${outcome} — ${sentence}`);
  process.exitCode = outcome === 'CONFIRMED' || outcome === 'PARTLY_CONFIRMED' ? 2 : 0;
};

const run = (lead, main) =>
  main().catch((error) => {
    console.error(`\n${lead}: the reproduction stopped — ${error instanceof SetupError ? error.message : error.stack}`);
    console.log(`\nVERDICT ${lead}: NOT_TESTED — the reproduction could not be set up (${String(error.message).slice(0, 160)})`);
    process.exitCode = 3;
  });

module.exports = { SetupError, call, must, who, personOf, companyOf, newProject, projectCostCodes, section, say, compact, today, dayOffset, stamp, cents, eq, listOf, verdict, run };
