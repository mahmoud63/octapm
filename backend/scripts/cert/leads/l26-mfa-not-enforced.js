'use strict';
/**
 * L26 — Organisation.mfaRequired is advisory, not enforced on the request path.
 *
 * An admin of workspace 024 turns on the org-wide MFA requirement. A member
 * who has NOT enrolled a second factor then signs in with password only and
 * receives a full, bound access token. That token is accepted on protected
 * endpoints — the org policy buys nothing on the request path.
 *
 * Proven on a throwaway member of 024, so no persona is touched.
 */
const { as, raw } = require('../lib/api');
const { createByInvitation } = require('../lib/invitations');

const PASSWORD = process.env.CERT_PASSWORD; // read, never printed
const stamp = Date.now();
const memberEmail = `l26.member.${stamp}@c024.octapm-cert.test`;

const show = (label, res) => {
  console.log(`\n${label}`);
  console.log('  status:', res.status);
  console.log('  body  :', JSON.stringify(res.body));
};

(async () => {
  const pm24 = as('pm@c024.octapm-cert.test');

  // 1. Create a throwaway member in 024 (mfaEnabled defaults to false): since D-ID-1 the one way is an
  //    invitation from 024 that the new e-mail accepts with its own name and password.
  const member = await createByInvitation({ inviter: pm24, email: memberEmail, role: 'site_engineer', name: 'L26 Non-enrolled Member', password: PASSWORD });
  if (!member.userId) throw new Error(`setup: the member was not created in 024 (invite ${member.invited?.status} / accept ${member.accepted?.status})`);
  console.log('[setup] member created in 024, id =', member.userId);

  // 2. Admin turns the org-wide MFA requirement ON.
  const policy = await pm24.send('PUT', '/company/security/sso', { mfaRequired: true });
  show('[setup] PUT /company/security/sso {mfaRequired:true}', policy);
  const overview = await pm24.GET('/company/security');
  console.log('[setup] GET /company/security -> mfaRequired =', overview.mfaRequired);

  // 3. The non-enrolled member logs in with PASSWORD ONLY.
  const login = await raw('POST', '/auth/login', { json: { email: memberEmail, password: PASSWORD } });
  show('[attack] POST /auth/login (password only)', login);
  const data = login.body?.data || {};
  const gotFullSession = Boolean(data.tokens?.accessToken);
  const wasChallenged = Boolean(data.mfaRequired && data.mfaToken);
  const enrollFlag = data.user?.mfaEnrollmentRequired;
  console.log('\n  full bound session issued:', gotFullSession);
  console.log('  second factor demanded   :', wasChallenged);
  console.log('  user.mfaEnrollmentRequired:', enrollFlag);

  // 4. Use the access token on a protected endpoint.
  let protectedStatus = null;
  if (gotFullSession) {
    const projects = await raw('GET', '/projects', { token: data.tokens.accessToken });
    protectedStatus = projects.status;
    console.log('\n[attack] GET /projects with that token -> status', projects.status);
  }

  const defect = gotFullSession && !wasChallenged && protectedStatus === 200;
  console.log('\n--- assessment ---');
  console.log('  org requires MFA but non-enrolled member reached a protected endpoint:', defect);

  // Restore the policy so the shared workspace is left as found.
  await pm24.send('PUT', '/company/security/sso', { mfaRequired: false }).catch(() => {});

  if (defect) {
    process.exitCode = 2;
    console.log('\nVERDICT L26: CONFIRMED — with Organisation.mfaRequired=true a member who never enrolled a second factor logs in with password alone, gets a full access token, and that token is honoured on GET /projects; the MFA policy is advisory only.');
  } else {
    process.exitCode = 0;
    console.log('\nVERDICT L26: NOT_REPRODUCED — the MFA policy blocked the password-only session on the request path.');
  }
})().catch((e) => { console.error('ERROR', e.stack || e.message); process.exitCode = 1; });
