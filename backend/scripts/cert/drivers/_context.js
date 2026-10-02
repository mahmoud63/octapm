'use strict';

/**
 * What a record driver is given: one company, one project, the company's
 * people as API sessions, a repeatable random source, and the inventory of
 * what earlier drivers made.
 *
 * A driver is a module `{ name, needs?, depths?, run(ctx) }`. It creates
 * records through the API as the right person and reports each one with
 * `ctx.record(type, id)`; whatever a later driver needs by name goes in
 * `ctx.refs` (project) or `ctx.companyRefs` (company-wide).
 *
 * Every text a driver writes should carry `ctx.canary(type)`: a string unique
 * to this company, project and record. The isolation tests look for another
 * company's canaries in every response.
 */

const { as, ApiError } = require('../lib/api');
const { rngFor } = require('../lib/spec');

/**
 * Persona → who stands in when a small company has nobody in that role. It
 * is always the owner, who is the PM: in a company of two to five people the
 * owner does what no one else is allowed to (a finance officer, for one,
 * cannot write budget lines).
 */
const FALLBACK = {
  planner: ['pm'],
  qs: ['pm'],
  cost: ['pm'],
  procurement: ['pm'],
  warehouse: ['pm'],
  site: ['pm'],
  quality: ['pm'],
  finance: ['pm'],
  pm: [],
};

const buildContext = ({ company, projectKey, projectState, companyState, driverName }) => {
  const spec = company.projects.find((p) => p.key === projectKey);
  const byPersona = new Map(company.people.filter((p) => p.persona).map((p) => [p.persona, p]));
  const person = (key) => {
    if (byPersona.has(key)) return byPersona.get(key);
    for (const alt of FALLBACK[key] || []) if (byPersona.has(alt)) return byPersona.get(alt);
    return byPersona.get('pm');
  };
  const rng = rngFor(`driver:${driverName}:${projectKey}`);
  const counters = {};
  const notes = [];
  projectState.records = projectState.records || {};
  projectState.refs = projectState.refs || {};
  companyState.refs = companyState.refs || {};
  companyState.records = companyState.records || {};

  const ctx = {
    company,
    project: { ...spec, id: projectState.id },
    P: `/projects/${projectState.id}`,
    depth: spec.depth,
    rng,
    /** The person who holds a persona here (or who stands in), and their API session. */
    person,
    who: (key) => as(person(key).email),
    userId: (key) => person(key).id,
    hasPersona: (key) => byPersona.has(key),
    /** How many of something to make: light projects get the low end. */
    count: (low, high) => (spec.depth === 'light' ? low : rng.int(low, high)),
    canary: (type) => {
      counters[type] = (counters[type] || 0) + 1;
      return `${spec.canary}-${String(type).toUpperCase()}-${counters[type]}`;
    },
    /** Remembers a created record: type → ids (project scope by default). */
    record: (type, id, { scope = 'project' } = {}) => {
      if (!id) throw new Error(`${driverName}: a ${type} was recorded without an id`);
      const bucket = scope === 'company' ? companyState.records : projectState.records;
      (bucket[type] = bucket[type] || []).push(id);
      return id;
    },
    refs: projectState.refs,
    companyRefs: companyState.refs,
    records: projectState.records,
    note: (text) => notes.push(text),
    notes,
    /** Runs a step that is allowed to be refused; a refusal becomes a note, not a failure. */
    attempt: async (label, fn) => {
      try {
        return await fn();
      } catch (error) {
        if (error instanceof ApiError) {
          notes.push(`${label}: ${error.status} ${error.code} ${error.serverMessage}`.slice(0, 300));
          return null;
        }
        throw error;
      }
    },
    today: new Date().toISOString().slice(0, 10),
    daysAgo: (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10),
    daysAhead: (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10),
  };
  return ctx;
};

module.exports = { buildContext };
