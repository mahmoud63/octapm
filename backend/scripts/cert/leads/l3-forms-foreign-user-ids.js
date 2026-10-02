'use strict';

/**
 * L3 — Inspection (forms) assignee / inspector / approver user ids.
 *
 * A person of company 030 creates and edits an inspection on company 030's
 * OWN project, naming a user id that belongs to company 040 as assignee,
 * inspector and approver. The API must refuse every such write (4xx). The
 * defect is present when the write is accepted, and worse when the answer
 * carries the other company's person's name or e-mail.
 *
 *   node scripts/cert/leads/l3-forms-foreign-user-ids.js
 *
 * Exit code 0 = the product refuses; 2 = the defect is present.
 */

const { as } = require('../lib/api');

const LEAD = 'L3';
const OWN = '030';
const OTHER = '040';
const mail = (who, code) => `${who}@c${code}.octapm-cert.test`;
const show = (label, value) => console.log(`${label} ${JSON.stringify(value)}`);
const listOf = (data) => (Array.isArray(data) ? data : data?.items || data?.users || data?.rows || []);

const main = async () => {
  const ownPm = as(mail('pm', OWN));
  const otherPm = as(mail('pm', OTHER));

  // The other company's person whose id is sent, read by that company itself.
  const otherUsers = listOf((await otherPm.send('GET', '/users')).body?.data);
  const foreign = otherUsers.find((u) => u.email === mail('finance', OTHER)) || otherUsers[0];
  const ownUsers = listOf((await ownPm.send('GET', '/users')).body?.data);
  const ownQuality = ownUsers.find((u) => u.email === mail('quality', OWN)) || ownUsers[0];
  console.log(`Other company's person (the id sent): ${foreign.id} — "${foreign.name}" <${foreign.email}>`);
  console.log(`Is that id in company ${OWN}'s own user list? ${ownUsers.some((u) => u.id === foreign.id)}`);

  const project = listOf((await ownPm.send('GET', '/projects')).body?.data).find((p) => p.name === 'Metro Depot') || listOf((await ownPm.send('GET', '/projects')).body?.data)[0];
  const templates = listOf((await ownPm.send('GET', `/projects/${project.id}/forms/templates`)).body?.data);
  const template = templates.find((t) => t.status === 'active' && t.type === 'inspection') || templates.find((t) => t.status === 'active');
  console.log(`Company ${OWN} project: ${project.id} "${project.name}"; template ${template.id} (${template.type})`);

  const leaksOf = (text) => [foreign.name, foreign.email].filter((needle) => needle && String(text).includes(needle));
  const created = [];
  const results = [];

  const attempt = async (label, actor, method, route, body) => {
    console.log(`\n--- ${label}`);
    console.log(`> ${actor.email}  ${method} /api/v1${route}`);
    show('> body', body);
    const res = await actor.send(method, route, body);
    const data = res.body?.data;
    const people = data && typeof data === 'object'
      ? { assigneeUser: data.assigneeUser ?? null, inspectorUser: data.inspectorUser ?? null, approverUser: data.approverUser ?? null, ballInCourtUser: data.ballInCourtUser ?? null }
      : null;
    console.log(`< ${res.status}${res.body?.error ? ` ${res.body.error.code}: ${res.body.error.message}` : ''}`);
    if (people) show('< people in the answer', people);
    const leaks = leaksOf(res.text);
    if (res.status < 300) console.log(`< the answer names the other company's person: ${leaks.length ? leaks.join(', ') : 'no'}`);
    if (method === 'POST' && res.status === 201 && data?.id) created.push(data.id);
    return { label, status: res.status, accepted: res.status < 300, leaks, id: data?.id ?? null };
  };

  // Control: the same request with a person of the same company is accepted.
  const control = await attempt('control: own company person as assignee', ownPm, 'POST', `/projects/${project.id}/forms`, {
    templateId: template.id,
    title: `${LEAD} control`,
    assigneeUserId: ownQuality.id,
  });

  for (const field of ['assigneeUserId', 'inspectorUserId', 'approverUserId']) {
    results.push(await attempt(`create with the other company's person as ${field}`, ownPm, 'POST', `/projects/${project.id}/forms`, {
      templateId: template.id,
      title: `${LEAD} ${field}`,
      [field]: foreign.id,
    }));
  }

  if (control.id) {
    results.push(await attempt('edit: all three fields set to the other company\'s person', ownPm, 'PATCH', `/projects/${project.id}/forms/${control.id}`, {
      assigneeUserId: foreign.id,
      inspectorUserId: foreign.id,
      approverUserId: foreign.id,
    }));
    const read = await ownPm.send('GET', `/projects/${project.id}/forms/${control.id}`);
    const leaks = leaksOf(read.text);
    console.log(`\n--- read back GET /api/v1/projects/${project.id}/forms/${control.id}`);
    console.log(`< ${read.status}; names the other company's person: ${leaks.length ? leaks.join(', ') : 'no'}`);
    const list = await ownPm.send('GET', `/projects/${project.id}/forms?assigneeUserId=${foreign.id}`);
    console.log(`--- list filtered by that person: ${list.status}, ${listOf(list.body?.data).length} inspection(s); names them: ${leaksOf(list.text).length ? 'yes' : 'no'}`);
  }

  // The lowest role: a site engineer of the same company, same request.
  const site = as(mail('site', OWN));
  results.push(await attempt('same create as a site engineer', site, 'POST', `/projects/${project.id}/forms`, {
    templateId: template.id,
    title: `${LEAD} site engineer`,
    assigneeUserId: foreign.id,
  }));

  // Did anything reach the other company's person?
  const theirs = as(foreign.email);
  const inbox = await theirs.send('GET', '/notifications?limit=50');
  const reached = listOf(inbox.body?.data).filter((n) => JSON.stringify(n).includes(`${LEAD} `) || created.includes(n.entityId));
  console.log(`\n--- the other company's person's notification inbox: ${inbox.status}, ${reached.length} notification(s) about these inspections`);
  for (const n of reached.slice(0, 3)) show('<', { orgId: n.orgId, title: n.title, message: n.message, actionUrl: n.actionUrl });

  // Tidy up: remove what this run created.
  for (const id of created) {
    const gone = await ownPm.send('DELETE', `/projects/${project.id}/forms/${id}`);
    if (gone.status >= 300) console.log(`(cleanup) DELETE forms/${id} -> ${gone.status} ${gone.body?.error?.code ?? ''}`);
  }
  console.log(`\n(cleanup) removed ${created.length} inspection(s) created by this run`);

  if (!control.accepted) {
    console.log(`\nVERDICT ${LEAD}: NOT_REPRODUCED — the control request was refused (${control.status}), so nothing was proven either way.`);
    process.exitCode = 1;
    return;
  }
  const accepted = results.filter((r) => r.accepted);
  const leaked = results.filter((r) => r.leaks.length);
  if (!accepted.length) {
    console.log(`\nVERDICT ${LEAD}: NOT_REPRODUCED — every write naming another company's user was refused (${results.map((r) => r.status).join(', ')}).`);
    process.exitCode = 0;
  } else if (leaked.length) {
    console.log(`\nVERDICT ${LEAD}: CONFIRMED — ${accepted.length} of ${results.length} writes naming another company's user were accepted and ${leaked.length} answered with that person's name and e-mail${reached.length ? '; the inspection also reached that person\'s inbox' : ''}.`);
    process.exitCode = 2;
  } else {
    console.log(`\nVERDICT ${LEAD}: PARTLY_CONFIRMED — ${accepted.length} of ${results.length} writes naming another company's user were accepted, but no answer showed that person's name or e-mail.`);
    process.exitCode = 2;
  }
};

main().catch((error) => {
  console.error(error);
  console.log(`VERDICT ${LEAD}: NOT_REPRODUCED — the script failed before a result: ${error.message}`);
  process.exitCode = 1;
});
