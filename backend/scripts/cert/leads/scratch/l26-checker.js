'use strict';
/**
 * Scratch — independent check of L26 (Organisation.mfaRequired is advisory).
 *
 * Besides repeating the claim it asks four things the claim's script does not:
 *   A. control: with the policy OFF the same login carries mfaEnrollmentRequired=false
 *      (so the flag really follows the policy and the 200 is not an ignored field);
 *   B. the token is not merely accepted on an empty list: it reads company data;
 *   C. the second issue path (POST /auth/workspaces/:orgId/session) behaves the same;
 *   D. what the policy DOES enforce (challenge once enrolled, refusal to turn off), and
 *      whether enrolment itself needs anything beyond the password-only session — which
 *      decides what an attacker holding only a password would gain from a forced-enrolment gate.
 *
 * Everything happens on a throwaway member of 024; the policy is put back as found
 * and the throwaway is deactivated.
 */
const path = require('path');
const { as, raw } = require('../../lib/api');
const { totp } = require(path.join(__dirname, '..', '..', '..', '..', 'src', 'utils', 'totp'));

const PASSWORD = process.env.CERT_PASSWORD; // never printed
const stamp = Date.now();
const email = `l26.checker.${stamp}@c024.octapm-cert.test`;
const mask = (value) => JSON.stringify(value, (key, v) => {
  if (['accessToken', 'refreshToken', 'mfaToken', 'identityToken', 'secret', 'otpauthUrl', 'qrSvg', 'backupCodes'].includes(key)) return v ? '<present>' : v;
  return v;
});
const line = (label, res) => console.log(`${label} -> ${res.status} ${mask(res.body?.data ?? res.body?.error ?? res.body).slice(0, 600)}`);

(async () => {
  const pm = as('pm@c024.octapm-cert.test');
  const before = await pm.GET('/company/security');
  console.log('[before] 024 mfaRequired =', before.mfaRequired);

  const member = await pm.POST('/users', { name: 'L26 Checker Throwaway', email, password: PASSWORD, role: 'site_engineer' });
  console.log('[setup] throwaway member', member.id, 'role', member.role, 'orgId', member.orgId);
  const login = () => raw('POST', '/auth/login', { json: { email, password: PASSWORD } });

  const facts = {};
  try {
    // A. control — policy OFF
    await pm.send('PUT', '/company/security/sso', { mfaRequired: false });
    const off = await login();
    line('[A] policy OFF: POST /auth/login', off);
    facts.flagWhenOff = off.body?.data?.user?.mfaEnrollmentRequired;

    // policy ON
    const put = await pm.send('PUT', '/company/security/sso', { mfaRequired: true });
    console.log('[setup] PUT /company/security/sso {mfaRequired:true} ->', put.status, 'mfaRequired =', put.body?.data?.mfaRequired);

    // the claim
    const on = await login();
    line('[claim] policy ON: POST /auth/login (password only)', on);
    const token = on.body?.data?.tokens?.accessToken;
    facts.flagWhenOn = on.body?.data?.user?.mfaEnrollmentRequired;
    facts.sessionIssued = Boolean(token);
    facts.challenged = Boolean(on.body?.data?.mfaRequired);

    // B. is the token good for real company data?
    const projects = await raw('GET', '/projects', { token });
    const list = projects.body?.data?.items ?? projects.body?.data ?? [];
    console.log('[B] GET /projects ->', projects.status, 'rows', Array.isArray(list) ? list.length : typeof list);
    const users = await raw('GET', '/users', { token });
    const people = users.body?.data?.items ?? users.body?.data ?? [];
    console.log('[B] GET /users ->', users.status, 'rows', Array.isArray(people) ? people.length : typeof people,
      Array.isArray(people) && people[0] ? `(first: ${people[0].email})` : '');
    const status = await raw('GET', '/auth/mfa', { token });
    line('[B] GET /auth/mfa', status);
    facts.projectsStatus = projects.status;
    facts.usersStatus = users.status;

    // B2. a fresh site engineer is on no project, so an empty 200 proves little. The same
    // sign-in for an existing, never-enrolled persona of 024 (nothing about them is changed):
    const qsLogin = await raw('POST', '/auth/login', { json: { email: 'qs@c024.octapm-cert.test', password: PASSWORD } });
    const qsData = qsLogin.body?.data || {};
    console.log('[B2] policy ON: POST /auth/login qs@c024 (password only) ->', qsLogin.status,
      mask({ mfaEnabled: qsData.user?.mfaEnabled, mfaEnrollmentRequired: qsData.user?.mfaEnrollmentRequired, challenge: Boolean(qsData.mfaRequired), tokens: qsData.tokens }));
    const qsToken = qsData.tokens?.accessToken;
    const qsProjects = await raw('GET', '/projects', { token: qsToken });
    const qsRows = qsProjects.body?.data?.items ?? qsProjects.body?.data?.projects ?? qsProjects.body?.data ?? [];
    console.log('[B2] GET /projects ->', qsProjects.status, 'rows', Array.isArray(qsRows) ? qsRows.length : mask(qsRows).slice(0, 200),
      Array.isArray(qsRows) && qsRows[0] ? `(first: ${qsRows[0].id} "${qsRows[0].name}")` : '');
    facts.personaSessionIssued = Boolean(qsToken);
    facts.personaProjectRows = Array.isArray(qsRows) ? qsRows.length : null;
    if (Array.isArray(qsRows) && qsRows[0]) {
      const ipc = await raw('GET', `/projects/${qsRows[0].id}/ipc`, { token: qsToken });
      const ipcRows = ipc.body?.data?.items ?? ipc.body?.data ?? [];
      console.log('[B2] GET /projects/:id/ipc ->', ipc.status, 'rows', Array.isArray(ipcRows) ? ipcRows.length : mask(ipcRows).slice(0, 200));
      facts.personaCommercialRead = ipc.status;
    }

    // C. the second issue path
    const orgId = on.body?.data?.user?.orgId;
    const again = await raw('POST', `/auth/workspaces/${orgId}/session`, { token });
    line('[C] POST /auth/workspaces/:orgId/session with that token', again);
    facts.workspacePathIssued = Boolean(again.body?.data?.tokens?.accessToken || again.body?.data?.accessToken);
    facts.workspacePathFlag = again.body?.data?.user?.mfaEnrollmentRequired;

    // D. what the policy enforces, and what enrolment needs
    const setup = await raw('POST', '/auth/mfa/setup', { token, json: {} });
    line('[D] POST /auth/mfa/setup (password-only session, nothing else)', setup);
    const secret = setup.body?.data?.secret;
    const enable = await raw('POST', '/auth/mfa/enable', { token, json: { code: totp(secret) } });
    line('[D] POST /auth/mfa/enable {code}', enable);
    facts.selfEnrolWithPasswordOnly = enable.status === 200;

    const challenged = await login();
    line('[D] enrolled: POST /auth/login (password only)', challenged);
    facts.enrolledChallenged = Boolean(challenged.body?.data?.mfaRequired) && !challenged.body?.data?.tokens;

    const disable = await raw('POST', '/auth/mfa/disable', { token, json: { password: PASSWORD, code: totp(secret, { time: Date.now() + 30_000 }) } });
    line('[D] POST /auth/mfa/disable {password, code} while the org requires MFA', disable);
    facts.disableRefused = disable.status === 403 && disable.body?.error?.code === 'MFA_REQUIRED_BY_ORG';
  } finally {
    const restore = await pm.send('PUT', '/company/security/sso', { mfaRequired: Boolean(before.mfaRequired) });
    console.log('[cleanup] policy restored ->', restore.status, 'mfaRequired =', restore.body?.data?.mfaRequired);
    const off = await pm.send('PATCH', `/users/${member.id}/deactivate`, {});
    console.log('[cleanup] throwaway deactivated ->', off.status);
  }

  console.log('\n--- facts ---');
  console.log(JSON.stringify(facts, null, 2));
  const defect = facts.sessionIssued && !facts.challenged && facts.projectsStatus === 200;
  process.exitCode = defect ? 2 : 0;
  console.log(`\nVERDICT L26 (checker): ${defect ? 'CONFIRMED' : 'NOT_REPRODUCED'} — policy ON, non-enrolled member, password only: session issued=${facts.sessionIssued}, challenged=${facts.challenged}, GET /projects=${facts.projectsStatus}; flag off/on=${facts.flagWhenOff}/${facts.flagWhenOn}.`);
})().catch((e) => { console.error('ERROR', e.stack || e.message); process.exitCode = 1; });
