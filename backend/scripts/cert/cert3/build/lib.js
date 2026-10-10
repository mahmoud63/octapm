'use strict';

/**
 * CERT-3 deep-company builders: the shared library.
 *
 * docs/certification/OCTAPM_CERT3_PLAN.md §3.2 (what each new project holds)
 * and §3.3 (how the companies are built): API only, as the population
 * personas, every creation asserted, resumable without duplicates, files
 * generated from the answer book. The harness rules of cert3/lib/harness.js
 * apply: a 5xx never passes, answers are compared as '<status> <CODE>', money
 * in cents, results as JSON, exit 0 / 2 / 1.
 *
 * ONE BUILDER = ONE PROJECT CODE in one deep company, in its own file
 * build/<code in lower case>.js (087-SCH -> 087-sch.js), run by run-all.js in
 * plan order, or alone for debugging through the proof lock (from backend/,
 * with DATABASE_URL unset):
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/build/087-sch.js
 *
 *   const lib = require('./lib');
 *   lib.main('087-SCH', async (b) => {
 *     await b.project({ title: 'Programme', payload: { startDate: '2026-01-05', projectCalendar: 'five_day', currency: 'EGP' },
 *                       fields: { projectCalendar: 'five_day', currency: 'EGP' } });
 *     await b.team({ planner: 'planning_eng', site: 'site_engineer', qs: 'qs' });
 *     const f1 = await b.step('import.F1', async (s) => {
 *       const file = lib.files.xer(lib.files.F1(), { filename: b.file('F1.xer') });
 *       const data = await s.upload('import.F1', 'planner', `${b.P}/import/xer`, file,
 *                                   { fields: { 'summary.activities': 14 } });
 *       return { revisionId: data.revisionId };
 *     });
 *     await b.step('approve.F1', async (s) => {
 *       await s.act('approve.F1', 'pm', 'POST', `${b.P}/schedule/revisions/${f1.revisionId}/approve`, {},
 *                   { fields: { status: 'approved' }, known: { ref: 'HR-S2', said: ['400 SCHEDULE_NOT_READY'] } });
 *     }, { needs: ['import.F1'] });
 *   });
 *
 * ── THE BUILD (b) ─────────────────────────────────────────────────────────
 *   b.code, b.company, b.orgId        '087-SCH', the resolved company, its org id
 *   b.projectId, b.P                  the build's project and '/projects/<id>' (after b.project)
 *   b.today                           the run date: the earlier of today in UTC and today in the
 *                                     company's zone, so a date given as "today" is never ahead
 *                                     of the run date on either clock
 *   b.date(n, { future })             today + n calendar days; n > 0 refused unless { future: true }
 *   b.past(iso)                       asserts a transaction date is on or before the run date
 *   b.name(t) / b.ref(s) / b.file(f)  'CERT3 <t> (<code>)' / 'CERT3-<code>-<s>' / 'CERT3-<code>-<f>'
 *   await b.step(name, fn, { needs, verify })
 *                                     runs fn(s) unless the state file has it done. A done step is
 *                                     re-verified (every record it made is read back with a GET,
 *                                     then verify(s, out) if given) and returns the out it returned
 *                                     the first time (JSON). A step never finished (killed, failed
 *                                     or BLOCKED before) runs again with s.dirty = true; whatever it
 *                                     already made is skipped, not made twice. needs: steps that
 *                                     must be done; if one is BLOCKED this step is recorded BLOCKED
 *                                     too (the same ref) and returns undefined.
 *                                     THE get: null RULE (adjudication G4 / R3-16): a create or
 *                                     upload recorded with no read-back route (opts.get: null, or an
 *                                     upload with no opts.get) is never read back by the lib, so its
 *                                     step MUST pass `verify`, and that verify must read the records
 *                                     live. Enforced three times, each a BuildError (exit 1) naming
 *                                     the records: when the step is called while the state already
 *                                     holds such records of it and no verify is given; when the step
 *                                     body finishes having recorded such records with no verify (the
 *                                     step is then 'failed', its records kept, never made twice); and
 *                                     on a resume, when the verify returned true without one request
 *                                     answered (it read nothing live). Acts are not covered: an
 *                                     interrupted act needs opts.verify, and a done act is read back
 *                                     only when opts.get names a route.
 *   b.blocked(name, ref, observed)    records a step BLOCKED without running it (an undecided rule
 *                                     that stops it outright). ref: see REFS below. The build then
 *                                     exits 2.
 *   b.finding(ref, text)              adjudication G2: a departure from the plan or the answer book,
 *                                     or a product refusal worked around, that is NOT a BLOCKED step
 *                                     ('L114', 'WP4-OVR-1', ...). ref: see REFS below (a bad ref is a
 *                                     BuildError). text: what was observed, non-empty (kept up to 4000
 *                                     characters, secrets redacted). Inside a step it carries that
 *                                     step's name (s.finding(ref, text) is the same). Persisted in the
 *                                     state file (state.findings) the moment it is made, so a resumed
 *                                     run still reports it; printed as a FINDING line at the end of
 *                                     the run, kept in the results file (findings: [{ ref, step,
 *                                     stepStatus, text, at, run }]) and in run-all's summary. The same
 *                                     (ref, step, text) is kept once (times / lastAt count repeats).
 *                                     A finding never changes the exit code and never replaces an
 *                                     assertion: a step that only notes a failure is a failed build.
 *                                     Returns { ref, step, text }.
 *   await b.project({ title, persona = 'pm', payload, fields })
 *                                     step 'project': finds the live project named b.name(title)
 *                                     (adopts it, never a second one: the 25-project limits), else
 *                                     creates it (201, name and `fields` asserted); sets b.P.
 *   await b.team({ key: role | null }, { persona = 'pm', step = 'team' })
 *                                     puts people on the project (201, or 200 when already there),
 *                                     assignmentRole asserted; null = their company role. A POST cut
 *                                     off before its answer was recorded is resumed by finding the
 *                                     assignment by userId in GET /team (never re-sent blind); the
 *                                     step's verify re-reads every member live on a resume.
 *   await b.invite(key, { inviter = 'pm', email, role, name, projectId, projectPartyId })
 *                                     a person NOT in the population (006's finance person,
 *                                     087-FLD's party user), by invitation and acceptance
 *                                     (lib/invitations.js createByInvitation): invited 201, accepted
 *                                     200, then a session of their own asserted. Afterwards `key`
 *                                     is a persona of this build like any other. With
 *                                     projectPartyId the person is a guest: they hold
 *                                     external_party, whatever role the offer named.
 *   b.person(key) / await b.session(key) / await b.userId(key)
 *                                     key = a persona key ('pm', 'qs', 'owner'), a staff key
 *                                     ('layla.haddad.12'), a multi-company key ('shared.12'), an
 *                                     invited key, or an e-mail. The session is api.as({ email,
 *                                     orgId }) — the org is always named — and is asserted once by
 *                                     GET /auth/me: same user id as the population, this org, this
 *                                     role.
 *   b.company.staff(role)             the population staff of a role (no persona), for 087-OTH.
 *   await b.companyOf('088')          another company, resolved and asserted the same way (outsiders)
 *   b.other('087-EXC')                another build's state, read only: .projectId .P .id(name)
 *                                     .out(step) .person(key)
 *   await b.get(persona, route)       a read, asserted 200; returns data
 *   await b.send(persona, method, route, payload)
 *                                     the raw answer { status, body } (a 5xx still fails the build)
 *   b.id(name) / b.record(name) / b.out(step) / b.isDone(step) / b.isBlocked(step)
 *   b.assert(condition, message)      condition must be exactly true, else the build fails
 *   b.expectFields(data, fields)      asserts opts.fields-style fields on data that was read
 *   b.note(text)                      never a verdict. Persisted in the state file (state.notes, with
 *                                     the running step's name), so a resumed run's results still carry
 *                                     it (notes: [{ step, text, at, run }]); the same (step, text) is
 *                                     kept once. A departure or a worked-around refusal is NOT a note:
 *                                     it is b.finding or a BLOCKED step (G2).
 *
 * ── INSIDE A STEP (s) ─────────────────────────────────────────────────────
 *   Every request names the record it makes (`name`, unique in the build; '087-SCH'-wide).
 *   It is marked pending in the state file before it is sent and recorded with its id after,
 *   so a killed run never makes it twice: a record already made is read back (GET) and its
 *   data returned; a pending one (sent, answer never recorded) needs opts.find (create,
 *   upload, refused) or opts.verify (act) to tell whether it took effect, and otherwise
 *   stops the build with instructions.
 *
 *   await s.create(name, persona, route, payload, opts)   POST (opts.method to change), expect 201
 *   await s.upload(name, persona, route, file, opts)      multipart; `file` is a files.js object
 *                                                         { filename, body, contentType }; opts.form
 *                                                         extra form fields, opts.field (default 'file')
 *   await s.act(name, persona, method, route, payload, opts)   a transition, expect 200
 *   await s.refused(name, persona, method, route, payload, '409 CODE', opts)
 *                                     a refusal the plan expects, asserted by status and code
 *   await s.get(...) / s.send(...)    as b.get / b.send
 *   s.blocked(ref, observed)          stop this step as BLOCKED (observed: an answer or a text)
 *   s.finding(ref, text)              b.finding with this step's name
 *   s.assert(condition, message), s.expectFields(data, fields), s.id(name), s.note(text),
 *   s.dirty (an earlier attempt of this step was interrupted), s.name
 *
 *   An answer outside `expect`: a 4xx (or 3xx) made nothing, so the record is dropped and the
 *   next run asks again. A 2xx is KEPT as an 'unexpected' record, with its id or without one
 *   (an act answered 201 where 200 was expected, a create whose answer names no id): a later
 *   run never sends it again and stops on it ("resolve it by hand"), or reports it BLOCKED when
 *   that 2xx is the `known` answer. The same holds for s.refused wrongly accepted.
 *
 *   opts:
 *     expect   a status (201) or '<status> <CODE>', or a list; never a 5xx
 *     fields   REQUIRED, non-empty: { 'dotted.path': expected } asserted on the answer's data.
 *              expected: a value (numbers compare by value), a matcher (lib.is.cents(54000),
 *              lib.is.day('2026-01-05'), lib.is.present, lib.is.absent, lib.is.oneOf([..]),
 *              lib.is.count(n), lib.is.number(n)), or (value, data) => true | 'what was wanted'.
 *              '$status' reads the answer's status (for a 204).
 *     get      the read-back route: default for create `${route}/${id}`, for upload none; a string
 *              (':id' is replaced), (id, data) => route, or null (no GET). A list answer ({ items },
 *              a bare array, or any array property) is searched for the id. A create or upload
 *              with no route REQUIRES the step-level verify that reads it live (the get: null rule
 *              above, enforced).
 *     idOf     (data) => id (default data.id ?? data.item.id)
 *     find     async (s) => the existing record | null: adopts what an interrupted run made
 *     adopt    true: run find before every create, not only after an interruption
 *     verify   (act) async (s) => truthy when the transition already took effect
 *     known    { ref, said: ['201', '409 CODE'] }: the answer a registered defect or undecided
 *              rule gives today. If THAT answer comes back the step is BLOCKED (ref + observed);
 *              any other unexpected answer fails the build. Never used to make a step green.
 *              ref: see REFS below.
 *     named    false for a record with no text to carry the project code (by default create,
 *              upload and refused assert that the payload — or an upload's filename/form —
 *              contains b.code; act does not, unless named: true)
 *
 * ── REFS (adjudication G3) ────────────────────────────────────────────────
 *   Every BLOCKED ref (s.blocked, b.blocked, opts.known.ref) and every finding ref is one of:
 *     a register id   one that appears in docs/certification/*.md: L34, L114, D-FUN-1, X-FINANCE-1,
 *                     WP0-INV-1, RFI-DRAFT (families Ln, AREA-NAME-n, WPn-NAME-n, NAME-DRAFT);
 *     an HR id        HR-C1, HR-S2, ... (the plan's HR table);
 *     a suspect id    registered by the builders' adjudication: WP1-RB-1, WP3-TZ-1, WP4-OVR-1,
 *                     WP4-DRAFTS-1, WP5-SVC-1, WP5-AWD-1, WP8-TRN-1 (lib.SUSPECT_REFS).
 *   PLAN-* and ADJ-* are refused: those items are decided by the adjudication, so the ref is the
 *   register or HR id it names. Anything else is a BuildError (exit 1), never a BLOCKED step.
 *   lib.refProblem(ref) returns why a ref is refused, or null.
 *
 * ── SECRETS (adjudication G8) ─────────────────────────────────────────────
 *   lib.main hooks process.stdout and process.stderr before anything runs, so every line the build
 *   prints is redacted, the product's in-process mail console included (lib/invitations.js still
 *   captures the raw mail: it reads console.log's arguments before they reach the stream). Redacted
 *   to '<redacted>': portal links /rfq(s)/<token> and /bid(s)/<token> (a UUID there is a record id
 *   and stays), account links (accept-invite, reset-password, verify-email, sso) with the token in
 *   the path or in ?token= / &ticket= / any *token= query parameter, "token"/"secret"/"password"
 *   fields printed as text, any other opaque token of 32+ characters (upper, lower and digits, not a
 *   UUID) as a URL path segment or query value, whsec_ secrets, the CERT_PASSWORD value; API keys
 *   (octapm_...) and JWTs become '(withheld)' (harness.scrub). The results file goes through the
 *   same redaction. The state file is NOT redacted (a resume may need what it holds): never print
 *   it, and keep personal links out of it (087-COM strips portalUrl). lib.redact(text),
 *   lib.redactDeep(value) and lib.hookOutput() serve scripts that do not run through lib.main;
 *   run-all.js applies the same rules to what it tees into its logs.
 *
 * ── FILES, ANSWERS, HELPERS ───────────────────────────────────────────────
 *   lib.files     build/files.js: F1() F1b() F1withTail() F1float5() F2()..F6(), xer(model|[models],
 *                 { filename, encoding }), p6xml, mspdi, scheduleXlsx(model, { calendar }),
 *                 progressXer, boqRows.sch087()/ev()/filler(), boqWorkbook(rows, opts), selfCheck()
 *   lib.answers   { schedule, commercial, fieldControls } (answers/*.js)
 *   lib.is, lib.said, lib.toCents, lib.formatCents, lib.sameCents, lib.dates
 *
 * ── STATE, RESULTS, EXIT ──────────────────────────────────────────────────
 *   state    C:\Temp\octapm-cert\state\cert3\<code>.json (written after every step and every
 *            request; atomic). --fresh moves it aside first (<code>.prev-<time>.json): use it on
 *            the first run after a database restore, never on a resume. <code>.lock keeps a
 *            second run of the same build out while the first is alive. It also keeps the notes
 *            (state.notes) and findings (state.findings) of every run, so a resume reports them.
 *   results  C:\Temp\octapm-cert\results\cert3\build-<code>.json (redacted): verdict, steps,
 *            blocked, failure, records, answers, notes, findings
 *            (CERT_WORK_DIR, default C:\Temp\octapm-cert, moves both: the debug harnesses set it
 *            to C:\Temp\octapm-cert\scratch\build-debug so their state never lands in state\cert3)
 *   exit     0 built (every step done) / 2 incomplete (BLOCKED steps, documented) /
 *            1 failed or setup error (an unexpected answer, a field that does not match, a 5xx,
 *            a person who cannot sign in, a company that does not resolve)
 *
 * Modes: in process when CERT_INPROCESS=1 (run-locked.js; the product's app is
 * loaded here on the certification database), else HTTP to CERT_API_BASE
 * (:5190; run-all.js under run-with-watchdog.js). Invitation links are read in
 * process from the captured console, over HTTP from CERT_API_LOG (default
 * logs/api.log). The certification database is read (never written) to
 * resolve a company by slug and to match an invitation link to its row.
 *
 * Test hook (lib self-test only): CERT3_BUILD_CRASH_AFTER_SEND=<record name>
 * stops the process right after that request is answered and before the
 * answer is recorded — the window a killed run leaves — to prove the resume.
 *
 * Debug harnesses (a builder body run under another code, an archiver of
 * debug projects) are not part of the population and do not live in build/
 * (adjudication G9): they are in C:\Temp\octapm-cert\scratch\build-debug\,
 * with their state and results there too. _smoke.js stays here as the lib's
 * self-test; run-all.js never runs it.
 */

const harness = require('../lib/harness');

// FIRST, before anything under backend/src can load: the in-process app is
// pointed at the certification database and the background machinery is off.
const preparation = harness.prepareInProcess();

const fs = require('fs');
const path = require('path');
const api = require('../../lib/api');
const certEnv = require('../../lib/cert-env');
const invitations = require('../../lib/invitations');
const { buildPopulation, ROLES } = require('../../lib/spec');

const VERSION = 'cert3-build/1';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STATE_DIR = path.join(WORK, 'state', 'cert3');
const RESULT_DIR = path.join(WORK, 'results', 'cert3');
const INPROCESS = process.env.CERT_INPROCESS === '1';
const VERBOSE = process.env.CERT_VERBOSE === '1';
const CRASH_AFTER_SEND = process.env.CERT3_BUILD_CRASH_AFTER_SEND || null;

const CODE = /^(\d{3})-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const REF = /^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*$/;
const ANSWER = /^[1-4]\d\d(?: [A-Z0-9_]+)?$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DATA_KEEP = 16 * 1024;

// ── refs (adjudication G3) ───────────────────────────────────────────────────
/** Suspects registered by the builders' adjudication (2026-10-09), valid refs before any doc lists them. */
const SUSPECT_REFS = Object.freeze(['WP1-RB-1', 'WP3-TZ-1', 'WP4-OVR-1', 'WP4-DRAFTS-1', 'WP5-SVC-1', 'WP5-AWD-1', 'WP8-TRN-1']);
/** Items the adjudication decides: never a ref. */
const DECIDED_REF = /^(?:PLAN|ADJ)(?:[.-]|$)/;
/** The register: docs/certification/*.md of this worktree. */
const REGISTER_DIR = path.resolve(__dirname, '..', '..', '..', '..', '..', 'docs', 'certification');
/** Register id families: HR-C1, L114, D-FUN-1 / X-FINANCE-1 / WP0-INV-1, RFI-DRAFT. */
const REGISTER_ID = /\b(?:HR-[A-Z]+\d+[a-z]?|L\d{1,4}|[A-Z]{1,8}\d{0,2}-[A-Z]+-\d+|[A-Z]+-DRAFT)\b/g;
let registerMemo = null;

/** Every register id the docs name (read once). Unreadable docs fail closed: no ref can be checked. */
const registerIds = () => {
  if (registerMemo) return registerMemo;
  const ids = new Set(SUSPECT_REFS);
  let files;
  try {
    files = fs.readdirSync(REGISTER_DIR).filter((f) => f.toLowerCase().endsWith('.md'));
  } catch (error) {
    throw new BuildError(`the register ${REGISTER_DIR} cannot be read, so no BLOCKED or finding ref can be checked (G3): ${error.message}`);
  }
  if (!files.length) throw new BuildError(`the register ${REGISTER_DIR} holds no .md file, so no BLOCKED or finding ref can be checked (G3)`);
  for (const file of files) {
    const text = fs.readFileSync(path.join(REGISTER_DIR, file), 'utf8');
    for (const match of text.matchAll(REGISTER_ID)) ids.add(match[0]);
  }
  registerMemo = ids;
  return ids;
};

/** Why `ref` is not a valid BLOCKED or finding ref (G3), or null when it is. */
const refProblem = (ref) => {
  if (typeof ref !== 'string' || !REF.test(ref)) return `${JSON.stringify(ref)} is not an id (capital letters, digits, '-' and '.'; e.g. 'HR-C1', 'L34', 'WP0-INV-1')`;
  if (DECIDED_REF.test(ref)) return `${ref}: PLAN-* and ADJ-* refs are not allowed; the adjudication decides those items, so cite the register or HR id it names`;
  if (SUSPECT_REFS.includes(ref)) return null;
  if (!registerIds().has(ref)) {
    return `${ref} is not a register id, an HR id or a suspect id: docs/certification/*.md does not name it (register families HR-Xn, Ln, AREA-NAME-n, WPn-NAME-n, NAME-DRAFT) and it is not one of the adjudication's suspects (${SUSPECT_REFS.join(', ')})`;
  }
  return null;
};

const checkRef = (ref, what) => {
  const problem = refProblem(ref);
  if (problem) throw new BuildError(`${what}: ${problem} (adjudication G3)`);
  return ref;
};

// ── secrets never printed (adjudication G8) ──────────────────────────────────
const REDACTED = '<redacted>';
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A long random token: 32+ characters with upper case, lower case and digits, and not a UUID. */
const opaqueToken = (value) => value.length >= 32 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value) && !UUID_TEXT.test(value);
const keepUuid = (all, head, value) => (UUID_TEXT.test(value) ? all : `${head}${REDACTED}`);
/** Same rules in run-all.js (REDACTIONS there): keep the two in step. */
const REDACTIONS = [
  // A portal's personal link: /rfq/<token>, /rfqs/<token>, /bid/<token>, /bids/<token>; a UUID there is a record id.
  [/(\/(?:rfqs?|bids?)\/)([A-Za-z0-9_~-]{12,})/gi, keepUuid],
  // An account link's token as a path segment.
  [/(\/(?:accept-invite|accept-invitation|invitations\/accept|invite|reset-password|password-reset|reset|verify-email|magic-link|sso\/complete)\/)([A-Za-z0-9_~.%-]{8,})/gi, keepUuid],
  // A token-like query parameter, whatever its value: ?token= &accessToken= &ticket= &code_verifier= ...
  [/([?&#;](?:[A-Za-z_]*token|ticket|code_verifier|verifier|nonce|sig|signature|secret|otp|api_?key|password)=)([^&#\s"'<>\\]+)/gi, `$1${REDACTED}`],
  // A token, secret, password or ticket field printed as text ("token":"...", accessToken: ..., password=...).
  [/(["']?[A-Za-z_]*(?:token|secret|password|ticket)["']?\s*[:=]\s*["']?)([^"'\s,;&}\]]{8,})/gi, (all, head, value) => (value === REDACTED || value === '(withheld)' ? all : `${head}${REDACTED}`)],
  // Any other long opaque token as a URL path segment or a query value.
  [/([/=])([A-Za-z0-9_-]{32,})(?![A-Za-z0-9_-])/g, (all, head, value) => (opaqueToken(value) ? `${head}${REDACTED}` : all)],
  // Webhook secrets (API keys octapm_... and JWTs: harness.scrub).
  [/whsec_[A-Za-z0-9_-]{8,}/g, REDACTED],
];

/** `value` as text with every secret the rules know replaced (G8). */
const redact = (value) => {
  if (value === null || value === undefined) return value;
  let text = String(harness.scrub(String(value)));
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  const password = process.env.CERT_PASSWORD;
  if (password && password.length >= 6 && text.includes(password)) text = text.split(password).join(REDACTED);
  return text;
};

/** A JSON-like value with every string redacted (keys kept). */
const redactDeep = (value, depth = 0) => {
  if (typeof value === 'string') return redact(value);
  if (depth > 40 || value === null || typeof value !== 'object' || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, depth + 1)]));
};

let outputHooked = false;
/**
 * Redacts everything written to stdout and stderr from now on (console.log, the product's
 * in-process mail console, a stack trace). Idempotent. A console.log wrapper installed later
 * (lib/invitations.js captureMail) still sees the raw text: only the stream write is redacted.
 */
const hookOutput = () => {
  if (outputHooked) return;
  outputHooked = true;
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write;
    stream.write = function redactedWrite(chunk, encoding, callback) {
      let out = chunk;
      let enc = encoding;
      try {
        if (typeof chunk === 'string') {
          out = redact(chunk);
        } else if (chunk instanceof Uint8Array) {
          const text = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('utf8');
          const clean = redact(text);
          if (clean !== text) {
            out = clean;
            if (typeof enc === 'string') enc = 'utf8';
          }
        }
      } catch {
        out = '[output withheld: it could not be redacted]\n';
        if (typeof enc === 'string') enc = 'utf8';
      }
      return write.call(this, out, enc, callback);
    };
  }
};

/**
 * Plan §3.1: the deep companies' facts the answers rest on, asserted against
 * the database before a build starts (D3 is 006, WP-0 choice).
 */
const DEEP = {
  '087': { currency: 'EGP', timezone: 'Africa/Cairo', outsider: '088' },
  '052': { currency: 'USD', timezone: 'America/Chicago', outsider: '054' },
  '006': { currency: 'AED', timezone: 'Asia/Dubai', outsider: '018' },
};

// ── errors ───────────────────────────────────────────────────────────────────
class BuildError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'BuildError';
    this.detail = detail;
  }
}

/** Thrown by s.blocked() and by a `known` answer; caught by b.step(). */
class Blocked extends Error {
  constructor(ref, observed) {
    super(`BLOCKED ${ref}`);
    this.name = 'Blocked';
    this.ref = ref;
    this.observed = observed;
  }
}

// ── small helpers ────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const nowIso = () => new Date().toISOString();

const short = (value, max = 300) => {
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  text = String(harness.scrub(text === undefined ? 'undefined' : text));
  return text.length > max ? `${text.slice(0, max)}...` : text;
};

const describe = (res) => {
  if (!res || typeof res.status !== 'number') return 'no answer';
  const error = res.body?.error;
  const details = error?.details ? ` ${short(error.details, 500)}` : '';
  return `${harness.said(res)}${error?.message ? `: ${error.message}` : ''}${details}`;
};

/** What a BLOCKED step or a failure keeps of an answer. */
const observedOf = (res) => {
  if (!res || typeof res !== 'object' || typeof res.status !== 'number') return res === undefined ? null : harness.scrub(res);
  return {
    said: harness.said(res),
    message: res.body?.error?.message || null,
    details: harness.scrub(res.body?.error?.details ?? null),
    ...(res.status < 300 ? { data: compact(res.body?.data) } : {}),
  };
};

/** Response data as the state file keeps it: whole when small, else its id and keys. */
const compact = (data) => {
  if (data === undefined) return null;
  let text;
  try {
    text = JSON.stringify(data);
  } catch {
    return { unserialisable: true };
  }
  if (text === undefined) return null;
  if (text.length <= DATA_KEEP) return harness.scrub(JSON.parse(text));
  return {
    truncated: true,
    id: data?.id ?? data?.item?.id ?? null,
    keys: data && typeof data === 'object' ? Object.keys(data).slice(0, 60) : [],
  };
};

const defaultIdOf = (data) => data?.id ?? data?.item?.id ?? null;
/** idOf on an unexpected answer: whatever shape it has, never a throw (the record is kept either way). */
const idOfSafe = (idOf, data) => {
  try {
    return idOf(data) ?? null;
  } catch {
    return null;
  }
};

/**
 * The record with `id` in an answer: the object itself, its item, or a list entry. A bare array is
 * searched alone. Otherwise `items` is searched first and, when it does not hold the id, every other
 * array property (adjudication round 2, R2-G): other list shapes ({ rows }, { allocations }, ...) and
 * a record that keeps its lines in `items` beside other records (an IPC certificate's `invoices`,
 * `payments` and `retentionReleases`).
 */
const pickId = (data, id) => {
  if (!data || !id) return null;
  if (data.id === id) return data;
  if (data.item?.id === id) return data.item;
  const holds = (row) => row && row.id === id;
  if (Array.isArray(data)) return data.find(holds) || null;
  if (Array.isArray(data.items)) {
    const hit = data.items.find(holds);
    if (hit) return hit;
  }
  for (const [key, value] of Object.entries(data)) {
    if (key === 'items' || !Array.isArray(value)) continue;
    const hit = value.find(holds);
    if (hit) return hit;
  }
  return null;
};

// ── answers and expectations ─────────────────────────────────────────────────
const expectList = (expect, what) => {
  const list = Array.isArray(expect) ? expect : [expect];
  if (!list.length) throw new BuildError(`${what}: expect names no answer`);
  for (const e of list) {
    const valid = typeof e === 'number' ? Number.isInteger(e) && e >= 100 && e < 500 : typeof e === 'string' && ANSWER.test(e);
    if (!valid) throw new BuildError(`${what}: expect ${JSON.stringify(e)} is not a status below 500 or '<status> <CODE>' (a 5xx never passes)`);
  }
  return list;
};
const answerIn = (res, list) => list.some((e) => (typeof e === 'number' ? res.status === e : harness.said(res) === String(e)));

const knownList = (known, what) => {
  if (!known || typeof known !== 'object') throw new BuildError(`${what}: known is { ref, said: [...] }`);
  checkRef(known.ref, `${what}: known.ref`);
  const said = Array.isArray(known.said) ? known.said.map(String) : [];
  if (!said.length) throw new BuildError(`${what}: known.said lists the answer the defect or rule gives today`);
  for (const s of said) if (!ANSWER.test(s)) throw new BuildError(`${what}: known.said ${JSON.stringify(s)} is not '<status>' or '<status> <CODE>' below 500`);
  return said;
};

// ── matchers for asserted fields ─────────────────────────────────────────────
const MATCH = Symbol('cert3.build.matcher');
const matcher = (label, test) => ({ [MATCH]: true, label, test });
const given = (v) => v !== null && v !== undefined && v !== '';
const is = {
  /** Money compared in integer cents (harness rule 3): refuses a float that is not the decimal it looks like. */
  cents: (amount, { decimals = 2 } = {}) => matcher(`${amount} (in cents)`, (v) => given(v) && harness.toCents(v, { decimals }) === harness.toCents(amount, { decimals })),
  /** A date or timestamp whose first ten characters are this day. */
  day: (iso) => matcher(`the day ${iso}`, (v) => typeof v === 'string' && v.slice(0, 10) === iso),
  present: matcher('a value', (v) => given(v)),
  absent: matcher('no value', (v) => v === null || v === undefined),
  oneOf: (list) => matcher(`one of ${JSON.stringify(list)}`, (v) => list.includes(v)),
  count: (n) => matcher(`${n} item(s)`, (v) => Array.isArray(v) && v.length === n),
  number: (n) => matcher(String(n), (v) => given(v) && Number(v) === n),
};

const pathGet = (object, key) => key.split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), object);

/** Problems with `data` against `fields`; [] when every field holds. */
const fieldProblems = (data, fields, res = null) => {
  const problems = [];
  for (const [key, expected] of Object.entries(fields)) {
    if (key.startsWith('$') && key !== '$status') {
      problems.push(`${key}: unknown pseudo-field`);
      continue;
    }
    if (key === '$status' && !res) continue; // an adopted record has no answer of this run
    const actual = key === '$status' ? res.status : pathGet(data, key);
    let ok = false;
    let wanted = 'the expected value';
    try {
      if (expected && expected[MATCH]) {
        wanted = expected.label;
        ok = expected.test(actual, data) === true;
      } else if (typeof expected === 'function') {
        const verdict = expected(actual, data);
        ok = verdict === true;
        wanted = typeof verdict === 'string' ? verdict : 'what the predicate accepts';
      } else if (typeof expected === 'number') {
        wanted = String(expected);
        ok = given(actual) && Number(actual) === expected;
      } else if (expected === null || typeof expected !== 'object') {
        wanted = JSON.stringify(expected);
        ok = actual === expected;
      } else {
        wanted = JSON.stringify(expected);
        ok = JSON.stringify(actual) === wanted;
      }
    } catch (error) {
      ok = false;
      wanted = `${wanted} (${error.message})`;
    }
    if (!ok) problems.push(`${key}: expected ${wanted}, got ${short(actual, 200)}`);
  }
  return problems;
};

// ── dates ────────────────────────────────────────────────────────────────────
const ymd = (date, timeZone = 'UTC') =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const addDays = (iso, days) => {
  if (!ISO_DAY.test(iso)) throw new BuildError(`addDays: ${iso} is not YYYY-MM-DD`);
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const dates = {
  ymd,
  addDays,
  min: (a, b) => (a <= b ? a : b),
  weekday: (iso) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${iso}T00:00:00Z`).getUTCDay()],
};

// ── state files ──────────────────────────────────────────────────────────────
const stateFileOf = (code) => path.join(STATE_DIR, `${code}.json`);
const resultFileOf = (code) => path.join(RESULT_DIR, `build-${code}.json`);

const readState = (code) => {
  try {
    return JSON.parse(fs.readFileSync(stateFileOf(code), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new BuildError(`${stateFileOf(code)} cannot be read: ${error.message}`);
  }
};

const writeJsonAtomic = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (error) {
      if (attempt >= 30 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      sleepSync(100);
    }
  }
};

const stamp = () => nowIso().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');

/** Moves a state file aside (<code>.prev-<time>.json); returns where it went, or null. */
const moveStateAside = (code) => {
  const file = stateFileOf(code);
  if (!fs.existsSync(file)) return null;
  const target = path.join(STATE_DIR, `${code}.prev-${stamp()}.json`);
  fs.renameSync(file, target);
  return target;
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

const takeLock = (file) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: nowIso() }));
      fs.closeSync(fd);
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let holder = null;
      try {
        holder = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        /* unreadable: treated as abandoned */
      }
      if (holder?.pid && holder.pid !== process.pid && alive(holder.pid)) {
        throw new BuildError(`${file} is held by PID ${holder.pid} (since ${holder.at}): another run of this build is still going`);
      }
      fs.rmSync(file, { force: true }); // left by a run that died
    }
  }
  throw new BuildError(`could not take ${file}`);
};

// ── the population ───────────────────────────────────────────────────────────
let populationMemo = null;
const population = () => {
  populationMemo = populationMemo || buildPopulation();
  return populationMemo;
};

// ── a company: resolved, asserted, and its people as sessions ────────────────
class Company {
  constructor({ code, spec, row, tracker }) {
    this.code = code;
    this.spec = spec;
    this.orgId = row.id;
    this.slug = row.slug;
    this.name = row.name;
    this.currency = row.currency;
    this.timezone = row.timezone;
    this.domain = spec.domain;
    this.size = spec.size;
    this.plan = spec.subscription?.plan || null;
    this.tracker = tracker;
    this.invited = new Map();
    this.sessions = new Map();
  }

  /** A person of this company by key (persona, staff, multi-company or invited) or e-mail. */
  person(key) {
    if (typeof key !== 'string' || !key) throw new BuildError(`a person is named by a key or an e-mail, not ${JSON.stringify(key)}`);
    const email = key.includes('@') ? key.toLowerCase() : null;
    const invited = this.invited.get(key) || (email ? [...this.invited.values()].find((p) => p.email === email) : null);
    if (invited) return invited;
    const local = this.spec.people.find((p) => (email ? p.email === email : p.email === `${key}@${this.domain}`));
    if (local) {
      return { key: local.email.split('@')[0], email: local.email, role: local.role, id: local.id, isAdmin: local.isAdmin, isOwner: local.isOwner, persona: local.persona, source: 'population' };
    }
    const multi = population().multi.find((m) => (email ? m.email === email : m.key === key));
    const membership = multi?.memberships.find((ms) => ms.code === this.code);
    if (multi && membership) {
      return { key: multi.key, email: multi.email, role: membership.role, id: multi.id, isAdmin: membership.isAdmin, isOwner: false, persona: null, source: 'multi' };
    }
    throw new BuildError(`${key} is not a person of company ${this.code}: not a persona or staff member of the population, not one of its multi-company members, and not invited by this build`);
  }

  /** The population staff of a role (people with no persona key), in population order. */
  staff(role) {
    if (!ROLES.includes(role)) throw new BuildError(`staff(${role}): not one of ${ROLES.join(', ')}`);
    return this.spec.people
      .filter((p) => !p.persona && !p.isOwner && p.role === role)
      .map((p) => ({ key: p.email.split('@')[0], email: p.email, role: p.role, id: p.id, isAdmin: p.isAdmin, isOwner: false, persona: null, source: 'population' }));
  }

  /** The person's session in THIS company (org named), asserted once with GET /auth/me. */
  async session(key) {
    const person = this.person(key);
    const cached = this.sessions.get(person.email);
    if (cached) return cached.session;
    const session = api.as({ email: person.email, orgId: this.orgId });
    let res;
    try {
      res = await session.send('GET', '/auth/me');
    } catch (error) {
      if (error instanceof api.ApiError) {
        if (error.status >= 500) this.tracker.fiveXX.push({ label: `${person.email} sign-in`, status: error.status, code: error.code });
        throw new BuildError(`${person.email} cannot open a session in ${this.code} (${this.orgId}): ${error.message}`, { status: error.status, code: error.code });
      }
      throw error;
    }
    this.tracker.track(res, `${person.email} GET /auth/me`);
    if (res.status !== 200) throw new BuildError(`${person.email}: GET /auth/me answered ${describe(res)}`);
    const me = res.body?.data || {};
    const activeOrg = me.active?.orgId ?? me.orgId;
    const problems = [];
    if (activeOrg !== this.orgId) problems.push(`the session is in ${activeOrg}, not ${this.orgId}`);
    if (person.id && me.id !== person.id) problems.push(`user id ${me.id}, the population says ${person.id}`);
    if (person.role && String(me.role).toLowerCase() !== person.role) problems.push(`role ${me.role}, expected ${person.role}`);
    if (me.status && me.status !== 'active') problems.push(`status ${me.status}`);
    if (problems.length) throw new BuildError(`${person.email} in ${this.code}: ${problems.join('; ')}`);
    this.sessions.set(person.email, { session, me });
    return session;
  }

  async userId(key) {
    const person = this.person(key);
    await this.session(key);
    return this.sessions.get(person.email).me.id;
  }
}

// ── the build ────────────────────────────────────────────────────────────────
class StepContext {
  constructor(build, name, { dirty = false } = {}) {
    this.b = build;
    this.name = name;
    this.dirty = dirty;
    this.made = 0;
    this.reused = 0;
  }

  create(name, persona, route, payload, opts = {}) {
    return this.b._op(this, 'create', name, persona, opts.method || 'POST', route, payload, opts);
  }

  upload(name, persona, route, file, opts = {}) {
    return this.b._op(this, 'upload', name, persona, opts.method || 'POST', route, file, opts);
  }

  act(name, persona, method, route, payload, opts = {}) {
    return this.b._op(this, 'act', name, persona, method, route, payload, opts);
  }

  refused(name, persona, method, route, payload, expected, opts = {}) {
    return this.b._refused(this, name, persona, method, route, payload, expected, opts);
  }

  get(persona, route, opts) {
    return this.b.get(persona, route, opts);
  }

  send(persona, method, route, payload, opts) {
    return this.b.send(persona, method, route, payload, opts);
  }

  blocked(ref, observed = null) {
    throw this.b._blockedSignal(ref, observed);
  }

  assert(condition, message, detail) {
    return this.b.assert(condition, `${this.name}: ${message}`, detail);
  }

  expectFields(data, fields, label = 'read-back') {
    return this.b.expectFields(data, fields, `${this.name}: ${label}`);
  }

  id(name) {
    return this.b.id(name);
  }

  note(text) {
    this.b.note(text, this.name);
  }

  finding(ref, text) {
    return this.b.finding(ref, text, this.name);
  }
}

class Build {
  constructor(code, { company = null } = {}) {
    const match = CODE.exec(String(code || ''));
    if (!match) throw new BuildError(`build code ${JSON.stringify(code)} is not <company>-<PROJECT> (e.g. 087-SCH)`);
    this.code = code;
    this.companyCode = company || match[1];
    this.stateFile = stateFileOf(code);
    this.lockFile = path.join(STATE_DIR, `${code}.lock`);
    this.resultFile = resultFileOf(code);
    this.mode = INPROCESS ? 'inprocess' : 'http';
    this.state = null;
    this.company = null;
    this.companies = new Map();
    this.projectId = null;
    this.current = null;
    this.visited = new Set();
    this.report = [];
    this.notes = []; // this run's notes; every run's are in state.notes
    this.findings = []; // this run's findings; every run's are in state.findings
    this.requests = 0; // requests answered through send() (get, act, create ...): a verify that reads live raises it
    this.answers = { total: 0, byStatus: {} };
    this.fiveXX = [];
    this.counts = { made: 0, adopted: 0, reused: 0, refusals: 0 };
    this.failure = null;
    this.startedAt = new Date();
    this.db = null;
    this.locked = false;
    this.movedAside = null;
    this.tracker = { fiveXX: this.fiveXX, track: (res, label) => this._track(res, label) };
  }

  // ── lifecycle ──
  async open() {
    if (preparation.error) throw new BuildError(`environment: ${preparation.error.message}`);
    if (!process.env.CERT_PASSWORD) throw new BuildError('CERT_PASSWORD is not set');
    takeLock(this.lockFile);
    this.locked = true;
    if (process.argv.includes('--fresh')) this.movedAside = moveStateAside(this.code);
    const prior = readState(this.code);
    if (prior && prior.version !== VERSION) throw new BuildError(`${this.stateFile} is ${prior.version}, this library is ${VERSION}`);
    if (prior && prior.code !== this.code) throw new BuildError(`${this.stateFile} belongs to ${prior.code}`);
    this.state = prior || { version: VERSION, code: this.code, createdAt: nowIso(), company: null, projectId: null, steps: {}, records: {}, people: {}, runs: [] };
    // Notes and findings live in the state (R1-14, G2): a state written before they did starts empty.
    if (!Array.isArray(this.state.notes)) this.state.notes = [];
    if (!Array.isArray(this.state.findings)) this.state.findings = [];
    this.resumed = Boolean(prior);

    this.company = await this._resolveCompany(this.companyCode);
    this.companies.set(this.company.code, this.company);
    if (prior?.company?.orgId && prior.company.orgId !== this.company.orgId) {
      throw new BuildError(`${this.stateFile} was written for org ${prior.company.orgId}; company ${this.companyCode} is now ${this.company.orgId}`);
    }
    const { code, orgId, slug, name, currency, timezone } = this.company;
    this.state.company = { code, orgId, slug, name, currency, timezone };
    for (const [key, person] of Object.entries(this.state.people || {})) this.company.invited.set(key, { ...person, key, source: 'invited' });
    if (this.state.projectId) this.projectId = this.state.projectId;

    const now = new Date();
    this.today = dates.min(ymd(now, 'UTC'), ymd(now, this.company.timezone));
    this.state.runs.push({ pid: process.pid, startedAt: this.startedAt.toISOString(), mode: this.mode, resumed: this.resumed, runDate: this.today });
    this.save();
    this._log('BUILD', `${this.code} in ${this.company.code} ${this.company.name} (${this.orgId}); ${this.mode}; run date ${this.today}; ${this.resumed ? `resuming ${this.stateFile}` : `new state ${this.stateFile}`}${this.movedAside ? `; previous state moved to ${this.movedAside}` : ''}`);
  }

  async close(exitCode) {
    let code = exitCode;
    try {
      if (this.state) {
        const run = this.state.runs[this.state.runs.length - 1];
        if (run) Object.assign(run, { finishedAt: nowIso(), exitCode: code });
        this.save();
      }
    } catch (error) {
      console.error(`could not write ${this.stateFile}: ${error.message}`);
      code = 1;
    }
    const blocked = this.report.filter((r) => r.status === 'blocked');
    const verdict = code === 0 ? 'BUILT' : code === 2 ? 'INCOMPLETE' : 'FAILED';
    const visitedRecords = Object.values(this.state?.records || {});
    const findings = this.state?.findings || this.findings;
    const result = {
      build: this.code,
      library: VERSION,
      verdict,
      exitCode: code,
      mode: this.mode,
      company: this.state?.company || { code: this.companyCode },
      projectId: this.projectId,
      runDate: this.today || null,
      startedAt: this.startedAt.toISOString(),
      finishedAt: nowIso(),
      seconds: Math.round((Date.now() - this.startedAt.getTime()) / 100) / 10,
      stateFile: this.stateFile,
      resumed: Boolean(this.resumed),
      movedAside: this.movedAside,
      steps: this.report,
      blocked: blocked.map(({ name, ref, via, observed }) => ({ name, ref, via: via || null, observed })),
      failure: this.failure,
      records: {
        inState: visitedRecords.filter((r) => r.status === 'done').length,
        pending: visitedRecords.filter((r) => r.status === 'pending').length,
        unexpected: visitedRecords.filter((r) => r.status === 'unexpected').length,
        thisRun: { ...this.counts },
      },
      answers: { ...this.answers, fiveXX: this.fiveXX },
      staleSteps: Object.keys(this.state?.steps || {}).filter((name) => !this.visited.has(name)),
      // Every run's, from the state (R1-14): a resumed run reports what earlier runs observed.
      notes: this.state?.notes || this.notes,
      findings: findings.map((f) => ({ ref: f.ref, step: f.step, stepStatus: f.step ? this.state?.steps?.[f.step]?.status || 'not run' : null, text: f.text, at: f.at, run: f.run ?? null, ...(f.times ? { times: f.times, lastAt: f.lastAt } : {}) })),
    };
    try {
      writeJsonAtomic(this.resultFile, redactDeep(harness.scrub(result)));
    } catch (error) {
      console.error(`could not write ${this.resultFile}: ${error.message}`);
      code = 1;
    }
    if (this.locked) {
      try {
        fs.rmSync(this.lockFile, { force: true });
      } catch {
        /* released when the process ends */
      }
    }
    if (this.db) await this.db.end().catch(() => {});
    if (INPROCESS) {
      try {
        const loaded = require.cache[require.resolve('../../../../src/config/db')];
        if (loaded) await loaded.exports?.prisma?.$disconnect?.();
      } catch {
        /* not loaded, or already closed */
      }
    }
    const done = this.report.filter((r) => r.status === 'done').length;
    const resumedSteps = this.report.filter((r) => r.status === 'resumed').length;
    this._log('BUILD', `${this.code}: ${verdict}, exit ${code}; steps ${done} done, ${resumedSteps} resumed, ${blocked.length} blocked; ${findings.length} finding(s); records made ${this.counts.made}, adopted ${this.counts.adopted}, reused ${this.counts.reused}; ${this.answers.total} answers; results ${this.resultFile}`);
    for (const b of blocked) this._log('BLOCKED', `${b.name}  ${b.ref}${b.via ? ` (via ${b.via})` : ''}: ${short(b.observed, 400)}`);
    for (const f of findings) this._log('FINDING', `${f.ref}${f.step ? ` (${f.step})` : ''}: ${short(f.text, 400)}`);
    if (this.failure) this._log('FAILED', `${this.failure.step ? `${this.failure.step}: ` : ''}${this.failure.message}`);
    return code;
  }

  save() {
    this.state.updatedAt = nowIso();
    writeJsonAtomic(this.stateFile, this.state);
  }

  recordFailure(error) {
    const detail = error?.detail || {};
    this.failure = {
      step: detail.step || error?.step || this.current?.name || null,
      kind: error?.name || 'Error',
      message: short(error?.message || String(error), 4000),
      ...(detail.request ? { request: harness.scrub(detail.request) } : {}),
      ...(detail.said ? { said: detail.said } : {}),
      ...(detail.status ? { status: detail.status, code: detail.code || null } : {}),
      ...(detail.observed ? { observed: detail.observed } : {}),
      stack: error instanceof BuildError ? undefined : short(error?.stack || '', 3000),
    };
  }

  // ── companies, people, sessions ──
  async _db() {
    if (!this.db) this.db = await certEnv.connectCert();
    return this.db;
  }

  async _resolveCompany(code) {
    if (!/^\d{3}$/.test(code)) throw new BuildError(`company code ${code} is not three digits`);
    const spec = population().companies.find((c) => c.code === code);
    if (!spec) throw new BuildError(`no certification company ${code} in the population`);
    const db = await this._db();
    const rows = (await db.query(
      `select id::text as id, name, slug, kind, status, "defaultCurrency" as currency, "defaultTimezone" as timezone
         from "Organisation" where slug like $1 order by slug`,
      [`cert-${code}-%`],
    )).rows;
    if (rows.length !== 1) throw new BuildError(`company ${code}: ${rows.length} organisations have a slug cert-${code}-%; exactly one is expected`);
    const row = rows[0];
    certEnv.assertCertOrganisation(row);
    const problems = [];
    if (row.id !== spec.id) problems.push(`id ${row.id}, the population says ${spec.id}`);
    if (row.slug !== spec.slug) problems.push(`slug ${row.slug}, the population says ${spec.slug}`);
    if (row.name !== spec.name) problems.push(`name ${row.name}, the population says ${spec.name}`);
    if (row.kind !== 'company') problems.push(`kind ${row.kind}`);
    const deep = DEEP[code];
    if (deep) {
      if (row.currency !== deep.currency) problems.push(`currency ${row.currency}, plan §3.1 says ${deep.currency}`);
      if (row.timezone !== deep.timezone) problems.push(`time zone ${row.timezone}, plan §3.1 says ${deep.timezone}`);
    }
    if (problems.length) throw new BuildError(`company ${code} does not resolve as the plan expects: ${problems.join('; ')}`);
    return new Company({ code, spec, row, tracker: this.tracker });
  }

  get orgId() {
    return this.company?.orgId || null;
  }

  /** Another company (an outsider for a 404 probe), resolved and asserted like this build's. */
  async companyOf(code) {
    if (!this.companies.has(code)) this.companies.set(code, await this._resolveCompany(code));
    return this.companies.get(code);
  }

  person(key) {
    return this.company.person(key);
  }

  session(key) {
    return this.company.session(key);
  }

  userId(key) {
    return this.company.userId(key);
  }

  // ── requests ──
  _track(res, label) {
    if (!res || typeof res.status !== 'number') return res;
    this.answers.total += 1;
    this.answers.byStatus[res.status] = (this.answers.byStatus[res.status] || 0) + 1;
    if (VERBOSE) this._log('ANSWER', `${label} -> ${harness.said(res)}`);
    if (res.status >= 500) {
      this.fiveXX.push({ label, status: res.status, code: res.body?.error?.code || null });
      throw new BuildError(`${label} answered ${describe(res)}: a 5xx never passes`, { said: harness.said(res), status: res.status, code: res.body?.error?.code || null });
    }
    return res;
  }

  /** The raw answer ({ status, body, headers }); a 5xx fails the build; a 429 waits and asks again. */
  async send(persona, method, route, payload, { file = null, form = null, field = 'file' } = {}) {
    const session = await this.session(persona);
    for (let attempt = 0; ; attempt += 1) {
      let res;
      try {
        if (file) {
          const fields = form || {};
          const upload = api.multipart({ field, filename: file.filename, contentType: file.contentType || 'application/octet-stream', body: file.body, fields });
          res = await session.send(method, route, undefined, {
            form: upload,
            file: { field, filename: file.filename, contentType: file.contentType || 'application/octet-stream', fields, bytes: file.bytes ?? Buffer.byteLength(file.body) },
          });
        } else {
          res = await session.send(method, route, payload);
        }
      } catch (error) {
        if (error instanceof api.ApiError) {
          if (error.status >= 500) this.fiveXX.push({ label: `${persona} sign-in`, status: error.status, code: error.code });
          throw new BuildError(`${persona}: no session for ${method} ${route}: ${error.message}`, { status: error.status, code: error.code });
        }
        throw new BuildError(`${persona} ${method} ${route}: no answer (${error.cause?.code || error.message})`, { request: { persona, method, route } });
      }
      this._track(res, `${persona} ${method} ${route}`);
      this.requests += 1;
      if (res.status === 429 && attempt < 6) {
        const after = Number(res.headers?.get?.('retry-after'));
        const wait = Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 60_000) : 5_000;
        this._log('WAIT', `${persona} ${method} ${route}: 429, asking again in ${Math.round(wait / 1000)} s`);
        await sleep(wait);
        continue;
      }
      return res;
    }
  }

  /** A read, asserted (200 by default); returns the answer's data. */
  async get(persona, route, { expect = 200 } = {}) {
    const list = expectList(expect, `GET ${route}`);
    const res = await this.send(persona, 'GET', route);
    if (!answerIn(res, list)) throw new BuildError(`${persona} GET ${route} answered ${describe(res)}; expected ${list.join(' or ')}`, { request: { persona, method: 'GET', route }, said: harness.said(res) });
    if (res.body === undefined) throw new BuildError(`${persona} GET ${route} -> ${res.status} but the body is not JSON`);
    return res.body?.data;
  }

  assert(condition, message, detail = null) {
    if (condition !== true) throw new BuildError(`assertion failed: ${message}${condition !== false ? ` (the condition was ${short(condition, 80)}, not true)` : ''}${detail ? ` :: ${short(detail, 1500)}` : ''}`);
    return true;
  }

  /** Asserts `fields` (the create/act opts.fields shapes) on data that was read; returns the data. */
  expectFields(data, fields, label = 'read-back') {
    if (!fields || typeof fields !== 'object' || !Object.keys(fields).length) throw new BuildError(`${label}: no fields to assert`);
    const problems = fieldProblems(data, fields, null);
    if (problems.length) throw new BuildError(`${label}: ${problems.join('; ')}`);
    return data;
  }

  /** Keeps a note or a finding in the state file (R1-14, G2); the same entry twice is kept once. */
  _keep(kind, entry) {
    const memory = kind === 'findings' ? this.findings : this.notes;
    memory.push(entry);
    if (!this.state) return entry; // before open(): this run's results only
    const list = this.state[kind];
    const run = this.state.runs?.length || null;
    const same = list.find((e) => e.step === entry.step && e.text === entry.text && (kind !== 'findings' || e.ref === entry.ref));
    if (same) {
      same.times = (same.times || 1) + 1;
      same.lastAt = nowIso();
      same.lastRun = run;
    } else {
      list.push({ ...entry, at: nowIso(), run });
    }
    this.save();
    return entry;
  }

  note(text, step = undefined) {
    const at = step === undefined ? this.current?.name ?? null : step;
    const entry = { step: at, text: redact(short(text, 2000)) };
    this._keep('notes', entry);
    this._log('NOTE', `${at ? `${at}: ` : ''}${short(entry.text, 400)}`);
  }

  /**
   * G2: a departure from the plan or the answer book, or a product refusal worked around, that
   * is not a BLOCKED step. `ref`: a register id, an HR id or an adjudication suspect (G3).
   */
  finding(ref, text, step = undefined) {
    const at = step === undefined ? this.current?.name ?? null : step;
    checkRef(ref, `finding${at ? ` (step ${at})` : ''}`);
    if (typeof text !== 'string' || !text.trim()) throw new BuildError(`finding ${ref}${at ? ` (step ${at})` : ''}: the text says what was observed (the answer, the figure, the departure); it is empty`);
    const entry = { ref, step: at, text: redact(short(text.trim(), 4000)) };
    this._keep('findings', entry);
    this._log('FINDING', `${ref}${at ? ` (${at})` : ''}: ${short(entry.text, 400)}`);
    return { ...entry };
  }

  // ── names and dates ──
  name(text) {
    return `CERT3 ${text} (${this.code})`;
  }

  ref(suffix) {
    return `CERT3-${this.code}-${suffix}`;
  }

  file(name) {
    return `CERT3-${this.code}-${name}`;
  }

  date(offsetDays = 0, { future = false } = {}) {
    if (!Number.isInteger(offsetDays)) throw new BuildError(`b.date(${offsetDays}): whole days only`);
    if (offsetDays > 0 && !future) throw new BuildError(`b.date(${offsetDays}) is after the run date; pass { future: true } for a date that is not a transaction (a plan, a cutoff)`);
    return addDays(this.today, offsetDays);
  }

  past(iso) {
    const day = String(iso).slice(0, 10);
    if (!ISO_DAY.test(day)) throw new BuildError(`b.past(${iso}): not a date`);
    if (day > this.today) throw new BuildError(`${iso} is after the run date ${this.today}: every transaction is dated on or before the run date (plan §3.3)`);
    return iso;
  }

  // ── the project ──
  get P() {
    if (!this.projectId) throw new BuildError(`${this.code} has no project yet: b.project(...) comes first`);
    return `/projects/${this.projectId}`;
  }

  async project({ title, persona = 'pm', payload = {}, fields = {} } = {}) {
    if (!title || typeof title !== 'string') throw new BuildError('b.project: a title names the project (it becomes "CERT3 <title> (<code>)")');
    const name = this.name(title);
    if (payload.name && payload.name !== name) throw new BuildError(`b.project: payload.name ${payload.name} is not ${name}`);
    const search = `/projects?limit=100&includeArchived=true&search=${encodeURIComponent(name)}`;
    const out = await this.step('project', async (s) => {
      const data = await s.create('project', persona, '/projects', { ...payload, name }, {
        expect: 201,
        fields: { name, archivedAt: is.absent, ...fields },
        get: (id) => `/projects/${id}`,
        adopt: true,
        find: async () => {
          const page = await s.get(persona, search);
          const live = (page?.items || []).filter((p) => p.name === name && !p.archivedAt);
          if (live.length > 1) throw new BuildError(`${live.length} live projects are named "${name}" in ${this.company.code} (${live.map((p) => p.id).join(', ')}): archive the extra ones (debug leftovers) before building`);
          return live[0] || null;
        },
      });
      return { projectId: data.id, name };
    }, {
      verify: async (s, previous) => {
        const p = await s.get(persona, `/projects/${previous.projectId}`);
        if (p.archivedAt) return `project ${previous.projectId} is archived`;
        return p.name === name || `project ${previous.projectId} is named ${p.name}`;
      },
    });
    if (!out?.projectId) throw new BuildError('b.project: the project step returned no project');
    this.projectId = out.projectId;
    this.state.projectId = out.projectId;
    this.save();
    return out;
  }

  async team(members, { persona = 'pm', step = 'team' } = {}) {
    if (!members || typeof members !== 'object' || !Object.keys(members).length) throw new BuildError('b.team: name the people { key: role | null }');
    const P = this.P;
    return this.step(step, async (s) => {
      const out = {};
      for (const [key, role] of Object.entries(members)) {
        if (role !== null && !ROLES.includes(role)) throw new BuildError(`b.team: ${key}'s role ${role} is not one of ${ROLES.join(', ')}`);
        const person = this.person(key);
        const userId = await this.userId(key);
        const wanted = role || person.role;
        // POST /team does not take quality_engineer as a project role: it defaults to the company role.
        const body = role && role !== 'quality_engineer' ? { userId, role } : { userId };
        const data = await s.create(`${step}.${key}`, persona, `${P}/team`, body, {
          expect: [201, 200],
          named: false,
          get: null, // re-read live by this step's verify (the get: null rule)
          idOf: (d) => d?.userId ?? null,
          fields: { userId, assignmentRole: wanted },
          // A POST cut off before its answer was recorded: the assignment, found by user id, is
          // adopted (POST /team answers 200 when the person is already on the project).
          find: async (s2) => ((await s2.get(persona, `${P}/team`))?.items || []).find((i) => i.userId === userId) || null,
        });
        out[key] = { userId, role: data.assignmentRole };
      }
      return out;
    }, {
      verify: async (s, previous) => {
        const team = await s.get(persona, `${P}/team`);
        const items = team?.items || [];
        for (const [key, member] of Object.entries(previous || {})) {
          const row = items.find((i) => i.userId === member.userId);
          if (!row) return `${key} (${member.userId}) is no longer on the project`;
          if (row.assignmentRole !== member.role) return `${key} is ${row.assignmentRole} on the project, not ${member.role}`;
        }
        return true;
      },
    });
  }

  async invite(key, { inviter = 'pm', email, role, name, projectId = null, projectPartyId = null, step = null } = {}) {
    if (!/^[a-z][a-z0-9._-]*$/.test(String(key))) throw new BuildError(`b.invite: key ${key} is lower-case letters, digits, dots and dashes`);
    const address = String(email || '').toLowerCase();
    if (!address.endsWith(certEnv.EMAIL_SUFFIX)) throw new BuildError(`b.invite: ${email} does not end with ${certEnv.EMAIL_SUFFIX} (the certification address rule)`);
    if (!ROLES.includes(role)) throw new BuildError(`b.invite: role ${role} is not one of ${ROLES.join(', ')}`);
    if (!name || typeof name !== 'string') throw new BuildError('b.invite: the person needs a name');
    const stepName = step || `invite.${key}`;
    // A party invitation (projectPartyId) makes the person a GUEST of the company: the membership's
    // role is external_party whatever role the offer named (membership.service GUEST_ROLE; owner
    // decision D-ID-1). The session is asserted with the role the person actually holds.
    const heldRole = projectPartyId ? 'external_party' : role;
    const register = (userId) => {
      const person = { key, email: address, role: heldRole, offeredRole: role, name, id: userId, isAdmin: false, isOwner: false, persona: null, source: 'invited' };
      this.state.people[key] = { email: address, role: heldRole, offeredRole: role, name, id: userId };
      this.company.invited.set(key, person);
      this.save();
    };
    return this.step(stepName, async (s) => {
      const recName = stepName;
      const existing = this.state.records[recName];
      if (existing && existing.step !== s.name) throw new BuildError(`invite ${key}: the record name ${recName} is used by step ${existing.step}`);
      if (existing?.status === 'done') {
        register(existing.id);
        await this.session(key); // asserted: same id, this org, this role
        s.reused += 1;
        this.counts.reused += 1;
        return { userId: existing.id, email: address };
      }
      if (existing?.status === 'pending') {
        let signedIn = null;
        try {
          signedIn = await api.signIn(address, this.orgId);
        } catch {
          signedIn = null;
        }
        const userId = signedIn?.user?.id || null;
        if (!userId) {
          throw new BuildError(`invite ${key}: an earlier run sent the invitation to ${address} and stopped before its answer was recorded, and ${address} cannot sign in to ${this.company.code}. Revoke the pending invitation (or accept it) by hand, then remove records["${recName}"] from ${this.stateFile}.`);
        }
        api.forget(address);
        this.state.records[recName] = { kind: 'invite', step: s.name, status: 'done', id: userId, persona: inviter, adopted: true, at: nowIso() };
        register(userId);
        await this.session(key);
        this.counts.adopted += 1;
        return { userId, email: address };
      }
      await this.session(inviter);
      this.state.records[recName] = { kind: 'invite', step: s.name, status: 'pending', persona: inviter, method: 'POST', route: '/users/invitations', sentAt: nowIso() };
      this.save();
      const viaBuild = { send: (method, route, body) => this.send(inviter, method, route, body) };
      const result = await invitations.createByInvitation({ inviter: viaBuild, email: address, role, name, projectId, projectPartyId, db: await this._db() });
      if (result.accepted) this._track(result.accepted, `${address} POST /auth/invitations/accept`);
      const invitedSaid = harness.said(result.invited);
      if (invitedSaid !== '201') {
        delete this.state.records[recName];
        this.save();
        throw new BuildError(`invite ${key}: ${inviter} POST /users/invitations answered ${describe(result.invited)}; expected 201`, { request: { persona: inviter, method: 'POST', route: '/users/invitations', payload: { email: address, role, projectId, projectPartyId } }, said: invitedSaid });
      }
      if (!result.token) throw new BuildError(`invite ${key}: the invitation was made (201, id ${result.invited.body?.data?.id}) but its link was not found ${INPROCESS ? 'in the captured mail' : `in ${process.env.CERT_API_LOG || path.join(WORK, 'logs', 'api.log')}`}; the invitation stays pending (revoke it by hand before a rerun)`);
      if (harness.said(result.accepted) !== '200' || !result.userId) {
        throw new BuildError(`invite ${key}: the acceptance answered ${describe(result.accepted)}; expected 200 with a user`, { said: harness.said(result.accepted) });
      }
      this.state.records[recName] = { kind: 'invite', step: s.name, status: 'done', id: result.userId, persona: inviter, method: 'POST', route: '/users/invitations', invitationId: result.invited.body?.data?.id || null, at: nowIso() };
      register(result.userId);
      await this.session(key);
      s.made += 1;
      this.counts.made += 1;
      return { userId: result.userId, email: address };
    }, {
      // Resumed: the person still signs in here, as the same user, with the same role.
      verify: async () => {
        await this.session(key);
        return true;
      },
    });
  }

  // ── other builds ──
  other(code) {
    if (!CODE.test(String(code))) throw new BuildError(`b.other(${code}): not a build code`);
    const state = readState(code);
    if (!state) throw new BuildError(`build ${code} has no state file (${stateFileOf(code)}): it runs before ${this.code} (run-all order)`);
    if (state.company?.code === this.company.code && state.company.orgId !== this.company.orgId) throw new BuildError(`build ${code}'s state is for org ${state.company.orgId}, not ${this.company.orgId}`);
    return {
      code,
      state,
      projectId: state.projectId || null,
      P: state.projectId ? `/projects/${state.projectId}` : null,
      id: (name) => {
        const r = state.records?.[name];
        if (!r || r.status !== 'done' || !r.id) throw new BuildError(`build ${code} has no record ${name}`);
        return r.id;
      },
      out: (step) => {
        const st = state.steps?.[step];
        if (!st || st.status !== 'done') throw new BuildError(`build ${code}: step ${step} is ${st ? st.status : 'not run'}`);
        return st.out;
      },
      person: (key) => state.people?.[key] || null,
    };
  }

  // ── what the state knows ──
  record(name) {
    const r = this.state.records[name];
    if (!r || r.status !== 'done') throw new BuildError(`${this.code} has no record ${name}${r ? ` (it is ${r.status})` : ''}`);
    return r;
  }

  id(name) {
    const r = this.record(name);
    if (!r.id) throw new BuildError(`record ${name} has no id`);
    return r.id;
  }

  out(step) {
    const st = this.state.steps[step];
    if (!st || st.status !== 'done') throw new BuildError(`step ${step} is ${st ? st.status : 'not run'}`);
    return st.out;
  }

  isDone(step) {
    return this.state.steps[step]?.status === 'done';
  }

  isBlocked(step) {
    return this.state.steps[step]?.status === 'blocked';
  }

  // ── steps ──
  _checkStepName(name) {
    if (typeof name !== 'string' || !NAME.test(name)) throw new BuildError(`step name ${JSON.stringify(name)}: letters, digits and . _ : - only`);
    if (this.visited.has(name)) throw new BuildError(`step ${name} is run twice in one build`);
  }

  _blockedSignal(ref, observed) {
    checkRef(ref, `blocked${this.current ? ` (step ${this.current.name})` : ''}`);
    return new Blocked(ref, observedOf(observed));
  }

  _recordBlocked(name, { ref, via = null, observed }, started) {
    const prior = this.state.steps[name] || {};
    this.state.steps[name] = { ...prior, status: 'blocked', blocked: { ref, via, observed, at: nowIso() }, finishedAt: nowIso() };
    this.save();
    this.report.push({ name, status: 'blocked', ref, via, observed, seconds: Math.round((Date.now() - started) / 100) / 10 });
    this._log('BLOCKED', `${name}  ${ref}${via ? ` (via ${via})` : ''}: ${short(observed, 300)}`);
    return undefined;
  }

  /** Records a step BLOCKED without running it. */
  blocked(name, ref, observed = null) {
    this._checkStepName(name);
    if (this.current) throw new BuildError(`b.blocked(${name}) inside step ${this.current.name}: use s.blocked(ref, observed)`);
    const signal = this._blockedSignal(ref, observed);
    this.visited.add(name);
    return this._recordBlocked(name, { ref: signal.ref, observed: signal.observed }, Date.now());
  }

  /** This step's records with no read-back route: a create or upload recorded with get: null. */
  _unreadRecords(step) {
    return Object.entries(this.state.records)
      .filter(([, r]) => r.step === step && r.status === 'done' && (r.kind === 'create' || r.kind === 'upload') && !r.get)
      .map(([recName]) => recName);
  }

  _getNullError(name, unread, what) {
    const list = `${unread.slice(0, 8).join(', ')}${unread.length > 8 ? ` and ${unread.length - 8} more` : ''}`;
    return new BuildError(
      `step ${name}: ${what} ${unread.length} record(s) with no read-back route (get: null): ${list}. `
      + 'A step whose records use get: null must re-read them live in a step-level verify (adjudication G4 / R3-16): '
      + `b.step('${name}', fn, { verify: async (s, out) => { /* s.get(...) the records */ return true; /* or what no longer holds */ } }).`,
      { step: name },
    );
  }

  async step(name, fn, { needs = [], verify = null } = {}) {
    this._checkStepName(name);
    if (this.current) throw new BuildError(`step ${name} started inside step ${this.current.name}: steps do not nest`);
    if (typeof fn !== 'function') throw new BuildError(`step ${name}: no function`);
    this.visited.add(name);
    const started = Date.now();

    for (const need of [].concat(needs)) {
      const st = this.state.steps[need];
      if (!st || !this.visited.has(need)) throw new BuildError(`step ${name} needs ${need}, which has not run in this build yet (order)`);
      if (st.status === 'blocked') {
        return this._recordBlocked(name, { ref: st.blocked.ref, via: need, observed: `needs step ${need}, which is BLOCKED by ${st.blocked.ref}` }, started);
      }
      if (st.status !== 'done') throw new BuildError(`step ${name} needs ${need}, which is ${st.status}`);
    }

    const prior = this.state.steps[name];
    // The get: null rule (G4 / R3-16), at the step's call: records it already holds with no read-back route need a verify.
    if (prior && typeof verify !== 'function') {
      const unread = this._unreadRecords(name);
      if (unread.length) throw this._getNullError(name, unread, 'the state file holds');
    }
    if (prior && prior.status === 'done') {
      const s = new StepContext(this, name, { dirty: false });
      this.current = s;
      try {
        for (const [recName, rec] of Object.entries(this.state.records)) {
          if (rec.step === name && rec.status === 'done') {
            await this._readBack(recName, rec);
            s.reused += 1;
            this.counts.reused += 1;
          }
        }
        if (verify) {
          const before = this.requests;
          const verdict = await verify(s, prior.out);
          if (verdict !== true) throw new BuildError(`step ${name}: what the state file says no longer holds: ${typeof verdict === 'string' ? verdict : short(verdict)}`);
          // ... and that verify reads live: it is the only re-read those records get.
          const unread = this._unreadRecords(name);
          if (unread.length && this.requests === before) throw this._getNullError(name, unread, 'its verify answered true without one request (it read nothing live), yet it is the only re-read of');
        }
      } catch (error) {
        if (error instanceof BuildError && !error.detail.step) error.detail.step = name;
        throw error;
      } finally {
        this.current = null;
      }
      this.report.push({ name, status: 'resumed', records: s.reused, seconds: Math.round((Date.now() - started) / 100) / 10 });
      this._log('RESUMED', `${name}  (${s.reused} record(s) read back)`);
      return prior.out;
    }

    const dirty = Boolean(prior);
    this.state.steps[name] = { status: 'started', attempts: (prior?.attempts || 0) + 1, startedAt: nowIso(), ...(prior?.blocked ? { previouslyBlocked: prior.blocked } : {}) };
    this.save();
    const s = new StepContext(this, name, { dirty });
    this.current = s;
    try {
      const out = await fn(s);
      // The get: null rule (G4 / R3-16), as the step ends: a step that recorded such records cannot be done without a verify.
      if (typeof verify !== 'function') {
        const unread = this._unreadRecords(name);
        if (unread.length) throw this._getNullError(name, unread, 'recorded');
      }
      const json = out === undefined ? null : JSON.parse(JSON.stringify(out));
      this.state.steps[name] = { ...this.state.steps[name], status: 'done', finishedAt: nowIso(), out: json };
      this.save();
      this.report.push({ name, status: 'done', made: s.made, reused: s.reused, dirty, seconds: Math.round((Date.now() - started) / 100) / 10 });
      this._log('DONE', `${name}  (${s.made} made${s.reused ? `, ${s.reused} reused` : ''}${dirty ? ', after an interrupted attempt' : ''})`);
      return json;
    } catch (error) {
      if (error instanceof Blocked) return this._recordBlocked(name, { ref: error.ref, observed: error.observed }, started);
      this.state.steps[name] = { ...this.state.steps[name], status: 'failed', finishedAt: nowIso(), error: short(error?.message || String(error), 2000) };
      this.save();
      this.report.push({ name, status: 'failed', made: s.made, seconds: Math.round((Date.now() - started) / 100) / 10 });
      if (error instanceof BuildError) {
        if (!error.detail.step) error.detail.step = name;
      } else if (error && typeof error === 'object') {
        error.step = name;
      }
      throw error;
    } finally {
      this.current = null;
    }
  }

  // ── records ──
  _checkRecordName(name, s) {
    if (typeof name !== 'string' || !NAME.test(name)) throw new BuildError(`record name ${JSON.stringify(name)}: letters, digits and . _ : - only`);
    const existing = this.state.records[name];
    if (existing && existing.step !== s.name) throw new BuildError(`record ${name} belongs to step ${existing.step}, not ${s.name}: record names are unique in the build`);
    return existing || null;
  }

  _readBackRoute(get, id, data) {
    if (get === null || get === undefined) return null;
    if (typeof get === 'function') return get(id, data);
    if (typeof get === 'string') return get.includes(':id') ? get.replace(':id', id) : get;
    throw new BuildError(`get must be a route, (id, data) => route, or null; got ${typeof get}`);
  }

  /** Reads a recorded record back (GET); returns its data, or the stored data when it has no GET. */
  async _readBack(name, rec) {
    if (!rec.get) return rec.data ?? null;
    const res = await this.send(rec.persona, 'GET', rec.get);
    if (res.status !== 200) {
      throw new BuildError(`${name}: recorded ${rec.id ? `id ${rec.id} ` : ''}does not read back (${rec.persona} GET ${rec.get} -> ${describe(res)}). If the database was restored since, start the build with --fresh.`, { said: harness.said(res) });
    }
    const data = res.body?.data;
    if (!rec.id) return data;
    const found = pickId(data, rec.id);
    if (!found) throw new BuildError(`${name}: GET ${rec.get} does not carry the recorded id ${rec.id}`);
    return found;
  }

  _namedCheck(kind, name, payload, opts) {
    // A transition acts on a record that already carries the code: checked only when asked (named: true).
    if (opts.named === false || (kind === 'act' && opts.named !== true)) return;
    const text = kind === 'upload' ? `${payload?.filename || ''} ${JSON.stringify(opts.form || {})}` : JSON.stringify(payload ?? {});
    if (!text.includes(this.code)) {
      throw new BuildError(`${kind} ${name}: the record does not carry the project code ${this.code} (use b.name(...), b.ref(...) or b.file(...); pass named: false for a record with no text)`);
    }
  }

  _adopt(s, kind, name, persona, method, route, found, { fields, get, idOf }) {
    const data = found === true ? null : found;
    const id = kind === 'act' ? null : idOf(data);
    if (kind !== 'act' && !id) throw new BuildError(`${kind} ${name}: find() returned a record without an id`);
    const problems = data && typeof data === 'object' ? fieldProblems(data, fields, null) : [];
    const getRoute = kind === 'act' ? null : this._readBackRoute(get, id, data);
    this.state.records[name] = { kind, step: s.name, status: 'done', id, persona, method, route, get: getRoute, adopted: true, at: nowIso(), fieldProblems: problems, data: compact(data) };
    this.save();
    s.reused += 1;
    this.counts.adopted += 1;
    this._log('ADOPTED', `${name}${id ? ` ${id}` : ''} (made by an earlier run)`);
    if (problems.length) throw new BuildError(`${kind} ${name}: the existing record does not match: ${problems.join('; ')}`, { request: { persona, method, route } });
    return data;
  }

  /** create / upload / act: asserted, recorded, never made twice. */
  async _op(s, kind, name, persona, method, route, payload, opts) {
    const what = `${kind} ${name}`;
    const existing = this._checkRecordName(name, s);
    const { expect = kind === 'act' ? 200 : 201, fields, known = null, idOf = defaultIdOf } = opts;
    const list = expectList(expect, what);
    if (!fields || typeof fields !== 'object' || Array.isArray(fields) || !Object.keys(fields).length) {
      throw new BuildError(`${what}: opts.fields names the key fields the answer must carry; a creation is asserted, never just made`);
    }
    const knownSaid = known ? knownList(known, what) : null;
    if (kind === 'upload' && (!payload || payload.body === undefined || !payload.filename)) throw new BuildError(`${what}: the file is { filename, body, contentType } (a files.js object)`);
    this._namedCheck(kind, name, payload, opts);
    const get = opts.get === undefined ? (kind === 'create' ? `${route.split('?')[0]}/:id` : null) : opts.get;
    const request = { persona, method, route, ...(kind === 'upload' ? { file: payload.filename, form: opts.form || null } : { payload }) };

    if (existing?.status === 'done') {
      if (existing.fieldProblems?.length) {
        // Made earlier with fields that did not match: asserted again, never skipped.
        if (!existing.get) throw new BuildError(`${what}: made earlier (${existing.id || 'no id'}) with ${existing.fieldProblems.join('; ')}, and it has no GET to read it again; check it by hand`);
        const fresh = await this._readBack(name, existing);
        const problems = fieldProblems(fresh, fields, null);
        if (problems.length) throw new BuildError(`${what}: ${existing.id} still does not match: ${problems.join('; ')}`, { request });
        existing.fieldProblems = [];
        existing.data = compact(fresh);
        this.save();
        s.reused += 1;
        this.counts.reused += 1;
        return fresh;
      }
      const data = await this._readBack(name, existing);
      s.reused += 1;
      this.counts.reused += 1;
      return data;
    }
    if (existing?.status === 'unexpected') {
      if (existing.blocked) throw new Blocked(existing.blocked.ref, existing.blocked.observed);
      throw new BuildError(`${what}: an earlier run was answered ${existing.said} (${existing.id ? `made ${existing.id}` : 'no id in the answer'}) where ${list.join(' or ')} was expected, so it is never sent again; resolve it by hand, then remove records["${name}"] from ${this.stateFile}`, { request });
    }
    if (existing?.status === 'pending') {
      const adopter = kind === 'act' ? opts.verify : opts.find;
      if (typeof adopter !== 'function') {
        throw new BuildError(`${what}: an earlier run sent this request (${existing.sentAt}) and stopped before its answer was recorded, so whether it took effect is unknown. Give opts.${kind === 'act' ? 'verify' : 'find'}, or check by hand and remove records["${name}"] from ${this.stateFile}.`, { request });
      }
      const found = await adopter(s);
      if (found) return this._adopt(s, kind, name, persona, method, route, found, { fields, get, idOf });
      this._log('RESEND', `${name}: the interrupted request did not take effect; sending it again`);
    } else if (opts.adopt === true) {
      if (typeof opts.find !== 'function') throw new BuildError(`${what}: adopt: true needs find`);
      const found = await opts.find(s);
      if (found) return this._adopt(s, kind, name, persona, method, route, found, { fields, get, idOf });
    }

    await this.session(persona); // a person who cannot sign in fails before anything is marked sent
    this.state.records[name] = { kind, step: s.name, status: 'pending', persona, method, route, sentAt: nowIso() };
    this.save();
    const res = kind === 'upload'
      ? await this.send(persona, method, route, undefined, { file: payload, form: opts.form || null, field: opts.field || 'file' })
      : await this.send(persona, method, route, payload);
    if (CRASH_AFTER_SEND && CRASH_AFTER_SEND === name) {
      console.log(`[test hook] CERT3_BUILD_CRASH_AFTER_SEND=${name}: answered ${harness.said(res)}; stopping before the answer is recorded`);
      process.exit(9);
    }

    if (!answerIn(res, list)) {
      // A 2xx took effect, id or no id (an act answered 201 where 200 was expected): kept as
      // 'unexpected' so no later run sends it again. Anything else made nothing.
      const accepted = res.status >= 200 && res.status < 300;
      const created = accepted ? idOfSafe(idOf, res.body?.data) : null;
      const isKnown = Boolean(knownSaid) && answerIn(res, knownSaid);
      const observed = observedOf(res);
      if (accepted) {
        this.state.records[name] = { kind, step: s.name, status: 'unexpected', id: created, persona, method, route, said: harness.said(res), at: nowIso(), blocked: isKnown ? { ref: known.ref, observed } : null, data: compact(res.body?.data) };
      } else {
        delete this.state.records[name]; // refused: nothing was made
      }
      this.save();
      if (isKnown) throw new Blocked(known.ref, observed);
      throw new BuildError(`${what}: ${persona} ${method} ${route} answered ${describe(res)}; expected ${list.join(' or ')}`, { request, said: harness.said(res), status: res.status, code: res.body?.error?.code || null, observed });
    }
    if (res.body === undefined) throw new BuildError(`${what}: ${method} ${route} -> ${res.status} but the body is not JSON: ${short(res.text, 200)}`, { request });
    const data = res.body?.data ?? null;
    const id = kind === 'act' ? (opts.idOf ? opts.idOf(data) : null) : idOf(data);
    const problems = fieldProblems(data, fields, res);
    if (kind !== 'act' && !id) problems.push('the answer carries no id (opts.idOf names it)');
    const getRoute = kind === 'act' && !opts.get ? null : this._readBackRoute(get, id, data);
    this.state.records[name] = { kind, step: s.name, status: 'done', id, persona, method, route, get: getRoute, said: harness.said(res), at: nowIso(), fieldProblems: problems, data: compact(data) };
    this.save();
    s.made += 1;
    this.counts.made += 1;
    if (VERBOSE) this._log('MADE', `${name}${id ? ` ${id}` : ''} (${harness.said(res)})`);
    if (problems.length) throw new BuildError(`${what}: ${persona} ${method} ${route} answered ${harness.said(res)} but ${problems.join('; ')}`, { request, said: harness.said(res) });
    return data;
  }

  /** A refusal the plan expects: asserted by its exact status and code; recorded so a rerun does not send it again. */
  async _refused(s, name, persona, method, route, payload, expected, opts) {
    const what = `refusal ${name}`;
    const existing = this._checkRecordName(name, s);
    const list = expectList(expected, what);
    if (list.some((e) => (typeof e === 'number' ? e : Number(String(e).split(' ')[0])) < 400)) throw new BuildError(`${what}: a refusal expects a 4xx`);
    const known = opts.known || null;
    const knownSaid = known ? knownList(known, what) : null;
    const idOf = opts.idOf || defaultIdOf;
    const request = { persona, method, route, payload };
    // If it is wrongly accepted it makes a record, and that record must carry the code too.
    this._namedCheck('refusal', name, payload, opts);
    if (existing?.status === 'done') {
      s.reused += 1;
      this.counts.reused += 1;
      return { said: existing.said, status: Number(existing.said.split(' ')[0]), code: existing.said.split(' ')[1] || null };
    }
    if (existing?.status === 'unexpected') {
      if (existing.blocked) throw new Blocked(existing.blocked.ref, existing.blocked.observed);
      throw new BuildError(`${what}: an earlier run was answered ${existing.said} (${existing.id ? `made ${existing.id}` : 'no id in the answer'}) where ${list.join(' or ')} was expected, so it is never sent again; resolve it by hand, then remove records["${name}"] from ${this.stateFile}`, { request });
    }
    if (existing?.status === 'pending') {
      if (typeof opts.find !== 'function') throw new BuildError(`${what}: an earlier run sent this request and stopped before its answer was recorded; give opts.find (whatever it would have made if it was wrongly accepted), or check by hand and remove records["${name}"] from ${this.stateFile}.`, { request });
      const found = await opts.find(s);
      if (found) {
        const observed = { said: '(accepted by an earlier run)', data: compact(found) };
        this.state.records[name] = { kind: 'refusal', step: s.name, status: 'unexpected', id: idOf(found), persona, method, route, said: 'accepted', at: nowIso(), blocked: known ? { ref: known.ref, observed } : null };
        this.save();
        if (known) throw new Blocked(known.ref, observed);
        throw new BuildError(`${what}: an earlier run's request was accepted (it made ${idOf(found)}) where ${list.join(' or ')} was expected`, { request });
      }
    }
    await this.session(persona);
    this.state.records[name] = { kind: 'refusal', step: s.name, status: 'pending', persona, method, route, sentAt: nowIso() };
    this.save();
    const res = await this.send(persona, method, route, payload);
    if (answerIn(res, list)) {
      this.state.records[name] = { kind: 'refusal', step: s.name, status: 'done', id: null, persona, method, route, said: harness.said(res), at: nowIso() };
      this.save();
      s.made += 1;
      this.counts.refusals += 1;
      return { said: harness.said(res), status: res.status, code: res.body?.error?.code || null, res };
    }
    const accepted = res.status >= 200 && res.status < 300;
    const created = accepted ? idOfSafe(idOf, res.body?.data) : null;
    const isKnown = Boolean(knownSaid) && answerIn(res, knownSaid);
    const observed = observedOf(res);
    if (accepted) {
      // Wrongly accepted (with an id or without one): kept, so a rerun never sends it again.
      this.state.records[name] = { kind: 'refusal', step: s.name, status: 'unexpected', id: created, persona, method, route, said: harness.said(res), at: nowIso(), blocked: isKnown ? { ref: known.ref, observed } : null, data: compact(res.body?.data) };
    } else {
      delete this.state.records[name]; // nothing was made: the next run asks again
    }
    this.save();
    if (isKnown) throw new Blocked(known.ref, observed);
    throw new BuildError(`${what}: ${persona} ${method} ${route} answered ${describe(res)}; expected ${list.join(' or ')}`, { request, said: harness.said(res), status: res.status, code: res.body?.error?.code || null, observed });
  }

  _log(tag, text) {
    console.log(`[${this.code}] ${tag.padEnd(8)} ${text}`);
  }
}

// ── the entry point every builder file calls ─────────────────────────────────
/**
 * lib.main('087-SCH', async (b) => { ... }): opens the build (lock, state,
 * company), runs the body, writes the results, exits 0 / 2 / 1.
 */
async function main(code, body, options = {}) {
  hookOutput(); // G8: before anything prints, the product's in-process mail console included
  let build = null;
  let exitCode = 1;
  try {
    build = new Build(code, options);
    const caller = path.basename(process.argv[1] || '');
    const inBuildDir = path.resolve(path.dirname(process.argv[1] || '')) === path.resolve(__dirname);
    if (inBuildDir && !caller.startsWith('_') && caller !== `${code.toLowerCase()}.js`) {
      throw new BuildError(`${caller} builds ${code}: a builder file is named after its code (${code.toLowerCase()}.js), so run-all.js and the state file agree`);
    }
    await build.open();
    await body(build);
    exitCode = build.report.some((r) => r.status === 'blocked') ? 2 : 0;
  } catch (error) {
    if (build) build.recordFailure(error);
    console.error(`[${code}] FAILED   ${error?.detail?.step || error?.step ? `step ${error?.detail?.step || error?.step}: ` : ''}${short(error?.message || String(error), 4000)}`);
    if (!(error instanceof BuildError) && error?.stack) console.error(short(error.stack, 3000));
    exitCode = 1;
  }
  if (build) exitCode = await build.close(exitCode);
  process.exit(exitCode);
}

module.exports = {
  VERSION,
  STATE_DIR,
  RESULT_DIR,
  DEEP,
  Blocked,
  Build,
  BuildError,
  Company,
  StepContext,
  api,
  dates,
  fieldProblems,
  formatCents: harness.formatCents,
  hookOutput,
  invitations,
  is,
  main,
  moveStateAside,
  readState,
  redact,
  redactDeep,
  REDACTED,
  refProblem,
  resultFileOf,
  said: harness.said,
  sameCents: harness.sameCents,
  stateFileOf,
  SUSPECT_REFS,
  toCents: harness.toCents,
  /** build/files.js, loaded on first use. */
  get files() {
    // eslint-disable-next-line global-require
    return require('./files');
  },
  /** The answer book, loaded on first use. */
  get answers() {
    /* eslint-disable global-require */
    return {
      schedule: require('../answers/schedule'),
      commercial: require('../answers/commercial'),
      fieldControls: require('../answers/field-controls'),
    };
    /* eslint-enable global-require */
  },
};
