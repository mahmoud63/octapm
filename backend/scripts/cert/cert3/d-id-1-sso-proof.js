'use strict';

/**
 * D-ID-1 proof P3 (CERT-3 plan §2.8): single sign-on is not a door (C10),
 * cannot touch the identity's own security (C13), and a session it issued is
 * identity proof for an invitation but never a session in the inviting
 * workspace (C14).
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/d-id-1-sso-proof.js [X=052] [Y=025] [Z=026]
 *
 * X is the home workspace of the person P, Y a second workspace P is an
 * active member of, Z the workspace that invites P. Each runs its own
 * throwaway OpenID Connect provider on 127.0.0.1 (the L10 provider: discovery,
 * JWKS and a token endpoint that asserts whatever e-mail and subject the proof
 * sets), configured through PUT /company/security/sso. The SSO settings of X,
 * Y and Z are restored at the end from the values read before.
 *
 * Throwaway people, made through the product (invitation, then acceptance):
 *   P  homed in X (an e-mail on a run-unique sub-domain), active member of Y
 *   Q  homed in Y                       G  homed in Y; its membership row is
 *   E  homed in X, not in Y                removed (fixture: a legacy home person)
 *   K  homed in X, closed by X          L  homed in X, joined Y, then LEFT in Y (fixture)
 * The fixtures are put back in `finally`.
 *
 * Round 2 (the Codex diff review, findings 1, 3 and 11), with more throwaway
 * people made by invitation: R, M, T and W homed in Y (Y only), D homed in X
 * and a member of Y.
 *   - A ticket issued at the callback but not yet redeemed does not survive a
 *     credential event: R's self-service password reset, Y's admin MFA reset
 *     of M, and Y's deactivation of D (only D's Y ticket; D's X ticket stays).
 *   - Redemption racing a credential event: /auth/sso/complete for T waits
 *     behind an uncommitted credential-epoch bump the proof holds on T's User
 *     row (a second connection), and is refused once it commits.
 *   - First-binding race: two callbacks for W with two subjects, held at W's Y
 *     membership row (FOR UPDATE on a second connection) and released together.
 * Forced interleavings poll pg_locks for the waiter queued behind the proof's
 * own connection (pg_blocking_pids, followed transitively), as the user-add
 * proof does. T keeps its bumped epoch (lowering it would revive tokens).
 *
 * Round 3 (the Codex round-2 review, item 3: the callback inserted its ticket
 * after the reset sweep), with one more throwaway person V homed in Y (Y only):
 *   - The callback against a credential event in flight: V signs in through Y's
 *     provider while the proof holds an uncommitted credential-epoch bump on
 *     V's User row (a second connection). The callback reaches the ticket
 *     transaction's epoch hold (SELECT … FOR NO KEY UPDATE on the User row) and
 *     waits there (seen in pg_locks and pg_stat_activity); the bump commits and
 *     the callback redirects to /sign-in?ssoError=SESSION_REVOKED with no
 *     SsoTicket row written for V.
 *   - The non-racing control: V signs in again and the callback's ticket
 *     redeems 200 bound to Y at V's current (bumped) epoch.
 * V keeps its bumped epoch, as T does.
 *
 * Round 4 (the round-3 review: legacy materialisation outside the lock), with
 * one more throwaway person G2 homed in Y, joined into X by invitation (so a
 * deactivation in Y does not close the identity), whose Y membership row is
 * removed (fixture: a legacy home person, as G):
 *   - The proof holds the (Y, G2's e-mail) advisory lock on its second
 *     connection (the key the callback's legacy branch and deactivateUser
 *     both take). G2's SSO callback queues at that lock (an advisory waiter in
 *     pg_locks; no Y row or ticket written meanwhile), then Y's deactivation of
 *     G2 queues behind it; both are released together. No 5xx or P2002, the
 *     deactivation answers 200, the one Y row is suspended, and G2 gets no Y
 *     session: the callback either redirects with ssoError=USER_INACTIVE (it
 *     ran after the deactivation) or issued a ticket that /auth/sso/complete
 *     refuses (401 SSO_TICKET_INVALID if the deactivation's sweep voided it,
 *     else 403 USER_INACTIVE from the suspended membership).
 *
 * Exit 0 when every check holds, 2 otherwise.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });
// The in-process app's per-request log lines are not wanted in the proof's output (set before the app loads).
process.env.REQUEST_LOG_FORMAT = process.env.REQUEST_LOG_FORMAT || 'off';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const jwt = require('jsonwebtoken');
const api = require('../lib/api');
const invitations = require('../lib/invitations');
const { buildPopulation } = require('../lib/spec');
const guard = require('../lib/cert-env');
const fingerprint = require('../isolation/fingerprint');

invitations.captureMail({ quiet: true });

const NAME = 'd-id-1-sso-proof';
/** Fixed: setup 1, C10 9, C13 10, C14 5, R2 (round 2) 6, R3 (round 3) 2, R4 (round 4) 1, final 2. */
const EXPECTED_CHECKS = 36;
const X_CODE = process.argv[2] || '052';
const Y_CODE = process.argv[3] || '025';
const Z_CODE = process.argv[4] || '026';
const RESULTS_DIR = 'C:/Temp/octapm-cert/results/cert3';
const STAMP = crypto.randomBytes(3).toString('hex');
const PASSWORD = process.env.CERT_PASSWORD;
const NEW_PASSWORD = `Reset-${STAMP}-pass9`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');
/** The link of a given route in a captured mail (the reset mail's /reset-password?token=…). */
const linkIn = (text, route) => {
  const match = new RegExp(`(https?://[^\\s"'<>]+/${route}\\?token=([A-Za-z0-9_\\-.~%]+))`).exec(text || '');
  return match ? { url: match[1], token: decodeURIComponent(match[2]) } : null;
};
const results = [];
const answers = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail: ok ? '' : String(detail || '') });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n        ${detail}` : ''}`);
};
const said = (res) => (res ? `${res.status} ${res.body?.error?.code || ''}`.trim() : 'no answer');
const keep = (label, res) => {
  if (res && typeof res.status === 'number') answers.push({ label, status: res.status });
  return res;
};
const claimsOf = (token) => {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

// ── a throwaway OpenID Connect provider (from leads/l10-sso-cross-org-identity.js) ──
const startIdp = (clientId) => new Promise((resolve) => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = `did1-${clientId}`;
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' };
  let issuer = null;
  let nextClaims = null;
  // Claims for one authorization code: two sign-ins in flight at once (the
  // binding race) each get their own subject and nonce. Any other code gets
  // `nextClaims`, as before.
  const claimsByCode = new Map();
  const server = http.createServer((req, res) => {
    const send = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url.startsWith('/.well-known/openid-configuration')) {
      return send({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/keys`, scopes_supported: ['openid', 'email', 'profile'], code_challenge_methods_supported: ['S256'] });
    }
    if (req.url.startsWith('/keys')) return send({ keys: [jwk] });
    if (req.url.startsWith('/token')) {
      let form = '';
      req.on('data', (chunk) => { form += chunk; });
      req.on('end', () => {
        const code = new URLSearchParams(form).get('code');
        const claims = (code && claimsByCode.get(code)) || nextClaims;
        const idToken = jwt.sign({ ...claims }, privateKey, { algorithm: 'RS256', keyid: kid, expiresIn: '5m', issuer, audience: clientId });
        send({ id_token: idToken, access_token: 'did1-at', token_type: 'Bearer' });
      });
      return undefined;
    }
    res.writeHead(404);
    return res.end('{}');
  });
  server.listen(0, '127.0.0.1', () => {
    issuer = `http://127.0.0.1:${server.address().port}`;
    resolve({ server, issuer, clientId, clientSecret: `secret-${clientId}`, setClaims: (c) => { nextClaims = c; }, setClaimsFor: (code, c) => { claimsByCode.set(code, c); } });
  });
});

/** One SSO sign-in through the real routes: start, the provider asserts `claims`, callback (not followed), then the ticket. */
const ssoSignIn = async (idp, orgId, claims, label) => {
  const start = keep(`${label} start`, await api.raw('POST', '/auth/sso/start', { json: { orgId } }));
  if (start.status !== 200) return { start, location: '', ticket: null, error: `start ${said(start)}`, complete: null, token: null };
  const authUrl = new URL(start.body.data.authorizationUrl);
  idp.setClaims({ email_verified: true, name: `DID1 ${label}`, ...claims, nonce: authUrl.searchParams.get('nonce') });
  const cb = keep(`${label} callback`, await api.raw('GET', `/auth/sso/callback?code=did1-${STAMP}&state=${encodeURIComponent(authUrl.searchParams.get('state'))}`));
  const location = String(cb.headers.get('location') || '');
  const parsed = location ? new URL(location, 'http://invalid.local') : null;
  const ticket = parsed && parsed.pathname.endsWith('/sso/complete') ? parsed.searchParams.get('ticket') : null;
  const error = parsed ? parsed.searchParams.get('ssoError') : null;
  let complete = null;
  if (ticket) complete = keep(`${label} complete`, await api.raw('POST', '/auth/sso/complete', { json: { ticket } }));
  return { start, cb, status: cb.status, location, ticket, error, complete, token: complete?.body?.data?.tokens?.accessToken || null };
};

/**
 * The first half of a sign-in, for round 2: start, and the provider's claims
 * registered for this sign-in's own authorization code. `fire()` then runs the
 * callback (not followed) and reads the ticket from the redirect; the ticket
 * is NOT redeemed. Two of these can be fired at once.
 */
const ssoBegin = async (idp, orgId, claims, label) => {
  const start = keep(`${label} start`, await api.raw('POST', '/auth/sso/start', { json: { orgId } }));
  if (start.status !== 200) return { start, fire: async () => ({ start, cb: null, status: null, location: '', ticket: null, error: `start ${said(start)}` }) };
  const authUrl = new URL(start.body.data.authorizationUrl);
  const code = `did1-${STAMP}-${crypto.randomBytes(5).toString('hex')}`;
  idp.setClaimsFor(code, { email_verified: true, name: `DID1 ${label}`, ...claims, nonce: authUrl.searchParams.get('nonce') });
  const fire = async () => {
    const cb = keep(`${label} callback`, await api.raw('GET', `/auth/sso/callback?code=${code}&state=${encodeURIComponent(authUrl.searchParams.get('state'))}`));
    const location = String(cb.headers.get('location') || '');
    const parsed = location ? new URL(location, 'http://invalid.local') : null;
    const ticket = parsed && parsed.pathname.endsWith('/sso/complete') ? parsed.searchParams.get('ticket') : null;
    const error = parsed ? parsed.searchParams.get('ssoError') : null;
    return { start, cb, status: cb.status, location, ticket, error };
  };
  return { start, fire };
};
/** A sign-in up to the callback: a ticket issued, not redeemed. */
const ssoTicketOnly = async (idp, orgId, claims, label) => (await ssoBegin(idp, orgId, claims, label)).fire();
/** POST /auth/sso/complete with a ticket (a placeholder of valid length when there is none, so the answer is a refusal, not a validation error). */
const redeem = async (ticket, label) => keep(label, await api.raw('POST', '/auth/sso/complete', { json: { ticket: ticket || 'x'.repeat(43) } }));

const main = async () => {
  if (!PASSWORD) throw new Error('CERT_PASSWORD is not set');
  const { companies } = buildPopulation();
  const [X, Y, Z] = [X_CODE, Y_CODE, Z_CODE].map((code) => companies.find((c) => c.code === code));
  const db = await guard.connectCert();
  // A second connection that holds the product's own locks for the forced interleavings (round 2).
  const lockDb = await guard.connectCert();
  const lockPid = (await lockDb.query('select pg_backend_pid() as pid')).rows[0].pid;
  let lockOpen = false;
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const orgOf = async (code) => (await q('select id, name from "Organisation" where slug like $1', [`cert-${code}-%`]))[0];
  const [orgX, orgY, orgZ] = [await orgOf(X_CODE), await orgOf(Y_CODE), await orgOf(Z_CODE)];
  const xPm = api.as(`pm@${X.domain}`);
  const yPm = api.as(`pm@${Y.domain}`);
  const zPm = api.as(`pm@${Z.domain}`);
  console.log(`${NAME}: X ${X_CODE} (home), Y ${Y_CODE} (second workspace), Z ${Z_CODE} (inviter); stamp ${STAMP}${process.env.CERT_INPROCESS === '1' ? ', in process' : ''}; ${EXPECTED_CHECKS} checks\n`);

  const SSO_COLUMNS = ['ssoEnabled', 'ssoProvider', 'ssoIssuer', 'ssoClientId', 'ssoClientSecretEnc', 'ssoDomainsJson', 'ssoAutoProvision', 'ssoDefaultRole', 'ssoRequired', 'ssoUpdatedAt', 'mfaRequired'];
  const ssoBefore = {};
  for (const org of [orgX, orgY, orgZ]) {
    ssoBefore[org.id] = (await q(`select ${SSO_COLUMNS.map((c) => `"${c}"`).join(', ')} from "Organisation" where id = $1`, [org.id]))[0];
  }
  const idps = [];
  const fixtures = { left: null, legacy: null, legacyRace: null };
  try {
    const idpX = await startIdp(`did1-x-${STAMP}`);
    const idpY = await startIdp(`did1-y-${STAMP}`);
    const idpZ = await startIdp(`did1-z-${STAMP}`);
    idps.push(idpX, idpY, idpZ);
    const ssoConfig = (idp, extra = {}) => ({ enabled: true, issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, ...extra });

    // ── set-up: throwaway people, made the one way the product allows ──────────
    const pDomain = `s${STAMP}.${X.domain}`;
    const person = (label, domain) => ({ label, email: `did1.${label}.${STAMP}@${domain}`, name: `DID1 ${label} ${STAMP}` });
    const P = person('p', pDomain);
    const Q = person('q', Y.domain);
    const G = person('legacy', Y.domain);
    const E = person('elsewhere', X.domain);
    const K = person('closed', X.domain);
    const L = person('left', X.domain);
    const N = person('unknown', Y.domain);
    for (const [p, inviter] of [[P, xPm], [E, xPm], [K, xPm], [L, xPm], [Q, yPm], [G, yPm]]) {
      const made = await invitations.createByInvitation({ inviter, email: p.email, role: 'qs', name: p.name, password: PASSWORD, db });
      keep(`setup ${p.label} invite`, made.invited);
      keep(`setup ${p.label} accept`, made.accepted);
      p.id = made.userId;
      p.made = `${said(made.invited)}/${said(made.accepted)}`;
    }
    const pIntoY = await invitations.joinByInvitation({ inviter: yPm, email: P.email, role: 'qs', name: P.name, db });
    const lIntoY = await invitations.joinByInvitation({ inviter: yPm, email: L.email, role: 'qs', name: L.name, db });
    keep('setup P into Y', pIntoY.accepted);
    keep('setup L into Y', lIntoY.accepted);
    const kClosed = keep('setup close K', await xPm.send('PATCH', `/users/${K.id}/deactivate`, {}));
    const membership = async (orgId, userId) => (await q(`select id, role, kind, status, "isAdmin", "isOwner", "ssoSubject" from "OrganizationMembership" where "orgId" = $1 and "userId" = $2`, [orgId, userId]))[0] || null;
    // Fixture LEFT: L's Y membership ends (leaving has no route of its own).
    fixtures.left = (await q(`select id, status, "leftAt" from "OrganizationMembership" where "orgId" = $1 and "userId" = $2`, [orgY.id, L.id]))[0] || null;
    if (fixtures.left) await db.query(`update "OrganizationMembership" set status = 'left', "leftAt" = now() where id = $1`, [fixtures.left.id]);
    // Fixture legacy home: G is homed in Y and has no membership row (a person from before memberships).
    const gUser = (await q('select "orgId", role, status from "User" where id = $1', [G.id]))[0];
    const gRow = (await q(`select to_jsonb(m) as row from "OrganizationMembership" m where "orgId" = $1 and "userId" = $2`, [orgY.id, G.id]))[0];
    if (gRow) {
      fixtures.legacy = gRow.row;
      await db.query('delete from "OrganizationMembership" where id = $1', [gRow.row.id]);
    }
    const kRow = (await q('select status from "User" where id = $1', [K.id]))[0];
    // SSO for X and Y, each pointing at its own throwaway provider (no domains: nothing becomes SSO-only).
    const cfgX = keep('PUT sso X', await xPm.send('PUT', '/company/security/sso', ssoConfig(idpX)));
    const cfgY = keep('PUT sso Y', await yPm.send('PUT', '/company/security/sso', ssoConfig(idpY)));
    const people = [P, Q, G, E, K, L];
    check('setup: P (home X, member of Y), Q and G (home Y), E, K and L (home X; L also in Y) made by invitation; K closed; L left Y; G has no membership row; SSO configured on X and Y',
      people.every((p) => p.id) && said(pIntoY.accepted) === '200' && said(lIntoY.accepted) === '200' && kClosed.status === 200 && kRow?.status === 'inactive'
        && (await membership(orgY.id, L.id))?.status === 'left' && gUser?.orgId === orgY.id && fixtures.legacy && !(await membership(orgY.id, G.id))
        && cfgX.status === 200 && cfgY.status === 200 && (await membership(orgY.id, P.id))?.status === 'active',
      `${people.map((p) => `${p.label} ${p.made}`).join('; ')}; P->Y ${said(pIntoY.accepted)}; L->Y ${said(lIntoY.accepted)}; close K ${said(kClosed)} ${kRow?.status}; G home ${gUser?.orgId === orgY.id}; sso X ${said(cfgX)} Y ${said(cfgY)}`);
    if (!results.every((r) => r.ok)) throw new Error('setup incomplete');
    const printBefore = await fingerprint.take(db);

    // ── C10: SSO is not a door ─────────────────────────────────────────────────
    console.log('\n── C10 SSO is not a door ──');
    const orgSso = async (orgId) => (await q('select "ssoAutoProvision", "ssoUpdatedAt"::text as at from "Organisation" where id = $1', [orgId]))[0];
    const yBeforeRetired = await orgSso(orgY.id);
    const retired = keep('PUT autoProvision true', await yPm.send('PUT', '/company/security/sso', { autoProvision: true }));
    const overview = keep('GET security', await yPm.send('GET', '/company/security'));
    const yAfterRetired = await orgSso(orgY.id);
    check('C10: PUT /company/security/sso with autoProvision: true is refused 400 SSO_AUTO_PROVISION_RETIRED, nothing written; GET shows autoProvision false',
      said(retired) === '400 SSO_AUTO_PROVISION_RETIRED' && overview.status === 200 && overview.body?.data?.sso?.autoProvision === false && yAfterRetired.ssoAutoProvision === false && yAfterRetired.at === yBeforeRetired.at,
      `${said(retired)}; GET ${said(overview)} autoProvision=${overview.body?.data?.sso?.autoProvision}; column ${yAfterRetired.ssoAutoProvision}; updatedAt ${yBeforeRetired.at} -> ${yAfterRetired.at}`);

    const standing = async (ids) => JSON.stringify(await q(`
      select u.id, u.status, u."orgId", u."ssoSubject", u."ssoLinkedAt", u."credentialEpoch",
             (select json_agg(json_build_object('org', m."orgId", 'status', m.status, 'role', m.role, 'kind', m.kind, 'sub', m."ssoSubject") order by m."orgId") from "OrganizationMembership" m where m."userId" = u.id) as memberships,
             (select count(*)::int from "SsoTicket" t where t."userId" = u.id) as tickets
        from "User" u where u.id = any($1::text[]) order by u.id`, [ids]));
    const subjectLinks = async (subject) => (await q('select count(*)::int as n from "OrganizationMembership" where "ssoSubject" = $1', [subject]))[0].n;
    const refusals = [];
    for (const [label, who, sub] of [['an unknown e-mail', N, `did1-sub-unknown-${STAMP}`], ['an identity homed elsewhere that is not a member of Y', E, `did1-sub-elsewhere-${STAMP}`], ['a closed identity with no membership in Y', K, `did1-sub-closed-${STAMP}`], ['a former member who LEFT Y', L, `did1-sub-left-${STAMP}`]]) {
      const before = who.id ? await standing([who.id]) : null;
      const flow = await ssoSignIn(idpY, orgY.id, { sub, email: who.email }, `C10 ${who.label}`);
      const after = who.id ? await standing([who.id]) : null;
      const users = (await q('select count(*)::int as n from "User" where email = $1', [who.email]))[0].n;
      const links = await subjectLinks(sub);
      refusals.push(flow);
      check(`C10: ${label}: the callback redirects with ssoError=SSO_USER_NOT_FOUND; no User, membership, ticket or SSO link is written`,
        flow.status === 302 && flow.error === 'SSO_USER_NOT_FOUND' && !flow.ticket && links === 0 && (who.id ? before === after && users === 1 : users === 0),
        `callback ${flow.status} -> ${flow.location}; users ${users}; links ${links}; standing ${before === after ? 'unchanged' : `${before} -> ${after}`}`);
    }
    check('C10: the four refusals are the same answer (status and redirect identical)',
      refusals.every((f) => f.status === refusals[0].status && f.location === refusals[0].location) && refusals[0].location.length > 0,
      refusals.map((f) => `${f.status} ${f.location}`).join(' | '));

    // An active member (Q, homed in Y) signs in through Y's provider.
    const qBefore = (await q('select "ssoSubject", "ssoLinkedAt" from "User" where id = $1', [Q.id]))[0];
    const sq = `did1-sub-shared-${STAMP}`;
    const qFlow = await ssoSignIn(idpY, orgY.id, { sub: sq, email: Q.email }, 'C10 Q');
    const qClaims = claimsOf(qFlow.token);
    const qMe = qFlow.token ? keep('Q me', await api.raw('GET', '/auth/me', { token: qFlow.token })) : null;
    check('C10: an active member signs in through SSO (callback, ticket, /auth/sso/complete) with a session bound to that workspace',
      qFlow.status === 302 && Boolean(qFlow.ticket) && qFlow.complete?.status === 200 && qClaims?.sub === Q.id && qClaims?.orgId === orgY.id && qClaims?.sso === orgY.id && qMe?.status === 200,
      `callback ${qFlow.status} ${qFlow.error || 'ticket'}; complete ${said(qFlow.complete)}; claims sub=${qClaims?.sub === Q.id} org=${qClaims?.orgId === orgY.id} sso=${qClaims?.sso === orgY.id}; me ${said(qMe)}`);
    const qAfter = (await q('select "ssoSubject", "ssoLinkedAt" from "User" where id = $1', [Q.id]))[0];
    const qLinks = await q('select "orgId", "userId" from "OrganizationMembership" where "ssoSubject" = $1', [sq]);
    check('C10: the subject is stored on that membership only (OrganizationMembership.ssoSubject); User.ssoSubject is unchanged',
      qLinks.length === 1 && qLinks[0].orgId === orgY.id && qLinks[0].userId === Q.id && JSON.stringify(qBefore) === JSON.stringify(qAfter),
      `links ${JSON.stringify(qLinks.map((l) => ({ y: l.orgId === orgY.id, q: l.userId === Q.id })))}; user ${JSON.stringify(qBefore)} -> ${JSON.stringify(qAfter)}`);

    // A legacy person homed in Y with no membership row signs in, and gets a row.
    const sg = `did1-sub-legacy-${STAMP}`;
    const gFlow = await ssoSignIn(idpY, orgY.id, { sub: sg, email: G.email }, 'C10 G');
    const gClaims = claimsOf(gFlow.token);
    const gNow = await membership(orgY.id, G.id);
    check('C10: a legacy person homed in the workspace with no membership row signs in through SSO and gets a membership row (role from the person, subject linked there)',
      gFlow.complete?.status === 200 && gClaims?.sub === G.id && gClaims?.orgId === orgY.id && gClaims?.sso === orgY.id && gNow?.status === 'active' && gNow.role === gUser.role && gNow.ssoSubject === sg && !gNow.isOwner,
      `callback ${gFlow.status} ${gFlow.error || 'ticket'}; complete ${said(gFlow.complete)}; membership ${JSON.stringify(gNow && { status: gNow.status, role: gNow.role, kind: gNow.kind, linked: gNow.ssoSubject === sg })}; user role ${gUser.role}`);

    // ── C13: SSO cannot touch the identity's own security ──────────────────────
    console.log('\n── C13 SSO cannot touch global identity security ──');
    const identity = async (userId) => (await q('select "mfaEnabled", "mfaSecretEnc", "mfaPendingSecretEnc", "mfaBackupCodesJson", "ssoSubject", "ssoProvider", "ssoLinkedAt", "passwordHash", status from "User" where id = $1', [userId]))[0];
    const pIdentityBefore = JSON.stringify(await identity(P.id));
    const sy = `did1-sub-y-${STAMP}`;
    const pY = await ssoSignIn(idpY, orgY.id, { sub: sy, email: P.email }, 'C13 P via Y');
    const pYClaims = claimsOf(pY.token);
    check('C13: Y\'s provider signs P in to Y (session bound to Y\'s SSO) and links subject sy on P\'s Y membership',
      pY.complete?.status === 200 && pYClaims?.sub === P.id && pYClaims?.orgId === orgY.id && pYClaims?.sso === orgY.id && (await membership(orgY.id, P.id))?.ssoSubject === sy,
      `callback ${pY.status} ${pY.error || 'ticket'}; complete ${said(pY.complete)}; sso=${pYClaims?.sso === orgY.id}; Y link ${(await membership(orgY.id, P.id))?.ssoSubject === sy}`);
    const mfaCalls = [
      ['/auth/mfa/setup', {}],
      ['/auth/mfa/enable', { code: '123456' }],
      ['/auth/mfa/disable', { password: PASSWORD, code: '123456' }],
      ['/auth/mfa/backup-codes', { code: '123456' }],
    ];
    for (const [route, json] of mfaCalls) {
      const res = keep(`Y-SSO ${route}`, await api.raw('POST', route, { token: pY.token, json }));
      check(`C13: with a Y-SSO session, POST ${route} is refused 403 SSO_SESSION_BOUND`, said(res) === '403 SSO_SESSION_BOUND', said(res));
    }
    const pIdentityAfterY = JSON.stringify(await identity(P.id));
    check('C13: P\'s mfaEnabled, mfaSecretEnc, mfaPendingSecretEnc, backup codes, User.ssoSubject (and password, status) are unchanged',
      pIdentityAfterY === pIdentityBefore, `${pIdentityBefore} -> ${pIdentityAfterY}`);
    const yOpensX = keep('Y-SSO opens X', await api.raw('POST', `/auth/workspaces/${orgX.id}/session`, { token: pY.token, json: {} }));
    check('C13: the Y-SSO session cannot open X (POST /auth/workspaces/X/session is refused 403 SSO_SESSION_BOUND)', said(yOpensX) === '403 SSO_SESSION_BOUND', said(yOpensX));
    // Per-workspace subjects: X's provider asserts for P a subject sx different from sy — and the very
    // string Y's provider bound to a different person (Q) in Y. Subjects are per provider, so neither binds,
    // blocks or replaces the other.
    const sx = sq;
    const pX = await ssoSignIn(idpX, orgX.id, { sub: sx, email: P.email }, 'C13 P via X');
    const pXClaims = claimsOf(pX.token);
    const pXRow = await membership(orgX.id, P.id);
    const pYRow = await membership(orgY.id, P.id);
    const qYRow = await membership(orgY.id, Q.id);
    check('C13: X\'s provider, asserting a different subject sx (the string Y\'s provider bound to Q), still signs P in to X and stores sx on the X membership; sy and Q\'s link stay',
      pX.complete?.status === 200 && pXClaims?.sub === P.id && pXClaims?.orgId === orgX.id && pXClaims?.sso === orgX.id && pXRow?.ssoSubject === sx && pYRow?.ssoSubject === sy && qYRow?.ssoSubject === sq,
      `callback ${pX.status} ${pX.error || 'ticket'}; complete ${said(pX.complete)}; X link ${pXRow?.ssoSubject === sx}; Y link ${pYRow?.ssoSubject === sy}; Q link ${qYRow?.ssoSubject === sq}`);
    const pYAgain = await ssoSignIn(idpY, orgY.id, { sub: sy, email: P.email }, 'C13 P via Y again');
    const pYAgainClaims = claimsOf(pYAgain.token);
    check('C13: after X linked sx, Y\'s provider still signs P in to Y with sy (neither blocks the other)',
      pYAgain.complete?.status === 200 && pYAgainClaims?.sub === P.id && pYAgainClaims?.sso === orgY.id && (await membership(orgY.id, P.id))?.ssoSubject === sy && (await membership(orgX.id, P.id))?.ssoSubject === sx,
      `callback ${pYAgain.status} ${pYAgain.error || 'ticket'}; complete ${said(pYAgain.complete)}`);
    const homeSetup = keep('X-SSO mfa setup', await api.raw('POST', '/auth/mfa/setup', { token: pX.token, json: {} }));
    const homeEnable = keep('X-SSO mfa enable', await api.raw('POST', '/auth/mfa/enable', { token: pX.token, json: { code: '123456' } }));
    const pIdentityAfterX = JSON.stringify(await identity(P.id));
    check('C13: an X-SSO session (the home company\'s own SSO) is refused too on MFA setup and enable (403 SSO_SESSION_BOUND); the identity is unchanged',
      said(homeSetup) === '403 SSO_SESSION_BOUND' && said(homeEnable) === '403 SSO_SESSION_BOUND' && pIdentityAfterX === pIdentityBefore,
      `${said(homeSetup)} | ${said(homeEnable)}; identity ${pIdentityAfterX === pIdentityBefore ? 'unchanged' : 'CHANGED'}`);

    // ── C14: an SSO session as acceptance proof ────────────────────────────────
    console.log('\n── C14 SSO session as acceptance proof ──');
    const mailsBefore = invitations.mailsTo(P.email).length;
    const zInvite = keep('Z invites P', await zPm.send('POST', '/users/invitations', { email: P.email, role: 'qs' }));
    const zToken = await invitations.invitationTokenFor({ email: P.email, invitationId: zInvite.body?.data?.id, after: mailsBefore, db });
    const zRow = async () => (await q('select status, "acceptedById" from "InvitationToken" where id = $1', [zInvite.body?.data?.id]))[0] || null;
    const accept = (bearer) => api.raw('POST', '/auth/invitations/accept', { json: { token: zToken, name: P.name }, token: bearer });
    const alone = keep('Z link alone', await accept(null));
    check('C14: the link alone is refused 401 INVITATION_SIGN_IN_REQUIRED; nothing written',
      zInvite.status === 201 && Boolean(zToken) && said(alone) === '401 INVITATION_SIGN_IN_REQUIRED' && !(await membership(orgZ.id, P.id)) && (await zRow())?.status === 'pending',
      `invite ${said(zInvite)} token ${Boolean(zToken)}; ${said(alone)}; Z membership ${JSON.stringify(await membership(orgZ.id, P.id))}; invitation ${(await zRow())?.status}`);
    const qBearer = await api.tokenFor(Q.email);
    const other = keep('Z link with Q bearer', await accept(qBearer));
    check('C14: the bearer of a different identity is refused 401 INVITATION_SIGN_IN_REQUIRED; nothing written',
      said(other) === '401 INVITATION_SIGN_IN_REQUIRED' && !(await membership(orgZ.id, P.id)) && !(await membership(orgZ.id, Q.id)) && (await zRow())?.status === 'pending',
      `${said(other)}; invitation ${(await zRow())?.status}`);
    const viaSso = keep('Z link with P Y-SSO bearer', await accept(pYAgain.token));
    const data = viaSso.body?.data || {};
    const cookies = [].concat(viaSso.headers.get('set-cookie') || []);
    const zSessions = (await q('select count(*)::int as n from "RefreshSession" where "userId" = $1 and "orgId" = $2', [P.id, orgZ.id]))[0].n;
    check('C14: P with a Y-SSO session bearer accepts: { accepted: true, signInRequired: true } and no session (no tokens, no cookie, no refresh session in Z)',
      viaSso.status === 200 && data.accepted === true && data.signInRequired === true && !data.tokens && !data.identityToken && cookies.length === 0 && zSessions === 0,
      `${said(viaSso)} keys {${Object.keys(data).sort().join(',')}} reason ${JSON.stringify(data.reason || null)}; tokens ${Boolean(data.tokens)}; cookies ${cookies.length}; Z refresh sessions ${zSessions}`);
    const pInZ = await membership(orgZ.id, P.id);
    const zAfter = await zRow();
    check('C14: the membership in Z is written with exactly the offered role (qs, member, active, no administration or ownership); the invitation is accepted by P',
      pInZ?.status === 'active' && pInZ.role === 'qs' && pInZ.kind === 'member' && pInZ.isAdmin === false && pInZ.isOwner === false && zAfter?.status === 'accepted' && zAfter.acceptedById === P.id,
      `${JSON.stringify(pInZ && { status: pInZ.status, role: pInZ.role, kind: pInZ.kind, isAdmin: pInZ.isAdmin, isOwner: pInZ.isOwner })}; invitation ${JSON.stringify(zAfter && { status: zAfter.status, byP: zAfter.acceptedById === P.id })}`);
    // Z makes SSO mandatory for P's e-mail domain (P is not an admin of Z): a password session for Z is refused.
    const cfgZ = keep('PUT sso Z required', await zPm.send('PUT', '/company/security/sso', ssoConfig(idpZ, { domains: [pDomain], required: true })));
    const login = keep('P password login', await api.raw('POST', '/auth/login', { json: { email: P.email, password: PASSWORD } }));
    const loginData = login.body?.data || {};
    let zSession = null;
    if (loginData.identityToken) zSession = keep('P password session Z', await api.raw('POST', `/auth/workspaces/${orgZ.id}/session`, { token: loginData.identityToken, json: {} }));
    else if (loginData.tokens?.accessToken) zSession = keep('P password session Z', await api.raw('POST', `/auth/workspaces/${orgZ.id}/session`, { token: loginData.tokens.accessToken, json: {} }));
    check('C14: with Z SSO-only for P\'s domain, a password sign-in session for Z is refused 403 SSO_REQUIRED',
      cfgZ.status === 200 && login.status === 200 && said(zSession) === '403 SSO_REQUIRED',
      `PUT ${said(cfgZ)}; login ${said(login)} ${loginData.chooseWorkspace ? 'chooseWorkspace' : Object.keys(loginData).join(',')}; Z session ${said(zSession)}`);

    // ── R2: SSO tickets against credential events, and the races (findings 1, 3, 11) ──
    console.log('\n── R2 SSO tickets, credential events and races ──');
    // The race machinery, shared by R2 and R3.
    const ticketRow = async (ticket) => (ticket ? (await q('select "orgId", "userId", "usedAt" is not null as used from "SsoTicket" where "tokenHash" = $1', [sha256(ticket)]))[0] || null : null);
    const sessionsOf = async (userId, orgId = null) => (await q(`select count(*)::int as n from "RefreshSession" where "userId" = $1${orgId ? ' and "orgId" = $2' : ''}`, orgId ? [userId, orgId] : [userId]))[0].n;
    const identityOf = async (userId) => (await q('select "credentialEpoch" as epoch, status from "User" where id = $1', [userId]))[0] || null;
    const ticketsOf = async (userId) => (await q('select count(*)::int as n from "SsoTicket" where "userId" = $1', [userId]))[0].n;
    const sessionClaims = (res) => claimsOf(res?.body?.data?.tokens?.accessToken);
    // Requests queued behind the proof's own connection: waiting on it directly, or on a request that waits on it.
    const blockedBehind = async () => (await q(`
      with recursive chain(pid) as (
        select l.pid from pg_locks l where not l.granted and $1::int = any(pg_blocking_pids(l.pid))
        union
        select l.pid from pg_locks l join chain c on c.pid = any(pg_blocking_pids(l.pid)) where not l.granted
      )
      select count(distinct pid)::int as n from chain`, [lockPid]))[0].n;
    const waitForBlocked = async (n, timeoutMs = 20_000) => {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const now = await blockedBehind();
        if (now >= n || Date.now() > until) return now;
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
    try {
      // Loaded here, after the in-process app (and its database settings) are up.
      // eslint-disable-next-line global-require
      const authService = require('../../../src/services/auth.service');

      // set-up: five more throwaway people, made by invitation.
      const R = person('reset', Y.domain);
      const M = person('mfareset', Y.domain);
      const T = person('epochrace', Y.domain);
      const W = person('bindrace', Y.domain);
      const D = person('deact', X.domain);
      for (const [p, inviter] of [[R, yPm], [M, yPm], [T, yPm], [W, yPm], [D, xPm]]) {
        const made = await invitations.createByInvitation({ inviter, email: p.email, role: 'qs', name: p.name, password: PASSWORD, db });
        keep(`R2 setup ${p.label} invite`, made.invited);
        keep(`R2 setup ${p.label} accept`, made.accepted);
        p.id = made.userId;
        p.made = `${said(made.invited)}/${said(made.accepted)}`;
      }
      const dIntoY = await invitations.joinByInvitation({ inviter: yPm, email: D.email, role: 'qs', name: D.name, db });
      keep('R2 setup D into Y', dIntoY.accepted);
      const r2People = [R, M, T, W, D];
      const homes = await q('select id, "orgId" from "User" where id = any($1::text[])', [r2People.map((p) => p.id).filter(Boolean)]);
      const homeOf = (p) => homes.find((h) => h.id === p.id)?.orgId || null;
      const homeName = (p) => (homeOf(p) === orgY.id ? 'Y' : homeOf(p) === orgX.id ? 'X' : homeOf(p));
      const elsewhere = await q(`select "userId", "orgId", status from "OrganizationMembership" where "userId" = any($1::text[]) and "orgId" <> $2 and status <> 'left'`, [[R, M, T, W].map((p) => p.id).filter(Boolean), orgY.id]);
      const wRow = W.id ? await membership(orgY.id, W.id) : null;
      const dInY = D.id ? await membership(orgY.id, D.id) : null;
      const r2Ready = r2People.every((p) => p.id) && [R, M, T, W].every((p) => homeOf(p) === orgY.id) && homeOf(D) === orgX.id && said(dIntoY.accepted) === '200'
        && dInY?.status === 'active' && wRow?.status === 'active' && wRow.ssoSubject === null && elsewhere.length === 0;
      check('R2 setup: R, M, T and W (home Y, member of Y only) and D (home X, active member of Y) made by invitation; W has no SSO link in Y',
        r2Ready,
        `${r2People.map((p) => `${p.label} ${p.made} home ${homeName(p)}`).join('; ')}; D->Y ${said(dIntoY.accepted)} ${dInY?.status}; W in Y ${JSON.stringify(wRow && { status: wRow.status, linked: wRow.ssoSubject !== null })}; memberships elsewhere ${elsewhere.length}`);
      if (!r2Ready) throw new Error('R2 setup incomplete');

      // (a) A ticket issued at the callback, not redeemed, then a credential event.
      // (a1) R completes a self-service password reset.
      const sr = `did1-sub-reset-${STAMP}`;
      const rCb = await ssoTicketOnly(idpY, orgY.id, { sub: sr, email: R.email }, 'R2 R');
      const rIssued = await ticketRow(rCb.ticket);
      const rMailsBefore = invitations.mailsTo(R.email).length;
      const rForgot = keep('R2 R forgot', await api.raw('POST', '/auth/forgot-password', { json: { email: R.email } }));
      await authService.flushPasswordResetDeliveries();
      const rLink = invitations.mailsTo(R.email).slice(rMailsBefore).reverse().map((m) => linkIn(m, 'reset-password')).find(Boolean);
      const rReset = keep('R2 R reset', await api.raw('POST', '/auth/reset-password', { json: { token: rLink?.token || 'x'.repeat(43), password: NEW_PASSWORD } }));
      const rAfterReset = await ticketRow(rCb.ticket);
      const rSessionsBefore = await sessionsOf(R.id);
      const rRedeem = await redeem(rCb.ticket, 'R2 R redeems the pre-reset ticket');
      const rSessionsAfter = await sessionsOf(R.id);
      const rFresh = await ssoSignIn(idpY, orgY.id, { sub: sr, email: R.email }, 'R2 R fresh');
      const rFreshClaims = claimsOf(rFresh.token);
      check('R2 finding 3 (password reset): an SSO ticket issued before R\'s self-service reset is voided by it (usedAt set) and redeeming it answers 401 SSO_TICKET_INVALID, writing no refresh session; a fresh SSO sign-in after the reset completes 200 bound to Y',
        Boolean(rCb.ticket) && rIssued?.used === false && rForgot.status === 200 && Boolean(rLink) && rReset.status === 200 && rReset.body?.data?.reset === true
          && rAfterReset?.used === true && said(rRedeem) === '401 SSO_TICKET_INVALID' && !rRedeem.body?.data?.tokens && rSessionsAfter === rSessionsBefore
          && rFresh.complete?.status === 200 && rFreshClaims?.sub === R.id && rFreshClaims?.sso === orgY.id,
        `callback ${rCb.status} ${rCb.error || (rCb.ticket ? 'ticket' : 'none')}; issued used=${rIssued?.used}; forgot ${said(rForgot)} link ${Boolean(rLink)}; reset ${said(rReset)}; after the reset used=${rAfterReset?.used}; redeem ${said(rRedeem)}; refresh sessions ${rSessionsBefore} -> ${rSessionsAfter}; fresh ${rFresh.status} ${rFresh.error || 'ticket'} complete ${said(rFresh.complete)} sso=${rFreshClaims?.sso === orgY.id}`);

      // (a2) Y's admin resets the second factor of M, homed in Y (and nowhere else).
      const sm = `did1-sub-mfareset-${STAMP}`;
      const mCb = await ssoTicketOnly(idpY, orgY.id, { sub: sm, email: M.email }, 'R2 M');
      const mIssued = await ticketRow(mCb.ticket);
      const mBefore = await identityOf(M.id);
      const mReset = keep('R2 Y admin resets M MFA', await yPm.send('POST', `/company/security/users/${M.id}/mfa/reset`, {}));
      const mAfter = await identityOf(M.id);
      const mAfterReset = await ticketRow(mCb.ticket);
      const mSessionsBefore = await sessionsOf(M.id);
      const mRedeem = await redeem(mCb.ticket, 'R2 M redeems the pre-reset ticket');
      const mSessionsAfter = await sessionsOf(M.id);
      const mFresh = await ssoSignIn(idpY, orgY.id, { sub: sm, email: M.email }, 'R2 M fresh');
      const mFreshClaims = claimsOf(mFresh.token);
      check('R2 finding 3 (admin MFA reset): an SSO ticket issued before Y\'s admin resets the factor of M (homed in Y) is voided by it and redeeming it answers 401 SSO_TICKET_INVALID, writing no refresh session; a fresh SSO sign-in afterwards completes 200 bound to Y',
        Boolean(mCb.ticket) && mIssued?.used === false && mReset.status === 200 && mReset.body?.data?.reset === true && Number.isInteger(mBefore?.epoch) && mAfter?.epoch === mBefore.epoch + 1
          && mAfterReset?.used === true && said(mRedeem) === '401 SSO_TICKET_INVALID' && !mRedeem.body?.data?.tokens && mSessionsAfter === mSessionsBefore
          && mFresh.complete?.status === 200 && mFreshClaims?.sub === M.id && mFreshClaims?.sso === orgY.id,
        `callback ${mCb.status} ${mCb.error || (mCb.ticket ? 'ticket' : 'none')}; issued used=${mIssued?.used}; reset ${said(mReset)}; epoch ${mBefore?.epoch} -> ${mAfter?.epoch}; after the reset used=${mAfterReset?.used}; redeem ${said(mRedeem)}; refresh sessions ${mSessionsBefore} -> ${mSessionsAfter}; fresh ${mFresh.status} ${mFresh.error || 'ticket'} complete ${said(mFresh.complete)} sso=${mFreshClaims?.sso === orgY.id}`);

      // (a3) Y, the SSO workspace, deactivates D (homed in X): D's Y ticket goes, D's X ticket stays.
      const sdy = `did1-sub-deact-y-${STAMP}`;
      const sdx = `did1-sub-deact-x-${STAMP}`;
      const dY = await ssoTicketOnly(idpY, orgY.id, { sub: sdy, email: D.email }, 'R2 D via Y');
      const dX = await ssoTicketOnly(idpX, orgX.id, { sub: sdx, email: D.email }, 'R2 D via X');
      const dYIssued = await ticketRow(dY.ticket);
      const dXIssued = await ticketRow(dX.ticket);
      const dDeact = keep('R2 Y deactivates D', await yPm.send('PATCH', `/users/${D.id}/deactivate`, {}));
      const dYAfter = await ticketRow(dY.ticket);
      const dXAfter = await ticketRow(dX.ticket);
      const dYSessionsBefore = await sessionsOf(D.id, orgY.id);
      const dYRedeem = await redeem(dY.ticket, 'R2 D redeems the Y ticket');
      const dYSessionsAfter = await sessionsOf(D.id, orgY.id);
      const dXRedeem = await redeem(dX.ticket, 'R2 D redeems the X ticket');
      const dXClaims = sessionClaims(dXRedeem);
      const dYAgain = await ssoTicketOnly(idpY, orgY.id, { sub: sdy, email: D.email }, 'R2 D via Y again');
      const dYMember = await membership(orgY.id, D.id);
      const dIdentity = await identityOf(D.id);
      check('R2 finding 3 (deactivation): Y deactivating D (homed in X) voids D\'s unredeemed Y ticket (401 SSO_TICKET_INVALID, no Y refresh session) but not D\'s X ticket (it completes 200 bound to X); a new Y sign-in is refused at the callback with USER_INACTIVE',
        Boolean(dY.ticket) && Boolean(dX.ticket) && dYIssued?.used === false && dXIssued?.used === false && dDeact.status === 200
          && dYAfter?.used === true && dXAfter?.used === false && said(dYRedeem) === '401 SSO_TICKET_INVALID' && !dYRedeem.body?.data?.tokens && dYSessionsAfter === dYSessionsBefore
          && dXRedeem.status === 200 && dXClaims?.sub === D.id && dXClaims?.orgId === orgX.id && dXClaims?.sso === orgX.id
          && dYAgain.status === 302 && dYAgain.error === 'USER_INACTIVE' && !dYAgain.ticket && dYMember?.status === 'suspended' && dIdentity?.status === 'active',
        `callbacks Y ${dY.status} ${dY.error || (dY.ticket ? 'ticket' : 'none')} X ${dX.status} ${dX.error || (dX.ticket ? 'ticket' : 'none')}; deactivate ${said(dDeact)}; Y ticket used ${dYIssued?.used} -> ${dYAfter?.used}; X ticket used ${dXIssued?.used} -> ${dXAfter?.used}; Y redeem ${said(dYRedeem)}; Y refresh sessions ${dYSessionsBefore} -> ${dYSessionsAfter}; X redeem ${said(dXRedeem)} org=${dXClaims?.orgId === orgX.id} sso=${dXClaims?.sso === orgX.id}; Y again ${dYAgain.status} ${dYAgain.error || (dYAgain.ticket ? 'ticket' : 'none')}; Y membership ${dYMember?.status}; identity ${dIdentity?.status}`);

      // (b) Redemption against a credential event in flight: the proof holds an
      // uncommitted credential-epoch bump on T's User row (what a reset writes),
      // POST /auth/sso/complete queues behind it, and the bump then commits.
      const st = `did1-sub-epochrace-${STAMP}`;
      const tCb = await ssoTicketOnly(idpY, orgY.id, { sub: st, email: T.email }, 'R2 T');
      const tIssued = await ticketRow(tCb.ticket);
      const tBefore = await identityOf(T.id);
      const tSessionsBefore = await sessionsOf(T.id);
      await beginLock([['update "User" set "credentialEpoch" = "credentialEpoch" + 1 where id = $1', [T.id]]]);
      const tPending = api.raw('POST', '/auth/sso/complete', { json: { ticket: tCb.ticket || 'x'.repeat(43) } });
      const tQueued = await waitForBlocked(1);
      await endLock();
      const tRes = keep('R2 T completes behind the epoch bump', await tPending);
      const tAfter = await identityOf(T.id);
      const tSessionsAfter = await sessionsOf(T.id);
      const tTicketAfter = await ticketRow(tCb.ticket);
      check('R2 finding 1/3 (race): /auth/sso/complete queued behind an uncommitted credential-epoch bump on the User row answers 401 SESSION_REVOKED once it commits, and writes no refresh session',
        Boolean(tCb.ticket) && tIssued?.used === false && tQueued >= 1 && said(tRes) === '401 SESSION_REVOKED' && !tRes.body?.data?.tokens
          && Number.isInteger(tBefore?.epoch) && tAfter?.epoch === tBefore.epoch + 1 && tSessionsAfter === tSessionsBefore,
        `callback ${tCb.status} ${tCb.error || (tCb.ticket ? 'ticket' : 'none')}; waiting behind the held row ${tQueued}; complete ${said(tRes)}; epoch ${tBefore?.epoch} -> ${tAfter?.epoch}; refresh sessions ${tSessionsBefore} -> ${tSessionsAfter}; ticket used=${tTicketAfter?.used}`);

      // (c) First-binding race: W has no link in Y; two callbacks with two
      // subjects for W's e-mail are fired together while the proof holds W's Y
      // membership row FOR UPDATE, so both reach the link write and queue there.
      const s1 = `did1-sub-bind-1-${STAMP}`;
      const s2 = `did1-sub-bind-2-${STAMP}`;
      const wTicketsBefore = await ticketsOf(W.id);
      const b1 = await ssoBegin(idpY, orgY.id, { sub: s1, email: W.email }, 'R2 W subject 1');
      const b2 = await ssoBegin(idpY, orgY.id, { sub: s2, email: W.email }, 'R2 W subject 2');
      await beginLock([['select id from "OrganizationMembership" where id = $1 for update', [wRow.id]]]);
      const both = Promise.all([b1.fire(), b2.fire()]);
      const held = await waitForBlocked(2);
      await endLock();
      const [c1, c2] = await both;
      const flows = [[c1, s1], [c2, s2]];
      const winners = flows.filter(([f]) => f.ticket);
      const losers = flows.filter(([f]) => !f.ticket);
      const winSub = winners.length === 1 ? winners[0][1] : null;
      const loseSub = losers.length === 1 ? losers[0][1] : null;
      const subName = (s) => (s === s1 ? 's1' : s === s2 ? 's2' : String(s));
      const storedAfterRace = (await membership(orgY.id, W.id))?.ssoSubject ?? null;
      const wTicketsAfter = await ticketsOf(W.id);
      const loserLinks = loseSub ? await subjectLinks(loseSub) : null;
      // It stays: the losing subject comes back later and is refused; the winner's ticket redeems.
      const loserAgain = loseSub ? await ssoTicketOnly(idpY, orgY.id, { sub: loseSub, email: W.email }, 'R2 W losing subject again') : null;
      const winnerRedeem = winners.length === 1 ? await redeem(winners[0][0].ticket, 'R2 W redeems the winning ticket') : null;
      const winnerClaims = sessionClaims(winnerRedeem);
      const storedFinal = (await membership(orgY.id, W.id))?.ssoSubject ?? null;
      check('R2 finding 11 (race): two first SSO callbacks for one unlinked member with two subjects, queued at the membership row and released together: exactly one links and gets a ticket, the other is refused SSO_IDENTITY_CONFLICT; the stored subject is the winner\'s and stays (the losing subject is refused again later; the winning ticket completes 200)',
        held >= 2 && c1.status === 302 && c2.status === 302 && winners.length === 1 && losers.length === 1 && losers[0][0].error === 'SSO_IDENTITY_CONFLICT'
          && storedAfterRace === winSub && wTicketsAfter === wTicketsBefore + 1 && loserLinks === 0
          && loserAgain?.status === 302 && loserAgain.error === 'SSO_IDENTITY_CONFLICT' && !loserAgain.ticket
          && winnerRedeem?.status === 200 && winnerClaims?.sub === W.id && winnerClaims?.sso === orgY.id && storedFinal === winSub,
        `waiting behind the held row ${held}; callbacks s1 ${c1.status} ${c1.error || (c1.ticket ? 'ticket' : 'none')} | s2 ${c2.status} ${c2.error || (c2.ticket ? 'ticket' : 'none')}; stored ${subName(storedAfterRace)} (winner ${winSub ? subName(winSub) : 'none'}); W tickets ${wTicketsBefore} -> ${wTicketsAfter}; loser links ${loserLinks}; losing subject again ${loserAgain ? `${loserAgain.status} ${loserAgain.error || 'ticket'}` : 'n/a'}; winner redeem ${said(winnerRedeem)} sso=${winnerClaims?.sso === orgY.id}; stored at the end ${subName(storedFinal)}`);
    } catch (error) {
      console.log(`SECTION ERROR (R2): ${error.stack || error.message}`);
      if (lockOpen) {
        lockOpen = false;
        await lockDb.query('rollback').catch(() => null);
      }
    }

    // ── R3: the callback's ticket against a credential event in flight (round 3: the round-2 review's item 3) ──
    // The callback writes its ticket in a transaction that first holds the
    // identity at the epoch it read at the start (auth.service
    // holdCredentialEpoch: SELECT … FOR NO KEY UPDATE on the User row).
    console.log('\n── R3 SSO callback ticket against a credential event ──');
    const R3_RACE = 'R3 item 3 (race): an SSO callback for an active member that reaches the ticket transaction\'s epoch hold while an uncommitted credential-epoch bump is held on the member\'s User row waits there (pg_locks: a waiter behind the held row, at the FOR NO KEY UPDATE epoch hold on "User"); once the bump commits it redirects to /sign-in?ssoError=SESSION_REVOKED with no ticket, and no SsoTicket row is written for the member';
    const R3_CONTROL = 'R3 item 3 (control): not racing, a callback for the same member writes one unused SsoTicket for Y, which /auth/sso/complete redeems 200 with a session bound to Y (sub, orgId, sso) at the member\'s current, bumped epoch (cep); /auth/me answers 200';
    try {
      // set-up: V, homed in Y (and nowhere else), made by invitation; no SSO link in Y yet.
      const V = person('ticketrace', Y.domain);
      const vMade = await invitations.createByInvitation({ inviter: yPm, email: V.email, role: 'qs', name: V.name, password: PASSWORD, db });
      keep('R3 setup V invite', vMade.invited);
      keep('R3 setup V accept', vMade.accepted);
      V.id = vMade.userId;
      const vHome = V.id ? (await q('select "orgId" from "User" where id = $1', [V.id]))[0]?.orgId ?? null : null;
      const vInY = V.id ? await membership(orgY.id, V.id) : null;
      const vElsewhere = V.id ? (await q(`select count(*)::int as n from "OrganizationMembership" where "userId" = $1 and "orgId" <> $2 and status <> 'left'`, [V.id, orgY.id]))[0].n : null;
      const vReady = Boolean(V.id) && vHome === orgY.id && vInY?.status === 'active' && vInY.ssoSubject === null && vElsewhere === 0;
      const vSetup = `set-up: V ${said(vMade.invited)}/${said(vMade.accepted)} home ${vHome === orgY.id ? 'Y' : vHome}; Y membership ${JSON.stringify(vInY && { status: vInY.status, linked: vInY.ssoSubject !== null })}; memberships elsewhere ${vElsewhere}`;
      if (!vReady) {
        check(R3_RACE, false, vSetup);
        check(R3_CONTROL, false, vSetup);
      } else {
        // The waiters directly behind the proof's connection: the lock each waits for, what it is running, and whether it holds a tuple lock on "User" (a row of User it queues for).
        const waitingOnHeld = async () => q(`
          select l.pid, l.locktype, left(regexp_replace(coalesce(a.query, ''), '\\s+', ' ', 'g'), 240) as query,
                 exists (select 1 from pg_locks t where t.pid = l.pid and t.granted and t.locktype = 'tuple' and t.relation = '"User"'::regclass) as "userRow"
            from pg_locks l join pg_stat_activity a on a.pid = l.pid
           where not l.granted and $1::int = any(pg_blocking_pids(l.pid))`, [lockPid]);
        const sv = `did1-sub-ticketrace-${STAMP}`;
        // Start (and the provider's claims) first, so the callback is the only request in flight while the row is held.
        const vRace = await ssoBegin(idpY, orgY.id, { sub: sv, email: V.email }, 'R3 V racing callback');
        const vBefore = await identityOf(V.id);
        const vTicketsBefore = await ticketsOf(V.id);
        await beginLock([['update "User" set "credentialEpoch" = "credentialEpoch" + 1 where id = $1', [V.id]]]);
        const vPending = vRace.fire();
        const vQueued = await waitForBlocked(1);
        const vWaiting = await waitingOnHeld();
        // Tickets visible while the callback is held (a ticket written outside the hold would already be here).
        const vTicketsHeld = await ticketsOf(V.id);
        await endLock();
        const vRes = await vPending;
        const vAfter = await identityOf(V.id);
        const vTicketsAfter = await ticketsOf(V.id);
        const vAtHold = vWaiting.some((w) => w.userRow && /\bfor no key update\b/i.test(w.query) && w.query.includes('"credentialEpoch"'));
        const vLanding = vRes.location ? new URL(vRes.location, 'http://invalid.local').pathname : '';
        check(R3_RACE,
          vRace.start.status === 200 && vQueued >= 1 && vAtHold && vTicketsHeld === vTicketsBefore
            && vRes.status === 302 && vRes.error === 'SESSION_REVOKED' && !vRes.ticket && vLanding.endsWith('/sign-in')
            && vTicketsAfter === vTicketsBefore && Number.isInteger(vBefore?.epoch) && vAfter?.epoch === vBefore.epoch + 1 && vAfter?.status === 'active',
          `start ${said(vRace.start)}; waiting behind the held row ${vQueued}: ${vWaiting.map((w) => `${w.locktype}${w.userRow ? ' (holds a "User" tuple lock)' : ''} at: ${w.query}`).join(' | ') || 'none'}; callback ${vRes.status} -> ${vLanding || '(no redirect)'} ${vRes.error ? `ssoError=${vRes.error}` : (vRes.ticket ? 'ticket' : 'none')}; V tickets ${vTicketsBefore} -> ${vTicketsHeld} (held) -> ${vTicketsAfter}; epoch ${vBefore?.epoch} -> ${vAfter?.epoch}; status ${vAfter?.status}`);

        // Control, not racing: V signs in again now. The callback reads the bumped epoch, holds it, writes a ticket, and the ticket redeems.
        const vControl = await ssoTicketOnly(idpY, orgY.id, { sub: sv, email: V.email }, 'R3 V control callback');
        const vControlRow = await ticketRow(vControl.ticket);
        const vTicketsControl = await ticketsOf(V.id);
        const vRedeem = await redeem(vControl.ticket, 'R3 V redeems the control ticket');
        const vClaims = sessionClaims(vRedeem);
        const vToken = vRedeem.body?.data?.tokens?.accessToken || null;
        const vMe = vToken ? keep('R3 V me', await api.raw('GET', '/auth/me', { token: vToken })) : null;
        check(R3_CONTROL,
          vControl.status === 302 && Boolean(vControl.ticket) && !vControl.error && vControlRow?.used === false && vControlRow.orgId === orgY.id && vControlRow.userId === V.id
            && vTicketsControl === vTicketsAfter + 1 && vRedeem.status === 200 && vClaims?.sub === V.id && vClaims?.orgId === orgY.id && vClaims?.sso === orgY.id
            && Number.isInteger(vAfter?.epoch) && vClaims?.cep === vAfter.epoch && vMe?.status === 200,
          `callback ${vControl.status} ${vControl.error ? `ssoError=${vControl.error}` : (vControl.ticket ? 'ticket' : 'none')}; ticket row ${JSON.stringify(vControlRow && { used: vControlRow.used, y: vControlRow.orgId === orgY.id, v: vControlRow.userId === V.id })}; V tickets ${vTicketsAfter} -> ${vTicketsControl}; redeem ${said(vRedeem)} sub=${vClaims?.sub === V.id} org=${vClaims?.orgId === orgY.id} sso=${vClaims?.sso === orgY.id} cep=${vClaims?.cep} (stored ${vAfter?.epoch}); me ${said(vMe)}`);
      }
    } catch (error) {
      console.log(`SECTION ERROR (R3): ${error.stack || error.message}`);
      if (lockOpen) {
        lockOpen = false;
        await lockDb.query('rollback').catch(() => null);
      }
    }

    // ── R4: a legacy SSO sign-in against a deactivation (round 4: the round-3 review's legacy materialisation) ──
    // The callback's legacy branch writes the person's row under the (org,
    // e-mail) advisory lock a deactivation here takes too, and refuses
    // USER_INACTIVE when the row it finds there is not active. The proof holds
    // that lock on its own connection, queues the callback and then the
    // deactivation behind it, and releases them together.
    console.log('\n── R4 legacy SSO sign-in against a deactivation ──');
    const R4_RACE = 'R4 legacy SSO vs deactivation (race): with the (Y, e-mail) advisory lock held on a side connection, the SSO callback of a legacy person homed in Y with no Y membership row (and an active membership in X) queues at the legacy branch\'s lock, writing no Y row and no ticket while it is held, and Y\'s deactivation queues behind the same lock; released: no 5xx and no P2002, the deactivation answers 200, exactly one Y row exists and it is suspended, the identity stays open (status, epoch) with its X membership active; the callback either redirected to /sign-in?ssoError=USER_INACTIVE with no ticket (it ran after the deactivation) or issued a Y ticket that /auth/sso/complete refuses (401 SSO_TICKET_INVALID when the deactivation voided it, else 403 USER_INACTIVE), with no tokens and no Y refresh session either way';
    let r4Done = false;
    try {
      // set-up: G2, homed in Y, made by invitation, then joined into X by invitation; its Y row is removed (fixture, as for G).
      const G2 = person('legacyrace', Y.domain);
      const g2Made = await invitations.createByInvitation({ inviter: yPm, email: G2.email, role: 'qs', name: G2.name, password: PASSWORD, db });
      keep('R4 setup G2 invite', g2Made.invited);
      keep('R4 setup G2 accept', g2Made.accepted);
      G2.id = g2Made.userId;
      const g2IntoX = G2.id ? await invitations.joinByInvitation({ inviter: xPm, email: G2.email, role: 'qs', name: G2.name, db }) : null;
      keep('R4 setup G2 into X', g2IntoX?.accepted);
      const g2YRow = G2.id ? (await q('select to_jsonb(m) as row from "OrganizationMembership" m where "orgId" = $1 and "userId" = $2', [orgY.id, G2.id]))[0] : null;
      if (g2YRow) {
        fixtures.legacyRace = g2YRow.row;
        await db.query('delete from "OrganizationMembership" where id = $1', [g2YRow.row.id]);
      }
      const g2User = G2.id ? (await q('select "orgId", email, status, "credentialEpoch" as epoch from "User" where id = $1', [G2.id]))[0] || null : null;
      const g2InX = G2.id ? await membership(orgX.id, G2.id) : null;
      const g2InY = G2.id ? await membership(orgY.id, G2.id) : null;
      const g2Ready = Boolean(G2.id) && g2User?.orgId === orgY.id && g2User.status === 'active' && Number.isInteger(g2User.epoch)
        && said(g2IntoX?.accepted) === '200' && g2InX?.status === 'active' && Boolean(fixtures.legacyRace) && !g2InY;
      const g2Setup = `set-up: G2 ${said(g2Made.invited)}/${said(g2Made.accepted)} home ${g2User?.orgId === orgY.id ? 'Y' : g2User?.orgId} ${g2User?.status}; G2->X ${said(g2IntoX?.accepted)} ${g2InX?.status}; Y row removed ${Boolean(fixtures.legacyRace)}; Y row now ${JSON.stringify(g2InY && { status: g2InY.status })}`;
      if (!g2Ready) {
        r4Done = true;
        check(R4_RACE, false, g2Setup);
      } else {
        // Waiters at an advisory lock directly behind the proof's connection, and what each is running.
        const advisoryWaiters = async () => q(`
          select l.pid, left(regexp_replace(coalesce(a.query, ''), '\\s+', ' ', 'g'), 200) as query
            from pg_locks l join pg_stat_activity a on a.pid = l.pid
           where not l.granted and l.locktype = 'advisory' and $1::int = any(pg_blocking_pids(l.pid))`, [lockPid]);
        // Like waitForBlocked, but gives up as soon as the request it waits for has answered (it did not queue).
        const waitQueued = async (n, settled, timeoutMs = 20_000) => {
          const until = Date.now() + timeoutMs;
          for (;;) {
            const now = await blockedBehind();
            if (now >= n || settled() || Date.now() > until) return now;
            await sleep(40);
          }
        };
        const sg2 = `did1-sub-legacyrace-${STAMP}`;
        // Start (and the provider's claims) first, so the callback is the only request in flight when the lock is taken.
        const gRace = await ssoBegin(idpY, orgY.id, { sub: sg2, email: G2.email }, 'R4 G2 racing callback');
        const ticketsBefore = await ticketsOf(G2.id);
        const ySessionsBefore = await sessionsOf(G2.id, orgY.id);
        // The very key both the callback's legacy branch and deactivateUser lock: hashtext(org id), hashtext(the User row's e-mail).
        await beginLock([['select pg_advisory_xact_lock(hashtext($1), hashtext($2))', [orgY.id, g2User.email]]]);
        let cbSettled = false;
        const cbPending = gRace.fire();
        cbPending.then(() => { cbSettled = true; }, () => { cbSettled = true; });
        const cbQueued = await waitQueued(1, () => cbSettled);
        const cbWaiters = await advisoryWaiters();
        // While the lock is held: a row or a ticket written outside it would already be here.
        const yRowHeld = await membership(orgY.id, G2.id);
        const ticketsHeld = await ticketsOf(G2.id);
        let deactSettled = false;
        const deactPending = yPm.send('PATCH', `/users/${G2.id}/deactivate`, {});
        deactPending.then(() => { deactSettled = true; }, () => { deactSettled = true; });
        const bothQueued = await waitQueued(cbSettled ? 1 : 2, () => deactSettled);
        const bothWaiters = await advisoryWaiters();
        await endLock();
        const [cbRes, deactRes] = await Promise.all([cbPending, deactPending]);
        keep('R4 Y deactivates G2', deactRes);
        const yRowAfter = await membership(orgY.id, G2.id);
        const yRows = (await q('select count(*)::int as n from "OrganizationMembership" where "orgId" = $1 and "userId" = $2', [orgY.id, G2.id]))[0].n;
        const xRowAfter = await membership(orgX.id, G2.id);
        const g2After = await identityOf(G2.id);
        const order = cbRes.ticket ? 'callback first' : cbRes.error === 'USER_INACTIVE' ? 'deactivation first' : 'neither';
        // The ticket's state once both have answered decides the one answer complete() may give.
        const ticketState = cbRes.ticket ? await ticketRow(cbRes.ticket) : null;
        const expectRedeem = cbRes.ticket ? (ticketState?.used ? '401 SSO_TICKET_INVALID' : '403 USER_INACTIVE') : null;
        const redeemRes = cbRes.ticket ? await redeem(cbRes.ticket, 'R4 G2 redeems the racing ticket') : null;
        const ticketsAfter = await ticketsOf(G2.id);
        const ySessionsAfter = await sessionsOf(G2.id, orgY.id);
        const landing = cbRes.location ? new URL(cbRes.location, 'http://invalid.local').pathname : '';
        const outcome = order === 'callback first'
          ? landing.endsWith('/sso/complete') && ticketState?.orgId === orgY.id && ticketState.userId === G2.id && ticketsAfter === ticketsBefore + 1
            && said(redeemRes) === expectRedeem && !redeemRes.body?.data?.tokens
          : order === 'deactivation first'
            ? landing.endsWith('/sign-in') && !cbRes.ticket && ticketsAfter === ticketsBefore
            : false;
        r4Done = true;
        check(R4_RACE,
          gRace.start.status === 200 && cbQueued >= 1 && cbWaiters.length === 1 && /pg_advisory_xact_lock/i.test(cbWaiters[0].query)
            && !yRowHeld && ticketsHeld === ticketsBefore
            && bothQueued >= 2 && bothWaiters.length === 2 && bothWaiters.every((w) => /pg_advisory_xact_lock/i.test(w.query))
            && deactRes.status === 200 && cbRes.status === 302 && (cbRes.error === null ? Boolean(cbRes.ticket) : cbRes.error === 'USER_INACTIVE')
            && yRows === 1 && yRowAfter?.status === 'suspended'
            && g2After?.status === 'active' && g2After.epoch === g2User.epoch && xRowAfter?.status === 'active'
            && outcome && ySessionsAfter === ySessionsBefore,
          `start ${said(gRace.start)}; callback queued ${cbQueued} (advisory waiters: ${cbWaiters.map((w) => w.query).join(' | ') || 'none'}); while held: Y row ${JSON.stringify(yRowHeld && { status: yRowHeld.status })}, G2 tickets ${ticketsBefore} -> ${ticketsHeld}; both queued ${bothQueued} (advisory waiters ${bothWaiters.length}); deactivate ${said(deactRes)}; callback ${cbRes.status} -> ${landing || '(no redirect)'} ${cbRes.error ? `ssoError=${cbRes.error}` : (cbRes.ticket ? 'ticket' : 'none')} (${order}); ticket ${JSON.stringify(ticketState && { used: ticketState.used, y: ticketState.orgId === orgY.id })}; redeem ${redeemRes ? said(redeemRes) : 'n/a'} (expected ${expectRedeem || 'n/a'}) tokens ${Boolean(redeemRes?.body?.data?.tokens)}; G2 tickets ${ticketsBefore} -> ${ticketsAfter}; Y rows ${yRows} ${yRowAfter?.status}; identity ${g2After?.status} epoch ${g2User.epoch} -> ${g2After?.epoch}; X ${xRowAfter?.status}; Y refresh sessions ${ySessionsBefore} -> ${ySessionsAfter}`);
        // Which of the two allowed interleavings this run exercised (printed whether the check held or not).
        console.log(`      observed: ${order}; callback ${cbRes.error ? `ssoError=${cbRes.error}` : (cbRes.ticket ? 'ticket' : 'none')}; ticket used before redemption ${ticketState ? ticketState.used : 'n/a'}; redeem ${redeemRes ? said(redeemRes) : 'n/a'}; queued ${cbQueued}/${bothQueued}`);
      }
    } catch (error) {
      console.log(`SECTION ERROR (R4): ${error.stack || error.message}`);
      if (lockOpen) {
        lockOpen = false;
        await lockDb.query('rollback').catch(() => null);
      }
      if (!r4Done) check(R4_RACE, false, `section error: ${error.message}`);
    }

    // ── nothing else changed ───────────────────────────────────────────────────
    console.log('\n── nothing else changed ──');
    const own = new Set([X_CODE, Y_CODE, Z_CODE]);
    const changes = fingerprint.compare(printBefore, await fingerprint.take(db)).filter((c) => !c.noise && !own.has(c.org));
    check('no company other than X, Y and Z changed', changes.length === 0, changes.map((c) => `${c.table}:${c.org}`).join(', ') || 'none');
    const fives = answers.filter((a) => a.status >= 500);
    check('no answer was a 5xx', fives.length === 0, fives.map((a) => `${a.label} ${a.status}`).join(', '));
  } finally {
    // Put the fixtures back and the SSO settings as they were read.
    const cleanup = [];
    if (lockOpen) {
      lockOpen = false;
      await lockDb.query('rollback').catch((error) => cleanup.push(`lock rollback: ${error.message}`));
    }
    try {
      if (fixtures.left) await db.query('update "OrganizationMembership" set status = $2, "leftAt" = $3 where id = $1', [fixtures.left.id, fixtures.left.status, fixtures.left.leftAt]);
    } catch (error) { cleanup.push(`left: ${error.message}`); }
    // The legacy fixtures (G, and G2 of R4): the removed row goes back unless the product wrote one since.
    for (const [label, saved] of [['legacy', fixtures.legacy], ['legacy R4', fixtures.legacyRace]]) {
      try {
        if (saved) {
          const present = (await db.query('select count(*)::int as n from "OrganizationMembership" where "orgId" = $1 and "userId" = $2', [saved.orgId, saved.userId])).rows[0].n;
          if (!present) await db.query('insert into "OrganizationMembership" select * from jsonb_populate_record(null::"OrganizationMembership", $1::jsonb)', [JSON.stringify(saved)]);
        }
      } catch (error) { cleanup.push(`${label}: ${error.message}`); }
    }
    for (const [orgId, row] of Object.entries(ssoBefore)) {
      try {
        if (!row) continue;
        const sets = SSO_COLUMNS.map((c, i) => `"${c}" = $${i + 2}${c === 'ssoDomainsJson' ? '::jsonb' : ''}`).join(', ');
        await db.query(`update "Organisation" set ${sets} where id = $1`, [orgId, ...SSO_COLUMNS.map((c) => (c === 'ssoDomainsJson' ? JSON.stringify(row[c] ?? []) : row[c]))]);
      } catch (error) { cleanup.push(`sso ${orgId}: ${error.message}`); }
    }
    for (const idp of idps) idp.server.close();
    if (cleanup.length) console.log(`cleanup problems: ${cleanup.join('; ')}`);
    results.cleanup = cleanup;
    await lockDb.end().catch(() => {});
    await db.end().catch(() => {});
  }
};

const finish = (error = null) => {
  if (error) console.error(`SCRIPT ERROR: ${error.stack || error.message}`);
  if (results.length !== EXPECTED_CHECKS) check(`the proof ran its fixed ${EXPECTED_CHECKS} checks`, false, `${results.length} ran`);
  const failed = results.filter((r) => !r.ok).length;
  const passed = results.length - failed;
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, `${NAME}.json`), JSON.stringify({
    proof: NAME, stamp: STAMP, at: new Date().toISOString(), companies: { X: X_CODE, Y: Y_CODE, Z: Z_CODE },
    expected: EXPECTED_CHECKS, passed, failed, error: error ? String(error.message || error) : null, cleanup: results.cleanup || [],
    checks: results.map(({ name, ok, detail }) => ({ name, ok, ...(ok ? {} : { detail }) })),
  }, null, 2));
  console.log(`\n${NAME}: ${passed} passed, ${failed} failed of ${EXPECTED_CHECKS}`);
  process.exitCode = !error && failed === 0 && passed === EXPECTED_CHECKS ? 0 : 2;
};

main().then(() => finish(), (error) => finish(error));
