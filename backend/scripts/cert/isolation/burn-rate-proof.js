'use strict';

/**
 * Certification R21 follow-up: the burn-rate budget line (contract value over
 * the duration) only to a reader with ipc:read on the project.
 *
 *   $env:CERT_INPROCESS = "1"; node scripts/cert/isolation/burn-rate-proof.js
 *
 * Exit 0 when the planner (cost:read, no ipc:read) gets no budget line and the
 * PM gets it; 2 when the planner gets it; 3 when the PM loses it.
 */

const pv = require('../leads/lib/party-visibility');

const main = async () => {
  const s = await pv.setup({ log: () => {}, need: [] });
  const P = s.projectId;
  const planner = pv.api.as(`planner@c${pv.CODE}.octapm-cert.test`);
  const route = `/projects/${P}/cost/burn-rate`;
  const asPlanner = await planner.send('GET', route);
  const asPm = await s.pm.send('GET', route);
  const p = asPlanner.body?.data || {};
  const m = asPm.body?.data || {};
  const plannerIpc = (await planner.send('GET', `/projects/${P}/ipc`)).status;
  console.log(`planner: GET /ipc -> ${plannerIpc}; burn-rate ${asPlanner.status} budgetRate=${p.budgetRate} budgetWithheld=${p.budgetWithheld} points=${(p.data || []).length} firstBudget=${p.data?.[0]?.budget}`);
  console.log(`PM:      burn-rate ${asPm.status} budgetRate=${m.budgetRate} points=${(m.data || []).length}`);
  const refused = asPlanner.status === 200 && p.budgetRate === null && p.budgetWithheld === true && (p.data || []).every((point) => point.budget === null);
  const allowed = asPm.status === 200 && typeof m.budgetRate === 'number' && m.budgetRate > 0;
  console.log(`refused (planner gets no budget line): ${refused ? 'HOLDS' : 'FAILS'}; allowed (PM gets it): ${allowed ? 'HOLDS' : 'FAILS'}`);
  process.exitCode = !refused ? 2 : !allowed ? 3 : 0;
};

pv.main(main);
