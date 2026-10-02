'use strict';

/**
 * Extra finding X-PARTY-2 (found while reproducing L40 / L42) — a subcontractor-party
 * guest can create, rewrite and make default the project's submittal review
 * routes (workflow templates).
 *
 * routes/submittals.js guards POST / PATCH / DELETE /submittals/workflow-templates
 * with requirePermission("submittal", "update") only. The generic workflow
 * engine guards the same kind of configuration with the transition
 * workflow.manage (PM only). submittal:update is in the contractor and
 * subcontractor party profiles and in four company roles.
 *
 * The script changes one existing route and puts it back exactly as it was;
 * the route the guest creates is archived at the end.
 *
 * Exit code 0 = the guest is refused; 2 = the guest changed the review routes.
 */

const pv = require('./lib/party-visibility');

const stamp = () => new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

pv.main(async () => {
  const s = await pv.setup({ need: ['subX'] });
  const P = s.projectId;
  const tag = stamp();
  const guest = await s.subX.GET('/auth/me');
  const findings = [];
  const pickT = (b) => (b?.data ? { id: b.data.id, name: b.data.name, scope: b.data.scope, isDefault: b.data.isDefault, status: b.data.status, steps: (b.data.steps || []).map((st) => ({ name: st.name, assignees: st.assignees })) } : b);

  console.log('X-PARTY-2 — submittal review routes edited by a subcontractor-party guest');
  console.log(`project ${P} (072-01), guest ${s.subX.email} (${guest.id})`);

  console.log('\n=== Control: the generic workflow templates need workflow.manage ===');
  const generic = await pv.show(s.subX, 'SUB-X guest', 'POST', `/projects/${P}/workflows/templates`, { tool: 'submittal', name: `X-PARTY-2 generic ${tag}`, steps: [{ key: 'a', name: 'a', type: 'response', assignees: [{ type: 'user', userId: guest.id }], responses: [{ key: 'ok', label: 'ok', next: 'end_success' }] }] }, { max: 260 });

  console.log('\n=== 1. The guest creates a review route and makes it the project default ===');
  const before = (await s.pm.GET(`/projects/${P}/submittals/workflow-templates?scope=project`)).items || [];
  const created = await pv.show(s.subX, 'SUB-X guest', 'POST', `/projects/${P}/submittals/workflow-templates`, {
    name: `PV X-PARTY-2 route written by the subcontractor ${tag}`,
    description: 'One step, reviewed by the subcontractor\'s own guest',
    isDefault: true,
    steps: [{ name: 'Self review', mode: 'sequential', days: 1, assignees: [{ type: 'user', userId: guest.id }] }],
  }, { pick: pickT });
  const mineId = created.body?.data?.id || null;
  if (created.status === 201) findings.push(`POST submittals/workflow-templates → 201: a route whose only reviewer is the guest, isDefault=${created.body.data.isDefault}`);

  console.log('\n=== 2. The guest rewrites a route the contractor wrote ===');
  const target = before.find((t) => t.status === 'active' && t.id !== mineId);
  let restored = null;
  if (target) {
    console.log(`  target ${target.id} "${target.name}" — steps before: ${pv.short((target.steps || []).map((st) => ({ name: st.name, assignees: st.assignees })), 400)}`);
    const rewritten = await pv.show(s.subX, 'SUB-X guest', 'PATCH', `/projects/${P}/submittals/workflow-templates/${target.id}`, {
      description: `${target.description || ''} [rewritten by the subcontractor ${tag}]`,
      steps: [{ name: 'Self review', mode: 'sequential', days: 1, assignees: [{ type: 'user', userId: guest.id }] }],
    }, { pick: pickT });
    if (rewritten.status === 200) findings.push(`PATCH submittals/workflow-templates/:id → 200: the contractor's route "${target.name.slice(0, 40)}…" now has one step, reviewed by the guest`);
    // Put the route back exactly as the PM had it.
    restored = await s.pm.send('PATCH', `/projects/${P}/submittals/workflow-templates/${target.id}`, {
      description: target.description,
      steps: (target.steps || []).map((st) => ({ name: st.name, mode: st.mode, days: st.days, assignees: st.assignees })),
      isDefault: Boolean(target.isDefault),
    });
    console.log(`  (clean-up) PM restored the route: ${restored.status}`);
  } else {
    console.log('  no active project route of the contractor to rewrite');
  }

  console.log('\n=== 3. The guest archives a route ===');
  if (mineId) {
    const archived = await pv.show(s.subX, 'SUB-X guest', 'DELETE', `/projects/${P}/submittals/workflow-templates/${mineId}`, undefined, { pick: pickT });
    if (archived.status === 200) findings.push('DELETE submittals/workflow-templates/:id → 200: the guest archives a route (any project route, by the same guard)');
    else await s.pm.send('DELETE', `/projects/${P}/submittals/workflow-templates/${mineId}`);
  }
  // The default flag the guest's route took from another route, if any.
  for (const t of before.filter((row) => row.isDefault)) await s.pm.send('PATCH', `/projects/${P}/submittals/workflow-templates/${t.id}`, { isDefault: true });

  console.log('\nSummary');
  console.log(`  generic workflow template as the guest: ${generic.status} ${generic.body?.error?.details?.transition || ''}`);
  for (const line of findings) console.log(`  - ${line}`);
  if (!findings.length) console.log('  the guest was refused on every submittal review route');

  if (findings.length) {
    return pv.verdict('X-PARTY-2', 'CONFIRMED', `a subcontractor-party guest (submittal:update, no workflow.manage) created a default review route with themselves as the only reviewer, rewrote the contractor's route and archived one — ${findings.length} write(s) accepted.`);
  }
  return pv.verdict('X-PARTY-2', 'NOT_REPRODUCED', 'the guest cannot change submittal review routes.');
});
