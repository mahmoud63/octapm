'use strict';

/**
 * Scratch — the independent checker's own run of L23. Not the lead script.
 *
 * Part A (company 041, project 041-01): a party member the claimant's fixture
 *   did NOT create (fatima.mensah.6, "Concrete Works", seeded) against the
 *   claimant's RFI-012, plus three controls: the RFI's own detail route, a
 *   company member with no place on the project, and another company's PM.
 * Part B (company 031, project 031-01): documents that no lead script made.
 *   A person of company 031 with no place on the project is refused; the PM
 *   puts that person in a new subcontractor party; the same requests again;
 *   then the party is removed and the refusal is checked again.
 */

const crypto = require('crypto');
const fs = require('fs');
const { as } = require('../../lib/api');
const { buildPopulation } = require('../../lib/spec');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const line = (t = '') => console.log(t);
const head = (t) => line(`\n── ${t} ${'─'.repeat(Math.max(4, 76 - t.length))}`);
const listOf = (d) => (Array.isArray(d) ? d : d?.items || d?.rows || d?.records || []);
const inv = (code) => JSON.parse(fs.readFileSync(`C:/Temp/octapm-cert/state/inventory/${code}.json`, 'utf8'));
const person = (code, email) => buildPopulation().companies.find((c) => c.code === code).people.find((p) => p.email === email);
const strip = (url) => String(url || '').replace(/^\/api\/v1/, '');

const show = (res) => {
  if (res.buffer) return `${res.status} ${res.headers.get('content-type') || ''} ${res.buffer.length} bytes sha256=${sha(res.buffer).slice(0, 16)}…`;
  const e = res.body?.error;
  if (e) return `${res.status} ${e.code}: ${String(e.message).slice(0, 120)}`;
  return `${res.status} ${String(res.text ?? '').slice(0, 110)}`;
};
const ask = async (label, session, route, binary = false) => {
  const res = await session.send('GET', route, undefined, binary ? { binary: true } : {});
  line(`  [${label}] GET ${route}\n      -> ${show(res)}`);
  return res;
};

const facts = { a: {}, b: {} };

const partA = async () => {
  const code = '041';
  const P = `/projects/${inv(code).projects['041-01'].id}`;
  const pm = as('pm@c041.octapm-cert.test');
  const fatima = as('fatima.mensah.6@c041.octapm-cert.test');
  const offTeam = as('dina.darwish.3@c041.octapm-cert.test');
  const foreignPm = as('pm@c042.octapm-cert.test');

  head('A. 041-01 — the claimant\'s RFI, seen by a seeded party member (Concrete Works)');
  const pmRows = listOf((await pm.send('GET', `${P}/doc-control/register?recordType=rfi`)).body?.data);
  const target = pmRows.find((r) => String(r.title || '').startsWith('CERT-L23'));
  if (!target) throw new Error('no CERT-L23 RFI in the PM register — run the lead script first');
  const rfi = (await pm.send('GET', `${P}/rfi/${target.recordId}`)).body?.data || {};
  const parties = listOf((await pm.send('GET', `${P}/parties?status=active`)).body?.data);
  const fatimaParty = parties.find((p) => (p.members || []).some((m) => m.userId === person(code, 'fatima.mensah.6@c041.octapm-cert.test').id && m.status === 'active'));
  line(`  ${rfi.ref} ${target.recordId}: ownerPartyId=${rfi.ownerPartyId} reviewerPartyId=${rfi.reviewerPartyId} approverPartyId=${rfi.approverPartyId || null}; created by ${rfi.raisedBy || rfi.createdBy || '?'}`);
  line(`  Fatima's party: ${fatimaParty?.id} (${fatimaParty?.role} "${fatimaParty?.company?.name}") — in the RFI's routing: ${[rfi.ownerPartyId, rfi.reviewerPartyId, rfi.approverPartyId].includes(fatimaParty?.id)}`);
  const revA = (target.revisions || []).find((r) => r.revision === 'A' && r.downloadUrl);
  line(`  revision "A": ${revA?.id} status=${revA?.status} uploadedBy=${revA?.uploadedBy || revA?.issuedBy || '?'} document=${revA?.projectDocumentId}`);
  const pmFile = await pm.send('GET', strip(revA.downloadUrl), undefined, { binary: true });
  const wanted = sha(pmFile.buffer);

  line('  controls:');
  const detail = await ask('FATIMA', fatima, `${P}/rfi/${target.recordId}`);
  const routedRfi = listOf((await ask('FATIMA', fatima, `${P}/rfi?limit=100`)).body?.data);
  const routedSub = listOf((await ask('FATIMA', fatima, `${P}/submittals?limit=100`)).body?.data);
  line(`  routed lists for Fatima: ${routedRfi.length} RFI(s) [${routedRfi.map((r) => r.ref).join(', ')}], ${routedSub.length} submittal(s)`);

  line('  the register:');
  const regRfi = listOf((await ask('FATIMA', fatima, `${P}/doc-control/register?recordType=rfi`)).body?.data);
  const regSub = listOf((await ask('FATIMA', fatima, `${P}/doc-control/register?recordType=submittal`)).body?.data);
  const seen = regRfi.find((r) => r.recordId === target.recordId);
  line(`  register for Fatima: ${regRfi.length} RFI(s), ${regSub.length} submittal(s); the CERT-L23 RFI listed: ${Boolean(seen)}; restrictedToCurrentRevision=${seen?.restrictedToCurrentRevision}`);
  if (seen) line(`  fields served for it: title="${seen.title}" status=${seen.status} owner=${JSON.stringify(seen.owner)} reviewer=${JSON.stringify(seen.reviewer)} revisions=${(seen.revisions || []).length} attachments=${seen.attachmentCount}`);
  const dl = await ask('FATIMA', fatima, `${P}/doc-control/revisions/${revA.id}/download`, true);
  const door = await ask('FATIMA', fatima, `${P}/attachments/documents/${revA.projectDocumentId}`, true);
  const same = (r) => Boolean(r.buffer) && sha(r.buffer) === wanted;
  line(`  bytes equal to the PM's file: download ${same(dl)}, /attachments/documents ${same(door)}`);

  line('  who is refused (the boundary that does hold):');
  const off = await ask('041 MEMBER, NOT ON PROJECT', offTeam, `${P}/doc-control/register?recordType=rfi`);
  const foreign = await ask('PM OF COMPANY 042', foreignPm, `${P}/doc-control/register?recordType=rfi`);
  const foreignDl = await ask('PM OF COMPANY 042', foreignPm, `${P}/doc-control/revisions/${revA.id}/download`, true);

  Object.assign(facts.a, {
    detailStatus: detail.status,
    routed: [routedRfi.length, routedSub.length],
    register: [regRfi.length, regSub.length],
    listed: Boolean(seen),
    bytes: same(dl) || same(door),
    offTeam: off.status,
    foreign: [foreign.status, foreignDl.status],
  });
};

const partB = async () => {
  const code = '031';
  const P = `/projects/${inv(code).projects['031-01'].id}`;
  const pm = as('pm@c031.octapm-cert.test');
  const email = 'chloe.navarro.4@c031.octapm-cert.test';
  const chloe = as(email);
  const chloeId = person(code, email).id;
  const NAME = 'CERT-L23CHK Subcontractor';

  head('B. 031-01 — seeded documents; a person with no place on the project');
  const before = await ask('CHLOE before', chloe, `${P}/doc-control/register?recordType=submittal`);
  const pmSub = listOf((await pm.send('GET', `${P}/doc-control/register?recordType=submittal`)).body?.data);
  const pmRfi = listOf((await pm.send('GET', `${P}/doc-control/register?recordType=rfi`)).body?.data);
  const victim = pmSub.find((r) => (r.revisions || []).some((v) => v.downloadUrl && v.projectDocumentId));
  const rev = victim ? victim.revisions.find((v) => v.downloadUrl && v.projectDocumentId) : null;
  line(`  the PM's register: ${pmRfi.length} RFI(s), ${pmSub.length} submittal(s); picked ${victim?.ref} "${victim?.title}" revision ${rev?.revision} (${rev?.id}, status ${rev?.status})`);
  const pmFile = rev ? await pm.send('GET', strip(rev.downloadUrl), undefined, { binary: true }) : null;
  const wanted = pmFile?.buffer ? sha(pmFile.buffer) : null;
  line(`  the PM's copy of that file: ${pmFile ? show(pmFile) : 'none'}`);

  let party = null;
  try {
    const parties = listOf((await pm.send('GET', `${P}/parties?status=active`)).body?.data);
    party = parties.find((p) => p.company?.name === NAME && p.status === 'active') || null;
    if (!party) {
      const made = await pm.send('POST', `${P}/parties`, { role: 'subcontractor', companyName: NAME });
      line(`  [PM] POST ${P}/parties {subcontractor "${NAME}"} -> ${made.status}`);
      party = made.body?.data;
    }
    const add = await pm.send('POST', `${P}/parties/${party.id}/members`, { userId: chloeId });
    line(`  [PM] POST ${P}/parties/${party.id}/members {chloe} -> ${add.status}`);

    line('  now a member of a subcontractor party that nothing is routed to:');
    const routedRfi = listOf((await ask('CHLOE', chloe, `${P}/rfi?limit=100`)).body?.data);
    const routedSub = listOf((await ask('CHLOE', chloe, `${P}/submittals?limit=100`)).body?.data);
    const detail = victim ? await ask('CHLOE', chloe, `${P}/submittals/${victim.recordId}`) : { status: null };
    const regRfi = listOf((await ask('CHLOE', chloe, `${P}/doc-control/register?recordType=rfi`)).body?.data);
    const regSub = listOf((await ask('CHLOE', chloe, `${P}/doc-control/register?recordType=submittal`)).body?.data);
    const dash = await ask('CHLOE', chloe, `${P}/doc-control/dashboard`);
    line(`  routed lists: ${routedRfi.length} RFI(s), ${routedSub.length} submittal(s); register: ${regRfi.length} RFI(s), ${regSub.length} submittal(s) with ${regSub.reduce((n, r) => n + (r.revisions || []).length, 0)} revision(s)`);
    line(`  dashboard: ${JSON.stringify(dash.body?.data?.metrics || null)}`);
    let dl = { status: null };
    let door = { status: null };
    if (rev) {
      dl = await ask('CHLOE', chloe, `${P}/doc-control/revisions/${rev.id}/download`, true);
      door = await ask('CHLOE', chloe, `${P}/attachments/documents/${rev.projectDocumentId}`, true);
    }
    const same = (r) => Boolean(r.buffer) && wanted && sha(r.buffer) === wanted;
    line(`  bytes equal to the PM's file: download ${same(dl)}, /attachments/documents ${same(door)}`);
    Object.assign(facts.b, {
      before: before.status,
      detailStatus: detail.status,
      routed: [routedRfi.length, routedSub.length],
      register: [regRfi.length, regSub.length],
      total: [pmRfi.length, pmSub.length],
      bytes: same(dl) || same(door),
    });
  } finally {
    if (party?.id) {
      const out1 = await pm.send('DELETE', `${P}/parties/${party.id}/members/${chloeId}`);
      const out2 = await pm.send('DELETE', `${P}/parties/${party.id}`);
      line(`  (clean-up) member removed -> ${out1.status}; party removed -> ${out2.status}`);
      const after = await ask('CHLOE after', chloe, `${P}/doc-control/register?recordType=submittal`);
      facts.b.after = after.status;
    }
  }
};

(async () => {
  await partA();
  await partB();
  head('summary');
  line(`  ${JSON.stringify(facts)}`);
  const a = facts.a;
  const b = facts.b;
  const leakA = a.listed && a.bytes && a.register[0] > a.routed[0];
  const leakB = b.bytes && (b.register[0] > b.routed[0] || b.register[1] > b.routed[1]);
  const tenantHolds = a.foreign.every((s) => s === 403 || s === 404) && [403, 404].includes(a.offTeam) && [403, 404].includes(b.before);
  line(`  party leak on 041: ${leakA}; party leak on 031: ${leakB}; outsiders refused (other company, non-member): ${tenantHolds}`);
  process.exitCode = leakA || leakB ? 2 : 0;
})().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
