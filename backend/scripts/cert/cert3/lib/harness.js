'use strict';

/**
 * The CERT-3 harness: the rules every CERT-3 proof and reproduction follows
 * (docs/certification/OCTAPM_CERT3_PLAN.md §4 WP-0 "Harness rules for every
 * CERT-3 proof", §1.4 "Checks assert, they never just note" and "Reproduce
 * before fixing"), written once, in the shape the D-ID-1 proofs
 * (cert3/d-id-1-*.js) already use: a fixed list of checks, PASS/FAIL lines,
 * a 5xx sweep, best-effort cleanup in finally, a JSON result per proof.
 *
 *   const harness = require('./lib/harness');
 *   harness.prepareInProcess();                 // FIRST: before anything loads backend/src
 *   const api = require('../lib/api');
 *   const h = harness.createHarness({ name: 'd-id-3-repro', plan: PLAN, rules: RULES, mailPrefix: 'did3', meta });
 *   h.run({ main: async () => { ... h.check('D3.past', ok, detail) ... }, cleanup: async () => notes });
 *
 * Run through the lock runner only:
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/<script>.js [args]
 *
 * THE RULES, AS IMPLEMENTED
 *
 *  1 check(id, condition, detail) is the only verdict. The plan is a fixed
 *    list of [id, description, opts]; an id outside it, or recorded twice,
 *    throws (a script error). The condition must be a real boolean: anything
 *    else is recorded as an INVALID check (a check that notes instead of
 *    asserting) and makes the run a setup error. There is no assert(), no
 *    probe() and no note that counts.
 *
 *  2 Error codes are asserted with their status. said(res) is the answer as
 *    one string — '401 SESSION_REVOKED', '409 ALREADY_MEMBER', or the bare
 *    status '200' when the body carries no error code; 'no answer' when there
 *    was none. is(res, '409 ALREADY_MEMBER') (or a list of such strings)
 *    compares that string exactly, so a status with the wrong code, or a code
 *    with the wrong status, never matches.
 *
 *  3 Money is compared in integer minor units (cents). toCents(value) takes a
 *    number, a decimal string or a Decimal (Prisma.Decimal / decimal.js) and
 *    returns an exact safe integer. It REFUSES (throws MoneyError) whatever it
 *    cannot represent exactly in `decimals` places (default 2): a float such
 *    as 0.1 + 0.2 (0.30000000000000004), 1.005, NaN, Infinity, a grouped
 *    string ("54,000.00"), an amount beyond Number.MAX_SAFE_INTEGER cents.
 *    It never rounds. sameCents(a, b) compares two amounts that way;
 *    formatCents(c) prints cents for a detail line.
 *
 *  4 A 5xx never passes. is() is never true for a 5xx the plan did not
 *    declare (and refuses to be asked for one: declare it in `allow5xx`).
 *    Every answer the harness sees (keep(), said(), is()) is remembered, and
 *    after main and cleanup the harness records its own check G.5xx: no
 *    answer was a 5xx other than those declared in `allow5xx`
 *    ('503 MEMBERSHIP_WRITES_SUSPENDED', ...). A 5xx is a defect (exit 2).
 *
 *  5 Exit codes. 0 = every check holds (verdict PASS). 2 = a check failed
 *    (verdict DEFECT_PRESENT): in a proof, the rule is broken; in a
 *    reproduction, the defect as reported is present.
 *    1 = setup error: preparation failed, the script or a section threw, a
 *    check marked { setup: true } failed, a check was never run, or a check
 *    was invalid (rule 1). 1 wins over 2: an incomplete run proves nothing,
 *    whatever else it saw (the defect checks that did fail are still in the
 *    result file).
 *
 *  6 Results go to C:\Temp\octapm-cert\results\cert3\<name>.json: every
 *    check with its kind and its detail (passed ones too), the verdict and
 *    exit code, what made it a setup error, the answers counted by status and
 *    every 5xx, observations, leads, the cleanup notes, the rules the checks
 *    rest on, and a provisional classification (rule 8). Secrets never go in:
 *    keys named password/secret/token/keyHash/authorization/cookie and values
 *    shaped like an API key (octapm_...) or a JWT are withheld.
 *
 *  7 Environment. In process (CERT_INPROCESS=1, set by run-locked.js), on the
 *    certification database only (cert-env guard: CERT_DATABASE_URL naming
 *    octapm_cert, the marker row), CERT_PASSWORD set, job worker, schedulers
 *    and the exception engine off, the app's request log off.
 *    prepareInProcess() does this before anything under backend/src is
 *    loaded; a failure there is recorded and the run ends as a setup error.
 *
 *  8 Classification (provisional, for the journal). Checks marked
 *    { defect: '<ID>', rule: '<Rn>' } assert the expected behaviour of a
 *    reported defect. Over them: none failed -> REJECTED; all failed ->
 *    CONFIRMED; some -> PARTIAL; setup error -> UNDETERMINED. A failed check
 *    whose rule is not { status: 'decided' } is listed as depending on that
 *    rule: if the owner decides otherwise it becomes EXPECTED BEHAVIOUR.
 *    EXPECTED BEHAVIOUR and TEST GAP are set at adjudication, never here.
 *    observe(key, value) keeps structured evidence for that adjudication;
 *    lead(text, evidence) keeps something seen in passing — a lead, not
 *    evidence, and never part of the verdict.
 *
 *  9 Fixtures. Throwaway rows of a fresh stamp (mail(label, domain) names
 *    the run's people); writes go through the product unless a script says
 *    "fixture"; cleanup runs in finally, best effort, its notes recorded;
 *    revokeRunInvitations(db) revokes the run's pending invitations, as the
 *    D-ID-1 proofs do. fingerprint.take/changes prove no other company
 *    changed.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HARNESS_VERSION = 'cert3-harness/1';
const BACKEND = path.join(__dirname, '..', '..', '..', '..');
const ENV_FILE = path.join(BACKEND, '.env');
const DB_MODULE = path.join(BACKEND, 'src', 'config', 'db.js');
const RESULT_DIR = 'C:/Temp/octapm-cert/results/cert3';
const STATE_DIR = process.env.CERT_STATE_DIR || 'C:/Temp/octapm-cert/state';
const FIVE_XX_CHECK = 'G.5xx';
const DETAIL_KEEP = 4000;
const DETAIL_PRINT = 1500;
/** Prisma writes UTC wall time into columns without a zone; the certification sessions run in America/Chicago. */
const NOW_UTC = "(now() at time zone 'utc')";
const OFF_IN_PROCESS = ['JOB_WORKER_ENABLED', 'SCHEDULERS_ENABLED', 'EXCEPTIONS_ENGINE_ENABLED'];
const KINDS = new Set(['setup', 'defect', 'guard', 'check']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── rule 7: the environment, before anything under backend/src is loaded ─────
const preparation = { done: false, error: null };

/**
 * Points the in-process application at the certification database and turns
 * the background machinery off. Call it first, before requiring ../lib/api,
 * ../lib/inprocess or anything under src/. Never throws: a failure is kept
 * and the run ends as a setup error with its result file written.
 */
const prepareInProcess = () => {
  if (preparation.done) return preparation;
  preparation.done = true;
  try {
    // eslint-disable-next-line global-require
    require('dotenv').config({ path: ENV_FILE });
    // eslint-disable-next-line global-require
    const guard = require('../../lib/cert-env');
    process.env.DATABASE_URL = guard.certDatabaseUrl();
    for (const name of OFF_IN_PROCESS) process.env[name] = 'false';
    // The proof prints its own PASS/FAIL lines; the app's per-request log is off.
    process.env.REQUEST_LOG_FORMAT = 'off';
  } catch (error) {
    preparation.error = error;
  }
  return preparation;
};

// ── rule 3: money in integer cents ───────────────────────────────────────────
class MoneyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MoneyError';
  }
}

const AMOUNT = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

const describeValue = (value) => {
  try {
    return typeof value === 'bigint' ? `${value}n` : JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

const amountText = (value) => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new MoneyError(`toCents: ${value} is not a finite amount`);
    // The shortest text that reads back as this double: a float that is not
    // the decimal it looks like (0.1 + 0.2) shows its extra digits here.
    return String(value);
  }
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value === 'object' && typeof value.toFixed === 'function' && Object.getPrototypeOf(value) !== Object.prototype) {
    return String(value.toString()); // Prisma.Decimal / decimal.js: exact decimal text
  }
  throw new MoneyError(`toCents: ${describeValue(value)} is not an amount`);
};

/** An amount as an exact integer of minor units; refuses anything it cannot represent exactly (rule 3). */
const toCents = (value, { decimals = 2 } = {}) => {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) throw new MoneyError(`toCents: decimals ${decimals} is not 0-6`);
  const text = amountText(value);
  const match = AMOUNT.exec(text);
  if (!match || `${match[2]}${match[3] || ''}`.length === 0) {
    throw new MoneyError(`toCents: "${text}" is not a plain decimal amount (no grouping, no currency sign)`);
  }
  const [, sign, whole, fraction = '', exponent = '0'] = match;
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, '') || '0';
  // value x 10^decimals = digits x 10^shift
  const shift = Number(exponent) - fraction.length + decimals;
  if (!Number.isSafeInteger(shift) || Math.abs(shift) > 400) throw new MoneyError(`toCents: ${text} is out of range`);
  let cents;
  if (shift >= 0) {
    cents = BigInt(digits) * 10n ** BigInt(shift);
  } else {
    const cut = -shift;
    const kept = digits.length > cut ? digits.slice(0, digits.length - cut) : '0';
    const dropped = digits.length > cut ? digits.slice(digits.length - cut) : digits;
    if (/[^0]/.test(dropped)) {
      throw new MoneyError(`toCents: ${text} has more than ${decimals} decimal place(s); it is not representable exactly in minor units and is refused, never rounded`);
    }
    cents = BigInt(kept);
  }
  if (sign === '-') cents = -cents;
  if (cents > MAX_CENTS || cents < -MAX_CENTS) throw new MoneyError(`toCents: ${text} is beyond the safe integer range in minor units`);
  const n = Number(cents);
  return n === 0 ? 0 : n; // never -0
};

const sameCents = (a, b, options = {}) => toCents(a, options) === toCents(b, options);

/** Cents as text for a detail line: 5400000 -> '54,000.00'. */
const formatCents = (cents, { decimals = 2 } = {}) => {
  if (!Number.isSafeInteger(cents)) throw new MoneyError(`formatCents: ${describeValue(cents)} is not an integer of minor units`);
  const negative = cents < 0;
  const digits = String(Math.abs(cents)).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals) || '0';
  const fraction = decimals ? digits.slice(digits.length - decimals) : '';
  return `${negative ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${decimals ? `.${fraction}` : ''}`;
};

// ── rule 2: an answer is its status and its code ─────────────────────────────
const said = (res) => {
  if (!res || typeof res.status !== 'number') return 'no answer';
  const code = res.body?.error?.code;
  return code ? `${res.status} ${code}` : String(res.status);
};

const statusOfSaid = (text) => Number(String(text).split(' ')[0]);

// ── rule 6: nothing secret in a result ───────────────────────────────────────
const SECRET_KEY = /password|secret|token|keyhash|authorization|cookie/i;
const SECRET_VALUE = [/octapm_[A-Za-z0-9_-]{8,}/g, /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g];
const scrubText = (text) => SECRET_VALUE.reduce((out, pattern) => out.replace(pattern, '(withheld)'), String(text));
const scrub = (value, depth = 0) => {
  if (depth > 10) return '(too deep)';
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return scrubText(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEY.test(key) ? '(withheld)' : scrub(item, depth + 1)]));
  }
  return value;
};

// ── plan entries: [id, description, opts] ────────────────────────────────────
const normalizeEntry = (entry, rules) => {
  if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') {
    throw new Error(`harness: a plan entry is [id, description, opts]: ${describeValue(entry)}`);
  }
  const [id, description, opts = {}] = entry;
  const kind = opts.kind || (opts.setup ? 'setup' : opts.defect ? 'defect' : opts.guard ? 'guard' : 'check');
  if (!KINDS.has(kind)) throw new Error(`harness: check ${id} has an unknown kind ${kind}`);
  if (kind === 'defect' && !opts.defect) throw new Error(`harness: defect check ${id} names no defect`);
  if (opts.rule && !rules[opts.rule]) throw new Error(`harness: check ${id} rests on rule ${opts.rule}, which the plan's rules do not define`);
  return { id, description, kind, defect: opts.defect || null, rule: opts.rule || null };
};

/**
 * One proof or reproduction. `plan` is the fixed list of checks; `rules` the
 * expected-behaviour rules the defect checks rest on ({ R1: { status:
 * 'decided' | 'proposed', statement, sources, open? } }); `allow5xx` the
 * 5xx answers the plan expects ('503 MEMBERSHIP_WRITES_SUSPENDED'); `meta`
 * anything the result file should carry; `mailPrefix` the first part of the
 * run's throwaway e-mails.
 */
const createHarness = ({ name, plan, rules = {}, allow5xx = [], meta = {}, mailPrefix = null }) => {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(String(name || ''))) throw new Error(`harness: a proof name is lower-case letters, digits, dots and dashes: ${describeValue(name)}`);
  if (!Array.isArray(plan) || !plan.length) throw new Error('harness: the plan is a non-empty list of checks');
  for (const [key, rule] of Object.entries(rules)) {
    if (!rule || !['decided', 'proposed'].includes(rule.status) || !rule.statement) throw new Error(`harness: rule ${key} needs a status (decided | proposed) and a statement`);
  }
  for (const text of allow5xx) {
    if (!/^5\d\d [A-Z0-9_]+$/.test(text)) throw new Error(`harness: allow5xx entries are '<5xx> <CODE>': ${describeValue(text)}`);
  }
  const entries = plan.map((entry) => normalizeEntry(entry, rules));
  if (entries.some((entry) => entry.id === FIVE_XX_CHECK)) throw new Error(`harness: ${FIVE_XX_CHECK} is the harness's own check; leave it out of the plan`);
  entries.push({
    id: FIVE_XX_CHECK,
    description: `no answer was a 5xx${allow5xx.length ? ` other than the expected ${allow5xx.join(', ')}` : ''} (a 5xx never passes)`,
    kind: 'guard',
    defect: null,
    rule: null,
  });
  const byId = new Map();
  for (const entry of entries) {
    if (byId.has(entry.id)) throw new Error(`harness: check ${entry.id} is in the plan twice`);
    byId.set(entry.id, entry);
  }

  const STAMP = crypto.randomBytes(3).toString('hex');
  const RUN_START = new Date();
  const recorded = new Map();
  const answers = [];
  const answerOf = new WeakMap();
  const observations = {};
  const leads = [];
  const sectionErrors = [];
  const clients = [];
  const runEmails = new Set();
  let sweeping = false;

  // ── rule 4: every answer is remembered for the 5xx sweep ──
  const track = (res, label = null) => {
    if (!res || typeof res !== 'object' || typeof res.status !== 'number') return;
    const known = answerOf.get(res);
    if (known) {
      if (label && known.label === '(unlabelled)') known.label = label;
      return;
    }
    const entry = { label: label || '(unlabelled)', status: res.status, code: res.body?.error?.code || null };
    answerOf.set(res, entry);
    answers.push(entry);
  };
  const allowed = (entry) => allow5xx.includes(`${entry.status} ${entry.code || ''}`.trim());

  const keep = (label, res) => {
    track(res, label);
    return res;
  };
  const saidTracked = (res) => {
    track(res);
    return said(res);
  };
  const is = (res, expected) => {
    const list = Array.isArray(expected) ? expected : [expected];
    for (const text of list) {
      if (statusOfSaid(text) >= 500 && !allow5xx.includes(text)) {
        throw new Error(`harness: is(res, '${text}') asks for a 5xx the plan did not declare in allow5xx`);
      }
    }
    track(res);
    return list.includes(said(res));
  };
  const settle = (promise) => promise.catch((error) => ({ status: 0, body: { error: { code: `THROWN ${error.message}` } }, text: '' }));

  // ── rule 1: the only verdict ──
  const check = (id, condition, detail = '') => {
    const entry = byId.get(id);
    if (!entry) throw new Error(`unknown check ${id}`);
    if (recorded.has(id)) throw new Error(`check ${id} recorded twice`);
    if (id === FIVE_XX_CHECK && !sweeping) throw new Error(`${FIVE_XX_CHECK} is recorded by the harness itself`);
    const invalid = typeof condition !== 'boolean';
    const ok = condition === true;
    const text = scrubText(invalid ? `INVALID: the condition was ${typeof condition} (${describeValue(condition)?.slice?.(0, 80)}), not a boolean; a check asserts, it does not note. ${detail}` : detail);
    recorded.set(id, {
      id,
      name: entry.description,
      kind: entry.kind,
      defect: entry.defect,
      rule: entry.rule,
      ok,
      ...(invalid ? { invalid: true } : {}),
      detail: text.slice(0, DETAIL_KEEP),
    });
    const tag = ok ? 'PASS' : entry.kind === 'setup' ? 'FAIL (setup)' : 'FAIL';
    console.log(`${tag}  ${id}  ${entry.description}${!ok && text ? `\n        ${text.slice(0, DETAIL_PRINT)}` : ''}${ok && process.env.CERT_VERBOSE === '1' && text ? `\n        ${text.slice(0, DETAIL_PRINT)}` : ''}`);
    return ok;
  };

  const observe = (key, value) => {
    if (Object.prototype.hasOwnProperty.call(observations, key)) throw new Error(`observation ${key} recorded twice`);
    observations[key] = scrub(value);
    return value;
  };

  const lead = (text, evidence = null) => {
    leads.push({ text: scrubText(text), evidence: scrub(evidence) });
    console.log(`LEAD  ${scrubText(text)}`);
  };

  const section = async (title, fn, { onError = null } = {}) => {
    console.log(`\n── ${title} ──`);
    try {
      await fn();
    } catch (error) {
      sectionErrors.push({ title, error: scrubText(String(error?.stack || error?.message || error)).slice(0, DETAIL_KEEP) });
      console.log(`SECTION ERROR (${title}): ${scrubText(error?.stack || error?.message || error)}`);
      if (onError) {
        try { await onError(error); } catch { /* best effort */ }
      }
    }
  };

  // ── rule 9: the run's own throwaway e-mails, fixtures and environment ──
  const mail = (label, domain) => {
    if (!mailPrefix) throw new Error('harness: createHarness({ mailPrefix }) names the run\'s e-mails');
    const email = `${mailPrefix}.${label}.${STAMP}@${domain}`.toLowerCase();
    runEmails.add(email);
    return email;
  };

  const companies = (...codes) => {
    // eslint-disable-next-line global-require
    const { buildPopulation } = require('../../lib/spec');
    const { companies: all } = buildPopulation();
    return codes.map((code) => {
      const found = all.find((company) => company.code === code);
      if (!found) throw new Error(`no certification company ${code}`);
      return found;
    });
  };

  const projectId = (code, number = '01') => {
    const file = path.join(STATE_DIR, 'inventory', `${code}.json`);
    const id = JSON.parse(fs.readFileSync(file, 'utf8')).projects?.[`${code}-${number}`]?.id;
    if (!id) throw new Error(`no project ${code}-${number} in ${file}`);
    return id;
  };

  const connect = async () => {
    // eslint-disable-next-line global-require
    const guard = require('../../lib/cert-env');
    const client = await guard.connectCert();
    clients.push(client);
    return client;
  };

  const sql = (db) => {
    const q = async (text, params = []) => (await db.query(text, params)).rows;
    const one = async (text, params = []) => (await q(text, params))[0] || null;
    return { q, one };
  };

  const orgOf = async (db, code) => {
    const row = (await db.query('select id, name, slug from "Organisation" where slug like $1', [`cert-${code}-%`])).rows[0];
    if (!row) throw new Error(`no organisation for certification company ${code}`);
    return row;
  };

  /**
   * A timestamp column as the API serialises it ('2020-01-02T03:04:05.000Z').
   * Prisma writes UTC wall time into columns without a zone; the pg driver
   * would read them as local time, so they are never parsed by it.
   */
  const sqlIso = (column) => `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

  /** The run's pending invitations revoked, as the D-ID-1 proofs' cleanup does. Returns the count. */
  const revokeRunInvitations = async (db) => {
    if (!runEmails.size) return 0;
    const revoked = await db.query(
      `update "InvitationToken" set status = 'revoked', "revokedAt" = ${NOW_UTC}, "updatedAt" = ${NOW_UTC}
        where status = 'pending' and "createdAt" >= ($1::timestamptz at time zone 'utc') and email = any($2::text[])`,
      [RUN_START.toISOString(), [...runEmails]],
    );
    return revoked.rowCount;
  };

  const fingerprint = {
    // eslint-disable-next-line global-require
    take: (db) => require('../../isolation/fingerprint').take(db),
    /** Changes between two fingerprints outside the request-noise tables and the companies in `exclude` (codes). */
    changes: (before, after, { exclude = [] } = {}) =>
      // eslint-disable-next-line global-require
      require('../../isolation/fingerprint').compare(before, after).filter((change) => !change.noise && !exclude.includes(change.org)),
  };

  // ── rule 8: provisional classification ──
  const classify = (list, setupError) => {
    const defects = list.filter((r) => r.kind === 'defect');
    const guardsFailed = list.filter((r) => r.kind === 'guard' && !r.ok).map((r) => r.id);
    if (!defects.length) return { provisional: null, basis: 'this plan has no defect checks', guardsFailed };
    if (setupError) {
      return {
        provisional: 'UNDETERMINED',
        basis: 'setup error: the run proves nothing either way',
        defectChecksThatFailedAnyway: defects.filter((r) => !r.ok && !r.notRun).map((r) => r.id),
        guardsFailed,
      };
    }
    const failed = defects.filter((r) => !r.ok);
    const provisional = failed.length === 0 ? 'REJECTED' : failed.length === defects.length ? 'CONFIRMED' : 'PARTIAL';
    const pending = {};
    for (const r of failed) {
      if (r.rule && rules[r.rule]?.status !== 'decided') (pending[r.rule] = pending[r.rule] || []).push(r.id);
    }
    return {
      provisional,
      basis: `${failed.length} of ${defects.length} defect checks show the reported behaviour`,
      defects: [...new Set(defects.map((r) => r.defect))],
      reproduced: failed.map((r) => r.id),
      notReproduced: defects.filter((r) => r.ok).map((r) => r.id),
      dependsOnUndecidedRules: Object.entries(pending).map(([rule, ids]) => ({
        rule,
        status: rules[rule].status,
        statement: rules[rule].statement,
        open: rules[rule].open || null,
        checks: ids,
        ifTheOwnerDecidesOtherwise: 'these checks become EXPECTED BEHAVIOUR',
      })),
      guardsFailed,
      note: 'EXPECTED BEHAVIOUR and TEST GAP are set at adjudication (journal), never by the harness; guard and 5xx failures are reported beside the classification, not folded into it.',
    };
  };

  const closeAll = async () => {
    for (const client of clients) {
      try { await client.end(); } catch { /* closed */ }
    }
    try {
      const resolved = require.resolve(DB_MODULE);
      if (require.cache[resolved]) await require.cache[resolved].exports?.prisma?.$disconnect?.();
    } catch { /* not loaded or closed */ }
  };

  /**
   * Runs `main`, then `cleanup` (always, best effort, returning notes), then
   * the 5xx sweep; writes the result file; exits with 0, 1 or 2 (rule 5).
   */
  const run = async ({ main, cleanup = null, exit = true }) => {
    const started = new Date();
    let scriptError = null;
    const cleanupNotes = [];
    if (!preparation.done) scriptError = new Error('harness.prepareInProcess() was not called before anything under backend/src was loaded');
    else if (preparation.error) scriptError = preparation.error;
    try {
      if (!scriptError) {
        if (process.env.CERT_INPROCESS !== '1') throw new Error('run through C:\\Temp\\octapm-cert\\run-locked.js (CERT_INPROCESS=1)');
        if (!process.env.CERT_PASSWORD) throw new Error('CERT_PASSWORD is not set');
        console.log(`${name}: stamp ${STAMP}; ${entries.length} checks (fixed)\n`);
        await main(harnessApi);
      }
    } catch (error) {
      scriptError = error;
      console.error(`SCRIPT ERROR: ${scrubText(error?.stack || error?.message || error)}`);
    } finally {
      if (cleanup && !preparation.error && preparation.done) {
        try {
          const notes = await cleanup(harnessApi);
          if (Array.isArray(notes)) cleanupNotes.push(...notes.map((n) => scrubText(n)));
        } catch (error) {
          cleanupNotes.push(`cleanup: ${scrubText(error?.message || error)}`);
        }
      }
    }

    // Rule 4: the harness's own check, over every answer of the run (cleanup's too).
    sweeping = true;
    const unexpected = answers.filter((a) => a.status >= 500 && !allowed(a));
    check(FIVE_XX_CHECK, unexpected.length === 0, unexpected.length
      ? unexpected.map((a) => `${a.label} ${a.status} ${a.code || ''}`.trim()).join(', ')
      : `${answers.length} answers, none an unexpected 5xx`);
    sweeping = false;

    for (const entry of entries) {
      if (!recorded.has(entry.id)) {
        recorded.set(entry.id, { id: entry.id, name: entry.description, kind: entry.kind, defect: entry.defect, rule: entry.rule, ok: false, notRun: true, detail: 'not run' });
        console.log(`FAIL  ${entry.id}  ${entry.description}\n        not run`);
      }
    }
    const list = entries.map((entry) => recorded.get(entry.id));
    const failedSetupChecks = list.filter((r) => r.kind === 'setup' && !r.ok && !r.notRun).map((r) => r.id);
    const notRun = list.filter((r) => r.notRun).map((r) => r.id);
    const invalid = list.filter((r) => r.invalid).map((r) => r.id);
    const setupError = Boolean(scriptError) || sectionErrors.length > 0 || failedSetupChecks.length > 0 || notRun.length > 0 || invalid.length > 0;
    const failed = list.filter((r) => !r.ok);
    const exitCode = setupError ? 1 : failed.length ? 2 : 0;
    // DEFECT_PRESENT: in a reproduction the reported behaviour is there; in a proof the rule it proves is broken.
    const verdict = setupError ? 'SETUP_ERROR' : failed.length ? 'DEFECT_PRESENT' : 'PASS';
    const byStatus = {};
    for (const a of answers) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    const classification = classify(list, setupError);

    console.log(`\ncleanup: ${cleanupNotes.join('; ') || 'nothing'}`);
    console.log(`${name}: ${list.length - failed.length} passed, ${failed.length} failed of ${list.length} (fixed); ${verdict}, exit ${exitCode}`);
    if (classification.provisional) console.log(`${name}: provisional classification ${classification.provisional} (${classification.basis})`);

    const result = {
      proof: name,
      harness: HARNESS_VERSION,
      stamp: STAMP,
      startedAt: started.toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode,
      verdict,
      total: list.length,
      passed: list.length - failed.length,
      failed: failed.length,
      scriptError: scriptError ? scrubText(String(scriptError.stack || scriptError.message)) : null,
      setupError: setupError ? { failedSetupChecks, notRun, invalid, sectionErrors } : null,
      classification,
      rules,
      meta: scrub(meta),
      checks: list,
      observations,
      leads,
      answers: { total: answers.length, byStatus, fiveXX: answers.filter((a) => a.status >= 500) },
      cleanup: cleanupNotes,
    };
    try {
      fs.mkdirSync(RESULT_DIR, { recursive: true });
      fs.writeFileSync(path.join(RESULT_DIR, `${name}.json`), JSON.stringify(result, null, 1));
    } catch (error) {
      console.error(`could not write the result file: ${error.message}`);
    }
    await closeAll();
    if (exit) process.exit(exitCode);
    return exitCode;
  };

  const harnessApi = {
    name,
    STAMP,
    RUN_START,
    NOW_UTC,
    runEmails,
    check,
    said: saidTracked,
    is,
    keep,
    settle,
    section,
    observe,
    lead,
    mail,
    companies,
    projectId,
    connect,
    sql,
    orgOf,
    sqlIso,
    revokeRunInvitations,
    fingerprint,
    toCents,
    sameCents,
    formatCents,
    sleep,
    run,
  };
  return harnessApi;
};

module.exports = {
  FIVE_XX_CHECK,
  HARNESS_VERSION,
  MoneyError,
  NOW_UTC,
  RESULT_DIR,
  createHarness,
  formatCents,
  prepareInProcess,
  said,
  sameCents,
  scrub,
  toCents,
};
