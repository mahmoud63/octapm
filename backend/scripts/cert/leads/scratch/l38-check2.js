'use strict';
/**
 * L38 — independent check, part 2.
 *  1. Is the e-mail oracle new, or does the product already answer "this
 *     e-mail has an account" to anybody (POST /auth/register, unauthenticated)?
 *  2. Add, then suspend at once: does the person see anything, and does 024
 *     keep reading the profile (phone, lastLogin) of a person it suspended?
 *  3. Who in 024 may do it (a non-PM role is refused)?
 */
const { as, raw, forget } = require('../../lib/api');

const PASSWORD = process.env.CERT_PASSWORD; // never printed
const stamp = Date.now();
const email = `l38.quiet.${stamp}@c025.octapm-cert.test`;
const short = (res) => `${res.status} ${JSON.stringify(res.body?.data ?? res.body?.error ?? res.body).slice(0, 500)}`;

(async () => {
  const pm24 = as('pm@c024.octapm-cert.test');
  const pm25 = as('pm@c025.octapm-cert.test');
  const org24 = (await pm24.GET('/auth/me')).active.orgId;
  const org25 = (await pm25.GET('/auth/me')).active.orgId;

  const created = await pm25.POST('/users', { name: 'Quiet Victim L38', email, phone: '+1-555-0001', password: PASSWORD, role: 'qs' });
  const id = created.id;
  console.log('[setup] identity in 025:', id);

  // 1. the unauthenticated oracle that already exists (a hit only: a miss would create a company)
  const reg = await raw('POST', '/auth/register', { json: { orgName: 'L38 Probe', name: 'Probe', email, password: PASSWORD } });
  console.log('[1] anonymous POST /auth/register with the 025 e-mail ->', reg.status, reg.body?.error?.code, '-', reg.body?.error?.message);

  // 3. a non-PM role in 024
  const planner = await as('planner@c024.octapm-cert.test').send('POST', '/users', { name: 'x', email, role: 'site_engineer' });
  console.log('[3] planner@c024 POST /users ->', planner.status, planner.body?.error?.code);

  // 2. add and suspend at once
  const add = await pm24.send('POST', '/users', { name: 'x', email, role: 'site_engineer' });
  console.log('[2] 024 adds ->', short(add));
  const off = await pm24.send('PATCH', `/users/${id}/deactivate`);
  console.log('[2] 024 suspends at once ->', off.status, 'status:', off.body?.data?.status);

  const login = await raw('POST', '/auth/login', { json: { email, password: PASSWORD } });
  const d = login.body?.data || {};
  console.log('[2] the person signs in: direct session =', Boolean(d.tokens?.accessToken), '| chooseWorkspace =', Boolean(d.chooseWorkspace));
  forget(email);
  const me = await as(email, org25).send('GET', '/auth/me');
  console.log('[2] the person GET /auth/me memberships:', JSON.stringify((me.body?.data?.memberships || []).map((m) => ({ org: m.orgName || m.name || m.orgId, role: m.role, status: m.status }))));

  const home = await pm25.send('PATCH', `/users/${id}`, { phone: '+1-555-0002' });
  console.log('[2] 025 (home) changes the phone ->', home.status, home.body?.data?.phone);
  const one = await pm24.send('GET', `/users/${id}`);
  console.log('[2] 024 GET /users/:id of the suspended person ->', short(one));
  const list = await pm24.send('GET', `/users?search=${encodeURIComponent(email)}`);
  const row = (list.body?.data?.items || []).find((u) => u.id === id);
  console.log('[2] 024 GET /users?search= lists:', JSON.stringify(row));
  const back = await pm24.send('PATCH', `/users/${id}/activate`);
  console.log('[2] 024 re-activates whenever it likes ->', back.status, 'status:', back.body?.data?.status);
  const login2 = await raw('POST', '/auth/login', { json: { email, password: PASSWORD } });
  console.log('[2] the person signs in again: chooseWorkspace =', Boolean(login2.body?.data?.chooseWorkspace));
  // leave it suspended
  await pm24.send('PATCH', `/users/${id}/deactivate`);
})().catch((e) => { console.error('ERROR', e.stack || e.message); process.exitCode = 1; });
