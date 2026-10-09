'use strict';

/**
 * D-ID-1 proof P2 (CERT-3 plan §2.8): sessions, credentials and the switch.
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/d-id-1-sessions-proof.js [A=052] [B=025] [C=026]
 *
 * In process (CERT_INPROCESS=1) on the certification database, through the
 * lock runner only. Throwaway people of a fresh stamp, made the one way the
 * product allows (invitation, then acceptance). Checks:
 *
 *   C4  No admin password path: the old reset route is gone for every persona
 *       role; the reset-e-mail route answers 202 {sent:true} for a present
 *       member, the identical 404 for a foreign id and a random UUID, trips its
 *       per-target limiter and is audited with the actor; PATCH with `email` is
 *       refused for every kind of target and changes nothing; the identity
 *       fingerprint of everyone touched is unchanged; the admin MFA reset is
 *       refused while the person is suspended elsewhere, and when the person is
 *       part of no other workspace it clears the factor, moves the credential
 *       epoch and ends the refresh sessions.
 *   C11 No enumeration: login and reset-request answers are identical for
 *       unknown, existing and closed addresses, and the medians of N timed
 *       requests differ by less than the bounds printed up front.
 *   C12 A reset ends sessions: the pre-reset access, identity and refresh
 *       tokens are dead everywhere (REST, workspace switch, refresh, acceptance
 *       proof, socket handshake); a fresh sign-in works; deactivation and
 *       reactivation inside the refresh lifetime do not revive a refresh token.
 *       Round 2 (Codex diff review findings 1, 2 and the LOW on MFA challenges):
 *       C12.9-C12.13 old credentials racing a reset — a workspace session from
 *       the old access token, a sign-in with the old password, an MFA
 *       completion with a pre-reset challenge and an acceptance with the old
 *       bearer, each started while a reset's User-row update is held
 *       uncommitted on a second connection (released once pg_locks shows the
 *       request waiting), and the workspace session once more with a real reset
 *       completed between the route's token check and issuance: 401
 *       SESSION_REVOKED, no refresh session written, no live token returned;
 *       C12.14 a pre-reset MFA challenge is void; C12.15-C12.17 live sockets on
 *       an in-process server (socket.io attached as src/index.js does) are
 *       dropped by a self-service reset and by an admin MFA reset, and a socket
 *       whose epoch moved under it is refused project:join and dropped.
 *       Round 3 (Codex diff review round 2: items 1, 2, R1, N2, R3):
 *       C12.18 a brand-new identity's acceptance whose epoch moves between the
 *       acceptance's commit and the session issue gets no session (held at a
 *       wrapped prisma.$transaction: acceptInvitation calls the module-local
 *       issueWorkspaceSession); C12.19 a socket handshake parked after reading
 *       the account while a reset completes ends disconnected and hears nothing;
 *       C12.20-C12.21 concurrent sign-ins and workspace sessions of one person,
 *       lined up behind a held row lock, all succeed (no deadlock); C12.22-C12.24
 *       self-service MFA enable, disable and setup that wait behind a held
 *       credential event answer 401 SESSION_REVOKED and write nothing; C12.25
 *       the admin MFA reset answers and drops sockets without waiting for a slow
 *       mail provider.
 *   C15 The emergency switch (AUTH_MEMBERSHIP_WRITE=false, in process): every
 *       access-expanding operation answers 503 MEMBERSHIP_WRITES_SUSPENDED and
 *       writes nothing; every narrowing still works.
 *   C18 Mail and link hygiene: one-time invitation and reset tokens, expiry at
 *       the claim, links on WEB_APP_URL, no raw token in the production-format
 *       request log or the audit rows, the production preflight's e-mail and
 *       registration refusals, and registration closed outside dev/test (also
 *       with PUBLIC_REGISTRATION=true, finding 12; open in development and test
 *       unless PUBLIC_REGISTRATION=false).
 *
 * Exit 0 when every check holds, 2 otherwise (1 on a script error).
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

// Before anything loads the application: the production-format request log
// (C18), and the certification database for every product module this proof
// requires directly (config/db reads DATABASE_URL when it first connects).
process.env.REQUEST_LOG_FORMAT = 'json';
const guard = require('../lib/cert-env');
process.env.DATABASE_URL = guard.certDatabaseUrl();

// The request log is captured, not printed: one JSON line per request.
const requestLines = [];
const realStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => {
  const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  if (text.startsWith('{"ts":') && text.includes('"msg":"request"')) {
    requestLines.push(text);
    return true;
  }
  return realStdoutWrite(chunk, ...rest);
};

const crypto = require('crypto');
const fs = require('fs');
const api = require('../lib/api');
const invitations = require('../lib/invitations');
const { buildPopulation, PERSONAS } = require('../lib/spec');
const fingerprint = require('../isolation/fingerprint');
const { totp } = require('../../../src/utils/totp');

invitations.captureMail({ quiet: true });

const A_CODE = process.argv[2] || '052';
const B_CODE = process.argv[3] || '025';
const C_CODE = process.argv[4] || '026';
const STATE_DIR = process.env.CERT_STATE_DIR || 'C:/Temp/octapm-cert/state';
const RESULTS = 'C:/Temp/octapm-cert/results/cert3/d-id-1-sessions.json';
const STAMP = crypto.randomBytes(3).toString('hex');
const PASSWORD = process.env.CERT_PASSWORD;
const NEW_PASSWORD = `Reset-${STAMP}-pass9`;
const WEB_APP_URL = String(process.env.WEB_APP_URL || process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || 'http://localhost:5173').replace(/\/$/, '');
const TIMING_N = 25;
const TIMING_WARMUP = 3;
const LOGIN_BOUND_MS = 60;
const RESET_BOUND_MS = 40;
/**
 * Fixed before the first run: setup 1, C4 11, C11 4, C12 9, C15 11, C18 8, final 2 (46).
 * Round 2 adds setup (round 2) 1, C12.9-C12.17 9 and C18.9 1: setup 2, C4 11,
 * C11 4, C12 18, C15 11, C18 9, final 2.
 * Round 3 adds setup (round 3) 1 and C12.18-C12.25 8: setup 3, C4 11, C11 4,
 * C12 26, C15 11, C18 9, final 2.
 * The final mutation run adds C12.7b (the resolve route, M17): C12 27.
 */
const EXPECTED_CHECKS = 67;

const results = [];
const answers = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail: ok ? '' : String(detail).slice(0, 2000) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n        ${detail}` : ''}`);
};
const said = (res) => (res ? `${res.status} ${res.body?.error?.code || ''}`.trim() : 'no answer');
const keep = (label, res) => {
  if (res) answers.push({ label, status: res.status });
  return res;
};

// "Identical": the same status, code, message and set of body keys, and the
// same values except id, email, createdAt, expiresAt — and the per-request
// requestId the error envelope carries.
const IGNORED_VALUES = new Set(['id', 'email', 'createdAt', 'expiresAt', 'requestId']);
const flatten = (value, prefix, keys, leaves) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      const at = prefix ? `${prefix}.${k}` : k;
      keys.push(at);
      if (IGNORED_VALUES.has(k)) continue;
      flatten(v, at, keys, leaves);
    }
    return;
  }
  leaves.push(`${prefix}=${JSON.stringify(value)}`);
};
const shapeOf = (res) => {
  const keys = [];
  const leaves = [];
  flatten(res?.body ?? null, '', keys, leaves);
  return JSON.stringify({ status: res?.status, code: res?.body?.error?.code ?? null, message: res?.body?.error?.message ?? null, keys: keys.sort(), leaves: leaves.sort() });
};
const identical = (list) => list.every(Boolean) && new Set(list.map(shapeOf)).size === 1;
const median = (values) => {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const timed = async (fn) => {
  const started = process.hrtime.bigint();
  const res = await fn();
  return { res, ms: Number(process.hrtime.bigint() - started) / 1e6 };
};
const TOKEN_IN_LINK = /token=([A-Za-z0-9_\-.~%]+)/g;
const linkIn = (text, route) => {
  const match = new RegExp(`(https?://[^\\s"'<>]+/${route}\\?token=([A-Za-z0-9_\\-.~%]+))`).exec(text || '');
  return match ? { url: match[1], token: decodeURIComponent(match[2]) } : null;
};

const cleanup = [];
let dbRef = null;
// The second connection that holds a reset's User-row update uncommitted (round 2).
const lockState = { db: null, open: false };

const main = async () => {
  if (!PASSWORD) throw new Error('CERT_PASSWORD is not set');
  if (process.env.CERT_INPROCESS !== '1') throw new Error('run through C:\\Temp\\octapm-cert\\run-locked.js (CERT_INPROCESS=1)');
  const { companies } = buildPopulation();
  const [A, B, C] = [A_CODE, B_CODE, C_CODE].map((code) => companies.find((c) => c.code === code));
  const db = await guard.connectCert();
  dbRef = db;
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const orgOf = async (code) => (await q('select id, name from "Organisation" where slug like $1', [`cert-${code}-%`]))[0];
  const [orgA, orgB, orgC] = [await orgOf(A_CODE), await orgOf(B_CODE), await orgOf(C_CODE)];
  const aPm = api.as(`pm@${A.domain}`);
  const bPm = api.as(`pm@${B.domain}`);
  const cPm = api.as(`pm@${C.domain}`);
  const aOwnerEmail = A.people.find((p) => p.isOwner)?.email;
  const aOwner = api.as(aOwnerEmail);
  const aPmId = (await q('select id from "User" where email = $1', [`pm@${A.domain}`]))[0]?.id;
  const projectA = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'inventory', `${A.code}.json`), 'utf8')).projects[`${A.code}-01`].id;
  const auditMark = (await q('select coalesce(max("createdAt"), \'epoch\'::timestamp) as t from "AuthAuditEvent"'))[0].t;
  console.log(`d-id-1 sessions proof: A ${A_CODE} (owner ${aOwnerEmail}), B ${B_CODE}, C ${C_CODE}; project ${projectA}; stamp ${STAMP}, in process`);
  console.log(`timing bounds (fixed before measuring): login median difference < ${LOGIN_BOUND_MS} ms, reset-request median difference < ${RESET_BOUND_MS} ms; N=${TIMING_N} per class after ${TIMING_WARMUP} warm-up each\n`);

  const allEmails = new Set();
  const rawTokens = new Set();
  const membershipIn = async (orgId, userId) => (await q('select role, status, kind, "isAdmin", "isOwner" from "OrganizationMembership" where "orgId" = $1 and "userId" = $2', [orgId, userId]))[0] || null;
  const userRow = async (id) => (await q('select id, email, name, phone, status, "passwordHash", "mfaEnabled", "mfaSecretEnc", "ssoSubject", "credentialEpoch" from "User" where id = $1', [id]))[0] || null;
  const make = async (label, { inviter = aPm, domain = A.domain, role = 'qs', projectId = null, projectPartyId = null } = {}) => {
    const email = `did1s.${label}.${STAMP}@${domain}`;
    allEmails.add(email);
    const made = await invitations.createByInvitation({ inviter, email, role, name: `DID1 ${label} ${STAMP}`, projectId, projectPartyId, db });
    keep(`make ${label} invite`, made.invited);
    keep(`make ${label} accept`, made.accepted);
    if (made.token) rawTokens.add(made.token);
    return { label, email, id: made.userId, made };
  };
  const invite = async (email, offer = {}, inviter = aPm) => {
    allEmails.add(email);
    const before = invitations.mailsTo(email).length;
    const res = keep(`invite ${email}`, await inviter.send('POST', '/users/invitations', { email, role: 'qs', ...offer }));
    const token = res.status === 201 ? await invitations.invitationTokenFor({ email, invitationId: res.body?.data?.id, after: before, db }) : null;
    if (token) rawTokens.add(token);
    return { res, id: res.body?.data?.id || null, token };
  };
  const accept = (token, { bearer = null, name = 'DID1 Invitee', password = undefined } = {}) =>
    api.raw('POST', '/auth/invitations/accept', { token: bearer, json: { token, name, ...(password ? { password } : {}) } });

  // ── set-up ────────────────────────────────────────────────────────────────
  console.log('── set-up ──');
  const party = keep('create party', await aPm.send('POST', `/projects/${projectA}/parties`, { role: 'subcontractor', companyName: `DID1 Party ${STAMP}` }));
  const partyId = party.body?.data?.id || null;
  if (partyId) cleanup.push(async () => `party ${partyId} removed: ${said(await aPm.send('DELETE', `/projects/${projectA}/parties/${partyId}`))}`);
  const R1 = await make('active');
  const R2 = await make('closed');
  const G = await make('guest', { role: 'site_engineer', projectId: projectA, projectPartyId: partyId });
  const F = await make('foreign', { inviter: bPm, domain: B.domain });
  const fJoin = await invitations.joinByInvitation({ inviter: aPm, email: F.email, role: 'qs', name: 'x', homeOrgId: orgB.id, db });
  const Y = await make('elsewhere', { inviter: bPm, domain: B.domain });
  const P = await make('mfa');
  const pJoin = await invitations.joinByInvitation({ inviter: cPm, email: P.email, role: 'qs', name: 'x', homeOrgId: orgA.id, db });
  const S12 = await make('reset');
  const sJoin = await invitations.joinByInvitation({ inviter: bPm, email: S12.email, role: 'planning_eng', name: 'x', homeOrgId: orgA.id, db });
  const X1 = await make('switch-deactivate');
  const X2 = await make('switch-activate');
  const X3 = await make('switch-grant');
  const X4 = await make('switch-team');
  const X5 = await make('switch-admin');
  for (const j of [fJoin, pJoin, sJoin]) if (j.token) rawTokens.add(j.token);
  const r2Closed = keep('close R2', await aPm.send('PATCH', `/users/${R2.id}/deactivate`, {}));
  const x2Closed = keep('suspend X2', await aPm.send('PATCH', `/users/${X2.id}/deactivate`, {}));
  const x4Team = keep('team X4', await aPm.send('POST', `/projects/${projectA}/team`, { userId: X4.id }));
  const x5Admin = keep('grant X5', await aOwner.send('PATCH', `/users/${X5.id}`, { isCompanyAdmin: true }));
  // P: homed in A, member of C, MFA on, a live A session, then suspended by C.
  const pToken = await api.tokenFor(P.email, orgA.id);
  const pSetup = keep('P mfa setup', await api.raw('POST', '/auth/mfa/setup', { token: pToken, json: {} }));
  const pEnable = keep('P mfa enable', await api.raw('POST', '/auth/mfa/enable', { token: pToken, json: { code: totp(pSetup.body?.data?.secret || '') } }));
  api.forget(P.email);
  const pSuspendedInC = keep('C suspends P', await cPm.send('PATCH', `/users/${P.id}/deactivate`, {}));
  const people = [R1, R2, G, F, Y, P, S12, X1, X2, X3, X4, X5];
  const setupState = {
    ids: people.every((p) => p.id),
    party: party.status === 201,
    joins: [fJoin, pJoin, sJoin].map((j) => said(j.accepted)),
    r2: (await userRow(R2.id))?.status,
    x2: (await membershipIn(orgA.id, X2.id))?.status,
    x4: x4Team.status,
    x5: (await membershipIn(orgA.id, X5.id))?.isAdmin,
    guest: (await membershipIn(orgA.id, G.id))?.kind,
    fHome: (await userRow(F.id)) && (await q('select "orgId" from "User" where id = $1', [F.id]))[0]?.orgId === orgB.id,
    pMfa: Boolean((await userRow(P.id))?.mfaEnabled),
    pInC: (await membershipIn(orgC.id, P.id))?.status,
    pInA: (await membershipIn(orgA.id, P.id))?.status,
  };
  check('setup: throwaways made by invitation and acceptance (A members, an A party guest, a B identity in A, a B-only identity, P in A+C with MFA and suspended by C, S12 in A+B); R2 closed, X2 suspended, X4 on the team, X5 an administrator',
    setupState.ids && setupState.party && setupState.joins.every((s) => s === '200') && setupState.r2 === 'inactive' && setupState.x2 === 'suspended' && [200, 201].includes(setupState.x4) && setupState.x5 === true && setupState.guest === 'guest' && setupState.fHome && setupState.pMfa && setupState.pInC === 'suspended' && setupState.pInA === 'active' && r2Closed.status === 200 && x2Closed.status === 200 && x5Admin.status === 200 && pEnable.status === 200 && pSuspendedInC.status === 200,
    JSON.stringify({ ...setupState, ids: people.map((p) => `${p.label}:${Boolean(p.id)}`).join(','), r2Closed: said(r2Closed), x2Closed: said(x2Closed), x5Admin: said(x5Admin), pEnable: said(pEnable), pSuspendedInC: said(pSuspendedInC) }));
  if (!results.every((r) => r.ok)) throw new Error('setup incomplete');
  const printBefore = await fingerprint.take(db);

  // ── C4 No admin password path ─────────────────────────────────────────────
  console.log('\n── C4 no admin password path ──');
  const personaEmails = PERSONAS.map((p) => `${p.key}@${A.domain}`);
  const personaIds = (await q('select id from "User" where email = any($1::text[])', [personaEmails])).map((r) => r.id);
  const touched = [R1, R2, G, F, Y].map((p) => p.id).concat(personaIds);
  const identityPrint = async () => JSON.stringify(await q('select id, email, "passwordHash", "mfaEnabled", "mfaSecretEnc", "ssoSubject", status from "User" where id = any($1::text[]) order by id', [touched]));
  const identityBefore = await identityPrint();

  const oldRoute = [];
  for (const email of personaEmails) {
    oldRoute.push([email.split('@')[0], keep(`old reset ${email}`, await api.as(email).send('POST', `/users/${R1.id}/reset-password`, { password: 'Admin-Chosen-Passw0rd1' }))]);
  }
  check(`C4.1 the old admin reset route POST /users/:id/reset-password is gone: every persona role of ${A_CODE} (${oldRoute.length}) gets 404 NOT_FOUND`,
    oldRoute.length === PERSONAS.length && oldRoute.every(([, r]) => said(r) === '404 NOT_FOUND'),
    oldRoute.map(([k, r]) => `${k} ${said(r)}`).join(' | '));
  const usersRouter = require('../../../src/routes/users');
  const layers = usersRouter.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods).join(',').toUpperCase()} ${l.route.path}`);
  check('C4.2 route inventory: the users router has no /:id/reset-password layer, and has POST /:id/password-reset-email',
    !layers.some((l) => /\/:id\/reset-password$/.test(l)) && layers.includes('POST /:id/password-reset-email'),
    layers.join(' | '));

  const resetEmail = (id) => aPm.send('POST', `/users/${id}/password-reset-email`, {});
  const rActive = keep('reset-email R1 #1', await resetEmail(R1.id));
  check('C4.3 reset e-mail for an active member of A: 202 { sent: true }, nothing else (no token, no URL)',
    rActive.status === 202 && JSON.stringify(rActive.body?.data) === '{"sent":true}' && !/token|https?:|reset-password/i.test(rActive.text || ''),
    `${said(rActive)} ${rActive.text}`);
  const rSuspended = keep('reset-email R2', await resetEmail(R2.id));
  check('C4.4 reset e-mail for a suspended member of A (closed identity): the identical 202 { sent: true }',
    identical([rActive, rSuspended]), `${said(rSuspended)} ${rSuspended.text}`);
  const rForeign = keep('reset-email Y', await resetEmail(Y.id));
  const rRandom = keep('reset-email random', await resetEmail(crypto.randomUUID()));
  check('C4.5 reset e-mail for a person of another company and for a random UUID: the identical 404 USER_NOT_FOUND',
    said(rForeign) === '404 USER_NOT_FOUND' && identical([rForeign, rRandom]), `${said(rForeign)} ${rForeign.text} | ${said(rRandom)} ${rRandom.text}`);
  const rMore = [keep('reset-email R1 #2', await resetEmail(R1.id)), keep('reset-email R1 #3', await resetEmail(R1.id)), keep('reset-email R1 #4', await resetEmail(R1.id))];
  check('C4.6 the per-target limiter trips: requests 2 and 3 for one person answer 202, the 4th 429 RATE_LIMITED (default maximum 3)',
    rMore[0].status === 202 && rMore[1].status === 202 && said(rMore[2]) === '429 RATE_LIMITED', rMore.map(said).join(' | '));
  const resetAudit = await q('select "userId", "actorId", "orgId" from "AuthAuditEvent" where action = \'password_reset_email_requested_by_admin\' and "userId" = any($1::text[])', [[R1.id, R2.id, Y.id]]);
  const r1Audit = resetAudit.filter((r) => r.userId === R1.id);
  check('C4.7 audit: password_reset_email_requested_by_admin carries the actor and the org (3 for R1, 1 for R2, none for the refused ones)',
    r1Audit.length === 3 && resetAudit.filter((r) => r.userId === R2.id).length === 1 && !resetAudit.some((r) => r.userId === Y.id) && resetAudit.every((r) => r.actorId === aPmId && r.orgId === orgA.id),
    JSON.stringify(resetAudit));

  const standing = async (p) => JSON.stringify({ u: await q('select email, name, phone, status from "User" where id = $1', [p.id]), m: await q('select "orgId", role, status, kind, "isAdmin", "isOwner" from "OrganizationMembership" where "userId" = $1 order by "orgId"', [p.id]) });
  const patchTargets = [['home sole-membership', R1], ['home guest', G], ['foreign member', F]];
  const standingBefore = [];
  for (const [, p] of patchTargets) standingBefore.push(await standing(p));
  const patches = [];
  for (const [label, p] of patchTargets) {
    patches.push([`${label} unchanged`, keep(`PATCH email ${label}`, await aPm.send('PATCH', `/users/${p.id}`, { email: p.email }))]);
    patches.push([`${label} changed`, keep(`PATCH email changed ${label}`, await aPm.send('PATCH', `/users/${p.id}`, { email: `did1s.moved.${p.label}.${STAMP}@${A.domain}` }))]);
  }
  const standingAfter = [];
  for (const [, p] of patchTargets) standingAfter.push(await standing(p));
  check('C4.8 PATCH /users/:id with email (unchanged and changed) is refused 400 USER_EMAIL_IDENTITY_OWNED, identically, for a home sole-membership person, a home guest and a foreign member; nothing changes',
    patches.every(([, r]) => said(r) === '400 USER_EMAIL_IDENTITY_OWNED') && identical(patches.map(([, r]) => r)) && standingAfter.every((s, i) => s === standingBefore[i]),
    `${patches.map(([l, r]) => `${l} ${said(r)}`).join(' | ')}; unchanged ${standingAfter.map((s, i) => s === standingBefore[i]).join(',')}`);
  check('C4.9 identity fingerprint (email, passwordHash, mfaEnabled, mfaSecretEnc, ssoSubject, status) unchanged for every person touched (the targets and the persona callers)',
    (await identityPrint()) === identityBefore, 'the identity rows changed');

  const pBefore = await userRow(P.id);
  const sharedReset = keep('MFA reset P (suspended in C)', await aPm.send('POST', `/company/security/users/${P.id}/mfa/reset`, {}));
  const pAfterRefusal = await userRow(P.id);
  check('C4.10 admin MFA reset of a person homed in A who is only suspended in C: 403 IDENTITY_SHARED; the factor and the epoch stay',
    said(sharedReset) === '403 IDENTITY_SHARED' && pAfterRefusal.mfaEnabled === true && pAfterRefusal.mfaSecretEnc === pBefore.mfaSecretEnc && pAfterRefusal.credentialEpoch === pBefore.credentialEpoch,
    `${said(sharedReset)}; mfa ${pAfterRefusal.mfaEnabled}; secret same ${pAfterRefusal.mfaSecretEnc === pBefore.mfaSecretEnc}; epoch ${pBefore.credentialEpoch} -> ${pAfterRefusal.credentialEpoch}`);
  // Guarded fixture: P's membership in C ends (LEFT) — leaving has no route.
  await db.query('update "OrganizationMembership" set status = \'left\', "leftAt" = now() where "orgId" = $1 and "userId" = $2', [orgC.id, P.id]);
  cleanup.push(async () => `P's LEFT fixture in C restored to suspended: ${(await db.query('update "OrganizationMembership" set status = \'suspended\', "leftAt" = null where "orgId" = $1 and "userId" = $2 and status = \'left\'', [orgC.id, P.id])).rowCount} row`);
  const liveBefore = (await q('select count(*)::int as n from "RefreshSession" where "userId" = $1 and "revokedAt" is null', [P.id]))[0].n;
  const soleReset = keep('MFA reset P (A only)', await aPm.send('POST', `/company/security/users/${P.id}/mfa/reset`, {}));
  const pAfterReset = await userRow(P.id);
  const liveAfter = (await q('select count(*)::int as n from "RefreshSession" where "userId" = $1 and "revokedAt" is null', [P.id]))[0].n;
  check('C4.11 when the person is part of no other workspace the admin MFA reset succeeds: factor cleared, credentialEpoch +1, every refresh session revoked',
    soleReset.status === 200 && soleReset.body?.data?.reset === true && pAfterReset.mfaEnabled === false && pAfterReset.mfaSecretEnc === null && pAfterReset.credentialEpoch === pBefore.credentialEpoch + 1 && liveBefore > 0 && liveAfter === 0,
    `${said(soleReset)}; mfa ${pAfterReset.mfaEnabled}; epoch ${pBefore.credentialEpoch} -> ${pAfterReset.credentialEpoch}; live sessions ${liveBefore} -> ${liveAfter}`);

  // ── C11 No enumeration ────────────────────────────────────────────────────
  console.log('\n── C11 no enumeration ──');
  const abuse = require('../../../src/services/auth-abuse.service');
  const authService = require('../../../src/services/auth.service');
  const unknownEmail = `did1s.nobody.${STAMP}@${A.domain}`;
  allEmails.add(unknownEmail);
  const login = (email, password) => {
    abuse.resetAuthAbuseState();
    return api.raw('POST', '/auth/login', { json: { email, password } });
  };
  const wrong = `Wrong-${STAMP}-pass1`;
  const lUnknown = keep('login unknown', await login(unknownEmail, wrong));
  const lExisting = keep('login existing wrong', await login(R1.email, wrong));
  const lClosed = keep('login closed wrong', await login(R2.email, wrong));
  check('C11.1 sign-in: an unknown e-mail, an existing one with a wrong password and a closed one with a wrong password get the identical 401 INVALID_CREDENTIALS',
    said(lUnknown) === '401 INVALID_CREDENTIALS' && identical([lUnknown, lExisting, lClosed]), [lUnknown, lExisting, lClosed].map((r) => `${said(r)} ${r.body?.error?.message}`).join(' | '));
  const forgot = (email) => api.raw('POST', '/auth/forgot-password', { json: { email } });
  const fUnknown = keep('forgot unknown', await forgot(unknownEmail));
  const fActive = keep('forgot active', await forgot(R1.email));
  const fClosed = keep('forgot closed', await forgot(R2.email));
  check('C11.2 reset request: unknown, active and closed e-mails get the identical 200 { sent: true }',
    fUnknown.status === 200 && JSON.stringify(fUnknown.body?.data) === '{"sent":true}' && identical([fUnknown, fActive, fClosed]), [fUnknown, fActive, fClosed].map((r) => `${said(r)} ${r.text}`).join(' | '));

  const timeClasses = async (label, unknownFn, existingFn) => {
    for (let i = 0; i < TIMING_WARMUP; i += 1) {
      keep(`${label} warm-up unknown`, await unknownFn());
      keep(`${label} warm-up existing`, await existingFn());
    }
    const u = [];
    const e = [];
    const statuses = new Set();
    for (let i = 0; i < TIMING_N; i += 1) {
      // Interleaved, alternating which class goes first.
      const order = i % 2 ? [['e', existingFn], ['u', unknownFn]] : [['u', unknownFn], ['e', existingFn]];
      for (const [cls, fn] of order) {
        const { res, ms } = await timed(fn);
        keep(`${label} ${cls}`, res);
        statuses.add(said(res));
        (cls === 'u' ? u : e).push(ms);
      }
    }
    return { unknown: median(u), existing: median(e), statuses: [...statuses] };
  };
  const loginTiming = await timeClasses('login', () => login(unknownEmail, wrong), () => login(R1.email, wrong));
  abuse.resetAuthAbuseState();
  const loginDiff = Math.abs(loginTiming.unknown - loginTiming.existing);
  console.log(`        login medians: unknown ${loginTiming.unknown.toFixed(1)} ms, existing ${loginTiming.existing.toFixed(1)} ms, difference ${loginDiff.toFixed(1)} ms (bound ${LOGIN_BOUND_MS})`);
  check(`C11.3 sign-in timing: the medians for an unknown and an existing e-mail differ by less than ${LOGIN_BOUND_MS} ms (and every answer is 401 INVALID_CREDENTIALS)`,
    loginDiff < LOGIN_BOUND_MS && loginTiming.statuses.length === 1 && loginTiming.statuses[0] === '401 INVALID_CREDENTIALS',
    `unknown ${loginTiming.unknown.toFixed(1)} ms, existing ${loginTiming.existing.toFixed(1)} ms, difference ${loginDiff.toFixed(1)} ms; answers ${loginTiming.statuses.join(',')}`);
  const resetTiming = await timeClasses('forgot', () => forgot(unknownEmail), () => forgot(R1.email));
  await authService.flushPasswordResetDeliveries();
  const resetDiff = Math.abs(resetTiming.unknown - resetTiming.existing);
  console.log(`        reset-request medians: unknown ${resetTiming.unknown.toFixed(1)} ms, existing ${resetTiming.existing.toFixed(1)} ms, difference ${resetDiff.toFixed(1)} ms (bound ${RESET_BOUND_MS})`);
  check(`C11.4 reset-request timing: the medians for an unknown and an existing e-mail differ by less than ${RESET_BOUND_MS} ms (and every answer is 200)`,
    resetDiff < RESET_BOUND_MS && resetTiming.statuses.length === 1 && resetTiming.statuses[0] === '200',
    `unknown ${resetTiming.unknown.toFixed(1)} ms, existing ${resetTiming.existing.toFixed(1)} ms, difference ${resetDiff.toFixed(1)} ms; answers ${resetTiming.statuses.join(',')}`);

  // ── C12 A reset ends sessions ─────────────────────────────────────────────
  console.log('\n── C12 a reset ends sessions ──');
  const mobile = { 'x-octapm-client': 'mobile' };
  const old = await api.signIn(S12.email, orgA.id, { client: 'mobile' });
  [old.token, old.identityToken, old.refreshToken].filter(Boolean).forEach((t) => rawTokens.add(t));
  const meBefore = keep('S12 me before', await api.raw('GET', '/auth/me', { token: old.token }));
  check('C12.0 S12 (A and B) holds an access token, an identity token and a mobile refresh token, and the access token works',
    Boolean(old.token && old.identityToken && old.refreshToken) && meBefore.status === 200,
    `access ${Boolean(old.token)}, identity ${Boolean(old.identityToken)}, refresh ${Boolean(old.refreshToken)}; me ${said(meBefore)}`);
  const s12MailsBefore = invitations.mailsTo(S12.email).length;
  const s12Forgot = keep('S12 forgot', await forgot(S12.email));
  await authService.flushPasswordResetDeliveries();
  const resetMail = invitations.mailsTo(S12.email).slice(s12MailsBefore).reverse().map((m) => linkIn(m, 'reset-password')).find(Boolean);
  if (resetMail) rawTokens.add(resetMail.token);
  const s12Reset = keep('S12 reset', await api.raw('POST', '/auth/reset-password', { json: { token: resetMail?.token || 'x'.repeat(43), password: NEW_PASSWORD } }));
  check('C12.1 a self-service reset completes: request 200 { sent: true }, the link arrives by mail, POST /auth/reset-password 200 { reset: true }',
    s12Forgot.status === 200 && Boolean(resetMail) && s12Reset.status === 200 && s12Reset.body?.data?.reset === true,
    `forgot ${said(s12Forgot)}; link ${Boolean(resetMail)}; reset ${said(s12Reset)} ${s12Reset.text}`);
  const meOld = keep('old access me', await api.raw('GET', '/auth/me', { token: old.token }));
  const projectsOld = keep('old access projects', await api.raw('GET', '/projects', { token: old.token }));
  check('C12.2 the old access token gets 401 SESSION_REVOKED on /auth/me and on a module route (GET /projects)',
    said(meOld) === '401 SESSION_REVOKED' && said(projectsOld) === '401 SESSION_REVOKED', `${said(meOld)} | ${said(projectsOld)}`);
  const switchAccess = keep('old access switch B', await api.raw('POST', `/auth/workspaces/${orgB.id}/session`, { token: old.token, json: {}, headers: mobile }));
  const switchIdentity = keep('old identity switch B', await api.raw('POST', `/auth/workspaces/${orgB.id}/session`, { token: old.identityToken, json: {}, headers: mobile }));
  check('C12.3 POST /auth/workspaces/<B>/session with the old access token and with the old identity token: 401 SESSION_REVOKED each',
    said(switchAccess) === '401 SESSION_REVOKED' && said(switchIdentity) === '401 SESSION_REVOKED', `${said(switchAccess)} | ${said(switchIdentity)}`);
  const refreshOld = keep('old refresh', await api.raw('POST', '/auth/refresh', { json: { refreshToken: old.refreshToken }, headers: mobile }));
  check('C12.4 refreshing with the old refresh token: 401 (its session was revoked by the reset: REFRESH_TOKEN_REUSED, or SESSION_REVOKED)',
    refreshOld.status === 401 && ['REFRESH_TOKEN_REUSED', 'SESSION_REVOKED'].includes(refreshOld.body?.error?.code) && !refreshOld.body?.data, `${said(refreshOld)}`);
  const s12Invite = await invite(S12.email, { projectId: projectA });
  const proofOld = keep('old bearer as acceptance proof', await accept(s12Invite.token, { bearer: old.token }));
  const s12InviteRow = (await q('select status from "InvitationToken" where id = $1', [s12Invite.id]))[0];
  const s12Assigned = (await q('select count(*)::int as n from "ProjectAssignment" where "projectId" = $1 and "userId" = $2', [projectA, S12.id]))[0].n;
  check('C12.5 the old bearer as acceptance proof for a new invitation: 401 SESSION_REVOKED; the link stays pending, nothing assigned',
    s12Invite.res.status === 201 && said(proofOld) === '401 SESSION_REVOKED' && s12InviteRow?.status === 'pending' && s12Assigned === 0,
    `invite ${said(s12Invite.res)}; accept ${said(proofOld)}; link ${s12InviteRow?.status}; assigned ${s12Assigned}`);
  const socketModule = require('../../../src/realtime/socket');
  const handshake = (token) => new Promise((resolve) => {
    const socket = { handshake: { auth: { token }, headers: {} }, data: {} };
    socketModule.authenticateSocket(socket, (error) => resolve(error || null));
  });
  const sockOld = await handshake(old.token);
  // A fresh sign-in with the new password.
  abuse.resetAuthAbuseState();
  const oldPassword = keep('S12 old password', await api.raw('POST', '/auth/login', { json: { email: S12.email, password: PASSWORD } }));
  abuse.resetAuthAbuseState();
  const fresh = keep('S12 new password', await api.raw('POST', '/auth/login', { json: { email: S12.email, password: NEW_PASSWORD }, headers: mobile }));
  const freshA = keep('S12 new session A', await api.raw('POST', `/auth/workspaces/${orgA.id}/session`, { token: fresh.body?.data?.identityToken || '', json: {}, headers: mobile }));
  const newAccess = freshA.body?.data?.tokens?.accessToken || null;
  const newRefresh = freshA.body?.data?.tokens?.refreshToken || null;
  [newAccess, newRefresh, fresh.body?.data?.identityToken].filter(Boolean).forEach((t) => rawTokens.add(t));
  const sockNew = newAccess ? await handshake(newAccess) : new Error('no new token');
  check('C12.6 the socket handshake with the old token is refused SESSION_REVOKED (and a fresh token is accepted)',
    sockOld?.data?.code === 'SESSION_REVOKED' && sockNew === null, `old ${sockOld?.data?.code || sockOld?.message || 'accepted'}; new ${sockNew ? sockNew.data?.code || sockNew.message : 'accepted'}`);
  const meNew = keep('new access me', newAccess ? await api.raw('GET', '/auth/me', { token: newAccess }) : null);
  check('C12.7 a fresh sign-in with the new password works (identity token, A session, /auth/me 200); the old password gets 401 INVALID_CREDENTIALS',
    fresh.status === 200 && Boolean(fresh.body?.data?.identityToken) && freshA.status === 200 && Boolean(newRefresh) && meNew?.status === 200 && said(oldPassword) === '401 INVALID_CREDENTIALS',
    `login ${said(fresh)}; session ${said(freshA)}; me ${said(meNew)}; old password ${said(oldPassword)}`);
  // The resolve route reads the identity's memberships from any of its tokens,
  // so a pre-reset token is dead there too. Only subjectOfToken's own epoch
  // check refuses it here: the workspace-session route (C12.3) also refuses at
  // issuance, which hid a missing route check (mutation M17 survived).
  const resolvePath = `/auth/workspaces/resolve?projectId=${projectA}`;
  const resolveOld = keep('old access resolve', await api.raw('GET', resolvePath, { token: old.token }));
  const resolveOldIdentity = keep('old identity resolve', await api.raw('GET', resolvePath, { token: old.identityToken }));
  const resolveNew = keep('new access resolve', newAccess ? await api.raw('GET', resolvePath, { token: newAccess }) : null);
  check('C12.7b GET /auth/workspaces/resolve?projectId=<A project> with the old access token and with the old identity token: 401 SESSION_REVOKED each; with the fresh access token: 200 naming workspace A',
    said(resolveOld) === '401 SESSION_REVOKED' && said(resolveOldIdentity) === '401 SESSION_REVOKED' && resolveNew?.status === 200 && JSON.stringify(resolveNew.body?.data || {}).includes(orgA.id),
    `${said(resolveOld)} | ${said(resolveOldIdentity)} | fresh ${said(resolveNew)} ${resolveNew?.text || ''}`);
  const s12Deactivate = keep('A deactivates S12', await aPm.send('PATCH', `/users/${S12.id}/deactivate`, {}));
  const s12IdentityMid = (await userRow(S12.id))?.status;
  const s12Activate = keep('A activates S12', await aPm.send('PATCH', `/users/${S12.id}/activate`, {}));
  const s12Membership = await membershipIn(orgA.id, S12.id);
  const refreshAfter = keep('refresh after deactivate/activate', await api.raw('POST', '/auth/refresh', { json: { refreshToken: newRefresh || 'x'.repeat(40) }, headers: mobile }));
  check('C12.8 A deactivates S12 (the identity stays, B is active) and activates them again: the A refresh token from before is refused 401',
    s12Deactivate.status === 200 && s12IdentityMid === 'active' && s12Activate.status === 200 && s12Membership?.status === 'active' && refreshAfter.status === 401 && ['REFRESH_TOKEN_REUSED', 'SESSION_REVOKED', 'INVALID_REFRESH_TOKEN'].includes(refreshAfter.body?.error?.code),
    `deactivate ${said(s12Deactivate)} identity ${s12IdentityMid}; activate ${said(s12Activate)} membership ${s12Membership?.status}; refresh ${said(refreshAfter)}`);

  // ── C12 round 2: old credentials racing a reset; live sockets ─────────────
  // Codex diff review round 1: finding 1 (an overlapping request turned
  // pre-reset credentials into a post-reset session), finding 2 (connected
  // sockets survived a reset and an admin MFA reset) and the LOW on epoch-stale
  // MFA challenges. A reset in progress is emulated on a second connection: an
  // uncommitted UPDATE of the person's User row (credentialEpoch + 1 and a new
  // password hash — the row write POST /auth/reset-password makes) holds the
  // row lock that the product's epoch hold (SELECT … FOR NO KEY UPDATE since
  // the round-2 review's R1; FOR SHARE before) and every other
  // User write wait on. Each request is started while that lock is held; the
  // proof waits until pg_locks shows a backend waiting on the holder, then
  // commits. A request that is refused before reaching any wait is accepted
  // too (the path is printed); either way no refresh session may be written.
  // The window between the route's token check and issuance has no lock of
  // its own, so C12.10 holds the request there by wrapping the service export
  // the route calls (authService.issueWorkspaceSession, restored afterwards)
  // and completes a real reset meanwhile.
  console.log('\n── C12 round 2: old credentials racing a reset; live sockets ──');
  const ROUND2 = {
    setup: 'setup (round 2): throwaways W, WG, L, M, I, MB made by invitation and acceptance in A and K on project A; M and MB with MFA on; a second database connection ready to hold the row lock',
    ws: 'C12.9 race: POST /auth/workspaces/<A>/session with an access token from before a reset whose User-row update is in flight (held, then committed) gets 401 SESSION_REVOKED; no refresh session is written and no live token comes back',
    gate: 'C12.10 race: the same request, held after the route\'s token check and before issuance while a real self-service reset completes, gets 401 SESSION_REVOKED; no refresh session, no live token',
    login: 'C12.11 race: POST /auth/login with the pre-reset password while the reset\'s User-row update is in flight gets 401 SESSION_REVOKED (the password matched the row it read; the epoch hold refuses); no session; afterwards the old password gets 401 INVALID_CREDENTIALS and the new one signs in',
    mfa: 'C12.12 race: POST /auth/mfa/verify with a pre-reset challenge and a valid code while the reset\'s User-row update is in flight gets 401 SESSION_REVOKED; no session',
    accept: 'C12.13 race: POST /auth/invitations/accept with the pre-reset bearer while the reset\'s User-row update is in flight gets 401 SESSION_REVOKED; the link stays pending, nothing is assigned, no session',
    challenge: 'C12.14 an MFA challenge minted before a completed self-service reset gets 401 SESSION_REVOKED with a valid code and writes no session; the same code then completes a challenge minted after the reset (200)',
    sockReset: 'C12.15 sockets: a live socket that joined a project room is dropped when its person completes a self-service reset on the same server, and its token cannot connect again (SESSION_REVOKED)',
    sockJoin: 'C12.16 sockets: a connected socket whose identity\'s credential epoch moved under it (fixture) is refused project:join with SESSION_REVOKED and disconnected',
    sockMfa: 'C12.17 sockets: a company admin\'s MFA reset (POST /company/security/users/:id/mfa/reset, same server) drops the person\'s live socket, and its token cannot connect again (SESSION_REVOKED)',
  };
  const round2 = async () => {
    const seen = new Set();
    const check2 = (name, ok, detail) => {
      seen.add(name);
      check(name, ok, detail);
    };
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const within = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what}: no answer within ${ms} ms`)), ms).unref())]);
    const bcrypt = require('bcryptjs');
    const http = require('http');
    const { Server } = require('socket.io');
    const { io: socketClient } = require('socket.io-client');
    const realIssueWorkspaceSession = authService.issueWorkspaceSession;
    const clients = [];
    let server = null;
    let ioServer = null;
    let realtime = null;
    try {
      // ── set-up ──
      const RACE_PASSWORD = `Raced-${STAMP}-pass7`;
      const RACE_HASH = await bcrypt.hash(RACE_PASSWORD, 12);
      const W = await make('race-ws');
      const WG = await make('race-gate');
      const L = await make('race-login');
      const M = await make('race-mfa');
      const I = await make('race-accept');
      const MB = await make('mfa-before');
      const K = await make('socket', { projectId: projectA });
      const enableMfa = async (p) => {
        const token = await api.tokenFor(p.email, orgA.id);
        const setup = keep(`${p.label} mfa setup`, await api.raw('POST', '/auth/mfa/setup', { token, json: {} }));
        const secret = setup.body?.data?.secret || '';
        const enabled = keep(`${p.label} mfa enable`, await api.raw('POST', '/auth/mfa/enable', { token, json: { code: totp(secret) } }));
        api.forget(p.email);
        return { secret, ok: setup.status === 200 && enabled.status === 200, said: `${said(setup)}/${said(enabled)}` };
      };
      const mMfa = await enableMfa(M);
      const mbMfa = await enableMfa(MB);
      lockState.db = await guard.connectCert();
      const lockPid = (await lockState.db.query('select pg_backend_pid() as pid')).rows[0].pid;
      const kAssigned = (await q('select count(*)::int as n from "ProjectAssignment" where "projectId" = $1 and "userId" = $2', [projectA, K.id]))[0].n;
      const r2People = [W, WG, L, M, I, MB, K];
      const r2Mfa = [(await userRow(M.id))?.mfaEnabled, (await userRow(MB.id))?.mfaEnabled];
      check2(ROUND2.setup, r2People.every((p) => p.id) && mMfa.ok && mbMfa.ok && r2Mfa.every((v) => v === true) && kAssigned === 1 && Number.isInteger(lockPid),
        JSON.stringify({ ids: r2People.map((p) => `${p.label}:${Boolean(p.id)}`).join(','), mfa: [mMfa.said, mbMfa.said, ...r2Mfa], kAssigned, lockPid }));

      // ── the race machinery ──
      const sessionIds = async (userId) => (await q('select id from "RefreshSession" where "userId" = $1', [userId])).map((r) => r.id);
      const blockedOnLock = async () => q(
        `select l.pid, l.locktype, left(regexp_replace(coalesce(a.query, ''), '\\s+', ' ', 'g'), 160) as query
           from pg_locks l join pg_stat_activity a on a.pid = l.pid
          where not l.granted and $1::int = any(pg_blocking_pids(l.pid))`,
        [lockPid],
      );
      // Every token an answer carries is tried where it would be used; each must be refused 401.
      const tokensRefused = async (res) => {
        const d = res?.body?.data || {};
        const access = d.tokens?.accessToken || null;
        const refresh = d.tokens?.refreshToken || null;
        const identity = d.identityToken || null;
        [access, refresh, identity].filter(Boolean).forEach((t) => rawTokens.add(t));
        const tried = [];
        if (access) tried.push(['access', keep('returned access token', await api.raw('GET', '/auth/me', { token: access }))]);
        if (identity) tried.push(['identity', keep('returned identity token', await api.raw('POST', `/auth/workspaces/${orgA.id}/session`, { token: identity, json: {}, headers: mobile }))]);
        if (refresh) tried.push(['refresh', keep('returned refresh token', await api.raw('POST', '/auth/refresh', { json: { refreshToken: refresh }, headers: mobile }))]);
        return { ok: tried.every(([, r]) => r.status === 401), tried: tried.map(([k, r]) => `${k} ${said(r)}`) };
      };
      const raceAgainstReset = async (label, userId, start) => {
        const before = await sessionIds(userId);
        const epochBefore = (await userRow(userId))?.credentialEpoch;
        await lockState.db.query('begin');
        lockState.open = true;
        const updated = (await lockState.db.query('update "User" set "credentialEpoch" = "credentialEpoch" + 1, "passwordHash" = $2 where id = $1', [userId, RACE_HASH])).rowCount;
        let settled = false;
        const pending = Promise.resolve().then(start).finally(() => { settled = true; });
        pending.catch(() => null);
        let waiting = [];
        const until = Date.now() + 4000;
        while (!settled && Date.now() < until) {
          waiting = await blockedOnLock();
          if (waiting.length) break;
          await sleep(20);
        }
        const answeredFirst = settled;
        lockState.open = false;
        await lockState.db.query('commit');
        const res = keep(label, await within(pending, 30_000, label));
        const fresh = (await sessionIds(userId)).filter((id) => !before.includes(id));
        const epochAfter = (await userRow(userId))?.credentialEpoch;
        const returned = await tokensRefused(res);
        const pathTaken = waiting.length
          ? `waited on the held User row (${waiting[0].locktype}, backend ${waiting[0].pid}) at: ${waiting[0].query}`
          : answeredFirst ? 'answered before reaching any wait' : 'no wait seen within 4 s (committed anyway)';
        console.log(`        ${label}: ${said(res)}; path: ${pathTaken}`);
        return { res, waited: waiting.length > 0, answeredFirst, pathTaken, fresh, epochBefore, epochAfter, updated, returned };
      };
      // Waited at the hold: exactly 401 SESSION_REVOKED. Refused before any wait: one of `early`.
      const raceHeld = (r, early = ['401 SESSION_REVOKED']) =>
        r.updated === 1 && r.epochAfter === r.epochBefore + 1 && r.fresh.length === 0 && r.returned.ok
        && (r.waited ? said(r.res) === '401 SESSION_REVOKED' : early.includes(said(r.res)));
      const raceDetail = (r) => `${said(r.res)} ${r.res?.text || ''}; path: ${r.pathTaken}; epoch ${r.epochBefore} -> ${r.epochAfter} (row updated ${r.updated}); refresh sessions written ${r.fresh.length}; returned tokens: ${r.returned.tried.join(', ') || 'none'}`;
      const selfReset = async (email, password, send = api.raw) => {
        const before = invitations.mailsTo(email).length;
        const forgotRes = keep(`forgot ${email}`, await send('POST', '/auth/forgot-password', { json: { email } }));
        await authService.flushPasswordResetDeliveries();
        const link = invitations.mailsTo(email).slice(before).reverse().map((m) => linkIn(m, 'reset-password')).find(Boolean);
        if (link) rawTokens.add(link.token);
        const resetRes = keep(`reset ${email}`, await send('POST', '/auth/reset-password', { json: { token: link?.token || 'x'.repeat(43), password } }));
        return { ok: forgotRes.status === 200 && Boolean(link) && resetRes.status === 200 && resetRes.body?.data?.reset === true, said: `forgot ${said(forgotRes)}, link ${Boolean(link)}, reset ${said(resetRes)}` };
      };

      // C12.9 workspace session, the reset's row update held.
      const wOld = await api.signIn(W.email, orgA.id, { client: 'mobile' });
      [wOld.token, wOld.refreshToken].filter(Boolean).forEach((t) => rawTokens.add(t));
      const wMe = keep('W me before', await api.raw('GET', '/auth/me', { token: wOld.token }));
      const r1 = await raceAgainstReset('C12.9 workspace session', W.id, () => api.raw('POST', `/auth/workspaces/${orgA.id}/session`, { token: wOld.token, json: {}, headers: mobile }));
      check2(ROUND2.ws, wMe.status === 200 && raceHeld(r1), `me before ${said(wMe)}; ${raceDetail(r1)}`);

      // C12.10 workspace session held between the route's token check and issuance; a real reset completes.
      const gOld = await api.signIn(WG.email, orgA.id, { client: 'mobile' });
      [gOld.token, gOld.refreshToken].filter(Boolean).forEach((t) => rawTokens.add(t));
      const gMe = keep('WG me before', await api.raw('GET', '/auth/me', { token: gOld.token }));
      const gBefore = await sessionIds(WG.id);
      const gEpochBefore = (await userRow(WG.id))?.credentialEpoch;
      let gateReached = false;
      let openGate = () => {};
      const gate = new Promise((resolve) => { openGate = resolve; });
      authService.issueWorkspaceSession = async (...args) => {
        gateReached = true;
        await gate;
        return realIssueWorkspaceSession(...args);
      };
      let gSettled = false;
      const gPending = api.raw('POST', `/auth/workspaces/${orgA.id}/session`, { token: gOld.token, json: {}, headers: mobile }).finally(() => { gSettled = true; });
      gPending.catch(() => null);
      const gUntil = Date.now() + 5000;
      while (!gateReached && !gSettled && Date.now() < gUntil) await sleep(20);
      const gReset = gateReached ? await selfReset(WG.email, `Gate-${STAMP}-pass3`) : { ok: false, said: 'not run (the request did not reach issuance)' };
      openGate();
      const gRes = keep('C12.10 workspace session (gate)', await within(gPending, 30_000, 'C12.10'));
      authService.issueWorkspaceSession = realIssueWorkspaceSession;
      const gFresh = (await sessionIds(WG.id)).filter((id) => !gBefore.includes(id));
      const gEpochAfter = (await userRow(WG.id))?.credentialEpoch;
      const gReturned = await tokensRefused(gRes);
      console.log(`        C12.10 workspace session (gate): ${said(gRes)}; path: ${gateReached ? 'passed the route\'s token check, held before issuance while the reset completed' : 'never reached issuance'}`);
      check2(ROUND2.gate, gMe.status === 200 && gateReached && gReset.ok && gEpochAfter === gEpochBefore + 1 && said(gRes) === '401 SESSION_REVOKED' && gFresh.length === 0 && gReturned.ok,
        `me before ${said(gMe)}; gate reached ${gateReached}; reset: ${gReset.said}; epoch ${gEpochBefore} -> ${gEpochAfter}; answer ${said(gRes)} ${gRes.text || ''}; refresh sessions written ${gFresh.length}; returned tokens: ${gReturned.tried.join(', ') || 'none'}`);

      // C12.11 sign-in with the pre-reset password, the reset's row update held.
      abuse.resetAuthAbuseState();
      const r3 = await raceAgainstReset('C12.11 login', L.id, () => api.raw('POST', '/auth/login', { json: { email: L.email, password: PASSWORD }, headers: mobile }));
      abuse.resetAuthAbuseState();
      const lOldNow = keep('L old password after the race', await api.raw('POST', '/auth/login', { json: { email: L.email, password: PASSWORD }, headers: mobile }));
      abuse.resetAuthAbuseState();
      const lNewNow = keep('L new password after the race', await api.raw('POST', '/auth/login', { json: { email: L.email, password: RACE_PASSWORD }, headers: mobile }));
      [lNewNow.body?.data?.tokens?.accessToken, lNewNow.body?.data?.tokens?.refreshToken].filter(Boolean).forEach((t) => rawTokens.add(t));
      check2(ROUND2.login, raceHeld(r3, ['401 SESSION_REVOKED', '401 INVALID_CREDENTIALS']) && said(lOldNow) === '401 INVALID_CREDENTIALS' && lNewNow.status === 200 && Boolean(lNewNow.body?.data?.tokens?.accessToken),
        `${raceDetail(r3)}; afterwards old password ${said(lOldNow)}, new password ${said(lNewNow)}`);

      // C12.12 MFA completion with a pre-reset challenge and a valid code, the reset's row update held.
      abuse.resetAuthAbuseState();
      const mLogin = keep('M login', await api.raw('POST', '/auth/login', { json: { email: M.email, password: PASSWORD }, headers: mobile }));
      const mChallenge = mLogin.body?.data?.mfaToken || 'x'.repeat(40);
      rawTokens.add(mChallenge);
      // The step after the current one: later than the step the enrolment spent, inside the ±1 window.
      const mCode = totp(mMfa.secret, { time: Date.now() + 30_000 });
      const r4 = await raceAgainstReset('C12.12 mfa verify', M.id, () => api.raw('POST', '/auth/mfa/verify', { json: { mfaToken: mChallenge, code: mCode }, headers: mobile }));
      check2(ROUND2.mfa, mLogin.status === 200 && mLogin.body?.data?.mfaRequired === true && raceHeld(r4),
        `login ${said(mLogin)} mfaRequired ${mLogin.body?.data?.mfaRequired}; ${raceDetail(r4)}`);

      // C12.13 acceptance with the pre-reset bearer, the reset's row update held.
      const iInv = await invite(I.email, { projectId: projectA });
      if (iInv.id) cleanup.push(async () => `round-2 acceptance link revoked: ${said(await aPm.send('DELETE', `/users/invitations/${iInv.id}`))}`);
      const iBearer = await api.tokenFor(I.email, orgA.id);
      rawTokens.add(iBearer);
      const r5 = await raceAgainstReset('C12.13 accept', I.id, () => api.raw('POST', '/auth/invitations/accept', { token: iBearer, json: { token: iInv.token || 'x'.repeat(43), name: 'DID1 race' }, headers: mobile }));
      api.forget(I.email);
      const iRow = iInv.id ? (await q('select status from "InvitationToken" where id = $1', [iInv.id]))[0] : null;
      const iAssigned = (await q('select count(*)::int as n from "ProjectAssignment" where "projectId" = $1 and "userId" = $2', [projectA, I.id]))[0].n;
      check2(ROUND2.accept, iInv.res.status === 201 && Boolean(iInv.token) && raceHeld(r5) && iRow?.status === 'pending' && iAssigned === 0,
        `invite ${said(iInv.res)}; ${raceDetail(r5)}; link ${iRow?.status}; assigned ${iAssigned}`);

      // C12.14 an MFA challenge minted before a completed reset.
      abuse.resetAuthAbuseState();
      const bLogin = keep('MB login', await api.raw('POST', '/auth/login', { json: { email: MB.email, password: PASSWORD }, headers: mobile }));
      const bChallenge = bLogin.body?.data?.mfaToken || 'x'.repeat(40);
      rawTokens.add(bChallenge);
      const bPassword = `Before-${STAMP}-pass4`;
      const bReset = await selfReset(MB.email, bPassword);
      const bBefore = await sessionIds(MB.id);
      const bCode = totp(mbMfa.secret, { time: Date.now() + 30_000 });
      const bVerify = keep('MB verify pre-reset challenge', await api.raw('POST', '/auth/mfa/verify', { json: { mfaToken: bChallenge, code: bCode }, headers: mobile }));
      const bFresh = (await sessionIds(MB.id)).filter((id) => !bBefore.includes(id));
      const bReturned = await tokensRefused(bVerify);
      abuse.resetAuthAbuseState();
      const bLogin2 = keep('MB login after the reset', await api.raw('POST', '/auth/login', { json: { email: MB.email, password: bPassword }, headers: mobile }));
      if (bLogin2.body?.data?.mfaToken) rawTokens.add(bLogin2.body.data.mfaToken);
      const bVerify2 = keep('MB verify fresh challenge', await api.raw('POST', '/auth/mfa/verify', { json: { mfaToken: bLogin2.body?.data?.mfaToken || 'x'.repeat(40), code: bCode }, headers: mobile }));
      const bAccess = bVerify2.body?.data?.tokens?.accessToken || null;
      [bAccess, bVerify2.body?.data?.tokens?.refreshToken].filter(Boolean).forEach((t) => rawTokens.add(t));
      const bMe = bAccess ? keep('MB me', await api.raw('GET', '/auth/me', { token: bAccess })) : null;
      check2(ROUND2.challenge, bLogin.status === 200 && bLogin.body?.data?.mfaRequired === true && bReset.ok && said(bVerify) === '401 SESSION_REVOKED' && bFresh.length === 0 && bReturned.ok
        && bLogin2.body?.data?.mfaRequired === true && bVerify2.status === 200 && bMe?.status === 200,
        `login ${said(bLogin)} mfaRequired ${bLogin.body?.data?.mfaRequired}; reset: ${bReset.said}; old challenge ${said(bVerify)} ${bVerify.text || ''}; sessions written ${bFresh.length}; returned ${bReturned.tried.join(', ') || 'none'}; fresh challenge ${said(bLogin2)} -> verify ${said(bVerify2)}, me ${said(bMe)}`);

      // ── sockets: an in-process server wired as src/index.js wires the API ──
      const socketApp = require('../../../src/app').createApp();
      server = http.createServer(socketApp);
      ioServer = new Server(server);
      socketApp.set('io', ioServer);
      realtime = socketModule.attachRealtime(ioServer);
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const base = `http://127.0.0.1:${server.address().port}`;
      console.log(`        socket server ${base} (socket.io attached with attachRealtime, app.set('io'))`);
      const viaServer = (method, route, options = {}) => api.raw(method, `${base}/api/v1${route}`, options);
      const openSocket = (token) => new Promise((resolve) => {
        const s = socketClient(base, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true, timeout: 8000 });
        clients.push(s);
        const state = { s, error: null, disconnects: [] };
        s.on('disconnect', (reason) => state.disconnects.push(reason));
        s.once('connect', () => resolve(state));
        s.once('connect_error', (error) => {
          state.error = error;
          resolve(state);
        });
      });
      const joinProject = (state, projectId) => new Promise((resolve) => {
        if (!state || state.error) {
          resolve({ ok: null, code: 'NOT_CONNECTED' });
          return;
        }
        const timer = setTimeout(() => resolve({ ok: null, code: 'NO_ACK' }), 8000);
        state.s.emit('project:join', { projectId }, (ack) => {
          clearTimeout(timer);
          resolve(ack);
        });
      });
      const droppedWithin = async (state, ms = 5000) => {
        const until = Date.now() + ms;
        while (state && !state.error && !state.disconnects.length && Date.now() < until) await sleep(25);
        return state?.disconnects?.[0] || null;
      };
      const refusal = (state) => (state.error ? state.error.data?.code || state.error.message : 'connected');
      const SERVER_DROP = ['io server disconnect', 'transport close'];

      // C12.15 a self-service reset drops a live socket.
      const kPassword = `Socket-${STAMP}-pass5`;
      const k1 = await api.signIn(K.email, orgA.id);
      rawTokens.add(k1.token);
      const sock1 = await openSocket(k1.token);
      const join1 = await joinProject(sock1, projectA);
      const quiet1 = !sock1.error && sock1.disconnects.length === 0;
      const kReset = await selfReset(K.email, kPassword, viaServer);
      const drop1 = await droppedWithin(sock1);
      const reopen1 = await openSocket(k1.token);
      api.forget(K.email);
      console.log(`        C12.15: join ${JSON.stringify(join1)}; reset ${kReset.said}; dropped: ${drop1}; reconnect: ${refusal(reopen1)}`);
      check2(ROUND2.sockReset, !sock1.error && join1?.ok === true && quiet1 && kReset.ok && SERVER_DROP.includes(drop1) && reopen1.error?.data?.code === 'SESSION_REVOKED',
        `connect ${refusal(sock1)}; join ${JSON.stringify(join1)}; connected before the reset ${quiet1}; reset: ${kReset.said}; dropped: ${drop1}; reconnect: ${refusal(reopen1)}`);

      // C12.16 the epoch moves under a connected socket (guarded fixture on the
      // throwaway K: a credential event whose disconnect did not reach this socket).
      abuse.resetAuthAbuseState();
      const k2Login = keep('K login after the reset', await api.raw('POST', '/auth/login', { json: { email: K.email, password: kPassword } }));
      const k2Token = k2Login.body?.data?.tokens?.accessToken || null;
      if (k2Token) rawTokens.add(k2Token);
      const sock2 = k2Token ? await openSocket(k2Token) : { s: null, error: new Error('no token'), disconnects: [] };
      const join2a = await joinProject(sock2, projectA);
      const kEpoch = (await userRow(K.id))?.credentialEpoch;
      const bumped = (await db.query('update "User" set "credentialEpoch" = "credentialEpoch" + 1 where id = $1', [K.id])).rowCount;
      const quiet2 = !sock2.error && sock2.disconnects.length === 0;
      const join2b = await joinProject(sock2, projectA);
      const drop2 = await droppedWithin(sock2);
      console.log(`        C12.16: first join ${JSON.stringify(join2a)}; epoch ${kEpoch} -> ${kEpoch + bumped} (fixture); join after ${JSON.stringify(join2b)}; dropped: ${drop2}`);
      check2(ROUND2.sockJoin, k2Login.status === 200 && !sock2.error && join2a?.ok === true && bumped === 1 && quiet2 && join2b?.ok === false && join2b?.code === 'SESSION_REVOKED' && SERVER_DROP.includes(drop2),
        `login ${said(k2Login)}; connect ${refusal(sock2)}; first join ${JSON.stringify(join2a)}; fixture rows ${bumped}; still connected ${quiet2}; join after ${JSON.stringify(join2b)}; dropped: ${drop2}`);

      // C12.17 a company admin's MFA reset drops a live socket.
      abuse.resetAuthAbuseState();
      const k3Login = keep('K login for MFA', await api.raw('POST', '/auth/login', { json: { email: K.email, password: kPassword } }));
      const k3Token = k3Login.body?.data?.tokens?.accessToken || null;
      if (k3Token) rawTokens.add(k3Token);
      const kSetup = k3Token ? keep('K mfa setup', await api.raw('POST', '/auth/mfa/setup', { token: k3Token, json: {} })) : null;
      const kEnable = kSetup?.status === 200 ? keep('K mfa enable', await api.raw('POST', '/auth/mfa/enable', { token: k3Token, json: { code: totp(kSetup.body?.data?.secret || '') } })) : null;
      const sock3 = k3Token ? await openSocket(k3Token) : { s: null, error: new Error('no token'), disconnects: [] };
      const join3 = await joinProject(sock3, projectA);
      const quiet3 = !sock3.error && sock3.disconnects.length === 0;
      const kAdmin = keep('admin MFA reset K', await viaServer('POST', `/company/security/users/${K.id}/mfa/reset`, { token: await aPm.token(), json: {} }));
      const drop3 = await droppedWithin(sock3);
      const reopen3 = k3Token ? await openSocket(k3Token) : { error: new Error('no token') };
      const kAfter = await userRow(K.id);
      console.log(`        C12.17: join ${JSON.stringify(join3)}; admin reset ${said(kAdmin)}; dropped: ${drop3}; reconnect: ${refusal(reopen3)}`);
      check2(ROUND2.sockMfa, kEnable?.status === 200 && !sock3.error && join3?.ok === true && quiet3 && kAdmin.status === 200 && kAdmin.body?.data?.reset === true && kAfter?.mfaEnabled === false
        && SERVER_DROP.includes(drop3) && reopen3.error?.data?.code === 'SESSION_REVOKED',
        `login ${said(k3Login)}; mfa ${said(kSetup)}/${said(kEnable)}; connect ${refusal(sock3)}; join ${JSON.stringify(join3)}; connected before ${quiet3}; admin reset ${said(kAdmin)} ${kAdmin.text || ''}; mfa after ${kAfter?.mfaEnabled}; dropped: ${drop3}; reconnect: ${refusal(reopen3)}`);
    } catch (error) {
      console.log(`SECTION ERROR (C12 round 2): ${error.stack || error.message}`);
      for (const name of Object.values(ROUND2)) if (!seen.has(name)) check2(name, false, `not reached: ${error.message}`);
    } finally {
      authService.issueWorkspaceSession = realIssueWorkspaceSession;
      if (lockState.open) {
        lockState.open = false;
        await lockState.db.query('rollback').catch(() => null);
      }
      for (const s of clients) {
        try { s.disconnect(); } catch { /* already gone */ }
      }
      if (realtime?.unsubscribe) realtime.unsubscribe();
      if (ioServer) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 3000);
          try {
            ioServer.close(() => { clearTimeout(timer); resolve(); });
          } catch {
            clearTimeout(timer);
            resolve();
          }
          if (server?.closeAllConnections) server.closeAllConnections();
        });
      } else if (server) {
        server.close();
      }
    }
  };
  await round2();

  // ── C12 round 3: the Codex diff review round 2 ────────────────────────────
  // Item 1 (a brand-new identity's acceptance lost the epoch it wrote before
  // issuance), item 2 (a socket handshake that read the account before a reset
  // escaped the reset's sweep and joined its rooms), R1 (concurrent sign-ins of
  // one person deadlocked on the epoch hold), N2 (a self-service MFA change that
  // waited behind a credential event wrote over it) and R3 (the admin MFA
  // reset's socket eviction waited for the notice mail). Forced interleavings:
  // where the request waits on a lock of its own, an uncommitted UPDATE of the
  // person's User row is held on a second connection and committed once
  // pg_locks shows the request (or every request of the batch) waiting behind
  // it; where no lock exists in the window, the request is parked at a wrapped
  // function, restored in `finally`:
  //   C12.18 the shared Prisma client's $transaction — acceptInvitation calls
  //          the module-local issueWorkspaceSession, which no wrap of the
  //          export reaches, so the acceptance is held when its own
  //          transaction (the one that returns the new User row) has committed
  //          and before issuance starts;
  //   C12.19 membershipService.resolveRequestPrincipal, which the socket
  //          handshake requires at call time: parked once it has read the
  //          account, before the socket joins its rooms.
  console.log('\n── C12 round 3: new-identity acceptance, handshakes, concurrent sign-ins, self-service MFA, the reset notice ──');
  const ROUND3 = {
    setup: 'setup (round 3): throwaways H, Q, E1, E2, E3 and RN made by invitation and acceptance in A (E2 and RN with MFA on), a brand-new e-mail N invited to A with no User row yet, A without an MFA requirement; a second database connection and an in-process socket server ready',
    accept: 'C12.18 race (item 1, new identity): a brand-new e-mail accepts its invitation without a bearer, and between the acceptance\'s commit and the session issue the new identity\'s credential epoch moves (committed): the answer is 200 accepted:true signInRequired:true (reason SESSION_REVOKED) with no tokens and no refresh cookie, or 401 SESSION_REVOKED; no refresh session exists for the new identity; the membership stands and a sign-in with the chosen password then works',
    handshake: 'C12.19 race (item 2): a socket handshake that has read the account and is parked before joining its rooms while its person completes a self-service reset on the same server ends disconnected within 2 s of being released and hears no domain event addressed to the person (a socket opened after the reset does)',
    logins: 'C12.20 R1: 8 concurrent POST /auth/login of one person with the same password, lined up behind a row lock held on their User row and released together, all answer 200 with a session (no 5xx, no P2028, no deadlock) and write 8 refresh sessions',
    switches: 'C12.21 R1: 4 concurrent POST /auth/workspaces/<A>/session with one valid access token, lined up the same way, all answer 200 and write 4 refresh sessions',
    mfaEnable: 'C12.22 N2: POST /auth/mfa/enable with a valid code for a pending enrolment, started while an admin-reset-like update of the User row (pending seed cleared, credentialEpoch + 1) is held uncommitted, waits on it and after the commit answers 401 SESSION_REVOKED; mfaEnabled stays false and the seed stays null',
    mfaDisable: 'C12.23 N2: POST /auth/mfa/disable with the password and a valid code, started while an update of the User row (credentialEpoch + 1 and a new password hash) is held uncommitted, waits on it and after the commit answers 401 SESSION_REVOKED; MFA stays on with the same seed',
    mfaSetup: 'C12.24 N2: POST /auth/mfa/setup started while a credentialEpoch + 1 update of the User row is held uncommitted waits on it and after the commit answers 401 SESSION_REVOKED; no pending seed is written',
    notice: 'C12.25 R3: with the e-mail provider a webhook that answers after 8 s, an admin MFA reset (POST /company/security/users/:id/mfa/reset, same server) answers 200 within 2 s and the person\'s live socket is dropped within 2 s of the answer; after the delay the notice has reached the webhook (or an mfa.reset_notice_* audit row exists)',
  };
  const round3 = async () => {
    const seen = new Set();
    const check3 = (name, ok, detail) => {
      seen.add(name);
      check(name, ok, detail);
    };
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const within = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what}: no answer within ${ms} ms`)), ms).unref())]);
    const bcrypt = require('bcryptjs');
    const http = require('http');
    const { Server } = require('socket.io');
    const { io: socketClient } = require('socket.io-client');
    const membershipModule = require('../../../src/services/membership.service');
    const realResolve = membershipModule.resolveRequestPrincipal;
    // The client config/db hands out (its exported `prisma` is a forwarding proxy over this one).
    const prismaClient = global.__prisma || null;
    const realTransaction = prismaClient ? prismaClient.$transaction : null;
    const restoreTransaction = () => {
      if (!prismaClient || typeof realTransaction !== 'function') return;
      try {
        prismaClient.$transaction = realTransaction;
      } catch {
        /* never replaced */
      }
    };
    const envBefore = { EMAIL_PROVIDER: process.env.EMAIL_PROVIDER, EMAIL_WEBHOOK_URL: process.env.EMAIL_WEBHOOK_URL };
    const restoreEnv = () => {
      for (const [name, value] of Object.entries(envBefore)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    };
    const SERVER_DROP = ['io server disconnect', 'transport close'];
    const clients = [];
    let side = null;
    let sideOpen = false;
    let server = null;
    let ioServer = null;
    let realtime = null;
    let hook = null;
    try {
      // ── set-up ──
      if (!prismaClient || typeof realTransaction !== 'function') throw new Error('the shared Prisma client (global.__prisma) is not loaded');
      const N_EMAIL = `did1s.race-newid.${STAMP}@${A.domain}`;
      const nInv = await invite(N_EMAIL);
      const nUsersBefore = (await q('select count(*)::int as n from "User" where email = $1', [N_EMAIL]))[0].n;
      const H = await make('race-handshake');
      const Q = await make('race-concurrent');
      const E1 = await make('race-mfa-enable');
      const E2 = await make('race-mfa-disable');
      const E3 = await make('race-mfa-setup');
      const RN = await make('reset-notice');
      const mfaOn = async (p) => {
        const session = await api.signIn(p.email, orgA.id);
        rawTokens.add(session.token);
        const setup = keep(`${p.label} mfa setup`, await api.raw('POST', '/auth/mfa/setup', { token: session.token, json: {} }));
        const secret = setup.body?.data?.secret || '';
        const enabled = keep(`${p.label} mfa enable`, await api.raw('POST', '/auth/mfa/enable', { token: session.token, json: { code: totp(secret) } }));
        return { token: session.token, secret, ok: setup.status === 200 && enabled.status === 200, said: `${said(setup)}/${said(enabled)}` };
      };
      const e2Mfa = await mfaOn(E2);
      const rnMfa = await mfaOn(RN);
      side = await guard.connectCert();
      const sidePid = (await side.query('select pg_backend_pid() as pid')).rows[0].pid;
      const aMfaRequired = (await q('select "mfaRequired" from "Organisation" where id = $1', [orgA.id]))[0]?.mfaRequired;
      // The socket server: wired as src/index.js wires the API.
      const socketApp = require('../../../src/app').createApp();
      server = http.createServer(socketApp);
      ioServer = new Server(server);
      socketApp.set('io', ioServer);
      realtime = socketModule.attachRealtime(ioServer);
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const base = `http://127.0.0.1:${server.address().port}`;
      console.log(`        socket server ${base}; lock connection backend ${sidePid}`);
      const r3People = [H, Q, E1, E2, E3, RN];
      check3(ROUND3.setup, nInv.res.status === 201 && Boolean(nInv.token) && nUsersBefore === 0 && r3People.every((p) => p.id) && e2Mfa.ok && rnMfa.ok && aMfaRequired === false && Number.isInteger(sidePid),
        JSON.stringify({ invite: said(nInv.res), token: Boolean(nInv.token), nUsersBefore, ids: r3People.map((p) => `${p.label}:${Boolean(p.id)}`).join(','), mfa: [e2Mfa.said, rnMfa.said], aMfaRequired, sidePid }));

      // ── the machinery ──
      const viaServer = (method, route, options = {}) => api.raw(method, `${base}/api/v1${route}`, options);
      const sessionIds = async (userId) => (await q('select id from "RefreshSession" where "userId" = $1', [userId])).map((r) => r.id);
      const factorOf = async (userId) => (await q('select "mfaEnabled" as enabled, "mfaSecretEnc" as secret, "mfaPendingSecretEnc" as pending, "credentialEpoch" as epoch, "passwordHash" as hash from "User" where id = $1', [userId]))[0] || null;
      // Every backend waiting behind the lock connection, directly or behind another waiter.
      const behindSide = async () => q(
        `with recursive chain(pid) as (
           select l.pid from pg_locks l where not l.granted and $1::int = any(pg_blocking_pids(l.pid))
           union
           select l.pid from pg_locks l join chain c on c.pid = any(pg_blocking_pids(l.pid)) where not l.granted
         )
         select a.pid, left(regexp_replace(coalesce(a.query, ''), '\\s+', ' ', 'g'), 160) as query
           from pg_stat_activity a where a.pid in (select pid from chain) order by a.pid`,
        [sidePid],
      );
      // Holds `statements` uncommitted on the lock connection, starts the requests,
      // waits until `count` of them wait behind it (or 3 s after the first did, so
      // no interactive transaction reaches its own timeout), then commits.
      const heldRace = async (label, { statements, start, count = 1, deadlineMs = 8000 }) => {
        await side.query('begin');
        sideOpen = true;
        let held = 0;
        for (const [sql, params] of statements) held += (await side.query(sql, params)).rowCount;
        const tracked = [].concat(start()).map((p) => {
          const t = { done: false };
          t.p = Promise.resolve(p).finally(() => { t.done = true; });
          t.p.catch(() => null);
          return t;
        });
        let waiting = [];
        let most = 0;
        let firstWaitAt = null;
        const until = Date.now() + deadlineMs;
        while (Date.now() < until) {
          waiting = await behindSide();
          most = Math.max(most, waiting.length);
          if (waiting.length && firstWaitAt === null) firstWaitAt = Date.now();
          if (waiting.length >= count || tracked.every((t) => t.done)) break;
          if (firstWaitAt !== null && Date.now() - firstWaitAt > 3000) break;
          await sleep(25);
        }
        const settledFirst = tracked.filter((t) => t.done).length;
        const heldMs = firstWaitAt === null ? null : Date.now() - firstWaitAt;
        sideOpen = false;
        await side.query('commit');
        const results = await within(Promise.all(tracked.map((t) => t.p)), 60_000, label);
        const pathTaken = waiting.length
          ? `${waiting.length} of ${tracked.length} waited behind the held User row (most seen ${most}, held ${heldMs} ms after the first wait) at: ${waiting[0].query}`
          : settledFirst ? `${settledFirst} of ${tracked.length} answered before reaching any wait` : 'no wait seen before the deadline (committed anyway)';
        console.log(`        ${label}: ${results.map(said).join(', ')}; path: ${pathTaken}`);
        return { results, held, lined: waiting.length, most, settledFirst, heldMs, pathTaken };
      };
      // Every token an answer carries is tried where it would be used; each must be refused 401.
      const returnedRefused = async (res) => {
        const d = res?.body?.data || {};
        const access = d.tokens?.accessToken || null;
        const refresh = d.tokens?.refreshToken || null;
        const identity = d.identityToken || null;
        [access, refresh, identity].filter(Boolean).forEach((t) => rawTokens.add(t));
        const tried = [];
        if (access) tried.push(['access', keep('returned access token', await api.raw('GET', '/auth/me', { token: access }))]);
        if (identity) tried.push(['identity', keep('returned identity token', await api.raw('POST', `/auth/workspaces/${orgA.id}/session`, { token: identity, json: {}, headers: mobile }))]);
        if (refresh) tried.push(['refresh', keep('returned refresh token', await api.raw('POST', '/auth/refresh', { json: { refreshToken: refresh }, headers: mobile }))]);
        return { ok: tried.every(([, r]) => r.status === 401), tried: tried.map(([k, r]) => `${k} ${said(r)}`) };
      };
      const selfReset = async (email, password, send = api.raw) => {
        const before = invitations.mailsTo(email).length;
        const forgotRes = keep(`forgot ${email}`, await send('POST', '/auth/forgot-password', { json: { email } }));
        await authService.flushPasswordResetDeliveries();
        const link = invitations.mailsTo(email).slice(before).reverse().map((m) => linkIn(m, 'reset-password')).find(Boolean);
        if (link) rawTokens.add(link.token);
        const resetRes = keep(`reset ${email}`, await send('POST', '/auth/reset-password', { json: { token: link?.token || 'x'.repeat(43), password } }));
        return { ok: forgotRes.status === 200 && Boolean(link) && resetRes.status === 200 && resetRes.body?.data?.reset === true, said: `forgot ${said(forgotRes)}, link ${Boolean(link)}, reset ${said(resetRes)}` };
      };
      const openSocket = (token) => new Promise((resolve) => {
        const s = socketClient(base, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true, timeout: 15_000 });
        clients.push(s);
        const state = { s, error: null, connectedAt: null, disconnects: [], dropAt: null, events: [] };
        s.on('disconnect', (reason) => {
          state.disconnects.push(reason);
          if (state.dropAt === null) state.dropAt = Date.now();
        });
        s.on(socketModule.DOMAIN_EVENT_NAME, (message) => state.events.push({ at: Date.now(), message }));
        s.once('connect', () => {
          state.connectedAt = Date.now();
          resolve(state);
        });
        s.once('connect_error', (error) => {
          state.error = error;
          resolve(state);
        });
      });
      const refusal = (state) => (state.error ? state.error.data?.code || state.error.message : 'connected');

      // C12.18 a brand-new identity's acceptance, its epoch moved between the acceptance's commit and issuance.
      let acceptArmed = false;
      let acceptReached = null;
      let releaseAccept = () => {};
      const acceptGate = new Promise((resolve) => { releaseAccept = resolve; });
      const gatedTransaction = async function gatedTransaction(...args) {
        const result = await realTransaction.apply(this, args);
        if (acceptArmed && typeof args[0] === 'function' && result && typeof result === 'object' && result.email === N_EMAIL) {
          acceptArmed = false;
          acceptReached = { id: result.id, epoch: result.credentialEpoch };
          await acceptGate;
        }
        return result;
      };
      let gateInstalled = false;
      try {
        prismaClient.$transaction = gatedTransaction;
        gateInstalled = require('../../../src/config/db').prisma.$transaction === gatedTransaction;
      } catch (error) {
        console.log(`        C12.18: the shared client's $transaction could not be wrapped: ${error.message}`);
      }
      acceptArmed = gateInstalled;
      const CHOSEN = `Chosen-${STAMP}-pass6`;
      let nSettled = false;
      const nPending = api.raw('POST', '/auth/invitations/accept', { json: { token: nInv.token || 'x'.repeat(43), name: 'DID1 new identity', password: CHOSEN }, headers: mobile })
        .finally(() => { nSettled = true; });
      nPending.catch(() => null);
      const nUntil = Date.now() + 15_000;
      while (!acceptReached && !nSettled && Date.now() < nUntil) await sleep(20);
      const nParked = acceptReached ? (await q('select id, "credentialEpoch" from "User" where email = $1', [N_EMAIL]))[0] || null : null;
      // The credential event lands, committed, while the acceptance waits between its commit and issuance.
      const nBumped = nParked ? (await side.query('update "User" set "credentialEpoch" = "credentialEpoch" + 1 where id = $1', [nParked.id])).rowCount : 0;
      releaseAccept();
      let nRes;
      try {
        nRes = keep('C12.18 new-identity acceptance', await within(nPending, 30_000, 'C12.18'));
      } finally {
        acceptArmed = false;
        restoreTransaction();
      }
      const nUser = (await q('select id, "credentialEpoch", status from "User" where email = $1', [N_EMAIL]))[0] || null;
      const nSessions = nUser ? (await q('select count(*)::int as n from "RefreshSession" where "userId" = $1', [nUser.id]))[0].n : null;
      const nMembership = nUser ? await membershipIn(orgA.id, nUser.id) : null;
      const nData = nRes.body?.data || {};
      const nCookies = [].concat(nRes.headers?.get?.('set-cookie') || []).join('; ');
      const nReturned = await returnedRefused(nRes);
      abuse.resetAuthAbuseState();
      const nLogin = keep('N signs in with the chosen password', await api.raw('POST', '/auth/login', { json: { email: N_EMAIL, password: CHOSEN }, headers: mobile }));
      const nAccess = nLogin.body?.data?.tokens?.accessToken || null;
      [nAccess, nLogin.body?.data?.tokens?.refreshToken].filter(Boolean).forEach((t) => rawTokens.add(t));
      const nMe = nAccess ? keep('N me', await api.raw('GET', '/auth/me', { token: nAccess })) : null;
      const nSignInAnswer = nRes.status === 200 && nData.accepted === true && nData.signInRequired === true && nData.reason?.code === 'SESSION_REVOKED'
        && !nData.tokens && !nData.identityToken && !/pmc_refresh_token=[^;\s]/.test(nCookies);
      const nPath = !gateInstalled ? 'the shared client\'s $transaction could not be wrapped'
        : !acceptReached ? `the acceptance never reached the gate (${nSettled ? 'it answered first' : 'no answer'})`
          : 'held by the wrapped prisma.$transaction after the acceptance transaction committed (new User row returned); the new identity\'s credentialEpoch + 1 committed on the lock connection; released into issueWorkspaceSession';
      console.log(`        C12.18: ${said(nRes)} ${JSON.stringify({ accepted: nData.accepted, signInRequired: nData.signInRequired, reason: nData.reason?.code })}; path: ${nPath}`);
      check3(ROUND3.accept, gateInstalled && Boolean(acceptReached) && Boolean(nParked) && nBumped === 1 && (nSignInAnswer || said(nRes) === '401 SESSION_REVOKED') && nReturned.ok
        && nUser?.id === acceptReached?.id && nUser?.credentialEpoch === (acceptReached?.epoch ?? NaN) + 1 && nSessions === 0 && nMembership?.status === 'active'
        && nLogin.status === 200 && Boolean(nAccess) && nMe?.status === 200,
        `path: ${nPath}; answer ${said(nRes)} ${nRes.text || ''}; refresh cookie ${/pmc_refresh_token=[^;\s]/.test(nCookies)}; returned tokens: ${nReturned.tried.join(', ') || 'none'}; epoch at the acceptance ${acceptReached?.epoch} -> now ${nUser?.credentialEpoch} (bumped ${nBumped}); refresh sessions before the sign-in ${nSessions}; membership ${nMembership?.status}; sign-in with the chosen password ${said(nLogin)}, me ${said(nMe)}`);

      // C12.19 a socket handshake parked after reading the account, a reset meanwhile.
      const hSession = await api.signIn(H.email, orgA.id);
      rawTokens.add(hSession.token);
      let hsArmed = true;
      let hsReached = false;
      let releaseHandshake = () => {};
      const handshakeGate = new Promise((resolve) => { releaseHandshake = resolve; });
      membershipModule.resolveRequestPrincipal = async (...args) => {
        // Only the handshake's own read (authenticateSocket → accountStanding), once.
        if (hsArmed && args[0]?.userId === H.id && String(new Error().stack).includes('authenticateSocket')) {
          hsArmed = false;
          const account = await realResolve(...args);
          hsReached = true;
          await handshakeGate;
          return account;
        }
        return realResolve(...args);
      };
      const H_PASSWORD = `Handshake-${STAMP}-pass8`;
      const hEpochBefore = (await userRow(H.id))?.credentialEpoch;
      let hs;
      let hReset;
      let releasedAt;
      try {
        const hsPending = openSocket(hSession.token);
        const hsUntil = Date.now() + 10_000;
        while (!hsReached && Date.now() < hsUntil) await sleep(20);
        hReset = hsReached ? await selfReset(H.email, H_PASSWORD, viaServer) : { ok: false, said: 'not run (the handshake never reached its account read)' };
        releasedAt = Date.now();
        releaseHandshake();
        hs = await within(hsPending, 20_000, 'C12.19 handshake');
      } finally {
        releaseHandshake();
        membershipModule.resolveRequestPrincipal = realResolve;
      }
      while (!hs.error && hs.dropAt === null && Date.now() < releasedAt + 2000) await sleep(20);
      const hsDropMs = hs.dropAt === null ? null : hs.dropAt - releasedAt;
      const hsEnded = hs.error ? ['SESSION_REVOKED', 'USER_INACTIVE'].includes(hs.error.data?.code)
        : hs.dropAt !== null && hsDropMs <= 2000 && hs.s.connected === false && SERVER_DROP.includes(hs.disconnects[0]);
      const hEpochAfter = (await userRow(H.id))?.credentialEpoch;
      // The positive control: the same person after the reset, on a new socket, hears an event addressed to them.
      abuse.resetAuthAbuseState();
      const hLogin = keep('H signs in after the reset', await api.raw('POST', '/auth/login', { json: { email: H.email, password: H_PASSWORD } }));
      const hToken = hLogin.body?.data?.tokens?.accessToken || null;
      if (hToken) rawTokens.add(hToken);
      const control = hToken ? await openSocket(hToken) : { s: null, error: new Error('no token'), events: [], disconnects: [] };
      const probe = { id: crypto.randomUUID(), type: 'cert.probe', orgId: orgA.id, projectId: null, entityType: 'probe', entityId: crypto.randomUUID(), action: 'probe', actorId: null, occurredAt: new Date().toISOString(), recipientUserIds: [H.id], payload: { stamp: STAMP } };
      socketModule.forgetMemberKeys(orgA.id, H.id);
      const probeRooms = await realtime.broadcast(probe);
      const probeUntil = Date.now() + 2000;
      while (!control.error && !control.events.some((e) => e.message?.id === probe.id) && Date.now() < probeUntil) await sleep(25);
      await sleep(250);
      const controlHeard = control.events.some((e) => e.message?.id === probe.id);
      const racedHeard = hs.events.length;
      console.log(`        C12.19: handshake ${refusal(hs)}; reset ${hReset.said}; dropped ${hs.disconnects[0] || 'no'} ${hsDropMs === null ? '' : `${hsDropMs} ms after the release`}; raced socket heard ${racedHeard}; control ${refusal(control)} heard the probe ${controlHeard}`);
      check3(ROUND3.handshake, hsReached && hReset.ok && hEpochAfter === hEpochBefore + 1 && hsEnded && racedHeard === 0 && hLogin.status === 200 && !control.error && probeRooms >= 1 && controlHeard,
        `path: ${hsReached ? 'the handshake read the account (wrapped resolveRequestPrincipal, called from authenticateSocket) and was parked before next()' : 'the handshake never reached its account read'}; reset: ${hReset.said}; epoch ${hEpochBefore} -> ${hEpochAfter}; handshake ${refusal(hs)}; disconnects ${JSON.stringify(hs.disconnects)} at ${hsDropMs} ms after the release; still connected ${hs.s?.connected}; domain events heard by the raced socket ${racedHeard}; after the reset: login ${said(hLogin)}, control socket ${refusal(control)}, probe rooms ${probeRooms}, control heard ${controlHeard}`);

      // C12.20 concurrent sign-ins of one person, lined up behind a held lock on their User row.
      const HOLD_ROW = 'update "User" set "lastLogin" = "lastLogin" where id = $1';
      const qBefore = await sessionIds(Q.id);
      abuse.resetAuthAbuseState();
      const logins = await heldRace('C12.20 8 concurrent logins', {
        statements: [[HOLD_ROW, [Q.id]]],
        count: 8,
        deadlineMs: 20_000,
        start: () => Array.from({ length: 8 }, () => api.raw('POST', '/auth/login', { json: { email: Q.email, password: PASSWORD }, headers: mobile })),
      });
      logins.results.forEach((r, i) => {
        keep(`C12.20 login ${i + 1}`, r);
        [r.body?.data?.tokens?.accessToken, r.body?.data?.tokens?.refreshToken].filter(Boolean).forEach((t) => rawTokens.add(t));
      });
      const qLoginSessions = (await sessionIds(Q.id)).filter((id) => !qBefore.includes(id));
      const loginFaults = logins.results.filter((r) => r.status >= 500 || /P2028|P2034|deadlock|40P01/i.test(r.text || '')).length;
      check3(ROUND3.logins, logins.held === 1 && logins.lined >= 2 && logins.results.length === 8 && logins.results.every((r) => r.status === 200 && Boolean(r.body?.data?.tokens?.accessToken)) && loginFaults === 0 && qLoginSessions.length === 8,
        `path: ${logins.pathTaken}; answers ${logins.results.map((r) => `${said(r)}${r.status >= 500 ? ` ${String(r.text || '').slice(0, 160)}` : ''}`).join(' | ')}; faults ${loginFaults}; refresh sessions written ${qLoginSessions.length}`);

      // C12.21 concurrent workspace sessions from one token, lined up the same way.
      const qToken = logins.results.map((r) => r.body?.data?.tokens?.accessToken).find(Boolean) || null;
      const qBefore2 = await sessionIds(Q.id);
      const switches = await heldRace('C12.21 4 concurrent workspace sessions', {
        statements: [[HOLD_ROW, [Q.id]]],
        count: 4,
        deadlineMs: 10_000,
        start: () => Array.from({ length: 4 }, () => api.raw('POST', `/auth/workspaces/${orgA.id}/session`, { token: qToken || 'x'.repeat(40), json: {}, headers: mobile })),
      });
      switches.results.forEach((r, i) => {
        keep(`C12.21 workspace session ${i + 1}`, r);
        [r.body?.data?.tokens?.accessToken, r.body?.data?.tokens?.refreshToken].filter(Boolean).forEach((t) => rawTokens.add(t));
      });
      const qSwitchSessions = (await sessionIds(Q.id)).filter((id) => !qBefore2.includes(id));
      check3(ROUND3.switches, Boolean(qToken) && switches.held === 1 && switches.lined >= 2 && switches.results.length === 4 && switches.results.every((r) => r.status === 200 && Boolean(r.body?.data?.tokens?.accessToken)) && qSwitchSessions.length === 4,
        `path: ${switches.pathTaken}; answers ${switches.results.map((r) => `${said(r)}${r.status >= 500 ? ` ${String(r.text || '').slice(0, 160)}` : ''}`).join(' | ')}; refresh sessions written ${qSwitchSessions.length}`);

      // C12.22 a self-service MFA enable waiting behind an admin-reset-like credential event.
      const e1 = await api.signIn(E1.email, orgA.id);
      rawTokens.add(e1.token);
      const e1Setup = keep('E1 mfa setup', await api.raw('POST', '/auth/mfa/setup', { token: e1.token, json: {} }));
      const e1Secret = e1Setup.body?.data?.secret || '';
      const e1Before = await factorOf(E1.id);
      const enable = await heldRace('C12.22 mfa enable', {
        statements: [['update "User" set "mfaPendingSecretEnc" = null, "credentialEpoch" = "credentialEpoch" + 1 where id = $1', [E1.id]]],
        start: () => api.raw('POST', '/auth/mfa/enable', { token: e1.token, json: { code: totp(e1Secret) } }),
      });
      const enableRes = keep('C12.22 mfa enable', enable.results[0]);
      const e1After = await factorOf(E1.id);
      check3(ROUND3.mfaEnable, e1Setup.status === 200 && Boolean(e1Before?.pending) && e1Before?.enabled === false && enable.held === 1 && enable.lined >= 1
        && said(enableRes) === '401 SESSION_REVOKED' && !enableRes.body?.data?.backupCodes && e1After?.enabled === false && e1After?.pending === null && e1After?.secret === null && e1After?.epoch === e1Before.epoch + 1,
        `setup ${said(e1Setup)}; pending before ${Boolean(e1Before?.pending)}; path: ${enable.pathTaken}; answer ${said(enableRes)} ${enableRes?.text || ''}; after: enabled ${e1After?.enabled}, pending ${e1After?.pending === null ? 'null' : 'set'}, seed ${e1After?.secret === null ? 'null' : 'set'}, epoch ${e1Before?.epoch} -> ${e1After?.epoch}`);

      // C12.23 a self-service MFA disable waiting behind a password reset's row write.
      const e2Before = await factorOf(E2.id);
      const DISABLE_HASH = await bcrypt.hash(`Disable-${STAMP}-pass2`, 12);
      const disable = await heldRace('C12.23 mfa disable', {
        statements: [['update "User" set "credentialEpoch" = "credentialEpoch" + 1, "passwordHash" = $2 where id = $1', [E2.id, DISABLE_HASH]]],
        // The step after the current one: later than the step the enrolment spent, inside the ±1 window.
        start: () => api.raw('POST', '/auth/mfa/disable', { token: e2Mfa.token, json: { password: PASSWORD, code: totp(e2Mfa.secret, { time: Date.now() + 30_000 }) } }),
      });
      const disableRes = keep('C12.23 mfa disable', disable.results[0]);
      const e2After = await factorOf(E2.id);
      check3(ROUND3.mfaDisable, e2Before?.enabled === true && Boolean(e2Before?.secret) && disable.held === 1 && disable.lined >= 1
        && said(disableRes) === '401 SESSION_REVOKED' && e2After?.enabled === true && e2After?.secret === e2Before.secret && e2After?.epoch === e2Before.epoch + 1 && e2After?.hash === DISABLE_HASH,
        `before: enabled ${e2Before?.enabled}; path: ${disable.pathTaken}; answer ${said(disableRes)} ${disableRes?.text || ''}; after: enabled ${e2After?.enabled}, same seed ${e2After?.secret === e2Before?.secret}, epoch ${e2Before?.epoch} -> ${e2After?.epoch}, held hash written ${e2After?.hash === DISABLE_HASH}`);

      // C12.24 a self-service MFA setup waiting behind a credential event.
      const e3 = await api.signIn(E3.email, orgA.id);
      rawTokens.add(e3.token);
      const e3Before = await factorOf(E3.id);
      const setup = await heldRace('C12.24 mfa setup', {
        statements: [['update "User" set "credentialEpoch" = "credentialEpoch" + 1 where id = $1', [E3.id]]],
        start: () => api.raw('POST', '/auth/mfa/setup', { token: e3.token, json: {} }),
      });
      const setupRes = keep('C12.24 mfa setup', setup.results[0]);
      const e3After = await factorOf(E3.id);
      check3(ROUND3.mfaSetup, e3Before?.enabled === false && e3Before?.pending === null && setup.held === 1 && setup.lined >= 1
        && said(setupRes) === '401 SESSION_REVOKED' && !setupRes.body?.data?.secret && e3After?.pending === null && e3After?.enabled === false && e3After?.epoch === e3Before.epoch + 1,
        `before: enabled ${e3Before?.enabled}, pending ${e3Before?.pending === null ? 'null' : 'set'}; path: ${setup.pathTaken}; answer ${said(setupRes)} ${setupRes?.text || ''}; after: pending ${e3After?.pending === null ? 'null' : 'set'}, enabled ${e3After?.enabled}, epoch ${e3Before?.epoch} -> ${e3After?.epoch}`);

      // C12.25 the admin MFA reset with a mail provider that answers after 8 s.
      const HOOK_DELAY_MS = 8000;
      const hookState = { calls: [], answered: [] };
      let hookAnswered = () => {};
      const hookDone = new Promise((resolve) => { hookAnswered = resolve; });
      hook = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          let body = null;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            body = null;
          }
          hookState.calls.push({ at: Date.now(), path: req.url, body });
          setTimeout(() => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('{"ok":true}', () => {
              hookState.answered.push(Date.now());
              hookAnswered();
            });
          }, HOOK_DELAY_MS);
        });
      });
      await new Promise((resolve, reject) => {
        hook.once('error', reject);
        hook.listen(0, '127.0.0.1', resolve);
      });
      const hookUrl = `http://127.0.0.1:${hook.address().port}/mail`;
      const rnSock = await openSocket(rnMfa.token);
      const rnConnected = !rnSock.error && rnSock.disconnects.length === 0;
      const adminToken = await aPm.token();
      let rnReset;
      let resetStarted;
      let answeredAt;
      try {
        process.env.EMAIL_PROVIDER = 'webhook';
        process.env.EMAIL_WEBHOOK_URL = hookUrl;
        resetStarted = Date.now();
        rnReset = keep('C12.25 admin MFA reset', await within(viaServer('POST', `/company/security/users/${RN.id}/mfa/reset`, { token: adminToken, json: {} }), 30_000, 'C12.25'));
        answeredAt = Date.now();
        while (!rnSock.error && rnSock.dropAt === null && Date.now() < answeredAt + 2000) await sleep(20);
        // After the provider's delay: the notice reached the webhook, or its failure is audited.
        await within(hookDone, HOOK_DELAY_MS + 7000, 'C12.25 webhook').catch(() => null);
      } finally {
        restoreEnv();
      }
      const answerMs = answeredAt - resetStarted;
      const dropAfterAnswerMs = rnSock.dropAt === null ? null : rnSock.dropAt - answeredAt;
      const noticeCall = hookState.calls.find((c) => c.body?.to === RN.email && c.body?.metadata?.type === 'mfa_reset_notice') || null;
      const noticeAudit = (await q('select action from "AuthAuditEvent" where "userId" = $1 and action like \'mfa.reset_notice%\'', [RN.id])).map((r) => r.action);
      const rnAfter = await factorOf(RN.id);
      console.log(`        C12.25: reset ${said(rnReset)} in ${answerMs} ms; socket dropped ${rnSock.disconnects[0] || 'no'} ${dropAfterAnswerMs === null ? '' : `${dropAfterAnswerMs} ms after the answer`}; webhook calls ${hookState.calls.length} (notice ${Boolean(noticeCall)}${noticeCall ? `, ${noticeCall.at - answeredAt} ms after the answer` : ''}), answered ${hookState.answered.length}; notice audit ${JSON.stringify(noticeAudit)}`);
      check3(ROUND3.notice, rnMfa.ok && rnConnected && rnReset.status === 200 && rnReset.body?.data?.reset === true && answerMs <= 2000 && rnAfter?.enabled === false
        && rnSock.dropAt !== null && dropAfterAnswerMs <= 2000 && SERVER_DROP.includes(rnSock.disconnects[0])
        && ((Boolean(noticeCall) && hookState.answered.length >= 1) || noticeAudit.length > 0),
        `MFA ${rnMfa.said}; socket ${refusal(rnSock)} (connected before ${rnConnected}); reset ${said(rnReset)} ${rnReset.text || ''} in ${answerMs} ms; mfa after ${rnAfter?.enabled}; dropped ${JSON.stringify(rnSock.disconnects)} ${dropAfterAnswerMs} ms after the answer; webhook calls ${hookState.calls.length}, notice ${Boolean(noticeCall)}, answered ${hookState.answered.length}; notice audit ${JSON.stringify(noticeAudit)}`);
    } catch (error) {
      console.log(`SECTION ERROR (C12 round 3): ${error.stack || error.message}`);
      for (const name of Object.values(ROUND3)) if (!seen.has(name)) check3(name, false, `not reached: ${error.message}`);
    } finally {
      membershipModule.resolveRequestPrincipal = realResolve;
      restoreTransaction();
      restoreEnv();
      if (side) {
        if (sideOpen) {
          sideOpen = false;
          await side.query('rollback').catch(() => null);
        }
        await side.end().catch(() => null);
      }
      for (const s of clients) {
        try { s.disconnect(); } catch { /* already gone */ }
      }
      if (realtime?.unsubscribe) realtime.unsubscribe();
      if (ioServer) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 3000);
          try {
            ioServer.close(() => { clearTimeout(timer); resolve(); });
          } catch {
            clearTimeout(timer);
            resolve();
          }
          if (server?.closeAllConnections) server.closeAllConnections();
        });
      } else if (server) {
        server.close();
      }
      if (hook) {
        if (hook.closeAllConnections) hook.closeAllConnections();
        hook.close();
      }
    }
  };
  await round3();

  // ── C15 The emergency switch ──────────────────────────────────────────────
  console.log('\n── C15 the emergency switch ──');
  const n15a = await invite(`did1s.switch-accept.${STAMP}@${A.domain}`);
  const n15r = await invite(`did1s.switch-revoke.${STAMP}@${A.domain}`);
  const n15i = `did1s.switch-invite.${STAMP}@${A.domain}`;
  allEmails.add(n15i);
  const x1Token = await api.tokenFor(X1.email);
  const ownerToken = await aOwner.token();
  await aPm.token();
  const x3Before = await membershipIn(orgA.id, X3.id);
  const switchBefore = process.env.AUTH_MEMBERSHIP_WRITE;
  const suspended = (res) => said(res) === '503 MEMBERSHIP_WRITES_SUSPENDED';
  // The development error handler prints the stack of every 5xx; the switch's
  // expected 503s are counted here instead of printed.
  const realConsoleError = console.error;
  let switchStacks = 0;
  try {
    console.error = (...args) => {
      if (args.map(String).join(' ').includes('Adding people and widening access are paused')) {
        switchStacks += 1;
        return;
      }
      realConsoleError(...args);
    };
    process.env.AUTH_MEMBERSHIP_WRITE = 'false';
    const inv1 = keep('switch invite', await aPm.send('POST', '/users/invitations', { email: n15i, role: 'qs' }));
    const inv2 = keep('switch POST /users', await aPm.send('POST', '/users', { email: n15i, role: 'qs' }));
    const n15iRows = (await q('select count(*)::int as n from "InvitationToken" where email = $1', [n15i]))[0].n;
    const n15iAudit = (await q('select count(*)::int as n from "AuthAuditEvent" where email = $1 and action = \'invitation_created\'', [n15i]))[0].n;
    check('C15.1 switch off: inviting (POST /users/invitations and POST /users) answers 503 MEMBERSHIP_WRITES_SUSPENDED; no invitation row, no audit',
      suspended(inv1) && suspended(inv2) && n15iRows === 0 && n15iAudit === 0, `${said(inv1)} | ${said(inv2)}; rows ${n15iRows}; audit ${n15iAudit}`);
    const acc = keep('switch accept', await accept(n15a.token, { password: PASSWORD, name: 'DID1 switch' }));
    const accRow = (await q('select status from "InvitationToken" where id = $1', [n15a.id]))[0];
    const accUsers = (await q('select count(*)::int as n from "User" where email = $1', [`did1s.switch-accept.${STAMP}@${A.domain}`]))[0].n;
    check('C15.2 switch off: accepting a pending link answers 503; the link stays pending, no User row',
      n15a.res.status === 201 && suspended(acc) && accRow?.status === 'pending' && accUsers === 0, `${said(acc)}; link ${accRow?.status}; users ${accUsers}`);
    const act = keep('switch activate', await aPm.send('PATCH', `/users/${X2.id}/activate`, {}));
    const x2Now = await membershipIn(orgA.id, X2.id);
    check('C15.3 switch off: activate answers 503; the membership stays suspended and the identity closed',
      suspended(act) && x2Now?.status === 'suspended' && (await userRow(X2.id))?.status === 'inactive', `${said(act)}; ${JSON.stringify(x2Now)}`);
    const roleChange = keep('switch role change', await aPm.send('PATCH', `/users/${X3.id}`, { role: 'site_engineer' }));
    check('C15.4 switch off: a role change answers 503; the role is unchanged',
      suspended(roleChange) && (await membershipIn(orgA.id, X3.id))?.role === x3Before.role, `${said(roleChange)}; role ${(await membershipIn(orgA.id, X3.id))?.role}`);
    const grant = keep('switch admin grant', await api.raw('PATCH', `/users/${X3.id}`, { token: ownerToken, json: { isCompanyAdmin: true } }));
    check('C15.5 switch off: an administration grant by an owner answers 503; isAdmin stays false',
      suspended(grant) && (await membershipIn(orgA.id, X3.id))?.isAdmin === false, `${said(grant)}; isAdmin ${(await membershipIn(orgA.id, X3.id))?.isAdmin}`);
    const teamAdd = keep('switch team add', await aPm.send('POST', `/projects/${projectA}/team`, { userId: X3.id }));
    const x3Assigned = (await q('select count(*)::int as n from "ProjectAssignment" where "projectId" = $1 and "userId" = $2', [projectA, X3.id]))[0].n;
    check('C15.6 switch off: a project-team addition answers 503; no assignment', suspended(teamAdd) && x3Assigned === 0, `${said(teamAdd)}; assignments ${x3Assigned}`);
    const partyAdd = keep('switch party add', await aPm.send('POST', `/projects/${projectA}/parties/${partyId}/members`, { userId: X3.id }));
    const x3Party = (await q('select count(*)::int as n from "ProjectPartyMember" where "userId" = $1', [X3.id]))[0].n;
    check('C15.7 switch off: a party-member addition answers 503; no party member row', suspended(partyAdd) && x3Party === 0, `${said(partyAdd)}; rows ${x3Party}`);

    const deact = keep('switch deactivate', await aPm.send('PATCH', `/users/${X1.id}/deactivate`, {}));
    const x1Now = await membershipIn(orgA.id, X1.id);
    const x1Me = keep('X1 old token', await api.raw('GET', '/auth/me', { token: x1Token }));
    check('C15.8 switch off: deactivate still works: 200, the membership is suspended, and the person\'s token is refused 401 at once (USER_INACTIVE or SESSION_REVOKED)',
      deact.status === 200 && x1Now?.status === 'suspended' && x1Me.status === 401 && ['USER_INACTIVE', 'SESSION_REVOKED'].includes(x1Me.body?.error?.code),
      `${said(deact)}; ${JSON.stringify(x1Now)}; token ${said(x1Me)}`);
    const revoke = keep('switch revoke invitation', await aPm.send('DELETE', `/users/invitations/${n15r.id}`));
    const revRow = (await q('select status from "InvitationToken" where id = $1', [n15r.id]))[0];
    check('C15.9 switch off: revoking an invitation still works (200, row revoked)', revoke.status === 200 && revRow?.status === 'revoked', `${said(revoke)}; ${revRow?.status}`);
    const teamRemove = keep('switch team remove', await aPm.send('DELETE', `/projects/${projectA}/team/${X4.id}`));
    const x4Assigned = (await q('select count(*)::int as n from "ProjectAssignment" where "projectId" = $1 and "userId" = $2', [projectA, X4.id]))[0].n;
    check('C15.10 switch off: removing someone from a project team still works (200, no assignment left)', teamRemove.status === 200 && x4Assigned === 0, `${said(teamRemove)}; assignments ${x4Assigned}`);
    const unAdmin = keep('switch admin revoke', await api.raw('PATCH', `/users/${X5.id}`, { token: ownerToken, json: { isCompanyAdmin: false } }));
    check('C15.11 switch off: revoking administration (owner) still works: 200, the membership\'s isAdmin is false',
      unAdmin.status === 200 && (await membershipIn(orgA.id, X5.id))?.isAdmin === false, `${said(unAdmin)}; isAdmin ${(await membershipIn(orgA.id, X5.id))?.isAdmin}`);
  } finally {
    if (switchBefore === undefined) delete process.env.AUTH_MEMBERSHIP_WRITE;
    else process.env.AUTH_MEMBERSHIP_WRITE = switchBefore;
    console.error = realConsoleError;
    console.log(`        (${switchStacks} expected 503 stack traces from the development error handler not printed)`);
  }
  cleanup.push(async () => `pending switch-accept link revoked: ${n15a.id ? said(await aPm.send('DELETE', `/users/invitations/${n15a.id}`)) : 'none'}`);

  // ── C18 Mail and link hygiene ─────────────────────────────────────────────
  console.log('\n── C18 mail and link hygiene ──');
  const n18 = await invite(`did1s.once.${STAMP}@${A.domain}`);
  const n18Mail = invitations.mailsTo(`did1s.once.${STAMP}@${A.domain}`).map((m) => linkIn(m, 'accept-invite')).filter(Boolean).pop();
  const preview = keep('preview', await api.raw('GET', `/auth/invitations/${encodeURIComponent(n18.token || 'x'.repeat(43))}`));
  const first = keep('accept once', await accept(n18.token, { password: PASSWORD, name: 'DID1 once' }));
  [first.body?.data?.tokens?.accessToken].filter(Boolean).forEach((t) => rawTokens.add(t));
  const second = keep('accept twice', await accept(n18.token, { password: PASSWORD, name: 'DID1 once' }));
  check('C18.1 an invitation token works once: preview 200, accept 200, the second use 400 INVITATION_TOKEN_INVALID',
    preview.status === 200 && first.status === 200 && said(second) === '400 INVITATION_TOKEN_INVALID', `${said(preview)} | ${said(first)} | ${said(second)}`);
  const n18xEmail = `did1s.expired.${STAMP}@${A.domain}`;
  const n18x = await invite(n18xEmail);
  await db.query('update "InvitationToken" set "expiresAt" = now() - interval \'1 minute\' where id = $1', [n18x.id]);
  cleanup.push(async () => `expired fixture link revoked: ${n18x.id ? said(await aPm.send('DELETE', `/users/invitations/${n18x.id}`)) : 'none'}`);
  const expired = keep('accept expired', await accept(n18x.token, { password: PASSWORD, name: 'DID1 expired' }));
  const expiredUsers = (await q('select count(*)::int as n from "User" where email = $1', [n18xEmail]))[0].n;
  check('C18.2 an expired invitation token (fixture: expiresAt in the past) is refused 400 INVITATION_TOKEN_INVALID; no User row',
    n18x.res.status === 201 && said(expired) === '400 INVITATION_TOKEN_INVALID' && expiredUsers === 0, `${said(expired)}; users ${expiredUsers}`);
  const resetAgain = keep('reset twice', await api.raw('POST', '/auth/reset-password', { json: { token: resetMail?.token || 'x'.repeat(43), password: `Again-${STAMP}-pass2` } }));
  check('C18.3 a reset token works once: the second use gets 400 PASSWORD_RESET_TOKEN_INVALID', said(resetAgain) === '400 PASSWORD_RESET_TOKEN_INVALID', said(resetAgain));
  check(`C18.4 the invitation and reset links start with WEB_APP_URL (${WEB_APP_URL})`,
    Boolean(n18Mail) && n18Mail.url.startsWith(`${WEB_APP_URL}/accept-invite?token=`) && Boolean(resetMail) && resetMail.url.startsWith(`${WEB_APP_URL}/reset-password?token=`),
    `invitation ${n18Mail?.url?.replace(/token=.*/, 'token=…')}; reset ${resetMail?.url?.replace(/token=.*/, 'token=…')}`);

  // Every raw token the run saw: the links in every mail to the run's people, and the sessions it held.
  for (const email of allEmails) for (const text of invitations.mailsTo(email)) for (const m of text.matchAll(TOKEN_IN_LINK)) rawTokens.add(decodeURIComponent(m[1]));
  const tokens = [...rawTokens].filter((t) => t && t.length >= 20);
  const logged = requestLines.join('');
  const sawPreview = requestLines.some((l) => l.includes('"path":"/api/v1/auth/invitations/:token"'));
  const sawAccept = requestLines.some((l) => l.includes('"path":"/api/v1/auth/invitations/accept"'));
  const sawReset = requestLines.some((l) => l.includes('"path":"/api/v1/auth/reset-password"'));
  const leakedLog = tokens.filter((t) => logged.includes(t));
  check(`C18.5 the production-format request log (REQUEST_LOG_FORMAT=json, ${requestLines.length} lines) carries the preview, accept and reset requests and no raw token (${tokens.length} tokens checked)`,
    sawPreview && sawAccept && sawReset && leakedLog.length === 0, `preview ${sawPreview}, accept ${sawAccept}, reset ${sawReset}; leaked ${leakedLog.length}`);
  const auditRows = await q('select to_jsonb(a)::text as row from "AuthAuditEvent" a where "createdAt" > $1', [auditMark]);
  const auditText = auditRows.map((r) => r.row).join('\n');
  const leakedAudit = tokens.filter((t) => auditText.includes(t));
  check(`C18.6 the AuthAuditEvent rows of the run (${auditRows.length}) contain no raw token`, auditRows.length > 0 && leakedAudit.length === 0, `leaked ${leakedAudit.length}`);
  const { validateProductionEnv } = require('../../../src/config/security');
  const problemsOf = (env) => {
    try {
      validateProductionEnv(env);
      return '';
    } catch (error) {
      return String(error.message);
    }
  };
  const EMAIL_PROBLEM = 'EMAIL_PROVIDER must be ses or webhook in production';
  const REG_PROBLEM = 'PUBLIC_REGISTRATION=true is refused in production';
  const withLog = problemsOf({ NODE_ENV: 'production', EMAIL_PROVIDER: 'log' });
  const withSes = problemsOf({ NODE_ENV: 'production', EMAIL_PROVIDER: 'ses' });
  const withReg = problemsOf({ NODE_ENV: 'production', EMAIL_PROVIDER: 'ses', PUBLIC_REGISTRATION: 'true' });
  check('C18.7 the production validator reports EMAIL_PROVIDER=log, and PUBLIC_REGISTRATION=true (neither when absent)',
    withLog.includes(EMAIL_PROBLEM) && !withSes.includes(EMAIL_PROBLEM) && withReg.includes(REG_PROBLEM) && !withSes.includes(REG_PROBLEM),
    `log: ${withLog.includes(EMAIL_PROBLEM)}; ses: ${withSes.includes(EMAIL_PROBLEM)}; registration: ${withReg.includes(REG_PROBLEM)} / absent ${withSes.includes(REG_PROBLEM)}`);
  const { isPublicRegistrationOpen } = require('../../../src/config/registration');
  const regCases = [
    ['production', { NODE_ENV: 'production' }],
    ['production + PUBLIC_REGISTRATION=true', { NODE_ENV: 'production', PUBLIC_REGISTRATION: 'true' }],
    ['staging', { NODE_ENV: 'staging' }],
    ['a typo', { NODE_ENV: 'developmnet' }],
    ['unset', {}],
  ].map(([label, env]) => [label, isPublicRegistrationOpen(env)]);
  check('C18.8 isPublicRegistrationOpen is false for production (also with PUBLIC_REGISTRATION=true), staging, a typo and an unset NODE_ENV',
    regCases.every(([, open]) => open === false), regCases.map(([l, o]) => `${l}=${o}`).join(', '));
  // Finding 12: an explicit PUBLIC_REGISTRATION=true opened registration under any NODE_ENV but exact production.
  const regCombos = [
    ['staging + PUBLIC_REGISTRATION=true', { NODE_ENV: 'staging', PUBLIC_REGISTRATION: 'true' }, false],
    ['\'prod\' + PUBLIC_REGISTRATION=true', { NODE_ENV: 'prod', PUBLIC_REGISTRATION: 'true' }, false],
    ['\'\' + PUBLIC_REGISTRATION=true', { NODE_ENV: '', PUBLIC_REGISTRATION: 'true' }, false],
    ['unset + PUBLIC_REGISTRATION=true', { PUBLIC_REGISTRATION: 'true' }, false],
    ['production + PUBLIC_REGISTRATION=true', { NODE_ENV: 'production', PUBLIC_REGISTRATION: 'true' }, false],
    ['production + PUBLIC_REGISTRATION=1', { NODE_ENV: 'production', PUBLIC_REGISTRATION: '1' }, false],
    ['development', { NODE_ENV: 'development' }, true],
    ['development + PUBLIC_REGISTRATION=true', { NODE_ENV: 'development', PUBLIC_REGISTRATION: 'true' }, true],
    ['test', { NODE_ENV: 'test' }, true],
    ['test + PUBLIC_REGISTRATION=true', { NODE_ENV: 'test', PUBLIC_REGISTRATION: 'true' }, true],
    ['development + PUBLIC_REGISTRATION=false', { NODE_ENV: 'development', PUBLIC_REGISTRATION: 'false' }, false],
  ].map(([label, env, expected]) => [label, isPublicRegistrationOpen(env), expected]);
  check('C18.9 isPublicRegistrationOpen is false for staging, \'prod\', \'\', unset and production NODE_ENV even with PUBLIC_REGISTRATION=true (or 1); true for development and test (with or without the flag); false for development with PUBLIC_REGISTRATION=false',
    regCombos.every(([, open, expected]) => open === expected), regCombos.map(([l, o, e]) => `${l}=${o}${o === e ? '' : ` (expected ${e})`}`).join(', '));

  // ── final ─────────────────────────────────────────────────────────────────
  console.log('\n── final ──');
  const changes = fingerprint.compare(printBefore, await fingerprint.take(db)).filter((c) => !c.noise && c.org !== A_CODE);
  check(`no other company's data (outside ${A_CODE}; noise tables reported apart) changed after set-up`, changes.length === 0, changes.map((c) => `${c.table}:${c.org}`).join(', '));
  const fives = answers.filter((a) => a.status >= 500);
  check('no answer was a 5xx (except the 503s the switch checks require)', fives.filter((a) => !a.label.startsWith('switch ') || a.status !== 503).length === 0,
    fives.map((a) => `${a.label} ${a.status}`).join(', '));

  return { loginTiming, resetTiming };
};

const finish = async (extra = {}, error = null) => {
  const cleaned = [];
  for (const step of cleanup.reverse()) {
    try {
      cleaned.push(String(await step()));
    } catch (e) {
      cleaned.push(`cleanup failed: ${e.message}`);
    }
  }
  console.log(`\ncleanup: ${cleaned.join('; ') || 'nothing to remove'}`);
  if (lockState.db) {
    if (lockState.open) {
      lockState.open = false;
      await lockState.db.query('rollback').catch(() => {});
    }
    await lockState.db.end().catch(() => {});
  }
  if (dbRef) await dbRef.end().catch(() => {});
  process.stdout.write = realStdoutWrite;
  const failed = results.filter((r) => !r.ok).length;
  const complete = results.length === EXPECTED_CHECKS;
  const ok = !error && failed === 0 && complete;
  const out = {
    proof: 'd-id-1-sessions-proof',
    checks: ['C4', 'C11', 'C12', 'C15', 'C18'],
    stamp: STAMP,
    at: new Date().toISOString(),
    expected: EXPECTED_CHECKS,
    total: results.length,
    passed: results.length - failed,
    failed,
    error: error ? String(error.stack || error.message) : null,
    timing: extra.loginTiming ? {
      login: { unknownMs: extra.loginTiming.unknown, existingMs: extra.loginTiming.existing, boundMs: LOGIN_BOUND_MS },
      reset: { unknownMs: extra.resetTiming.unknown, existingMs: extra.resetTiming.existing, boundMs: RESET_BOUND_MS },
      n: TIMING_N,
    } : null,
    cleanup: cleaned,
    results,
  };
  try {
    fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
    fs.writeFileSync(RESULTS, `${JSON.stringify(out, null, 2)}\n`);
  } catch (e) {
    console.error(`could not write ${RESULTS}: ${e.message}`);
  }
  console.log(`\nd-id-1 sessions proof: ${results.length - failed} passed, ${failed} failed of ${results.length} (fixed count ${EXPECTED_CHECKS})${complete ? '' : ' — INCOMPLETE'}`);
  process.exitCode = error ? 1 : ok ? 0 : 2;
};

main()
  .then((extra) => finish(extra || {}))
  .catch(async (error) => {
    console.error(`SCRIPT ERROR: ${error.stack || error.message}`);
    await finish({}, error);
  })
  .finally(() => {
    // The in-process app keeps database handles open; leave once the result is written.
    setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
  });
