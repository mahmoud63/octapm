'use strict';

/**
 * Proof for the "commercial-visibility" group — certification findings L25,
 * L41 and L44 (one company's own project; a role or a party guest reading
 * commercial figures its role / party must not).
 *
 * Every guard is shown twice: the refusal of the caller the figure is not
 * theirs, AND the same request succeeding for the caller it belongs to — so
 * a fix that turned into a blanket refusal fails here too.
 *
 *   G1  the project record states its commercial terms (contract value, LD
 *       rate, default retention) only to a caller with ipc:read there (L25)
 *   G2  the project edit does not write over terms withheld from the editor (L25)
 *   G3  the workspace dashboard states a project's contract value, and their
 *       total, only where the caller may read the terms (L25, same figure)
 *   G4  a workflow run is shown only to someone assigned to it or who may read
 *       its record — the tool's module and, for a party member, the record's
 *       own rule; a tool's routes only to its module's readers (L41)
 *   G5  a commitment's scope / close-out / evaluation / agreement answer as the
 *       commitment does: 404 to a party member of another company (L44)
 *
 * Stage: project 072-01 (company 072), its personas (pm, planner, qs, site,
 * finance @c072) and its party guests SUB-X, SUB-Y and CONSULTANT
 * (scripts/cert/leads/lib/party-visibility.js). Run in process:
 *
 *   $env:CERT_INPROCESS = "1"; node scripts/cert/isolation/commercial-visibility-proof.js [--only=G1,G4]
 *
 * Writes (company 072 only): G2 changes the project's LD rate by one and puts
 * it back; G4 starts and at once cancels a workflow run on SUB-X's own
 * commitment (reused on a re-run) with the template lead L41 made.
 *
 * Exit 0 = every refusal and every allowed case holds; 2 = a refusal failed
 * (a defect is present); 3 = only an allowed case failed (over-blocking);
 * 1 = the script itself failed.
 */

const pv = require('../leads/lib/party-visibility');

const ONLY = (process.argv.find((arg) => arg.startsWith('--only=')) || '').slice('--only='.length).split(',').filter(Boolean);
const wants = (...guards) => !ONLY.length || guards.some((guard) => ONLY.includes(guard));
const results = [];

const check = (guard, kind, label, pass, detail = '') => {
  results.push({ guard, kind, label, pass: Boolean(pass), detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${guard} ${kind.padEnd(7)} ${label}${detail ? ` — ${detail}` : ''}`);
};
const said = (res) => `${res.status} ${res.body?.error?.code || ''}`.trim();
const data = (res) => res.body?.data;
const items = (res) => (Array.isArray(data(res)) ? data(res) : data(res)?.items || data(res)?.rows || []);
const persona = (key) => pv.api.as(`${key}@c${pv.CODE}.octapm-cert.test`);
const TERMS = ['contractValue', 'ldRatePerDay', 'defaultRetentionRate'];
const withheld = (record) => Boolean(record) && TERMS.every((key) => record[key] === null) && record.commercialTermsWithheld === true;
const sameTerms = (record, truth) => Boolean(record) && TERMS.every((key) => record[key] === truth[key]) && record.commercialTermsWithheld === false;
const termsOf = (record) => (record ? TERMS.map((key) => `${key}=${record[key]}`).join(' ') + ` withheld=${record.commercialTermsWithheld}` : 'no record');
const notFound = (res, code) => res.status === 404 && res.body?.error?.code === code;

pv.main(async () => {
  const s = await pv.setup();
  const P = s.projectId;
  const PM = s.pm;
  const X = s.subX;
  const Y = s.subY;
  const C = s.consultant;
  const planner = persona('planner');
  const qs = persona('qs');
  const finance = persona('finance');
  const site = persona('site');

  console.log(`commercial-visibility proof — project ${P} (${pv.CODE}-01)`);

  const pmProject = data(await PM.send('GET', `/projects/${P}`));
  const truth = Object.fromEntries(TERMS.map((key) => [key, pmProject?.[key]]));
  if (!(Number(truth.contractValue) > 0)) throw new Error(`project ${P} carries no contract value to prove with: ${JSON.stringify(truth)}`);

  // ── G1 the project record ─────────────────────────────────────────────────
  if (wants('G1')) {
    console.log('\n=== G1 the project record states its commercial terms only to an ipc:read holder ===');
    const rowOf = (res) => items(res).find((row) => row.id === P);
    for (const [label, who] of [['SUB-X guest (subcontractor party)', X], ['CONSULTANT guest', C], ['planning engineer (no ipc:read)', planner], ['site engineer (no ipc:read)', site]]) {
      const detail = await who.send('GET', `/projects/${P}`);
      const list = await who.send('GET', '/projects?limit=100');
      check('G1', 'refuse', `${label}: GET /projects/:id withholds the terms`, detail.status === 200 && withheld(data(detail)), `${said(detail)} ${termsOf(data(detail))}`);
      check('G1', 'refuse', `${label}: GET /projects withholds them on the row`, list.status === 200 && withheld(rowOf(list)), `${said(list)} ${termsOf(rowOf(list))}`);
    }
    const prime = await X.send('GET', `/projects/${P}/prime-contract`);
    check('G1', 'refuse', 'SUB-X guest: the prime contract (the same figure\'s own route) stays refused', prime.status === 403, said(prime));
    for (const [label, who] of [['PM', PM], ['QS (ipc:read)', qs], ['finance (ipc:read)', finance]]) {
      const detail = await who.send('GET', `/projects/${P}`);
      const list = await who.send('GET', '/projects?limit=100');
      check('G1', 'allow', `${label}: GET /projects/:id states the terms`, detail.status === 200 && sameTerms(data(detail), truth), `${said(detail)} ${termsOf(data(detail))}`);
      check('G1', 'allow', `${label}: GET /projects states them on the row`, list.status === 200 && sameTerms(rowOf(list), truth), `${said(list)} ${termsOf(rowOf(list))}`);
    }
  }

  // ── G2 the project edit ───────────────────────────────────────────────────
  if (wants('G2')) {
    console.log('\n=== G2 the project edit leaves terms withheld from the editor as they stand ===');
    const name = pmProject.name;
    const blind = await planner.send('PATCH', `/projects/${P}`, { name, contractValue: 1, ldRatePerDay: 0, defaultRetentionRate: 5 });
    const after = data(await PM.send('GET', `/projects/${P}`));
    check('G2', 'refuse', 'the planning engineer\'s edit (the form\'s blanks and defaults) changes none of the withheld terms', blind.status === 200 && withheld(data(blind)) && sameTerms(after, truth), `${said(blind)}; PM reads ${termsOf(after)}`);
    const plannerEdit = await planner.send('PATCH', `/projects/${P}`, { name });
    check('G2', 'allow', 'the planning engineer still edits the project', plannerEdit.status === 200 && data(plannerEdit)?.name === name, said(plannerEdit));
    const bumped = Number(truth.ldRatePerDay) + 1;
    const pmEdit = await PM.send('PATCH', `/projects/${P}`, { ldRatePerDay: bumped });
    const restored = await PM.send('PATCH', `/projects/${P}`, { ldRatePerDay: truth.ldRatePerDay });
    check('G2', 'allow', 'the PM (ipc:read) changes the LD rate, and puts it back', pmEdit.status === 200 && data(pmEdit)?.ldRatePerDay === bumped && restored.status === 200 && data(restored)?.ldRatePerDay === truth.ldRatePerDay, `${said(pmEdit)} ld=${data(pmEdit)?.ldRatePerDay}; ${said(restored)} ld=${data(restored)?.ldRatePerDay}`);
  }

  // ── G3 the workspace dashboard ────────────────────────────────────────────
  if (wants('G3')) {
    console.log('\n=== G3 the workspace dashboard states contract values only where the terms may be read ===');
    const dashboard = async (who) => {
      const res = await who.send('GET', '/projects/workspace-dashboard');
      const d = data(res) || {};
      return { res, row: (d.projectHealth || []).find((row) => row.id === P), rows: d.projectHealth || [], summary: d.summary || {} };
    };
    const x = await dashboard(X);
    check('G3', 'refuse', 'SUB-X guest: the project\'s row and the total carry no contract value', x.res.status === 200 && x.row && x.row.contractValue === null && x.row.contractValueWithheld === true && x.summary.totalContractValue === null && x.summary.totalContractValueWithheld === true, `${said(x.res)} row cv=${x.row?.contractValue}; total=${x.summary.totalContractValue}`);
    const pl = await dashboard(planner);
    check('G3', 'refuse', 'planning engineer: no row and no total carries a contract value', pl.res.status === 200 && pl.rows.length > 0 && pl.rows.every((row) => row.contractValue === null) && pl.summary.totalContractValue === null, `${said(pl.res)} rows=${pl.rows.map((row) => row.contractValue).join(',')}; total=${pl.summary.totalContractValue}`);
    const pm = await dashboard(PM);
    check('G3', 'allow', 'PM: the project\'s row and the total carry the contract value', pm.res.status === 200 && pm.row?.contractValue === truth.contractValue && pm.row?.contractValueWithheld === undefined && Number(pm.summary.totalContractValue) >= truth.contractValue && pm.summary.totalContractValueWithheld === undefined, `${said(pm.res)} row cv=${pm.row?.contractValue}; total=${pm.summary.totalContractValue}`);
    const q = await dashboard(qs);
    check('G3', 'allow', 'QS (ipc:read): the project\'s row carries the contract value', q.res.status === 200 && q.row?.contractValue === truth.contractValue, `${said(q.res)} row cv=${q.row?.contractValue}; total=${q.summary.totalContractValue}`);
  }

  // ── G4 workflow runs ──────────────────────────────────────────────────────
  if (wants('G4')) {
    console.log('\n=== G4 a workflow run is shown to whoever may read its record (or is assigned to it) ===');
    const runs = items(await PM.send('GET', `/projects/${P}/workflows/instances?limit=200`));
    const commitments = items(await PM.send('GET', `/projects/${P}/commitments?limit=100`));
    const xCompanies = new Set((data(await X.send('GET', `/projects/${P}`))?.projectAccess?.partyAccess || []).map((party) => party.companyId));
    const own = commitments.find((row) => xCompanies.has(row.vendorCompanyId) && row.status !== 'void');
    let ownRun = own && runs.find((run) => run.tool === 'commitment' && run.recordId === own.id);
    if (own && !ownRun) {
      const template = items(await PM.send('GET', `/projects/${P}/workflows/templates?tool=commitment`)).find((row) => row.name === 'PV L41 commitment route (cert leads)' && row.status === 'active');
      if (!template) throw new Error('the commitment template of lead L41 is missing: run l41-workflow-runs-expose-commercial-figures.js once first');
      const started = await PM.send('POST', `/projects/${P}/workflows/instances`, { tool: 'commitment', recordId: own.id, templateId: template.id });
      if (started.status !== 201) throw new Error(`could not start a run on ${own.ref}: ${said(started)}`);
      ownRun = data(started);
      await PM.send('POST', `/projects/${P}/workflows/instances/${ownRun.id}/cancel`, { reason: 'commercial-visibility proof: started only to exist' });
      console.log(`  (set-up) run ${ownRun.id} on SUB-X's own commitment ${own.ref}, started and cancelled`);
    }
    const foreign = (tool) => runs.find((run) => run.tool === tool && (tool !== 'commitment' || !xCompanies.has(commitments.find((row) => row.id === run.recordId)?.vendorCompanyId)));
    const targets = ['change_order', 'ipc_certificate', 'budget_revision', 'commitment', 'sub_pay_app'].map((tool) => ({ tool, run: foreign(tool) })).filter((target) => target.run);
    if (targets.length < 5) console.log(`  note: runs found for ${targets.map((target) => target.tool).join(', ')} only (lead L41's set-up makes all five)`);
    if (!ownRun) throw new Error('SUB-X has no commitment of its own on the project to prove the allowed case with');

    const xList = items(await X.send('GET', `/projects/${P}/workflows/instances?limit=200`));
    for (const { tool, run } of targets) {
      const one = await X.send('GET', `/projects/${P}/workflows/instances/${run.id}`);
      check('G4', 'refuse', `SUB-X guest: the ${tool} run (${run.recordRef}) is neither listed nor returned`, !xList.some((row) => row.id === run.id) && notFound(one, 'WORKFLOW_INSTANCE_NOT_FOUND'), `listed=${xList.some((row) => row.id === run.id)}; GET ${said(one)}`);
    }
    const yList = items(await Y.send('GET', `/projects/${P}/workflows/instances?limit=200`));
    const yOne = await Y.send('GET', `/projects/${P}/workflows/instances/${ownRun.id}`);
    check('G4', 'refuse', 'SUB-Y guest (commitment:read, another company): SUB-X\'s commitment run is neither listed nor returned', !yList.some((row) => row.id === ownRun.id) && notFound(yOne, 'WORKFLOW_INSTANCE_NOT_FOUND'), `listed=${yList.some((row) => row.id === ownRun.id)}; GET ${said(yOne)}`);
    const siteList = items(await site.send('GET', `/projects/${P}/workflows/instances?limit=200`));
    const commercialSeen = siteList.filter((row) => ['change_order', 'ipc_certificate', 'budget_revision', 'commitment', 'sub_pay_app'].includes(row.tool));
    const siteOne = targets[0] ? await site.send('GET', `/projects/${P}/workflows/instances/${targets[0].run.id}`) : null;
    check('G4', 'refuse', 'site engineer (workflow:read, no commercial module): no commercial run listed or returned', commercialSeen.length === 0 && (!siteOne || notFound(siteOne, 'WORKFLOW_INSTANCE_NOT_FOUND')), `listed ${commercialSeen.map((row) => row.tool).join(',') || 'none'}; GET ${siteOne ? said(siteOne) : '-'}`);

    const pmList = items(await PM.send('GET', `/projects/${P}/workflows/instances?limit=200`));
    for (const { tool, run } of targets) {
      const one = await PM.send('GET', `/projects/${P}/workflows/instances/${run.id}`);
      check('G4', 'allow', `PM: the ${tool} run is listed and returned with its context`, pmList.some((row) => row.id === run.id) && one.status === 200 && data(one)?.context?.ref, `GET ${said(one)} context.ref=${data(one)?.context?.ref}`);
    }
    const xOne = await X.send('GET', `/projects/${P}/workflows/instances/${ownRun.id}`);
    check('G4', 'allow', 'SUB-X guest: the run on its own commitment is listed and returned', xList.some((row) => row.id === ownRun.id) && xOne.status === 200 && data(xOne)?.context?.ref === own.ref, `listed=${xList.some((row) => row.id === ownRun.id)}; GET ${said(xOne)} ref=${data(xOne)?.context?.ref}`);
    const templatesOf = async (who) => items(await who.send('GET', `/projects/${P}/workflows/templates`));
    const xTemplates = await templatesOf(X);
    const pmTemplates = await templatesOf(PM);
    const closed = ['change_order', 'ipc_certificate', 'budget_revision'];
    check('G4', 'refuse', 'SUB-X guest: no route (rules, approvers) of a change-order, certificate or budget-revision tool is listed', xTemplates.every((row) => !closed.includes(row.tool)), `listed tools: ${[...new Set(xTemplates.map((row) => row.tool))].join(',') || 'none'}`);
    check('G4', 'allow', 'SUB-X guest still lists the routes of tools it reads (commitment); the PM lists them all', xTemplates.some((row) => row.tool === 'commitment') && closed.every((tool) => pmTemplates.some((row) => row.tool === tool)), `SUB-X ${xTemplates.length}, PM ${pmTemplates.length}`);
    const qsList = items(await qs.send('GET', `/projects/${P}/workflows/instances?limit=200`));
    const qsTools = targets.filter(({ tool }) => ['change_order', 'ipc_certificate', 'budget_revision'].includes(tool));
    check('G4', 'allow', 'QS (change_order, ipc and cost read): the change-order, certificate and budget-revision runs are listed', qsTools.length > 0 && qsTools.every(({ run }) => qsList.some((row) => row.id === run.id)), `${qsTools.map(({ tool, run }) => `${tool}:${qsList.some((row) => row.id === run.id)}`).join(', ')}`);
  }

  // ── G5 commitment sub-resources ───────────────────────────────────────────
  if (wants('G5')) {
    console.log('\n=== G5 a commitment\'s parts answer as the commitment does ===');
    const commitments = items(await PM.send('GET', `/projects/${P}/commitments?limit=100`));
    const xCompanies = new Set((data(await X.send('GET', `/projects/${P}`))?.projectAccess?.partyAccess || []).map((party) => party.companyId));
    const xSubcontract = commitments.find((row) => xCompanies.has(row.vendorCompanyId) && row.type === 'subcontract' && ['closed', 'executed'].includes(row.status)) || commitments.find((row) => xCompanies.has(row.vendorCompanyId) && row.type === 'subcontract');
    const supplierOrder = commitments.find((row) => row.vendorCompanyId && !xCompanies.has(row.vendorCompanyId) && row.status === 'executed') || commitments.find((row) => row.vendorCompanyId && !xCompanies.has(row.vendorCompanyId));
    if (!xSubcontract || !supplierOrder) throw new Error('the project lacks SUB-X\'s subcontract or another vendor\'s commitment to prove with');
    const parts = ['scope', 'closeout', 'evaluation', 'agreement', 'agreement.pdf'];
    const base = (commitment) => `/projects/${P}/commitments/${commitment.id}`;
    const get = (who, commitment, part) => who.send('GET', `${base(commitment)}/${part}`, undefined, part.endsWith('.pdf') ? { binary: true } : {});
    const isPdf = (res) => Buffer.isBuffer(res.buffer) && res.buffer.subarray(0, 4).toString('latin1') === '%PDF';
    for (const [label, who, commitment] of [['SUB-Y guest on SUB-X\'s subcontract', Y, xSubcontract], ['SUB-X guest on another vendor\'s commitment', X, supplierOrder]]) {
      const main = await who.send('GET', base(commitment));
      for (const part of parts) {
        const res = await get(who, commitment, part);
        check('G5', 'refuse', `${label} ${commitment.ref}: /${part} answers 404 like the commitment (${main.status})`, notFound(res, 'COMMITMENT_NOT_FOUND'), said(res));
      }
    }
    for (const [label, who, commitment, expected] of [
      ['SUB-X guest on its own subcontract', X, xSubcontract, parts],
      ['PM on the other vendor\'s commitment', PM, supplierOrder, parts.filter((part) => part !== 'evaluation' || supplierOrder.type === 'subcontract')],
    ]) {
      for (const part of expected) {
        const res = await get(who, commitment, part);
        check('G5', 'allow', `${label} ${commitment.ref}: /${part} answers`, res.status === 200 && (!part.endsWith('.pdf') || isPdf(res)), `${said(res)}${part.endsWith('.pdf') ? ` pdf=${isPdf(res)}` : ''}`);
      }
    }
  }

  // ── verdict ────────────────────────────────────────────────────────────────
  const failedRefusals = results.filter((row) => row.kind === 'refuse' && !row.pass);
  const failedAllows = results.filter((row) => row.kind === 'allow' && !row.pass);
  console.log(`\n${results.length} checks: ${results.filter((row) => row.pass).length} pass, ${failedRefusals.length} refusal(s) failed, ${failedAllows.length} allowed case(s) failed`);
  for (const row of [...failedRefusals, ...failedAllows]) console.log(`  FAILED ${row.guard} ${row.kind} ${row.label} — ${row.detail}`);
  for (const guard of [...new Set(results.map((row) => row.guard))]) {
    const rows = results.filter((row) => row.guard === guard);
    console.log(`  ${guard}: refuse ${rows.filter((r) => r.kind === 'refuse' && r.pass).length}/${rows.filter((r) => r.kind === 'refuse').length}, allow ${rows.filter((r) => r.kind === 'allow' && r.pass).length}/${rows.filter((r) => r.kind === 'allow').length}`);
  }
  if (failedRefusals.length) {
    console.log('\nVERDICT commercial-visibility: DEFECT PRESENT');
    process.exitCode = 2;
  } else if (failedAllows.length) {
    console.log('\nVERDICT commercial-visibility: OVER-BLOCKING (a legitimate caller is refused)');
    process.exitCode = 3;
  } else {
    console.log('\nVERDICT commercial-visibility: FIXED (every refusal and every allowed case holds)');
    process.exitCode = 0;
  }
});
