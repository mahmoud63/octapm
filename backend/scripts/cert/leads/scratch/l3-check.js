'use strict';
// Independent checker probes for L3 (scratch; not the lead's reproduction script).
const crypto = require('crypto');
const { as } = require('../../lib/api');

const mail = (who, code) => `${who}@c${code}.octapm-cert.test`;
const listOf = (d) => (Array.isArray(d) ? d : d?.items || d?.users || d?.rows || []);
const brief = (res) => `${res.status}${res.body?.error ? ` ${res.body.error.code}: ${res.body.error.message}` : ''}`;

(async () => {
  const pm030 = as(mail('pm', '030'));
  const pm040 = as(mail('pm', '040'));
  const users040 = listOf((await pm040.send('GET', '/users?limit=500')).body?.data);
  const users030 = listOf((await pm030.send('GET', '/users?limit=500')).body?.data);
  const victim = users040.find((u) => u.email === mail('finance', '040'));
  console.log(`victim ${victim.id} ${victim.email}; in 030's /users: ${users030.some((u) => u.id === victim.id)}; 030 users listed: ${users030.length}, 040 users listed: ${users040.length}`);
  console.log(`030 user list mentions any @c040 address: ${users030.some((u) => /@c040\./.test(u.email))}`);

  // 1. Can 030 read the victim through the user directory? (the baseline the forms path bypasses)
  const direct = await pm030.send('GET', `/users/${victim.id}`);
  console.log(`1. pm@c030 GET /users/<victim> -> ${brief(direct)}; names victim: ${String(direct.text).includes(victim.email)}`);

  const projects = listOf((await pm030.send('GET', '/projects')).body?.data);
  const project = projects.find((p) => p.name === 'Metro Depot') || projects[0];
  const templates = listOf((await pm030.send('GET', `/projects/${project.id}/forms/templates`)).body?.data);
  const template = templates.find((t) => t.status === 'active' && t.type === 'inspection') || templates.find((t) => t.status === 'active');
  const created = [];

  // 2. A UUID that is nobody: what does the endpoint say? (existence oracle)
  const nobody = crypto.randomUUID();
  const ghost = await pm030.send('POST', `/projects/${project.id}/forms`, { templateId: template.id, title: 'L3chk nobody', assigneeUserId: nobody });
  console.log(`2. POST forms assigneeUserId=<random uuid ${nobody}> -> ${brief(ghost)}`);
  if (ghost.status === 201) created.push(ghost.body.data.id);

  // 3. The foreign user: accepted and named?
  const sent = { templateId: template.id, title: 'L3chk foreign', assigneeUserId: victim.id };
  const foreign = await pm030.send('POST', `/projects/${project.id}/forms`, sent);
  console.log(`3. POST forms assigneeUserId=<victim> -> ${brief(foreign)}; assigneeUser=${JSON.stringify(foreign.body?.data?.assigneeUser)}`);
  const sentBody = JSON.stringify(sent);
  console.log(`   victim's name/email present in what was SENT: ${sentBody.includes(victim.name) || sentBody.includes(victim.email)}`);
  const formId = foreign.body?.data?.id;
  if (foreign.status === 201) created.push(formId);

  // 4. The sibling module's rule: punch list refuses the same foreign user.
  const punch = await pm030.send('POST', `/projects/${project.id}/punch`, { title: 'L3chk punch foreign', assigneeUserId: victim.id });
  console.log(`4. POST punch assigneeUserId=<victim> -> ${brief(punch)}`);
  if (punch.status === 201) {
    const del = await pm030.send('DELETE', `/projects/${project.id}/punch/${punch.body.data.id}`);
    console.log(`   (cleanup punch) ${del.status}`);
  }

  // 5. The victim's side: can the victim (in company 040) see or act on 030's inspection, and did anything reach them?
  if (formId) {
    const v = as(victim.email);
    const seen = await v.send('GET', `/projects/${project.id}/forms/${formId}`);
    console.log(`5a. victim GET 030's inspection -> ${brief(seen)}`);
    const inbox = await v.send('GET', '/notifications?limit=50');
    const hits = listOf(inbox.body?.data).filter((n) => JSON.stringify(n).includes('L3chk') || n.entityId === formId);
    console.log(`5b. victim inbox -> ${inbox.status}; notifications about it: ${hits.length}`);
    const v040 = await pm040.send('GET', `/users/${victim.id}`);
    console.log(`5c. pm@c040 GET /users/<victim> -> ${v040.status}; mentions 'L3chk': ${String(v040.text).includes('L3chk')}`);
  }

  // 6. Who in 030 can do this? Try each standard role once (create only; cleaned up).
  for (const who of ['owner', 'planner', 'qs', 'cost', 'procurement', 'warehouse', 'site', 'quality', 'finance']) {
    const res = await as(mail(who, '030')).send('POST', `/projects/${project.id}/forms`, { templateId: template.id, title: `L3chk role ${who}`, assigneeUserId: victim.id });
    console.log(`6. ${who}@c030 POST forms assigneeUserId=<victim> -> ${brief(res)}${res.status === 201 ? `; email in answer: ${String(res.text).includes(victim.email)}` : ''}`);
    if (res.status === 201) created.push(res.body.data.id);
  }

  for (const id of created) {
    const gone = await pm030.send('DELETE', `/projects/${project.id}/forms/${id}`);
    if (gone.status >= 300) console.log(`(cleanup) DELETE forms/${id} -> ${gone.status}`);
  }
  console.log(`(cleanup) removed ${created.length} inspection(s)`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
