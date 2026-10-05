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
 */

const crypto = require('crypto');
const { as, raw } = require('../lib/api');
const invitations = require('../lib/invitations');
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
    const res = await homePm.send('POST', '/users', { name: `L39 ${label} ${STAMP}`, email, password, role: 'site_engineer' });
    if (res.status !== 201) throw new Error(`create ${label}: ${said(res)}`);
    return { id: res.body.data.id, email };
  };
  const solo = await mk('solo');
  const shared = await mk('shared');
  // OTHER invites the person; they accept with their own session (L38).
  const addedElsewhere = await invitations.joinByInvitation({ inviter: otherPm, email: shared.email, role: 'qs', via: 'users', name: `L39 shared ${STAMP}` });
  check('the shared person is a member of both companies (setup: invited by the other company, accepted)', addedElsewhere.invited?.status === 202 && addedElsewhere.accepted?.status === 200, `${addedElsewhere.invited ? said(addedElsewhere.invited) : '-'} | ${addedElsewhere.accepted ? said(addedElsewhere.accepted) : '-'}`);

  const login = async (email, pwd) => (await raw('POST', '/auth/login', { json: { email, password: pwd } })).status;
  const newEmail = (who) => `l39.${who}.moved.${STAMP}@${home.domain}`;

  // â”€â”€ the shared identity: every credential action is refused â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const sharedReset = await homePm.send('POST', `/users/${shared.id}/reset-password`, { newPassword: `Seized-${STAMP}1!` });
  check('a home admin cannot set the password of a person who also belongs to another company', sharedReset.status === 403 && sharedReset.body?.error?.code === 'IDENTITY_SHARED', said(sharedReset));
  check('â€¦and that person\'s own password still works', (await login(shared.email, password)) === 200);
  const sharedEmail = await homePm.send('PATCH', `/users/${shared.id}`, { email: newEmail('shared') });
  check('a home admin cannot move the login e-mail of a shared person', sharedEmail.status === 403 && sharedEmail.body?.error?.code === 'IDENTITY_SHARED', said(sharedEmail));
  check('â€¦and the e-mail did not move', (await prisma.user.findUnique({ where: { id: shared.id }, select: { email: true } })).email === shared.email);
  const sharedMfa = await homePm.send('POST', `/company/security/users/${shared.id}/mfa/reset`, {});
  check('a home admin cannot clear the second factor of a shared person', sharedMfa.status === 403 && sharedMfa.body?.error?.code === 'IDENTITY_SHARED', said(sharedMfa));

  // â”€â”€ the single-company identity: the same actions still work â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const soloReset = await homePm.send('POST', `/users/${solo.id}/reset-password`, { newPassword: `Reset-${STAMP}1!` });
  check('a home admin can reset the password of a person who belongs only to this company', soloReset.status === 200, said(soloReset));
  check('â€¦and the new password works', (await login(solo.email, `Reset-${STAMP}1!`)) === 200);
  const soloEmail = await homePm.send('PATCH', `/users/${solo.id}`, { email: newEmail('solo') });
  check('a home admin can change the e-mail of a single-company person', soloEmail.status === 200, said(soloEmail));
  const soloMfa = await homePm.send('POST', `/company/security/users/${solo.id}/mfa/reset`, {});
  check('a home admin can clear the second factor of a single-company person', soloMfa.status === 200, said(soloMfa));

  await prisma.$disconnect();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nshared-identity proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

