'use strict';

/**
 * The date and figure sweep (CERT-2, robustness-5): no date field and no
 * figure field may answer a 5xx, whatever shape its value has.
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/date-sweep.js
 *   CERT_INPROCESS=1 node scripts/cert/isolation/date-sweep.js --attacker=044 --victim=045 --passes=body,query,figures --only="rfi|projects" --name=date-sweep-subset
 *
 * PASS body     Every body field of the real app that is a date: the fields
 *               of every body chain with a date check (dateInput,
 *               dateOnlyInput, validator's isISO8601 / isDate / toDate, a
 *               \d{4} pattern — read from the mounted routers), every
 *               date-named body field with no date check, and every field of
 *               the attacker company's captured accepted requests whose value
 *               is a date string. Each is sent again on ONE accepted request
 *               of the attacker company for that route (the captured corpus,
 *               <work>/corpus/*.jsonl), as the same person, with the field
 *               replaced by each WRONG shape:
 *                 "20261001" "2026-W40" "2026-275" "2026-10-01T10Z"
 *                 "20261001T101010Z" "notadate" "2026-02-30" "0000-01-01" ""
 *                 [] ["<date>"] ["<date>","<date>"] {"not":"x"} 20261001
 *                 8.64e15 -8.64e15 true
 *               and each ACCEPTED shape the date helper lets through (the
 *               captured date rewritten: "<d>T00:00", "<d> 00:00:00",
 *               "<d>T00:00:00.000Z"; on a create also "<YYYY-MM>" and
 *               "<YYYY>"). A field nested in an array the captured body does
 *               not carry is sent in a one-element array of its own.
 * PASS query    Every GET route with a date query parameter (a query chain
 *               with a date check), bound to a concrete path the attacker
 *               company's owner read (<work>/results/isolation/cert2b-reads.json)
 *               or a captured GET, with ?x=<each wrong string shape>,
 *               ?x=a&x=b, ?x[]=a, ?x[k]=v and the accepted ?x=2026,
 *               ?x=2026-10, ?x=2026-10-01T00:00.
 * PASS figures  Every body chain with a numeric check or sanitizer, on the
 *               same captured requests, with the field replaced by
 *               [1,1] [5] [] {"n":1} true — none may be a 5xx, and none may
 *               be accepted (2xx): a figure that is not one value is refused
 *               at the door (scalarFigure). --ranges adds 1e20 -1e20 1e308
 *               "1e400" "NaN" on create routes (a column overflow is a 400).
 *
 * PASS text    (--passes=text, robustness-6) Every text, number and boolean
 *               field of the captured accepted request of each route (not an
 *               identifier — the shape sweep's — nor a date — the body
 *               pass's — nor a chained figure — the figure pass's), sent
 *               again with the field replaced by {"a":1} {"a":{"b":1}}
 *               ["a","b"] ["<the captured value>"] 12345 true (text),
 *               {"a":1} "abc" [1,1] (number),
 *               {"a":1} "maybe" [true] (boolean). None may be a 5xx: an
 *               object or array that reaches Prisma unchecked is refused in
 *               the words Prisma uses for a code fault, which the error
 *               handler answers 500.
 *
 * PASS replay  (--passes=replay, robustness-6) Every captured accepted request
 *               sent again exactly as captured: a 400 VALIDATION_ERROR naming
 *               a field is a legitimate client flow a narrowed door broke
 *               (DOOR_REFUSED, listed); other refusals are the record's own
 *               state (a duplicate, a step already taken).
 *
 * The body and query passes also send the instants whose written year is in
 * range but whose UTC year is not: "9999-12-31T23:59:59-14:00" (10000) and
 * "0001-01-01T00:00:00+14:00" (0) (robustness-6).
 *
 * Judged: a 5xx is a finding; a figure pass non-scalar answered 2xx is a
 * finding (ACCEPTED_NON_SCALAR); every other answer is listed by status.
 * Routes another group owns (daily reports, site diaries, meetings) are
 * sent and reported apart, never hidden. The victim company's data must not
 * change (fingerprint of the victim's tables before and after).
 *
 * Results: <work>/results/isolation/<name>.json. Last line:
 *   date sweep: N requests, X 5xx, Y non-scalar figures accepted, Z skipped
 * Exit code 0 when X = 0, Y = 0 (outside other groups' routes) and the
 * victim's data did not change; 2 otherwise.
 *
 * Read-only on the database; every write goes through the API as the
 * attacker company's own people, on its own records.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { as, multipart } = require('../lib/api');
const guard = require('../lib/cert-env');
const { buildMatcher } = require('../lib/routes');
const fingerprint = require('./fingerprint');
const { createBinder } = require('./bind-paths');

const B = path.join(__dirname, '..', '..', '..');
// eslint-disable-next-line import/no-dynamic-require
const validatorLib = require(require.resolve('validator', { paths: [require.resolve('express-validator', { paths: [B] })] }));

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const arg = (name, fallback = null) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const NAME = arg('name', 'date-sweep');
const CODE = arg('attacker', '044');
const VICTIM = arg('victim', '045');
const READS = arg('reads', 'cert2b-reads');
const ONLY = arg('only') ? new RegExp(arg('only')) : null;
const PASSES = new Set(arg('passes', 'body,query,figures').split(','));
const RANGES = process.argv.includes('--ranges');
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const DATE_NAME = /(date|At|On|Through|Until|Start|Finish|End|Due|Deadline|Expiry|Expires)$/;
const NOT_DATE_NAME = /(Id|Ids|By|Days|Count|Type|Status|Note|Notes|Reason|Time|Mode|Basis)$/;
const OTHER_GROUP = /\/(daily-reports|site-diaries|meetings)(\/|$)/;

// The product's local e-mail transport writes to the console in process; keep it out of the output.
const print = console.log.bind(console);
console.log = (...a) => {
  if (String(a[0]).startsWith('[email:local]')) return;
  print(...a);
};
console.info = () => {};
// Outside production the error handler prints every unexpected error's stack; the answers are what is judged here.
const printError = console.error.bind(console);
console.error = () => {};

const mountPath = (layer) => {
  let source = layer.regexp.source;
  if (source === '^\\/?(?=\\/|$)') return '';
  source = source.replace(/^\^/, '').replace(/\\\/\?\(\?=\\\/\|\$\)$/, '').replace(/\(\?=\\\/\|\$\)$/, '').replace(/\\\/\?\$$/, '').replace(/\\\//g, '/');
  let keyIndex = 0;
  return source.replace(/\(\?:\/\(\[\^\/\]\+\?\)\)/g, () => `/{${layer.keys[keyIndex++]?.name || 'param'}}`).replace(/\(\[\^\/\]\+\?\)/g, () => `{${layer.keys[keyIndex++]?.name || 'param'}}`).replace(/\\\./g, '.').replace(/\^/g, '').replace(/\$/g, '').replace(/\?/g, '');
};
const normalise = (value) => value.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';

const SHAPES_WRONG = [
  ['"20261001"', () => '20261001'],
  ['"2026-W40"', () => '2026-W40'],
  ['"2026-275"', () => '2026-275'],
  ['"2026-10-01T10Z"', () => '2026-10-01T10Z'],
  ['"20261001T101010Z"', () => '20261001T101010Z'],
  ['"notadate"', () => 'notadate'],
  ['"2026-02-30"', () => '2026-02-30'],
  ['"0000-01-01"', () => '0000-01-01'],
  // robustness-6: the written year is in range, the instant is not (10000-01-01T13:59:59Z, 0000-12-31T10:00:00Z).
  ['"9999-12-31T23:59:59-14:00"', () => '9999-12-31T23:59:59-14:00'],
  ['"0001-01-01T00:00:00+14:00"', () => '0001-01-01T00:00:00+14:00'],
  ['""', () => ''],
  ['[]', () => []],
  ['["<date>"]', (d) => [d]],
  ['["<date>","<date>"]', (d) => [d, d]],
  ['{"not":"x"}', () => ({ not: 'x' })],
  ['20261001', () => 20261001],
  ['8.64e15', () => 8.64e15],
  ['-8.64e15', () => -8.64e15],
  ['true', () => true],
];
const SHAPES_ACCEPTED = [
  ['"<d>T00:00"', (d) => `${d}T00:00`, false],
  ['"<d> 00:00:00"', (d) => `${d} 00:00:00`, false],
  ['"<d>T00:00:00.000Z"', (d) => `${d}T00:00:00.000Z`, false],
  ['"<YYYY-MM>"', (d) => d.slice(0, 7), true],
  ['"<YYYY>"', (d) => d.slice(0, 4), true],
];
const SHAPES_FIGURE = [
  ['[1,1]', () => [1, 1]],
  ['[5]', () => [5]],
  ['[]', () => []],
  ['{"n":1}', () => ({ n: 1 })],
  ['true', () => true],
  ...(RANGES ? [['1e20', () => 1e20, 'range'], ['-1e20', () => -1e20, 'range'], ['1e308', () => 1e308, 'range'], ['"1e400"', () => '1e400', 'range'], ['"NaN"', () => 'NaN', 'range']] : []),
];
const QUERY_WRONG = ['20261001', '2026-W40', '2026-275', '2026-10-01T10Z', 'notadate', '2026-02-30', '0000-01-01', '9999-12-31T23:59:59-14:00', '0001-01-01T00:00:00+14:00'];
// PASS text (robustness-6): a value of another shape in every text, number and boolean field the
// captured request carries (identifiers are the shape sweep's, dates the body pass's, chained figures
// the figure pass's). An object or array that reaches Prisma unchecked is refused there in words
// Prisma also uses for a code fault ("Unknown argument", "Argument … is missing"), which the error
// handler answers 500 since robustness-6: every such field must be refused at its door.
const SHAPES_TEXT = {
  // ["<v>"]: the captured value itself in a list — an enumeration check (isIn) passes a list element by element.
  string: [['{"a":1}', () => ({ a: 1 })], ['{"a":{"b":1}}', () => ({ a: { b: 1 } })], ['["a","b"]', () => ['a', 'b']], ['["<v>"]', (v) => [v]], ['12345', () => 12345], ['true', () => true]],
  number: [['{"a":1}', () => ({ a: 1 })], ['"abc"', () => 'abc'], ['[1,1]', () => [1, 1]]],
  boolean: [['{"a":1}', () => ({ a: 1 })], ['"maybe"', () => 'maybe'], ['[true]', () => [true]]],
};
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_FIELD = /password|token|secret|^otp$|^code$/i;
const QUERY_ACCEPTED = ['2026', '2026-10', '2026-10-01T00:00'];

/** The real app's validator chains: date fields and figure fields of body chains, date fields of query chains. */
const chainFields = () => {
  // eslint-disable-next-line global-require
  const { createApp } = require('../../../src/app');
  // eslint-disable-next-line global-require
  const { dateInput, dateOnlyInput } = require('../../../src/utils/date-input');
  const app = createApp();
  const dateChecks = new Set([dateInput, dateOnlyInput, validatorLib.isISO8601, validatorLib.isDate, validatorLib.isRFC3339]);
  const figureChecks = new Set([validatorLib.isFloat, validatorLib.isInt, validatorLib.isNumeric, validatorLib.isDecimal]);
  const figureSanitizers = new Set([validatorLib.toInt, validatorLib.toFloat]);
  const isDate = (item) => dateChecks.has(item.validator) || item.sanitizer === validatorLib.toDate || (item.validator === validatorLib.matches && /\\d\{4\}/.test(String(item.options?.[0])));
  const isFigure = (item) => figureChecks.has(item.validator) || figureSanitizers.has(item.sanitizer);
  const body = new Map(); // `${METHOD} ${template}` -> Map(field -> why)
  const figures = new Map();
  const query = new Map(); // `GET ${template}` -> Set(field)
  const add = (map, key, field, why) => {
    const m = map.get(key) || map.set(key, new Map()).get(key);
    if (!m.has(field)) m.set(field, why);
  };
  const walk = (stack, prefix = '') => {
    for (const layer of stack) {
      if (layer.route) {
        const full = normalise(`${prefix}${layer.route.path}`);
        if (!full.startsWith('/api/v1')) continue;
        const template = full.replace('/api/v1', '') || '/';
        for (const method of Object.keys(layer.route.methods)) {
          if (method === '_all') continue;
          const key = `${method.toUpperCase()} ${template}`;
          for (const sub of layer.route.stack) {
            const ctx = sub.handle?.builder?.build?.();
            if (!ctx) continue;
            const dated = ctx.stack.some(isDate);
            const figured = ctx.stack.some(isFigure);
            for (const field of ctx.fields) {
              if (ctx.locations.includes('query') && dated) add(query, key, field, 'date check');
              if (!ctx.locations.includes('body') || method === 'get' || method === 'delete') continue;
              if (dated) add(body, key, field, 'date check');
              // A date-named field with a numeric check (earlyStart, lateFinish — day offsets) is a figure: the figure pass sends it.
              else if (DATE_NAME.test(field.split('.').pop()) && !NOT_DATE_NAME.test(field) && !figured) add(body, key, field, 'date-named, no date check');
              if (figured) add(figures, key, field, 'figure check');
            }
          }
        }
        continue;
      }
      if (layer.name === 'router' && layer.handle?.stack) walk(layer.handle.stack, normalise(`${prefix}${mountPath(layer)}`));
    }
  };
  walk(app._router.stack);
  return { body, figures, query };
};

/** The body with `field` (dot path, * for the first array element) set to `value`; a missing array container is made. */
const setField = (bodyIn, field, value) => {
  const copy = JSON.parse(JSON.stringify(bodyIn ?? {}));
  const parts = field.split('.');
  let node = copy;
  let synthesized = false;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    const nextIsStar = parts[i + 1] === '*';
    if (part === '*') {
      if (!Array.isArray(node)) return null;
      if (!node.length) {
        node.push({});
        synthesized = true;
      }
      if (typeof node[0] !== 'object' || node[0] === null) return null;
      node = node[0];
      continue;
    }
    if (node[part] === undefined || node[part] === null) {
      node[part] = nextIsStar ? [] : {};
      synthesized = true;
    }
    node = node[part];
    if (node === null || typeof node !== 'object') return null;
  }
  const last = parts[parts.length - 1];
  if (last === '*') {
    if (!Array.isArray(node)) return null;
    if (node.length) node[0] = value;
    else {
      node.push(value);
      synthesized = true;
    }
  } else node[last] = value;
  return { body: copy, synthesized };
};
const getField = (bodyIn, field) => {
  let node = bodyIn;
  for (const part of field.split('.')) {
    if (node === null || node === undefined) return undefined;
    node = part === '*' ? (Array.isArray(node) ? node[0] : undefined) : node[part];
  }
  return node;
};

const main = async () => {
  const started = Date.now();
  const { body: bodyFields, figures: figureFields, query: queryFields } = chainFields();
  const match = buildMatcher(JSON.parse(fs.readFileSync(path.join(WORK, 'routes.json'), 'utf8')));

  // The corpus: the attacker company's first accepted request per (method, template); its date-valued fields.
  // A route the attacker company never asked is taken from the first other company's corpus that has it
  // (never the victim's, never a company refused on its own billing), sent as that company's own person.
  const chosen = new Map();
  const chosenGet = new Map();
  const files = fs.readdirSync(path.join(WORK, 'corpus')).filter((f) => f.endsWith('.jsonl'));
  let billingBlocked = new Set();
  try {
    const inject = JSON.parse(fs.readFileSync(path.join(WORK, 'results', 'isolation', 'cert2b-inject.json'), 'utf8'));
    billingBlocked = new Set(inject.results.filter((r) => r.verdict === 'REFUSED_OWN_BILLING').map((r) => r.attacker));
  } catch {
    billingBlocked = new Set();
  }
  const scan = async (wanted, onlyKeys) => {
    for (const file of files) {
      const rl = readline.createInterface({ input: fs.createReadStream(path.join(WORK, 'corpus', file)), crlfDelay: Infinity });
      // eslint-disable-next-line no-restricted-syntax
      for await (const line of rl) {
        const code = /@c(\d{3})\.octapm-cert\.test"/.exec(line)?.[1];
        if (!code || !wanted(code)) continue;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (!(entry.status >= 200 && entry.status < 300) || entry.method === 'DELETE') continue;
        if (/@c(\d{3})\.octapm-cert\.test$/.exec(String(entry.actor || ''))?.[1] !== code) continue;
        if (/^\/(auth\/(login|refresh|logout|register)|billing|admin)/.test(entry.route)) continue;
        const hit = match(entry.method, entry.route);
        if (!hit) continue;
        const key = `${entry.method} ${hit.template}`;
        if (onlyKeys && !onlyKeys.has(key)) continue;
        if (entry.method === 'GET') {
          if (!chosenGet.has(hit.template)) chosenGet.set(hit.template, entry);
          continue;
        }
        const sent = entry.file ? entry.file.fields : entry.json;
        if (!sent || typeof sent !== 'object') continue;
        if (!chosen.has(key)) chosen.set(key, entry);
        const visit = (value, trail) => {
          if (typeof value === 'string') {
            if (DATE_VALUE.test(value)) {
              const m = bodyFields.get(key) || bodyFields.set(key, new Map()).get(key);
              const field = trail.join('.');
              if (!m.has(field)) m.set(field, 'date value in the corpus');
            }
            return;
          }
          if (Array.isArray(value)) {
            if (value.length) visit(value[0], [...trail, '*']);
            return;
          }
          if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) visit(v, [...trail, k]);
        };
        visit(sent, []);
      }
    }
  };
  await scan((code) => code === CODE, null);
  const missing = new Set([...bodyFields.keys(), ...figureFields.keys()].filter((key) => !chosen.has(key) && (!ONLY || ONLY.test(key))));
  for (const key of queryFields.keys()) if (!chosenGet.has(key.replace(/^GET /, ''))) missing.add(key);
  const fallback = new Set();
  if (missing.size) {
    await scan((code) => code !== CODE && code !== VICTIM && !billingBlocked.has(code), missing);
    for (const key of missing) if (chosen.has(key) || chosenGet.has(key.replace(/^GET /, ''))) fallback.add(key);
    print(`corpus: ${missing.size} route(s) with no accepted request of company ${CODE}; ${fallback.size} taken from another company's own requests`);
  }

  const db = await guard.connectCert();
  const readOnly = async (fn) => {
    await db.query('begin transaction isolation level repeatable read read only');
    try {
      return await fn();
    } finally {
      await db.query('rollback');
    }
  };
  const before = await readOnly(() => fingerprint.take(db));

  // Concrete paths of the attacker company's own records, by template prefix: a route nobody's corpus
  // asked is still sent, on a path bound to the attacker's own record of the same kind, with a body
  // that carries only the field (wrong shapes only — nothing a door lets through is written blind).
  const reads = JSON.parse(fs.readFileSync(path.join(WORK, 'results', 'isolation', `${READS}.json`), 'utf8'));
  const binder = createBinder({ session: as(`pm@c${CODE}.octapm-cert.test`) });
  for (const r of reads.results) if (r.attacker === 'owner' && r.victim === CODE && r.route && r.template) binder.learn(r.template, r.route);
  for (const [template, entry] of chosenGet) if (entry.actor.endsWith(`@c${CODE}.octapm-cert.test`)) binder.learn(template, entry.route);
  for (const [key, entry] of chosen) if (entry.actor.endsWith(`@c${CODE}.octapm-cert.test`)) binder.learn(key.replace(/^[A-Z]+ /, ''), entry.route);
  const synthesizedEntry = async (key) => {
    const [method, template] = key.split(' ');
    const route = await binder.bind(template);
    return route ? { method, route, actor: `pm@c${CODE}.octapm-cert.test`, org: null, json: {}, synthesized: true } : null;
  };

  const results = [];
  const uncovered = [];
  const send = async (entry, payload) => {
    const session = as(entry.actor, entry.org || null);
    try {
      if (entry.file) {
        return await session.send(entry.method, entry.route, undefined, { form: multipart({ field: entry.file.field, filename: entry.file.filename || 'sweep.pdf', contentType: entry.file.contentType, body: Buffer.from('%PDF-1.4 date sweep'), fields: payload }) });
      }
      return await session.send(entry.method, entry.route, payload);
    } catch (error) {
      return { status: 0, body: null, text: String(error.message || error) };
    }
  };
  const companyOf = (key) => {
    const entry = chosen.get(key);
    return entry ? /@c(\d{3})\./.exec(entry.actor)?.[1] : CODE;
  };
  const record = (base, res, extra = {}) => {
    const message = String(res.body?.error?.message || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    results.push({
      company: base.pass === 'query' ? undefined : companyOf(base.key),
      ...base,
      status: res.status,
      code: res.body?.error?.code || null,
      otherGroup: OTHER_GROUP.test(base.key || base.template || '') || undefined,
      ...(res.status >= 500 ? { error: message.find((l) => /Invalid|Argument|Error|overflow|must|expected/i.test(l))?.slice(0, 200) || message[0]?.slice(0, 200) || String(res.text || '').slice(0, 200), at: (message.find((l) => /\.js:\d+/.test(l)) || '').replace(/^.*[\\/](src[\\/])/, '$1').slice(0, 140) } : {}),
      ...extra,
    });
  };

  // ── PASS body ────────────────────────────────────────────────────────────
  if (PASSES.has('body')) {
    let planned = 0;
    let synthesizedFields = 0;
    for (const [key, map] of bodyFields) {
      if (ONLY && !ONLY.test(key)) continue;
      const entry = chosen.get(key) || (await synthesizedEntry(key));
      for (const [field, why] of map) {
        if (!entry) {
          uncovered.push(`${key} [${field}] (${why})`);
          continue;
        }
        planned += 1;
        if (entry.synthesized) synthesizedFields += 1;
        const sent = entry.file ? entry.file.fields : entry.json;
        const captured = getField(sent, field);
        const d = typeof captured === 'string' && /^\d{4}-\d{2}-\d{2}/.test(captured) ? captured.slice(0, 10) : '2026-10-01';
        const create = entry.method === 'POST';
        for (const [shape, make] of SHAPES_WRONG) {
          const built = setField(sent, field, make(d));
          if (!built) {
            results.push({ pass: 'body', key, field, why, shape, kind: 'wrong', status: 'SKIP' });
            continue;
          }
          record({ pass: 'body', key, field, why, shape, kind: 'wrong', synthesized: built.synthesized || entry.synthesized || undefined, route: entry.synthesized ? entry.route : undefined }, await send(entry, built.body));
        }
        if (entry.synthesized) continue;
        for (const [shape, make, createOnly] of SHAPES_ACCEPTED) {
          if (createOnly && !create) continue;
          const built = setField(sent, field, make(d));
          if (!built) continue;
          record({ pass: 'body', key, field, why, shape, kind: 'accepted', synthesized: built.synthesized || undefined }, await send(entry, built.body));
        }
      }
    }
    print(`body pass: ${planned} field(s) planned (${synthesizedFields} on a request built for a route no corpus has); ${uncovered.length} field(s) on routes that could not be bound`);
  }

  // ── PASS figures ─────────────────────────────────────────────────────────
  const figureUncovered = [];
  if (PASSES.has('figures')) {
    let planned = 0;
    let synthesizedFields = 0;
    for (const [key, map] of figureFields) {
      if (ONLY && !ONLY.test(key)) continue;
      const entry = chosen.get(key) || (await synthesizedEntry(key));
      for (const [field] of map) {
        if (!entry) {
          figureUncovered.push(`${key} [${field}]`);
          continue;
        }
        planned += 1;
        if (entry.synthesized) synthesizedFields += 1;
        const sent = entry.file ? entry.file.fields : entry.json;
        for (const [shape, make, kind] of SHAPES_FIGURE) {
          if (kind === 'range' && (entry.method !== 'POST' || entry.synthesized)) continue;
          const built = setField(sent, field, make());
          if (!built) {
            results.push({ pass: 'figures', key, field, shape, kind: kind || 'non-scalar', status: 'SKIP' });
            continue;
          }
          const res = await send(entry, built.body);
          record({ pass: 'figures', key, field, shape, kind: kind || 'non-scalar', synthesized: built.synthesized || entry.synthesized || undefined, route: entry.synthesized ? entry.route : undefined }, res);
        }
      }
    }
    print(`figures pass: ${planned} field(s) planned (${synthesizedFields} on a request built for a route no corpus has); ${figureUncovered.length} field(s) on routes that could not be bound`);
  }

  // ── PASS replay ──────────────────────────────────────────────────────────
  // robustness-6: every captured accepted request sent again exactly as the client sent it. A door
  // that now refuses it naming a field (400 VALIDATION_ERROR with details) is a legitimate flow a
  // narrowed input broke; any other refusal is the record's own state (a duplicate, a step taken).
  if (PASSES.has('replay')) {
    for (const [key, entry] of chosen) {
      if (ONLY && !ONLY.test(key)) continue;
      const sent = entry.file ? entry.file.fields : entry.json;
      const res = await send(entry, sent ?? {});
      const named = res.status === 400 && res.body?.error?.code === 'VALIDATION_ERROR' ? (res.body.error.details || []).map((d) => d.field).filter(Boolean) : [];
      record({ pass: 'replay', key, field: named.join(',') || undefined, shape: 'as captured', kind: named.length ? 'door-refused' : 'replayed', multipart: entry.file ? true : undefined }, res);
    }
    print(`replay pass: ${chosen.size} captured request(s) sent again as captured`);
  }

  // ── PASS text ────────────────────────────────────────────────────────────
  if (PASSES.has('text')) {
    let planned = 0;
    const figureKeys = (key) => figureFields.get(key) || new Map();
    const dateKeys = (key) => bodyFields.get(key) || new Map();
    for (const [key, entry] of chosen) {
      if (ONLY && !ONLY.test(key)) continue;
      const sent = entry.file ? entry.file.fields : entry.json;
      if (!sent || typeof sent !== 'object') continue;
      const leaves = [];
      const visit = (value, trail) => {
        const field = trail.join('.');
        if (typeof value === 'string') {
          if (!trail.length || UUID_VALUE.test(value) || DATE_VALUE.test(value) || dateKeys(key).has(field)) return;
          if (SECRET_FIELD.test(String(trail[trail.length - 1]))) return;
          leaves.push([field, 'string']);
          return;
        }
        if (typeof value === 'number') {
          if (trail.length && !figureKeys(key).has(field)) leaves.push([field, 'number']);
          return;
        }
        if (typeof value === 'boolean') {
          if (trail.length) leaves.push([field, 'boolean']);
          return;
        }
        if (Array.isArray(value)) {
          if (value.length) visit(value[0], [...trail, '*']);
          return;
        }
        if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) visit(v, [...trail, k]);
      };
      visit(sent, []);
      for (const [field, type] of leaves) {
        // A multipart form carries text only (the client sends every value as a string); its other
        // shapes — a field named x[k], a field sent twice — are the guard's, proved by robustness-6.
        if (entry.file) continue;
        const shapes = SHAPES_TEXT[type];
        planned += 1;
        for (const [shape, make] of shapes) {
          const built = setField(sent, field, make(getField(sent, field)));
          if (!built) {
            results.push({ pass: 'text', key, field, shape, kind: type, status: 'SKIP' });
            continue;
          }
          record({ pass: 'text', key, field, shape, kind: type }, await send(entry, built.body));
        }
      }
    }
    print(`text pass: ${planned} field(s) of ${chosen.size} captured request(s)`);
  }

  // ── PASS query ───────────────────────────────────────────────────────────
  const queryUnbound = [];
  if (PASSES.has('query')) {
    const bound = new Map(); // template -> { route, actor }
    for (const r of reads.results) if (r.attacker === 'owner' && r.victim === CODE && r.route && r.template && !bound.has(r.template)) bound.set(r.template, { route: r.route.split('?')[0], actor: `pm@c${CODE}.octapm-cert.test` });
    for (const [template, entry] of chosenGet) if (!bound.has(template)) bound.set(template, { route: entry.route.split('?')[0], actor: entry.actor, org: entry.org || null });
    for (const [key, map] of queryFields) {
      if (ONLY && !ONLY.test(key)) continue;
      const template = key.replace(/^GET /, '');
      const discovered = bound.has(template) ? null : await binder.bind(template);
      const target = bound.get(template) || (discovered ? { route: discovered, actor: `pm@c${CODE}.octapm-cert.test` } : null);
      if (!target) {
        queryUnbound.push(key);
        continue;
      }
      const { route } = target;
      const session = as(target.actor, target.org || null);
      for (const [field] of map) {
        const qs = [
          ...QUERY_WRONG.map((v) => [`=${v}`, `${encodeURIComponent(field)}=${encodeURIComponent(v)}`, 'wrong']),
          ['=a&=b', `${encodeURIComponent(field)}=2026-10-01&${encodeURIComponent(field)}=2026-10-02`, 'wrong'],
          ['[]=a', `${encodeURIComponent(`${field}[]`)}=2026-10-01`, 'wrong'],
          ['[k]=v', `${encodeURIComponent(`${field}[k]`)}=2026-10-01`, 'wrong'],
          ...QUERY_ACCEPTED.map((v) => [`=${v}`, `${encodeURIComponent(field)}=${encodeURIComponent(v)}`, 'accepted']),
        ];
        for (const [shape, query, kind] of qs) {
          let res;
          try {
            res = await session.send('GET', `${route}?${query}`);
          } catch (error) {
            res = { status: 0, body: null, text: String(error.message || error) };
          }
          record({ pass: 'query', key, template, field, shape, kind, company: /@c(\d{3})\./.exec(target.actor)?.[1] }, res);
        }
      }
    }
    print(`query pass: ${queryFields.size} GET route(s) with a date parameter; unbound: ${queryUnbound.length}`);
  }

  const after = await readOnly(() => fingerprint.take(db));
  await db.end();
  const victimChanges = fingerprint.compare(before, after).filter((c) => !c.noise && c.org === VICTIM);

  const sent = results.filter((r) => r.status !== 'SKIP');
  const serverErrors = sent.filter((r) => r.status >= 500 || r.status === 0);
  const nonScalarAccepted = sent.filter((r) => r.pass === 'figures' && r.kind === 'non-scalar' && r.status >= 200 && r.status < 300);
  const doorRefusedReplays = sent.filter((r) => r.pass === 'replay' && r.kind === 'door-refused');
  const inScope = (r) => !r.otherGroup;
  const tally = (items, k) => items.reduce((acc, item) => ({ ...acc, [k(item)]: (acc[k(item)] || 0) + 1 }), {});
  const summary = {
    name: NAME,
    at: new Date().toISOString(),
    seconds: Math.round((Date.now() - started) / 1000),
    attacker: CODE,
    victim: VICTIM,
    passes: [...PASSES],
    requests: sent.length,
    skipped: results.length - sent.length,
    byPass: Object.fromEntries([...new Set(sent.map((r) => r.pass))].map((p) => [p, tally(sent.filter((r) => r.pass === p), (r) => r.status)])),
    serverErrors: serverErrors.length,
    serverErrorsInOtherGroups: serverErrors.filter((r) => !inScope(r)).length,
    nonScalarAccepted: nonScalarAccepted.length,
    nonScalarAcceptedInOtherGroups: nonScalarAccepted.filter((r) => !inScope(r)).length,
    victimTablesChanged: victimChanges.length,
    ...(PASSES.has('replay') ? { replayed: sent.filter((r) => r.pass === 'replay').length, replayDoorRefused: doorRefusedReplays.length } : {}),
    routesFromOtherCompanies: [...fallback].sort(),
    uncoveredBodyFields: uncovered.length,
    uncoveredFigureFields: figureUncovered.length,
    unboundQueryRoutes: queryUnbound.length,
  };
  const outDir = path.join(WORK, 'results', 'isolation');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${NAME}.json`), JSON.stringify({ summary, serverErrors, nonScalarAccepted, victimChanges, uncovered, figureUncovered, queryUnbound, results }, null, 1));

  print(JSON.stringify(summary, null, 1));
  if (uncovered.length) print(`\nbody date fields on routes with no accepted request of company ${CODE} (not sent): ${uncovered.length}\n  ${uncovered.slice(0, 80).join('\n  ')}`);
  if (figureUncovered.length) print(`\nfigure fields on routes with no accepted request of company ${CODE} (not sent): ${figureUncovered.length}`);
  if (queryUnbound.length) print(`\nGET routes with a date parameter not bound to a path (not sent): ${queryUnbound.join(' | ')}`);
  if (serverErrors.length) {
    print('\n5xx:');
    for (const r of serverErrors) print(`  [${r.pass}] ${r.key} [${r.field}] ${r.shape} -> ${r.status}: ${r.error} @ ${r.at}${r.otherGroup ? '  [other group]' : ''}`);
  }
  if (nonScalarAccepted.length) {
    print('\nnon-scalar figures accepted (2xx):');
    for (const r of nonScalarAccepted) print(`  ${r.key} [${r.field}] ${r.shape} -> ${r.status}${r.otherGroup ? '  [other group]' : ''}`);
  }
  if (victimChanges.length) print(`\nvictim data changed: ${victimChanges.map((c) => `${c.org}:${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', ')}`);
  if (doorRefusedReplays.length) {
    print('\ncaptured accepted requests the door now refuses (replay):');
    for (const r of doorRefusedReplays) print(`  ${r.key} [${r.field}] -> ${r.status} ${r.code}${r.otherGroup ? '  [other group]' : ''}`);
  }
  const failing = serverErrors.length || nonScalarAccepted.filter(inScope).length || victimChanges.length || doorRefusedReplays.filter(inScope).length;
  print(`\ndate sweep: ${sent.length} requests, ${serverErrors.length} 5xx, ${nonScalarAccepted.length} non-scalar figures accepted (${nonScalarAccepted.filter((r) => !inScope(r)).length} in other groups' routes), ${results.length - sent.length} skipped`);
  process.exitCode = failing ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
