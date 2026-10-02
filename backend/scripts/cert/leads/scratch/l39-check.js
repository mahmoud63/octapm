'use strict';
/**
 * L39 independent check (scratch). Throwaway identity only; no persona touched.
 * Asks: is the victim really another company's data, is the home rule
 * deliberate (controls from the non-home side), does the home workspace keep
 * the power after the person no longer works there, and does anyone get told.
 */
const { as, raw } = require('../../lib/api');

const PASSWORD = process.env.CERT_PASSWORD; // never printed
const SEIZED = 'Seized0nce2';
const stamp = Date.now();
const email = `l39.chk.${stamp}@c024.octapm-cert.test`;
const brief = (res) => `${res.status} ${res.body?.error ? `${res.body.error.code}: ${res.body.error.message}` : JSON.stringify(res.body?.data).slice(0, 260)}`;
const withoutTokens = (data) => JSON.parse(JSON.stringify(data, (k, v) => (/token/i.test(k) ? '(withheld)' : v)));

(async () => {
  const pm24 = as('pm@c024.octapm-cert.test');
  const pm25 = as('pm@c025.octapm-cert.test');
  const me24 = await pm24.GET('/auth/me');
  const me25 = await pm25.GET('/auth/me');
  const org24 = me24.active.orgId; const org25 = me25.active.orgId;
  console.log('024 =', org24, ' 025 =', org25);

  // setup
  const u = await pm24.POST('/users', { name: 'L39 Check', email, password: PASSWORD, role: 'site_engineer' });
  const added = await pm25.send('POST', '/users', { name: 'ignored', email, role: 'qs' });
  console.log('\n[setup] 025 adds the existing identity ->', brief(added));
  const projects25 = await pm25.GET('/projects');
  const list25 = projects25.items || projects25;
  const project = list25[0];
  const team = await pm25.send('POST', `/projects/${project.id}/team`, { userId: u.id });
  console.log('[setup] 025 puts U on its project', project.id, '->', team.status);

  // controls: the NON-home workspace is refused all three identity-level actions
  console.log('\n[control] 025 (not home) reset-password ->', brief(await pm25.send('POST', `/users/${u.id}/reset-password`, { newPassword: 'NotHome0nce1' })));
  console.log('[control] 025 (not home) PATCH email     ->', brief(await pm25.send('PATCH', `/users/${u.id}`, { email: `l39.no.${stamp}@c025.octapm-cert.test` })));
  console.log('[control] 025 (not home) MFA reset       ->', brief(await pm25.send('POST', `/company/security/users/${u.id}/mfa/reset`, {})));

  // the person leaves 024: 024 deactivates them there. The identity stays open because of 025.
  const deact = await pm24.send('PATCH', `/users/${u.id}/deactivate`);
  console.log('\n[departure] 024 deactivates U in 024 ->', brief(deact));
  const afterLeave = await raw('POST', '/auth/login', { json: { email, password: PASSWORD } });
  const d0 = afterLeave.body?.data || {};
  console.log('[departure] U signs in with own password ->', afterLeave.status, 'lands in', d0.user?.orgId || '(choice)', 'memberships:', JSON.stringify((d0.memberships || []).map((m) => `${m.name}:${m.status}`)));

  // 024, where U no longer works, still resets the password and the second factor
  const reset = await pm24.send('POST', `/users/${u.id}/reset-password`, { newPassword: SEIZED });
  console.log('\n[attack] 024 reset-password AFTER U left 024 ->', brief(reset));
  console.log('[attack] 024 MFA reset AFTER U left 024      ->', brief(await pm24.send('POST', `/company/security/users/${u.id}/mfa/reset`, {})));
  const own = await raw('POST', '/auth/login', { json: { email, password: PASSWORD } });
  console.log('[attack] U own password now ->', own.status, own.body?.error?.code || 'OK');

  const seized = await raw('POST', '/auth/login', { json: { email, password: SEIZED } });
  const sd = seized.body?.data || {};
  console.log('[attack] sign-in with the password 024 chose ->', seized.status, JSON.stringify(withoutTokens({ chooseWorkspace: sd.chooseWorkspace, user: sd.user && { orgId: sd.user.orgId, role: sd.user.role }, memberships: (sd.memberships || []).map((m) => `${m.name}:${m.role}:${m.status}`) })));
  let token = sd.tokens?.accessToken || null;
  if (!token && sd.identityToken) {
    const ex = await raw('POST', `/auth/workspaces/${org25}/session`, { token: sd.identityToken });
    console.log('[attack] exchange into 025 ->', ex.status, ex.body?.data?.user?.orgId, ex.body?.data?.user?.role);
    token = ex.body?.data?.tokens?.accessToken || null;
  }

  const leaked = { projects: 0, project: null, users: 0 };
  if (token) {
    const meU = await raw('GET', '/auth/me', { token });
    console.log('[attack] /auth/me as U -> active org', meU.body?.data?.active?.orgId === org25 ? '025' : meU.body?.data?.active?.orgId);
    const pr = await raw('GET', '/projects', { token });
    const items = pr.body?.data?.items || pr.body?.data || [];
    leaked.projects = items.length;
    console.log('[attack] GET /projects as U in 025 ->', pr.status, 'count', items.length, items.slice(0, 3).map((p) => `${p.name} [org ${p.orgId === org25 ? '025' : p.orgId}]`));
    const one = await raw('GET', `/projects/${project.id}`, { token });
    leaked.project = one.status === 200 ? one.body?.data?.name : null;
    console.log('[attack] GET /projects/<025 project> ->', one.status, one.body?.data?.name || one.body?.error?.code, '| same as 025 PM sees:', one.body?.data?.name === project.name);
    const boq = await raw('GET', `/projects/${project.id}/boq`, { token });
    const boqItems = boq.body?.data?.items || boq.body?.data || [];
    console.log('[attack] GET /projects/<025 project>/boq ->', boq.status, Array.isArray(boqItems) ? `rows ${boqItems.length}` : Object.keys(boqItems || {}).slice(0, 6));
    const us = await raw('GET', '/users', { token });
    const people = us.body?.data?.items || [];
    leaked.users = people.length;
    console.log('[attack] GET /users (025 directory) ->', us.status, us.body?.error?.code || `count ${people.length}`, people.slice(0, 3).map((p) => p.email));
    const notes = await raw('GET', '/notifications', { token });
    const ns = notes.body?.data?.items || notes.body?.data || [];
    console.log('[notice] U\'s in-app notifications ->', notes.status, Array.isArray(ns) ? ns.map((n) => n.type || n.title) : ns);
  }

  // e-mail rewrite: is it real (the new address signs in, the old one does not), and does 025 simply see a new address?
  const newEmail = `l39.chk.moved.${stamp}@c024.octapm-cert.test`;
  const moved = await pm24.send('PATCH', `/users/${u.id}`, { email: newEmail });
  console.log('\n[attack] 024 PATCH email AFTER U left 024 ->', brief(moved));
  const oldLogin = await raw('POST', '/auth/login', { json: { email, password: SEIZED } });
  const newLogin = await raw('POST', '/auth/login', { json: { email: newEmail, password: SEIZED } });
  console.log('[attack] old address signs in ->', oldLogin.status, oldLogin.body?.error?.code || 'OK', '| new address signs in ->', newLogin.status);
  const seen25 = await pm25.send('GET', `/users/${u.id}`);
  console.log('[attack] what 025 now sees for its member ->', seen25.status, seen25.body?.data?.email, seen25.body?.data?.status);

  // tidy: 025 removes the throwaway from its workspace
  const tidy = await pm25.send('PATCH', `/users/${u.id}/deactivate`);
  console.log('\n[tidy] 025 deactivates the throwaway ->', tidy.status);

  const afterDeparture = reset.status === 200 && Boolean(token) && leaked.project === project.name;
  console.log('\nRESULT: home workspace reset the password after the person left it:', reset.status === 200, '| entered 025 and read its project:', Boolean(token) && leaked.project === project.name);
  process.exitCode = afterDeparture ? 2 : 0;
})().catch((e) => { console.error('ERROR', e.stack || e.message); process.exitCode = 1; });
