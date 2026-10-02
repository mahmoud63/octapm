'use strict';

/**
 * L40 (D-07) — Submittal and RFI status set directly through PATCH / POST,
 * bypassing the transition permissions and the workflow lock.
 *
 * Actor: a guest of the subcontractor party of project 072-01. The party
 * profile gives submittal: read/create/update/submit with transitions
 * submittal.submit, submittal.resubmit — NOT submittal.review / approve /
 * reject; and rfi: read/create/update/submit with rfi.submit — NOT rfi.answer,
 * rfi.close, rfi.approve.
 *
 * Each case first shows the guarded action route refusing the guest (403) and
 * then asks for the same result through the plain create / update route.
 *
 * Exit code 0 = every direct status change is refused; 2 = any is accepted.
 */

const pv = require('./lib/party-visibility');

const TEMPLATE_NAME = 'PV L40 submittal second review (cert leads)';
const stamp = () => new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

pv.main(async () => {
  const s = await pv.setup({ need: ['subX'] });
  const P = s.projectId;
  const tag = stamp();
  const findings = [];
  const pickSub = (body) => {
    const d = body?.data;
    if (!d) return body;
    return { id: d.id, ref: d.ref, status: d.status, ownerPartyId: d.ownerPartyId, responseCode: d.responseCode, responseCodeLabel: d.responseCodeLabel, distributedAt: d.distributedAt, reviewedOn: d.reviewedOn, currentStepId: d.currentStepId };
  };
  const pickRfi = (body) => {
    const d = body?.data;
    if (!d) return body;
    return { id: d.id, ref: d.ref, status: d.status, ownerPartyId: d.ownerPartyId, response: d.response, answeredBy: d.answeredBy, answeredDate: d.answeredDate, scheduleImpact: d.scheduleImpact, scheduleImpactFlag: d.scheduleImpactFlag, activityLinks: d.activityLinks };
  };

  console.log('L40 — status set directly on submittals and RFIs by a subcontractor-party guest');
  console.log(`project ${P} (072-01), guest ${s.subX.email}`);

  // ── Submittal: approve through PATCH ──────────────────────────────────────
  console.log('\n=== 1. Submittal: the guest approves their own submittal with PATCH ===');
  const s1 = await pv.show(s.subX, 'SUB-X guest', 'POST', `/projects/${P}/submittals`, { title: `PV L40 shop drawing ${tag}` }, { pick: pickSub });
  const s1Id = s1.body?.data?.id;
  if (!s1Id) throw new Error('could not create a submittal as the guest');
  const s1Approve = await pv.show(s.subX, 'SUB-X guest', 'POST', `/projects/${P}/submittals/${s1Id}/approve`, { comment: 'self approval' });
  const s1Review = await pv.show(s.subX, 'SUB-X guest', 'PATCH', `/projects/${P}/submittals/${s1Id}`, { status: 'under_review' }, { pick: pickSub });
  const s1Patch = await pv.show(s.subX, 'SUB-X guest', 'PATCH', `/projects/${P}/submittals/${s1Id}`, { status: 'approved', comment: 'approved by the subcontractor' }, { pick: pickSub });
  const s1After = await pv.show(s.pm, 'PM', 'GET', `/projects/${P}/submittals/${s1Id}`, undefined, { pick: pickSub });
  if (s1Patch.status === 200 && s1After.body?.data?.status === 'approved') {
    findings.push(`submittal ${s1After.body.data.ref}: POST /approve answered ${s1Approve.status}, PATCH {status:"approved"} answered 200 and the register shows it approved (responseCode ${s1After.body.data.responseCode})`);
  }

  // ── Submittal: created already approved ──────────────────────────────────
  console.log('\n=== 2. Submittal: created already approved ===');
  const s2 = await pv.show(s.subX, 'SUB-X guest', 'POST', `/projects/${P}/submittals`, { title: `PV L40 born approved ${tag}`, status: 'approved' }, { pick: pickSub });
  if (s2.status === 201 && s2.body?.data?.status === 'approved') findings.push(`submittal ${s2.body.data.ref}: POST create with status "approved" answered 201, status approved`);

  // ── Submittal: the engine's lock ──────────────────────────────────────────
  console.log('\n=== 3. Submittal: a running workflow locks the record, PATCH goes round the lock ===');
  let lockNote = 'lock case not reached';
  const s3 = await pv.show(s.subX, 'SUB-X guest', 'POST', `/projects/${P}/submittals`, { title: `PV L40 locked by a workflow ${tag}` }, { pick: pickSub });
  const s3Id = s3.body?.data?.id;
  if (s3Id) {
    const toReview = await pv.show(s.pm, 'PM', 'PATCH', `/projects/${P}/submittals/${s3Id}`, { status: 'under_review' }, { pick: pickSub });
    const templates = await s.pm.send('GET', `/projects/${P}/workflows/templates?tool=submittal`);
    let template = (templates.body?.data?.items || []).find((t) => t.name === TEMPLATE_NAME && t.status === 'active');
    if (!template) {
      const pmMe = await s.pm.GET('/auth/me');
      const created = await pv.show(s.pm, 'PM', 'POST', `/projects/${P}/workflows/templates`, {
        tool: 'submittal',
        name: TEMPLATE_NAME,
        description: 'Second review by the PM. Not a default, no rules: starts only when named.',
        isDefault: false,
        rules: [],
        steps: [{ key: 'review', name: 'Second review', type: 'response', assignees: [{ type: 'user', userId: pmMe.id }], days: 10, responses: [{ key: 'approve', label: 'Approve', next: 'end_success' }, { key: 'reject', label: 'Reject', next: 'end_fail', requireComment: true }] }],
      }, { max: 300 });
      template = created.body?.data;
    }
    const started = template?.id
      ? await pv.show(s.pm, 'PM', 'POST', `/projects/${P}/workflows/instances`, { tool: 'submittal', recordId: s3Id, templateId: template.id }, { pick: (b) => ({ id: b?.data?.id, status: b?.data?.status, currentStepKey: b?.data?.currentStepKey, error: b?.error }) })
      : null;
    const instanceId = started?.body?.data?.id;
    if (toReview.status === 200 && instanceId) {
      const pmApprove = await pv.show(s.pm, 'PM', 'POST', `/projects/${P}/submittals/${s3Id}/approve`, { comment: 'approve route while the workflow runs' });
      const guestPatch = await pv.show(s.subX, 'SUB-X guest', 'PATCH', `/projects/${P}/submittals/${s3Id}`, { status: 'approved', comment: 'round the lock' }, { pick: pickSub });
      const instance = await pv.show(s.pm, 'PM', 'GET', `/projects/${P}/workflows/instances/${instanceId}`, undefined, { pick: (b) => ({ id: b?.data?.id, status: b?.data?.status, outcome: b?.data?.outcome, currentStepKey: b?.data?.currentStepKey }) });
      const record = await pv.show(s.pm, 'PM', 'GET', `/projects/${P}/submittals/${s3Id}`, undefined, { pick: pickSub });
      lockNote = `approve route ${pmApprove.status} ${pmApprove.body?.error?.code || ''}; PATCH ${guestPatch.status}; record ${record.body?.data?.status}; workflow ${instance.body?.data?.status}`;
      if (pmApprove.status === 409 && guestPatch.status === 200 && record.body?.data?.status === 'approved') {
        findings.push(`submittal ${record.body.data.ref}: the approve route is locked (409 ${pmApprove.body?.error?.code}) while a workflow runs, yet PATCH {status:"approved"} by the guest answered 200 — the record is approved while its workflow is still "${instance.body?.data?.status}"`);
      }
      // Leave nothing running behind.
      if (instance.body?.data?.status === 'running') await pv.show(s.pm, 'PM (clean-up)', 'POST', `/projects/${P}/workflows/instances/${instanceId}/cancel`, { reason: 'L40 reproduction finished' }, { pick: (b) => ({ status: b?.data?.status, error: b?.error }) });
    } else {
      lockNote = `set-up refused (under_review ${toReview.status}, instance ${started?.status})`;
    }
  }
  console.log(`  lock case: ${lockNote}`);

  // ── RFI: closed through PATCH ─────────────────────────────────────────────
  console.log('\n=== 4. RFI: the guest answers and closes their own RFI with PATCH ===');
  const acts = await s.subX.send('GET', `/projects/${P}/activities?limit=1`);
  const activityId = (acts.body?.data?.items || acts.body?.data || [])[0]?.id || null;
  const r1 = await pv.show(s.subX, 'SUB-X guest', 'POST', `/projects/${P}/rfi`, { subject: `PV L40 embed depth ${tag}`, question: 'What is the embed depth?', status: 'open', ...(activityId ? { activityId } : {}) }, { pick: pickRfi });
  const r1Id = r1.body?.data?.id;
  if (!r1Id) throw new Error('could not create an RFI as the guest');
  const r1Answer = await pv.show(s.subX, 'SUB-X guest', 'POST', `/projects/${P}/rfi/${r1Id}/answer`, { response: 'self answer' });
  const r1Close = await pv.show(s.subX, 'SUB-X guest', 'POST', `/projects/${P}/rfi/${r1Id}/close`, { comment: 'self close' });
  const r1Patch = await pv.show(s.subX, 'SUB-X guest', 'PATCH', `/projects/${P}/rfi/${r1Id}`, { status: 'closed', response: 'Use 450 mm — written by the subcontractor', answeredBy: 'The Engineer', scheduleImpactFlag: true, scheduleImpact: 45, comment: 'closed by the subcontractor' }, { pick: pickRfi });
  const r1After = await pv.show(s.pm, 'PM', 'GET', `/projects/${P}/rfi/${r1Id}`, undefined, { pick: pickRfi });
  if (r1Patch.status === 200 && r1After.body?.data?.status === 'closed') {
    const link = (r1After.body.data.activityLinks || []).find((l) => l.relationType === 'schedule_impact');
    findings.push(
      `RFI ${r1After.body.data.ref}: POST /answer answered ${r1Answer.status} and POST /close ${r1Close.status}, PATCH {status:"closed", response, scheduleImpact:45} answered 200 — closed with the guest's own text as the response${link ? ` and an approved schedule impact of ${link.scheduleImpactDays} days recorded against the activity ("${link.notes}")` : ''}`,
    );
  }

  // ── RFI: created already closed ──────────────────────────────────────────
  console.log('\n=== 5. RFI: created already closed ===');
  const r2 = await pv.show(s.subX, 'SUB-X guest', 'POST', `/projects/${P}/rfi`, { subject: `PV L40 born closed ${tag}`, question: 'q', response: 'answered by nobody', status: 'closed' }, { pick: pickRfi });
  if (r2.status === 201 && r2.body?.data?.status === 'closed') findings.push(`RFI ${r2.body.data.ref}: POST create with status "closed" answered 201, status closed`);

  console.log('\nSummary');
  if (!findings.length) console.log('  every direct status change was refused');
  for (const line of findings) console.log(`  - ${line}`);

  if (findings.length) {
    return pv.verdict('L40', 'CONFIRMED', `a subcontractor-party guest without submittal.approve / rfi.answer / rfi.close set the status directly in ${findings.length} case(s): the guarded routes answer 403 and the plain PATCH / POST accept "approved" and "closed", including on a submittal locked by a running workflow.`);
  }
  return pv.verdict('L40', 'NOT_REPRODUCED', 'PATCH and POST refuse a status the caller has no transition for.');
});
