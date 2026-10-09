'use strict';

/**
 * D-ID-1 C16 (owner decision Q13): sole-owner recovery by operators.
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/d-id-1-owner-recovery-proof.js [A=052] [B=025]
 *
 * Drives the operator command `src/cli/recover-owner.js` (`run(argv)`, in
 * process, its stdout and stderr captured) against `src/services/owner-recovery.service.js`
 * on the certification database. Throwaway people, a fresh stamp each run:
 *   op1, op2  operators on RECOVERY_OPERATOR_EMAILS with two-factor on (enabled through the API)
 *   op3       on the list, two-factor off
 *   op4       two-factor on, not on the list
 *   T         an active member of A (052): the person recovery makes owner
 *   S         a member of A that A suspended      G  a guest of A (party invitation)
 *   O         a member of B only
 * Refusals, each answered with its exact status and code, writing no request
 * row, no execution row, no ownership or administration change, and leaving an
 * `owner_recovery.refused` audit row: an operator off the list, without
 * two-factor, a wrong code, a replayed code, no ticket, a short reason, a
 * suspended / guest / other-company target, the requester approving their own
 * request, an expired request, `--single-operator` in production, and the
 * requester approving their own single-operator request in production.
 * The happy path: op1 requests, op2 approves; T is owner and administrator and
 * nothing else about T or A changed; a second approval is 409
 * RECOVERY_REQUEST_USED. The command's output carries no hash, token, secret
 * or code; the request and execution audit rows carry operator, ticket and reason.
 *
 * Forced interleavings and the emergency switch (Codex D-ID-1 diff review,
 * findings 7, 9 and 10), each against a throwaway active member of A (T2, T3,
 * T4), the lock held on a second connection and the waiting approval seen in
 * pg_locks (pg_blocking_pids of that connection) before it is released:
 *   finding 10  a valid request whose expiry is a moment away; the proof holds
 *               the request lock (pg_advisory_xact_lock(hashtext('owner_recovery'),
 *               hashtext(<request id>))), a second operator's approval passes the
 *               expiry check, waits on that lock, and is released only after the
 *               expiry has passed: 409 RECOVERY_REQUEST_EXPIRED, nothing granted.
 *   item 10     (Codex round 2) the expiry crosses AFTER the approval has judged
 *               it under the request lock, while it waits on a later statement:
 *               (T5) the proof holds the target's (org, e-mail) lock, not the
 *               request lock: the approval is seen holding the request lock and
 *               waiting on the target's key before the expiry; (T6) the proof's
 *               uncommitted UPDATE of the target's membership ("updatedAt" only,
 *               the status left active) holds the row: the approval is seen holding
 *               both advisory locks and waiting in the grant's UPDATE of
 *               "OrganizationMembership" before the expiry. Each is released only
 *               after the expiry: 409 RECOVERY_REQUEST_EXPIRED, the target neither
 *               owner nor administrator, no execution row, a refused audit row.
 *   finding 9   the target is suspended while the approval waits: (b1) the proof
 *               holds the target's (org, e-mail) lock, suspends the membership and
 *               commits; (b2) the proof's uncommitted suspension holds the
 *               membership row, the approval passes its standing check and its
 *               grant waits on the row: both 409 RECOVERY_TARGET_NOT_ACTIVE_MEMBER,
 *               no flag set.
 *   finding 7   AUTH_MEMBERSHIP_WRITE=false, a second operator approves a valid
 *               request: 503 MEMBERSHIP_WRITES_SUSPENDED, nothing granted, a
 *               refused audit row.
 *   round 4     (Codex round 3, the approver's proof invalidated during the
 *               approval; fixed by holding the approver's credential epoch) op1
 *               requests recovery of T7; the proof holds T7's (org, e-mail) lock;
 *               op2's approval is seen waiting on it with the request lock held
 *               (so op2 was proven, at its epoch, before the wait); while it waits
 *               op2 completes its own self-service password reset through the API
 *               (forgot-password link from the captured mail, POST
 *               /auth/reset-password: a real credential event, op2's
 *               credentialEpoch moves, committed) and only then is the lock
 *               released: 403 RECOVERY_OPERATOR_NOT_ALLOWED, T7 neither owner nor
 *               administrator, no execution row, exactly one refused audit row
 *               (op2, step approve, the request). op2 stays an active operator with
 *               two-factor on (a reset touches neither), so the happy path keeps
 *               its approver.
 *
 * Fixtures written with SQL (the product cannot produce them): one request
 * row's metadataJson.expiresAt moved into the past; another's moved to a moment
 * ahead (finding 10, item 10); T3's and T4's memberships set suspended
 * mid-approval (finding 9); T6's membership "updatedAt" touched by the lock-holding
 * UPDATE, committed after the expiry (item 10). Round 4 writes no fixture: op2's
 * credential event is the product's own self-service reset (op2 is a throwaway
 * operator; its new password is used nowhere else). Cleanup (finally): T's grant
 * removed and T suspended through the API, so no pending request of this run can
 * make anyone owner later; T3's and T4's fixture suspension undone and T2..T7
 * suspended through the API (any grant a mutated product made to them removed
 * first); the environment restored.
 *
 * Exit 0 when every check holds, 2 otherwise.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const guard = require('../lib/cert-env');
// The service and the command use the application's database module: point it at the
// certification database before anything under src/ is loaded (never the .env default).
process.env.DATABASE_URL = guard.certDatabaseUrl();
for (const name of ['JOB_WORKER_ENABLED', 'SCHEDULERS_ENABLED', 'EXCEPTIONS_ENGINE_ENABLED']) process.env[name] = 'false';

const crypto = require('crypto');
const fs = require('fs');
const util = require('util');
const api = require('../lib/api');
const invitations = require('../lib/invitations');
const { buildPopulation } = require('../lib/spec');
const fingerprint = require('../isolation/fingerprint');
const { totp, verifyTotp } = require('../../../src/utils/totp');

invitations.captureMail({ quiet: true });

const NAME = 'd-id-1-owner-recovery';
// setup 2 + 13 refusals x 3 + happy path 8 + output, other companies, 5xx 3
// + interleavings and switch: setup 1 + expiry 3 + two suspension races 2 x 3 + switch 3
// + item 10 (Codex round 2): expiry across the target's lock 3 + across the membership row 3
// + round 4 (Codex round 3): the approver's credential event during the approval 3
const EXPECTED_CHECKS = 74;
// Finding 10: how far ahead the request's expiry is put before its approval
// starts. The approval reaches the request lock well inside this, and waits on
// it past the expiry; Prisma's interactive transaction (5 s by default, which
// the service does not change) must outlive the wait, so this stays small.
const EXPIRY_LEAD_MS = 2_500;
const A_CODE = process.argv[2] || '052';
const B_CODE = process.argv[3] || '025';
const STATE_DIR = process.env.CERT_STATE_DIR || 'C:/Temp/octapm-cert/state';
const RESULT_DIR = 'C:/Temp/octapm-cert/results/cert3';
const STAMP = crypto.randomBytes(3).toString('hex');
const PASSWORD = process.env.CERT_PASSWORD;
const STEP_MS = 30_000;
const results = [];
const answers = [];
// What each forced interleaving observed (the waiter's lock types, timings), kept in the result file.
const interleavings = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail: ok ? undefined : detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n        ${detail}` : ''}`);
};
const said = (res) => (res ? `${res.status} ${res.body?.error?.code || res.code || ''}`.trim() : 'no answer');
const keep = (label, res) => {
  if (res && typeof res.status === 'number') answers.push({ label, status: res.status });
  return res;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── authenticator codes: one per 30-second step and operator ─────────────────
// Enabling two-factor spends the step of its code, and every accepted code
// spends its step (mfa.service spendTotpStep), so each operator's next code is
// for a later step: at most one step ahead of now (the verifier's window).
const counterNow = () => Math.floor(Date.now() / STEP_MS);
const usedCodes = new Set();
const nextCode = async (op) => {
  for (;;) {
    const now = counterNow();
    const step = Math.max(op.lastStep + 1, now);
    if (step <= now + 1) {
      op.lastStep = step;
      const code = totp(op.secret, { time: step * STEP_MS + 1 });
      usedCodes.add(code);
      return code;
    }
    await sleep((step - 1) * STEP_MS - Date.now() + 750);
  }
};
// A well-formed current code that is not counted as spent: for refusals the
// service makes before it looks at the code at all.
const peekCode = (op) => {
  const code = totp(op.secret);
  usedCodes.add(code);
  return code;
};
// Six digits that match no step of the operator's window.
const wrongCode = (op) => {
  const now = counterNow();
  const valid = new Set([-1, 0, 1, 2].map((d) => totp(op.secret, { time: (now + d) * STEP_MS + 1 })));
  let n = crypto.randomInt(0, 1_000_000);
  while (valid.has(String(n).padStart(6, '0'))) n = (n + 1) % 1_000_000;
  return String(n).padStart(6, '0');
};

// ── the operator command, in process, its output captured ────────────────────
const cli = require('../../../src/cli/recover-owner');
const cliOutput = [];
const runCli = async (label, argv) => {
  const out = [];
  const err = [];
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error, stdout: process.stdout.write, stderr: process.stderr.write, exitCode: process.exitCode };
  console.log = (...args) => { out.push(util.format(...args)); };
  console.info = console.log;
  console.warn = (...args) => { err.push(util.format(...args)); };
  console.error = console.warn;
  process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
  let result = null;
  let error = null;
  try {
    result = await cli.run(argv);
  } catch (e) {
    error = e;
    // What the command's entry point (`require.main === module`) prints for a refusal.
    console.error(`${e?.code || 'RECOVERY_FAILED'}: ${e?.message || 'failed'}`);
  } finally {
    Object.assign(console, { log: saved.log, info: saved.info, warn: saved.warn, error: saved.error });
    process.stdout.write = saved.stdout;
    process.stderr.write = saved.stderr;
    process.exitCode = saved.exitCode;
  }
  cliOutput.push({ label, stdout: out.join('\n'), stderr: err.join('\n') });
  return error
    ? { ok: false, status: error.status, code: error.code, message: error.message, stack: error.status ? null : String(error.stack || error) }
    : { ok: true, status: 0, code: null, result };
};
const saidCli = (r) => (r.ok ? `ok ${r.result?.requestId || ''}`.trim() : `${r.status} ${r.code}${r.stack ? ` ${r.stack.split('\n')[0]}` : ''}`);

const main = async () => {
  if (!PASSWORD) throw new Error('CERT_PASSWORD is not set');
  const { companies } = buildPopulation();
  const [A, B] = [A_CODE, B_CODE].map((code) => companies.find((c) => c.code === code));
  const db = await guard.connectCert();
  // A second connection that holds the product's own locks while an approval waits on them.
  const lockDb = await guard.connectCert();
  const lockPid = (await lockDb.query('select pg_backend_pid() as pid')).rows[0].pid;
  let lockOpen = false;
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const orgOf = async (code) => (await q('select id, name from "Organisation" where slug like $1', [`cert-${code}-%`]))[0];
  const [orgA, orgB] = [await orgOf(A_CODE), await orgOf(B_CODE)];
  const aPm = api.as(`pm@${A.domain}`);
  const bPm = api.as(`pm@${B.domain}`);
  const projectA = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'inventory', `${A.code}.json`), 'utf8')).projects[`${A.code}-01`].id;
  console.log(`${NAME} proof: A ${A_CODE} (workspace recovered), B ${B_CODE} (other company); stamp ${STAMP}\n`);

  const envBefore = { RECOVERY_OPERATOR_EMAILS: process.env.RECOVERY_OPERATOR_EMAILS, NODE_ENV: process.env.NODE_ENV, MFA_SECRET_KEY: process.env.MFA_SECRET_KEY, AUTH_MEMBERSHIP_WRITE: process.env.AUTH_MEMBERSHIP_WRITE };
  const restoreEnv = () => {
    for (const [key, value] of Object.entries(envBefore)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  const person = (label, domain) => ({ label, email: `did1.rec.${label}.${STAMP}@${domain}`, name: `DID1 recovery ${label} ${STAMP}` });
  const op1 = person('op1', B.domain);
  const op2 = person('op2', B.domain);
  const op3 = person('op3', B.domain);
  const op4 = person('op4', B.domain);
  const T = person('target', A.domain);
  const S = person('suspended', A.domain);
  const G = person('guest', A.domain);
  const O = person('other', B.domain);
  // Targets of the forced interleavings and the switch (findings 7, 9, 10).
  const T2 = person('expiry', A.domain);
  const T3 = person('racelock', A.domain);
  const T4 = person('racerow', A.domain);
  const raceTargets = [T2, T3, T4];
  const fixtureSuspended = new Set();
  let tGranted = false;

  try {
    // ── set-up, through the API ─────────────────────────────────────────────
    console.log('── set-up ──');
    for (const p of [op1, op2, op3, op4, O]) {
      const made = await invitations.createByInvitation({ inviter: bPm, email: p.email, role: 'qs', name: p.name, password: PASSWORD, db });
      keep(`setup ${p.label} invite`, made.invited);
      keep(`setup ${p.label} accept`, made.accepted);
      p.id = made.userId;
    }
    for (const p of [T, S]) {
      const made = await invitations.createByInvitation({ inviter: aPm, email: p.email, role: 'qs', name: p.name, password: PASSWORD, db });
      keep(`setup ${p.label} invite`, made.invited);
      keep(`setup ${p.label} accept`, made.accepted);
      p.id = made.userId;
    }
    let partyId = (await q('select id from "ProjectParty" where "projectId" = $1 order by "createdAt" limit 1', [projectA]))[0]?.id;
    if (!partyId) {
      const party = keep('setup party', await aPm.send('POST', `/projects/${projectA}/parties`, { role: 'subcontractor', companyName: `DID1 recovery party ${STAMP}` }));
      partyId = party.body?.data?.id;
    }
    const madeG = await invitations.createByInvitation({ inviter: aPm, email: G.email, role: 'site_engineer', name: G.name, password: PASSWORD, projectId: projectA, projectPartyId: partyId, db });
    keep('setup guest invite', madeG.invited);
    keep('setup guest accept', madeG.accepted);
    G.id = madeG.userId;
    const suspended = keep('setup suspend S', await aPm.send('PATCH', `/users/${S.id}/deactivate`, {}));
    // Two-factor for op1, op2 and op4: setup, then enable with a current code (which spends its step).
    for (const op of [op1, op2, op4]) {
      const token = await api.tokenFor(op.email);
      const setup = keep(`setup ${op.label} mfa`, await api.raw('POST', '/auth/mfa/setup', { token, json: {} }));
      op.secret = setup.body?.data?.secret || '';
      const step = counterNow();
      const enabled = keep(`setup ${op.label} mfa enable`, await api.raw('POST', '/auth/mfa/enable', { token, json: { code: totp(op.secret, { time: step * STEP_MS + 1 }) } }));
      op.lastStep = step;
      op.mfaOn = enabled.status === 200;
      api.forget(op.email);
    }
    op3.secret = '';
    op3.lastStep = 0;
    const userRow = async (id) => (await q('select id, "orgId", status, "mfaEnabled" from "User" where id = $1', [id]))[0] || null;
    const membershipIn = async (orgId, userId) => (await q('select id, role, kind, status, "isAdmin", "isOwner" from "OrganizationMembership" where "orgId" = $1 and "userId" = $2', [orgId, userId]))[0] || null;
    const mT = await membershipIn(orgA.id, T.id);
    const mS = await membershipIn(orgA.id, S.id);
    const mG = await membershipIn(orgA.id, G.id);
    const mO = await membershipIn(orgA.id, O.id);
    const opRows = [];
    for (const op of [op1, op2, op3, op4]) opRows.push(await userRow(op.id));
    const setupOk = [op1, op2, op3, op4, T, S, G, O].every((p) => p.id)
      && opRows.map((r) => r?.mfaEnabled).join(',') === 'true,true,false,true'
      && mT?.status === 'active' && mT.kind === 'member' && !mT.isOwner && !mT.isAdmin
      && mS?.status === 'suspended' && suspended.status === 200
      && mG?.status === 'active' && mG.kind === 'guest'
      && mO === null && (await membershipIn(orgB.id, O.id))?.status === 'active';
    check('setup: operators op1, op2, op4 have two-factor on and op3 not; T is an active member of A; S is suspended in A; G is an active guest of A; O is a member of B only',
      setupOk,
      `ids ${[op1, op2, op3, op4, T, S, G, O].map((p) => `${p.label}=${Boolean(p.id)}`).join(' ')}; mfa ${opRows.map((r) => r?.mfaEnabled).join(',')}; T ${JSON.stringify(mT)}; S ${JSON.stringify(mS)} (${said(suspended)}); G ${JSON.stringify(mG)}; O in A ${JSON.stringify(mO)}`);
    if (!setupOk) throw new Error('setup incomplete');
    process.env.RECOVERY_OPERATOR_EMAILS = [op1.email, op2.email, op3.email].join(',');

    // The operator command is reachable from no web or API route.
    const srcRoot = path.join(__dirname, '..', '..', '..', 'src');
    const reachers = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!['__tests__', '__live__'].includes(entry.name)) walk(full);
        } else if (/\.(c|m)?js$/.test(entry.name) && /owner-recovery|recover-owner/.test(fs.readFileSync(full, 'utf8'))) {
          reachers.push(path.relative(srcRoot, full).replace(/\\/g, '/'));
        }
      }
    };
    walk(srcRoot);
    const allowedReachers = ['cli/recover-owner.js', 'services/owner-recovery.service.js'];
    check('Q13: recovery is an operator command only: no route, app or other module under src/ loads it',
      reachers.every((file) => allowedReachers.includes(file)), `files naming it: ${reachers.join(', ')}`);

    // ── what a refusal must not write ───────────────────────────────────────
    const targets = [T.id, S.id, G.id, O.id];
    const state = async () => JSON.stringify({
      requested: (await q(`select count(*)::int as n from "AuthAuditEvent" where "entityType" = 'owner_recovery' and action = 'owner_recovery.requested'`))[0].n,
      executed: (await q(`select count(*)::int as n from "AuthAuditEvent" where "entityType" = 'owner_recovery' and action = 'owner_recovery.executed'`))[0].n,
      grants: (await q(`select count(*)::int as n from "AuthAuditEvent" where "entityType" = 'membership' and action in ('membership.owner_granted', 'membership.admin_granted') and "orgId" = $1`, [orgA.id]))[0].n,
      membershipsA: await q(`select "userId", role, kind, status, "isAdmin", "isOwner" from "OrganizationMembership" where "orgId" = $1 order by "userId"`, [orgA.id]),
      people: await q(`select id, "orgId", status, role, "isCompanyAdmin" from "User" where id = any($1::text[]) order by id`, [targets]),
    });
    const operatorEmails = [op1, op2, op3, op4].map((op) => op.email);
    const refusedRows = async () => q(`select id, "orgId", "userId", "metadataJson" as meta from "AuthAuditEvent" where "entityType" = 'owner_recovery' and action = 'owner_recovery.refused' and "metadataJson"->>'operatorEmail' = any($1::text[]) order by "createdAt"`, [operatorEmails]);

    /**
     * One refusal: the exact status and code; no request, execution, grant,
     * membership or person row changed; and one new owner_recovery.refused row
     * naming the operator, the step, the code and what was asked.
     */
    const refusal = async (label, act, { status, code, op, step, orgId = null, userId = null, requestId = null, extra = null }) => {
      const before = await state();
      const refusedBefore = new Set((await refusedRows()).map((r) => r.id));
      const r = await act();
      const after = await state();
      const fresh = (await refusedRows()).filter((row) => !refusedBefore.has(row.id));
      const extraOk = extra ? extra(r) : { ok: true, detail: '' };
      check(`${label}: refused ${status} ${code}`, !r.ok && r.status === status && r.code === code && extraOk.ok, `${saidCli(r)}${r.message ? ` "${r.message}"` : ''}${extraOk.detail ? `; ${extraOk.detail}` : ''}`);
      const differs = () => {
        const [b, a] = [JSON.parse(before), JSON.parse(after)];
        return Object.keys(b).filter((key) => JSON.stringify(b[key]) !== JSON.stringify(a[key])).map((key) => (Array.isArray(b[key])
          ? `${key}: ${a[key].filter((row) => !b[key].some((old) => JSON.stringify(old) === JSON.stringify(row))).map((row) => JSON.stringify(row)).join(' ')}`
          : `${key}: ${b[key]} -> ${a[key]}`)).join('; ');
      };
      check(`${label}: nothing written (no request or execution row, no ownership, administration or membership change)`, after === before, before === after ? '' : differs());
      const matching = fresh.filter((row) => row.meta?.operatorEmail === op.email && row.meta?.step === step && row.meta?.code === code
        && (row.orgId || null) === orgId && (row.userId || null) === userId && (row.meta?.requestId || null) === requestId);
      check(`${label}: recorded as one owner_recovery.refused audit row (operator, step, code, workspace, person, request)`, fresh.length === 1 && matching.length === 1,
        `${fresh.length} new refused row(s): ${JSON.stringify(fresh.map((row) => ({ orgId: row.orgId, userId: row.userId, ...row.meta })))}`);
      return r;
    };
    const TICKET = `CERT-REC-${STAMP}`;
    const REASON = `Sole owner lost mailbox and password; verified by call-back (${STAMP})`;
    const requestArgs = ({ user = T.id, org = orgA.id, operator, code, ticket = TICKET, reason = REASON, single = false }) => [
      'request', '--org', org, '--user', user,
      ...(ticket === null ? [] : ['--ticket', ticket]),
      ...(reason === null ? [] : ['--reason', reason]),
      '--operator', operator, '--totp', code,
      ...(single ? ['--single-operator'] : []),
    ];
    const approveArgs = ({ request, operator, code }) => ['approve', '--request', request, '--operator', operator, '--totp', code];

    // ── the operator ────────────────────────────────────────────────────────
    console.log('\n── the operator ──');
    await refusal('C16 an operator not on RECOVERY_OPERATOR_EMAILS (two-factor on, a current code)',
      async () => runCli('not on list', requestArgs({ operator: op4.email, code: await nextCode(op4) })),
      { status: 403, code: 'RECOVERY_OPERATOR_NOT_ALLOWED', op: op4, step: 'request', orgId: orgA.id, userId: T.id });
    await refusal('C16 an operator on the list without two-factor',
      () => runCli('no mfa', requestArgs({ operator: op3.email, code: '123456' })),
      { status: 403, code: 'RECOVERY_OPERATOR_MFA_REQUIRED', op: op3, step: 'request', orgId: orgA.id, userId: T.id });
    await refusal('C16 a wrong authenticator code',
      () => runCli('wrong code', requestArgs({ operator: op1.email, code: wrongCode(op1) })),
      { status: 403, code: 'RECOVERY_OPERATOR_CODE_INVALID', op: op1, step: 'request', orgId: orgA.id, userId: T.id });
    // A code that has just worked once, sent again while it is still current.
    const replayCode = await nextCode(op2);
    const r1 = await runCli('R1 request', requestArgs({ operator: op2.email, code: replayCode }));
    await refusal('C16 a replayed authenticator code (accepted once, still current)',
      () => runCli('replayed code', requestArgs({ operator: op2.email, code: replayCode })),
      { status: 403, code: 'RECOVERY_OPERATOR_CODE_INVALID', op: op2, step: 'request', orgId: orgA.id, userId: T.id,
        extra: () => ({ ok: r1.ok && verifyTotp(op2.secret, replayCode) !== null, detail: `first use ${saidCli(r1)}; still within the time window ${verifyTotp(op2.secret, replayCode) !== null}` }) });

    // ── the request ─────────────────────────────────────────────────────────
    console.log('\n── the request ──');
    await refusal('C16 a request without a ticket',
      () => runCli('no ticket', requestArgs({ operator: op1.email, code: peekCode(op1), ticket: null })),
      { status: 400, code: 'VALIDATION_ERROR', op: op1, step: 'request', orgId: orgA.id, userId: T.id, extra: (r) => ({ ok: /ticket/i.test(r.message || ''), detail: 'message names the ticket' }) });
    await refusal('C16 a request with a short reason (9 characters)',
      () => runCli('short reason', requestArgs({ operator: op1.email, code: peekCode(op1), reason: 'lost pass' })),
      { status: 400, code: 'VALIDATION_ERROR', op: op1, step: 'request', orgId: orgA.id, userId: T.id, extra: (r) => ({ ok: /reason/i.test(r.message || ''), detail: 'message names the reason' }) });
    await refusal('C16 NODE_ENV=production with --single-operator',
      async () => {
        process.env.NODE_ENV = 'production';
        try {
          return await runCli('production single', requestArgs({ operator: op1.email, code: peekCode(op1), single: true }));
        } finally {
          restoreEnv();
          process.env.RECOVERY_OPERATOR_EMAILS = [op1.email, op2.email, op3.email].join(',');
        }
      },
      { status: 403, code: 'RECOVERY_TWO_PERSON_REQUIRED', op: op1, step: 'request', orgId: orgA.id, userId: T.id });

    // ── the target ──────────────────────────────────────────────────────────
    console.log('\n── the target ──');
    for (const [label, who, op] of [['suspended in A', S, op1], ['a guest of A', G, op2], ['a member of another company only', O, op1]]) {
      await refusal(`C16 a target who is ${label}`,
        async () => runCli(`target ${who.label}`, requestArgs({ user: who.id, operator: op.email, code: await nextCode(op) })),
        { status: 409, code: 'RECOVERY_TARGET_NOT_ACTIVE_MEMBER', op, step: 'request', orgId: orgA.id, userId: who.id });
    }

    // ── the approval ────────────────────────────────────────────────────────
    console.log('\n── the approval ──');
    const r3 = await runCli('R3 request', requestArgs({ operator: op2.email, code: await nextCode(op2) }));
    const r4 = await runCli('R4 request single', requestArgs({ operator: op1.email, code: await nextCode(op1), single: true }));
    await refusal('C16 the requester approves their own request',
      async () => runCli('self approval', approveArgs({ request: r3.result?.requestId, operator: op2.email, code: await nextCode(op2) })),
      { status: 403, code: 'RECOVERY_TWO_PERSON_REQUIRED', op: op2, step: 'approve', requestId: r3.result?.requestId || null,
        extra: () => ({ ok: r3.ok, detail: `request ${saidCli(r3)}` }) });
    // In production even a request made with --single-operator needs a second operator.
    // MFA_SECRET_KEY is set to the key the operators' seeds were sealed with outside
    // production (the JWT_SECRET fallback, which production does not read), so the
    // code check runs as it would in production.
    await refusal('C16 in production the requester approves their own --single-operator request',
      async () => {
        const code = await nextCode(op1);
        process.env.NODE_ENV = 'production';
        process.env.MFA_SECRET_KEY = process.env.MFA_SECRET_KEY || process.env.INTEGRATION_SECRET_KEY || process.env.JWT_SECRET;
        try {
          return await runCli('production self approval', approveArgs({ request: r4.result?.requestId, operator: op1.email, code }));
        } finally {
          restoreEnv();
          process.env.RECOVERY_OPERATOR_EMAILS = [op1.email, op2.email, op3.email].join(',');
        }
      },
      { status: 403, code: 'RECOVERY_TWO_PERSON_REQUIRED', op: op1, step: 'approve', requestId: r4.result?.requestId || null,
        extra: () => ({ ok: r4.ok, detail: `request ${saidCli(r4)}` }) });
    // R1 (op2's) made to expire: the fixture moves its expiresAt into the past.
    await db.query(`update "AuthAuditEvent" set "metadataJson" = jsonb_set("metadataJson", '{expiresAt}', to_jsonb((now() - interval '1 minute')::text)) where id = $1 and "entityType" = 'owner_recovery' and action = 'owner_recovery.requested'`, [r1.result?.requestId]);
    await refusal('C16 an expired request, approved by a second operator',
      () => runCli('expired', approveArgs({ request: r1.result?.requestId, operator: op1.email, code: peekCode(op1) })),
      { status: 409, code: 'RECOVERY_REQUEST_EXPIRED', op: op1, step: 'approve', requestId: r1.result?.requestId || null });

    // ── forced interleavings and the emergency switch ───────────────────────
    // Codex D-ID-1 diff review findings 10 (expiry judged again under the
    // request lock), 9 (a suspension that lands while the approval runs) and 7
    // (the switch). The proof holds the product's own lock on lockDb, sees the
    // approval wait on it (pg_locks, blocked by lockDb's backend), changes what
    // the product must judge again, and only then releases the lock.
    console.log('\n── forced interleavings and the emergency switch ──');
    for (const p of raceTargets) {
      const made = await invitations.createByInvitation({ inviter: aPm, email: p.email, role: 'qs', name: p.name, password: PASSWORD, db });
      keep(`setup ${p.label} invite`, made.invited);
      keep(`setup ${p.label} accept`, made.accepted);
      p.id = made.userId;
      if (p.id) targets.push(p.id);
    }
    const raceRows = [];
    for (const p of raceTargets) {
      raceRows.push({
        label: p.label,
        m: p.id ? await membershipIn(orgA.id, p.id) : null,
        u: p.id ? (await q('select email, status, "orgId", "isCompanyAdmin" from "User" where id = $1', [p.id]))[0] || null : null,
      });
    }
    const raceSetupOk = raceRows.every(({ m, u }) => m?.status === 'active' && m.kind === 'member' && !m.isOwner && !m.isAdmin
      && u?.status === 'active' && u.orgId === orgA.id && !u.isCompanyAdmin);
    check('setup (interleavings): T2, T3 and T4 are active members of A, homed there, neither owner nor administrator', raceSetupOk, JSON.stringify(raceRows));
    if (!raceSetupOk) throw new Error('interleaving setup incomplete');
    raceTargets.forEach((p, index) => { p.storedEmail = raceRows[index].u.email; });

    const blockedByLock = async () => q('select l.pid, l.locktype from pg_locks l where not l.granted and $1 = any(pg_blocking_pids(l.pid))', [lockPid]);
    /**
     * Hold `hold` (statements run in one transaction on lockDb), start the
     * approval, wait until it is seen waiting behind lockDb (or finishes, or 15 s
     * pass), run `whileWaiting` inside the same transaction, then `end` it.
     */
    const interleave = async ({ hold, start, whileWaiting = null, end = 'commit', timeoutMs = 15_000 }) => {
      await lockDb.query('begin');
      lockOpen = true;
      let pending = null;
      try {
        for (const [sql, params] of hold) await lockDb.query(sql, params);
        let settled = false;
        pending = start();
        pending.then(() => { settled = true; }, () => { settled = true; });
        let seen = null;
        const until = Date.now() + timeoutMs;
        while (!settled && Date.now() < until) {
          const rows = await blockedByLock();
          if (rows.length) {
            seen = { at: Date.now(), types: [...new Set(rows.map((row) => row.locktype))].sort() };
            break;
          }
          await sleep(25);
        }
        if (whileWaiting) await whileWaiting(seen);
        const settledBeforeRelease = settled;
        await lockDb.query(end);
        lockOpen = false;
        const releasedAt = Date.now();
        return { result: await pending, seen, settledBeforeRelease, releasedAt };
      } catch (error) {
        if (lockOpen) {
          lockOpen = false;
          await lockDb.query('rollback').catch(() => null);
        }
        if (pending) await pending.catch(() => null);
        throw error;
      }
    };
    // The product's own locks, with the keys it takes them under.
    const requestLock = (requestId) => ['select pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))', ['owner_recovery', requestId]];
    const targetLock = (orgId, email) => ['select pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))', [orgId, email]];
    // Fixture: the membership suspended (a throwaway person; undone in the cleanup).
    const suspendFixture = (who) => {
      fixtureSuspended.add(who.id);
      return [`update "OrganizationMembership" set status = 'suspended' where "orgId" = $1 and "userId" = $2 and status = 'active'`, [orgA.id, who.id]];
    };
    const stateDiff = (expectedJson, actualJson) => {
      const [e, a] = [JSON.parse(expectedJson), JSON.parse(actualJson)];
      return Object.keys(e).filter((key) => JSON.stringify(e[key]) !== JSON.stringify(a[key])).map((key) => (Array.isArray(e[key])
        ? `${key}: ${a[key].filter((row) => !e[key].some((old) => JSON.stringify(old) === JSON.stringify(row))).map((row) => JSON.stringify(row)).join(' ')}`
        : `${key}: ${e[key]} -> ${a[key]}`)).join('; ');
    };

    // Finding 10: a valid request whose expiry is a moment away. The proof holds
    // the request lock; a second operator's approval passes the expiry check
    // before the lock, waits on it, and is released only once the expiry has
    // passed. It must judge the expiry again under the lock. (Since round 3 the
    // re-check after the grant refuses this case too, with the same answer and
    // a rollback, so mutation F10 removes both re-checks.)
    const ra =await runCli('Ra request', requestArgs({ user: T2.id, operator: op1.email, code: await nextCode(op1) }));
    const raId = ra.result?.requestId || null;
    let raRun = null;
    let raExpiresAt = NaN;
    await refusal('Finding 10: a request that expires while its approval (a second operator) waits on the request lock',
      async () => {
        const code = await nextCode(op2);
        raExpiresAt = Date.now() + EXPIRY_LEAD_MS;
        await db.query(`update "AuthAuditEvent" set "metadataJson" = jsonb_set("metadataJson", '{expiresAt}', to_jsonb($2::text)) where id = $1 and "entityType" = 'owner_recovery' and action = 'owner_recovery.requested'`, [raId, new Date(raExpiresAt).toISOString()]);
        raRun = await interleave({
          hold: [requestLock(raId || '')],
          start: () => runCli('Ra approve across the expiry', approveArgs({ request: raId || 'none', operator: op2.email, code })),
          // Released only once the expiry is behind (and well inside the approval transaction's 5 s).
          whileWaiting: async () => { await sleep(Math.max(0, raExpiresAt + 300 - Date.now())); },
          end: 'rollback',
        });
        return raRun.result;
      },
      { status: 409, code: 'RECOVERY_REQUEST_EXPIRED', op: op2, step: 'approve', requestId: raId,
        extra: () => {
          const waited = Boolean(raRun?.seen?.types.includes('advisory'));
          const crossed = Boolean(raRun && raRun.releasedAt > raExpiresAt);
          const seen = { name: 'finding 10 expiry under the request lock', waiter: raRun?.seen?.types || null, seenMsFromExpiry: raRun?.seen ? raRun.seen.at - raExpiresAt : null, releasedMsAfterExpiry: raRun ? raRun.releasedAt - raExpiresAt : null, finishedBeforeRelease: Boolean(raRun?.settledBeforeRelease), answer: raRun ? saidCli(raRun.result) : null };
          interleavings.push(seen);
          console.log(`        observed: ${JSON.stringify(seen)}`);
          return {
            ok: ra.ok && waited && crossed,
            detail: `request ${saidCli(ra)}; waiter ${JSON.stringify(raRun?.seen || null)} (seen ${raRun?.seen ? raRun.seen.at - raExpiresAt : '?'} ms from the expiry${raRun?.settledBeforeRelease ? '; the approval finished before the lock was released' : ''}); lock released ${raRun ? raRun.releasedAt - raExpiresAt : '?'} ms after the expiry`,
          };
        } });

    // Item 10 (Codex round 2): the expiry crosses AFTER the approval has judged
    // it under the request lock, while the approval waits on a later statement
    // (the target's (org, e-mail) lock, or the membership row its grant writes).
    // The approval must judge the expiry once more after its last waiting
    // statement and roll back: 409 RECOVERY_REQUEST_EXPIRED, nothing granted, no
    // execution row. Two fresh active members of A, so each race starts clean.
    const T5 = person('expirylock', A.domain);
    const T6 = person('expiryrow', A.domain);
    for (const p of [T5, T6]) {
      const made = await invitations.createByInvitation({ inviter: aPm, email: p.email, role: 'qs', name: p.name, password: PASSWORD, db });
      keep(`setup ${p.label} invite`, made.invited);
      keep(`setup ${p.label} accept`, made.accepted);
      p.id = made.userId;
      if (p.id) {
        targets.push(p.id);
        // Cleaned up with the other interleaving targets (grants removed, suspended through the API).
        raceTargets.push(p);
        p.storedEmail = (await q('select email from "User" where id = $1', [p.id]))[0]?.email || null;
      }
    }
    // The two int4 keys of an advisory lock, as pg_locks shows them (classid, objid).
    const advisoryKey = async (a, b) => (await q(
      'select ((hashtext($1::text)::bigint + 4294967296) % 4294967296)::text as k1, ((hashtext($2::text)::bigint + 4294967296) % 4294967296)::text as k2',
      [a, b],
    ))[0];
    // What is waiting behind lockDb (lock type, advisory keys, the statement), and the advisory locks a backend already holds.
    const waitingOnLockDb = async () => q(
      `select l.pid, l.locktype, l.classid::text as k1, l.objid::text as k2, left(regexp_replace(coalesce(a.query, ''), '\\s+', ' ', 'g'), 240) as query
         from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where not l.granted and $1::int = any(pg_blocking_pids(l.pid))`,
      [lockPid],
    );
    const advisoryHeldBy = async (pid) => q(`select classid::text as k1, objid::text as k2 from pg_locks where pid = $1 and granted and locktype = 'advisory' and objsubid = 2`, [pid]);
    /**
     * One request for `who`, its expiry moved EXPIRY_LEAD_MS ahead, approved by a
     * second operator while lockDb holds `hold`. The approval must be seen,
     * before the expiry, holding the request lock (so past its request-lock
     * expiry judgement) and waiting where `at` says; lockDb ends (`end`) only
     * after the expiry. Then: 409 RECOVERY_REQUEST_EXPIRED, nothing written, one
     * refused audit row (refusal()), and explicitly: not owner or administrator,
     * no execution row for the request.
     */
    const expiryAcross = async (label, { who, requester, approver, hold, end, at }) => {
      const userOf = async () => (who.id ? (await q('select status, "orgId", "isCompanyAdmin" from "User" where id = $1', [who.id]))[0] || null : null);
      const req = await runCli(`${who.label} request`, requestArgs({ user: who.id || 'none', operator: requester.email, code: await nextCode(requester) }));
      const requestId = req.result?.requestId || null;
      const executedFor = async () => (requestId ? (await q(`select count(*)::int as n from "AuthAuditEvent" where "entityType" = 'owner_recovery' and action = 'owner_recovery.executed' and "metadataJson"->>'requestId' = $1`, [requestId]))[0].n : -1);
      const pre = { m: who.id ? await membershipIn(orgA.id, who.id) : null, u: await userOf() };
      const preOk = Boolean(who.id && who.storedEmail) && pre.m?.status === 'active' && pre.m.kind === 'member' && !pre.m.isOwner && !pre.m.isAdmin
        && pre.u?.status === 'active' && pre.u.orgId === orgA.id && !pre.u.isCompanyAdmin;
      const requestKey = await advisoryKey('owner_recovery', requestId || '');
      const targetKey = await advisoryKey(orgA.id, who.storedEmail || '');
      let run = null;
      let expiresAt = NaN;
      let waiter = null;
      let post = null;
      await refusal(label,
        async () => {
          const code = await nextCode(approver);
          expiresAt = Date.now() + EXPIRY_LEAD_MS;
          await db.query(`update "AuthAuditEvent" set "metadataJson" = jsonb_set("metadataJson", '{expiresAt}', to_jsonb($2::text)) where id = $1 and "entityType" = 'owner_recovery' and action = 'owner_recovery.requested'`, [requestId, new Date(expiresAt).toISOString()]);
          run = await interleave({
            hold: hold(),
            start: () => runCli(`${who.label} approve across the expiry`, approveArgs({ request: requestId || 'none', operator: approver.email, code })),
            // Seen waiting: record where, and which advisory locks it already holds; release only once the expiry is behind
            // (and well inside the approval transaction's 5 s).
            whileWaiting: async (seen) => {
              if (!seen) return;
              const rows = await waitingOnLockDb();
              const held = rows.length ? await advisoryHeldBy(rows[0].pid) : [];
              const holds = (key) => held.some((k) => k.k1 === key.k1 && k.k2 === key.k2);
              waiter = { rows, holdsRequestLock: holds(requestKey), holdsTargetLock: holds(targetKey) };
              await sleep(Math.max(0, expiresAt + 300 - Date.now()));
            },
            end,
          });
          post = { m: who.id ? await membershipIn(orgA.id, who.id) : null, u: await userOf(), executed: await executedFor() };
          return run.result;
        },
        { status: 409, code: 'RECOVERY_REQUEST_EXPIRED', op: approver, step: 'approve', requestId,
          extra: () => {
            const where = waiter ? waiter.rows.find((row) => at.match(row, targetKey)) || null : null;
            const waitedThere = Boolean(where) && waiter.holdsRequestLock && (!at.pastTargetLock || waiter.holdsTargetLock);
            // Seen waiting before the expiry: the request-lock judgement it had already made found the request live.
            const judgedLive = Boolean(run?.seen) && run.seen.at < expiresAt;
            const crossed = Boolean(run) && run.releasedAt > expiresAt && !run.settledBeforeRelease;
            const nothingGranted = post?.m?.status === 'active' && post.m.isOwner === false && post.m.isAdmin === false && post.u?.isCompanyAdmin === false && post.executed === 0;
            const seen = {
              name: label,
              waiter: waiter ? waiter.rows.map((row) => ({ locktype: row.locktype, query: row.query })) : null,
              holdsRequestLock: waiter?.holdsRequestLock ?? null,
              holdsTargetLock: waiter?.holdsTargetLock ?? null,
              seenMsFromExpiry: run?.seen ? run.seen.at - expiresAt : null,
              releasedMsAfterExpiry: run ? run.releasedAt - expiresAt : null,
              finishedBeforeRelease: Boolean(run?.settledBeforeRelease),
              answer: run ? saidCli(run.result) : null,
            };
            interleavings.push(seen);
            console.log(`        observed: ${JSON.stringify(seen)}`);
            return {
              ok: req.ok && preOk && waitedThere && judgedLive && crossed && nothingGranted,
              detail: `request ${saidCli(req)}; before ${JSON.stringify(pre)}; waiting ${JSON.stringify(waiter)} (expected ${at.what}; seen ${seen.seenMsFromExpiry ?? '?'} ms from the expiry${run?.settledBeforeRelease ? '; the approval finished before the lock was released' : ''}); released ${seen.releasedMsAfterExpiry ?? '?'} ms after the expiry; after ${JSON.stringify(post)}`,
            };
          } });
    };
    // (T5) The proof holds the target's (org, e-mail) lock — not the request lock.
    await expiryAcross('Item 10: a request that expires while its approval (a second operator), past the request-lock expiry judgement, waits on the target\'s (org, e-mail) lock', {
      who: T5, requester: op2, approver: op1,
      hold: () => [targetLock(orgA.id, T5.storedEmail || '')],
      end: 'rollback',
      at: {
        what: 'an advisory wait on the target\'s (org, e-mail) key in pg_advisory_xact_lock, the request lock held',
        match: (row, key) => row.locktype === 'advisory' && row.k1 === key.k1 && row.k2 === key.k2 && /pg_advisory_xact_lock/i.test(row.query || ''),
        pastTargetLock: false,
      },
    });
    // (T6) The proof's uncommitted UPDATE of T6's membership leaves its status
    // active and holds the row: the approval passes both advisory locks and its
    // standing check, and its grant waits on the row. Committed after the expiry,
    // so the grant then writes (the row is still active) and only the expiry
    // judgement after it can refuse.
    await expiryAcross('Item 10: a request that expires while its approval\'s grant waits on the target\'s membership row (an uncommitted UPDATE that leaves the status active)', {
      who: T6, requester: op1, approver: op2,
      hold: () => [[`update "OrganizationMembership" set "updatedAt" = now() where "orgId" = $1 and "userId" = $2 and status = 'active'`, [orgA.id, T6.id || '']]],
      end: 'commit',
      at: {
        what: 'a row wait in the grant\'s UPDATE of "OrganizationMembership" (isOwner), the request and target locks held',
        match: (row) => ['transactionid', 'tuple'].includes(row.locktype) && /UPDATE\s+("public"\.)?"OrganizationMembership"\s+SET\b/i.test(row.query || '') && /"isOwner"/.test(row.query || ''),
        pastTargetLock: true,
      },
    });

    // Finding 9: the target is suspended while the approval runs. Each refusal
    // leaves only the fixture's suspension behind: no flag, execution or grant.
    const raced = async (label, { who, requester, approver, hold, whileWaiting = null, waitTypes, waitedOn }) => {
      const req = await runCli(`${who.label} request`, requestArgs({ user: who.id, operator: requester.email, code: await nextCode(requester) }));
      const requestId = req.result?.requestId || null;
      const code = await nextCode(approver);
      const before = await state();
      const refusedBefore = new Set((await refusedRows()).map((row) => row.id));
      const membershipBefore = await membershipIn(orgA.id, who.id);
      const run = await interleave({
        hold: typeof hold === 'function' ? hold() : hold,
        start: () => runCli(`${who.label} approve`, approveArgs({ request: requestId || 'none', operator: approver.email, code })),
        whileWaiting,
        end: 'commit',
      });
      const r = run.result;
      const after = await state();
      const membershipAfter = await membershipIn(orgA.id, who.id);
      const homeAfter = (await q('select status, "isCompanyAdmin" from "User" where id = $1', [who.id]))[0] || null;
      const expected = JSON.parse(before);
      expected.membershipsA = expected.membershipsA.map((row) => (row.userId === who.id ? { ...row, status: 'suspended' } : row));
      const expectedJson = JSON.stringify(expected);
      const fresh = (await refusedRows()).filter((row) => !refusedBefore.has(row.id));
      const waited = Boolean(run.seen && run.seen.types.some((type) => waitTypes.includes(type)));
      const seen = { name: label, waiter: run.seen?.types || null, heldMs: run.seen ? run.releasedAt - run.seen.at : null, finishedBeforeRelease: Boolean(run.settledBeforeRelease), answer: saidCli(r) };
      interleavings.push(seen);
      console.log(`        observed: ${JSON.stringify(seen)}`);
      check(`${label}: the approval waited on ${waitedOn}, then was refused 409 RECOVERY_TARGET_NOT_ACTIVE_MEMBER`,
        req.ok && membershipBefore?.status === 'active' && waited && !r.ok && r.status === 409 && r.code === 'RECOVERY_TARGET_NOT_ACTIVE_MEMBER',
        `request ${saidCli(req)}; membership before ${JSON.stringify(membershipBefore)}; waiter ${JSON.stringify(run.seen)}${run.settledBeforeRelease ? ' (the approval finished before the lock was released)' : ''}; approval ${saidCli(r)}${r.message ? ` "${r.message}"` : ''}`);
      check(`${label}: nothing granted: the membership is suspended (the fixture), neither owner nor administrator; no request, execution, grant, other membership or person change`,
        after === expectedJson && membershipAfter?.id === membershipBefore?.id && membershipAfter?.status === 'suspended'
          && membershipAfter.isOwner === false && membershipAfter.isAdmin === false && homeAfter?.isCompanyAdmin === false,
        `membership ${JSON.stringify(membershipAfter)}; home ${JSON.stringify(homeAfter)}; ${stateDiff(expectedJson, after) || 'no other difference'}`);
      const matching = fresh.filter((row) => row.meta?.operatorEmail === approver.email && row.meta?.step === 'approve' && row.meta?.code === 'RECOVERY_TARGET_NOT_ACTIVE_MEMBER'
        && (row.orgId || null) === null && (row.userId || null) === null && (row.meta?.requestId || null) === requestId);
      check(`${label}: recorded as one owner_recovery.refused audit row (operator, step, code, request)`, fresh.length === 1 && matching.length === 1,
        `${fresh.length} new refused row(s): ${JSON.stringify(fresh.map((row) => ({ orgId: row.orgId, userId: row.userId, ...row.meta })))}`);
    };
    // (b1) The proof holds T3's (org, e-mail) lock — the one suspension takes —
    // and suspends T3 while the approval waits on it, then commits.
    await raced('Finding 9 (b1): the target is suspended while the approval waits on the target\'s (org, e-mail) lock', {
      who: T3, requester: op1, approver: op2,
      hold: () => [targetLock(orgA.id, T3.storedEmail)],
      whileWaiting: async () => { await lockDb.query(...suspendFixture(T3)); },
      waitTypes: ['advisory'], waitedOn: 'the (org, e-mail) advisory lock',
    });
    // (b2) The proof's own suspension of T4, not yet committed, holds the
    // membership row: the approval passes its standing check (it reads the
    // committed, active row) and its grant waits on the row. When the suspension
    // commits, the grant must find no active membership to write to.
    await raced('Finding 9 (b2): the target\'s suspension commits while the approval\'s grant waits on the membership row', {
      who: T4, requester: op2, approver: op1,
      hold: () => [suspendFixture(T4)],
      waitTypes: ['transactionid', 'tuple'], waitedOn: 'the membership row (an uncommitted suspension)',
    });

    // Finding 7: the emergency switch off. Granting ownership widens access, so
    // a valid request approved by a second operator is refused 503 and audited.
    const rc = await runCli('Rc request', requestArgs({ user: T2.id, operator: op1.email, code: await nextCode(op1) }));
    await refusal('Finding 7: AUTH_MEMBERSHIP_WRITE=false, a second operator approves a valid request',
      async () => {
        const code = await nextCode(op2);
        process.env.AUTH_MEMBERSHIP_WRITE = 'false';
        try {
          return await runCli('Rc approve, switch off', approveArgs({ request: rc.result?.requestId || 'none', operator: op2.email, code }));
        } finally {
          if (envBefore.AUTH_MEMBERSHIP_WRITE === undefined) delete process.env.AUTH_MEMBERSHIP_WRITE;
          else process.env.AUTH_MEMBERSHIP_WRITE = envBefore.AUTH_MEMBERSHIP_WRITE;
        }
      },
      { status: 503, code: 'MEMBERSHIP_WRITES_SUSPENDED', op: op2, step: 'approve', requestId: rc.result?.requestId || null,
        extra: () => ({ ok: rc.ok && process.env.AUTH_MEMBERSHIP_WRITE !== 'false', detail: `request ${saidCli(rc)}; switch now ${process.env.AUTH_MEMBERSHIP_WRITE ?? '(unset)'}` }) });

    // Round 4 (Codex round 3, the recovery-approval finding, adjudicated LOW and
    // fixed by holding the approver's credential epoch): the approving operator
    // is proven (allow-list, active, two-factor, a current code) before the
    // transaction, at its credential epoch. A credential event on that operator
    // that commits while the approval waits on a later lock ends the proof
    // (D-ID-1 Q6, Q13). The proof holds T7's (org, e-mail) lock, sees op2's
    // approval wait on it with the request lock already held (so past
    // verifyOperator), and while it waits completes op2's own self-service
    // password reset through the API (a real credential event: the epoch moves
    // and commits); only then is the lock released. Answer: 403
    // RECOVERY_OPERATOR_NOT_ALLOWED, T7 neither owner nor administrator, no
    // execution row, one refused audit row (op2, step approve, the request).
    // op2 stays active with two-factor on (a reset touches neither), so the
    // refusal can only be the epoch, and the happy path below keeps its approver.
    const T7 = person('opepoch', A.domain);
    {
      const made = await invitations.createByInvitation({ inviter: aPm, email: T7.email, role: 'qs', name: T7.name, password: PASSWORD, db });
      keep(`setup ${T7.label} invite`, made.invited);
      keep(`setup ${T7.label} accept`, made.accepted);
      T7.id = made.userId;
      if (T7.id) {
        targets.push(T7.id);
        // Cleaned up with the other interleaving targets (grants removed, suspended through the API).
        raceTargets.push(T7);
        T7.storedEmail = (await q('select email from "User" where id = $1', [T7.id]))[0]?.email || null;
      }
    }
    {
      const authService = require('../../../src/services/auth.service');
      // The reset link's token in a captured mail (a local helper: lib/invitations reads acceptance links only).
      const resetTokenIn = (text) => {
        const match = /https?:\/\/[^\s"'<>]+\/reset-password\?token=([A-Za-z0-9_\-.~%]+)/.exec(text || '');
        return match ? decodeURIComponent(match[1]) : null;
      };
      const operatorRow = async (op) => (await q('select "credentialEpoch" as epoch, status, "mfaEnabled" as mfa from "User" where id = $1', [op.id]))[0] || null;
      const userOf = async () => (T7.id ? (await q('select status, "orgId", "isCompanyAdmin" from "User" where id = $1', [T7.id]))[0] || null : null);
      // While the command runs, its capture owns the console and stdout; the reset
      // runs with what was there before (the mail capture, the real stdout), so the
      // API's own request log stays out of the command's output. Nothing of the
      // command prints meanwhile: it is blocked on the proof's lock.
      const outsideCli = async (outer, fn) => {
        const inner = { log: console.log, info: console.info, warn: console.warn, error: console.error, stdout: process.stdout.write, stderr: process.stderr.write };
        Object.assign(console, { log: outer.log, info: outer.info, warn: outer.warn, error: outer.error });
        process.stdout.write = outer.stdout;
        process.stderr.write = outer.stderr;
        try {
          return await fn();
        } finally {
          Object.assign(console, { log: inner.log, info: inner.info, warn: inner.warn, error: inner.error });
          process.stdout.write = inner.stdout;
          process.stderr.write = inner.stderr;
        }
      };
      const req = await runCli(`${T7.label} request`, requestArgs({ user: T7.id || 'none', operator: op1.email, code: await nextCode(op1) }));
      const requestId = req.result?.requestId || null;
      const executedFor = async () => (requestId ? (await q(`select count(*)::int as n from "AuthAuditEvent" where "entityType" = 'owner_recovery' and action = 'owner_recovery.executed' and "metadataJson"->>'requestId' = $1`, [requestId]))[0].n : -1);
      const pre = { m: T7.id ? await membershipIn(orgA.id, T7.id) : null, u: await userOf() };
      const preOk = Boolean(T7.id && T7.storedEmail) && pre.m?.status === 'active' && pre.m.kind === 'member' && !pre.m.isOwner && !pre.m.isAdmin
        && pre.u?.status === 'active' && pre.u.orgId === orgA.id && !pre.u.isCompanyAdmin;
      const requestKey = await advisoryKey('owner_recovery', requestId || '');
      const targetKey = await advisoryKey(orgA.id, T7.storedEmail || '');
      // op2's reset link, asked for and delivered now, before the approval starts:
      // the local mail transport writes to the console, which the command's run takes over.
      const mailsBefore = invitations.mailsTo(op2.email).length;
      const forgot = keep('op2 forgot password', await api.raw('POST', '/auth/forgot-password', { json: { email: op2.email } }));
      await authService.flushPasswordResetDeliveries();
      const resetToken = invitations.mailsTo(op2.email).slice(mailsBefore).reverse().map(resetTokenIn).find(Boolean) || null;
      const op2NewPassword = `Op2-Reset-${STAMP}-pass9`;
      let run = null;
      let waiter = null;
      let reset = null;
      let opBefore = null;
      let opDuring = null;
      let post = null;
      const label = 'Round 4: the approving operator (op2) completes a self-service password reset while the approval waits on the target\'s (org, e-mail) lock';
      await refusal(label,
        async () => {
          const code = await nextCode(op2);
          opBefore = await operatorRow(op2);
          const outer = { log: console.log, info: console.info, warn: console.warn, error: console.error, stdout: process.stdout.write, stderr: process.stderr.write };
          run = await interleave({
            hold: [targetLock(orgA.id, T7.storedEmail || '')],
            start: () => runCli(`${T7.label} approve across op2's reset`, approveArgs({ request: requestId || 'none', operator: op2.email, code })),
            whileWaiting: async (seen) => {
              if (!seen) return;
              const rows = await waitingOnLockDb();
              const held = rows.length ? await advisoryHeldBy(rows[0].pid) : [];
              const holds = (key) => held.some((k) => k.k1 === key.k1 && k.k2 === key.k2);
              waiter = { rows, holdsRequestLock: holds(requestKey), holdsTargetLock: holds(targetKey) };
              // The credential event, committed while the approval waits: op2's own reset, through the API.
              const startedAt = Date.now();
              const res = keep('op2 reset password (while the approval waits)', await outsideCli(outer, () => api.raw('POST', '/auth/reset-password', { json: { token: resetToken || 'x'.repeat(43), password: op2NewPassword } })));
              reset = { status: res.status, code: res.body?.error?.code || null, reset: res.body?.data?.reset === true, ms: Date.now() - startedAt };
              opDuring = await operatorRow(op2);
              // Still waiting behind the proof's lock once the reset has committed.
              reset.approvalStillWaiting = (await waitingOnLockDb()).some((row) => row.locktype === 'advisory' && row.k1 === targetKey.k1 && row.k2 === targetKey.k2);
            },
            end: 'rollback',
          });
          post = { m: T7.id ? await membershipIn(orgA.id, T7.id) : null, u: await userOf(), executed: await executedFor(), op2: await operatorRow(op2) };
          return run.result;
        },
        { status: 403, code: 'RECOVERY_OPERATOR_NOT_ALLOWED', op: op2, step: 'approve', requestId,
          extra: () => {
            const where = waiter ? waiter.rows.find((row) => row.locktype === 'advisory' && row.k1 === targetKey.k1 && row.k2 === targetKey.k2 && /pg_advisory_xact_lock/i.test(row.query || '')) || null : null;
            // Seen waiting on T7's key with the request lock held: op2 was proven (verifyOperator, at its epoch) before the wait.
            const waitedThere = Boolean(where) && waiter.holdsRequestLock;
            const resetInside = Boolean(reset) && reset.status === 200 && reset.reset && reset.approvalStillWaiting && Boolean(run) && !run.settledBeforeRelease;
            const epochMoved = Number.isInteger(opBefore?.epoch) && opDuring?.epoch === opBefore.epoch + 1;
            // Still an allowed operator in every other respect: the refusal can only be the epoch.
            const stillOperator = opBefore?.status === 'active' && opBefore.mfa === true && opDuring?.status === 'active' && opDuring.mfa === true;
            const nothingGranted = post?.m?.status === 'active' && post.m.isOwner === false && post.m.isAdmin === false && post.u?.isCompanyAdmin === false && post.executed === 0;
            const seen = {
              name: label,
              waiter: waiter ? waiter.rows.map((row) => ({ locktype: row.locktype, query: row.query })) : null,
              holdsRequestLock: waiter?.holdsRequestLock ?? null,
              holdsTargetLock: waiter?.holdsTargetLock ?? null,
              reset,
              op2Epoch: { before: opBefore?.epoch ?? null, duringWait: opDuring?.epoch ?? null, after: post?.op2?.epoch ?? null },
              heldMs: run?.seen ? run.releasedAt - run.seen.at : null,
              finishedBeforeRelease: Boolean(run?.settledBeforeRelease),
              answer: run ? saidCli(run.result) : null,
            };
            interleavings.push(seen);
            console.log(`        observed: ${JSON.stringify(seen)}`);
            return {
              ok: req.ok && preOk && forgot.status === 200 && Boolean(resetToken) && waitedThere && resetInside && epochMoved && stillOperator && nothingGranted,
              detail: `request ${saidCli(req)}; before ${JSON.stringify(pre)}; forgot ${said(forgot)}, link ${Boolean(resetToken)}; waiting ${JSON.stringify(waiter)} (expected an advisory wait on T7's (org, e-mail) key, the request lock held); reset ${JSON.stringify(reset)}; op2 ${JSON.stringify({ before: opBefore, during: opDuring })}${run?.settledBeforeRelease ? '; the approval finished before the lock was released' : ''}; after ${JSON.stringify(post)}`,
            };
          } });
    }

    // ── the happy path ──────────────────────────────────────────────────────
    console.log('\n── request, then a second operator approves ──');
    const tUserCols = async () => JSON.stringify(await q(`select email, name, phone, "orgId", role, status, "passwordHash", "mfaEnabled", "mfaSecretEnc", "mfaPendingSecretEnc", "mfaBackupCodesJson", "credentialEpoch", "ssoSubject" from "User" where id = $1`, [T.id]));
    const tSessions = async () => JSON.stringify(await q(`select id, "revokedAt" from "RefreshSession" where "userId" = $1 order by id`, [T.id]));
    const othersInA = async () => JSON.stringify(await q(`select "userId", role, kind, status, "isAdmin", "isOwner" from "OrganizationMembership" where "orgId" = $1 and "userId" <> $2 order by "userId"`, [orgA.id, T.id]));
    const tUserBefore = await tUserCols();
    const tSessionsBefore = await tSessions();
    const othersBefore = await othersInA();
    const mTBefore = await membershipIn(orgA.id, T.id);
    const print = await fingerprint.take(db);

    const r2Code = await nextCode(op1);
    const askedFrom = Date.now();
    const r2 = await runCli('R2 request', requestArgs({ operator: op1.email, code: r2Code }));
    const askedTo = Date.now();
    const requestId = r2.result?.requestId || null;
    const requestedRow = requestId ? (await q(`select "orgId", "userId", "actorId", "metadataJson" as meta from "AuthAuditEvent" where id = $1 and action = 'owner_recovery.requested'`, [requestId]))[0] : null;
    // ("createdAt" is a timestamp without time zone, so the expiry is judged against the wall clock around the call.)
    const expiresAt = requestedRow ? new Date(requestedRow.meta?.expiresAt).getTime() : NaN;
    const ttl = expiresAt >= askedFrom + 24 * 3600_000 && expiresAt <= askedTo + 24 * 3600_000 ? 24 * 3600_000 : expiresAt - askedFrom;
    check('C16 happy path: op1 records a request, audited with the workspace, the person, the operator, the ticket, the reason and a 24-hour expiry',
      r2.ok && requestedRow?.orgId === orgA.id && requestedRow.userId === T.id && requestedRow.actorId === op1.id && requestedRow.meta?.operatorEmail === op1.email
        && requestedRow.meta?.ticket === TICKET && requestedRow.meta?.reason === REASON && requestedRow.meta?.singleOperator === false && ttl === 24 * 3600_000,
      `${saidCli(r2)}; expiry after ${ttl} ms; row ${JSON.stringify(requestedRow)}`);
    const mTAfterRequest = await membershipIn(orgA.id, T.id);
    const approved = await runCli('R2 approve', approveArgs({ request: requestId || 'none', operator: op2.email, code: await nextCode(op2) }));
    tGranted = true;
    check('C16 happy path: a second operator (op2) approves and the command reports the person owner and administrator',
      approved.ok && approved.result?.requestId === requestId && approved.result?.userId === T.id && approved.result?.orgId === orgA.id && approved.result?.owner === true && approved.result?.admin === true
        && JSON.stringify(mTAfterRequest) === JSON.stringify(mTBefore),
      `${saidCli(approved)}; membership after the request alone ${JSON.stringify(mTAfterRequest)}`);
    const mTAfter = await membershipIn(orgA.id, T.id);
    const tHome = (await q('select "isCompanyAdmin", "orgId" from "User" where id = $1', [T.id]))[0];
    check('C16 happy path: T is now owner and administrator of A, still an active member with the same role',
      mTAfter?.isOwner === true && mTAfter.isAdmin === true && mTAfter.status === 'active' && mTAfter.kind === 'member' && mTAfter.role === mTBefore.role && mTAfter.id === mTBefore.id && tHome?.isCompanyAdmin === true,
      `${JSON.stringify(mTAfter)}; home ${JSON.stringify(tHome)}`);
    const tUserAfter = await tUserCols();
    const tSessionsAfter = await tSessions();
    check('C16 happy path: nothing else about T changed: e-mail, name, password, two-factor, credential epoch, sign-on link and sessions',
      tUserAfter === tUserBefore && tSessionsAfter === tSessionsBefore, `user equal ${tUserAfter === tUserBefore}; sessions equal ${tSessionsAfter === tSessionsBefore}`);
    check('C16 happy path: no other membership of A changed (no one else gains or loses ownership or administration)', (await othersInA()) === othersBefore);
    const executedRows = requestId ? await q(`select "orgId", "userId", "actorId", "metadataJson" as meta from "AuthAuditEvent" where "entityType" = 'owner_recovery' and action = 'owner_recovery.executed' and "metadataJson"->>'requestId' = $1`, [requestId]) : [];
    const ex = executedRows[0];
    check('C16 audit: one owner_recovery.executed row with the approving operator, the requesting operator, the ticket and the reason',
      executedRows.length === 1 && ex.orgId === orgA.id && ex.userId === T.id && ex.actorId === op2.id && ex.meta?.approvedBy === op2.email && ex.meta?.requestedBy === op1.email && ex.meta?.ticket === TICKET && ex.meta?.reason === REASON,
      JSON.stringify(executedRows));
    const grants = requestId ? await q(`select action, "actorId", "metadataJson" as meta from "AuthAuditEvent" where "entityType" = 'membership' and "orgId" = $1 and "userId" = $2 and action in ('membership.owner_granted', 'membership.admin_granted') and "metadataJson"->>'requestId' = $3 order by action`, [orgA.id, T.id, requestId]) : [];
    check('C16 audit: the membership history records the owner and admin grants, by op2, via owner_recovery, with the request and ticket',
      grants.map((g) => g.action).join(',') === 'membership.admin_granted,membership.owner_granted' && grants.every((g) => g.actorId === op2.id && g.meta?.via === 'owner_recovery' && g.meta?.ticket === TICKET),
      JSON.stringify(grants));
    const executedBefore = executedRows.length;
    const again = await runCli('R2 approve again', approveArgs({ request: requestId || 'none', operator: op2.email, code: await nextCode(op2) }));
    const executedAfter = requestId ? (await q(`select count(*)::int as n from "AuthAuditEvent" where "entityType" = 'owner_recovery' and action = 'owner_recovery.executed' and "metadataJson"->>'requestId' = $1`, [requestId]))[0].n : -1;
    check('C16 a second approval of the same request is refused 409 RECOVERY_REQUEST_USED and executes nothing',
      !again.ok && again.status === 409 && again.code === 'RECOVERY_REQUEST_USED' && executedAfter === executedBefore && executedAfter === 1 && JSON.stringify(await membershipIn(orgA.id, T.id)) === JSON.stringify(mTAfter),
      `${saidCli(again)}; executed rows ${executedBefore} -> ${executedAfter}`);

    // ── what the command printed ────────────────────────────────────────────
    console.log('\n── output and other companies ──');
    const secrets = await q(`select "passwordHash", "mfaSecretEnc" from "User" where id = any($1::text[])`, [[op1.id, op2.id, op3.id, op4.id, T.id, S.id, G.id, O.id, ...raceTargets.map((p) => p.id)].filter(Boolean)]);
    const literal = [...secrets.flatMap((s) => [s.passwordHash, s.mfaSecretEnc]), op1.secret, op2.secret, op4.secret, PASSWORD].filter(Boolean);
    const printed = cliOutput.map((c) => `${c.stdout}\n${c.stderr}`).join('\n');
    const leaks = [];
    for (const pattern of [/passwordHash/i, /\$2[aby]\$\d\d\$/, /eyJ[A-Za-z0-9_-]{10,}/, /access_?token|refresh_?token|identity_?token/i, /mfaSecret|otpauth:/i]) if (pattern.test(printed)) leaks.push(String(pattern));
    for (const value of literal) if (printed.includes(value)) leaks.push(`a stored secret or password (${value.slice(0, 4)}…)`);
    for (const code of usedCodes) if (new RegExp(`(?<![0-9A-Za-z])${code}(?![0-9A-Za-z])`).test(printed)) leaks.push(`authenticator code ${code}`);
    check(`C16 the command's stdout and stderr (${cliOutput.length} runs) carry no password hash, token, two-factor secret, password or authenticator code`,
      leaks.length === 0 && cliOutput.length > 0 && /carried out/.test(printed), leaks.join(', ') || `${cliOutput.length} runs`);
    const changes = fingerprint.compare(print, await fingerprint.take(db)).filter((c) => !c.noise && c.org !== A_CODE);
    check('C16 no other company\'s data changed during the recovery', changes.length === 0, changes.map((c) => `${c.table}:${c.org}`).join(', ') || 'none');
    const fives = answers.filter((a) => a.status >= 500);
    check('no API answer was a 5xx', fives.length === 0, fives.map((a) => `${a.label} ${a.status}`).join(', '));
  } finally {
    restoreEnv();
    // T's grant goes (a throwaway person), and T is suspended through the product, so
    // no request of this run still pending (R3, R4) can make anyone owner later.
    try {
      if (T.id) {
        if (tGranted) {
          await db.query(`update "OrganizationMembership" set "isOwner" = false, "isAdmin" = false where "orgId" = $1 and "userId" = $2`, [orgA.id, T.id]);
          await db.query(`update "User" set "isCompanyAdmin" = false where id = $1 and "orgId" = $2`, [T.id, orgA.id]);
        }
        const off = await aPm.send('PATCH', `/users/${T.id}/deactivate`, {});
        console.log(`cleanup: T grant removed ${tGranted}; T suspended ${said(off)}`);
      }
    } catch (error) {
      console.log(`cleanup failed: ${error.message}`);
    }
    // The interleaving targets: any grant a (mutated) product made removed, the
    // fixture suspensions of T3 and T4 undone, then all three suspended through
    // the product, so none of this run's pending requests can make them owner.
    try {
      if (lockOpen) {
        lockOpen = false;
        await lockDb.query('rollback').catch(() => null);
      }
      const ids = raceTargets.map((p) => p.id).filter(Boolean);
      if (ids.length) {
        const ungranted = await db.query(`update "OrganizationMembership" set "isOwner" = false, "isAdmin" = false where "orgId" = $1 and "userId" = any($2::text[]) and ("isOwner" or "isAdmin")`, [orgA.id, ids]);
        const homeUngranted = await db.query(`update "User" set "isCompanyAdmin" = false where id = any($1::text[]) and "orgId" = $2 and "isCompanyAdmin"`, [ids, orgA.id]);
        const undone = await db.query(`update "OrganizationMembership" set status = 'active' where "orgId" = $1 and "userId" = any($2::text[]) and status = 'suspended'`, [orgA.id, [...fixtureSuspended]]);
        const offs = [];
        for (const p of raceTargets.filter((x) => x.id)) offs.push(`${p.label} ${said(await aPm.send('PATCH', `/users/${p.id}/deactivate`, {}))}`);
        console.log(`cleanup: interleaving targets: grants removed ${ungranted.rowCount + homeUngranted.rowCount}; fixture suspensions undone ${undone.rowCount}; suspended through the API: ${offs.join(', ')}`);
      }
    } catch (error) {
      console.log(`cleanup (interleaving targets) failed: ${error.message}`);
    }
    await lockDb.end().catch(() => {});
    await db.end().catch(() => {});
  }
};

const finish = async (scriptError) => {
  const failed = results.filter((r) => !r.ok).length;
  const missing = Math.max(0, EXPECTED_CHECKS - results.length);
  const passed = results.length - failed;
  const ok = !scriptError && failed === 0 && results.length === EXPECTED_CHECKS;
  console.log(`\n${NAME} proof: ${passed} passed, ${failed + missing} failed of ${EXPECTED_CHECKS}${missing ? ` (${missing} not run)` : ''}${results.length > EXPECTED_CHECKS ? ` (ran ${results.length}, expected ${EXPECTED_CHECKS})` : ''}`);
  try {
    fs.mkdirSync(RESULT_DIR, { recursive: true });
    fs.writeFileSync(path.join(RESULT_DIR, `${NAME}.json`), JSON.stringify({
      proof: NAME, check: 'C16', stamp: STAMP, at: new Date().toISOString(), a: A_CODE, b: B_CODE,
      total: EXPECTED_CHECKS, passed, failed: failed + missing, ok, scriptError: scriptError ? String(scriptError.stack || scriptError) : null, results, interleavings,
    }, null, 2));
  } catch (error) {
    console.error(`could not write the result: ${error.message}`);
  }
  await require('../../../src/config/db').prisma.$disconnect().catch(() => {});
  process.exit(ok ? 0 : 2);
};

main().then(() => finish(null), (error) => {
  console.error(`SCRIPT ERROR: ${error.stack || error.message}`);
  return finish(error);
});
