'use strict';
/**
 * L39 — A home-workspace admin can take over an identity that also belongs to
 * other workspaces (silent, no notification).
 *
 * Setup (all throwaway): identity U is created in 024 (its HOME workspace) and
 * is also made a member of 025. The 024 admin then resets U's password via
 * POST /users/:id/reset-password. The admin now knows U's password, can sign
 * in as U, and can exchange that into a full session inside 025 with U's role
 * there — a cross-workspace account takeover. 024's admin also changes U's
 * login e-mail, which U does not control.
 *
 * No persona and no multi-company persona (user.a/b/c) is modified.
 *
 * Since D-ID-1 (CERT-3 plan §2.6) U is made by invitation and acceptance, and
 * the reset step (3) is SUPERSEDED BY D-ID-1: the route was removed, so it is
 * not sent and is listed as superseded at the end of the output.
 */
const { as, raw, API } = require('../lib/api');
const { createByInvitation, joinByInvitation } = require('../lib/invitations');
const { reportSuperseded, superseded } = require('../lib/superseded');

const PASSWORD = process.env.CERT_PASSWORD; // read, never printed
const ADMIN_CHOSEN_PW = 'Seized0nce1'; // the password the home admin sets; a throwaway's only
const stamp = Date.now();
const uEmail = `l39.u.${stamp}@c024.octapm-cert.test`;

const show = (label, res) => {
  console.log(`\n${label}`);
  console.log('  status:', res.status);
  console.log('  body  :', JSON.stringify(res.body));
};

(async () => {
  const pm24 = as('pm@c024.octapm-cert.test');
  const pm25 = as('pm@c025.octapm-cert.test');
  const org24 = (await pm24.GET('/auth/me')).active.orgId;
  const org25 = (await pm25.GET('/auth/me')).active.orgId;

  // 1. U is created with HOME = 024: since D-ID-1 the one way is an invitation from 024 that the
  //    new e-mail accepts with its own name and password.
  const made = await createByInvitation({ inviter: pm24, email: uEmail, role: 'site_engineer', name: 'U Shared Identity', password: PASSWORD });
  if (!made.userId) throw new Error(`setup: U was not created in 024 (invite ${made.invited?.status} / accept ${made.accepted?.status})`);
  const u = { id: made.userId };
  console.log('[setup] U created, home 024, id =', u.id);

  // 2. U is also made a member of 025 (role qs there): 025 invites, U accepts
  //    with its own session (the only way since L38).
  const joined = await joinByInvitation({ inviter: pm25, email: uEmail, role: 'qs', via: 'users', name: 'U Shared Identity' });
  if (joined.accepted?.status !== 200) throw new Error(`setup: U did not join 025 (${joined.invited?.status} / ${joined.accepted?.status})`);
  const loginBefore = await raw('POST', '/auth/login', { json: { email: uEmail, password: PASSWORD } });
  const membershipsBefore = (loginBefore.body?.data?.memberships || []).map((m) => `${m.orgId}:${m.role}`);
  console.log('[setup] U memberships:', JSON.stringify(membershipsBefore));
  console.log('[setup] original-password login status:', loginBefore.status, '(U controls the account)');

  // 3. The 024 admin resets U's password to a value THE ADMIN chooses.
  //    SUPERSEDED BY D-ID-1 (Q4): POST /users/:id/reset-password was removed for every person; an
  //    administrator can only have the self-service reset e-mail sent and never sets or sees a password.
  //    The step is not sent; the steps after it still try the admin-chosen password and report what happens.
  superseded('[attack] POST /users/:id/reset-password (024, U home workspace): the home admin sets U\'s password', 'Q4: the route was removed for every person; an administrator can only have the self-service reset e-mail sent (POST /users/:id/password-reset-email) and never sets or sees a password; not sent');

  // 3b. The original password no longer works (U is locked out / sessions revoked).
  const oldPwLogin = await raw('POST', '/auth/login', { json: { email: uEmail, password: PASSWORD } });
  console.log('\n[attack] U original password now ->', oldPwLogin.status, oldPwLogin.body?.error?.code || 'OK');

  // 4. The admin signs in AS U with the password they set.
  const seized = await raw('POST', '/auth/login', { json: { email: uEmail, password: ADMIN_CHOSEN_PW } });
  show('[attack] admin signs in AS U with the chosen password', seized);
  const identityToken = seized.body?.data?.identityToken;
  const seizedLogin = Boolean(identityToken || seized.body?.data?.tokens?.accessToken);

  // 5. The admin exchanges that into a full session inside 025 as U.
  let enteredB = false; let roleInB = null; let projectsStatusInB = null;
  if (identityToken) {
    const session25 = await raw('POST', `/auth/workspaces/${org25}/session`, { token: identityToken });
    show('[attack] exchange into workspace 025 as U', session25);
    const d = session25.body?.data || {};
    roleInB = d.user?.role;
    enteredB = session25.status === 200 && d.user?.orgId === org25 && Boolean(d.tokens?.accessToken);
    if (enteredB) {
      const projects = await raw('GET', '/projects', { token: d.tokens.accessToken });
      projectsStatusInB = projects.status;
      console.log('\n[attack] acting as U inside 025: GET /projects ->', projects.status);
    }
  }

  // 6. The home admin can also change U's login e-mail (identity-level, U cannot stop it).
  const newEmail = `l39.hijacked.${stamp}@c024.octapm-cert.test`;
  const emailChange = await pm24.send('PATCH', `/users/${u.id}`, { email: newEmail });
  console.log('\n[attack] PATCH /users/:id {email} (024) ->', emailChange.status, 'new email applied:', emailChange.body?.data?.email === newEmail);

  const takeover = seizedLogin && enteredB && roleInB === 'qs' && projectsStatusInB === 200;
  console.log('\n--- assessment ---');
  console.log('  home admin set a password and signed in as U     :', seizedLogin);
  console.log('  reached a full session inside 025 as U (role qs) :', enteredB, roleInB);
  console.log('  acted on 025 data as U (GET /projects 200)       :', projectsStatusInB === 200);
  console.log('  home admin also rewrote U\'s login e-mail        :', emailChange.body?.data?.email === newEmail);
  reportSuperseded('L39');

  if (takeover) {
    process.exitCode = 2;
    console.log('\nVERDICT L39: CONFIRMED — the admin of U\'s home workspace (024) reset U\'s password, signed in as U, and exchanged that into a live session inside workspace 025 with U\'s role there, then read 025 project data; the e-mail was rewritten too. A cross-workspace account takeover with no consent or notification.');
  } else {
    process.exitCode = 0;
    console.log('\nVERDICT L39: NOT_REPRODUCED — the home workspace could not seize the identity across workspaces.');
  }
})().catch((e) => { console.error('ERROR', e.stack || e.message); process.exitCode = 1; });
