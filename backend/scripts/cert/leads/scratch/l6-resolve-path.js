'use strict';
// Scratch: the OTHER way to set a risk's references (POST /assignments/resolve) runs the shared helper.
// (a) does it refuse a company-040 user/company on a company-030 risk? (the intended rule, live)
// (b) what does the shared helper do on a risk when it mirrors a reviewer/approver name
//     (Risk has an `owner` text column but no `reviewer` / `approver` column)?
const { as } = require('../../lib/api');
const mail = (who, code) => `${who}@c${code}.octapm-cert.test`;
const listOf = (d) => (Array.isArray(d) ? d : d?.items || d?.rows || d?.data || []);
const short = (r) => `${r.status} ${JSON.stringify(r.body?.error ? { code: r.body.error.code, message: String(r.body.error.message).replace(/\s+/g, ' ').slice(0, 260) } : r.body?.data)}`;

(async () => {
  const pm30 = as(mail('pm', '030'));
  const pm40 = as(mail('pm', '040'));
  const users40 = listOf((await pm40.send('GET', '/users')).body?.data);
  const comps40 = listOf((await pm40.send('GET', '/companies')).body?.data);
  const users30 = listOf((await pm30.send('GET', '/users')).body?.data);
  const victim = users40.find((u) => u.email === mail('site', '040'));
  const vcomp = comps40[0];
  const own = users30.find((u) => u.email === mail('planner', '030'));
  const projects = listOf((await pm30.send('GET', '/projects')).body?.data);
  const project = projects.find((p) => p.name === 'Metro Depot') || projects[0];

  const made = await pm30.send('POST', `/projects/${project.id}/risks`, { description: 'L6-resolve-path plain risk' });
  const riskId = made.body?.data?.id;
  console.log(`create plain risk -> ${made.status} ${riskId}`);
  const resolve = (body) => pm30.send('POST', `/projects/${project.id}/assignments/resolve`, { recordType: 'risk', recordId: riskId, ...body });

  console.log(`(a) resolve ownerUserId = company-040 user      -> ${short(await resolve({ field: 'ownerUserId', userId: victim.id }))}`);
  console.log(`(a) resolve assigneeCompanyId = company-040 co  -> ${short(await resolve({ field: 'assigneeCompanyId', companyId: vcomp.id }))}`);
  console.log(`(b) resolve ownerUserId = own planner           -> ${short(await resolve({ field: 'ownerUserId', userId: own.id }))}`);
  console.log(`(b) resolve reviewerUserId = own planner        -> ${short(await resolve({ field: 'reviewerUserId', userId: own.id }))}`);
  console.log(`(b) resolve approverUserId = own planner        -> ${short(await resolve({ field: 'approverUserId', userId: own.id }))}`);

  const gone = await pm30.send('DELETE', `/projects/${project.id}/risks/${riskId}`);
  console.log(`archive the risk -> ${gone.status}`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
