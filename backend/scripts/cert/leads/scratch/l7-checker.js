'use strict';
// Independent checker probes for L7. Scratch only.
const { as } = require('../../lib/api');
const { ATTACKER, VICTIM } = require('../_fib-constants');
const line = (s) => console.log(s);
const brief = (res) => `${res.status} ${JSON.stringify(res.body?.error ? { code: res.body.error.code, message: res.body.error.message } : '').slice(0, 200)}`;
const listOf = (d) => (Array.isArray(d) ? d : d?.rows || d?.items || d?.users || []);
const NOBODY = '11111111-1111-4111-8111-111111111111';

(async () => {
  const atk = as(ATTACKER.pm, ATTACKER.orgId);
  const vic = as(VICTIM.pm, VICTIM.orgId);

  // A. tenancy ground truth
  const meA = await atk.send('GET', '/auth/me');
  const meV = await vic.send('GET', '/auth/me');
  const ua = meA.body?.data?.user || meA.body?.data;
  const uv = meV.body?.data?.user || meV.body?.data;
  line(`A1 attacker me: id=${ua?.id} orgId=${ua?.orgId} role=${ua?.role}`);
  line(`A1 victim   me: id=${uv?.id} orgId=${uv?.orgId} role=${uv?.role}`);
  const aUsers = listOf((await atk.send('GET', '/users?limit=100')).body?.data);
  line(`A2 028 user directory size=${aUsers.length}; contains 042 PM id: ${aUsers.some((u) => u.id === VICTIM.pmUserId)}; contains 042 QS id: ${aUsers.some((u) => u.id === VICTIM.qsUserId)}; any @c042 email: ${aUsers.some((u) => /c042/.test(u.email || ''))}`);
  const direct = await atk.send('GET', `/users/${VICTIM.pmUserId}`);
  line(`A3 028 PM GET /users/<042 PM id> -> ${brief(direct)}`);
  const actDirect = await atk.send('GET', `/projects/${VICTIM.project}/activities/${VICTIM.activity}`);
  line(`A4 028 PM GET 042 activity directly -> ${brief(actDirect)}`);
  const actOwn = await atk.send('GET', `/projects/${ATTACKER.project}/activities/${VICTIM.activity}`);
  line(`A5 028 PM GET 042 activity under own project -> ${brief(actOwn)}`);

  // B. the product's own rule on the sibling record (RFI)
  const rfi = await atk.send('POST', `/projects/${ATTACKER.project}/rfi`, { subject: 'L7 checker control', question: 'control', managerUserId: VICTIM.pmUserId });
  line(`B  028 PM POST rfi {managerUserId: 042 PM} -> ${brief(rfi)} id=${rfi.body?.data?.id || ''}`);
  if (rfi.status === 201) await atk.send('DELETE', `/projects/${ATTACKER.project}/rfi/${rfi.body.data.id}`);

  // C. submittal with foreign people in the CREATE body + foreign activity on the submittal itself
  const created = await atk.send('POST', `/projects/${ATTACKER.project}/submittals`, {
    title: 'L7 checker probe', managerUserId: VICTIM.siteUserId, distributionUserIds: [VICTIM.qsUserId], activityId: VICTIM.activity,
  });
  line(`C1 028 PM POST submittal {manager: 042 site, distribution: [042 QS], activityId: 042 activity} -> ${brief(created)} id=${created.body?.data?.id || ''}`);
  let subId = created.body?.data?.id;
  if (created.status === 201) {
    const d = (await atk.send('GET', `/projects/${ATTACKER.project}/submittals/${subId}`)).body?.data;
    line(`C2 detail.manager=${JSON.stringify(d?.manager)} distribution=${JSON.stringify(d?.distribution)}`);
    line(`C2 detail.activityId=${d?.activityId} activity=${JSON.stringify(d?.activity)}`);
  } else {
    const plain = await atk.send('POST', `/projects/${ATTACKER.project}/submittals`, { title: 'L7 checker probe', managerUserId: VICTIM.siteUserId, distributionUserIds: [VICTIM.qsUserId] });
    line(`C1b same without activityId -> ${brief(plain)}`);
    subId = plain.body?.data?.id;
    if (subId) {
      const d = (await atk.send('GET', `/projects/${ATTACKER.project}/submittals/${subId}`)).body?.data;
      line(`C2b detail.manager=${JSON.stringify(d?.manager)} distribution=${JSON.stringify(d?.distribution)}`);
    }
  }

  // D. a UUID that is nobody
  if (subId) {
    const ghost = await atk.send('PUT', `/projects/${ATTACKER.project}/submittals/${subId}/people`, { managerUserId: NOBODY });
    line(`D1 PUT people {managerUserId: nobody} -> ${brief(ghost)}`);
    const ghost2 = await atk.send('PUT', `/projects/${ATTACKER.project}/submittals/${subId}/people`, { distributionUserIds: [NOBODY] });
    const d = ghost2.body?.data;
    line(`D2 PUT people {distribution: [nobody]} -> ${brief(ghost2)} distribution=${JSON.stringify(d?.distribution)} ids=${JSON.stringify(d?.distributionUserIds)}`);
  }

  // E. lower roles in 028
  for (const persona of ['site', 'quality', 'planner', 'qs', 'finance']) {
    const email = `${persona}@c028.octapm-cert.test`;
    try {
      const s = as(email, ATTACKER.orgId);
      const put = await s.send('PUT', `/projects/${ATTACKER.project}/submittals/${subId}/people`, { managerUserId: VICTIM.pmUserId });
      line(`E  ${email} PUT people {manager: 042 PM} -> ${brief(put)} manager=${JSON.stringify(put.body?.data?.manager)}`);
    } catch (e) {
      line(`E  ${email}: ${e.message}`);
    }
  }

  // F. package: PATCH and list
  const pkg = await atk.send('POST', `/projects/${ATTACKER.project}/submittals/packages`, { name: 'L7 checker package' });
  line(`F1 POST package (clean) -> ${brief(pkg)} id=${pkg.body?.data?.id}`);
  if (pkg.status === 201) {
    const pid = pkg.body.data.id;
    const patch = await atk.send('PATCH', `/projects/${ATTACKER.project}/submittals/packages/${pid}`, { managerUserId: VICTIM.siteUserId, activityId: VICTIM.activity });
    line(`F2 PATCH package {manager: 042 site, activity: 042} -> ${brief(patch)} manager=${JSON.stringify(patch.body?.data?.manager)} activity=${JSON.stringify(patch.body?.data?.activity)}`);
    const ghost = await atk.send('PATCH', `/projects/${ATTACKER.project}/submittals/packages/${pid}`, { activityId: NOBODY });
    line(`F3 PATCH package {activityId: nothing} -> ${brief(ghost)}`);
    const list = await atk.send('GET', `/projects/${ATTACKER.project}/submittals/packages`);
    const hit = listOf(list.body?.data).filter((p) => /c042/.test(p.manager?.email || '') || p.activity?.id === VICTIM.activity);
    line(`F4 package LIST rows carrying 042 data: ${hit.length} e.g. ${JSON.stringify(hit[0] && { ref: hit[0].ref, manager: hit[0].manager, activity: hit[0].activity })}`);
    // tidy: clear the foreign references on every probe package of this lead
    for (const p of listOf(list.body?.data).filter((row) => /^L7 /.test(row.name))) {
      const clear = await atk.send('PATCH', `/projects/${ATTACKER.project}/submittals/packages/${p.id}`, { managerUserId: null, activityId: null });
      line(`   tidy ${p.ref} "${p.name}" -> ${clear.status}`);
    }
  }

  // G. victim side: nothing of 028 shows up to the 042 PM
  const vn = await vic.send('GET', '/notifications?limit=50');
  const vnRows = listOf(vn.body?.data);
  line(`G  042 PM notifications mentioning L7: ${vnRows.filter((n) => /L7/.test(`${n.title} ${n.message}`)).length} of ${vnRows.length}`);

  if (subId) {
    const del = await atk.send('DELETE', `/projects/${ATTACKER.project}/submittals/${subId}`);
    line(`tidy submittal -> ${del.status}`);
  }
})().catch((e) => { console.error('ERROR', e.stack || e.message); process.exitCode = 1; });
