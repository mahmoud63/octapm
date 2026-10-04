'use strict';

/**
 * The wrongly-shaped query-parameter sweep (CERT-2): no GET route may answer a
 * 5xx whatever shape a query parameter has, and a query parameter carrying
 * another company's identifier must be answered exactly as one carrying an
 * identifier that exists nowhere.
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/query-shape-sweep.js
 *   CERT_INPROCESS=1 node scripts/cert/isolation/query-shape-sweep.js --only="rfi|forms" --name=query-shape-sweep-subset
 *
 * express-validator's query("x").isUUID() (and .isIn / .isInt / .isISO8601 /
 * .matches) accepts an ARRAY element by element: ?x=a&x=b arrives as ["a","b"]
 * and every element is validated, so the chain passes and the array reaches a
 * Prisma `where` as a value Prisma cannot bind — a 500, an input-shape failure
 * that is the same across companies but still a broken request. A route that
 * reads a req.query id with no validator at all has the same fault. The fix is
 * query("x").isString() before any format check (or an optionalIdQuery-style
 * helper). This sweep sends every GET route's query parameters wrongly shaped
 * and judges the answers.
 *
 * The corpus of valid GET requests: the read sweep's bound owner requests
 * (<work>/results/isolation/cert2b-reads.json — results with attacker "owner"
 * carry `route`, a concrete path that answered 2xx for its company). One
 * request per (template, company) is taken, company 073's preferred. For each
 * the sweep finds the parameters the route reads — the route's own
 * express-validator query() fields (read from the mounted router's validator
 * contexts) plus a generic id-ish probe set — and resends the request with
 * each parameter, one at a time, in these shapes:
 *
 *   ?x=foreign                 the victim company's identifier of a kind
 *   ?x=nowhere                 an identifier that exists nowhere
 *   ?x=a&x=b                   sent twice (an array)
 *   ?x[]=a                     an explicit array
 *   ?x[k]=v                    an object
 *
 * Each answer is judged:
 *   SERVER_ERROR  5xx — a finding
 *   LEAK          the answer carries the victim's canary text, address,
 *                 company name or another of its identifiers — a finding
 *   REFUSED       400/401/403/404/422
 *   ACCEPTED      2xx (a filter the route ignores or applies within the
 *                 caller's company — not a finding on its own)
 *   OTHER_4XX     405/413/429 …
 *
 * The oracle pairs: for each (route, parameter) the ?x=foreign and ?x=nowhere
 * answers must be identical (status, code). A mismatch is a finding.
 *
 * Results: <work>/results/isolation/<name>.json. The last line is
 *   query shape sweep: N requests, X 5xx, Y oracle pairs
 * where Y is the number of oracle pairs that DIFFER. Exit code 0 only when
 * X and Y are both 0 and no answer leaks.
 *
 * Read-only on the database (one connection, read-only); every request goes
 * through the API as company 073's own PM.
 */

const path = require('path');
const fs = require('fs');
const { as, pool } = require('../lib/api');
const guard = require('../lib/cert-env');
const { buildMatcher } = require('../lib/routes');
const { buildIndex } = require('./index-ids');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const arg = (name, fallback = null) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const NAME = arg('name', 'query-shape-sweep');
const PREFERRED = arg('attacker', '073');
const VICTIM = arg('victim', '074');
const READS = arg('reads', 'cert2b-reads');
const ONLY = arg('only') ? new RegExp(arg('only')) : null;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const NOWHERE = '00000000-0000-4000-8000-00000000d1ed';

// Parameters many routes read as ids/filters, probed on every route on top of
// its own validator fields — this is what catches a route that reads a
// req.query id with no validator for it (nothing to read a field name from).
const GENERIC = ['projectId', 'activityId', 'boqItemId', 'locationId', 'sheetId', 'recordId', 'recordType', 'cursor', 'id', 'status', 'type', 'q', 'search', 'limit', 'from', 'to', 'assigneeUserId', 'assigneeCompanyId', 'supplierId', 'vendorCompanyId', 'costCodeId', 'budgetLineId', 'submissionId', 'periodId', 'itemId', 'warehouseId', 'ballInCourtUserId', 'order', 'sortBy', 'sortDir', 'includeArchived'];

const SHAPES = [
  ['=foreign', (name, foreign) => `${name}=${foreign}`],
  ['=nowhere', (name) => `${name}=${NOWHERE}`],
  ['=a&=b', (name, foreign) => `${name}=${foreign}&${name}=${NOWHERE}`],
  ['[]=a', (name, foreign) => `${encodeURIComponent(`${name}[]`)}=${foreign}`],
  ['[k]=v', (name, foreign) => `${encodeURIComponent(`${name}[k]`)}=${foreign}`],
];

const verdictOf = (res) => {
  if (res.status === 0) return 'NOT_SENT';
  if (res.status >= 500) return 'SERVER_ERROR';
  if ([400, 401, 403, 404, 422].includes(res.status)) return 'REFUSED';
  if (res.status >= 400) return 'OTHER_4XX';
  return 'ACCEPTED';
};

/** Query-parameter field names each GET route validates, by concrete template, read from the mounted router. */
const queryFieldsByTemplate = () => {
  // eslint-disable-next-line global-require
  const { createApp } = require('../../../src/app');
  const app = createApp();
  const out = new Map(); // "METHOD /template" -> Set(field)
  const normalise = (value) => value.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  const mountPath = (layer) => {
    let source = layer.regexp.source;
    if (source === '^\\/?(?=\\/|$)') return '';
    source = source.replace(/^\^/, '').replace(/\\\/\?\(\?=\\\/\|\$\)$/, '').replace(/\(\?=\\\/\|\$\)$/, '').replace(/\\\/\?\$$/, '').replace(/\\\//g, '/');
    let k = 0;
    return source.replace(/\(\?:\/\(\[\^\/\]\+\?\)\)/g, () => `/{${layer.keys[k++]?.name || 'param'}}`).replace(/\(\[\^\/\]\+\?\)/g, () => `{${layer.keys[k++]?.name || 'param'}}`).replace(/\\\./g, '.').replace(/\^/g, '').replace(/\$/g, '').replace(/\?/g, '');
  };
  const walk = (stack, prefix = '') => {
    for (const layer of stack) {
      if (layer.route) {
        const fields = new Set();
        for (const h of layer.route.stack) {
          const ctx = h.handle?.context;
          if (ctx && Array.isArray(ctx.fields) && Array.isArray(ctx.locations) && ctx.locations.includes('query')) {
            for (const f of ctx.fields) fields.add(String(f).replace(/\.\*$/, '').replace(/\[.*$/, ''));
          }
        }
        if (fields.size) {
          for (const one of Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path]) {
            const full = normalise(`${prefix}${one}`);
            if (!full.startsWith('/api/v1')) continue;
            const relative = full.replace('/api/v1', '') || '/';
            for (const method of Object.keys(layer.route.methods)) {
              if (method === '_all') continue;
              const key = `${method.toUpperCase()} ${relative}`;
              out.set(key, new Set([...(out.get(key) || []), ...fields]));
            }
          }
        }
        continue;
      }
      if (layer.name === 'router' && layer.handle?.stack) walk(layer.handle.stack, normalise(`${prefix}${mountPath(layer)}`));
    }
  };
  walk(app._router.stack);
  return out;
};

const main = async () => {
  const started = Date.now();
  const reads = JSON.parse(fs.readFileSync(path.join(WORK, 'results', 'isolation', `${READS}.json`), 'utf8'));
  const routes = JSON.parse(fs.readFileSync(path.join(WORK, 'routes.json'), 'utf8'));
  const match = buildMatcher(routes);
  const fieldsBy = queryFieldsByTemplate();

  const db = await guard.connectCert();
  const readOnly = async (fn) => {
    await db.query('begin transaction isolation level repeatable read read only');
    try {
      return await fn();
    } finally {
      await db.query('rollback');
    }
  };
  const built = await readOnly(() => buildIndex(db));
  const ownerOf = (id) => built.index[String(id).toLowerCase()] || null;

  // A victim identifier of each kind, to send as the "foreign" value.
  const victimByType = new Map();
  for (const [id, meta] of Object.entries(built.index)) if (meta[0] === VICTIM && !victimByType.has(meta[1])) victimByType.set(meta[1], id);
  const victimIds = new Map(Object.entries(built.index).filter(([, meta]) => meta[0] === VICTIM));
  const foreignFor = (name) => {
    const lname = name.toLowerCase();
    // A project id, an activity id, a boq id … matched to a victim record of that kind, else any victim id.
    const want = lname.includes('project') ? 'project' : lname.includes('activity') ? 'activity' : lname.includes('boq') ? 'boq_item' : lname.includes('location') ? 'location' : lname.includes('sheet') ? 'sheet' : lname.includes('company') || lname.includes('supplier') || lname.includes('vendor') ? 'company' : lname.includes('user') || lname.includes('assignee') || lname.includes('manager') || lname.includes('approver') ? 'user' : lname.includes('costcode') ? 'cost_code' : null;
    return (want && victimByType.get(want)) || victimByType.get('project') || [...victimIds.keys()][0];
  };

  // One bound owner GET per template, company PREFERRED first.
  const chosen = new Map(); // template -> { route, template }
  const owners = reads.results.filter((r) => r.attacker === 'owner' && r.route && r.template && r.template.includes('{'));
  for (const pref of [true, false]) {
    for (const r of owners) {
      if (chosen.has(r.template)) continue;
      if (pref && r.victim !== PREFERRED) continue;
      if (ONLY && !ONLY.test(`GET ${r.template}`)) continue;
      chosen.set(r.template, { route: r.route, template: r.template, company: r.victim });
    }
  }
  console.log(`bound GET routes to probe: ${chosen.size} (preferred company ${PREFERRED}); victim ${VICTIM}; ${built.coverage ? Object.keys(built.index).length : 0} ids indexed`);

  const base = (route) => route.split('?')[0];
  const session = as(`pm@c${PREFERRED}.octapm-cert.test`);

  // The victim ids already present in the attacker's OWN plain response for a
  // route (its own records' free-text may hold a string equal to a victim id —
  // e.g. a bid package's boqSections residue from an earlier proof). Such an id
  // is the attacker's own stored data, disclosed whatever is injected (it shows
  // even for ?x=nowhere), so it is subtracted from the per-request disclosure:
  // only an id that appears BECAUSE a foreign value was injected is a leak.
  const CONCURRENCY = Number(arg('concurrency', 6));
  const baseline = new Map(); // template -> Set(victim id lowercased)
  await pool([...chosen.values()], CONCURRENCY, async ({ route, template }) => {
    let text = '';
    try {
      text = (await session.send('GET', base(route))).text ?? '';
    } catch {
      text = '';
    }
    baseline.set(template, new Set((text.match(UUID) || []).map((id) => id.toLowerCase()).filter((id) => victimIds.has(id))));
  });
  const baselineTotal = [...baseline.values()].reduce((n, s) => n + s.size, 0);
  console.log(`owner-baseline victim-id residue in own records: ${baselineTotal} across ${[...baseline.values()].filter((s) => s.size).length} route(s)`);

  // One flat job per (route, parameter, shape), run `concurrency` at a time.
  const jobs = [];
  for (const { route, template } of chosen.values()) {
    const validated = [...(fieldsBy.get(`GET ${template}`) || [])];
    const params = [...new Set([...validated, ...GENERIC])];
    for (const name of params) {
      const foreign = foreignFor(name);
      for (const [shape, make] of SHAPES) {
        jobs.push({ template, name, validated: validated.includes(name), shape, foreign, path: `${base(route)}?${make(name, foreign)}` });
      }
    }
  }
  console.log(`requests to send: ${jobs.length}`);

  let done = 0;
  const results = await pool(jobs, CONCURRENCY, async (job) => {
    let res;
    try {
      res = await session.send('GET', job.path);
    } catch (error) {
      res = { status: 0, text: String(error.message || error), body: null };
    }
    done += 1;
    if (done % 4000 === 0) console.log(`  ${done}/${jobs.length}`);
    const text = res.text ?? '';
    const canary = new RegExp(`CANARY-${VICTIM}-[A-Za-z0-9]`).test(text);
    const address = new RegExp(`@c${VICTIM}\\.octapm-cert\\.test`).test(text);
    const companyName = text.includes(`(CERT-${VICTIM})`);
    const residue = baseline.get(job.template) || new Set();
    const disclosed = [...new Set((text.match(UUID) || []).map((id) => id.toLowerCase()).filter((id) => victimIds.has(id) && id !== String(job.foreign).toLowerCase() && !residue.has(id)))];
    let verdict = verdictOf(res);
    if (verdict !== 'NOT_SENT' && (canary || address || companyName || disclosed.length)) verdict = 'LEAK';
    const msg = String(res.body?.error?.message || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return {
      template: job.template, route: job.path, param: job.name, validated: job.validated, shape: job.shape,
      status: res.status, code: res.body?.error?.code || null, verdict,
      ...(verdict === 'SERVER_ERROR' ? { error: msg.find((l) => /invocation|Argument|Error|Unknown|Invalid|must|expected|P\d{4}/i.test(l))?.slice(0, 200) || msg[0]?.slice(0, 200) || text.slice(0, 200), at: (msg.find((l) => /\.js:\d+/.test(l)) || '').replace(/^.*[\\/](src[\\/])/, '$1').slice(0, 140) } : {}),
      ...(verdict === 'LEAK' ? { evidence: { canary, address, companyName, ids: disclosed.slice(0, 5) } } : {}),
    };
  });
  await db.end();

  // Oracle pairs: per (route-template, param) the =foreign and =nowhere answers.
  const pairs = new Map();
  for (const r of results) {
    if (r.shape !== '=foreign' && r.shape !== '=nowhere') continue;
    const key = `${r.template}\u0000${r.param}`;
    const entry = pairs.get(key) || pairs.set(key, { template: r.template, param: r.param }).get(key);
    entry[r.shape === '=foreign' ? 'foreign' : 'nowhere'] = `${r.status} ${r.code || ''}`.trim();
  }
  const differing = [...pairs.values()].filter((p) => p.foreign !== undefined && p.nowhere !== undefined && p.foreign !== p.nowhere);

  const serverErrors = results.filter((r) => r.verdict === 'SERVER_ERROR');
  const leaks = results.filter((r) => r.verdict === 'LEAK');
  const tally = (items, k) => items.reduce((acc, item) => ({ ...acc, [k(item)]: (acc[k(item)] || 0) + 1 }), {});
  const summary = {
    name: NAME, at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000),
    reads: READS, routes: chosen.size, requests: results.length,
    byVerdict: tally(results, (r) => r.verdict),
    serverErrors: serverErrors.length, leaks: leaks.length,
    oraclePairs: pairs.size, oraclePairsDiffering: differing.length,
  };
  const outDir = path.join(WORK, 'results', 'isolation');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${NAME}.json`), JSON.stringify({ summary, serverErrors, leaks, differing, results }, null, 1));

  console.log(JSON.stringify(summary, null, 1));
  if (serverErrors.length) {
    console.log('\n5xx (template [param] shape -> status: error @ where):');
    for (const r of serverErrors.slice(0, 60)) console.log(`  GET ${r.template} [${r.param}] ${r.shape} -> ${r.status}: ${r.error} @ ${r.at}`);
  }
  if (leaks.length) {
    console.log('\nleaks:');
    for (const r of leaks.slice(0, 40)) console.log(`  GET ${r.template} [${r.param}] ${r.shape} -> ${r.status} ${JSON.stringify(r.evidence)}`);
  }
  if (differing.length) {
    console.log('\noracle pairs that differ (foreign vs nowhere):');
    for (const p of differing.slice(0, 60)) console.log(`  GET ${p.template} [${p.param}] foreign=${p.foreign} nowhere=${p.nowhere}`);
  }
  console.log(`\nquery shape sweep: ${results.length} requests, ${serverErrors.length} 5xx, ${differing.length} oracle pairs`);
  process.exitCode = serverErrors.length || leaks.length || differing.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
