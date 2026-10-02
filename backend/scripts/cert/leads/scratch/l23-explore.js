'use strict';
// Scratch (independent checker, L23): read-only look at 031-01 and 041-01.
const fs = require('fs');
const { as } = require('../../lib/api');
const { buildPopulation } = require('../../lib/spec');
const listOf = (d) => (Array.isArray(d) ? d : d?.items || d?.rows || d?.records || []);
const inv = (code) => JSON.parse(fs.readFileSync(`C:/Temp/octapm-cert/state/inventory/${code}.json`, 'utf8'));
(async () => {
  for (const [code, key] of [['031', '031-01'], ['041', '041-01']]) {
    const i = inv(code);
    const proj = i.projects[key];
    console.log(`\n== ${key} id=${proj.id} inventory keys: ${Object.keys(proj).join(', ')}`);
    const P = `/projects/${proj.id}`;
    const pm = as(`pm@c${code}.octapm-cert.test`);
    const parties = listOf((await pm.send('GET', `${P}/parties?status=active`)).body?.data);
    for (const p of parties) console.log(`  party ${p.id} ${p.role} "${p.company?.name}" members=${(p.members || []).filter((m) => m.status === 'active').map((m) => m.user?.email || m.email || m.userId).join(',')}`);
    const team = listOf((await pm.send('GET', `${P}/team`)).body?.data);
    console.log(`  team: ${team.length}; party-sourced: ${team.filter((t) => t.source === 'party').map((t) => `${t.email}(${t.party?.role})`).join(', ') || 'none'}`);
    const teamEmails = new Set(team.map((t) => t.email));
    const people = buildPopulation().companies.find((c) => c.code === code).people;
    const off = people.filter((p) => !teamEmails.has(p.email));
    console.log(`  company people: ${people.length}; not on the project team: ${off.length} e.g. ${off.slice(0, 6).map((p) => `${p.email}[${p.role || p.orgRole || ''}]`).join(', ')}`);
    for (const t of ['rfi', 'submittal', 'drawing', 'transmittal', 'correspondence']) {
      const reg = (await pm.send('GET', `${P}/doc-control/register?recordType=${t}`)).body?.data;
      const rows = listOf(reg);
      const revs = rows.reduce((n, r) => n + (r.revisions || []).length, 0);
      const routed = rows.filter((r) => r.owner || r.reviewer || r.approver).length;
      console.log(`  PM register ${t}: ${rows.length} rows, ${revs} revisions, ${routed} with a party named`);
    }
  }
})().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
