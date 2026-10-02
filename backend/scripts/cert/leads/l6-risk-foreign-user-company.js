'use strict';

/**
 * L6 — Risk register user/company ids.
 *
 * A person of company 030 (PM, planning engineer or QS) creates and edits a
 * risk on company 030's OWN project, naming a company-040 user as owner,
 * reviewer, approver, assignee and ball-in-court, and a company-040 company as
 * the assignee company. The API must refuse (4xx). The defect is present when
 * the write is accepted, and worse when the answer carries that person's name
 * and e-mail and the company's name.
 *
 *   node scripts/cert/leads/l6-risk-foreign-user-company.js
 *
 * Exit code 0 = refused; 2 = the defect is present.
 */

const { as } = require('../lib/api');

const LEAD = 'L6';
const OWN = '030';
const OTHER = '040';
const mail = (who, code) => `${who}@c${code}.octapm-cert.test`;
const show = (label, value) => console.log(`${label} ${JSON.stringify(value)}`);
const listOf = (data) => (Array.isArray(data) ? data : data?.items || data?.rows || []);

const main = async () => {
  const ownPm = as(mail('pm', OWN));
  const otherPm = as(mail('pm', OTHER));

  const otherUsers = listOf((await otherPm.send('GET', '/users')).body?.data);
  const foreignUser = otherUsers.find((u) => u.email === mail('qs', OTHER)) || otherUsers[0];
  const otherCompanies = listOf((await otherPm.send('GET', '/companies')).body?.data);
  const foreignCompany = otherCompanies.find((c) => /Consulting Engineers|Property Group/.test(c.name)) || otherCompanies[0];
  const ownUsers = listOf((await ownPm.send('GET', '/users')).body?.data);
  const ownUser = ownUsers.find((u) => u.email === mail('planner', OWN)) || ownUsers[0];
  console.log(`Company ${OTHER} user (the id sent): ${foreignUser.id} — "${foreignUser.name}" <${foreignUser.email}>`);
  console.log(`Company ${OTHER} company (the id sent): ${foreignCompany.id} — "${foreignCompany.name}"`);
  console.log(`Is the foreign user id in company ${OWN}'s own user list? ${ownUsers.some((u) => u.id === foreignUser.id)}`);

  const project = listOf((await ownPm.send('GET', '/projects')).body?.data).find((p) => p.name === 'Metro Depot') || listOf((await ownPm.send('GET', '/projects')).body?.data)[0];
  console.log(`Company ${OWN} project: ${project.id} "${project.name}"`);

  const leaksOf = (text) => [foreignUser.name, foreignUser.email, foreignCompany.name].filter((needle) => needle && String(text).includes(needle));
  const created = [];
  const results = [];

  const refsOf = (d) => (d && typeof d === 'object'
    ? {
        ownerUser: d.ownerUser ?? null, reviewerUser: d.reviewerUser ?? null, approverUser: d.approverUser ?? null,
        assigneeUser: d.assigneeUser ?? null, ballInCourtUser: d.ballInCourtUser ?? null, assigneeCompany: d.assigneeCompany ?? null,
      }
    : null);

  const attempt = async (label, actor, method, route, body) => {
    console.log(`\n--- ${label}`);
    console.log(`> ${actor.email}  ${method} /api/v1${route}`);
    show('> body', body);
    const res = await actor.send(method, route, body);
    console.log(`< ${res.status}${res.body?.error ? ` ${res.body.error.code}: ${res.body.error.message}` : ''}`);
    const refs = refsOf(res.body?.data);
    if (refs) show('< references in the answer', refs);
    const leaks = res.status < 300 ? leaksOf(res.text) : [];
    if (res.status < 300) console.log(`< the answer names company ${OTHER}: ${leaks.length ? leaks.join(', ') : 'no'}`);
    if (method === 'POST' && res.status === 201 && res.body?.data?.id) created.push(res.body.data.id);
    return { label, status: res.status, accepted: res.status < 300, leaks, id: res.body?.data?.id ?? null };
  };

  // Control: own-company user, own-company company — accepted.
  const control = await attempt('control: own company owner and no foreign ref', ownPm, 'POST', `/projects/${project.id}/risks`, {
    description: `${LEAD} control`, ownerUserId: ownUser.id,
  });

  // Each foreign user field on its own.
  for (const field of ['ownerUserId', 'reviewerUserId', 'approverUserId', 'assigneeUserId', 'ballInCourtUserId']) {
    results.push(await attempt(`create with company 040 user as ${field}`, ownPm, 'POST', `/projects/${project.id}/risks`, {
      description: `${LEAD} ${field}`, [field]: foreignUser.id,
    }));
  }
  // The foreign company as assignee company.
  results.push(await attempt('create with company 040 company as assigneeCompanyId', ownPm, 'POST', `/projects/${project.id}/risks`, {
    description: `${LEAD} assigneeCompanyId`, assigneeCompanyId: foreignCompany.id,
  }));

  // As a QS (another role that holds risk:create), everything at once.
  const qs = as(mail('qs', OWN));
  results.push(await attempt('create as QS with every foreign ref at once', qs, 'POST', `/projects/${project.id}/risks`, {
    description: `${LEAD} all-at-once`,
    ownerUserId: foreignUser.id, reviewerUserId: foreignUser.id, approverUserId: foreignUser.id,
    assigneeUserId: foreignUser.id, ballInCourtUserId: foreignUser.id, assigneeCompanyId: foreignCompany.id,
  }));

  // PATCH the control risk to the foreign refs.
  if (control.id) {
    results.push(await attempt('edit the control risk to company 040 owner + company', ownPm, 'PATCH', `/projects/${project.id}/risks/${control.id}`, {
      ownerUserId: foreignUser.id, assigneeCompanyId: foreignCompany.id,
    }));
    const read = await ownPm.send('GET', `/projects/${project.id}/risks`);
    const row = listOf(read.body?.data).find((r) => r.id === control.id);
    console.log(`\n--- read back the list GET /api/v1/projects/${project.id}/risks`);
    show('< the control risk references', refsOf(row));
    console.log(`< names company ${OTHER}: ${row ? (leaksOf(JSON.stringify(row)).join(', ') || 'no') : 'risk not found'}`);
  }

  // Did anything reach the company-040 user's inbox?
  const theirs = as(foreignUser.email);
  const inbox = listOf((await theirs.send('GET', '/notifications?limit=50')).body?.data);
  const reached = inbox.filter((n) => JSON.stringify(n).includes(`${LEAD} `) || created.includes(n.entityId));
  console.log(`\n--- company ${OTHER} user's notification inbox: ${reached.length} notification(s) about these risks`);
  for (const n of reached.slice(0, 3)) show('<', { orgId: n.orgId, title: n.title, actionUrl: n.actionUrl });

  // Tidy up.
  for (const id of created) {
    const gone = await ownPm.send('DELETE', `/projects/${project.id}/risks/${id}`);
    if (gone.status >= 300) console.log(`(cleanup) DELETE risks/${id} -> ${gone.status} ${gone.body?.error?.code ?? ''}`);
  }
  console.log(`(cleanup) removed ${created.length} risk(s) created by this run`);

  if (!control.accepted) {
    console.log(`\nVERDICT ${LEAD}: NOT_REPRODUCED — the control request was refused (${control.status}).`);
    process.exitCode = 1;
    return;
  }
  const accepted = results.filter((r) => r.accepted);
  const leaked = results.filter((r) => r.leaks.length);
  if (!accepted.length) {
    console.log(`\nVERDICT ${LEAD}: NOT_REPRODUCED — every write naming a company ${OTHER} user/company was refused (${results.map((r) => r.status).join(', ')}).`);
    process.exitCode = 0;
  } else if (leaked.length) {
    console.log(`\nVERDICT ${LEAD}: CONFIRMED — ${accepted.length} of ${results.length} writes were accepted and ${leaked.length} answered with company ${OTHER}'s user name, e-mail or company name.`);
    process.exitCode = 2;
  } else {
    console.log(`\nVERDICT ${LEAD}: PARTLY_CONFIRMED — ${accepted.length} of ${results.length} writes were accepted but no answer showed company ${OTHER}'s details.`);
    process.exitCode = 2;
  }
};

main().catch((error) => {
  console.error(error);
  console.log(`VERDICT ${LEAD}: NOT_REPRODUCED — the script failed before a result: ${error.message}`);
  process.exitCode = 1;
});
