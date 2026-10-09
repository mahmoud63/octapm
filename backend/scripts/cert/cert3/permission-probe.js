'use strict';

/**
 * CERT-3 WP-0: the permission probe (plan §4 WP-0 "Permission probe matrix";
 * exit criterion E8). The matrix, and the expected allow / deny computed from
 * shared/permissions.json, are in ./permission-matrix.js. The integration
 * owner's decisions applied here: C:\Temp\octapm-cert\scratch\wp0\adjudication.md
 * section B.
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/permission-probe.js [D1=087] [D2=052]
 *
 * Built on ./lib/harness.js (the CERT-3 harness rules): a fixed list of checks
 * computed when this module loads (from spec.js PERSONAS, the two company
 * codes and permissions.json), before any request; check() is the only
 * verdict; answers are said()/is() strings ('403 FORBIDDEN'); every answer is
 * kept for the harness's own 5xx sweep (G.5xx); exit 0 = every check holds,
 * 2 = a check failed (a finding, or a registered suspect present),
 * 1 = setup error (1 wins over 2). Result:
 * C:\Temp\octapm-cert\results\cert3\permission-probe.json.
 *
 * In process only (CERT_INPROCESS=1, set by run-locked.js, as the D-ID-1
 * proofs run): ../lib/api.js sends every request to the product's Express
 * application loaded in this process from the working tree, on the
 * certification database (the marker row is verified, S0.database). The HTTP
 * limiter state is therefore this process's: the probe installs a
 * process-local memory store as the application's shared rate-limit store
 * (src/config/rate-limit-store createMemoryStore, through
 * src/middleware/rate-limit setSharedRateLimitStore) before the first
 * request, never touching the shared Postgres or Redis counters of the
 * certification API, and empties it (resetRateLimitStores) before every
 * persona's run. A 429 is answered by one more reset and one retry, never by
 * waiting. One writer at a time on the certification database: the lock
 * runner only.
 *
 * What it does
 *   Setup (each step a { setup } check; a failure stops the run, exit 1)
 *     S0.matrix    the matrix is consistent with permissions.json.
 *     S0.limiter   the process-local limiter store is installed and resets.
 *     S0.database  the certification database (marker row) is the one used.
 *     S0.spec      D1 has the nine personas with the roles of permissions.json,
 *                  the PM persona its only administrator among them; D2's
 *                  finance persona is a company administrator, its QS is not.
 *     S0.signin    every persona signs in to its company by explicit id (the
 *                  spec's org id, never "the first membership"); the session's
 *                  user id, organisation, role and administration match spec.
 *     S0.project   three throwaway projects, kept in
 *                  C:\Temp\octapm-cert\state\cert3\permission-probe.json and
 *                  reused on a later run when the PM still reads them under
 *                  their CERT3-PERM- name:
 *                    P1  CERT3-PERM-<stamp>-<D1>-P1   every D1 persona on it
 *                    P1U CERT3-PERM-<stamp>-<D1>-P1U  nobody added
 *                    P2  CERT3-PERM-<stamp>-<D2>-P2   nobody added
 *     S0.team      the eight non-PM personas of D1 added to P1 by the PM.
 *     S0.effective GET /auth/me/permissions?projectId=P1 per persona: no
 *                  template (setup), and the product's own module matrix equal
 *                  to the one computed here from permissions.json (a check).
 *   Probes
 *     P1.<D1>.<persona>.guard / .answers  every matrix entry (except scenario
 *                  mode) as each of the nine D1 personas on P1 (company-level
 *                  entries in D1). Refused by the JSON: exactly 403 FORBIDDEN
 *                  and, for a permission guard, error.details {module, action,
 *                  transition} equal to the entry's DECLARED key (a DELETE
 *                  guarded by update is compared under its declared key, HR-A2).
 *                  Allowed: the entry's own allowed answer. A role the JSON
 *                  allows that is refused, or any 5xx, fails .guard (exit 2);
 *                  an allowed role that passes the guard but gets another
 *                  answer fails .answers (a probe defect, exit 1).
 *                  Routes guarded by requireRoles are held to the JSON natural
 *                  key (adjudication §B).
 *     SUS.boq-read-narrowing  registered suspect (proposed P3): GET
 *                  /boq/template and GET /boq/uploads/:documentId are guarded
 *                  by requireRoles(pm, planning_eng, qs) while JSON boq:read
 *                  allows all nine roles. The roles the JSON allows and the
 *                  route omits are judged here, not in .guard; a 403 there is
 *                  the suspect present (exit 2).
 *     S1..S6       the real-record scenarios of permission-matrix SCENARIOS.
 *                  S5 is the registered suspect (proposed P2): stock received
 *                  for a project the person cannot open must be refused by
 *                  the project-access rule (403 PROJECT_ACCESS_DENIED or 404
 *                  PROJECT_NOT_FOUND; 403 FORBIDDEN and an item or warehouse
 *                  *_NOT_FOUND do not count); a 2xx is the suspect present
 *                  (exit 2).
 *     S7           D2: the finance company administrator (not assigned to P2)
 *                  runs the whole matrix on P2 with the expectation "finance +
 *                  user_management + project_parties"; the product's own
 *                  module matrix must show no JSON module right beyond those
 *                  two (the reworded assumption).
 *   Recorded, never failed (observations in the result file)
 *     HR-A1        company administration grants outside the JSON: org-wide
 *                  project visibility (S7), the requireCompanyAdmin /company
 *                  and team routes (every admin persona's matrix run), report
 *                  management (S6 in D2); moderation and Gantt layouts are not
 *                  probed here (listed from the code). The PM hard-coded
 *                  overrides (reporting-period override measured in S3, IPC
 *                  over-certification, commitment execute) are folded in.
 *     HR-A2        DELETE guarded by an update/submit key: the declared key is
 *                  compared; the natural delete row and the answers recorded.
 *
 * Throwaway records are all named CERT3-PERM-<stamp>-* so the read-backs can
 * exclude them: the three projects, the S1 activities, the S3 reporting
 * period, the S5 item, warehouse and stock receipt, the S6 reports. Ghost,
 * invalid, badParam, badQuery and read probes write nothing; effect probes
 * recompute on the throwaway project only.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const harness = require('./lib/harness');

const RUN_AS_MAIN = require.main === module;
// Harness rule 7: the environment before anything under backend/src is loaded.
if (RUN_AS_MAIN) harness.prepareInProcess();

const api = require('../lib/api');
const { buildPopulation, PERSONAS } = require('../lib/spec');
const matrix = require('./permission-matrix');

const NAME = 'permission-probe';
const D1_CODE = process.argv[2] || '087';
const D2_CODE = process.argv[3] || '052';
const BACKEND_SRC = path.join(__dirname, '..', '..', '..', 'src');
const STATE_FILE = path.join(process.env.CERT_STATE_DIR || 'C:/Temp/octapm-cert/state', 'cert3', `${NAME}.json`);
const GHOST_ID = crypto.randomUUID();
const GHOST_PERIOD = '999999';
const TODAY = new Date().toISOString().slice(0, 10);
const NAME_ROOT = 'CERT3-PERM-';

class SetupError extends Error {}

// ── the fixed list of checks (computed at load, before any request) ──────────
const PERSONA_KEYS = PERSONAS.map((p) => p.key);
const ROLE_OF = Object.fromEntries(PERSONAS.map((p) => [p.key, p.role]));
const SUBMITTERS = ['pm', 'planner', 'site', 'quality'];
const S1_ACTIVITIES = [...SUBMITTERS.map((key) => [`own-${key}`, key]), ['planner-only', 'planner']];
const APPROVAL_PLAN = { pm: 'site', planner: 'quality', qs: 'pm' };
const JSON_REFUSES_SUBMIT = PERSONA_KEYS.filter((key) => !matrix.allowedRoles('progress', 'submit', 'submission.submit').includes(ROLE_OF[key]));
const JSON_REFUSES_APPROVE = PERSONA_KEYS.filter((key) => !matrix.allowedRoles('progress', 'approve', 'submission.approve').includes(ROLE_OF[key]));
const D2_SIGNIN = ['pm', 'finance', 'qs'];

/** The registered suspects (adjudication §B): judged by their own checks, exit 2 when present. */
const SUS_BOQ = 'SUS-BOQ-READ-NARROWING';
const SUS_S5 = 'SUS-S5-INVENTORY-SCOPE';
/**
 * The answers of the project-access rule (HEAD services/project-authorization.service.js
 * assertProjectAccess, used by middleware/project-access.js requireProjectAccess): 403
 * PROJECT_ACCESS_DENIED for a project of the company the person is not on, 404
 * PROJECT_NOT_FOUND for one that is not the company's. Only these clear S5.scope.
 */
const S5_PROJECT_ACCESS_REFUSALS = ['403 PROJECT_ACCESS_DENIED', '404 PROJECT_NOT_FOUND'];
const BOQ_NARROWING_ENTRIES = new Set(['WP6.boq.template', 'WP6.boq.uploadFile']);

const RULES = {
  'RJ-3': {
    status: 'proposed',
    statement: 'GET /projects/:id/boq/template and GET /projects/:id/boq/uploads/:documentId answer every role shared/permissions.json boq:read allows (all nine roles); the route\'s requireRoles(pm, planning_eng, qs) and the JSON must agree. Registered suspect, proposed P3 (data exposure narrower than policy, which is safe).',
    sources: ['adjudication.md §B', 'permission-matrix.js ROUTE_VS_JSON RJ-3', 'plan §4 WP-0, exit criterion E8'],
    open: 'which side moves (the JSON narrowed or the route widened) is for the owner',
  },
  'RJ-8': {
    status: 'proposed',
    statement: 'A person who cannot open a project cannot move stock for it: POST /inventory/stock/receive naming a project the warehouse keeper is not on is refused (403 or 404, by the project-access rule). A 2xx is a suspect authorisation finding, proposed P2 (in-company, cross-project); severity after reproduction.',
    sources: ['adjudication.md §B', 'permission-matrix.js ROUTE_VS_JSON RJ-8', 'SCENARIOS S5-inventory-scope'],
  },
};

const PLAN = [
  ['S0.matrix', 'permission-matrix.js is consistent with permissions.json (every module, action and transition named exists; every path parameter has a probe value)', { setup: true }],
  ['S0.limiter', 'the in-process application\'s limiters count in a process-local memory store the probe installed before the first request (never the shared Postgres or Redis counters): the requests of the setup are seen in it and a reset empties it; it is emptied before every persona', { setup: true }],
  ['S0.database', 'the certification database is the one written (cert-env guard: octapm_cert, the marker row)', { setup: true }],
  ['S0.spec.companies', `companies ${D1_CODE} and ${D2_CODE} exist in spec.js`, { setup: true }],
  ['S0.spec.d1', `${D1_CODE}: nine personas, one per role of permissions.json, the PM persona the only administrator among them`, { setup: true }],
  ['S0.spec.d2', `${D2_CODE}: the finance persona is a company administrator, the QS is not, the PM is`, { setup: true }],
  ...PERSONA_KEYS.map((key) => [`S0.signin.${D1_CODE}.${key}`, `${D1_CODE} ${key} signs in to its company by explicit id; the session's user, organisation, role and administration match spec.js`, { setup: true }]),
  ...D2_SIGNIN.map((key) => [`S0.signin.${D2_CODE}.${key}`, `${D2_CODE} ${key} signs in to its company by explicit id; the session's user, organisation, role and administration match spec.js`, { setup: true }]),
  [`S0.project.${D1_CODE}`, `${D1_CODE} P1: throwaway project ${NAME_ROOT}<stamp>-${D1_CODE}-P1 (reused from the state file when the PM still reads it under that name)`, { setup: true }],
  [`S0.project.${D1_CODE}U`, `${D1_CODE} P1U: throwaway project ${NAME_ROOT}<stamp>-${D1_CODE}-P1U, nobody added`, { setup: true }],
  [`S0.project.${D2_CODE}`, `${D2_CODE} P2: throwaway project ${NAME_ROOT}<stamp>-${D2_CODE}-P2, nobody added`, { setup: true }],
  ...PERSONA_KEYS.filter((key) => key !== 'pm').map((key) => [`S0.team.${key}`, `${key} put on P1 by the PM (201, or 200 already on it)`, { setup: true }]),
  ...PERSONA_KEYS.map((key) => [`S0.effective.${key}.context`, `${key} on P1: no permission template, effective role ${ROLE_OF[key]}, source ${key === 'pm' ? 'assignment or org' : 'assignment'}`, { setup: true }]),
  ...PERSONA_KEYS.map((key) => [`S0.effective.${key}.matrix`, `${key}: GET /auth/me/permissions module matrix equals permissions.json for ${ROLE_OF[key]}${key === 'pm' ? ' + company administration (user_management and project_parties, no other JSON module right)' : ''}`]),
  ['S0.details', 'preflight: the site engineer approving a ghost schedule revision is refused 403 FORBIDDEN', { setup: true }],
  ['S0.details.present', 'the API sends error.details {module, action, transition} with a refusal, so the refusing key is asserted on every refused probe', { setup: true }],
  ...PERSONA_KEYS.map((key) => [`P1.${D1_CODE}.${key}.guard`, `P1 ${key} (${ROLE_OF[key]}): every matrix entry the JSON decides answers as permissions.json says (refused: 403 FORBIDDEN under the entry's declared key; allowed: past the guard); no 5xx. The BOQ-read narrowing and company-administration grants are judged elsewhere`]),
  ...PERSONA_KEYS.map((key) => [`P1.${D1_CODE}.${key}.answers`, `P1 ${key}: every probe that passed the guard got the entry's allowed answer (404 *_NOT_FOUND on a ghost, 400 on an invalid body, 200 on a read); no 401 or 429; the project reached`, { setup: true }]),
  ['S1.submitters', 'S1 the JSON submitters of progress are pm, planner, site and quality (the scenario covers each once)', { setup: true }],
  ...S1_ACTIVITIES.map(([label, key]) => [`S1.activity.${label}`, `S1 setup: activity ${NAME_ROOT}<stamp>-S1-${label} created by the PM, assigned to ${key} only (201, id)`, { setup: true }]),
  ...SUBMITTERS.map((key) => [`S1.submit.${key}`, `S1 ${key} (JSON allows progress submit) submits 40% on its own activity: 200, submission submitted`]),
  ...['site', 'quality'].map((key) => [`S1.unassigned.${key}`, `S1 ${key} on an activity it is not assigned to: 403 ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED (service rule beyond the JSON, RJ-6)`]),
  ...JSON_REFUSES_SUBMIT.map((key) => [`S1.refused.${key}`, `S1 ${key} (JSON refuses progress submit) on a real activity: 403 FORBIDDEN progress/submit/submission.submit`]),
  ['S2.target', 'S2 setup: the planner\'s S1 submission exists (the refusals are tried on it)', { setup: true }],
  ...JSON_REFUSES_APPROVE.map((key) => [`S2.refused.${key}`, `S2 ${key} (JSON refuses approval) approving a real submission: 403 FORBIDDEN progress/approve/submission.approve`]),
  ['S2.approvers', 'S2 the JSON approvers of progress are pm, planner and qs (the plan covers each once)', { setup: true }],
  ...Object.entries(APPROVAL_PLAN).map(([approver, submitter]) => [`S2.approve.${approver}`, `S2 ${approver} approves ${submitter}'s submission: 200, status approved`]),
  ['S2.approve.again', 'S2 approving the same submission again: 200, still approved (idempotent)'],
  ['S3.period', `S3 setup: the cost controller creates reporting period ${NAME_ROOT}<stamp>-S3 (2026-01-05..2026-01-31) on P1 (id)`, { setup: true }],
  ['S3.blocked', 'S3 finance (JSON allows reporting_period.lock) locks without a reason: 409 REPORTING_READINESS_BLOCKED (the throwaway project has no baseline)'],
  ['S3.override.finance', 'S3 finance with an override reason (JSON reporting_period.override is pm only): 403 REPORTING_READINESS_OVERRIDE_FORBIDDEN'],
  ['S3.override.planner', 'S3 the planner (JSON refuses reporting_period.lock) with an override reason: 403 FORBIDDEN'],
  ['S3.override.pm', 'S3 the PM with an override reason: 200 (the period locked on a PM override)'],
  ...PERSONA_KEYS.map((key) => [`S4.${key}`, `S4 ${key} on P1U, a project it is not on: ${key === 'pm' ? '200 (the PM role sees every project of its company)' : '403 PROJECT_ACCESS_DENIED'}`]),
  ['S5.item', `S5 setup: the warehouse keeper creates throwaway item ${NAME_ROOT}<stamp>-S5 (201, id)`, { setup: true }],
  ['S5.warehouse', `S5 setup: the warehouse keeper creates throwaway warehouse ${NAME_ROOT}<stamp>-S5 (201, id)`, { setup: true }],
  ['S5.answer', 'S5 the stock receipt naming P1U was answered 2xx, 403 or 404 (anything else means the probe body needs fixing; a 5xx is left to G.5xx)', { setup: true }],
  ['S5.scope', 'S5 registered suspect: the warehouse keeper (not on P1U) receiving stock for P1U through the company-level route is refused by the project-access rule (403 PROJECT_ACCESS_DENIED or 404 PROJECT_NOT_FOUND; 403 FORBIDDEN from the inventory permission guard and an item or warehouse *_NOT_FOUND do not count); a 2xx is the suspect present', { defect: SUS_S5, rule: 'RJ-8' }],
  [`S6.${D1_CODE}.create`, `S6 ${D1_CODE}: the QS creates an organisation-visible report ${NAME_ROOT}<stamp>-S6-${D1_CODE}`, { setup: true }],
  [`S6.${D1_CODE}.finance`, `S6 ${D1_CODE} finance (plain member, not the creator) edits the QS's report: 403 REPORT_FORBIDDEN`],
  [`S6.${D2_CODE}.create`, `S6 ${D2_CODE}: the QS creates an organisation-visible report ${NAME_ROOT}<stamp>-S6-${D2_CODE} (the administrator's edit of it is recorded for HR-A1)`, { setup: true }],
  ['S7.visibility.qs', `S7 ${D2_CODE} QS (not an administrator, not on P2): 403 PROJECT_ACCESS_DENIED`],
  ['S7.reach', `S7 ${D2_CODE} finance reaches P2 for the matrix run: through the administrator's org-wide visibility (an HR-A1 grant, recorded) or, if that grant is absent, a temporary assignment removed in cleanup`, { setup: true }],
  ['S7.effective.context', 'S7 finance on P2: no template, role finance, isCompanyAdmin true', { setup: true }],
  ['S7.effective.matrix', 'S7 finance administrator: GET /auth/me/permissions module matrix = JSON finance + user_management + project_parties; no JSON module right beyond those two (the reworded assumption)'],
  [`P2.${D2_CODE}.finance.guard`, `P2 ${D2_CODE} finance administrator (not on P2): every matrix entry answers as JSON finance + user_management + project_parties says (refused under the entry's declared key); no 5xx. Grants outside the JSON are recorded for HR-A1, not compared`],
  [`P2.${D2_CODE}.finance.answers`, `P2 ${D2_CODE} finance: every probe that passed the guard got the entry's allowed answer; no 401 or 429; the project reached`, { setup: true }],
  ['SUS.boq-read-narrowing', 'registered suspect: GET /boq/template and GET /boq/uploads/:documentId let every role JSON boq:read allows past the guard (all nine); a 403 FORBIDDEN from requireRoles(pm, planning_eng, qs) for a JSON reader is the narrowing present', { defect: SUS_BOQ, rule: 'RJ-3' }],
  ['SCN.readable', 'every scenario step (S1-S7) that was not refused or answered 5xx reached the state the step expects (a step that passed its guard but answered otherwise is a probe defect, not a finding)', { setup: true }],
];

const h = harness.createHarness({
  name: NAME,
  plan: PLAN,
  rules: RULES,
  meta: {
    companies: { d1: D1_CODE, d2: D2_CODE },
    api: 'in process (CERT_INPROCESS=1)',
    ghostId: GHOST_ID,
    policy: { path: matrix.POLICY_PATH, version: matrix.POLICY.version, sha256: matrix.POLICY_SHA256 },
    matrixEntries: matrix.TRANSITIONS.length,
    decisions: 'C:\\Temp\\octapm-cert\\scratch\\wp0\\adjudication.md section B',
    naming: `${NAME_ROOT}<stamp>-*`,
    routeVsJson: matrix.ROUTE_VS_JSON,
    roleListDifferences: matrix.ROLE_LIST_DIFFERENCES,
    declaredVsNatural: matrix.DECLARED_VS_NATURAL,
    companyAdmin: matrix.COMPANY_ADMIN,
    scenarios: matrix.SCENARIOS,
  },
});
const STAMP = h.STAMP;
const PREFIX = `${NAME_ROOT}${STAMP}`;

// ── recording ────────────────────────────────────────────────────────────────
const probes = [];
const scenarioDefects = [];
const made = [];
const stats = { requests: 0, limiterResets: [], rateLimited: 0 };
const hrA1 = { measured: [], adminProbes: [], pmHardCodedOverrides: null };
const runState = { tallies: {}, projects: null, s7TemporaryAssignment: null, people: null, d2People: null };
let detailsAsserted = true;
let limiter = null;

/** A setup check: refuses to continue when it fails. */
const must = (id, ok, detail = '') => {
  if (!h.check(id, ok === true, detail)) throw new SetupError(`${id}: ${String(detail).slice(0, 400)}`);
};
/** A scenario check; a failure that is neither a refusal nor a 5xx is also a probe defect (SCN.readable). */
const step = (id, ok, res, detail = '') => {
  const passed = h.check(id, ok === true, detail);
  const status = res?.status ?? 0;
  if (!passed && status !== 403 && status < 500) scenarioDefects.push({ id, said: h.said(res), detail: String(detail).slice(0, 300) });
  return passed;
};
const errorOf = (res) => ({ status: res?.status ?? null, code: res?.body?.error?.code ?? null, details: res?.body?.error?.details ?? null });

// ── the in-process limiter (adjudication §B: run in process, reset between personas) ──
const installLimiter = () => {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const storeModule = require(path.join(BACKEND_SRC, 'config', 'rate-limit-store'));
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const rateLimit = require(path.join(BACKEND_SRC, 'middleware', 'rate-limit'));
  const store = storeModule.createMemoryStore();
  rateLimit.setSharedRateLimitStore(store);
  limiter = { store, storeModule, rateLimit };
  return { installed: storeModule.getSharedRateLimitStore() === store, kind: store.kind };
};
const resetLimiter = async (why) => {
  if (!limiter) throw new SetupError('the in-process limiter store was not installed');
  if (limiter.storeModule.getSharedRateLimitStore() !== limiter.store) throw new SetupError('the shared rate-limit store is no longer the probe\'s process-local store');
  const keys = limiter.store.size();
  await limiter.rateLimit.resetRateLimitStores();
  stats.limiterResets.push({ why, keysCleared: keys, at: new Date().toISOString() });
  return limiter.store.size();
};

// ── sessions and requests ───────────────────────────────────────────────────
/** One request as a person; every answer is kept for G.5xx. A 429 empties the in-process limiter and is sent once more; an expired token is re-minted once. */
const send = async (person, method, route, { json, binary = false, label = null } = {}) => {
  for (let attempt = 0; ; attempt += 1) {
    const token = await api.tokenFor(person.email, person.orgId);
    const res = await api.raw(method, route, { token, json, binary, actor: person.email, org: person.orgId });
    stats.requests += 1;
    if (res.status === 429 && attempt === 0) {
      stats.rateLimited += 1;
      console.log(`        rate limited (${res.body?.error?.details?.bucket || '?'}) on ${method} ${route}; emptying the in-process limiter and sending once more`);
      await resetLimiter(`429 on ${method} ${route}`);
      continue;
    }
    if (res.status === 401 && attempt === 0) {
      api.forget(person.email);
      continue;
    }
    return h.keep(label || `${method} ${route}`, res);
  }
};

const substitute = (value, ctx) => {
  if (typeof value === 'string') {
    if (value === '@ghost') return GHOST_ID;
    if (value === '@project') return ctx.projectId;
    if (value.startsWith('@user:')) {
      const id = ctx.userIds[value.slice(6)];
      if (!id) throw new SetupError(`no user id for ${value}`);
      return id;
    }
    return value.replace(/@stamp/g, STAMP).replace(/@today/g, TODAY);
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, ctx));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, ctx)]));
  return value;
};

const hasPlaceholder = (value) => JSON.stringify(value ?? null).includes('"<') || /"[^"]*<[A-Za-z][^"]*>[^"]*"/.test(JSON.stringify(value ?? null));

/** The concrete request a probe sends: path with the project, ghost ids and bad parameters filled in, query and body. */
const buildRequest = (entry, ctx) => {
  const { probe } = entry;
  const params = probe.params || {};
  let route = entry.path.replace(/\{(\w+)\}/g, (_, name) => {
    if (name in params) return encodeURIComponent(substitute(params[name], ctx));
    if (name === 'projectId') {
      if (!ctx.projectId) throw new SetupError(`${entry.id}: a project-scoped entry without a project`);
      return ctx.projectId;
    }
    if ((probe.ghost || []).includes(name)) return name === 'period' ? GHOST_PERIOD : GHOST_ID;
    throw new SetupError(`${entry.id}: no value for {${name}}`);
  });
  if (probe.query) route += `?${new URLSearchParams(substitute(probe.query, ctx)).toString()}`;
  let json;
  if (entry.method !== 'GET') {
    if (probe.mode === 'invalid') json = substitute(probe.body, ctx);
    else if (probe.mode === 'badParam' || probe.mode === 'badQuery') json = {};
    else {
      json = substitute(entry.body, ctx);
      if (hasPlaceholder(json)) throw new SetupError(`${entry.id}: the ${probe.mode} body still holds a <placeholder>: ${JSON.stringify(json)}`);
    }
  }
  return { route, json, binary: Boolean(probe.binary) };
};

const describeOne = (allow) => `${allow.status}${allow.code ? ` ${allow.code}` : allow.codePattern ? ` /${allow.codePattern}/` : ''}`;
const describeAllow = (allow) => (allow.anyOf ? allow.anyOf.map(describeOne).join(' or ') : describeOne(allow));

/** The verdict on one answer: pass | mismatch (a finding) | setup (a probe defect) | observed (not compared). */
const judge = (entry, expected, res) => {
  const { status, code, details } = errorOf(res);
  if (status >= 500) return { verdict: 'mismatch', reason: `5xx (${status} ${code})` };
  if (status === 401) return { verdict: 'setup', reason: `session refused: ${status} ${code}` };
  if (status === 429) return { verdict: 'setup', reason: 'rate limited after one in-process limiter reset' };
  if (expected === null) return { verdict: 'observed', reason: `${status} ${code || ''}`.trim() };
  if (status === 403 && code === 'PROJECT_ACCESS_DENIED' && entry.scope === 'project') return { verdict: 'setup', reason: 'the persona does not reach the project (assignment missing)' };
  if (expected === false) {
    const denial = matrix.denialFor(entry);
    if (!denial) return { verdict: 'setup', reason: `no refusal shape for guard ${entry.guard.kind}` };
    if (status !== denial.status || code !== denial.code) return { verdict: 'mismatch', reason: `the JSON refuses this role; answered ${status} ${code}` };
    if (denial.details) {
      if (!details) {
        if (detailsAsserted) return { verdict: 'mismatch', reason: 'refused without error.details (cannot tell which key refused)' };
      } else {
        const wrong = Object.entries(denial.details).filter(([k, v]) => (details[k] ?? null) !== v);
        if (wrong.length) return { verdict: 'mismatch', reason: `refused under another key: ${JSON.stringify({ module: details.module, action: details.action, transition: details.transition, requires: details.requires })}` };
      }
    }
    return { verdict: 'pass', reason: '' };
  }
  if (status === 403) return { verdict: 'mismatch', reason: `the JSON allows this role; refused ${status} ${code}${details ? ` ${JSON.stringify(details)}` : ''}` };
  const { allow } = entry.probe;
  const answers = (one) => {
    const statusOk = status === one.status || (entry.probe.mode === 'effect' && (status === 200 || status === 201));
    const codeOk = one.code ? code === one.code : one.codePattern ? new RegExp(one.codePattern).test(code || '') : true;
    return statusOk && codeOk;
  };
  if ((allow.anyOf || [allow]).some(answers)) return { verdict: 'pass', reason: '' };
  return { verdict: 'setup', reason: `passed the guard but answered ${status} ${code} instead of ${describeAllow(allow)} (fix the probe body or record)${details ? ` ${JSON.stringify(details).slice(0, 300)}` : ''}` };
};

/** A role the JSON allows on a BOQ read that the route's requireRoles list omits (the registered narrowing, RJ-3). */
const inBoqNarrowing = (entry, persona) =>
  BOQ_NARROWING_ENTRIES.has(entry.id) && entry.guard.kind === 'roles' && matrix.expectAllowed(entry, persona) === true && !entry.guard.roles.includes(persona.role);
/** A requireCompanyAdmin route asked by an administrator: a grant outside the JSON (HR-A1), recorded, never compared. */
const isAdminGrant = (entry, persona) => entry.guard.kind === 'companyAdmin' && Boolean(persona.isCompanyAdmin);

/**
 * The adjudication's buckets. First the company-administration grants (HR-A1: grant |
 * grant-absent), before judge() and before any bucketing into .guard / .answers, so an
 * HR-A1 observation never changes the exit code: on a requireCompanyAdmin entry asked by an
 * administrator, any answer but 403 is the grant present and a 403 the grant absent (a 5xx
 * there is still the harness's own G.5xx). Then judge(): a 5xx and a probe defect stay in
 * the persona's .guard / .answers; the BOQ-read narrowing (suspect | pass,
 * SUS.boq-read-narrowing); everything else in the persona's .guard / .answers checks.
 */
const classifyProbe = (entry, persona, expected, res) => {
  if (isAdminGrant(entry, persona)) {
    const { status, code } = errorOf(res);
    const answer = status === null ? 'no answer' : `${status}${code ? ` ${code}` : ''}`;
    return status === 403
      ? { verdict: 'grant-absent', reason: `HR-A1: grant absent (${answer}); recorded, not compared`, bucket: 'HR-A1' }
      : { verdict: 'grant', reason: `HR-A1: grant present (${answer}, not 403): through company administration, outside the JSON; recorded, not compared${status >= 500 ? '; the 5xx itself is G.5xx\'s' : ''}`, bucket: 'HR-A1' };
  }
  const outcome = judge(entry, expected, res);
  if ((res?.status ?? 0) >= 500 || outcome.verdict === 'setup') return { ...outcome, bucket: 'guard' };
  if (inBoqNarrowing(entry, persona)) {
    return outcome.verdict === 'pass'
      ? { verdict: 'pass', reason: 'past the guard: the narrowing is not there for this role', bucket: SUS_BOQ }
      : { verdict: 'suspect', reason: `${outcome.reason} (requireRoles ${entry.guard.roles.join(', ')} against JSON boq:read)`, bucket: SUS_BOQ };
  }
  return { ...outcome, bucket: 'guard' };
};

const keyOf = (entry) => (entry.guard.kind === 'permission'
  ? [entry.guard.module, entry.guard.action, entry.guard.transition].filter(Boolean).join(':')
  : entry.guard.kind === 'roles'
    ? `${matrix.POLICY.modules[entry.guard.module] ? `${entry.guard.module}:${entry.guard.action}` : 'no JSON key'} via requireRoles(${entry.guard.roles.join(',')})`
    : entry.guard.kind);

/** Runs every probeable matrix entry for one persona in one company context. */
const runMatrix = async ({ label, person, persona, ctx }) => {
  const tally = { pass: 0, mismatch: 0, setup: 0, observed: 0, suspect: 0, grant: 0, 'grant-absent': 0 };
  const records = [];
  for (const entry of matrix.TRANSITIONS) {
    if (entry.probe.mode === 'scenario') continue;
    const expected = matrix.expectAllowed(entry, persona);
    let res = null;
    let request = null;
    let outcome;
    try {
      request = buildRequest(entry, { ...ctx, projectId: entry.scope === 'project' ? ctx.projectId : null });
      res = await send(person, entry.method, request.route, { json: request.json, binary: request.binary, label: `${label}.${entry.id}@${persona.key}` });
      outcome = classifyProbe(entry, persona, expected, res);
    } catch (error) {
      if (!(error instanceof SetupError) && !(error instanceof api.ApiError)) throw error;
      outcome = { verdict: 'setup', reason: error.message, bucket: 'guard' };
    }
    tally[outcome.verdict] += 1;
    const record = {
      run: label,
      entry: entry.id,
      wp: entry.wp,
      persona: persona.key,
      role: persona.role,
      isCompanyAdmin: Boolean(persona.isCompanyAdmin),
      key: keyOf(entry),
      expected: expected === null ? 'not compared' : expected ? 'allow' : 'deny',
      method: entry.method,
      route: request?.route ?? entry.path,
      got: res ? errorOf(res) : null,
      verdict: outcome.verdict,
      bucket: outcome.bucket,
      reason: outcome.reason || undefined,
    };
    probes.push(record);
    records.push(record);
    if (outcome.bucket === 'HR-A1') hrA1.adminProbes.push({ run: label, persona: persona.key, role: persona.role, entry: entry.id, route: record.route, got: h.said(res), verdict: outcome.verdict });
    if (['mismatch', 'setup', 'suspect'].includes(outcome.verdict)) {
      const tag = { mismatch: 'FAIL ', setup: 'SETUP', suspect: 'SUSP ' }[outcome.verdict];
      console.log(`${tag} ${label}.${entry.id}@${persona.key}  expected ${record.expected} (${record.key}); ${outcome.reason}`);
    }
  }
  return { tally, records };
};

const describeProbes = (list, limit = 30) =>
  list.slice(0, limit).map((p) => `${p.entry} expected ${p.expected} (${p.key}) got ${p.got ? `${p.got.status} ${p.got.code || ''}`.trim() : 'no answer'}: ${p.reason || ''}`).join('; ') + (list.length > limit ? `; ... ${list.length - limit} more` : '');

/** Records a persona run as its two checks: .guard (findings) and .answers (probe defects). */
const recordRun = (prefix, { tally, records }) => {
  const mismatches = records.filter((p) => p.verdict === 'mismatch');
  const defects = records.filter((p) => p.verdict === 'setup');
  const counts = Object.entries(tally).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ');
  h.check(`${prefix}.guard`, mismatches.length === 0, `${records.length} probes (${counts})${mismatches.length ? `; ${mismatches.length} mismatch: ${describeProbes(mismatches)}` : ''}`);
  h.check(`${prefix}.answers`, defects.length === 0, `${records.length} probes (${counts})${defects.length ? `; ${defects.length} probe defect: ${describeProbes(defects)}` : ''}`);
};

// ── the product's own effective matrix ───────────────────────────────────────
const MODULE_IDS = Object.keys(matrix.POLICY.modules);
const expectedModules = (persona) => {
  const out = {};
  for (const module of MODULE_IDS) {
    const actions = matrix.ACTIONS.filter((action) => matrix.policyAllows({ module, action, transition: null }, persona));
    const transitions = Object.keys(matrix.POLICY.modules[module].transitions || {}).filter((transition) => matrix.policyAllows({ module, action: null, transition }, persona));
    out[module] = { actions, transitions };
  }
  return out;
};
const compareModules = (got, want) => {
  const diffs = [];
  for (const module of MODULE_IDS) {
    const g = got?.[module];
    if (!g) { diffs.push(`${module}: missing`); continue; }
    const ga = [...(g.actions || [])].sort().join(',');
    const wa = [...want[module].actions].sort().join(',');
    const gt = [...(g.transitions || [])].sort().join(',');
    const wt = [...want[module].transitions].sort().join(',');
    if (ga !== wa) diffs.push(`${module} actions [${ga}] vs JSON [${wa}]`);
    if (gt !== wt) diffs.push(`${module} transitions [${gt}] vs JSON [${wt}]`);
  }
  return diffs;
};

// ── state (resumable throwaway projects) ─────────────────────────────────────
const readState = () => {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { version: 2, runs: 0, projects: {} };
  }
};
const writeState = (state) => {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
};

/** The throwaway project for `slot`: the one in state when the PM still reads it under its CERT3-PERM- name, else a new one. */
const throwawayProject = async ({ state, slot, pm, company, suffix }) => {
  const kept = state.projects[slot];
  if (kept?.id && String(kept.name || '').startsWith(NAME_ROOT)) {
    const res = await send(pm, 'GET', `/projects/${kept.id}`, { label: `S0.project.${slot}.reuse` });
    const name = res.body?.data?.name ?? res.body?.data?.project?.name;
    if (res.status === 200 && name === kept.name) {
      h.check(`S0.project.${slot}`, true, `reused throwaway project "${kept.name}" (${kept.id})`);
      made.push({ kind: 'project', slot, name: kept.name, id: kept.id, reused: true });
      return kept;
    }
    console.log(`        state project ${slot} not reusable (${h.said(res)}, name ${JSON.stringify(name)}); creating a new one`);
  }
  const projectName = `${PREFIX}-${company.code}-${suffix}`;
  const res = await send(pm, 'POST', '/projects', {
    json: { name: projectName, startDate: '2026-01-05', endDate: '2027-06-30', projectCalendar: 'five_day', currency: company.currency, clientName: 'CERT3 WP-0 permission probe' },
    label: `S0.project.${slot}`,
  });
  const data = res.body?.data;
  const id = data?.id ?? data?.project?.id;
  const name = data?.name ?? data?.project?.name;
  must(`S0.project.${slot}`, res.status === 201 && typeof id === 'string' && name === projectName, `${h.said(res)} id=${id} name=${name}`);
  state.projects[slot] = { id, name: projectName, code: company.code, createdAt: new Date().toISOString() };
  writeState(state);
  made.push({ kind: 'project', slot, name: projectName, id, reused: false });
  return state.projects[slot];
};

// ── main ─────────────────────────────────────────────────────────────────────
const main = async () => {
  must('S0.matrix', matrix.MATRIX_PROBLEMS.length === 0, matrix.MATRIX_PROBLEMS.length ? matrix.MATRIX_PROBLEMS.join('; ') : `${matrix.TRANSITIONS.length} entries; permissions.json ${matrix.POLICY.version} (${matrix.POLICY_PATH})`);
  console.log(`${NAME}: D1 ${D1_CODE}, D2 ${D2_CODE}; stamp ${STAMP}; ghost ${GHOST_ID}; ${matrix.TRANSITIONS.length} matrix entries; permissions.json ${matrix.POLICY.version} sha256 ${matrix.POLICY_SHA256.slice(0, 16)}; API in process\n`);

  // ── the in-process limiter is this process's own, installed before the first request
  // (S0.limiter is recorded after the preflight, once the application's own requests are seen in it) ──
  let limiterInstall;
  try {
    limiterInstall = installLimiter();
  } catch (error) {
    limiterInstall = { installed: false, kind: null, error: error.message };
  }
  if (!limiterInstall.installed || limiterInstall.kind !== 'memory') must('S0.limiter', false, `the process-local store could not be installed: ${JSON.stringify(limiterInstall)}`);

  // ── S0.database: the marker row, before anything is written ──
  {
    let detail = 'connected';
    let ok = false;
    try {
      const db = await h.connect();
      const row = (await db.query('select current_database() as name')).rows[0];
      ok = row?.name === 'octapm_cert';
      detail = `database ${row?.name}`;
    } catch (error) {
      detail = error.message;
    }
    must('S0.database', ok, detail);
  }

  // ── S0.spec: companies by explicit code, personas from spec.js ──
  const { companies } = buildPopulation();
  const D1 = companies.find((c) => c.code === D1_CODE);
  const D2 = companies.find((c) => c.code === D2_CODE);
  must('S0.spec.companies', Boolean(D1 && D2), `D1 ${Boolean(D1)}, D2 ${Boolean(D2)}`);
  const personasOf = (company) => company.people.filter((p) => p.persona).map((p) => ({ key: p.persona, role: p.role, isCompanyAdmin: Boolean(p.isAdmin), email: p.email, userId: p.id, orgId: company.id }));
  const d1Personas = personasOf(D1);
  const roleSet = d1Personas.map((p) => p.role).sort().join(',');
  must('S0.spec.d1', d1Personas.length === 9 && roleSet === [...matrix.ROLES].sort().join(',') && d1Personas.map((p) => p.key).sort().join(',') === [...PERSONA_KEYS].sort().join(',') && d1Personas.filter((p) => p.isCompanyAdmin).map((p) => p.key).join(',') === 'pm',
    JSON.stringify(d1Personas.map((p) => `${p.key}:${p.role}:${p.isCompanyAdmin}`)));
  const d2 = Object.fromEntries(personasOf(D2).map((p) => [p.key, p]));
  must('S0.spec.d2', d2.finance?.isCompanyAdmin === true && d2.qs?.isCompanyAdmin === false && d2.pm?.isCompanyAdmin === true,
    JSON.stringify(Object.values(d2).map((p) => `${p.key}:${p.isCompanyAdmin}`)));

  // ── S0.signin ──
  const signInChecked = async (persona, id) => {
    let session = null;
    try {
      session = await api.signIn(persona.email, persona.orgId);
    } catch (error) {
      must(id, false, `${persona.email}: ${error.message}`);
    }
    const u = session.user || {};
    const ok = session.orgId === persona.orgId && u.id === persona.userId && u.role === persona.role && (u.isCompanyAdmin === undefined || Boolean(u.isCompanyAdmin) === persona.isCompanyAdmin);
    must(id, ok, `${persona.email}: session org ${session.orgId}, user ${u.id}, role ${u.role}, isCompanyAdmin ${u.isCompanyAdmin} (spec: ${persona.orgId}, ${persona.userId}, ${persona.role}, ${persona.isCompanyAdmin})`);
    return { email: persona.email, orgId: persona.orgId };
  };
  const people = {};
  for (const persona of d1Personas) people[persona.key] = await signInChecked(persona, `S0.signin.${D1_CODE}.${persona.key}`);
  const d2People = {};
  for (const key of D2_SIGNIN) d2People[key] = await signInChecked(d2[key], `S0.signin.${D2_CODE}.${key}`);
  runState.people = people;
  runState.d2People = d2People;
  const userIds = Object.fromEntries(d1Personas.map((p) => [p.key, p.userId]));
  const d2UserIds = Object.fromEntries(Object.values(d2).map((p) => [p.key, p.userId]));

  // ── S0.projects ──
  const state = readState();
  state.runs = (state.runs || 0) + 1;
  writeState(state);
  const P1 = await throwawayProject({ state, slot: D1_CODE, pm: people.pm, company: D1, suffix: 'P1' });
  const P1U = await throwawayProject({ state, slot: `${D1_CODE}U`, pm: people.pm, company: D1, suffix: 'P1U' });
  const P2 = await throwawayProject({ state, slot: D2_CODE, pm: d2People.pm, company: D2, suffix: 'P2' });
  runState.projects = { P1, P1U, P2 };

  // ── S0.team: every non-PM persona of D1 on P1, with the company role ──
  for (const persona of d1Personas.filter((p) => p.key !== 'pm')) {
    const res = await send(people.pm, 'POST', `/projects/${P1.id}/team`, { json: { userId: persona.userId }, label: `S0.team.${persona.key}` });
    must(`S0.team.${persona.key}`, res.status === 201 || res.status === 200, h.said(res));
  }

  // ── S0.effective: no template, the persona's role, the product's matrix = the JSON's ──
  for (const persona of d1Personas) {
    const res = await send(people[persona.key], 'GET', `/auth/me/permissions?projectId=${P1.id}`, { label: `S0.effective.${persona.key}` });
    const data = res.body?.data;
    must(`S0.effective.${persona.key}.context`, res.status === 200 && data?.template === null && data?.role === persona.role && Boolean(data?.isCompanyAdmin) === persona.isCompanyAdmin && (persona.key === 'pm' ? ['assignment', 'org'].includes(data?.source) : data?.source === 'assignment'),
      `${h.said(res)} template ${JSON.stringify(data?.template)} role ${data?.role} source ${data?.source} admin ${data?.isCompanyAdmin}`);
    const diffs = compareModules(data.modules, expectedModules(persona));
    h.check(`S0.effective.${persona.key}.matrix`, diffs.length === 0, diffs.length ? diffs.join('; ') : `${MODULE_IDS.length} modules equal`);
  }

  // ── preflight: are error details sent? ──
  {
    const res = await send(people.site, 'POST', `/projects/${P1.id}/schedule/revisions/${GHOST_ID}/approve`, { json: {}, label: 'S0.details' });
    must('S0.details', h.is(res, '403 FORBIDDEN'), h.said(res));
    const { details } = errorOf(res);
    detailsAsserted = Boolean(details && details.module === 'schedule');
    h.check('S0.details.present', detailsAsserted, detailsAsserted ? JSON.stringify(details) : 'details withheld: codes asserted, keys not (the run is incomplete)');
  }

  // ── S0.limiter: the application's own limiters counted the requests so far in the probe's store, and a reset empties it ──
  {
    const keys = limiter.store.size();
    const after = await resetLimiter('S0 verification');
    must('S0.limiter', keys > 0 && after === 0 && limiter.storeModule.getSharedRateLimitStore() === limiter.store,
      `process-local ${limiterInstall.kind} store installed before the first request; the application's requests so far left ${keys} keys in it; after the reset ${after}`);
  }

  // ── P1: the matrix, nine personas of D1, the limiter emptied before each ──
  const ctx1 = { projectId: P1.id, userIds };
  for (const persona of d1Personas) {
    await resetLimiter(`before P1 ${persona.key}`);
    const run = await runMatrix({ label: `P1.${D1_CODE}`, person: people[persona.key], persona, ctx: ctx1 });
    runState.tallies[`${D1_CODE}.${persona.key}`] = run.tally;
    recordRun(`P1.${D1_CODE}.${persona.key}`, run);
  }

  // ── S1: progress submission and the assignment rule ──
  await resetLimiter('before the scenarios');
  const activity = async (label, engineerKey) => {
    const name = `${PREFIX}-S1-${label}`;
    const res = await send(people.pm, 'POST', `/projects/${P1.id}/activities`, {
      json: { name, engineerIds: [userIds[engineerKey]], startDate: '2026-01-05', endDate: '2026-01-16', duration: 10 },
      label: `S1.activity.${label}`,
    });
    const id = res.body?.data?.id;
    must(`S1.activity.${label}`, res.status === 201 && typeof id === 'string', `${h.said(res)} id ${id}`);
    made.push({ kind: 'activity', name, id, project: P1.id });
    return id;
  };
  const jsonSubmitters = d1Personas.filter((p) => matrix.allowedRoles('progress', 'submit', 'submission.submit').includes(p.role)).map((p) => p.key);
  must('S1.submitters', jsonSubmitters.sort().join(',') === [...SUBMITTERS].sort().join(','), `JSON submitters ${jsonSubmitters.join(',')}`);
  const own = {};
  for (const [label, key] of S1_ACTIVITIES) {
    const id = await activity(label, key);
    if (label.startsWith('own-')) own[key] = id;
    else own.plannerOnly = id;
  }
  const plannerOnly = own.plannerOnly;
  const submissions = {};
  for (const key of SUBMITTERS) {
    const res = await send(people[key], 'POST', `/projects/${P1.id}/activities/${own[key]}/progress`, { json: { pctComplete: 40 }, label: `S1.submit.${key}` });
    const submission = res.body?.data?.submission;
    submissions[key] = submission?.id;
    step(`S1.submit.${key}`, res.status === 200 && submission?.status === 'submitted' && typeof submission?.id === 'string', res, `${h.said(res)} status ${submission?.status}`);
  }
  for (const key of ['site', 'quality']) {
    const res = await send(people[key], 'POST', `/projects/${P1.id}/activities/${plannerOnly}/progress`, { json: { pctComplete: 40 }, label: `S1.unassigned.${key}` });
    h.check(`S1.unassigned.${key}`, h.is(res, '403 ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED'), h.said(res));
  }
  for (const key of JSON_REFUSES_SUBMIT) {
    const res = await send(people[key], 'POST', `/projects/${P1.id}/activities/${plannerOnly}/progress`, { json: { pctComplete: 40 }, label: `S1.refused.${key}` });
    const { details } = errorOf(res);
    h.check(`S1.refused.${key}`, h.is(res, '403 FORBIDDEN') && (!detailsAsserted || (details?.module === 'progress' && details?.transition === 'submission.submit')), `${h.said(res)} ${JSON.stringify(details)}`);
  }

  // ── S2: progress approval on real submissions ──
  const approvers = d1Personas.filter((p) => matrix.allowedRoles('progress', 'approve', 'submission.approve').includes(p.role)).map((p) => p.key);
  must('S2.target', typeof submissions.planner === 'string', typeof submissions.planner === 'string' ? `submission ${submissions.planner}` : 'S1.submit.planner did not leave a submission');
  for (const key of JSON_REFUSES_APPROVE) {
    const res = await send(people[key], 'POST', `/projects/${P1.id}/activities/${own.planner}/progress-submissions/${submissions.planner}/approve`, { json: {}, label: `S2.refused.${key}` });
    const { details } = errorOf(res);
    h.check(`S2.refused.${key}`, h.is(res, '403 FORBIDDEN') && (!detailsAsserted || (details?.module === 'progress' && details?.transition === 'submission.approve')), `${h.said(res)} ${JSON.stringify(details)}`);
  }
  must('S2.approvers', approvers.sort().join(',') === Object.keys(APPROVAL_PLAN).sort().join(','), `JSON approvers ${approvers.join(',')}`);
  for (const [approver, submitter] of Object.entries(APPROVAL_PLAN)) {
    if (!submissions[submitter]) {
      step(`S2.approve.${approver}`, false, null, `no submission from ${submitter} in S1`);
      continue;
    }
    const res = await send(people[approver], 'POST', `/projects/${P1.id}/activities/${own[submitter]}/progress-submissions/${submissions[submitter]}/approve`, { json: {}, label: `S2.approve.${approver}` });
    const status = res.body?.data?.status ?? res.body?.data?.submission?.status;
    step(`S2.approve.${approver}`, res.status === 200 && status === 'approved', res, `${h.said(res)} status ${status}`);
  }
  if (submissions.pm) {
    const res = await send(people.qs, 'POST', `/projects/${P1.id}/activities/${own.pm}/progress-submissions/${submissions.pm}/approve`, { json: {}, label: 'S2.approve.again' });
    const status = res.body?.data?.status ?? res.body?.data?.submission?.status;
    h.check('S2.approve.again', res.status === 200 && status === 'approved', `${h.said(res)} status ${status}`);
  } else {
    step('S2.approve.again', false, null, 'no PM submission from S1');
  }

  // ── S3: reporting period lock and the PM-only readiness override ──
  const s3 = {};
  {
    // createReportingPeriod checks only end >= start and a code of at most 40 characters (HEAD): the run's own code, the project's first month.
    const start = '2026-01-05';
    const end = '2026-01-31';
    const code = `${PREFIX}-S3`;
    const created = await send(people.cost, 'POST', `/projects/${P1.id}/reports/periods`, { json: { code, label: `${code} permission probe`, periodStart: start, periodEnd: end, cutoffDate: end }, label: 'S3.period' });
    const periodId = created.body?.data?.id ?? created.body?.data?.period?.id;
    must('S3.period', (created.status === 201 || created.status === 200) && typeof periodId === 'string', `${h.said(created)} id ${periodId}`);
    made.push({ kind: 'reporting period', name: code, id: periodId, project: P1.id });
    const lock = (person, body, label) => send(person, 'POST', `/projects/${P1.id}/reports/periods/${periodId}/lock`, { json: body, label });
    const blocked = await lock(people.finance, {}, 'S3.blocked');
    s3.financeWithoutReason = h.said(blocked);
    if (blocked.status === 200) {
      step('S3.blocked', false, blocked, 'the readiness gate is open: the period was locked by finance and the override path was not reached');
    } else {
      h.check('S3.blocked', h.is(blocked, '409 REPORTING_READINESS_BLOCKED'), h.said(blocked));
      const reason = `${PREFIX} permission probe`;
      const fin = await lock(people.finance, { overrideReason: reason }, 'S3.override.finance');
      s3.financeOverride = h.said(fin);
      h.check('S3.override.finance', h.is(fin, '403 REPORTING_READINESS_OVERRIDE_FORBIDDEN'), h.said(fin));
      const plan = await lock(people.planner, { overrideReason: reason }, 'S3.override.planner');
      s3.plannerOverride = h.said(plan);
      h.check('S3.override.planner', h.is(plan, '403 FORBIDDEN'), h.said(plan));
      const pmRes = await lock(people.pm, { overrideReason: reason }, 'S3.override.pm');
      s3.pmOverride = h.said(pmRes);
      step('S3.override.pm', pmRes.status === 200, pmRes, h.said(pmRes));
    }
  }
  const entryById = (id) => matrix.TRANSITIONS.find((t) => t.id === id) || null;
  hrA1.pmHardCodedOverrides = {
    suspect: 'proposed P3, policy not authoritative (adjudication §B); folded into HR-A1',
    reportingPeriodOverride: {
      jsonRoles: matrix.allowedRoles('cost', 'approve', 'reporting_period.override'),
      code: entryById('WP3.period.override')?.serviceRule?.appliesTo || null,
      measured: s3,
      note: 'the JSON row is pm only, so the S3 answers agree with it; the hard-coding (templates ignored) is not observable without a template and is recorded from the code',
    },
    ipcOverCertification: entryById('WP4.ipc.certify')?.serviceRule || null,
    commitmentExecute: entryById('WP4.commitment.execute')?.notes || null,
  };

  // ── S4: a project nobody is on ──
  for (const persona of d1Personas) {
    const res = await send(people[persona.key], 'GET', `/projects/${P1U.id}/activities`, { label: `S4.${persona.key}` });
    h.check(`S4.${persona.key}`, persona.key === 'pm' ? h.is(res, '200') : h.is(res, '403 PROJECT_ACCESS_DENIED'), h.said(res));
  }

  // ── S5: company-level inventory against a project the person is not on (registered suspect) ──
  {
    const sku = `${PREFIX}-S5`;
    const item = await send(people.warehouse, 'POST', '/inventory/items', { json: { sku, name: `${PREFIX}-S5 item`, unit: 'ea' }, label: 'S5.item' });
    const itemId = item.body?.data?.id ?? item.body?.data?.item?.id;
    must('S5.item', item.status === 201 && typeof itemId === 'string', `${h.said(item)} id ${itemId}`);
    made.push({ kind: 'inventory item', name: sku, id: itemId });
    const warehouseCode = `${PREFIX}-S5`;
    const store = await send(people.warehouse, 'POST', '/inventory/warehouses', { json: { code: warehouseCode, name: `${PREFIX}-S5 store` }, label: 'S5.warehouse' });
    const warehouseId = store.body?.data?.id ?? store.body?.data?.warehouse?.id;
    must('S5.warehouse', store.status === 201 && typeof warehouseId === 'string', `${h.said(store)} id ${warehouseId}`);
    made.push({ kind: 'warehouse', name: warehouseCode, id: warehouseId });
    const reference = `${PREFIX}-S5-receive`;
    const receive = await send(people.warehouse, 'POST', '/inventory/stock/receive', { json: { itemId, warehouseId, quantity: 1, unitCost: 1, projectId: P1U.id, reference }, label: 'S5.scope' });
    const st = receive.status;
    if (st >= 200 && st < 300) made.push({ kind: 'stock receipt (suspect present)', name: reference, project: P1U.id, said: h.said(receive) });
    // 2xx: the person moved stock for a project they cannot open (the suspect); 403/404: refused; anything else: the probe needs fixing.
    h.check('S5.answer', (st >= 200 && st < 300) || st === 403 || st === 404 || st >= 500, h.said(receive));
    // Refused by the project-access rule, not merely refused: S5_PROJECT_ACCESS_REFUSALS are
    // the answers of that rule at HEAD; 403 FORBIDDEN (the inventory permission guard) and an
    // item or warehouse *_NOT_FOUND are other refusals and do not clear the suspect.
    const byProjectAccess = h.is(receive, S5_PROJECT_ACCESS_REFUSALS);
    const otherRefusal = st === 403 || st === 404 ? ` (refused, but not by the project-access rule: ${S5_PROJECT_ACCESS_REFUSALS.join(' or ')} expected)` : '';
    h.check('S5.scope', byProjectAccess, `${h.said(receive)}${st >= 200 && st < 300 ? ': stock received for a project the warehouse keeper cannot open' : byProjectAccess ? '' : otherRefusal}`);
  }

  // ── S6: report management (record-level) ──
  const reportManage = async (company, creator, editor, code) => {
    const name = `${PREFIX}-S6-${code}`;
    const created = await send(creator, 'POST', '/reports', { json: { name, source: 'activity', visibility: 'org', columns: [] }, label: `S6.${code}.create` });
    const reportId = created.body?.data?.id;
    const ok = (created.status === 201 || created.status === 200) && typeof reportId === 'string';
    h.check(`S6.${code}.create`, ok, `${h.said(created)} id ${reportId}`);
    if (!ok) return null;
    made.push({ kind: 'report definition', name, id: reportId, company });
    return send(editor, 'PUT', `/reports/${reportId}`, { json: { name: `${name} edited` }, label: `S6.${code}.edit` });
  };
  {
    const res87 = await reportManage(D1_CODE, people.qs, people.finance, D1_CODE);
    if (res87) h.check(`S6.${D1_CODE}.finance`, h.is(res87, '403 REPORT_FORBIDDEN'), h.said(res87));
    const res52 = await reportManage(D2_CODE, d2People.qs, d2People.finance, D2_CODE);
    // Recorded, never compared (HR-A1): report-builder canManage lets an administrator through.
    if (res52) hrA1.measured.push({ grant: 'report management (report-builder canManage: creator || isCompanyAdmin || PM)', persona: `${D2_CODE} finance (company administrator, not the creator)`, request: 'PUT /reports/:id of the QS\'s organisation report', got: h.said(res52), granted: res52.status >= 200 && res52.status < 300 });
  }

  // ── S7: company administration in D2 ──
  await resetLimiter('before S7');
  {
    const fin = { ...d2.finance };
    const qsRes = await send(d2People.qs, 'GET', `/projects/${P2.id}`, { label: 'S7.visibility.qs' });
    h.check('S7.visibility.qs', h.is(qsRes, '403 PROJECT_ACCESS_DENIED'), h.said(qsRes));
    const finRes = await send(d2People.finance, 'GET', `/projects/${P2.id}`, { label: 'S7.visibility.finance' });
    const visible = finRes.status === 200;
    hrA1.measured.push({ grant: 'org-wide project visibility (project-authorization canAccessAllProjects: isCompanyAdmin)', persona: `${D2_CODE} finance (company administrator, not on P2)`, request: 'GET /projects/P2', got: h.said(finRes), granted: visible });
    if (visible) {
      h.check('S7.reach', true, 'P2 reached through the administrator\'s org-wide visibility (HR-A1 grant, recorded)');
    } else {
      // The grant is absent: the module rights are still measured, on a temporary assignment removed in cleanup.
      const add = await send(d2People.pm, 'POST', `/projects/${P2.id}/team`, { json: { userId: d2.finance.userId }, label: 'S7.reach.assign' });
      if (add.status === 201 || add.status === 200) runState.s7TemporaryAssignment = { projectId: P2.id, userId: d2.finance.userId };
      must('S7.reach', add.status === 201 || add.status === 200, `visibility grant absent (${h.said(finRes)}); temporary assignment by the PM: ${h.said(add)}`);
    }
    const me = await send(d2People.finance, 'GET', `/auth/me/permissions?projectId=${P2.id}`, { label: 'S7.effective' });
    const data = me.body?.data;
    must('S7.effective.context', me.status === 200 && data?.template === null && data?.role === 'finance' && data?.isCompanyAdmin === true, `${h.said(me)} ${JSON.stringify({ template: data?.template, role: data?.role, admin: data?.isCompanyAdmin, source: data?.source })}`);
    const diffs = compareModules(data.modules, expectedModules(fin));
    h.check('S7.effective.matrix', diffs.length === 0, diffs.length ? diffs.join('; ') : `${MODULE_IDS.length} modules equal to JSON finance + user_management + project_parties`);
    const run = await runMatrix({ label: `P2.${D2_CODE}`, person: d2People.finance, persona: fin, ctx: { projectId: P2.id, userIds: { ...userIds, ...d2UserIds } } });
    runState.tallies[`${D2_CODE}.finance-admin`] = run.tally;
    recordRun(`P2.${D2_CODE}.finance`, run);
  }

  // ── the registered BOQ-read narrowing, over every run ──
  {
    const bucket = probes.filter((p) => p.bucket === SUS_BOQ);
    const present = bucket.filter((p) => p.verdict === 'suspect');
    const lines = bucket.map((p) => `${p.run} ${p.entry}@${p.persona} (${p.role}) ${p.got ? `${p.got.status} ${p.got.code || ''}`.trim() : 'no answer'}`);
    h.check('SUS.boq-read-narrowing', present.length === 0,
      `${bucket.length} probes of roles JSON boq:read allows and requireRoles(pm, planning_eng, qs) omits; ${present.length} refused 403: ${lines.join('; ') || 'none'}`);
  }

  h.check('SCN.readable', scenarioDefects.length === 0, scenarioDefects.length ? scenarioDefects.map((d) => `${d.id} ${d.said}: ${d.detail}`).join('; ') : 'every scenario step that was not refused reached its expected state');
};

// ── evidence (always written, even after a setup error) ──────────────────────
const recordEvidence = () => {
  const counts = {};
  for (const p of probes) counts[p.verdict] = (counts[p.verdict] || 0) + 1;
  h.observe('probeCounts', counts);
  h.observe('tallies', runState.tallies);
  h.observe('requests', stats);
  h.observe('projects', runState.projects);
  h.observe('observedEntries', probes.filter((p) => p.verdict === 'observed'));
  h.observe('HR-A1.companyAdministration', {
    question: 'HR-A1 (owner, §5): company administration grants more than the two JSON modules. Is each grant below by design? Recorded, never failed (adjudication §B).',
    assumption: 'no JSON module rights beyond user_management and project_parties (asserted: S0.effective.pm.matrix, S7.effective.matrix, P2 finance .guard)',
    measured: hrA1.measured,
    requireCompanyAdminRoutes: hrA1.adminProbes,
    notProbedHere: ['comment, conversation and project-email moderation (canModerate)', 'gantt-layout.service shared layouts'],
    fromTheCode: matrix.COMPANY_ADMIN.outsideJson,
    pmHardCodedOverrides: hrA1.pmHardCodedOverrides,
  });
  h.observe('HR-A2.deleteAsUpdate', {
    question: 'HR-A2 (owner, §5): deletes guarded under the module\'s update (or submit) key while the JSON delete row is empty. Should delete be its own key, or does delete mean archive (an update)? Recorded, never failed (adjudication §B).',
    compared: 'the declared key (the probe holds each route to the key it declares)',
    entries: matrix.DECLARED_VS_NATURAL.map((d) => ({
      ...d,
      allowedByDeclaredNotNatural: d.declaredRoles.filter((role) => !d.naturalRoles.includes(role)),
      measured: probes.filter((p) => p.entry === d.id).map((p) => ({ run: p.run, persona: p.persona, role: p.role, expected: p.expected, got: p.got ? `${p.got.status} ${p.got.code || ''}`.trim() : null, verdict: p.verdict })),
    })),
    notProbedHere: 'drawings, drawing sets, transmittals and correspondence (permission-matrix ROUTE_VS_JSON RJ-4): DELETE guarded by document_control update while JSON document_control.delete is []',
  });
  h.observe('throwawayRecords', made);
  h.observe('probes', probes);
};

const cleanup = async () => {
  const notes = [];
  if (runState.s7TemporaryAssignment && runState.d2People?.pm) {
    const { projectId, userId } = runState.s7TemporaryAssignment;
    try {
      const res = await send(runState.d2People.pm, 'DELETE', `/projects/${projectId}/team/${userId}`, { label: 'cleanup.S7.unassign' });
      notes.push(`S7 temporary assignment of the ${D2_CODE} finance administrator removed: ${h.said(res)}`);
    } catch (error) {
      notes.push(`S7 temporary assignment not removed: ${error.message}`);
    }
  }
  try {
    recordEvidence();
  } catch (error) {
    notes.push(`evidence: ${error.message}`);
  }
  notes.push(`${made.length} throwaway records named ${NAME_ROOT}* kept (projects reused by the next run; the rest excluded from read-backs by name)`);
  return notes;
};

if (RUN_AS_MAIN) h.run({ main, cleanup });

module.exports = { PLAN, RULES, buildRequest, classifyProbe, compareModules, expectedModules, judge };
