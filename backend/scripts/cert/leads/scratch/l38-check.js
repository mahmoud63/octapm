'use strict';
/**
 * L38 — independent check. Boundaries of the "direct add" of an identity that
 * lives in another company: what the adding company gets, what it can do next,
 * what the person sees, and what the person can do about it.
 * Scratch only: creates one throwaway identity in 025 and seats it in 024.
 */
const fs = require('fs');
const { as, raw, forget } = require('../../lib/api');

const PASSWORD = process.env.CERT_PASSWORD; // never printed
const stamp = Date.now();
const email = `l38.check.${stamp}@c025.octapm-cert.test`;
const REAL = { name: 'Check Victim L38', phone: '+1-555-3838' };
const line = (label, res) => console.log(`${label}\n    -> ${res.status} ${JSON.stringify(res.body?.data ?? res.body?.error ?? res.body).slice(0, 600)}`);
const loginShape = async () => {
  const res = await raw('POST', '/auth/login', { json: { email, password: PASSWORD } });
  const d = res.body?.data || {};
  return {
    status: res.status,
    directSession: Boolean(d.tokens?.accessToken),
    chooseWorkspace: Boolean(d.chooseWorkspace),
    memberships: (d.memberships || []).map((m) => ({ orgId: m.orgId, name: m.orgName || m.name, role: m.role, status: m.status })),
    identityToken: d.identityToken || null,
    accessToken: d.tokens?.accessToken || null,
  };
};
const safe = (shape) => ({ ...shape, identityToken: shape.identityToken ? '(present)' : null, accessToken: shape.accessToken ? '(present)' : null });

(async () => {
  const pm24 = as('pm@c024.octapm-cert.test');
  const pm25 = as('pm@c025.octapm-cert.test');
  const org24 = (await pm24.GET('/auth/me')).active.orgId;
  const org25 = (await pm25.GET('/auth/me')).active.orgId;
  console.log('024 =', org24, ' 025 =', org25);

  // A. the oracle: a miss
  const miss = await pm24.send('POST', '/users', { name: 'x', email: `nobody.${stamp}@nowhere.octapm-cert.test`, role: 'site_engineer' });
  line('[A] 024 POST /users, unknown e-mail, no password (a miss)', miss);

  // setup: the identity is born in 025, placed on a 025 project, signs in
  const created = await pm25.POST('/users', { name: REAL.name, email, phone: REAL.phone, password: PASSWORD, role: 'qs' });
  const victimId = created.id;
  console.log('[setup] identity created in 025:', victimId);
  const projects = JSON.parse(fs.readFileSync('C:/Temp/octapm-cert/state/projects.json', 'utf8'))['025'] || {};
  const project25 = Object.values(projects)[0];
  if (project25) {
    const put = await pm25.send('POST', `/projects/${project25.id}/team`, { userId: victimId });
    line(`[setup] 025 puts the identity on its project "${project25.name}"`, put);
  }
  const before = await loginShape();
  console.log('[C] the identity signs in BEFORE the add:', JSON.stringify(safe(before)));

  // B. the oracle: a hit, and what comes back
  const hit = await pm24.send('POST', '/users', { name: 'Not The Name', email, phone: '+0-000', role: 'site_engineer' });
  line('[B] 024 POST /users, the 025 e-mail, no password (a hit)', hit);
  const got = hit.body?.data || {};
  const again = await pm24.send('POST', '/users', { name: 'x', email, role: 'site_engineer' });
  line('[B] the same again', again);

  // C. what the person now sees
  const after = await loginShape();
  console.log('[C] the identity signs in AFTER the add :', JSON.stringify(safe(after)));

  // D. what 024 can do to the identity next
  const rename = await pm24.send('PATCH', `/users/${victimId}`, { name: 'Renamed By 024', phone: '+9-999' });
  line('[D] 024 PATCH /users/:id name+phone', rename);
  const reset = await pm24.send('POST', `/users/${victimId}/reset-password`, { newPassword: 'attacker-chosen-1' });
  line('[D] 024 POST /users/:id/reset-password', reset);
  const mail = await pm24.send('PATCH', `/users/${victimId}`, { email: `taken.${stamp}@c024.octapm-cert.test` });
  line('[D] 024 PATCH /users/:id email', mail);

  // G. lastLogin is a live feed
  const seen1 = await pm24.send('GET', `/users/${victimId}`);
  await new Promise((r) => setTimeout(r, 1200));
  await loginShape(); // the person signs in again
  const seen2 = await pm24.send('GET', `/users/${victimId}`);
  console.log('[G] 024 GET /users/:id lastLogin before/after the person signs in again:', seen1.body?.data?.lastLogin, '->', seen2.body?.data?.lastLogin);
  console.log('[F] projectCount shown to 024 (the person is on 0 projects of 024):', seen2.body?.data?.projectCount, '| in the 201:', got.projectCount);

  // H. was the person told?
  forget(email);
  const victim25 = as(email, org25);
  const notes = await victim25.send('GET', '/notifications');
  const items = notes.body?.data?.items || notes.body?.data || [];
  console.log("[H] the person's notifications in 025:", notes.status, Array.isArray(items) ? `${items.length} item(s)` : JSON.stringify(items).slice(0, 200));
  const victim24 = as(email, org24);
  const me24 = await victim24.send('GET', '/auth/me');
  console.log('[H] the person can open a session in 024:', me24.status, JSON.stringify(me24.body?.data?.active));
  const notes24 = await victim24.send('GET', '/notifications');
  const items24 = notes24.body?.data?.items || notes24.body?.data || [];
  console.log("[H] the person's notifications in 024:", notes24.status, Array.isArray(items24) ? `${items24.length} item(s)` : JSON.stringify(items24).slice(0, 200));

  // I. can the person get out?
  const selfOff = await victim24.send('PATCH', `/users/${victimId}/deactivate`);
  line('[I] the person, in 024, PATCH /users/<self>/deactivate', selfOff);
  for (const [method, route] of [['POST', `/organisations/${org24}/leave`], ['DELETE', `/auth/workspaces/${org24}`], ['POST', `/auth/workspaces/${org24}/leave`], ['DELETE', `/auth/me/memberships/${org24}`]]) {
    const res = await victim24.send(method, route);
    console.log(`[I] the person ${method} ${route} -> ${res.status} ${res.body?.error?.code ?? ''}`);
  }
  const home = await pm25.send('GET', `/users/${victimId}`);
  console.log('[I] 025 GET /users/:id (home view) role/status:', home.body?.data?.role, home.body?.data?.status);

  // E. 024 suspends: does the trace go, can the probe be repeated?
  const off = await pm24.send('PATCH', `/users/${victimId}/deactivate`);
  line('[E] 024 PATCH /users/:id/deactivate', off);
  const final = await loginShape();
  console.log('[E] the identity signs in after 024 suspended it:', JSON.stringify(safe(final)));
  const home2 = await pm25.send('GET', `/users/${victimId}`);
  console.log('[E] 025 still sees the person as', home2.body?.data?.status, '(the identity was not closed by 024)');
  const third = await pm24.send('POST', '/users', { name: 'x', email, role: 'site_engineer' });
  line('[E] 024 POST /users again after suspending', third);

  console.log('\n--- summary ---');
  console.log('  miss -> hit statuses                :', miss.status, miss.body?.error?.code, '->', hit.status);
  console.log("  201 returned 025's name and phone   :", got.name === REAL.name && got.phone === REAL.phone, '(sent "Not The Name" / "+0-000")');
  console.log('  membership active with no step by the person:', got.status === 'active' && after.memberships.some((m) => m.orgId === org24));
  console.log('  login changed from a session to a choice:', before.directSession, '->', after.chooseWorkspace);
  console.log('  024 may rewrite name+phone / e-mail / password (statuses):', rename.status, mail.status, reset.status);
})().catch((e) => { console.error('ERROR', e.stack || e.message); process.exitCode = 1; });
