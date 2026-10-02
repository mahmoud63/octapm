'use strict';
// Independent check of L6 (scratch). Different victim identities from the claimant's script.
const { as } = require('../../lib/api');
const mail = (who, code) => `${who}@c${code}.octapm-cert.test`;
const listOf = (d) => (Array.isArray(d) ? d : d?.items || d?.rows || d?.data || []);
const j = (v) => JSON.stringify(v);
const crypto = require('crypto');

(async () => {
  const pm30 = as(mail('pm', '030'));
  const pm40 = as(mail('pm', '040'));
  const users40 = listOf((await pm40.send('GET', '/users')).body?.data);
  const users30 = listOf((await pm30.send('GET', '/users')).body?.data);
  const comps40 = listOf((await pm40.send('GET', '/companies')).body?.data);
  const comps30 = listOf((await pm30.send('GET', '/companies')).body?.data);
  console.log(`users: 030 has ${users30.length}, 040 has ${users40.length}; companies: 030 has ${comps30.length}, 040 has ${comps40.length}`);
  const victim = users40.find((u) => u.email === mail('site', '040')) || users40[1];
  const vcomp = comps40.find((c) => !/Consulting Engineers/.test(c.name)) || comps40[0];
  console.log(`victim user ${victim.id} ${victim.name} <${victim.email}>  in 030 users? ${users30.some((u) => u.id === victim.id || u.email === victim.email)}`);
  console.log(`victim company ${vcomp.id} "${vcomp.name}"  in 030 companies? ${comps30.some((c) => c.id === vcomp.id)}`);
  console.log(`030 has any user/company with that name? user:${users30.some((u) => u.name === victim.name)} company:${comps30.some((c) => c.name === vcomp.name)}`);

  const projects = listOf((await pm30.send('GET', '/projects')).body?.data);
  const project = projects.find((p) => p.name === 'Metro Depot') || projects[0];
  const team = await pm30.send('GET', `/projects/${project.id}/team`);
  console.log(`030 project ${project.id}; team response ${team.status}; mentions victim id? ${team.text.includes(victim.id)}; mentions victim company id? ${team.text.includes(vcomp.id)}`);

  // Does the victim have any access to the 030 project?
  const v = as(victim.email);
  const vr = await v.send('GET', `/projects/${project.id}/risks`);
  console.log(`victim GET 030 project risks -> ${vr.status} ${vr.body?.error?.code ?? ''}`);

  const created = [];
  // 1. the attack with a different victim
  const r1 = await pm30.send('POST', `/projects/${project.id}/risks`, { description: 'L6-check foreign', ownerUserId: victim.id, assigneeCompanyId: vcomp.id });
  console.log(`\n[1] POST risk foreign owner+company -> ${r1.status} ownerUser=${j(r1.body?.data?.ownerUser)} assigneeCompany=${j(r1.body?.data?.assigneeCompany)} owner(text)=${j(r1.body?.data?.owner)}`);
  if (r1.body?.data?.id) created.push(r1.body.data.id);

  // 2. non-existent uuid
  const ghost = crypto.randomUUID();
  const r2 = await pm30.send('POST', `/projects/${project.id}/risks`, { description: 'L6-check ghost', ownerUserId: ghost });
  console.log(`[2] POST risk with a non-existent user id -> ${r2.status} ${j(r2.body?.error ?? r2.body?.data?.ownerUser)}`);
  if (r2.body?.data?.id) created.push(r2.body.data.id);
  const r2b = await pm30.send('POST', `/projects/${project.id}/risks`, { description: 'L6-check ghost co', assigneeCompanyId: ghost });
  console.log(`[2b] POST risk with a non-existent company id -> ${r2b.status} ${j(r2b.body?.error ?? r2b.body?.data?.assigneeCompany)}`);
  if (r2b.body?.data?.id) created.push(r2b.body.data.id);

  // 3. sibling record (NCR) with the same foreign user: the documented rule on the live API
  const r3 = await pm30.send('POST', `/projects/${project.id}/ncr`, { description: 'L6-check sibling', severity: 'minor', ownerUserId: victim.id });
  console.log(`[3] POST ncr with the same foreign owner -> ${r3.status} ${j(r3.body?.error ?? { ownerUser: r3.body?.data?.ownerUser })}`);
  if (r3.status < 300 && r3.body?.data?.id) await pm30.send('DELETE', `/projects/${project.id}/ncr/${r3.body.data.id}`);
  const r3b = await pm30.send('POST', `/projects/${project.id}/ncr`, { description: 'L6-check sibling co', severity: 'minor', assigneeCompanyId: vcomp.id });
  console.log(`[3b] POST ncr with the same foreign company -> ${r3b.status} ${j(r3b.body?.error ?? { assigneeCompany: r3b.body?.data?.assigneeCompany })}`);
  if (r3b.status < 300 && r3b.body?.data?.id) await pm30.send('DELETE', `/projects/${project.id}/ncr/${r3b.body.data.id}`);

  // 4. which roles of 030 can do it
  for (const who of ['owner', 'planner', 'qs', 'cost', 'procurement', 'warehouse', 'site', 'quality', 'finance']) {
    if (!users30.some((u) => u.email === mail(who, '030'))) { console.log(`[4] ${who}@c030 does not exist`); continue; }
    let r;
    try { r = await as(mail(who, '030')).send('POST', `/projects/${project.id}/risks`, { description: `L6-check role ${who}`, ownerUserId: victim.id }); }
    catch (e) { console.log(`[4] ${who}: ${e.message}`); continue; }
    console.log(`[4] ${who}@c030 POST risk foreign owner -> ${r.status} ${r.body?.error?.code ?? j(r.body?.data?.ownerUser)}`);
    if (r.body?.data?.id) created.push(r.body.data.id);
  }

  // 5. reverse direction: does the victim see anything of 030's risk?
  const vProjects = listOf((await v.send('GET', '/projects')).body?.data);
  console.log(`\n[5] victim sees ${vProjects.length} project(s); any of 030's? ${vProjects.some((p) => p.id === project.id)}`);
  for (const route of ['/workspace/dashboard', '/dashboard/workspace', '/notifications?limit=50', ...(vProjects[0] ? [`/projects/${vProjects[0].id}/assignments/mine`] : [])]) {
    const r = await v.send('GET', route);
    console.log(`[5] victim GET ${route} -> ${r.status}; mentions "L6-check"? ${r.text?.includes('L6-check')}`);
  }
  // 030's list re-serves the foreign details
  const list = await pm30.send('GET', `/projects/${project.id}/risks`);
  const row = listOf(list.body?.data).find((x) => x.id === created[0]);
  console.log(`[6] 030 list re-serves: ownerUser=${j(row?.ownerUser)} assigneeCompany=${j(row?.assigneeCompany)}`);

  for (const id of created) {
    const d = await pm30.send('DELETE', `/projects/${project.id}/risks/${id}`);
    if (d.status >= 300) console.log(`cleanup ${id} -> ${d.status} ${d.body?.error?.code}`);
  }
  console.log(`cleanup: removed ${created.length} risk(s)`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
