'use strict';

/**
 * D-ID-1 proof P7 (CERT-3 plan §0.1 Q-KEY, owner decision 2026-10-09): a
 * credential event revokes the API keys the person created.
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/d-id-1-keys-proof.js [A=052] [B=025]
 *
 * In process (CERT_INPROCESS=1) on the certification database, through the
 * lock runner only. Throwaway company administrators of a fresh stamp, made
 * the one way the product allows (invitation, acceptance, then the owner's
 * grant), create keys through POST /integrations/api-clients. Checks:
 *
 *   K1 A completed self-service reset revokes every active key the person
 *      created — one acting as themselves and one acting as someone else —
 *      (401 API_KEY_INVALID, status revoked, revokedAt set, one audit row each
 *      with reason password_reset); a key someone else created that acts as
 *      the person keeps working.
 *   K2 A company admin's MFA reset does the same (reason mfa_reset_by_admin,
 *      the admin as actor); a key the admin created acting as the person keeps
 *      working.
 *   K3 Closing the identity (deactivation in its only workspace) revokes the
 *      key the person created acting as someone still active: 401
 *      API_KEY_INVALID, not API_KEY_OWNER_INACTIVE (reason identity_closed).
 *   K4 Reopening a closed identity by re-invitation revokes a key the person
 *      created that is still active (a fixture: the close is undone for that
 *      one key, and the home membership is LEFT so a link may reopen it).
 *   K5 Creating or widening a key holds the actor's credential epoch: a
 *      create started while a reset-like update of the actor's User row is
 *      held uncommitted waits, then answers 401 SESSION_REVOKED and writes no
 *      key; a create parked after authentication while a real self-service
 *      reset completes answers 401 SESSION_REVOKED and writes no key; a
 *      widening started behind a held update answers 401 SESSION_REVOKED and
 *      leaves the scopes alone; a revocation started behind a held update of
 *      the actor's row answers 200 before the row is released.
 *   K6 A fresh session after those events creates a key that works.
 *
 * Exit 0 when every check holds, 2 otherwise (1 on a script error).
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const guard = require('../lib/cert-env');
process.env.DATABASE_URL = guard.certDatabaseUrl();

const crypto = require('crypto');
const fs = require('fs');
const api = require('../lib/api');
const invitations = require('../lib/invitations');
const { buildPopulation } = require('../lib/spec');
const fingerprint = require('../isolation/fingerprint');
const { totp } = require('../../../src/utils/totp');

invitations.captureMail({ quiet: true });

const A_CODE = process.argv[2] || '052';
const B_CODE = process.argv[3] || '025';
const STATE_DIR = process.env.CERT_STATE_DIR || 'C:/Temp/octapm-cert/state';
const RESULTS = 'C:/Temp/octapm-cert/results/cert3/d-id-1-keys.json';
const STAMP = crypto.randomBytes(3).toString('hex');
const PASSWORD = process.env.CERT_PASSWORD;
/**
 * Fixed before the first run: setup 1, K1 3, K2 3, K3 2, K4 1, K5 4, K6 1, final 2 (17).
 * The Codex Q-KEY review adds K1.4 (a second workspace), K4.2 (Activate during
 * a reopening acceptance), K5.3b/c (projects, expiry), K5.5 (an unchanged
 * resend behind a narrowing) and K5.6 (the hold lasts until the write): 23.
 */
const EXPECTED_CHECKS = 23;

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const within = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what}: no answer within ${ms} ms`)), ms).unref())]);
const linkIn = (text, route) => {
  const match = new RegExp(`(https?://[^\\s"'<>]+/${route}\\?token=([A-Za-z0-9_\\-.~%]+))`).exec(text || '');
  return match ? { url: match[1], token: decodeURIComponent(match[2]) } : null;
};

const cleanup = [];
let dbRef = null;
// The second connection that holds an update of a User row uncommitted (K5).
const lockState = { db: null, open: false };

const main = async () => {
  if (!PASSWORD) throw new Error('CERT_PASSWORD is not set');
  if (process.env.CERT_INPROCESS !== '1') throw new Error('run through C:\\Temp\\octapm-cert\\run-locked.js (CERT_INPROCESS=1)');
  const { companies } = buildPopulation();
  const A = companies.find((c) => c.code === A_CODE);
  const B = companies.find((c) => c.code === B_CODE);
  const db = await guard.connectCert();
  dbRef = db;
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const orgA = (await q('select id, name from "Organisation" where slug like $1', [`cert-${A_CODE}-%`]))[0];
  const orgB = (await q('select id, name from "Organisation" where slug like $1', [`cert-${B_CODE}-%`]))[0];
  const aPm = api.as({ email: `pm@${A.domain}`, orgId: orgA.id });
  const aOwner = api.as({ email: A.people.find((p) => p.isOwner)?.email, orgId: orgA.id });
  const bPm = api.as({ email: `pm@${B.domain}`, orgId: orgB.id });
  const bOwner = api.as({ email: B.people.find((p) => p.isOwner)?.email, orgId: orgB.id });
  const aPmId = (await q('select id from "User" where email = $1', [`pm@${A.domain}`]))[0]?.id;
  const projectA = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'inventory', `${A.code}.json`), 'utf8')).projects[`${A.code}-01`].id;
  const authService = require('../../../src/services/auth.service');
  const membershipService = require('../../../src/services/membership.service');
  const abuse = require('../../../src/services/auth-abuse.service');
  console.log(`d-id-1 keys proof: A ${A_CODE}; project ${projectA}; stamp ${STAMP}, in process`);

  const userRow = async (id) => (await q('select id, status, "credentialEpoch" from "User" where id = $1', [id]))[0] || null;
  const keyRow = async (id) => (await q('select id, status, "revokedAt", "createdBy", "userId", scopes from "ApiClient" where id = $1', [id]))[0] || null;
  const keysBy = async (userId) => (await q('select id from "ApiClient" where "createdBy" = $1', [userId])).map((r) => r.id);
  const revokedAudit = async (keyId) => q(
    'select "metadataJson"->>\'reason\' as reason, "actorId", "userId", "orgId" from "AuthAuditEvent" where "entityType" = \'api_client\' and action = \'api_key_revoked\' and "entityId" = $1',
    [keyId],
  );
  const make = async (label, { admin = false } = {}) => {
    const email = `did1k.${label}.${STAMP}@${A.domain}`;
    const made = await invitations.createByInvitation({ inviter: aPm, email, role: 'qs', name: `DID1K ${label} ${STAMP}`, db });
    keep(`make ${label} invite`, made.invited);
    keep(`make ${label} accept`, made.accepted);
    const granted = admin ? keep(`grant ${label}`, await aOwner.send('PATCH', `/users/${made.userId}`, { isCompanyAdmin: true })) : null;
    return { label, email, id: made.userId, ok: Boolean(made.userId) && (!admin || granted?.status === 200), said: `${said(made.accepted)}${granted ? `/${said(granted)}` : ''}` };
  };
  const createdKeys = [];
  // Always in a named workspace (A unless `orgId` says otherwise): a person in two workspaces is never signed in to "the first".
  const createKey = async (who, label, { ownerId = null, scopes = ['*:read'], token = undefined, orgId = orgA.id, extra = {} } = {}) => {
    const res = keep(`key ${label}`, await api.as({ email: who.email || who, orgId }).send('POST', '/integrations/api-clients', { name: `DID1K ${label} ${STAMP}`, scopes, ...(ownerId ? { userId: ownerId } : {}), ...extra }, token === undefined ? {} : { token }));
    const key = res.status === 201 ? { id: res.body?.data?.id, token: res.body?.data?.token, label } : { id: null, token: null, label };
    if (key.id) createdKeys.push(key.id);
    return { ...key, res };
  };
  // A key at work: a module read with it as the bearer.
  const useKey = (key) => api.raw('GET', '/projects', { token: key.token || `octapm_${'x'.repeat(32)}` });
  const selfReset = async (email, password) => {
    const before = invitations.mailsTo(email).length;
    const forgotRes = keep(`forgot ${email}`, await api.raw('POST', '/auth/forgot-password', { json: { email } }));
    await authService.flushPasswordResetDeliveries();
    const link = invitations.mailsTo(email).slice(before).reverse().map((m) => linkIn(m, 'reset-password')).find(Boolean);
    const resetRes = keep(`reset ${email}`, await api.raw('POST', '/auth/reset-password', { json: { token: link?.token || 'x'.repeat(43), password } }));
    api.forget(email);
    return { ok: forgotRes.status === 200 && Boolean(link) && resetRes.status === 200 && resetRes.body?.data?.reset === true, said: `forgot ${said(forgotRes)}, link ${Boolean(link)}, reset ${said(resetRes)}` };
  };
  const dead = (res) => said(res) === '401 API_KEY_INVALID';
  const revokedRow = (row) => row?.status === 'revoked' && Boolean(row?.revokedAt);
  cleanup.push(async () => {
    const live = (await q('select id from "ApiClient" where id = any($1::text[]) and status = \'active\'', [createdKeys])).map((r) => r.id);
    const outcomes = [];
    for (const id of live) outcomes.push(said(await aPm.send('DELETE', `/integrations/api-clients/${id}`)));
    return `keys revoked at the end: ${live.length} (${outcomes.join(', ') || 'none live'})`;
  });

  // ── set-up ────────────────────────────────────────────────────────────────
  console.log('── set-up ──');
  const T = await make('target');
  const KR = await make('reset', { admin: true });
  const KM = await make('mfa', { admin: true });
  const KC = await make('close', { admin: true });
  const KO = await make('reopen', { admin: true });
  const KQ = await make('race-held', { admin: true });
  const KG = await make('race-gate', { admin: true });
  const KW = await make('widen', { admin: true });
  const KH = await make('race-hold', { admin: true });
  const KO2 = await make('reopen-race');
  const people = [T, KR, KM, KC, KO, KQ, KG, KW, KH, KO2];
  // KR is also an administrator of B (invitation, acceptance, B's owner's grant): a reset reaches every workspace.
  const krJoinB = await invitations.joinByInvitation({ inviter: bPm, email: KR.email, role: 'qs', name: `DID1K reset ${STAMP}`, homeOrgId: orgA.id, db });
  const krAdminB = keep('B grants KR', await bOwner.send('PATCH', `/users/${KR.id}`, { isCompanyAdmin: true }));
  // KM has a second factor, as an admin MFA reset assumes.
  const kmToken = await api.tokenFor(KM.email, orgA.id);
  const kmSetup = keep('KM mfa setup', await api.raw('POST', '/auth/mfa/setup', { token: kmToken, json: {} }));
  const kmEnable = keep('KM mfa enable', await api.raw('POST', '/auth/mfa/enable', { token: kmToken, json: { code: totp(kmSetup.body?.data?.secret || '') } }));
  api.forget(KM.email);
  const KR1 = await createKey(KR, 'KR1 own');
  const KR2 = await createKey(KR, 'KR2 as T', { ownerId: T.id });
  const ZR = await createKey(aPm, 'ZR pm as KR', { ownerId: KR.id });
  // KM signs in with a second factor now; the session from before enabling it stays valid.
  const KM1 = await createKey(KM, 'KM1 own', { token: kmToken });
  const KM2 = await createKey(KM, 'KM2 as T', { ownerId: T.id, token: kmToken });
  const ZM = await createKey(aPm, 'ZM pm as KM', { ownerId: KM.id });
  const KC1 = await createKey(KC, 'KC1 as T', { ownerId: T.id });
  const KO1 = await createKey(KO, 'KO1 as T', { ownerId: T.id });
  const KW_EXPIRY = '2030-01-01T00:00:00.000Z';
  const KW1 = await createKey(KW, 'KW1 narrow', { scopes: ['rfi:read'], extra: { projectIds: [projectA], expiresAt: KW_EXPIRY } });
  const KZ = await createKey(aPm, 'KZ pm wide', { scopes: ['*:read'] });
  const KB1 = await createKey(KR, 'KB1 KR in B', { orgId: orgB.id });
  const keysMade = [KR1, KR2, ZR, KM1, KM2, ZM, KC1, KO1, KW1, KZ, KB1];
  const working = [];
  // KW1 reads RFIs on one project only; it is created (201) and used only to be widened.
  for (const key of keysMade.filter((k) => k !== KW1)) working.push([key.label, said(keep(`use ${key.label}`, await useKey(key)))]);
  lockState.db = await guard.connectCert();
  const lockPid = (await lockState.db.query('select pg_backend_pid() as pid')).rows[0].pid;
  check('setup: throwaway administrators made by invitation, acceptance and the owner\'s grant (KR also an administrator of B); KM with MFA on; eleven keys created through the API (each 201), the ten broad ones answering 200 on GET /projects; a second database connection ready',
    people.every((p) => p.ok) && krJoinB.accepted?.status === 200 && krAdminB.status === 200 && kmEnable.status === 200 && keysMade.every((k) => k.res.status === 201 && k.id && k.token) && working.every(([, s]) => s === '200') && Number.isInteger(lockPid),
    JSON.stringify({ people: people.map((p) => `${p.label}:${p.said}`), krB: `${said(krJoinB.accepted)}/${said(krAdminB)}`, mfa: `${said(kmSetup)}/${said(kmEnable)}`, keys: keysMade.map((k) => `${k.label}:${said(k.res)}`), working }));
  if (!results.every((r) => r.ok)) throw new Error('setup incomplete');
  const printBefore = await fingerprint.take(db);

  // ── K1 a self-service reset ───────────────────────────────────────────────
  console.log('\n── K1 a self-service reset ──');
  const krReset = await selfReset(KR.email, `KeyReset-${STAMP}-pass1`);
  const k1 = { kr1: said(keep('KR1 after reset', await useKey(KR1))), kr2: said(keep('KR2 after reset', await useKey(KR2))), zr: said(keep('ZR after reset', await useKey(ZR))) };
  const k1Rows = { kr1: await keyRow(KR1.id), kr2: await keyRow(KR2.id), zr: await keyRow(ZR.id) };
  check('K1.1 after KR completes a self-service reset, both keys KR created (one acting as KR, one acting as T) answer 401 API_KEY_INVALID and are stored revoked with revokedAt',
    krReset.ok && k1.kr1 === '401 API_KEY_INVALID' && k1.kr2 === '401 API_KEY_INVALID' && revokedRow(k1Rows.kr1) && revokedRow(k1Rows.kr2),
    `reset: ${krReset.said}; KR1 ${k1.kr1} ${k1Rows.kr1?.status}; KR2 ${k1.kr2} ${k1Rows.kr2?.status}`);
  check('K1.2 the key the PM created acting as KR keeps working (200, still active): only keys the person created are revoked',
    k1.zr === '200' && k1Rows.zr?.status === 'active', `ZR ${k1.zr} ${k1Rows.zr?.status}`);
  const k1Audit = { kr1: await revokedAudit(KR1.id), kr2: await revokedAudit(KR2.id), zr: await revokedAudit(ZR.id) };
  check('K1.3 one api_key_revoked audit row per revoked key, reason password_reset, about KR in A; none for the PM\'s key',
    [k1Audit.kr1, k1Audit.kr2].every((rows) => rows.length === 1 && rows[0].reason === 'password_reset' && rows[0].userId === KR.id && rows[0].orgId === orgA.id) && k1Audit.zr.length === 0,
    JSON.stringify(k1Audit));
  const k1b = said(keep('KB1 after reset', await useKey(KB1)));
  const k1bRow = await keyRow(KB1.id);
  const k1bAudit = await revokedAudit(KB1.id);
  check('K1.4 the same reset revokes the key KR created in workspace B (401 API_KEY_INVALID, stored revoked), audited in B with reason password_reset: a reset reaches every workspace',
    k1b === '401 API_KEY_INVALID' && revokedRow(k1bRow) && k1bAudit.length === 1 && k1bAudit[0].orgId === orgB.id && k1bAudit[0].reason === 'password_reset',
    `KB1 ${k1b} ${k1bRow?.status}; audit ${JSON.stringify(k1bAudit)}`);

  // ── K2 an administrator's MFA reset ───────────────────────────────────────
  console.log('\n── K2 an administrator\'s MFA reset ──');
  const kmReset = keep('PM resets KM\'s MFA', await aPm.send('POST', `/company/security/users/${KM.id}/mfa/reset`, {}));
  const k2 = { km1: said(keep('KM1 after MFA reset', await useKey(KM1))), km2: said(keep('KM2 after MFA reset', await useKey(KM2))), zm: said(keep('ZM after MFA reset', await useKey(ZM))) };
  const k2Rows = { km1: await keyRow(KM1.id), km2: await keyRow(KM2.id), zm: await keyRow(ZM.id) };
  check('K2.1 after the PM resets KM\'s second factor, both keys KM created answer 401 API_KEY_INVALID and are stored revoked',
    kmReset.status === 200 && k2.km1 === '401 API_KEY_INVALID' && k2.km2 === '401 API_KEY_INVALID' && revokedRow(k2Rows.km1) && revokedRow(k2Rows.km2),
    `reset ${said(kmReset)}; KM1 ${k2.km1} ${k2Rows.km1?.status}; KM2 ${k2.km2} ${k2Rows.km2?.status}`);
  check('K2.2 the key the PM created acting as KM keeps working (200, still active)', k2.zm === '200' && k2Rows.zm?.status === 'active', `ZM ${k2.zm} ${k2Rows.zm?.status}`);
  const k2Audit = { km1: await revokedAudit(KM1.id), km2: await revokedAudit(KM2.id) };
  check('K2.3 one api_key_revoked audit row per key, reason mfa_reset_by_admin, the PM as actor',
    Object.values(k2Audit).every((rows) => rows.length === 1 && rows[0].reason === 'mfa_reset_by_admin' && rows[0].actorId === aPmId && rows[0].userId === KM.id),
    JSON.stringify(k2Audit));

  // ── K3 the identity closed ────────────────────────────────────────────────
  console.log('\n── K3 the identity closed ──');
  const kcClose = keep('PM deactivates KC', await aPm.send('PATCH', `/users/${KC.id}/deactivate`, {}));
  const kcIdentity = (await userRow(KC.id))?.status;
  const k3 = said(keep('KC1 after close', await useKey(KC1)));
  const k3Row = await keyRow(KC1.id);
  const tStatus = (await userRow(T.id))?.status;
  check('K3.1 deactivating KC in their only workspace closes the identity, and the key KC created acting as T (still active) answers 401 API_KEY_INVALID — revoked, not refused for its owner — and is stored revoked',
    kcClose.status === 200 && kcIdentity === 'inactive' && tStatus === 'active' && k3 === '401 API_KEY_INVALID' && revokedRow(k3Row),
    `deactivate ${said(kcClose)}; identity ${kcIdentity}; T ${tStatus}; KC1 ${k3} ${k3Row?.status}`);
  const k3Audit = await revokedAudit(KC1.id);
  check('K3.2 one api_key_revoked audit row, reason identity_closed, the PM as actor',
    k3Audit.length === 1 && k3Audit[0].reason === 'identity_closed' && k3Audit[0].actorId === aPmId && k3Audit[0].userId === KC.id, JSON.stringify(k3Audit));

  // ── K4 a closed identity reopened ─────────────────────────────────────────
  console.log('\n── K4 a closed identity reopened ──');
  const koClose = keep('PM deactivates KO', await aPm.send('PATCH', `/users/${KO.id}/deactivate`, {}));
  // Fixture: the close missed KO1, and KO left A (a person who left may be
  // invited back; a suspended one may not — owner decision Q3).
  const koFixture = {
    key: (await db.query('update "ApiClient" set status = \'active\', "revokedAt" = null where id = $1', [KO1.id])).rowCount,
    left: (await db.query('update "OrganizationMembership" set status = \'left\', "leftAt" = now() where "orgId" = $1 and "userId" = $2', [orgA.id, KO.id])).rowCount,
  };
  const koWorkingAgain = said(keep('KO1 after the fixture', await useKey(KO1)));
  const koMails = invitations.mailsTo(KO.email).length;
  const koInvite = keep('PM re-invites KO', await aPm.send('POST', '/users/invitations', { email: KO.email, role: 'qs' }));
  const koToken = koInvite.status === 201 ? await invitations.invitationTokenFor({ email: KO.email, invitationId: koInvite.body?.data?.id, after: koMails, db }) : null;
  const koAccept = keep('KO accepts', await api.raw('POST', '/auth/invitations/accept', { json: { token: koToken || 'x'.repeat(43), name: `DID1K reopen ${STAMP}`, password: `Reopen-${STAMP}-pass5` } }));
  const koIdentity = (await userRow(KO.id))?.status;
  const k4 = said(keep('KO1 after reopen', await useKey(KO1)));
  const k4Row = await keyRow(KO1.id);
  const k4Audit = (await revokedAudit(KO1.id)).map((r) => r.reason);
  // Without the owner's T standing changing, the fixture key worked (200) before the reopen.
  check('K4.1 reopening KO\'s closed identity by re-invitation and acceptance (a new password) revokes the key KO created that was still active (fixture): 401 API_KEY_INVALID, stored revoked, audit reasons identity_closed then identity_reopened',
    koClose.status === 200 && koFixture.key === 1 && koFixture.left === 1 && koWorkingAgain === '200' && koInvite.status === 201 && koAccept.status === 200 && koIdentity === 'active' && k4 === '401 API_KEY_INVALID' && revokedRow(k4Row) && k4Audit.includes('identity_reopened'),
    `close ${said(koClose)}; fixture ${JSON.stringify(koFixture)}; KO1 before ${koWorkingAgain}; invite ${said(koInvite)}; accept ${said(koAccept)}; identity ${koIdentity}; KO1 ${k4} ${k4Row?.status}; audit ${k4Audit.join(',')}`);

  // K4.2 (Codex Q-KEY review H1): the acceptance read KO2 as closed, then KO2
  // was reopened before the acceptance's transaction began. Codex's path (an
  // Activate) is not reachable: Activate answers 404 USER_NOT_FOUND for a
  // person who left (proven here first). So the reopening is a fixture (the
  // identity set active by SQL while the acceptance is held at the start of its
  // transaction). The acceptance must not reopen and re-password an open
  // account: it needs the person's own session.
  const ko2Close = keep('PM deactivates KO2', await aPm.send('PATCH', `/users/${KO2.id}/deactivate`, {}));
  const ko2Left = (await db.query('update "OrganizationMembership" set status = \'left\', "leftAt" = now() where "orgId" = $1 and "userId" = $2', [orgA.id, KO2.id])).rowCount;
  const ko2Mails = invitations.mailsTo(KO2.email).length;
  const ko2Invite = keep('PM re-invites KO2', await aPm.send('POST', '/users/invitations', { email: KO2.email, role: 'qs' }));
  const ko2Token = ko2Invite.status === 201 ? await invitations.invitationTokenFor({ email: KO2.email, invitationId: ko2Invite.body?.data?.id, after: ko2Mails, db }) : null;
  const ko2HashBefore = (await q('select "passwordHash" from "User" where id = $1', [KO2.id]))[0]?.passwordHash;
  const prismaClient = global.__prisma || null;
  const realTransaction = prismaClient ? prismaClient.$transaction : null;
  let txArmed = false;
  let txReached = false;
  let releaseTx = () => {};
  const txGate = new Promise((resolve) => { releaseTx = resolve; });
  let ko2Accept = null;
  let ko2Activate = null;
  let ko2Reopened = 0;
  let txInstalled = false;
  try {
    if (prismaClient && typeof realTransaction === 'function') {
      prismaClient.$transaction = async function gatedTransaction(...args) {
        if (txArmed && typeof args[0] === 'function') {
          txArmed = false;
          txReached = true;
          await txGate;
        }
        return realTransaction.apply(this, args);
      };
      txInstalled = require('../../../src/config/db').prisma.$transaction === prismaClient.$transaction;
    }
    txArmed = txInstalled;
    let settled = false;
    const pending = api.raw('POST', '/auth/invitations/accept', { json: { token: ko2Token || 'x'.repeat(43), name: `DID1K reopen race ${STAMP}`, password: `Raced-${STAMP}-pass8` } }).finally(() => { settled = true; });
    pending.catch(() => null);
    const until = Date.now() + 5000;
    while (!txReached && !settled && Date.now() < until) await sleep(20);
    txArmed = false;
    if (txReached) {
      ko2Activate = keep('PM tries to activate KO2 (left)', await aPm.send('PATCH', `/users/${KO2.id}/activate`, {}));
      ko2Reopened = (await db.query('update "User" set status = \'active\' where id = $1 and status = \'inactive\'', [KO2.id])).rowCount;
    }
    releaseTx();
    ko2Accept = keep('KO2 acceptance after the Activate', await within(pending, 30_000, 'K4.2'));
  } finally {
    txArmed = false;
    releaseTx();
    if (prismaClient && typeof realTransaction === 'function') prismaClient.$transaction = realTransaction;
  }
  const ko2Row = (await q('select status, "passwordHash" from "User" where id = $1', [KO2.id]))[0];
  const ko2Link = (await q('select status from "InvitationToken" where id = $1', [ko2Invite.body?.data?.id || '']))[0]?.status;
  check('K4.2 Activate cannot reopen a person who left (404 USER_NOT_FOUND); an acceptance that read the identity as closed, held while the identity is reopened (fixture), answers 401 INVITATION_SIGN_IN_REQUIRED: the password is not replaced, the link stays pending',
    ko2Close.status === 200 && ko2Left === 1 && ko2Invite.status === 201 && txInstalled && txReached && said(ko2Activate) === '404 USER_NOT_FOUND' && ko2Reopened === 1 && said(ko2Accept) === '401 INVITATION_SIGN_IN_REQUIRED' && ko2Row?.passwordHash === ko2HashBefore && ko2Row?.status === 'active' && ko2Link === 'pending',
    `close ${said(ko2Close)}; left ${ko2Left}; invite ${said(ko2Invite)}; gate ${txInstalled}/${txReached}; activate ${said(ko2Activate)}; reopened by fixture ${ko2Reopened}; accept ${said(ko2Accept)} ${ko2Accept?.text || ''}; hash kept ${ko2Row?.passwordHash === ko2HashBefore}; identity ${ko2Row?.status}; link ${ko2Link}`);
  if (ko2Invite.body?.data?.id) cleanup.push(async () => `KO2 link revoked: ${said(await aPm.send('DELETE', `/users/invitations/${ko2Invite.body.data.id}`))}`);

  // ── K5 creation and widening hold the actor's epoch; revocation does not wait ──
  console.log('\n── K5 creation and widening hold the actor\'s credential epoch ──');
  const blockedOnLock = async () => q(
    `select l.pid, l.locktype, left(regexp_replace(coalesce(a.query, ''), '\\s+', ' ', 'g'), 160) as query
       from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where not l.granted and $1::int = any(pg_blocking_pids(l.pid))`,
    [lockPid],
  );
  // An uncommitted reset-like update of the User row (credentialEpoch + 1)
  // held on the second connection while `start` runs; committed (or rolled
  // back) once a backend is seen waiting on it or `waitMs` passes.
  const withHeldRow = (userId, start, options = {}) =>
    withHeld('update "User" set "credentialEpoch" = "credentialEpoch" + 1 where id = $1', [userId], start, options);
  // Any uncommitted write `sql` held on the second connection while `start` runs.
  const withHeld = async (sql, params, start, { waitMs = 4000, finish = 'commit' } = {}) => {
    await lockState.db.query('begin');
    lockState.open = true;
    const updated = (await lockState.db.query(sql, params)).rowCount;
    let settled = false;
    const pending = Promise.resolve().then(start).finally(() => { settled = true; });
    pending.catch(() => null);
    let waiting = [];
    const until = Date.now() + waitMs;
    while (!settled && Date.now() < until) {
      waiting = await blockedOnLock();
      if (waiting.length) break;
      await sleep(20);
    }
    const answeredWhileHeld = settled;
    lockState.open = false;
    await lockState.db.query(finish);
    const res = await within(pending, 30_000, 'held-row request');
    return { res, updated, waited: waiting.length > 0, answeredWhileHeld, path: waiting.length ? `waited at: ${waiting[0].query}` : answeredWhileHeld ? 'answered while the row was held' : 'no wait seen' };
  };

  // K5.1 create while the reset-like update of the actor's row is held.
  const kqToken = await api.tokenFor(KQ.email, orgA.id);
  const kqBefore = await keysBy(KQ.id);
  const r51 = await withHeldRow(KQ.id, () => api.raw('POST', '/integrations/api-clients', { token: kqToken, json: { name: `DID1K race held ${STAMP}`, scopes: ['*:read'] } }));
  keep('K5.1 create', r51.res);
  const kqAfter = (await keysBy(KQ.id)).filter((id) => !kqBefore.includes(id));
  createdKeys.push(...kqAfter);
  console.log(`        K5.1 create: ${said(r51.res)}; path: ${r51.path}`);
  check('K5.1 a key create started while a reset-like update of the actor\'s User row (credentialEpoch + 1) is held uncommitted waits on it and then answers 401 SESSION_REVOKED; no key row is written',
    r51.updated === 1 && r51.waited && said(r51.res) === '401 SESSION_REVOKED' && kqAfter.length === 0,
    `${said(r51.res)} ${r51.res?.text || ''}; path ${r51.path}; keys written ${kqAfter.length}`);

  // K5.2 create parked after authentication while a real self-service reset completes.
  const kgToken = await api.tokenFor(KG.email, orgA.id);
  const kgBefore = await keysBy(KG.id);
  const realFindUserInOrg = membershipService.findUserInOrg;
  let gateReached = false;
  let openGate = () => {};
  const gate = new Promise((resolve) => { openGate = resolve; });
  let armed = true;
  membershipService.findUserInOrg = async (args = {}, ...rest) => {
    if (armed && args.userId === KG.id) {
      armed = false;
      gateReached = true;
      await gate;
    }
    return realFindUserInOrg(args, ...rest);
  };
  let r52;
  let kgReset = { ok: false, said: 'not run (the create never reached the owner lookup)' };
  try {
    let settled = false;
    const pending = api.raw('POST', '/integrations/api-clients', { token: kgToken, json: { name: `DID1K race gate ${STAMP}`, scopes: ['*:read'] } }).finally(() => { settled = true; });
    pending.catch(() => null);
    const until = Date.now() + 5000;
    while (!gateReached && !settled && Date.now() < until) await sleep(20);
    if (gateReached) kgReset = await selfReset(KG.email, `KeyGate-${STAMP}-pass2`);
    openGate();
    r52 = keep('K5.2 create (gate)', await within(pending, 30_000, 'K5.2'));
  } finally {
    armed = false;
    openGate();
    membershipService.findUserInOrg = realFindUserInOrg;
  }
  const kgAfter = (await keysBy(KG.id)).filter((id) => !kgBefore.includes(id));
  createdKeys.push(...kgAfter);
  check('K5.2 a key create held after authentication (at the owner lookup) while a real self-service reset of the actor completes answers 401 SESSION_REVOKED; no key row is written',
    gateReached && kgReset.ok && said(r52) === '401 SESSION_REVOKED' && kgAfter.length === 0,
    `gate ${gateReached}; reset: ${kgReset.said}; answer ${said(r52)} ${r52?.text || ''}; keys written ${kgAfter.length}`);

  // K5.3 widening while the actor's row is held.
  const kwToken = await api.tokenFor(KW.email, orgA.id);
  const r53 = await withHeldRow(KW.id, () => api.raw('PATCH', `/integrations/api-clients/${KW1.id}`, { token: kwToken, json: { scopes: ['*:write'] } }));
  keep('K5.3 widen', r53.res);
  api.forget(KW.email);
  const kw1After = await keyRow(KW1.id);
  console.log(`        K5.3 widen: ${said(r53.res)}; path: ${r53.path}`);
  check('K5.3 widening a key (rfi:read -> *:write) started while a reset-like update of the actor\'s row is held waits and answers 401 SESSION_REVOKED; the key keeps its one scope',
    r53.updated === 1 && r53.waited && said(r53.res) === '401 SESSION_REVOKED' && JSON.stringify(kw1After?.scopes) === JSON.stringify(['rfi:read']) && kw1After?.status === 'active',
    `${said(r53.res)} ${r53.res?.text || ''}; path ${r53.path}; scopes ${JSON.stringify(kw1After?.scopes)} ${kw1After?.status}`);

  // K5.3b/c (Codex Q-KEY review G2): projects and expiry are reach too.
  // Each token is minted before the row is held: a sign-in behind a held credential event is refused itself (C12.11).
  const kwTokenB = await api.tokenFor(KW.email, orgA.id);
  const kwProjects = await withHeldRow(KW.id, () => api.raw('PATCH', `/integrations/api-clients/${KW1.id}`, { token: kwTokenB, json: { projectIds: [] } }));
  keep('K5.3b widen projects', kwProjects.res);
  api.forget(KW.email);
  const kw1Projects = (await q('select "projectIds" from "ApiClient" where id = $1', [KW1.id]))[0]?.projectIds;
  check('K5.3b widening a key from one project to every project, started while a reset-like update of the actor\'s row is held, waits and answers 401 SESSION_REVOKED; the key keeps its one project',
    kwProjects.updated === 1 && kwProjects.waited && said(kwProjects.res) === '401 SESSION_REVOKED' && JSON.stringify(kw1Projects) === JSON.stringify([projectA]),
    `${said(kwProjects.res)} ${kwProjects.res?.text || ''}; path ${kwProjects.path}; projects ${JSON.stringify(kw1Projects)}`);
  const kwTokenC = await api.tokenFor(KW.email, orgA.id);
  const kwExpiry = await withHeldRow(KW.id, () => api.raw('PATCH', `/integrations/api-clients/${KW1.id}`, { token: kwTokenC, json: { expiresAt: null } }));
  keep('K5.3c widen expiry', kwExpiry.res);
  api.forget(KW.email);
  // As stored (timestamp without zone, UTC by Prisma), read as text: the pg driver would read it as local time.
  const kw1Expiry = (await q('select "expiresAt"::text as e from "ApiClient" where id = $1', [KW1.id]))[0]?.e;
  check('K5.3c removing a key\'s expiry, started while a reset-like update of the actor\'s row is held, waits and answers 401 SESSION_REVOKED; the key keeps its expiry',
    kwExpiry.updated === 1 && kwExpiry.waited && said(kwExpiry.res) === '401 SESSION_REVOKED' && kw1Expiry === '2030-01-01 00:00:00',
    `${said(kwExpiry.res)} ${kwExpiry.res?.text || ''}; path ${kwExpiry.path}; expiry ${kw1Expiry}`);

  // K5.5 (Codex Q-KEY review H2): a PATCH that resends a key's reach unchanged,
  // queued behind a narrowing of that key, must not write the old reach back.
  const kwTokenD = await api.tokenFor(KW.email, orgA.id);
  const r55 = await withHeld('update "ApiClient" set scopes = ARRAY[\'rfi:read\']::text[] where id = $1', [KZ.id],
    () => api.raw('PATCH', `/integrations/api-clients/${KZ.id}`, { token: kwTokenD, json: { name: `DID1K KZ renamed ${STAMP}`, scopes: ['*:read'] } }));
  keep('K5.5 resend behind a narrowing', r55.res);
  const kzAfter = (await q('select name, scopes from "ApiClient" where id = $1', [KZ.id]))[0];
  console.log(`        K5.5 resend: ${said(r55.res)}; path: ${r55.path}`);
  check('K5.5 a PATCH that renames a key and resends its scopes unchanged, queued behind an uncommitted narrowing of the key (*:read -> rfi:read), answers 200 and keeps the narrowing: only the name is written',
    r55.updated === 1 && r55.waited && r55.res?.status === 200 && kzAfter?.name === `DID1K KZ renamed ${STAMP}` && JSON.stringify(kzAfter?.scopes) === JSON.stringify(['rfi:read']),
    `${said(r55.res)}; path ${r55.path}; name ${kzAfter?.name}; scopes ${JSON.stringify(kzAfter?.scopes)}`);

  // K5.6 (Codex Q-KEY review G1): the hold lasts until the key is written. A
  // create parked just after its hold keeps a real reset of the actor waiting;
  // once released, the key commits first and the reset then revokes it.
  const khToken = await api.tokenFor(KH.email, orgA.id);
  const khBefore = await keysBy(KH.id);
  const realHold = authService.holdCredentialEpoch;
  let holdArmed = true;
  let holdReached = false;
  let releaseHold = () => {};
  const holdGate = new Promise((resolve) => { releaseHold = resolve; });
  authService.holdCredentialEpoch = async (tx, userId, epoch, ...rest) => {
    const held = await realHold(tx, userId, epoch, ...rest);
    if (holdArmed && userId === KH.id) {
      holdArmed = false;
      holdReached = true;
      await holdGate;
    }
    return held;
  };
  let r56 = null;
  let khResetRes = null;
  let resetWhileParked = null;
  try {
    let createSettled = false;
    const createPending = api.raw('POST', '/integrations/api-clients', { token: khToken, json: { name: `DID1K race hold ${STAMP}`, scopes: ['*:read'] } }).finally(() => { createSettled = true; });
    createPending.catch(() => null);
    const until = Date.now() + 5000;
    while (!holdReached && !createSettled && Date.now() < until) await sleep(20);
    let resetPending = null;
    if (holdReached) {
      const before = invitations.mailsTo(KH.email).length;
      keep('KH forgot', await api.raw('POST', '/auth/forgot-password', { json: { email: KH.email } }));
      await authService.flushPasswordResetDeliveries();
      const link = invitations.mailsTo(KH.email).slice(before).reverse().map((m) => linkIn(m, 'reset-password')).find(Boolean);
      let resetSettled = false;
      resetPending = api.raw('POST', '/auth/reset-password', { json: { token: link?.token || 'x'.repeat(43), password: `KeyHold-${STAMP}-pass4` } }).finally(() => { resetSettled = true; });
      resetPending.catch(() => null);
      await sleep(2000);
      resetWhileParked = resetSettled;
    }
    releaseHold();
    r56 = keep('K5.6 create (held)', await within(createPending, 30_000, 'K5.6 create'));
    khResetRes = resetPending ? keep('K5.6 reset', await within(resetPending, 30_000, 'K5.6 reset')) : null;
  } finally {
    holdArmed = false;
    releaseHold();
    authService.holdCredentialEpoch = realHold;
    api.forget(KH.email);
  }
  const khNew = (await keysBy(KH.id)).filter((id) => !khBefore.includes(id));
  createdKeys.push(...khNew);
  const khKey = khNew.length === 1 ? await keyRow(khNew[0]) : null;
  const khAudit = khKey ? (await revokedAudit(khKey.id)).map((r) => r.reason) : [];
  check('K5.6 a key create parked just after its epoch hold keeps a real self-service reset of the actor waiting (not answered within 2 s); released, the create answers 201, the reset 200, and the new key ends revoked by the reset (audit reason password_reset)',
    holdReached && resetWhileParked === false && r56?.status === 201 && khResetRes?.status === 200 && revokedRow(khKey) && khAudit.includes('password_reset'),
    `hold reached ${holdReached}; reset answered while parked ${resetWhileParked}; create ${said(r56)}; reset ${said(khResetRes)}; key ${khKey?.status}; audit ${khAudit.join(',')}`);

  // K5.4 revoking while the actor's row is held: answered before the release (rolled back, no event).
  const kwFresh = await api.tokenFor(KW.email, orgA.id);
  const r54 = await withHeldRow(KW.id, () => api.raw('DELETE', `/integrations/api-clients/${KW1.id}`, { token: kwFresh }), { waitMs: 3000, finish: 'rollback' });
  keep('K5.4 revoke', r54.res);
  const kw1Revoked = await keyRow(KW1.id);
  console.log(`        K5.4 revoke: ${said(r54.res)}; path: ${r54.path}`);
  check('K5.4 revoking a key while an update of the actor\'s User row is held uncommitted is answered 200 before the row is released (it never waits on the epoch) and the key is stored revoked',
    r54.updated === 1 && r54.answeredWhileHeld && !r54.waited && r54.res?.status === 200 && revokedRow(kw1Revoked),
    `${said(r54.res)}; path ${r54.path}; KW1 ${kw1Revoked?.status}`);

  // ── K6 a fresh session can still create a key ─────────────────────────────
  console.log('\n── K6 control ──');
  api.forget(KG.email);
  abuse.resetAuthAbuseState();
  // KG's password changed in K5.2; a fresh sign-in uses the new one.
  const kgLogin = keep('KG new password', await api.raw('POST', '/auth/login', { json: { email: KG.email, password: `KeyGate-${STAMP}-pass2` } }));
  const kgNewToken = kgLogin.body?.data?.tokens?.accessToken || null;
  const K6 = kgNewToken ? await createKey(KG, 'K6 control', { token: kgNewToken }) : { res: null, id: null };
  const k6Use = K6.id ? said(keep('use K6', await useKey(K6))) : 'no key';
  check('K6.1 control: after the reset, a fresh sign-in of KG creates a key (201) that answers 200 — the hold refuses only stale sessions',
    kgLogin.status === 200 && K6.res?.status === 201 && k6Use === '200',
    `login ${said(kgLogin)}; create ${said(K6.res)}; use ${k6Use}`);

  // ── final ─────────────────────────────────────────────────────────────────
  console.log('\n── final ──');
  // B takes part (K1.4: KR's key there is revoked by the reset).
  const changes = fingerprint.compare(printBefore, await fingerprint.take(db)).filter((c) => !c.noise && c.org !== A_CODE && c.org !== B_CODE);
  check(`no other company's data (outside ${A_CODE} and ${B_CODE}; noise tables reported apart) changed after set-up`, changes.length === 0, changes.map((c) => `${c.table}:${c.org}`).join(', '));
  const fives = answers.filter((a) => a.status >= 500);
  check('no answer was a 5xx', fives.length === 0, fives.map((a) => `${a.label} ${a.status}`).join(', '));
  return {};
};

const finish = async (error = null) => {
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
  const failed = results.filter((r) => !r.ok).length;
  const complete = results.length === EXPECTED_CHECKS;
  const ok = !error && failed === 0 && complete;
  const out = {
    proof: 'd-id-1-keys-proof',
    checks: ['K1', 'K2', 'K3', 'K4', 'K5', 'K6'],
    stamp: STAMP,
    at: new Date().toISOString(),
    expected: EXPECTED_CHECKS,
    total: results.length,
    passed: results.length - failed,
    failed,
    error: error ? String(error.stack || error.message) : null,
    cleanup: cleaned,
    results,
  };
  try {
    fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
    fs.writeFileSync(RESULTS, `${JSON.stringify(out, null, 2)}\n`);
  } catch (e) {
    console.error(`could not write ${RESULTS}: ${e.message}`);
  }
  console.log(`\nd-id-1 keys proof: ${results.length - failed} passed, ${failed} failed of ${results.length} (fixed count ${EXPECTED_CHECKS})${complete ? '' : ' — INCOMPLETE'}`);
  process.exitCode = error ? 1 : ok ? 0 : 2;
};

main()
  .then(() => finish())
  .catch(async (error) => {
    console.error(`SCRIPT ERROR: ${error.stack || error.message}`);
    await finish(error);
  })
  .finally(() => {
    // The in-process app keeps database handles open; leave once the result is written.
    setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
  });
