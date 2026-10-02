'use strict';
// Scratch: what company 031, project 031-01 offers for a second, independent run of FILES-X1.
const fs = require('fs');
const { as } = require('../../lib/api');
const { buildPopulation } = require('../../lib/spec');

const listOf = (data) => (Array.isArray(data) ? data : data?.items || data?.rows || []);

(async () => {
  const inv = JSON.parse(fs.readFileSync('C:/Temp/octapm-cert/state/inventory/031.json', 'utf8'));
  console.log('projects:', Object.entries(inv.projects || {}).map(([k, v]) => `${k}=${v.id}`).join(' '));
  const pid = inv.projects['031-01'].id;
  const P = `/projects/${pid}`;
  const pm = as('pm@c031.octapm-cert.test');
  const parties = listOf(await pm.GET(`${P}/parties?status=active`));
  for (const p of parties) console.log(`party ${p.id} ${p.role} "${p.company?.name}" members: ${(p.members || []).map((m) => `${m.userId}:${m.status}`).join(', ') || 'none'}`);
  const team = listOf(await pm.GET(`${P}/team`));
  console.log(`team: ${team.length}; by source: ${JSON.stringify(team.reduce((acc, m) => ({ ...acc, [m.source]: (acc[m.source] || 0) + 1 }), {}))}`);
  for (const m of team.filter((row) => row.source === 'party')) console.log(`  party-only member: ${m.email} party=${m.party?.role}`);
  const people = buildPopulation().companies.find((c) => c.code === '031').people;
  const onTeam = new Set(team.map((m) => m.email));
  console.log(`company people: ${people.length}; not on the project team: ${people.filter((p) => !onTeam.has(p.email)).map((p) => `${p.email}(${p.role || p.orgRole || ''})`).slice(0, 12).join(', ')}`);
  const rfis = listOf((await pm.send('GET', `${P}/rfi?limit=100`)).body?.data);
  console.log(`RFIs: ${rfis.length}`);
  for (const r of rfis) console.log(`  ${r.ref} ${r.status} owner=${r.ownerPartyId} reviewer=${r.reviewerPartyId} approver=${r.approverPartyId} "${String(r.subject).slice(0, 60)}"`);
  const subs = listOf((await pm.send('GET', `${P}/submittals?limit=100`)).body?.data);
  console.log(`submittals: ${subs.length}`);
  for (const r of subs) console.log(`  ${r.ref} ${r.status} owner=${r.ownerPartyId} reviewer=${r.reviewerPartyId} approver=${r.approverPartyId} "${String(r.title).slice(0, 60)}"`);
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
