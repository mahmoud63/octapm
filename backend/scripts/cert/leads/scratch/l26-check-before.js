'use strict';
// Scratch (independent checker, L26): what the security policy of 024 and 025 is right now.
const { as } = require('../../lib/api');

(async () => {
  for (const code of ['024', '025']) {
    const s = await as(`pm@c${code}.octapm-cert.test`).send('GET', '/company/security');
    const d = s.body?.data || {};
    console.log(code, 'GET /company/security ->', s.status, JSON.stringify({ mfaRequired: d.mfaRequired, summary: d.summary }));
  }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
