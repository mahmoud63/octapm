'use strict';

/**
 * D-ID-1 P1: adding a person is only ever an invitation (CERT-3 plan §2.8,
 * checks C1, C2, C3, C5, C6, C7, C8).
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/d-id-1-user-add-proof.js [A=052] [B=025] [C=026]
 *
 * A invites; B and C are other companies. Throwaway people, a fresh stamp each
 * run, made through the product (invitation, then acceptance) unless marked
 * "fixture":
 *   N   a new e-mail                       S1  an identity of B only
 *   S2  an identity of B and C             XB  closed, home B (B deactivated its only membership)
 *   LF  a former member of A (fixture: its A membership written `left`)
 *   CL  closed+LEFT, home A (fixture: User inactive, A membership `left`)
 *   SE  a member of B and C, suspended by C
 *   CS  closed+SUSPENDED, home A (joined A as a new identity, deactivated by A)
 *   LG  a legacy inactive home User of A with no membership row (fixture)
 *   NPM a non-admin PM of A (an accepted invitation never confers administration)
 *   SU, SV  identities of B that joined A (suspension with an outstanding link)
 *   P1, P2  self-registered personal workspaces (P2: its owner's seat written `left`, fixture)
 *
 * C1 same answer for every e-mail class on both doors and three payloads, the
 *    identical 409s, the personal workspace's 409 and the delivery failure's 502;
 * C2 nothing exists before acceptance and nothing elsewhere changes;
 * C3 password fields refused before any lookup (Prisma query hook), and the
 *    emergency switch refuses invitation and acceptance;
 * C5 acceptance; C6 invitation management; C7 races (forced interleaves: the
 *    proof holds the lock the product takes); C8 one gate.
 *
 * Guarded fixture rows (SQL, throwaway people only) are removed at the end; the
 * project party is deleted through the product; pending invitations of the run
 * are revoked. Exit 0 when every check holds, 2 otherwise.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const guard = require('../lib/cert-env');

// ── the query hook: installed before anything under src/ is loaded ───────────
// config/db.js uses global.__prisma when it is set, so every statement the app
// sends passes here; C3 counts those that carry a target e-mail.
const { PrismaClient } = require('@prisma/client');
const hooked = new PrismaClient({ datasourceUrl: guard.certDatabaseUrl(), log: [{ emit: 'event', level: 'query' }] });
let watch = null;
hooked.$on('query', (e) => {
  if (!watch) return;
  const text = `${e.params || ''} ${e.query || ''}`.toLowerCase();
  for (const target of watch.targets) {
    if (text.includes(target)) {
      watch.hits += 1;
      if (watch.samples.length < 3) watch.samples.push(String(e.query || '').slice(0, 140));
    }
  }
});
global.__prisma = hooked;
process.env.DATABASE_URL = guard.certDatabaseUrl();
for (const name of ['JOB_WORKER_ENABLED', 'SCHEDULERS_ENABLED', 'EXCEPTIONS_ENGINE_ENABLED']) process.env[name] = 'false';
// The proof prints its own PASS/FAIL lines; the app's per-request log is off for this process.
process.env.REQUEST_LOG_FORMAT = 'off';

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const api = require('../lib/api');
const invitations = require('../lib/invitations');
const { buildPopulation } = require('../lib/spec');
const fingerprint = require('../isolation/fingerprint');

invitations.captureMail({ quiet: true });

const NAME = 'd-id-1-user-add';
const A_CODE = process.argv[2] || '052';
const B_CODE = process.argv[3] || '025';
const C_CODE = process.argv[4] || '026';
const STATE_DIR = process.env.CERT_STATE_DIR || 'C:/Temp/octapm-cert/state';
const RESULT_DIR = 'C:/Temp/octapm-cert/results/cert3';
const STAMP = crypto.randomBytes(3).toString('hex');
const PASSWORD = process.env.CERT_PASSWORD;
const NEW_PASSWORD = `Reopened-${STAMP}-9q`;
const RUN_START = new Date();
const ENV_AT_START = { EMAIL_PROVIDER: process.env.EMAIL_PROVIDER, EMAIL_WEBHOOK_URL: process.env.EMAIL_WEBHOOK_URL, AUTH_MEMBERSHIP_WRITE: process.env.AUTH_MEMBERSHIP_WRITE };

// ── the fixed list of checks ──────────────────────────────────────────────────
const PLAN = [
  ['C0.setup', 'setup: every throwaway class exists in the standing it is meant to have'],
  ['C1.ws', 'C1 workspace-only offer: 7 classes x 2 doors answer 201, identical keys and values (bar id, email, createdAt, expiresAt), invited: true'],
  ['C1.project', 'C1 project offer: 7 classes x 2 doors answer 201, identical keys and values, invited: true'],
  ['C1.party', 'C1 party offer: 7 classes x 2 doors answer 201, identical keys and values, invited: true'],
  ['C1.leak', 'C1 no answer carries identity data (name, phone, user id, B/C organisation id or name)'],
  ['C1.409', 'C1 suspended here, closed+SUSPENDED home A, legacy inactive home (every payload, both doors) and active-here workspace-only: the identical 409 ALREADY_MEMBER'],
  ['C1.409.nowrite', 'C1 the refused invitations wrote no invitation row'],
  ['C1.active', 'C1 an active member here is answered 201 for a project and a party offer on both doors'],
  ['C1.personal', 'C1 personal workspace: a new and an existing e-mail, both doors: the identical 409 PERSONAL_WORKSPACE_CONVERT_REQUIRED, nothing written'],
  ['C1.502', 'C1 delivery failure: a new and an existing e-mail get the identical 502 INVITATION_EMAIL_FAILED'],
  ['C1.502.state', 'C1 after a delivery failure the invitation stays pending and invitation_delivery_failed is audited'],
  ['C3.matrix', 'C3 password / confirmPassword / both x 5 values x 2 doors x new and existing e-mail: the identical 400 USER_PASSWORD_NOT_ACCEPTED'],
  ['C3.count', 'C3 the refused requests changed no invitation count'],
  ['C3.statements', 'C3 zero query statements carried a target e-mail while the password matrix ran'],
  ['C3.flagoff.invite', 'C3 switch off: invitation on both doors answers 503 MEMBERSHIP_WRITES_SUSPENDED and writes no invitation'],
  ['C3.flagoff.accept', 'C3 switch off: accepting a new party guest\'s link and an existing foreign identity\'s link (own bearer) answers 503 MEMBERSHIP_WRITES_SUSPENDED'],
  ['C3.flagoff.nowrite', 'C3 switch off: both links stay pending; no User, membership, assignment or party row is written'],
  ['C2.nouser', 'C2 no User row exists for any new e-mail before acceptance'],
  ['C2.rows', 'C2 no membership, project assignment, party or company row in A appeared or changed for any C1 class'],
  ['C2.elsewhere', 'C2 the identities\' own rows and their memberships elsewhere are unchanged'],
  ['C2.fingerprint', 'C2 no other company\'s data changed while A invited'],
  ['C2.surfaces', 'C2 no admin-visible surface carries existingUser (the answers, GET /users/invitations, the project\'s history)'],
  ['C5.new', 'C5 a new identity accepts with its own name and password and then signs in'],
  ['C5.reuse', 'C5 the second use of an accepted link is refused 400 INVITATION_TOKEN_INVALID'],
  ['C5.revoked', 'C5 a link revoked through DELETE /users/invitations/:id is refused 400 INVITATION_TOKEN_INVALID'],
  ['C5.superseded', 'C5 a superseded link (re-invited) is refused 400 INVITATION_TOKEN_INVALID'],
  ['C5.alone', 'C5 an existing identity\'s link alone is refused 401 INVITATION_SIGN_IN_REQUIRED, nothing written'],
  ['C5.own', 'C5 the existing identity\'s own bearer is accepted: exactly the offered role, kind member, isAdmin false, isOwner false'],
  ['C5.guest', 'C5 a party guest becomes kind guest, role external_party, and only after acceptance'],
  ['C5.cl', 'C5 closed+LEFT home A: the link reopens it with a new password, answers signInRequired with no session, and the new password signs in'],
  ['C5.susp', 'C5 suspension with an outstanding project link: the link is revoked (audited member_suspended), acceptance with the own bearer is refused 400, the membership stays SUSPENDED, status and hash unchanged'],
  ['C5.direct', 'C5 a pending link written straight against a suspended membership is refused 400 before anything is written (refusal audited); the row stays suspended'],
  ['C5.interleave', 'C5 a membership suspended while its acceptance waits on the lock is not reactivated (400, stays suspended, link not used)'],
  ['C5.cs', 'C5 closed+SUSPENDED home A: a link (fixture) is refused 400 (refusal audited) and the identity stays inactive'],
  ['C6.list', 'C6 GET /users/invitations lists exactly A\'s pending, unexpired rows, with no existence field'],
  ['C6.expired', 'C6 an expired pending row (fixture) is not listed'],
  ['C6.foreign', 'C6 B\'s PM lists only B\'s rows; B\'s PM revoking A\'s invitation gets 404 INVITATION_NOT_FOUND'],
  ['C6.gate', 'C6 a role without the invite gate (qs) gets 403 on list, revoke and resend'],
  ['C6.revoke', 'C6 a revoke answers { revoked: true }, is audited invitation_revoked / revoked_by_admin, and the link is then refused'],
  ['C6.revoke-expired', 'C6 an expired pending row is revoked once (200); a second revoke is 409 INVITATION_NOT_PENDING'],
  ['C6.race', 'C6 revoke against accept, 5 times: exactly one outcome each time, and the row and the audit agree'],
  ['C6.resend', 'C6 resend carries the stored role, project, party and note; the old link is refused'],
  ['C7.seat', 'C7 seat: two links into an empty personal workspace accepted at once (forced): one wins, the loser gets 409 PERSONAL_WORKSPACE_CONVERT_REQUIRED and leaves no User'],
  ['C7.xorg', 'C7 across organisations: A and B links for one new e-mail accepted at once (forced): one User; the loser gets 401 INVITATION_SIGN_IN_REQUIRED and its link stays pending'],
  ['C7.invite-accept', 'C7 invite against accept, 5 times: 409 ALREADY_MEMBER after an acceptance, or a lost acceptance and one pending link; never an active member with a pending workspace link'],
  ['C8.routes', 'C8 POST / and POST /invitations register the same handler functions in the same order'],
  ['C8.policy', 'C8 a non-admin PM with user_management create but not user.invite gets 403 on both doors (and 201 without the injection)'],
  ['G.5xx', 'no answer was a 5xx other than the expected 502 INVITATION_EMAIL_FAILED and 503 MEMBERSHIP_WRITES_SUSPENDED'],
];
const EXPECTED_CHECKS = PLAN.length;
const recorded = new Map();
const check = (id, ok, detail = '') => {
  const entry = PLAN.find(([key]) => key === id);
  if (!entry) throw new Error(`unknown check ${id}`);
  if (recorded.has(id)) throw new Error(`check ${id} recorded twice`);
  recorded.set(id, { id, name: entry[1], ok: Boolean(ok), detail: ok ? undefined : String(detail).slice(0, 4000) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${entry[1]}${!ok && detail ? `\n        ${String(detail).slice(0, 1500)}` : ''}`);
};
const said = (res) => (res ? `${res.status} ${res.body?.error?.code || ''}`.trim() : 'no answer');
const answers = [];
const keep = (label, res, allowed5xx = null) => {
  if (res && typeof res.status === 'number') answers.push({ label, status: res.status, code: res.body?.error?.code || null, allowed5xx });
  return res;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
// Prisma writes timestamps as UTC wall time into columns without a zone, and the
// certification database's sessions run in America/Chicago: every SQL time here is UTC.
const NOW = "(now() at time zone 'utc')";
const utc = (n) => `($${n}::timestamptz at time zone 'utc')`;
// What the cleanup needs, filled in as the run makes it (so a failed setup is cleaned up too).
const ctx = { db: null, lockDb: null, cleanup: null };
const VARY = ['id', 'email', 'createdAt', 'expiresAt'];
const dataKeys = (res) => Object.keys(res?.body?.data || {}).sort().join(',');
const dataValues = (res) => JSON.stringify(Object.entries(res?.body?.data || {}).filter(([k]) => !VARY.includes(k)).sort(([a], [b]) => a.localeCompare(b)));
const errorShape = (res) => JSON.stringify({
  status: res?.status,
  code: res?.body?.error?.code,
  message: res?.body?.error?.message,
  keys: Object.keys(res?.body || {}).sort(),
  errorKeys: Object.keys(res?.body?.error || {}).sort(),
  detailKeys: res?.body?.error?.details && typeof res.body.error.details === 'object' ? Object.keys(res.body.error.details).sort() : null,
});

const main = async () => {
  if (!PASSWORD) throw new Error('CERT_PASSWORD is not set');
  const { companies } = buildPopulation();
  const [A, B, C] = [A_CODE, B_CODE, C_CODE].map((code) => companies.find((c) => c.code === code));
  const db = await guard.connectCert();
  const lockDb = await guard.connectCert();
  ctx.db = db;
  ctx.lockDb = lockDb;
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const one = async (sql, params = []) => (await q(sql, params))[0] || null;
  const orgOf = async (code) => one('select id, name from "Organisation" where slug like $1', [`cert-${code}-%`]);
  const [orgA, orgB, orgC] = [await orgOf(A_CODE), await orgOf(B_CODE), await orgOf(C_CODE)];
  const aPm = api.as(`pm@${A.domain}`);
  const bPm = api.as(`pm@${B.domain}`);
  const cPm = api.as(`pm@${C.domain}`);
  const aQs = api.as(`qs@${A.domain}`);
  const aPmId = (await one('select id from "User" where email = $1', [`pm@${A.domain}`]))?.id;
  const projectA = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'inventory', `${A.code}.json`), 'utf8')).projects[`${A.code}-01`].id;
  console.log(`${NAME}: A ${A_CODE} invites, B ${B_CODE}, C ${C_CODE}; stamp ${STAMP}; ${EXPECTED_CHECKS} checks\n`);

  // What this run made, for the cleanup.
  const runEmails = new Set();
  const fixtureInvitationIds = [];
  const fixtureUserIds = [];
  const personalSubscriptions = [];
  let partyId = null;
  const envBefore = { EMAIL_PROVIDER: process.env.EMAIL_PROVIDER, EMAIL_WEBHOOK_URL: process.env.EMAIL_WEBHOOK_URL, AUTH_MEMBERSHIP_WRITE: process.env.AUTH_MEMBERSHIP_WRITE };
  const restoreEnv = (name) => {
    if (envBefore[name] === undefined) delete process.env[name];
    else process.env[name] = envBefore[name];
  };
  const permissions = require('../../../src/config/permissions');
  const userManagement = permissions.permissionPolicy.modules.user_management;
  const inviteRolesBefore = [...(userManagement.transitions['user.invite'] || [])];
  let lockOpen = false;
  const siteEmail = `site@${A.domain}`;
  ctx.restorePolicy = () => { userManagement.transitions['user.invite'] = [...inviteRolesBefore]; };
  ctx.cleanup = async () => {
    const notes = [];
    if (lockOpen) {
      lockOpen = false;
      await lockDb.query('rollback').catch(() => null);
    }
    try {
      const revoked = await db.query(
        `update "InvitationToken" set status = 'revoked', "revokedAt" = ${NOW}, "updatedAt" = ${NOW}
          where status = 'pending' and "createdAt" >= ${utc(1)} and (email = any($2::text[]) or email = $3) and not (id = any($4::text[]))`,
        [RUN_START.toISOString(), [...runEmails], siteEmail, fixtureInvitationIds],
      );
      notes.push(`pending invitations of the run revoked: ${revoked.rowCount}`);
    } catch (error) { notes.push(`revoke failed: ${error.message}`); }
    try {
      const removed = await db.query('delete from "InvitationToken" where id = any($1::text[])', [fixtureInvitationIds]);
      notes.push(`fixture invitations removed: ${removed.rowCount}`);
    } catch (error) { notes.push(`fixture invitations: ${error.message}`); }
    try {
      const removed = await db.query('delete from "User" where id = any($1::text[])', [fixtureUserIds]);
      notes.push(`fixture users removed: ${removed.rowCount}`);
    } catch (error) { notes.push(`fixture users: ${error.message}`); }
    for (const p of personalSubscriptions) {
      try {
        await db.query('update "Subscription" set status = $2, "trialEndsAt" = $3 where "orgId" = $1', [p.orgId, p.subscriptionBefore?.status ?? 'incomplete', p.subscriptionBefore?.trialEndsAt ?? null]);
        notes.push('personal trial fixture restored');
      } catch (error) { notes.push(`personal trial fixture: ${error.message}`); }
    }
    if (partyId) {
      try {
        const res = await aPm.send('DELETE', `/projects/${projectA}/parties/${partyId}`);
        notes.push(`party delete ${said(res)}`);
      } catch (error) { notes.push(`party delete: ${error.message}`); }
    }
    return notes;
  };

  const mail = (label, domain) => {
    const email = `did1.${label}.${STAMP}@${domain}`.toLowerCase();
    runEmails.add(email);
    return email;
  };
  const accept = (token, { bearer = null, password = null, name = 'Invitee' } = {}) =>
    api.raw('POST', '/auth/invitations/accept', { json: { token, name, ...(password ? { password } : {}) }, token: bearer });
  const invite = async (who, door, body, { label = null, allowed5xx = null, token = true } = {}) => {
    const before = invitations.mailsTo(body.email).length;
    const res = keep(label || `invite ${door} ${body.email}`, await who.send('POST', door, body), allowed5xx);
    const id = res.status === 201 ? res.body?.data?.id || null : null;
    const link = id && token ? await invitations.invitationTokenFor({ email: body.email, invitationId: id, after: before, db }) : null;
    return { res, id, token: link };
  };
  const fixtureInvitation = async ({ orgId = orgA.id, email, role = 'qs', expiresAt = new Date(Date.now() + 86_400_000), invitedById = aPmId }) => {
    const token = crypto.randomBytes(32).toString('base64url');
    const id = crypto.randomUUID();
    await db.query(
      `insert into "InvitationToken" (id, "orgId", email, role, "tokenHash", status, "invitedById", "expiresAt", "createdAt", "updatedAt")
       values ($1, $2, $3, $4, $5, 'pending', $6, ${utc(7)}, ${NOW}, ${NOW})`,
      [id, orgId, email, role, sha256(token), invitedById, expiresAt.toISOString()],
    );
    fixtureInvitationIds.push(id);
    return { id, token };
  };
  const membershipIn = async (orgId, userId) => one(`select role, status, kind, "isAdmin", "isOwner" from "OrganizationMembership" where "orgId" = $1 and "userId" = $2`, [orgId, userId]);
  const invitationRow = async (id) => one('select id, status, "acceptedAt", "revokedAt", role, "projectId", "companyId", "projectPartyId", note, email from "InvitationToken" where id = $1', [id]);
  const userRow = async (email) => one('select id, "orgId", status, "passwordHash", "credentialEpoch" from "User" where email = $1', [email]);
  const waiters = async () => (await q('select count(distinct pid)::int as n from pg_locks where not granted'))[0].n;
  const waitForWaiters = async (n, timeoutMs = 20_000) => {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const now = await waiters();
      if (now >= n) return now;
      if (Date.now() > until) return now;
      await sleep(40);
    }
  };
  const beginLock = async (statements) => {
    await lockDb.query('begin');
    lockOpen = true;
    for (const [sql, params] of statements) await lockDb.query(sql, params);
  };
  const endLock = async () => {
    if (!lockOpen) return;
    lockOpen = false;
    await lockDb.query('commit');
  };
  const advisory = (orgId, email) => ['select pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))', [orgId, email]];

  const section = async (title, fn) => {
    console.log(`\n── ${title} ──`);
    try {
      await fn();
    } catch (error) {
      console.log(`SECTION ERROR (${title}): ${error.stack || error.message}`);
      if (lockOpen) {
        lockOpen = false;
        await lockDb.query('rollback').catch(() => null);
      }
    }
  };

  // ════════════════════════════════════════════════════════════════════════════
  // setup
  // ════════════════════════════════════════════════════════════════════════════
  console.log('── setup ──');
  const person = (label, domain) => ({ label, email: mail(label, domain), name: `DID1 ${label} ${STAMP}`, phone: `+1-555-${crypto.randomInt(1000, 9999)}` });
  const N = { label: 'N', email: mail('new', A.domain), name: `DID1 new ${STAMP}` };
  const S1 = person('s1', B.domain);
  const S2 = person('s2', B.domain);
  const XB = person('xb', B.domain);
  const LF = person('lf', B.domain);
  const CL = person('cl', A.domain);
  const SE = person('se', B.domain);
  const CS = person('cs', A.domain);
  const LG = person('lg', A.domain);
  const NPM = person('npm', A.domain);
  const SU = person('su', B.domain);
  const SV = person('sv', B.domain);
  const setupNotes = [];
  const make = async (p, inviter, role = 'qs') => {
    const made = await invitations.createByInvitation({ inviter, email: p.email, role, name: p.name, phone: p.phone, password: PASSWORD, db });
    keep(`setup ${p.label} invite`, made.invited);
    keep(`setup ${p.label} accept`, made.accepted);
    p.id = made.userId;
    if (!p.id) setupNotes.push(`${p.label}: ${said(made.invited)} -> ${said(made.accepted)}`);
    return made;
  };
  const join = async (p, inviter, role = 'qs') => {
    const joined = await invitations.joinByInvitation({ inviter, email: p.email, role, name: p.name, db });
    keep(`setup ${p.label} join invite`, joined.invited);
    keep(`setup ${p.label} join accept`, joined.accepted);
    if (joined.accepted?.status !== 200) setupNotes.push(`${p.label} join: ${said(joined.invited)} -> ${said(joined.accepted)}`);
    return joined;
  };
  for (const p of [S1, S2, XB, LF, SE, SU, SV]) await make(p, bPm);
  for (const p of [CL, CS]) await make(p, aPm);
  await make(NPM, aPm, 'pm');
  await join(S2, cPm, 'planning_eng');
  await join(SE, cPm, 'planning_eng');
  await join(LF, aPm, 'qs');
  await join(SU, aPm, 'qs');
  await join(SV, aPm, 'qs');
  const closeXB = keep('setup XB closed by B', await bPm.send('PATCH', `/users/${XB.id}/deactivate`, {}));
  const suspendSE = keep('setup SE suspended by C', await cPm.send('PATCH', `/users/${SE.id}/deactivate`, {}));
  const closeCS = keep('setup CS deactivated by A', await aPm.send('PATCH', `/users/${CS.id}/deactivate`, {}));
  // Fixtures the product cannot produce: leaving has no route of its own.
  await db.query(`update "OrganizationMembership" set status = 'left', "leftAt" = ${NOW} where "orgId" = $1 and "userId" = $2`, [orgA.id, LF.id]);
  await db.query(`update "OrganizationMembership" set status = 'left', "leftAt" = ${NOW} where "orgId" = $1 and "userId" = $2`, [orgA.id, CL.id]);
  await db.query(`update "User" set status = 'inactive' where id = $1`, [CL.id]);
  // LG: a legacy home User of A, closed, with no membership row anywhere.
  LG.id = crypto.randomUUID();
  await db.query(
    `insert into "User" (id, "orgId", name, email, phone, "passwordHash", role, status, "createdAt", "updatedAt")
     values ($1, $2, $3, $4, $5, $6, 'qs', 'inactive', ${NOW}, ${NOW})`,
    [LG.id, orgA.id, LG.name, LG.email, LG.phone, `$2b$12$${crypto.randomBytes(40).toString('base64').replace(/[^A-Za-z0-9./]/g, '').slice(0, 53)}`],
  );
  fixtureUserIds.push(LG.id);
  // A suspended population member of A (read only).
  const popSuspended = await one(
    `select u.id, u.email from "OrganizationMembership" m join "User" u on u.id = m."userId"
      where m."orgId" = $1 and m.status = 'suspended' and u.email not like 'did1.%' and u.email not like 'l38.%' order by u.email limit 1`,
    [orgA.id],
  );
  const site = await one('select id, email from "User" where email = $1', [`site@${A.domain}`]);
  // The party every party offer names.
  const party = keep('setup party', await aPm.send('POST', `/projects/${projectA}/parties`, { role: 'subcontractor', companyName: `DID1 Party ${STAMP}` }));
  partyId = party.body?.data?.id || null;
  const partyCompanyId = partyId ? (await one('select "companyId" from "ProjectParty" where id = $1', [partyId]))?.companyId : null;
  // Two personal workspaces: P1 for C1, P2 for the seat race (C7).
  const register = async (label) => {
    const email = mail(label, A.domain);
    const res = keep(`setup register ${label}`, await api.raw('POST', '/auth/register', { json: { name: `DID1 ${label} ${STAMP}`, email, password: PASSWORD } }));
    const row = await one('select u.id, u."orgId", o.kind from "User" u join "Organisation" o on o.id = u."orgId" where u.email = $1', [email]);
    return { email, res, id: row?.id || null, orgId: row?.orgId || null, kind: row?.kind || null, token: res.body?.data?.tokens?.accessToken || null };
  };
  const P1 = await register('p1');
  const P2 = await register('p2');
  // A sign-up starts with no trial (status incomplete) and the subscription gate
  // refuses its writes; a trial starts only through a Stripe card setup, which
  // the in-process proof cannot complete. So P1's own throwaway subscription is
  // written as a running trial (fixture), restored at the end.
  if (P1.orgId) {
    P1.subscriptionBefore = await one('select status, "trialEndsAt" from "Subscription" where "orgId" = $1', [P1.orgId]);
    const trial = await db.query(`update "Subscription" set status = 'trialing', "trialEndsAt" = ${NOW} + interval '7 days', "updatedAt" = ${NOW} where "orgId" = $1`, [P1.orgId]);
    P1.trialWritten = trial.rowCount === 1;
    if (P1.trialWritten) personalSubscriptions.push(P1);
  }

  const states = {
    S1: await membershipIn(orgB.id, S1.id),
    S2c: await membershipIn(orgC.id, S2.id),
    XB: (await userRow(XB.email))?.status,
    LF: await membershipIn(orgA.id, LF.id),
    CL: [(await userRow(CL.email))?.status, (await membershipIn(orgA.id, CL.id))?.status],
    SEc: await membershipIn(orgC.id, SE.id),
    SEu: (await userRow(SE.email))?.status,
    CS: [(await userRow(CS.email))?.status, (await membershipIn(orgA.id, CS.id))?.status],
    NPM: await membershipIn(orgA.id, NPM.id),
    SU: await membershipIn(orgA.id, SU.id),
    SV: await membershipIn(orgA.id, SV.id),
  };
  const setupOk = [S1, S2, XB, LF, CL, SE, CS, NPM, SU, SV].every((p) => p.id) && !setupNotes.length
    && states.S1?.status === 'active' && states.S2c?.status === 'active' && states.XB === 'inactive'
    && states.LF?.status === 'left' && states.CL[0] === 'inactive' && states.CL[1] === 'left'
    && states.SEc?.status === 'suspended' && states.SEu === 'active' && states.CS[0] === 'inactive' && states.CS[1] === 'suspended'
    && states.NPM?.role === 'pm' && states.NPM?.isAdmin === false && states.NPM?.isOwner === false
    && states.SU?.status === 'active' && states.SV?.status === 'active'
    && closeXB.status === 200 && suspendSE.status === 200 && closeCS.status === 200
    && Boolean(popSuspended) && Boolean(site) && party.status === 201 && Boolean(partyCompanyId)
    && P1.res.status === 201 && P1.kind === 'personal' && P1.trialWritten && P2.res.status === 201 && P2.kind === 'personal' && Boolean(aPmId);
  check('C0.setup', setupOk, `${setupNotes.join('; ')} | states ${JSON.stringify(states)} | XB ${said(closeXB)} SE ${said(suspendSE)} CS ${said(closeCS)} | pop suspended ${Boolean(popSuspended)} site ${Boolean(site)} | party ${said(party)} | P1 ${said(P1.res)} ${P1.kind} trial fixture ${P1.trialWritten} P2 ${said(P2.res)} ${P2.kind}`);
  if (!setupOk) throw new Error('setup incomplete');
  // P2 is the empty personal workspace of C7: its owner's seat is written as left (fixture).
  await db.query(`update "OrganizationMembership" set status = 'left', "leftAt" = ${NOW} where "orgId" = $1 and "userId" = $2`, [P2.orgId, P2.id]);

  // ── what must not change before acceptance ───────────────────────────────────
  const classes = [
    { key: 'N', p: N },
    { key: 'S1', p: S1 },
    { key: 'S2', p: S2 },
    { key: 'XB', p: XB },
    { key: 'LF', p: LF },
    { key: 'CL', p: CL },
    { key: 'SE', p: SE },
  ];
  const known = classes.filter((c) => c.p.id);
  const aRows = async (userId) => JSON.stringify({
    membership: await q(`select status, role, kind, "isAdmin", "isOwner" from "OrganizationMembership" where "orgId" = $1 and "userId" = $2`, [orgA.id, userId]),
    assignments: (await one(`select count(*)::int as n from "ProjectAssignment" pa join "Project" p on p.id = pa."projectId" where p."orgId" = $1 and pa."userId" = $2`, [orgA.id, userId])).n,
    partyPlaces: (await one(`select count(*)::int as n from "ProjectPartyMember" m join "ProjectParty" pp on pp.id = m."projectPartyId" join "Project" p on p.id = pp."projectId" where p."orgId" = $1 and m."userId" = $2`, [orgA.id, userId])).n,
    companies: (await one(`select count(*)::int as n from "CompanyMembership" where "orgId" = $1 and "userId" = $2`, [orgA.id, userId])).n,
  });
  const rowsInA = async () => {
    const out = {};
    for (const c of known) out[c.key] = await aRows(c.p.id);
    return out;
  };
  const everyone = known.map((c) => c.p.id);
  const identityRows = async () => JSON.stringify(await q(`select id, "orgId", name, phone, email, role, status, "passwordHash", "mfaEnabled", "mfaSecretEnc", "ssoSubject", "isCompanyAdmin", "credentialEpoch" from "User" where id = any($1::text[]) order by id`, [everyone]));
  const elsewhere = async () => JSON.stringify(await q(`select "userId", "orgId", role, status, kind, "isAdmin", "isOwner", "invitationId" from "OrganizationMembership" where "userId" = any($1::text[]) and "orgId" <> $2 order by "userId", "orgId"`, [everyone, orgA.id]));
  const rowsBefore = await rowsInA();
  const identitiesBefore = await identityRows();
  const elsewhereBefore = await elsewhere();
  const printBefore = await fingerprint.take(db);
  const createAnswers = [];
  const newEmails = [N.email];

  // ════════════════════════════════════════════════════════════════════════════
  // C1 same answer
  // ════════════════════════════════════════════════════════════════════════════
  const DOORS = ['/users/invitations', '/users'];
  const payloads = {
    ws: {},
    project: { projectId: projectA },
    party: { projectId: projectA, projectPartyId: partyId },
  };
  await section('C1 same answer', async () => {
    const byKind = { ws: [], project: [], party: [] };
    for (const [kind, extra] of Object.entries(payloads)) {
      for (const c of classes) {
        for (const door of DOORS) {
          const { res } = await invite(aPm, door, { email: c.p.email, role: 'qs', ...extra }, { label: `C1 ${kind} ${c.key} ${door}`, token: false });
          byKind[kind].push({ key: `${c.key}${door === '/users' ? '/u' : '/i'}`, res, c });
          createAnswers.push(res);
        }
      }
    }
    for (const kind of Object.keys(payloads)) {
      const list = byKind[kind];
      const ok = list.length === 14 && list.every(({ res }) => res.status === 201 && res.body?.data?.invited === true)
        && new Set(list.map(({ res }) => dataKeys(res))).size === 1 && new Set(list.map(({ res }) => dataValues(res))).size === 1;
      check(`C1.${kind}`, ok, list.map(({ key, res }) => `${key} ${said(res)} {${dataKeys(res)}} ${dataValues(res)}`).join(' | '));
    }
    const leaks = [];
    for (const kind of Object.keys(payloads)) {
      for (const { key, res, c } of byKind[kind]) {
        const words = [c.p.name, c.p.phone, c.p.id, orgB.id, orgB.name, orgC.id, orgC.name].filter(Boolean);
        const found = words.filter((w) => (res.text || '').includes(w));
        if (found.length) leaks.push(`${kind} ${key}: ${found.join(', ')}`);
      }
    }
    check('C1.leak', leaks.length === 0, leaks.join(' | '));

    // ── the 409 classes ──
    const suspendedClasses = [
      { key: 'popSuspended', email: popSuspended.email },
      { key: 'CS', email: CS.email },
      { key: 'LG', email: LG.email },
    ];
    const countFor = async (emails) => (await one(`select count(*)::int as n from "InvitationToken" where "orgId" = $1 and email = any($2::text[])`, [orgA.id, emails])).n;
    const suspendedCountBefore = await countFor(suspendedClasses.map((s) => s.email));
    const refusals = [];
    for (const s of suspendedClasses) {
      for (const [kind, extra] of Object.entries(payloads)) {
        for (const door of DOORS) {
          const res = keep(`C1 409 ${s.key} ${kind} ${door}`, await aPm.send('POST', door, { email: s.email, role: 'qs', ...extra }));
          refusals.push({ key: `${s.key} ${kind} ${door}`, res });
        }
      }
    }
    const activeHere = [];
    for (const [kind, extra] of Object.entries(payloads)) {
      for (const door of DOORS) {
        const res = keep(`C1 active ${kind} ${door}`, await aPm.send('POST', door, { email: site.email, role: 'qs', ...extra }));
        if (kind === 'ws') refusals.push({ key: `site ws ${door}`, res });
        else activeHere.push({ key: `site ${kind} ${door}`, res });
      }
    }
    const reference = errorShape(refusals[0].res);
    check('C1.409', refusals.length === 20 && refusals.every(({ res }) => said(res) === '409 ALREADY_MEMBER' && errorShape(res) === reference),
      refusals.filter(({ res }) => said(res) !== '409 ALREADY_MEMBER' || errorShape(res) !== reference).map(({ key, res }) => `${key}: ${said(res)} ${errorShape(res)}`).join(' | ') || `reference ${reference}`);
    const suspendedCountAfter = await countFor(suspendedClasses.map((s) => s.email));
    check('C1.409.nowrite', suspendedCountAfter === suspendedCountBefore, `${suspendedCountBefore} -> ${suspendedCountAfter}`);
    check('C1.active', activeHere.length === 4 && activeHere.every(({ res }) => res.status === 201 && res.body?.data?.invited === true),
      activeHere.map(({ key, res }) => `${key}: ${said(res)}`).join(' | '));
    // The population member is not left with a pending offer.
    for (const row of await q(`select id from "InvitationToken" where "orgId" = $1 and email = $2 and status = 'pending' and "createdAt" >= ${utc(3)}`, [orgA.id, site.email, RUN_START.toISOString()])) {
      keep('C1 revoke site offer', await aPm.send('DELETE', `/users/invitations/${row.id}`));
    }

    // ── personal workspace ──
    const NP = mail('newpersonal', A.domain);
    newEmails.push(NP);
    const p1Token = P1.token || (await api.tokenFor(P1.email));
    const personal = [];
    const p1Before = (await one('select count(*)::int as n from "InvitationToken" where "orgId" = $1', [P1.orgId])).n;
    for (const email of [NP, S1.email]) {
      for (const door of DOORS) {
        personal.push({ key: `${email === NP ? 'new' : 'existing'} ${door}`, res: keep(`C1 personal ${door}`, await api.raw('POST', door, { token: p1Token, json: { email, role: 'qs' } })) });
      }
    }
    const p1After = (await one('select count(*)::int as n from "InvitationToken" where "orgId" = $1', [P1.orgId])).n;
    const pRef = errorShape(personal[0].res);
    check('C1.personal', personal.every(({ res }) => said(res) === '409 PERSONAL_WORKSPACE_CONVERT_REQUIRED' && errorShape(res) === pRef) && p1After === p1Before,
      `${personal.map(({ key, res }) => `${key}: ${said(res)} ${errorShape(res)}`).join(' | ')}; P1 invitations ${p1Before} -> ${p1After}`);

    // ── delivery failure ──
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const { port: open } = server.address();
        server.close(() => resolve(open));
      });
    });
    const ND = mail('newdelivery', A.domain);
    newEmails.push(ND);
    const failed = [];
    try {
      process.env.EMAIL_PROVIDER = 'webhook';
      process.env.EMAIL_WEBHOOK_URL = `http://127.0.0.1:${port}/mail`;
      for (const email of [ND, S2.email]) {
        failed.push({ email, res: keep(`C1 delivery ${email}`, await aPm.send('POST', '/users/invitations', { email, role: 'qs' }), 'INVITATION_EMAIL_FAILED') });
      }
    } finally {
      restoreEnv('EMAIL_PROVIDER');
      restoreEnv('EMAIL_WEBHOOK_URL');
    }
    const dRef = errorShape(failed[0].res);
    check('C1.502', failed.every(({ res }) => said(res) === '502 INVITATION_EMAIL_FAILED' && errorShape(res) === dRef),
      failed.map(({ email, res }) => `${email === ND ? 'new' : 'existing'}: ${said(res)} ${errorShape(res)}`).join(' | '));
    const states502 = [];
    for (const { email, res } of failed) {
      const id = res.body?.error?.details?.invitationId
        || (await one(`select id from "InvitationToken" where "orgId" = $1 and email = $2 order by "createdAt" desc limit 1`, [orgA.id, email]))?.id;
      const row = id ? await invitationRow(id) : null;
      const audited = id ? (await one(`select count(*)::int as n from "AuthAuditEvent" where "orgId" = $1 and action = 'invitation_delivery_failed' and "entityId" = $2`, [orgA.id, id])).n : 0;
      states502.push({ email: email === ND ? 'new' : 'existing', status: row?.status, audited });
    }
    check('C1.502.state', states502.length === 2 && states502.every((s) => s.status === 'pending' && s.audited === 1), JSON.stringify(states502));
  });

  // ════════════════════════════════════════════════════════════════════════════
  // C3 password refused; the emergency switch
  // ════════════════════════════════════════════════════════════════════════════
  const NG = { email: mail('guest', A.domain), name: `DID1 guest ${STAMP}` };
  newEmails.push(NG.email);
  let tokenNG = null;
  let tokenS2Flag = null;
  let idS2Flag = null;
  await section('C3 password refused', async () => {
    const targets = [N.email, S1.email];
    const countBefore = (await one(`select count(*)::int as n from "InvitationToken" where email = any($1::text[])`, [targets])).n;
    const matrix = [];
    const fields = [['password'], ['confirmPassword'], ['password', 'confirmPassword']];
    const values = ['Str0ngPass1', '', null, false, 12345];
    await aPm.token();
    const counted = { targets, hits: 0, samples: [] };
    watch = counted;
    try {
      for (const door of DOORS) {
        for (const email of targets) {
          for (const set of fields) {
            for (const value of values) {
              const body = { email, role: 'qs' };
              for (const field of set) body[field] = value;
              matrix.push({ key: `${door} ${email === N.email ? 'new' : 'existing'} ${set.join('+')}=${JSON.stringify(value)}`, res: keep('C3 matrix', await aPm.send('POST', door, body)) });
            }
          }
        }
      }
    } finally {
      watch = null;
    }
    const { hits, samples } = counted;
    const ref = errorShape(matrix[0].res);
    const odd = matrix.filter(({ res }) => said(res) !== '400 USER_PASSWORD_NOT_ACCEPTED' || errorShape(res) !== ref);
    check('C3.matrix', matrix.length === 60 && odd.length === 0, odd.map(({ key, res }) => `${key}: ${said(res)}`).slice(0, 12).join(' | ') || `${matrix.length} requests`);
    const countAfter = (await one(`select count(*)::int as n from "InvitationToken" where email = any($1::text[])`, [targets])).n;
    check('C3.count', countAfter === countBefore, `${countBefore} -> ${countAfter}`);
    check('C3.statements', hits === 0, `${hits} statement(s) carried a target e-mail: ${samples.join(' || ')}`);
  });

  await section('C3 emergency switch', async () => {
    // The links to accept while the switch is off, made while it is on.
    const ng = await invite(aPm, '/users/invitations', { email: NG.email, role: 'qs', projectId: projectA, projectPartyId: partyId }, { label: 'C3 invite NG' });
    tokenNG = ng.token;
    const s2 = await invite(aPm, '/users/invitations', { email: S2.email, role: 'qs', projectId: projectA }, { label: 'C3 invite S2 project' });
    tokenS2Flag = s2.token;
    idS2Flag = s2.id;
    const s2Bearer = await api.tokenFor(S2.email, orgB.id);
    const NF = mail('newflag', A.domain);
    newEmails.push(NF);
    let flagInvites = [];
    let flagAccepts = [];
    try {
      process.env.AUTH_MEMBERSHIP_WRITE = 'false';
      for (const door of DOORS) flagInvites.push({ door, res: keep(`C3 flag-off invite ${door}`, await aPm.send('POST', door, { email: NF, role: 'qs' }), 'MEMBERSHIP_WRITES_SUSPENDED') });
      flagAccepts = [
        { who: 'new party guest', res: keep('C3 flag-off accept NG', await accept(tokenNG, { password: PASSWORD, name: NG.name }), 'MEMBERSHIP_WRITES_SUSPENDED') },
        { who: 'existing foreign identity', res: keep('C3 flag-off accept S2', await accept(tokenS2Flag, { bearer: s2Bearer }), 'MEMBERSHIP_WRITES_SUSPENDED') },
      ];
    } finally {
      restoreEnv('AUTH_MEMBERSHIP_WRITE');
    }
    const nfRows = (await one('select count(*)::int as n from "InvitationToken" where email = $1', [NF])).n;
    check('C3.flagoff.invite', ng.res.status === 201 && s2.res.status === 201 && flagInvites.length === 2 && flagInvites.every(({ res }) => said(res) === '503 MEMBERSHIP_WRITES_SUSPENDED') && nfRows === 0,
      `${flagInvites.map(({ door, res }) => `${door}: ${said(res)}`).join(' | ')}; invitation rows ${nfRows}`);
    check('C3.flagoff.accept', Boolean(tokenNG) && Boolean(tokenS2Flag) && flagAccepts.every(({ res }) => said(res) === '503 MEMBERSHIP_WRITES_SUSPENDED'),
      `${flagAccepts.map(({ who, res }) => `${who}: ${said(res)}`).join(' | ')}; links ${Boolean(tokenNG)} ${Boolean(tokenS2Flag)}`);
    const ngRow = await invitationRow(ng.id);
    const s2Row = await invitationRow(s2.id);
    const ngUser = await userRow(NG.email);
    const s2A = JSON.parse(await aRows(S2.id));
    check('C3.flagoff.nowrite', ngRow?.status === 'pending' && s2Row?.status === 'pending' && !ngUser && s2A.membership.length === 0 && s2A.assignments === 0 && s2A.partyPlaces === 0 && s2A.companies === 0,
      `NG link ${ngRow?.status}, S2 link ${s2Row?.status}, NG user ${Boolean(ngUser)}, S2 in A ${JSON.stringify(s2A)}`);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // C2 nothing before acceptance
  // ════════════════════════════════════════════════════════════════════════════
  await section('C2 nothing before acceptance', async () => {
    const users = await q('select email from "User" where email = any($1::text[])', [newEmails]);
    check('C2.nouser', users.length === 0, `User rows for ${users.map((u) => u.email).join(', ')}`);
    const rowsAfter = await rowsInA();
    const changed = Object.keys(rowsBefore).filter((k) => rowsBefore[k] !== rowsAfter[k]);
    check('C2.rows', changed.length === 0, changed.map((k) => `${k}: ${rowsBefore[k]} -> ${rowsAfter[k]}`).join(' | '));
    const idsNow = await identityRows();
    const elseNow = await elsewhere();
    check('C2.elsewhere', idsNow === identitiesBefore && elseNow === elsewhereBefore, `identities ${idsNow === identitiesBefore ? 'same' : 'CHANGED'}; memberships elsewhere ${elseNow === elsewhereBefore ? 'same' : 'CHANGED'}`);
    const personalCodes = new Set([P1.orgId, P2.orgId].filter(Boolean).map((id) => id.slice(0, 8)));
    const changes = fingerprint.compare(printBefore, await fingerprint.take(db)).filter((c) => !c.noise && c.org !== A_CODE && !personalCodes.has(c.org));
    check('C2.fingerprint', changes.length === 0, changes.map((c) => `${c.table}:${c.org} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
    const createLeaks = createAnswers.filter((res) => /existing/i.test(res.text || ''));
    const list = keep('C2 list', await aPm.send('GET', '/users/invitations'));
    const history = keep('C2 history', await aPm.send('GET', `/projects/${projectA}/audit?entityType=user_invitation&order=desc&limit=100`));
    const projectInvitationIds = createAnswers.filter((res) => res.status === 201 && res.body?.data?.projectId === projectA).map((res) => res.body.data.id);
    const historyNamesOurs = projectInvitationIds.some((id) => (history.text || '').includes(id));
    check('C2.surfaces', createLeaks.length === 0 && list.status === 200 && !/existing/i.test(list.text || '') && history.status === 200 && historyNamesOurs && !/existing/i.test(history.text || ''),
      `create answers with "existing" ${createLeaks.length}; list ${said(list)} existing=${/existing/i.test(list.text || '')}; history ${said(history)} ours=${historyNamesOurs} existing=${/existing/i.test(history.text || '')}`);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // C5 acceptance
  // ════════════════════════════════════════════════════════════════════════════
  await section('C5 acceptance', async () => {
    // A new identity.
    const n = await invite(aPm, '/users/invitations', { email: N.email, role: 'qs' }, { label: 'C5 invite N' });
    const nAccepted = keep('C5 N accepts', await accept(n.token, { password: PASSWORD, name: N.name }));
    const nUser = await userRow(N.email);
    const nLogin = keep('C5 N login', await api.raw('POST', '/auth/login', { json: { email: N.email, password: PASSWORD } }));
    const nMember = nUser ? await membershipIn(orgA.id, nUser.id) : null;
    check('C5.new', n.res.status === 201 && nAccepted.status === 200 && Boolean(nAccepted.body?.data?.tokens?.accessToken) && nUser?.orgId === orgA.id && nMember?.status === 'active' && nMember.role === 'qs' && nLogin.status === 200 && Boolean(nLogin.body?.data?.tokens?.accessToken || nLogin.body?.data?.identityToken),
      `invite ${said(n.res)}; accept ${said(nAccepted)}; user ${JSON.stringify(nUser && { org: nUser.orgId === orgA.id })}; member ${JSON.stringify(nMember)}; login ${said(nLogin)}`);
    const reuse = keep('C5 N reuse', await accept(n.token, { password: PASSWORD, name: N.name }));
    check('C5.reuse', said(reuse) === '400 INVITATION_TOKEN_INVALID', said(reuse));
    // Revoked.
    const NR = mail('newrevoked', A.domain);
    const r = await invite(aPm, '/users/invitations', { email: NR, role: 'qs' }, { label: 'C5 invite NR' });
    const revoked = keep('C5 revoke NR', await aPm.send('DELETE', `/users/invitations/${r.id}`));
    const rAccept = keep('C5 NR accepts', await accept(r.token, { password: PASSWORD, name: 'Revoked' }));
    check('C5.revoked', r.res.status === 201 && revoked.status === 200 && said(rAccept) === '400 INVITATION_TOKEN_INVALID' && !(await userRow(NR)), `${said(r.res)}; revoke ${said(revoked)}; accept ${said(rAccept)}`);
    // Superseded.
    const NS = mail('newsuperseded', A.domain);
    const s1st = await invite(aPm, '/users/invitations', { email: NS, role: 'qs' }, { label: 'C5 invite NS 1' });
    const s2nd = await invite(aPm, '/users/invitations', { email: NS, role: 'qs' }, { label: 'C5 invite NS 2' });
    const sAccept = keep('C5 NS old link', await accept(s1st.token, { password: PASSWORD, name: 'Superseded' }));
    check('C5.superseded', s1st.res.status === 201 && s2nd.res.status === 201 && s1st.token !== s2nd.token && said(sAccept) === '400 INVITATION_TOKEN_INVALID' && !(await userRow(NS)), `${said(s1st.res)} ${said(s2nd.res)}; old link ${said(sAccept)}`);

    // An existing identity: S1.
    const s1 = await invite(aPm, '/users/invitations', { email: S1.email, role: 'site_engineer' }, { label: 'C5 invite S1' });
    const alone = keep('C5 S1 link alone', await accept(s1.token, { name: 'Not S1' }));
    check('C5.alone', said(alone) === '401 INVITATION_SIGN_IN_REQUIRED' && !(await membershipIn(orgA.id, S1.id)) && (await invitationRow(s1.id))?.status === 'pending', said(alone));
    const s1Bearer = await api.tokenFor(S1.email, orgB.id);
    const own = keep('C5 S1 own bearer', await accept(s1.token, { bearer: s1Bearer }));
    const s1In = await membershipIn(orgA.id, S1.id);
    check('C5.own', own.status === 200 && s1In?.status === 'active' && s1In.role === 'site_engineer' && s1In.kind === 'member' && s1In.isAdmin === false && s1In.isOwner === false,
      `${said(own)}; ${JSON.stringify(s1In)}`);
    api.forget(S1.email);

    // The party guest NG (its link was refused while the switch was off).
    const ngBefore = await userRow(NG.email);
    const ngAccepted = keep('C5 NG accepts', await accept(tokenNG, { password: PASSWORD, name: NG.name }));
    const ngUser = await userRow(NG.email);
    const ngIn = ngUser ? await membershipIn(orgA.id, ngUser.id) : null;
    check('C5.guest', !ngBefore && ngAccepted.status === 200 && ngIn?.kind === 'guest' && ngIn.role === 'external_party' && ngIn.status === 'active',
      `before ${Boolean(ngBefore)}; ${said(ngAccepted)}; ${JSON.stringify(ngIn)}`);

    // CL: closed+LEFT, home A.
    const cl = await invite(aPm, '/users/invitations', { email: CL.email, role: 'qs' }, { label: 'C5 invite CL' });
    const clAccepted = keep('C5 CL accepts', await accept(cl.token, { password: NEW_PASSWORD, name: CL.name }));
    const clLogin = keep('C5 CL login', await api.raw('POST', '/auth/login', { json: { email: CL.email, password: NEW_PASSWORD } }));
    const clUser = await userRow(CL.email);
    check('C5.cl', cl.res.status === 201 && clAccepted.status === 200 && clAccepted.body?.data?.accepted === true && clAccepted.body?.data?.signInRequired === true && !clAccepted.body?.data?.tokens && clLogin.status === 200 && clUser?.status === 'active',
      `invite ${said(cl.res)}; accept ${said(clAccepted)} ${JSON.stringify(clAccepted.body?.data || null)}; login ${said(clLogin)}; status ${clUser?.status}`);

    // Suspension with an outstanding link: SU.
    const su = await invite(aPm, '/users/invitations', { email: SU.email, role: 'qs', projectId: projectA }, { label: 'C5 invite SU project' });
    const suBearer = await api.tokenFor(SU.email, orgB.id);
    const suUserBefore = await userRow(SU.email);
    const deactivated = keep('C5 A deactivates SU', await aPm.send('PATCH', `/users/${SU.id}/deactivate`, {}));
    const suRow = await invitationRow(su.id);
    const suAudit = await one(`select count(*)::int as n from "AuthAuditEvent" where "orgId" = $1 and action = 'invitation_revoked' and "entityId" = $2 and "metadataJson"->>'reason' = 'member_suspended'`, [orgA.id, su.id]);
    const suAccept = keep('C5 SU accepts', await accept(su.token, { bearer: suBearer }));
    const suUserAfter = await userRow(SU.email);
    const suIn = await membershipIn(orgA.id, SU.id);
    check('C5.susp', su.res.status === 201 && deactivated.status === 200 && suRow?.status === 'revoked' && suAudit.n === 1 && said(suAccept) === '400 INVITATION_TOKEN_INVALID' && suIn?.status === 'suspended'
      && suUserAfter?.status === suUserBefore?.status && suUserAfter?.passwordHash === suUserBefore?.passwordHash,
      `invite ${said(su.res)}; deactivate ${said(deactivated)}; link ${suRow?.status}; audit ${suAudit.n}; accept ${said(suAccept)}; membership ${suIn?.status}; status ${suUserBefore?.status}->${suUserAfter?.status}; hash same ${suUserAfter?.passwordHash === suUserBefore?.passwordHash}`);

    // A pending link written straight against SU's suspended membership (fixture).
    const direct = await fixtureInvitation({ email: SU.email });
    const directAccept = keep('C5 direct fixture', await accept(direct.token, { bearer: await api.tokenFor(SU.email, orgB.id) }));
    const directRow = await invitationRow(direct.id);
    const directAudit = await one(`select count(*)::int as n from "AuthAuditEvent" where action = 'invitation_accept_rejected' and "entityId" = $1`, [direct.id]);
    const suInNow = await membershipIn(orgA.id, SU.id);
    check('C5.direct', said(directAccept) === '400 INVITATION_TOKEN_INVALID' && suInNow?.status === 'suspended' && directRow?.status === 'pending' && directAudit.n === 1,
      `${said(directAccept)}; membership ${suInNow?.status}; link ${directRow?.status}; refusal audited ${directAudit.n}`);

    // SV: suspended while its acceptance waits on the (org, e-mail) lock the proof holds.
    const sv = await invite(aPm, '/users/invitations', { email: SV.email, role: 'qs', projectId: projectA }, { label: 'C5 invite SV project' });
    const svBearer = await api.tokenFor(SV.email, orgB.id);
    await beginLock([advisory(orgA.id, SV.email)]);
    const pendingAccept = accept(sv.token, { bearer: svBearer });
    const queued = await waitForWaiters(1);
    await lockDb.query(`update "OrganizationMembership" set status = 'suspended' where "orgId" = $1 and "userId" = $2`, [orgA.id, SV.id]);
    await endLock();
    const svAccept = keep('C5 SV interleaved accept', await pendingAccept);
    const svIn = await membershipIn(orgA.id, SV.id);
    const svRow = await invitationRow(sv.id);
    check('C5.interleave', sv.res.status === 201 && queued >= 1 && said(svAccept) === '400 INVITATION_TOKEN_INVALID' && svIn?.status === 'suspended' && svRow?.status === 'pending',
      `invite ${said(sv.res)}; waiting ${queued}; accept ${said(svAccept)}; membership ${svIn?.status}; link ${svRow?.status}`);

    // CS: closed+SUSPENDED, home A, with a fixture link.
    const cs = await fixtureInvitation({ email: CS.email });
    const csAccept = keep('C5 CS fixture', await accept(cs.token, { password: NEW_PASSWORD, name: CS.name }));
    const csUser = await userRow(CS.email);
    const csIn = await membershipIn(orgA.id, CS.id);
    const csAudit = await one(`select count(*)::int as n from "AuthAuditEvent" where action = 'invitation_accept_rejected' and "entityId" = $1`, [cs.id]);
    check('C5.cs', said(csAccept) === '400 INVITATION_TOKEN_INVALID' && csUser?.status === 'inactive' && csIn?.status === 'suspended' && csAudit.n === 1,
      `${said(csAccept)}; identity ${csUser?.status}; membership ${csIn?.status}; refusal audited ${csAudit.n}`);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // C6 invitation management
  // ════════════════════════════════════════════════════════════════════════════
  await section('C6 invitation management', async () => {
    const ALLOWED = ['id', 'email', 'role', 'status', 'projectId', 'companyId', 'projectPartyId', 'invitedById', 'expiresAt', 'createdAt', 'note', 'lastDeliveryFailedAt'];
    const expired = await fixtureInvitation({ email: mail('expired', A.domain), expiresAt: new Date(Date.now() - 3_600_000) });
    const pendingIds = async (orgId) => (await q(`select id from "InvitationToken" where "orgId" = $1 and status = 'pending' and "acceptedAt" is null and "revokedAt" is null and "expiresAt" > ${NOW} order by "createdAt" desc, id desc`, [orgId])).map((r) => r.id);
    const list = keep('C6 A list', await aPm.send('GET', '/users/invitations'));
    const listed = (list.body?.data?.items || []);
    const dbA = await pendingIds(orgA.id);
    const listedIds = listed.map((i) => i.id);
    const extraKeys = [...new Set(listed.flatMap((i) => Object.keys(i)).filter((k) => !ALLOWED.includes(k)))];
    const exact = dbA.length <= 50 ? listedIds.length === dbA.length && listedIds.every((id) => dbA.includes(id)) : listedIds.every((id) => dbA.includes(id));
    check('C6.list', list.status === 200 && listed.length > 0 && exact && extraKeys.length === 0 && !/existing/i.test(list.text || ''),
      `${said(list)}; listed ${listedIds.length}, A pending ${dbA.length}; extra keys ${extraKeys.join(',') || 'none'}`);
    check('C6.expired', list.status === 200 && !listedIds.includes(expired.id), `expired listed ${listedIds.includes(expired.id)}`);
    const bList = keep('C6 B list', await bPm.send('GET', '/users/invitations'));
    const bIds = (bList.body?.data?.items || []).map((i) => i.id);
    const dbB = await pendingIds(orgB.id);
    const bExact = dbB.length <= 50 ? bIds.length === dbB.length && bIds.every((id) => dbB.includes(id)) : bIds.every((id) => dbB.includes(id));
    const target = idS2Flag;
    const bRevoke = keep('C6 B revokes A', await bPm.send('DELETE', `/users/invitations/${target}`));
    check('C6.foreign', bList.status === 200 && bExact && !bIds.some((id) => dbA.includes(id)) && said(bRevoke) === '404 INVITATION_NOT_FOUND' && (await invitationRow(target))?.status === 'pending',
      `list ${said(bList)} ${bIds.length} vs B pending ${dbB.length}; revoke ${said(bRevoke)}; A row ${(await invitationRow(target))?.status}`);
    const qsList = keep('C6 qs list', await aQs.send('GET', '/users/invitations'));
    const qsRevoke = keep('C6 qs revoke', await aQs.send('DELETE', `/users/invitations/${target}`));
    const qsResend = keep('C6 qs resend', await aQs.send('POST', `/users/invitations/${target}/resend`, {}));
    check('C6.gate', [qsList, qsRevoke, qsResend].every((r) => said(r) === '403 FORBIDDEN') && (await invitationRow(target))?.status === 'pending',
      `${said(qsList)} | ${said(qsRevoke)} | ${said(qsResend)}`);
    // An audited revoke.
    const NV = mail('newrevoke', A.domain);
    const v = await invite(aPm, '/users/invitations', { email: NV, role: 'qs' }, { label: 'C6 invite NV' });
    const vRevoke = keep('C6 revoke NV', await aPm.send('DELETE', `/users/invitations/${v.id}`));
    const vAudit = await one(`select count(*)::int as n from "AuthAuditEvent" where "orgId" = $1 and action = 'invitation_revoked' and "entityId" = $2 and "metadataJson"->>'reason' = 'revoked_by_admin'`, [orgA.id, v.id]);
    const vAccept = keep('C6 NV accepts', await accept(v.token, { password: PASSWORD, name: 'Revoked' }));
    check('C6.revoke', v.res.status === 201 && vRevoke.status === 200 && vRevoke.body?.data?.revoked === true && vRevoke.body?.data?.id === v.id && vAudit.n === 1 && said(vAccept) === '400 INVITATION_TOKEN_INVALID',
      `invite ${said(v.res)}; revoke ${said(vRevoke)} ${JSON.stringify(vRevoke.body?.data || null)}; audit ${vAudit.n}; accept ${said(vAccept)}`);
    // The expired row: revoked once.
    const e1 = keep('C6 revoke expired 1', await aPm.send('DELETE', `/users/invitations/${expired.id}`));
    const e2 = keep('C6 revoke expired 2', await aPm.send('DELETE', `/users/invitations/${expired.id}`));
    check('C6.revoke-expired', e1.status === 200 && said(e2) === '409 INVITATION_NOT_PENDING' && (await invitationRow(expired.id))?.status === 'revoked', `${said(e1)} | ${said(e2)}`);
    // Revoke against accept, five times.
    const rounds = [];
    for (let i = 0; i < 5; i += 1) {
      const email = mail(`race${i}`, A.domain);
      const inv = await invite(aPm, '/users/invitations', { email, role: 'qs' }, { label: `C6 race invite ${i}` });
      const [rev, acc] = await Promise.all([aPm.send('DELETE', `/users/invitations/${inv.id}`), accept(inv.token, { password: PASSWORD, name: `Race ${i}` })]);
      keep(`C6 race revoke ${i}`, rev);
      keep(`C6 race accept ${i}`, acc);
      const row = await invitationRow(inv.id);
      const acceptedAudit = (await one(`select count(*)::int as n from "AuthAuditEvent" where action = 'invitation_accepted' and "entityId" = $1`, [inv.id])).n;
      const revokedAudit = (await one(`select count(*)::int as n from "AuthAuditEvent" where action = 'invitation_revoked' and "entityId" = $1 and "metadataJson"->>'reason' = 'revoked_by_admin'`, [inv.id])).n;
      const user = await userRow(email);
      const acceptedWon = acc.status === 200 && said(rev) === '409 INVITATION_NOT_PENDING' && row?.status === 'accepted' && acceptedAudit === 1 && revokedAudit === 0 && Boolean(user);
      const revokeWon = rev.status === 200 && said(acc) === '400 INVITATION_TOKEN_INVALID' && row?.status === 'revoked' && acceptedAudit === 0 && revokedAudit === 1 && !user;
      rounds.push({ i, revoke: said(rev), accept: said(acc), row: row?.status, acceptedAudit, revokedAudit, user: Boolean(user), ok: inv.res.status === 201 && (acceptedWon !== revokeWon) });
    }
    check('C6.race', rounds.length === 5 && rounds.every((r) => r.ok), JSON.stringify(rounds));
    // Resend with the stored offer.
    const NRS = mail('newresend', A.domain);
    const note = `DID1 note ${STAMP}`;
    const original = await invite(aPm, '/users/invitations', { email: NRS, role: 'planning_eng', projectId: projectA, projectPartyId: partyId, note }, { label: 'C6 invite NRS' });
    const before = invitations.mailsTo(NRS).length;
    const resent = keep('C6 resend', await aPm.send('POST', `/users/invitations/${original.id}/resend`, {}));
    const newId = resent.body?.data?.id;
    const oldRow = await invitationRow(original.id);
    const newRow = newId ? await invitationRow(newId) : null;
    const newToken = newId ? await invitations.invitationTokenFor({ email: NRS, invitationId: newId, after: before, db }) : null;
    const oldAccept = keep('C6 NRS old link', await accept(original.token, { password: PASSWORD, name: 'Resent' }));
    check('C6.resend', original.res.status === 201 && resent.status === 201 && newId && newId !== original.id && newRow?.status === 'pending' && newRow.role === 'planning_eng' && newRow.projectId === projectA && newRow.projectPartyId === partyId && newRow.companyId === partyCompanyId && newRow.note === note && oldRow?.status === 'revoked' && Boolean(newToken) && said(oldAccept) === '400 INVITATION_TOKEN_INVALID',
      `invite ${said(original.res)}; resend ${said(resent)}; new ${JSON.stringify(newRow)}; old ${oldRow?.status}; new link ${Boolean(newToken)}; old link ${said(oldAccept)}`);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // C7 races
  // ════════════════════════════════════════════════════════════════════════════
  await section('C7 races', async () => {
    // Seat: two member links into the empty personal workspace P2, held at the organisation row.
    const seatA = mail('seata', A.domain);
    const seatB = mail('seatb', A.domain);
    const linkA = await fixtureInvitation({ orgId: P2.orgId, email: seatA, invitedById: null });
    const linkB = await fixtureInvitation({ orgId: P2.orgId, email: seatB, invitedById: null });
    await beginLock([['select id from "Organisation" where id = $1 for update', [P2.orgId]]]);
    const pa = accept(linkA.token, { password: PASSWORD, name: 'Seat A' });
    const pb = accept(linkB.token, { password: PASSWORD, name: 'Seat B' });
    const held = await waitForWaiters(2);
    await endLock();
    const [ra, rb] = await Promise.all([pa, pb]);
    keep('C7 seat A', ra);
    keep('C7 seat B', rb);
    const pairs = [[ra, seatA, linkA], [rb, seatB, linkB]];
    const winners = pairs.filter(([r]) => r.status === 200);
    const losers = pairs.filter(([r]) => r.status !== 200);
    const loserUser = losers.length === 1 ? await userRow(losers[0][1]) : null;
    const winnerUser = winners.length === 1 ? await userRow(winners[0][1]) : null;
    const seated = (await one(`select count(*)::int as n from "OrganizationMembership" where "orgId" = $1 and kind = 'member' and status <> 'left'`, [P2.orgId])).n;
    check('C7.seat', held >= 2 && winners.length === 1 && losers.length === 1 && said(losers[0][0]) === '409 PERSONAL_WORKSPACE_CONVERT_REQUIRED' && !loserUser && Boolean(winnerUser) && seated === 1,
      `waiting ${held}; ${said(ra)} | ${said(rb)}; loser user ${Boolean(loserUser)}; seated ${seated}`);

    // Across organisations: A and B invite one new e-mail; both links accepted, each held at its (org, e-mail) lock.
    const NX = mail('newxorg', A.domain);
    const ax = await invite(aPm, '/users/invitations', { email: NX, role: 'qs' }, { label: 'C7 A invites NX' });
    const bx = await invite(bPm, '/users/invitations', { email: NX, role: 'qs' }, { label: 'C7 B invites NX' });
    await beginLock([advisory(orgA.id, NX), advisory(orgB.id, NX)]);
    const xa = accept(ax.token, { password: PASSWORD, name: 'Cross A' });
    const xb = accept(bx.token, { password: PASSWORD, name: 'Cross B' });
    const xHeld = await waitForWaiters(2);
    await endLock();
    const [rxa, rxb] = await Promise.all([xa, xb]);
    keep('C7 xorg A', rxa);
    keep('C7 xorg B', rxb);
    const xPairs = [[rxa, ax], [rxb, bx]];
    const xWin = xPairs.filter(([r]) => r.status === 200);
    const xLose = xPairs.filter(([r]) => r.status !== 200);
    const nxUsers = (await one('select count(*)::int as n from "User" where email = $1', [NX])).n;
    const loserRow = xLose.length === 1 ? await invitationRow(xLose[0][1].id) : null;
    check('C7.xorg', ax.res.status === 201 && bx.res.status === 201 && xHeld >= 2 && xWin.length === 1 && xLose.length === 1 && said(xLose[0][0]) === '401 INVITATION_SIGN_IN_REQUIRED' && nxUsers === 1 && loserRow?.status === 'pending' && !loserRow.acceptedAt,
      `invites ${said(ax.res)} ${said(bx.res)}; waiting ${xHeld}; A ${said(rxa)} | B ${said(rxb)}; users ${nxUsers}; loser link ${loserRow?.status}`);

    // Invite against accept, five times: three with the acceptance queued first at the lock, two left to run.
    const rounds = [];
    for (let i = 0; i < 5; i += 1) {
      const email = mail(`ia${i}`, A.domain);
      const first = await invite(aPm, '/users/invitations', { email, role: 'qs' }, { label: `C7 ia invite ${i}` });
      const forced = i < 3;
      let accRes;
      let invRes;
      let queued = null;
      if (forced) {
        await beginLock([advisory(orgA.id, email)]);
        const acc = accept(first.token, { password: PASSWORD, name: `IA ${i}` });
        const q1 = await waitForWaiters(1);
        const inv = aPm.send('POST', '/users/invitations', { email, role: 'qs' });
        const q2 = await waitForWaiters(2);
        queued = `${q1}/${q2}`;
        await endLock();
        [accRes, invRes] = await Promise.all([acc, inv]);
      } else {
        [accRes, invRes] = await Promise.all([accept(first.token, { password: PASSWORD, name: `IA ${i}` }), aPm.send('POST', '/users/invitations', { email, role: 'qs' })]);
      }
      keep(`C7 ia accept ${i}`, accRes);
      keep(`C7 ia invite2 ${i}`, invRes);
      const user = await userRow(email);
      const member = user ? await membershipIn(orgA.id, user.id) : null;
      const pendingWs = await q(`select id from "InvitationToken" where "orgId" = $1 and email = $2 and status = 'pending' and "projectId" is null and "companyId" is null and "projectPartyId" is null`, [orgA.id, email]);
      const activeMember = member?.status === 'active';
      const acceptedFirst = accRes.status === 200 && said(invRes) === '409 ALREADY_MEMBER' && activeMember && pendingWs.length === 0;
      const invitedFirst = said(accRes) === '400 INVITATION_TOKEN_INVALID' && invRes.status === 201 && !activeMember && pendingWs.length === 1 && pendingWs[0].id === invRes.body?.data?.id;
      const never = !(activeMember && pendingWs.length > 0);
      rounds.push({ i, forced, queued, accept: said(accRes), invite: said(invRes), activeMember, pendingWs: pendingWs.length, ok: first.res.status === 201 && never && (acceptedFirst || invitedFirst) && (!forced || acceptedFirst) });
    }
    check('C7.invite-accept', rounds.every((r) => r.ok), JSON.stringify(rounds));
  });

  // ════════════════════════════════════════════════════════════════════════════
  // C8 one gate
  // ════════════════════════════════════════════════════════════════════════════
  await section('C8 one gate', async () => {
    const usersRouter = require('../../../src/routes/users');
    const layersFor = (routePath) => usersRouter.stack.filter((layer) => layer.route && layer.route.path === routePath && layer.route.methods?.post);
    const root = layersFor('/');
    const inv = layersFor('/invitations');
    const rootHandles = root.length === 1 ? root[0].route.stack.map((s) => s.handle) : [];
    const invHandles = inv.length === 1 ? inv[0].route.stack.map((s) => s.handle) : [];
    const same = rootHandles.length > 0 && rootHandles.length === invHandles.length && rootHandles.every((fn, i) => fn === invHandles[i]);
    check('C8.routes', root.length === 1 && inv.length === 1 && same, `POST / layers ${root.length} (${rootHandles.length} handlers), POST /invitations layers ${inv.length} (${invHandles.length} handlers), same ${same}`);

    const npm = api.as(NPM.email);
    const NB = mail('newbaseline', A.domain);
    const baseline = await invite(npm, '/users/invitations', { email: NB, role: 'qs' }, { label: 'C8 baseline', token: false });
    if (baseline.id) keep('C8 baseline revoke', await aPm.send('DELETE', `/users/invitations/${baseline.id}`));
    const NI = mail('newinjected', A.domain);
    const refused = [];
    try {
      userManagement.transitions['user.invite'] = [];
      for (const door of DOORS) refused.push({ door, res: keep(`C8 injected ${door}`, await npm.send('POST', door, { email: NI, role: 'qs' })) });
    } finally {
      userManagement.transitions['user.invite'] = [...inviteRolesBefore];
    }
    const niRows = (await one('select count(*)::int as n from "InvitationToken" where email = $1', [NI])).n;
    check('C8.policy', baseline.res.status === 201 && (userManagement.actions.create || []).includes('pm') && refused.length === 2 && refused.every(({ res }) => said(res) === '403 FORBIDDEN') && niRows === 0,
      `baseline ${said(baseline.res)}; create grants pm ${(userManagement.actions.create || []).includes('pm')}; ${refused.map(({ door, res }) => `${door}: ${said(res)}`).join(' | ')}; rows ${niRows}`);
  });

  const unexpected = answers.filter((a) => a.status >= 500 && !(a.allowed5xx && a.code === a.allowed5xx));
  check('G.5xx', unexpected.length === 0, unexpected.map((a) => `${a.label} ${a.status} ${a.code || ''}`).join(', '));

};

const run = async () => {
  const started = new Date();
  let scriptError = null;
  let cleanupNotes = [];
  try {
    await main();
  } catch (error) {
    scriptError = error;
    console.error(`SCRIPT ERROR: ${error.stack || error.message}`);
  } finally {
    // Restore what the run changed in process, whatever happened, then remove its fixtures.
    for (const name of ['EMAIL_PROVIDER', 'EMAIL_WEBHOOK_URL', 'AUTH_MEMBERSHIP_WRITE']) {
      if (ENV_AT_START[name] === undefined) delete process.env[name];
      else process.env[name] = ENV_AT_START[name];
    }
    try { ctx.restorePolicy?.(); } catch { /* nothing to restore */ }
    if (ctx.cleanup) {
      try { cleanupNotes = await ctx.cleanup(); } catch (error) { cleanupNotes.push(`cleanup: ${error.message}`); }
    }
  }
  for (const [id, name] of PLAN) {
    if (!recorded.has(id)) {
      recorded.set(id, { id, name, ok: false, detail: 'not run' });
      console.log(`FAIL  ${id}  ${name}\n        not run`);
    }
  }
  const list = PLAN.map(([id]) => recorded.get(id));
  const failed = list.filter((r) => !r.ok).length;
  console.log(`\ncleanup: ${cleanupNotes.join('; ') || 'nothing'}`);
  console.log(`${NAME}: ${list.length - failed} passed, ${failed} failed of ${EXPECTED_CHECKS} (fixed)`);
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULT_DIR, `${NAME}.json`), JSON.stringify({
    proof: NAME,
    stamp: STAMP,
    startedAt: started.toISOString(),
    finishedAt: new Date().toISOString(),
    total: EXPECTED_CHECKS,
    passed: list.length - failed,
    failed,
    scriptError: scriptError ? String(scriptError.message) : null,
    cleanup: cleanupNotes,
    checks: list,
  }, null, 1));
  try { await ctx.lockDb?.end(); } catch { /* closed */ }
  try { await ctx.db?.end(); } catch { /* closed */ }
  try { await hooked.$disconnect(); } catch { /* closed */ }
  process.exit(failed || scriptError ? 2 : 0);
};

run();
