'use strict';

/**
 * The live proof of finding L39: a home-workspace administrator cannot seize an
 * identity that also belongs to other companies â€” not by setting its password,
 * not by moving its login e-mail, not by clearing its second factor. For an
 * identity that belongs to one company only, the same administrator actions
 * still work (so the fix is not a blanket refusal).
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/shared-identity-proof.js [home=024] [other=025]
 *
 * Throwaway identities are created for the run; no persona or multi-company
 * person is touched.
 *
 * Since D-ID-1 (CERT-3 plan §2.6) they are made by invitation and acceptance
 * (lib/invitations createByInvitation). The administrator no longer sets a
 * password (POST /users/:id/reset-password is gone) or changes anyone's
 * sign-in e-mail (400 USER_EMAIL_IDENTITY_OWNED for every person), so the
 * checks that asserted those routes' old answers are reported as SUPERSEDED BY
 * D-ID-1, not run and not counted.
 */

const crypto = require('crypto');
const { as, raw } = require('../lib/api');
const invitations = require('../lib/invitations');
const { reportSuperseded, superseded } = require('../lib/superseded');
const { buildPopulation } = require('../lib/spec');
const guard = require('../lib/cert-env');

const HOME = process.argv[2] || '024';
const OTHER = process.argv[3] || '025';
const STAMP = crypto.randomBytes(3).toString('hex');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const said = (res) => `${res.status} ${res.body?.error?.code || ''}`.trim();

const main = async () => {
  const password = process.env.CERT_PASSWORD;
  const { companies } = buildPopulation();
  const home = companies.find((c) => c.code === HOME);
  const other = companies.find((c) => c.code === OTHER);
  const homePm = as(`pm@${home.domain}`);
  const otherPm = as(`pm@${other.domain}`);
  const prisma = await guard.connectCertPrisma();

  // A person who belongs to HOME only, and a person who belongs to HOME and OTHER.
  const mk = async (label) => {
    const email = `l39.${label}.${STAMP}@${home.domain}`;
    // HOME invites the new e-mail; it accepts with its own name and password (D-ID-1).
    const made = await invitations.createByInvitation({ inviter: homePm, email, role: 'site_engineer', name: `L39 ${label} ${STAMP}`, password });
    if (!made.userId) throw new Error(`create ${label}: invite ${made.invited ? said(made.invited) : '-'} | accept ${made.accepted ? said(made.accepted) : '-'}`);
    return { id: made.userId, email };
  };
  const solo = await mk('solo');
  const shared = await mk('shared');
  // OTHER invites the person; they accept with their own session (L38).
  const addedElsewhere = await invitations.joinByInvitation({ inviter: otherPm, email: shared.email, role: 'qs', via: 'users', name: `L39 shared ${STAMP}` });
  superseded('setup: the other company\'s POST /users for an existing identity answers 202', `every add answers 201 with the invitation; answered ${addedElsewhere.invited ? said(addedElsewhere.invited) : '-'}`);
  check('the shared person is a member of both companies (setup: invited by the other company, accepted)', addedElsewhere.invited?.status < 300 && addedElsewhere.accepted?.status === 200, `${addedElsewhere.invited ? said(addedElsewhere.invited) : '-'} | ${addedElsewhere.accepted ? said(addedElsewhere.accepted) : '-'}`);

  const login = async (email, pwd) => (await raw('POST', '/auth/login', { json: { email, password: pwd } })).status;
  const newEmail = (who) => `l39.${who}.moved.${STAMP}@${home.domain}`;

  // â”€â”€ the shared identity: every credential action is refused â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  superseded('a home admin cannot set the password of a person who also belongs to another company (403 IDENTITY_SHARED)', 'Q4: POST /users/:id/reset-password was removed for every person; an administrator can only have the self-service reset e-mail sent (POST /users/:id/password-reset-email) and never sets or sees a password; not sent');
  check('â€¦and that person\'s own password still works', (await login(shared.email, password)) === 200);
  const sharedEmail = await homePm.send('PATCH', `/users/${shared.id}`, { email: newEmail('shared') });
  superseded('a home admin\'s attempt to move a shared person\'s login e-mail is refused 403 IDENTITY_SHARED', `the e-mail field is refused 400 USER_EMAIL_IDENTITY_OWNED for every person; answered ${said(sharedEmail)}`);
  check('a home admin cannot move the login e-mail of a shared person', sharedEmail.status >= 400 && sharedEmail.status < 500, said(sharedEmail));
  check('â€¦and the e-mail did not move', (await prisma.user.findUnique({ where: { id: shared.id }, select: { email: true } })).email === shared.email);
  const sharedMfa = await homePm.send('POST', `/company/security/users/${shared.id}/mfa/reset`, {});
  check('a home admin cannot clear the second factor of a shared person', sharedMfa.status === 403 && sharedMfa.body?.error?.code === 'IDENTITY_SHARED', said(sharedMfa));

  // â”€â”€ the single-company identity: the same actions still work â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  superseded('a home admin can reset the password of a person who belongs only to this company', 'Q4: POST /users/:id/reset-password was removed; the administrator never sets a password (the reset e-mail route is judged by the D-ID-1 proof); not sent');
  superseded('…and the new password works', 'no password is set by the administrator (Q4), so there is no new password to sign in with; not run');
  superseded('a home admin can change the e-mail of a single-company person', 'a person\'s sign-in e-mail is theirs (D-ID-1): PATCH /users/:id with an email field answers 400 USER_EMAIL_IDENTITY_OWNED for every person; not sent');
  const soloMfa = await homePm.send('POST', `/company/security/users/${solo.id}/mfa/reset`, {});
  check('a home admin can clear the second factor of a single-company person', soloMfa.status === 200, said(soloMfa));

  await prisma.$disconnect();
  const failed = results.filter((r) => !r.ok);
  const replaced = reportSuperseded('shared-identity proof');
  console.log(`\nshared-identity proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}${replaced.length ? `; ${replaced.length} superseded by D-ID-1 (not counted)` : ''}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

