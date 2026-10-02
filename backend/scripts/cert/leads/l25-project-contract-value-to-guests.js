'use strict';

/**
 * L25 — Project detail and list return contractValue and ldRatePerDay to every
 * caller, including external-party guests.
 *
 * Actor: a guest of the subcontractor party of project 072-01 (membership
 * kind "guest", role external_party; the subcontractor party profile holds no
 * ipc, cost, change_order or procurement permission).
 *
 * The product's own rule for the same figure: GET /projects/:p/prime-contract
 * is behind ipc:read (and the BOQ rule) — the guest is refused there.
 *
 * Exit code 0 = the figures are withheld from the guest; 2 = they are returned.
 */

const pv = require('./lib/party-visibility');

pv.main(async () => {
  const s = await pv.setup({ need: ['subX', 'consultant'] });
  const P = s.projectId;
  const pick = (body) => {
    const d = body?.data || {};
    return { id: d.id, name: d.name, contractValue: d.contractValue, ldRatePerDay: d.ldRatePerDay, defaultRetentionRate: d.defaultRetentionRate, currency: d.currency, contractNumber: d.contractNumber, access: d.access || d.projectAccess };
  };

  console.log('L25 — contract value and LD rate on the project record, as read by an external-party guest');
  console.log(`project ${P} (072-01), guest ${s.subX.email} (subcontractor party ${s.parties.subcontractor})`);

  const asPm = await pv.show(s.pm, 'PM', 'GET', `/projects/${P}`, undefined, { pick });
  const truth = asPm.body?.data || {};

  // The product's own rule for the contract sum.
  const prime = await pv.show(s.subX, 'SUB-X guest', 'GET', `/projects/${P}/prime-contract`);
  const ipc = await pv.show(s.subX, 'SUB-X guest', 'GET', `/projects/${P}/ipc`);

  const detail = await pv.show(s.subX, 'SUB-X guest', 'GET', `/projects/${P}`, undefined, { pick });
  const list = await pv.show(s.subX, 'SUB-X guest', 'GET', '/projects', undefined, {
    pick: (body) => (body?.data?.items || body?.data || []).map?.((d) => ({ id: d.id, name: d.name, contractValue: d.contractValue, ldRatePerDay: d.ldRatePerDay })) ?? body,
  });
  const consultantDetail = await pv.show(s.consultant, 'CONSULTANT guest', 'GET', `/projects/${P}`, undefined, { pick });

  const d = detail.body?.data || {};
  const listed = (list.body?.data?.items || list.body?.data || []).find?.((row) => row.id === P) || {};
  const has = (value) => value !== undefined && value !== null && value !== '';
  const same = (a, b) => has(a) && String(a) === String(b);

  console.log('\nSummary');
  console.log(`  PM sees               contractValue=${truth.contractValue} ldRatePerDay=${truth.ldRatePerDay}`);
  console.log(`  guest, prime contract ${prime.status} ${prime.body?.error?.code || ''} (the guarded source of the same figure)`);
  console.log(`  guest, IPC list       ${ipc.status} ${ipc.body?.error?.code || ''}`);
  console.log(`  guest, project detail ${detail.status} contractValue=${d.contractValue} ldRatePerDay=${d.ldRatePerDay}`);
  console.log(`  guest, project list   ${list.status} contractValue=${listed.contractValue} ldRatePerDay=${listed.ldRatePerDay}`);
  console.log(`  consultant guest      ${consultantDetail.status} contractValue=${consultantDetail.body?.data?.contractValue} ldRatePerDay=${consultantDetail.body?.data?.ldRatePerDay}`);

  if (!has(truth.contractValue)) {
    return pv.verdict('L25', 'NOT_REPRODUCED', 'the project carries no contract value to test with.');
  }
  const leakedDetail = detail.status === 200 && (same(d.contractValue, truth.contractValue) || same(d.ldRatePerDay, truth.ldRatePerDay));
  const leakedList = list.status === 200 && (same(listed.contractValue, truth.contractValue) || same(listed.ldRatePerDay, truth.ldRatePerDay));
  const guarded = prime.status === 403;

  if (leakedDetail || leakedList) {
    return pv.verdict(
      'L25',
      'CONFIRMED',
      `a subcontractor-party guest ${guarded ? 'refused the prime contract (403) ' : ''}reads the main contract sum (${truth.contractValue}) and the LD rate per day (${truth.ldRatePerDay}) from GET /projects${leakedDetail ? '/:id' : ''}${leakedDetail && leakedList ? ' and GET /projects' : ''}.`,
    );
  }
  return pv.verdict('L25', 'NOT_REPRODUCED', 'contractValue and ldRatePerDay are withheld from the external-party guest on project detail and list.');
});
