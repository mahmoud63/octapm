'use strict';

/**
 * Concrete paths for route templates, bound to ONE company's own records
 * (CERT-2 sweeps). A sweep that sends a route must send it on a path that
 * names the acting company's own record, or every answer is a 404 that
 * proves nothing.
 *
 * Sources, in order:
 *   1. what the sweep already knows: the read sweep's owner reads of the
 *      company and the company's own captured requests (learn(template, path));
 *   2. discovery: for a template whose deepest parameter no known path binds,
 *      the company's own collection is asked (GET of the path up to that
 *      parameter — /projects/<id>/lookaheads for /projects/{projectId}/lookaheads/{lookaheadId})
 *      and the first record in the answer binds the parameter; a record nested
 *      in its parent's answer (a lookahead's items) is found under the
 *      parameter's literal segment name. Parameters that are not identifiers
 *      take a fixed value (format: xlsx).
 *
 * Nothing is written: discovery only reads, as the company's own person.
 */

const PARAM = /^\{(.+)\}$/;
const FIXED = { format: 'xlsx', fmt: 'xlsx' };
const NOT_FOUND = Symbol('not found');

const createBinder = ({ session }) => {
  const prefixes = new Map(); // "/projects/{projectId}/rfi/{rfiId}" -> "/projects/<id>/rfi/<id>"
  const failed = new Set();

  const learn = (template, concrete) => {
    if (!template || !concrete) return;
    const t = template.split('/');
    const c = String(concrete).split('?')[0].split('/');
    if (t.length !== c.length) return;
    for (let i = 0; i < t.length; i += 1) {
      if (!PARAM.test(t[i])) continue;
      const key = t.slice(0, i + 1).join('/');
      if (!prefixes.has(key)) prefixes.set(key, c.slice(0, i + 1).join('/'));
    }
  };

  /** The path from known prefixes only, or null. */
  const bindKnown = (template) => {
    const t = template.split('/');
    const params = t.map((s, i) => (PARAM.test(s) ? i : -1)).filter((i) => i >= 0);
    if (!params.length) return template;
    const last = params[params.length - 1];
    const head = prefixes.get(t.slice(0, last + 1).join('/'));
    return head ? [head, ...t.slice(last + 1)].join('/') : null;
  };

  const idsIn = (data, segment, param) => {
    const lists = [];
    if (Array.isArray(data)) lists.push(data);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const key of [segment, 'items', 'rows', 'results', 'data', 'records', 'list']) if (Array.isArray(data[key])) lists.push(data[key]);
      for (const value of Object.values(data)) if (Array.isArray(value)) lists.push(value);
    }
    for (const list of lists) {
      for (const item of list) {
        if (item && typeof item === 'object') {
          const value = item[param] ?? item.id;
          if (typeof value === 'string' || typeof value === 'number') return String(value);
        }
      }
    }
    return null;
  };

  const ask = async (path) => {
    try {
      const res = await session.send('GET', path);
      return res.status >= 200 && res.status < 300 ? res.body?.data ?? null : NOT_FOUND;
    } catch {
      return NOT_FOUND;
    }
  };

  /** Binds `template` to the company's own records, discovering what is not known. Null when it cannot. */
  const bind = async (template) => {
    const known = bindKnown(template);
    if (known) return known;
    if (failed.has(template)) return null;
    const t = template.split('/');
    const params = t.map((s, i) => (PARAM.test(s) ? i : -1)).filter((i) => i >= 0);
    let concrete = [];
    let from = 0;
    for (const index of params) {
      const key = t.slice(0, index + 1).join('/');
      if (prefixes.has(key)) {
        concrete = prefixes.get(key).split('/');
        from = index + 1;
        continue;
      }
      const name = PARAM.exec(t[index])[1];
      const literal = t.slice(from, index);
      const parent = [...concrete, ...literal];
      let value = FIXED[name] || null;
      if (!value) {
        const collection = await ask(parent.join('/'));
        if (collection !== NOT_FOUND) value = idsIn(collection, literal[literal.length - 1], name);
      }
      if (!value && literal.length && concrete.length) {
        // A record nested in its parent's own answer: GET /lookaheads/<id> -> { items: [...] }.
        const owner = await ask(concrete.join('/'));
        if (owner !== NOT_FOUND) value = idsIn(owner, literal[literal.length - 1], name);
      }
      if (!value) {
        failed.add(template);
        return null;
      }
      concrete = [...parent, encodeURIComponent(value)];
      prefixes.set(key, concrete.join('/'));
      from = index + 1;
    }
    return [...concrete, ...t.slice(from)].join('/');
  };

  return { learn, bind, bindKnown, prefixes };
};

module.exports = { createBinder };
