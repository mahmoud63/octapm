'use strict';
// Read-only: what is left behind by the L6 scripts after their "cleanup" (DELETE archives).
const { as } = require('../../lib/api');
const listOf = (d) => (Array.isArray(d) ? d : d?.items || d?.rows || d?.data || []);

(async () => {
  const pm30 = as('pm@c030.octapm-cert.test');
  const projects = listOf((await pm30.send('GET', '/projects')).body?.data);
  const project = projects.find((p) => p.name === 'Metro Depot') || projects[0];
  const live = listOf((await pm30.send('GET', `/projects/${project.id}/risks`)).body?.data);
  const all = listOf((await pm30.send('GET', `/projects/${project.id}/risks?includeArchived=true`)).body?.data);
  const mine = (rows) => rows.filter((r) => /^L6/.test(r.description || ''));
  console.log(`default list: ${live.length} risks, ${mine(live).length} with an L6 description`);
  console.log(`includeArchived=true: ${all.length} risks, ${mine(all).length} with an L6 description`);
  const foreign = mine(all).filter((r) => [r.ownerUser, r.reviewerUser, r.approverUser, r.assigneeUser, r.ballInCourtUser].some((u) => u && /@c040\./.test(u.email)) || /CANARY-040/.test(r.assigneeCompany?.name || ''));
  console.log(`archived L6 rows still carrying a company-040 user or company: ${foreign.length}`);
  const sample = foreign[0];
  if (sample) console.log(`sample: ${sample.ref} status=${sample.status} ownerUser=${JSON.stringify(sample.ownerUser)} assigneeCompany=${JSON.stringify(sample.assigneeCompany)}`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
