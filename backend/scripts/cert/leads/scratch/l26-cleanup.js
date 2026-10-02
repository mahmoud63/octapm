'use strict';
// Scratch (independent checker, L26): deactivate the throwaway member the claim's script
// left active when the checker ran it, and show the policy of 024 as left.
const { as } = require('../../lib/api');

const LEFT_BY_CHECKER_RUN = '158d579b-f0dc-4489-937e-44334eddbaff';

(async () => {
  const pm = as('pm@c024.octapm-cert.test');
  const off = await pm.send('PATCH', `/users/${LEFT_BY_CHECKER_RUN}/deactivate`, {});
  console.log('PATCH /users/:id/deactivate ->', off.status, off.body?.error?.code || off.body?.data?.status || '');
  const after = await pm.GET('/company/security');
  console.log('024 after: mfaRequired =', after.mfaRequired, 'summary', JSON.stringify(after.summary));
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
