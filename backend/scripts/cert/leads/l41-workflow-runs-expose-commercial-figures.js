'use strict';

/**
 * L41 (D-08) — Workflow runs expose commercial figures of every tool to anyone
 * with workflow:read.
 *
 * Actor: a guest of the subcontractor party of project 072-01. The party
 * profile holds workflow: read/submit and NO change_order, ipc, cost or
 * procurement permission; commitments and pay applications are limited to
 * the guest's own company by the commitment visibility rule.
 *
 * Set-up (as the PM, through the API): one workflow run on a change order, on
 * another vendor's commitment, on another vendor's pay application, on a
 * payment certificate and on a budget revision. A run is started with a
 * template made for this lead (not a default, no rules) and cancelled at once,
 * so no record stays locked; a cancelled run is listed like any other. Runs
 * found from an earlier execution are reused.
 *
 * Exit code 0 = the guest is given no run of a tool they may not read (or no
 * figures in it); 2 = the figures are returned.
 */

const pv = require('./lib/party-visibility');

const TEMPLATE = (tool) => `PV L41 ${tool} route (cert leads)`;

pv.main(async () => {
  const s = await pv.setup({ need: ['subX'] });
  const P = s.projectId;
  const pmMe = await s.pm.GET('/auth/me');

  console.log('L41 — workflow runs as read by a subcontractor-party guest');
  console.log(`project ${P} (072-01), guest ${s.subX.email}`);

  // ── the records, as the PM knows them ─────────────────────────────────────
  const orders = (await s.pm.GET(`/projects/${P}/change-orders?limit=100`)).orders || [];
  const order = orders.find((o) => Number(o.value) > 0 && !o.archivedAt) || orders[0];
  const commitments = (await s.pm.GET(`/projects/${P}/commitments?limit=100`)).items || [];
  const guestCompanies = new Set(((await s.subX.GET(`/projects/${P}`)).projectAccess?.partyAccess || []).map((p) => p.companyId));
  const foreignCommitment = commitments.find((c) => c.vendorCompanyId && !guestCompanies.has(c.vendorCompanyId) && c.status === 'executed') || commitments.find((c) => c.vendorCompanyId && !guestCompanies.has(c.vendorCompanyId));
  const payApps = (await s.pm.GET(`/projects/${P}/pay-apps?limit=100`)).items || [];
  const foreignPayApp = payApps.find((a) => a.commitment?.vendor?.id && !guestCompanies.has(a.commitment.vendor.id));
  const certificates = await s.pm.GET(`/projects/${P}/ipc`);
  const certificate = (Array.isArray(certificates) ? certificates : certificates.items || []).find((c) => Number(c.netPayable) > 0);
  const revisions = (await s.pm.GET(`/projects/${P}/budget-revisions?limit=100`)).rows || [];
  const revision = revisions.find((r) => Number(r.amount) > 0) || revisions[0];

  const targets = [
    { tool: 'change_order', record: order, truth: order && { ref: order.ref, value: order.value }, guestRoute: `/projects/${P}/change-orders` },
    { tool: 'commitment', record: foreignCommitment, truth: foreignCommitment && { ref: foreignCommitment.ref, vendor: foreignCommitment.vendor?.name, retentionRate: foreignCommitment.retentionRate }, guestRoute: foreignCommitment && `/projects/${P}/commitments/${foreignCommitment.id}` },
    { tool: 'sub_pay_app', record: foreignPayApp, truth: foreignPayApp && { ref: foreignPayApp.ref, vendor: foreignPayApp.commitment?.vendor?.name, grossThisPeriod: foreignPayApp.grossThisPeriod }, guestRoute: foreignPayApp && `/projects/${P}/pay-apps/${foreignPayApp.id}` },
    { tool: 'ipc_certificate', record: certificate, truth: certificate && { period: certificate.period, netPayable: certificate.netPayable, totalCert: certificate.totalCert }, guestRoute: `/projects/${P}/ipc` },
    { tool: 'budget_revision', record: revision, truth: revision && { ref: revision.ref, amount: revision.amount }, guestRoute: `/projects/${P}/budget-revisions` },
  ].filter((t) => t.record?.id);

  // ── set-up: one run per tool ──────────────────────────────────────────────
  console.log('\n=== Set-up (PM): a workflow run on each commercial record ===');
  const existing = (await s.pm.GET(`/projects/${P}/workflows/instances?limit=200`)).items || [];
  for (const target of targets) {
    console.log(`  ${target.tool}: record ${target.record.id} — as the PM reads it: ${JSON.stringify(target.truth)}`);
    target.instance = existing.find((i) => i.tool === target.tool && i.recordId === target.record.id) || null;
    if (target.instance) {
      console.log(`    run ${target.instance.id} (${target.instance.status}) reused`);
      continue;
    }
    const templates = (await s.pm.GET(`/projects/${P}/workflows/templates?tool=${target.tool}`)).items || [];
    let template = templates.find((t) => t.name === TEMPLATE(target.tool) && t.status === 'active');
    if (!template) {
      template = await s.pm.POST(`/projects/${P}/workflows/templates`, {
        tool: target.tool,
        name: TEMPLATE(target.tool),
        description: 'Made for certification lead L41. Not a default, no rules: starts only when named.',
        isDefault: false,
        rules: [],
        steps: [{ key: 'review', name: 'PM review', type: 'response', assignees: [{ type: 'user', userId: pmMe.id }], days: 5, responses: [{ key: 'approve', label: 'Approve', next: 'end_success' }, { key: 'reject', label: 'Reject', next: 'end_fail', requireComment: true }] }],
      });
    }
    const started = await s.pm.send('POST', `/projects/${P}/workflows/instances`, { tool: target.tool, recordId: target.record.id, templateId: template.id });
    if (started.status !== 201) {
      console.log(`    could not start a run: ${started.status} ${pv.short(started.body?.error, 200)}`);
      continue;
    }
    target.instance = started.body.data;
    const cancelled = await s.pm.send('POST', `/projects/${P}/workflows/instances/${target.instance.id}/cancel`, { reason: 'L41 set-up: started only to exist' });
    console.log(`    run ${target.instance.id} started (201) and cancelled (${cancelled.status}) so the record is not locked`);
  }

  // ── what the guest may read of those records directly ─────────────────────
  console.log('\n=== The guest and the records themselves ===');
  for (const target of targets) {
    if (!target.guestRoute) continue;
    const direct = await pv.show(s.subX, 'SUB-X guest', 'GET', target.guestRoute, undefined, { max: 260 });
    target.direct = direct.status;
  }

  // ── what the guest reads through the workflow runs ────────────────────────
  console.log('\n=== The guest and the workflow runs ===');
  const pickRun = (i) => ({ id: i.id, tool: i.tool, recordRef: i.recordRef, recordTitle: i.recordTitle, status: i.status, context: i.context, approvers: (i.steps || []).flatMap((step) => (step.assignments || step.assignees || []).map((a) => a.user?.email || a.email || a.userId).filter(Boolean)) });
  const list = await pv.show(s.subX, 'SUB-X guest', 'GET', `/projects/${P}/workflows/instances?limit=200`, undefined, {
    max: 4000,
    pick: (body) => (body?.data?.items || []).filter((i) => targets.some((t) => t.tool === i.tool)).map(pickRun),
  });
  const seen = list.body?.data?.items || [];
  const leaks = [];
  for (const target of targets) {
    if (!target.instance) continue;
    const row = seen.find((i) => i.id === target.instance.id);
    const one = await pv.show(s.subX, 'SUB-X guest', 'GET', `/projects/${P}/workflows/instances/${target.instance.id}`, undefined, { max: 700, pick: (body) => (body?.data ? pickRun(body.data) : body) });
    const context = row?.context || one.body?.data?.context || null;
    const figures = context ? Object.entries(context).filter(([key, value]) => ['amount', 'gross', 'overClaim', 'totalCert', 'retentionRate', 'vendor'].includes(key) && value !== null && value !== undefined && value !== 0) : [];
    const refused = target.direct === 403 || target.direct === 404;
    if ((row || one.status === 200) && figures.length) {
      leaks.push(`${target.tool} ${context.ref} (record itself: ${target.direct}${refused ? ' refused' : ''}) → ${figures.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
  }
  const templatesSeen = await pv.show(s.subX, 'SUB-X guest', 'GET', `/projects/${P}/workflows/templates`, undefined, { max: 500, pick: (body) => (body?.data?.items || []).map((t) => ({ tool: t.tool, name: t.name, scope: t.scope })) });

  console.log('\nSummary');
  for (const line of leaks) console.log(`  - ${line}`);
  if (!leaks.length) console.log('  no figure of a tool the guest may not read was returned');
  console.log(`  workflow templates listed to the guest: ${templatesSeen.status} (${(templatesSeen.body?.data?.items || []).length} templates, company-wide ones included)`);

  if (!targets.some((t) => t.instance)) return pv.verdict('L41', 'NOT_REPRODUCED', 'no workflow run on a commercial record could be set up to test with.');
  if (leaks.length) {
    return pv.verdict('L41', 'CONFIRMED', `a subcontractor-party guest with workflow:read is given the stored context of every run in the project — ${leaks.length} run(s) on records the guest is refused directly, with their amounts and other vendors' names.`);
  }
  return pv.verdict('L41', 'NOT_REPRODUCED', 'workflow runs of tools the guest may not read are not returned, or carry no figures.');
});
