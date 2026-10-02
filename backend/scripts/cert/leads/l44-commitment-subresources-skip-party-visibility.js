'use strict';

/**
 * L44 — Commitment scope / closeout / evaluation / agreement sub-resources
 * skip the party visibility rule.
 *
 * The rule (commitment.service assertVisible): a party member reads a
 * commitment only when its vendor is their own company (or they created it);
 * anything else answers 404 COMMITMENT_NOT_FOUND. The main routes apply it
 * through loadCommitment({ viewer }).
 *
 * Actors, guests on project 072-01:
 *   SUB-Y  company Y — no commitment of its own; reads company X's subcontracts
 *   SUB-X  company X ("Concrete Works") — reads a supplier's purchase order
 *
 * Exit code 0 = every sub-resource answers 404 like the commitment itself;
 * 2 = any of them answers with the other company's data.
 */

const pv = require('./lib/party-visibility');

const SUBS = [
  ['scope', 'GET', 'scope'],
  ['closeout', 'GET', 'closeout'],
  ['evaluation', 'GET', 'evaluation'],
  ['agreement', 'GET', 'agreement'],
  ['agreement.pdf', 'GET', 'agreement.pdf'],
];

const digest = (name, body, text) => {
  const d = body?.data;
  if (name === 'agreement.pdf') return typeof text === 'string' ? `${text.slice(0, 8).replace(/[^\x20-\x7e]/g, '.')}… (${text.length} chars of PDF)` : '(binary)';
  if (!d) return body;
  if (name === 'scope') return { status: d.status, items: (d.items || d.rows || []).length, first: (d.items || d.rows || [])[0] };
  if (name === 'closeout') return { status: d.status, ready: d.ready, requirements: (d.items || d.requirements || []).map((i) => `${i.key}:${i.status || i.state}`), retention: d.retention || d.retentionHeld, finalAccount: d.finalAccount };
  if (name === 'evaluation') return { status: d.status, score: d.score ?? d.overallScore, rating: d.rating, recommendation: d.recommendation, criteria: (d.criteria || d.lines || []).map((c) => `${c.key}:${c.score ?? c.rating ?? c.value}`) };
  if (name === 'agreement') return { header: d.header, parties: d.parties, money: d.money, scheduleOfValues: (d.scheduleOfValues?.lines || d.scheduleOfValues || []).length };
  return d;
};

pv.main(async () => {
  const s = await pv.setup({ need: ['subX', 'subY'] });
  const P = s.projectId;
  const leaks = [];

  console.log('L44 — commitment sub-resources as read by a guest of another company');
  console.log(`project ${P} (072-01); X = ${s.subX.email}; Y = ${s.subY.email}`);

  const commitments = (await s.pm.GET(`/projects/${P}/commitments?limit=100`)).items || [];
  const xCompanies = new Set(((await s.subX.GET(`/projects/${P}`)).projectAccess?.partyAccess || []).map((p) => p.companyId));
  const xSubcontract = commitments.find((c) => xCompanies.has(c.vendorCompanyId) && c.status === 'closed') || commitments.find((c) => xCompanies.has(c.vendorCompanyId) && c.status === 'executed') || commitments.find((c) => xCompanies.has(c.vendorCompanyId));
  const supplierOrder = commitments.find((c) => c.vendorCompanyId && !xCompanies.has(c.vendorCompanyId) && c.status === 'executed') || commitments.find((c) => c.vendorCompanyId && !xCompanies.has(c.vendorCompanyId));

  const cases = [
    { who: s.subY, label: 'SUB-Y guest', commitment: xSubcontract, about: 'company X\'s subcontract' },
    { who: s.subX, label: 'SUB-X guest', commitment: supplierOrder, about: 'a supplier\'s purchase order' },
  ].filter((c) => c.commitment);

  for (const c of cases) {
    const C = c.commitment;
    console.log(`\n=== ${c.label} and ${c.about}: ${C.ref} (${C.status}), vendor ${C.vendor?.name} ===`);
    const list = await c.who.send('GET', `/projects/${P}/commitments?limit=100`);
    const inList = (list.body?.data?.items || []).some((row) => row.id === C.id);
    console.log(`  control: the guest's own commitment list (${list.status}) holds ${(list.body?.data?.items || []).length} row(s); contains ${C.ref}: ${inList}`);
    const main = await pv.show(c.who, c.label, 'GET', `/projects/${P}/commitments/${C.id}`, undefined, { max: 220 });
    const statement = await pv.show(c.who, c.label, 'GET', `/projects/${P}/commitments/${C.id}/export.pdf`, undefined, { max: 220 });
    const orders = await pv.show(c.who, c.label, 'GET', `/projects/${P}/commitments/${C.id}/change-orders`, undefined, { max: 220 });
    console.log(`  control: commitment ${main.status}, statement PDF ${statement.status}, change orders ${orders.status} — the rule holds on the main routes`);

    for (const [name, method, path] of SUBS) {
      const res = await c.who.send(method, `/projects/${P}/commitments/${C.id}/${path}`);
      console.log(`\n> [${c.label}] ${method} /api/v1/projects/${P}/commitments/${C.id}/${path}`);
      console.log(`< ${res.status} ${pv.short(res.status === 200 ? digest(name, res.body, res.text) : res.body ?? res.text, 900)}`);
      if (res.status === 200) leaks.push(`${c.label} → ${C.ref} /${path} (commitment itself: ${main.status})`);
    }
  }

  console.log('\nSummary');
  for (const line of leaks) console.log(`  - 200: ${line}`);
  if (!leaks.length) console.log('  every sub-resource answered like the commitment itself');

  if (!cases.length) return pv.verdict('L44', 'NOT_REPRODUCED', 'no commitment of another company to test with.');
  if (leaks.length) {
    return pv.verdict('L44', 'CONFIRMED', `a party guest refused another company's commitment (404) is answered 200 on ${leaks.length} of its sub-resources (scope, closeout, evaluation, agreement, agreement PDF).`);
  }
  return pv.verdict('L44', 'NOT_REPRODUCED', 'the sub-resources answer 404 for a commitment of another company.');
});
