'use strict';
// Independent check of L4 (scratch). Restores the contract's client on exit.
const crypto = require('crypto');
const { as } = require('../../lib/api');

const mail = (who, code) => `${who}@c${code}.octapm-cert.test`;
const listOf = (d) => (Array.isArray(d) ? d : d?.items || d?.rows || d?.data || []);
const short = (v, n = 400) => JSON.stringify(v)?.slice(0, n);

const allCompanies = async (session) => {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 50; i += 1) {
    const res = await session.send('GET', `/companies?limit=100${cursor ? `&cursor=${cursor}` : ''}`);
    const data = res.body?.data;
    const items = listOf(data);
    out.push(...items);
    cursor = data?.nextCursor || data?.pagination?.nextCursor || res.body?.meta?.nextCursor || null;
    if (!cursor || !items.length) break;
  }
  return out;
};

const main = async () => {
  const a = as(mail('pm', '030'));
  const v = as(mail('pm', '040'));
  const meA = await a.send('GET', '/auth/me');
  const meV = await v.send('GET', '/auth/me');
  const orgOf = (me) => me.body?.data?.orgId || me.body?.data?.user?.orgId || me.body?.data?.organisation?.id || me.body?.data?.org?.id;
  const orgA = orgOf(meA);
  const orgV = orgOf(meV);
  console.log(`A. org of pm@c030: ${orgA}; org of pm@c040: ${orgV}; different: ${Boolean(orgA && orgV && orgA !== orgV)}`);
  if (!orgA) console.log('   me(030):', meA.status, short(meA.body?.data, 300));

  const compA = await allCompanies(a);
  const compV = await allCompanies(v);
  const foreign = compV.find((c) => /Property Group/.test(c.name)) || compV[0];
  console.log(`B. 030 directory size ${compA.length}; 040 directory size ${compV.length}`);
  console.log(`   foreign company: ${foreign.id} "${foreign.name}" orgId on record: ${foreign.orgId ?? '(not served)'}`);
  console.log(`   id in 030's full directory: ${compA.some((c) => c.id === foreign.id)}; name in 030's directory: ${compA.some((c) => c.name === foreign.name)}`);
  const search = await a.send('GET', `/companies?search=${encodeURIComponent('CANARY-040')}`);
  console.log(`   030 GET /companies?search=CANARY-040 -> ${search.status}, ${listOf(search.body?.data).length} rows`);
  const direct = await a.send('PATCH', `/companies/${foreign.id}`, {});
  console.log(`   030 PATCH /companies/${foreign.id} {} -> ${direct.status} ${direct.body?.error?.code ?? ''} (direct access to the foreign record)`);
  const vendorPerf = await a.send('GET', `/company/vendors/${foreign.id}/performance`);
  console.log(`   030 GET /company/vendors/<foreign>/performance -> ${vendorPerf.status} ${vendorPerf.body?.error?.code ?? ''}`);

  const projects = listOf((await a.send('GET', '/projects')).body?.data);
  const project = projects.find((p) => p.name === 'Metro Depot') || projects[0];
  const route = `/projects/${project.id}/prime-contract`;
  const before = await a.send('GET', route);
  const original = before.body?.data?.clientCompanyId ?? null;
  console.log(`C. project ${project.id} "${project.name}"; before clientCompanyId=${original} client=${JSON.stringify(before.body?.data?.client)}`);
  const victimBefore = JSON.stringify(compV.find((c) => c.id === foreign.id));

  try {
    const patch = await a.send('PATCH', route, { clientCompanyId: foreign.id });
    console.log(`   PATCH {clientCompanyId: foreign} -> ${patch.status}; clientCompanyId=${patch.body?.data?.clientCompanyId} client=${JSON.stringify(patch.body?.data?.client)}`);
    const get = await a.send('GET', route);
    console.log(`   GET prime-contract -> ${get.status}; client=${JSON.stringify(get.body?.data?.client)}`);
    const st = await a.send('GET', `${route}/statement`);
    console.log(`   GET statement -> ${st.status}; contract.clientCompanyId=${st.body?.data?.contract?.clientCompanyId} contract.client=${JSON.stringify(st.body?.data?.contract?.client)}`);

    for (const who of ['owner', 'planner', 'qs', 'cost', 'procurement', 'warehouse', 'site', 'quality', 'finance']) {
      try {
        const r = await as(mail(who, '030')).send('GET', route);
        console.log(`   read as ${who}@c030 -> ${r.status} client=${JSON.stringify(r.body?.data?.client ?? null)} ${r.body?.error?.code ?? ''}`);
      } catch (e) {
        console.log(`   read as ${who}@c030 -> (failed: ${e.message.slice(0, 100)})`);
      }
    }

    const compV2 = await allCompanies(v);
    const victimAfter = JSON.stringify(compV2.find((c) => c.id === foreign.id));
    console.log(`D. 040's own record unchanged by the pointer: ${victimBefore === victimAfter}`);
    const cross = await v.send('GET', route);
    console.log(`   040 GET 030's prime-contract -> ${cross.status} ${cross.body?.error?.code ?? ''}`);
  } finally {
    const restore = await a.send('PATCH', route, { clientCompanyId: original });
    console.log(`   (cleanup) restore -> ${restore.status}; clientCompanyId=${restore.body?.data?.clientCompanyId ?? null}`);
  }

  console.log('E. which 030 roles are admitted to the write');
  for (const who of ['owner', 'planner', 'qs', 'cost', 'procurement', 'warehouse', 'site', 'quality', 'finance']) {
    try {
      const s = as(mail(who, '030'));
      const r = await s.send('PATCH', route, { clientCompanyId: foreign.id });
      console.log(`   PATCH as ${who}@c030 -> ${r.status} ${r.body?.error?.code ?? ''} client=${JSON.stringify(r.body?.data?.client ?? null)}`);
      if (r.status < 300) await a.send('PATCH', route, { clientCompanyId: original });
    } catch (e) {
      console.log(`   PATCH as ${who}@c030 -> (failed: ${e.message.slice(0, 100)})`);
    }
  }

  const random = crypto.randomUUID();
  const ghost = await a.send('PATCH', route, { clientCompanyId: random });
  console.log(`F. PATCH {clientCompanyId: <random uuid ${random}>} -> ${ghost.status} ${ghost.body?.error?.code ?? ''}: ${ghost.body?.error?.message ?? ''}`);
  if (ghost.status < 300) await a.send('PATCH', route, { clientCompanyId: original });

  const after = await a.send('GET', route);
  console.log(`G. final state: clientCompanyId=${after.body?.data?.clientCompanyId ?? null} (original ${original})`);
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
