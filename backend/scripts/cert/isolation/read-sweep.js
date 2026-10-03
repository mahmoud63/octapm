'use strict';

/**
 * The cross-company read sweep: every GET route of the application, bound to
 * each victim company's real identifiers, asked first by the victim's own
 * administrator (it must answer) and then by outsiders (it must not).
 *
 * Bindings are worked out, not hand-listed. For a route such as
 * /projects/{projectId}/rfi/{rfiId}/thread the sweep needs a project of the
 * victim and an RFI in that project. A parameter is matched to a record type
 * by its name (rfiId → rfi), by the path segment before it (…/rfi/{id}), and
 * by what the corpus saw created under that path; the candidates are tried as
 * the owner, and the first that answers 2xx is the binding. A route no
 * candidate satisfies is reported as UNBOUND — never silently skipped.
 *
 * Also tried, on routes that take no identifier in the path: the victim's
 * project id and canary text as query parameters (projectId=, q=, search=).
 *
 * Verdicts on each outsider answer:
 *   REFUSED             401, 403, 404 — the access rule
 *   LEAK                the victim's identifiers or canary text, the owner's own
 *                       informative answer, or the owner's distinctive figures
 *   FILTERED            2xx, byte-identical to the answer for a random id in the
 *                       victim's place: the caller's company filter, no data, no
 *                       existence oracle
 *   ANSWERED            any other 2xx on a route bound to the victim's record —
 *                       counted as a cross-company read until triaged
 *   REFUSED_VALIDATION  400, listed for triage; REFUSED_LATE other 4xx and
 *                       SERVER_ERROR 5xx are findings
 *   NO_VICTIM_DATA      2xx to a query-parameter probe, holding nothing of the victim's
 *
 *   node scripts/cert/isolation/read-sweep.js --name=reads1
 *   node scripts/cert/isolation/read-sweep.js --name=t --victims=022,023
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const fs = require('fs');
const { as, raw, pool } = require('../lib/api');
const { canaryDisclosed, controlRoute, sameAnswer } = require('./judging');
const { buildMatcher } = require('../lib/routes');
const { buildPopulation } = require('../lib/spec');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const arg = (name, fallback = null) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const NAME = arg('name', 'reads');
const VICTIMS = arg('victims')?.split(',') || null;
const CONCURRENCY = Number(arg('concurrency', 10));
const TRIES = Number(arg('tries', 4));
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Routes that are not a company's data, or that must not be called by a sweep. */
const SKIP = [/^\/auth\//, /^\/public\//, /^\/openapi\.json$/, /^\/config\//, /^\/webhooks\//, /\/sso\//, /^\/docs/];

/** Path segment or parameter name → record types it may mean, beyond the obvious. */
const ALIASES = {
  ncr: ['ncr_record'], itp: ['itp_record'], 'pay-apps': ['sub_pay_app'], payapp: ['sub_pay_app'], 'purchase-orders': ['procurement_order'], po: ['procurement_order'],
  order: ['procurement_order'], drawings: ['drawing_record', 'drawing_sheet', 'drawing_set'], sets: ['drawing_set'], sheets: ['drawing_sheet'], revisions: ['drawing_revision', 'document_revision', 'schedule_revision', 'boq_revision', 'budget_revision'],
  ipc: ['ipc_certificate'], items: ['boq_item', 'ipc_item', 'inventory_item'], lines: ['budget_line', 'commitment_sov_line', 'direct_cost_line', 'bid_package_line'], team: ['project_assignment', 'user'],
  users: ['user'], user: ['user'], member: ['user'], documents: ['project_document', 'attachment'], doc: ['project_document'], uploads: ['project_document', 'workflow_attachment'],
  punch: ['punch_item'], forms: ['form', 'form_instance', 'inspection'], templates: ['form_template', 'permission_template', 'workflow_template', 'project_template'], bids: ['bid_package', 'bid'], bid: ['bid_package', 'bid'],
  commitments: ['commitment'], risks: ['risk'], meetings: ['meeting'], tasks: ['task'], photos: ['photo'], locations: ['location'], parties: ['project_party'], suppliers: ['procurement_supplier'], packages: ['procurement_package', 'submittal_package'],
  warehouses: ['warehouse'], periods: ['reporting_period'], jobs: ['background_job'], conversations: ['conversation'], notifications: ['notification'], reports: ['report', 'saved_report', 'weekly_report'], timesheets: ['timesheet'], workers: ['worker'],
  'change-events': ['change_event'], 'change-orders': ['change_order'], 'direct-costs': ['direct_cost'], 'daily-logs': ['daily_log'], 'cost-codes': ['cost_code'], companies: ['company'], vendors: ['company'], activities: ['activity'],
  'activity-boq-allocations': ['activity_boq_allocation'], allocation: ['activity_boq_allocation'], submittals: ['submittal'], rfi: ['rfi'], transmittals: ['transmittal'], correspondence: ['correspondence'], webhooks: ['webhook_subscription'], clients: ['api_client'],
  exceptions: ['project_exception'], 'weather-delays': ['weather_delay'], defects: ['defect'], 'material-tests': ['material_test'], safety: ['safety_incident'], equipment: ['equipment'], eot: ['eot_claim'], specifications: ['specification_section', 'specification'],
  lookaheads: ['lookahead'], 'budget-revisions': ['budget_revision'], attachments: ['attachment'], comments: ['comment'], 'custom-fields': ['custom_field_definition'], 'site-diaries': ['site_diary'], 'daily-reports': ['daily_report'], 'weekly-reports': ['weekly_report'],
  'long-lead': ['long_lead_item'], 'sub-valuations': ['sub_valuation'], workflows: ['workflow_instance', 'workflow_template'], subscriptions: ['record_subscription'], invitations: ['invitation_token', 'bid_invitation'], emails: ['inbound_email'], bim: ['bim_model'],
};
const singular = (word) => word.replace(/ies$/, 'y').replace(/ses$/, 's').replace(/s$/, '');
const snake = (word) => word.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/-/g, '_').toLowerCase();

const main = async () => {
  const population = buildPopulation();
  const routes = JSON.parse(fs.readFileSync(path.join(WORK, 'routes.json'), 'utf8')).filter((r) => r.method === 'GET' && !SKIP.some((re) => re.test(r.path)));
  const { index } = JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'id-index.json'), 'utf8'));
  const ownerOf = (id) => index[id.toLowerCase()]?.[0] || null;
  const types = new Set(Object.values(index).map((v) => v[1]));

  // ids by company → type → project → [ids]
  const byCompany = new Map();
  for (const [id, [code, type, project]] of Object.entries(index)) {
    const company = byCompany.get(code) || byCompany.set(code, new Map()).get(code);
    const bucket = company.get(type) || company.set(type, []).get(type);
    bucket.push([id, project || null]);
  }

  // What the corpus saw created under each collection route: "POST template" → ids by company.
  const learned = new Map();
  const corpusDir = path.join(WORK, 'corpus');
  if (fs.existsSync(corpusDir)) {
    const match = buildMatcher(JSON.parse(fs.readFileSync(path.join(WORK, 'routes.json'), 'utf8')));
    for (const file of fs.readdirSync(corpusDir).filter((f) => f.endsWith('.jsonl'))) {
      for (const line of fs.readFileSync(path.join(corpusDir, file), 'utf8').split('\n')) {
        if (!line) continue;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (entry.method !== 'POST' || !entry.id || entry.status >= 300) continue;
        const hit = match('POST', entry.route);
        const code = ownerOf(entry.id) || /@c(\d{3})\./.exec(entry.actor || '')?.[1];
        if (!hit || !code) continue;
        const key = `${code} ${hit.template}`;
        (learned.get(key) || learned.set(key, []).get(key)).push([entry.id, hit.params.projectId || null]);
      }
    }
  }

  const candidateTypes = (template, name, position) => {
    const segments = template.split('/');
    const before = segments[position - 1] || '';
    const out = [];
    const push = (t) => t && types.has(t) && !out.includes(t) && out.push(t);
    const bare = snake(name.replace(/Id$/, ''));
    if (bare !== 'id' && bare !== 'param') {
      push(bare);
      push(`${bare}_record`);
      (ALIASES[bare] || []).forEach(push);
      for (const t of types) if (t.endsWith(`_${bare}`)) push(t);
    }
    push(snake(singular(before)));
    (ALIASES[before] || []).forEach(push);
    for (const t of types) if (t.endsWith(`_${snake(singular(before))}`)) push(t);
    return out;
  };

  /** Concrete paths to try for one template and one victim project, best guess first. */
  const candidatesFor = (template, code, projectId, rng) => {
    const segments = template.split('/');
    let paths = [''];
    for (let i = 1; i < segments.length; i += 1) {
      const param = /^\{(.+)\}$/.exec(segments[i]);
      if (!param) {
        paths = paths.map((p) => `${p}/${segments[i]}`);
        continue;
      }
      const name = param[1];
      let values = [];
      if (name === 'projectId' || (name === 'id' && segments[i - 1] === 'projects')) values = projectId ? [projectId] : [];
      else if (name === 'orgId' || name === 'organisationId') values = [population.companies.find((c) => c.code === code).id];
      else if (name === 'date') values = ['2026-09-28', '2026-09-30', '2026-10-01'];
      else if (name === 'period') values = ['2026-09', '2026-10', '2027-03'];
      else {
        const collection = segments.slice(0, i).join('/');
        const fromCorpus = (learned.get(`${code} ${collection}`) || []).filter(([, project]) => !projectId || !project || project === projectId).map(([id]) => id);
        const company = byCompany.get(code) || new Map();
        const fromIndex = candidateTypes(template, name, i).flatMap((type) => {
          const rows = company.get(type) || [];
          const inProject = rows.filter(([, project]) => project === projectId).map(([id]) => id);
          const elsewhere = rows.filter(([, project]) => project !== projectId).map(([id]) => id);
          return [...inProject.slice(0, 2), ...elsewhere.slice(0, 1)];
        });
        values = [...new Set([...fromCorpus.slice(-2), ...fromIndex])].slice(0, TRIES);
      }
      if (!values.length) return [];
      paths = paths.flatMap((p) => values.map((v) => `${p}/${v}`)).slice(0, TRIES * 2);
      void rng;
    }
    return paths;
  };

  const victims = population.companies.filter((c) => !VICTIMS || VICTIMS.includes(c.code));
  const results = [];
  const unbound = new Map();
  let done = 0;

  await pool(victims, CONCURRENCY, async (victim) => {
    const owner = as(`pm@${victim.domain}`);
    const next = population.companies[victim.n % population.companies.length];
    const outsider = as(`pm@${next.domain}`);
    const multi = population.multi.find((m) => m.memberships.some((ms) => ms.code === victim.code));
    const elsewhere = multi?.memberships.find((ms) => ms.code !== victim.code);
    const memberElsewhere = multi && elsewhere ? as(multi.email, elsewhere.orgId) : null;
    const company = byCompany.get(victim.code) || new Map();
    // The victim's richest project: the one with the most rows naming it.
    const weight = new Map();
    for (const rows of company.values()) for (const [, project] of rows) if (project) weight.set(project, (weight.get(project) || 0) + 1);
    const projectId = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const canary = `CANARY-${victim.code}-`;
    // The victim's canaries continue after the company code (CANARY-022-P01-…); the bare prefix is what the sweep itself sends and a search echoes back.
    const victimCanary = new RegExp(`CANARY-${victim.code}-[A-Za-z0-9]`);

    // Figures leak without identifiers: a body that repeats the owner's
    // distinctive numbers (five or more digits, or three or more decimals) is
    // the victim's data even with no id or canary in it.
    const NUMBER = /-?\d+(?:\.\d+)?/g;
    const distinctive = (text) => new Set((String(text).replace(UUID, ' ').match(NUMBER) || []).filter((n) => n.replace(/[-.]/g, '').replace(/^0+/, '').length >= 5 || /\.\d{3,}$/.test(n)));
    const judge = (res, sentPath, { ownerText = null, query = false } = {}) => {
      const text = res.text ?? '';
      const sent = new Set((sentPath.match(UUID) || []).map((id) => id.toLowerCase()));
      const disclosed = [...new Set((text.match(UUID) || []).filter((id) => ownerOf(id) === victim.code && !sent.has(id.toLowerCase())))];
      const canaryShown = victimCanary.test(text) && canaryDisclosed(text, sentPath, victim.code);
      if (canaryShown || disclosed.length) return { verdict: 'LEAK', evidence: { canary: canaryShown, ids: disclosed.slice(0, 5).map((id) => `${id} (${index[id.toLowerCase()][1]})`) } };
      if (res.status >= 500) return { verdict: 'SERVER_ERROR' };
      if ([401, 403, 404].includes(res.status)) return { verdict: 'REFUSED' };
      if (res.status === 400) return { verdict: 'REFUSED_VALIDATION' };
      if (res.status >= 400) return { verdict: 'REFUSED_LATE' };
      if (ownerText && text.length > 20 && text === ownerText) return { verdict: 'LEAK', evidence: { identicalToOwner: true } };
      if (ownerText) {
        const sentFigures = distinctive(sentPath);
        const answerFigures = distinctive(text);
        const shared = [...distinctive(ownerText)].filter((n) => !sentFigures.has(n) && answerFigures.has(n));
        if (shared.length) return { verdict: 'LEAK', evidence: { ownerFigures: shared.slice(0, 5) } };
      }
      // A route bound to the victim's record answered at all: the access rule did not refuse.
      return { verdict: query ? 'NO_VICTIM_DATA' : 'ANSWERED' };
    };
    const attack = async (kind, session, route, template, ownerText = null) => {
      let res;
      try {
        res = session ? await session.send('GET', route) : await raw('GET', route);
      } catch (error) {
        res = { status: 0, text: String(error.message) };
      }
      let judged = res.status === 0 ? { verdict: 'NOT_SENT' } : judge(res, route, { ownerText, query: kind === 'outsider-query' });
      // The random-id control (judging.js): the same answer for a random id in
      // the victim's place means the caller's own company filter answered.
      if (judged.verdict === 'ANSWERED' || (judged.verdict === 'LEAK' && judged.evidence?.identicalToOwner)) {
        const victimIds = [...new Set((route.match(UUID) || []).filter((id) => ownerOf(id) === victim.code))];
        if (victimIds.length) {
          const control = controlRoute(route, victimIds);
          const other = await (session ? session.send('GET', control.route) : raw('GET', control.route)).catch(() => null);
          if (sameAnswer(res, other, control.swaps)) judged = { verdict: 'FILTERED', evidence: { sameAsRandomId: true } };
        }
      }
      results.push({ victim: victim.code, attacker: kind, template, route, status: res.status, code: res.body?.error?.code || null, ...judged, ...(judged.verdict === 'REFUSED' ? {} : { sample: String(res.text ?? '').slice(0, 240) }) });
    };

    for (const route of routes) {
      const hasParam = route.path.includes('{');
      if (hasParam) {
        const candidates = candidatesFor(route.path, victim.code, projectId);
        let bound = null;
        let ownerText = null;
        let lastStatus = null;
        for (const candidate of candidates) {
          const res = await owner.send('GET', candidate).catch((error) => ({ status: 0, text: String(error.message) }));
          lastStatus = res.status;
          if (res.status >= 200 && res.status < 300) {
            bound = candidate;
            ownerText = res.text ?? null;
            break;
          }
        }
        if (!bound) {
          const entry = unbound.get(route.path) || unbound.set(route.path, { tried: 0, companies: 0, statuses: {} }).get(route.path);
          entry.companies += 1;
          entry.tried += candidates.length;
          entry.statuses[lastStatus ?? 'no-candidate'] = (entry.statuses[lastStatus ?? 'no-candidate'] || 0) + 1;
          continue;
        }
        results.push({ victim: victim.code, attacker: 'owner', template: route.path, route: bound, status: 200, verdict: 'OWNER_OK' });
        await attack('outsider', outsider, bound, route.path, ownerText);
        if (memberElsewhere) await attack('member-elsewhere', memberElsewhere, bound, route.path, ownerText);
        await attack('anonymous', null, bound, route.path, ownerText);
      } else if (projectId) {
        // No identifier in the path: name the victim's project and canary in the query instead.
        for (const query of [`projectId=${projectId}`, `q=${encodeURIComponent(canary)}`, `search=${encodeURIComponent(canary)}`]) {
          await attack('outsider-query', outsider, `${route.path}?${query}`, route.path);
        }
      }
    }
    done += 1;
    if (done % 10 === 0) console.log(`  ${done}/${victims.length} victims`);
  });

  const tally = (items, key) => items.reduce((acc, item) => ({ ...acc, [key(item)]: (acc[key(item)] || 0) + 1 }), {});
  const attacks = results.filter((r) => r.attacker !== 'owner');
  const boundTemplates = new Set(results.filter((r) => r.attacker === 'owner').map((r) => r.template));
  const neverBound = [...unbound.entries()].filter(([template]) => !boundTemplates.has(template));
  const summary = {
    name: NAME,
    at: new Date().toISOString(),
    victims: victims.length,
    getRoutes: routes.length,
    routesWithIdentifier: routes.filter((r) => r.path.includes('{')).length,
    routesBoundSomewhere: boundTemplates.size,
    routesNeverBound: neverBound.length,
    ownerReads: results.length - attacks.length,
    attacks: attacks.length,
    byVerdict: tally(attacks, (r) => r.verdict),
    byAttacker: tally(attacks, (r) => `${r.attacker}/${r.verdict}`),
  };
  const outDir = path.join(WORK, 'results', 'isolation');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${NAME}.json`), JSON.stringify({ summary, neverBound: Object.fromEntries(neverBound), results }));
  console.log(JSON.stringify(summary, null, 1));
  // ANSWERED (a victim-bound route that did not refuse) and REFUSED_LATE count
  // against "cross-company reads = 0" until each is triaged; REFUSED_VALIDATION
  // is listed for triage and never counted as a pass.
  const concerning = attacks.filter((r) => ['LEAK', 'SERVER_ERROR', 'REFUSED_LATE', 'ANSWERED'].includes(r.verdict));
  for (const [kind, n] of Object.entries(tally(concerning, (r) => `${r.verdict} ${r.attacker} ${r.template} -> ${r.status} ${r.code || ''}`)).sort((a, b) => b[1] - a[1]).slice(0, 80)) console.log(`  ${n}×  ${kind}`);
  const triage = attacks.filter((r) => r.verdict === 'REFUSED_VALIDATION');
  if (triage.length) {
    console.log(`\nREFUSED_VALIDATION to triage (${triage.length}):`);
    for (const [kind, n] of Object.entries(tally(triage, (r) => `${r.attacker} ${r.template} -> 400 ${r.code || ''}`)).sort((a, b) => b[1] - a[1])) console.log(`  ${n}×  ${kind}`);
  }
  process.exitCode = concerning.length ? 2 : 0;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
