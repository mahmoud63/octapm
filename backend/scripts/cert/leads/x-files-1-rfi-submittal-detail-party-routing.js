'use strict';

/**
 * Extra finding FILES-X1 (found while reproducing L2 and L23) — the RFI and
 * submittal routes that take an id do not apply the party routing that the
 * lists apply: detail, responses and submittal packages answer a party the
 * record is not routed to, and that party can write a response on it.
 *
 * Stage: company 041, project 041-01 (see _files-fixture.js). The RFI is the
 * one of L23 (routed contractor -> consultant, made here when absent); the
 * viewer is SUB-B, a subcontractor party that it is not routed to.
 *
 * Exit code 0 when every by-id route refuses SUB-B, 2 otherwise.
 */

const { ask, head, line, listOf, main, stage, verdict, whoIs } = require('./_files-fixture');

const MARK = 'CERT-L23';
const LEAD = 'FILES-X1';

main(async () => {
  const s = await stage();
  const { P, pm, subB } = s;

  head('who is who on project 041-01');
  await whoIs(pm, P, subB.email);

  head('the records');
  const find = async () => listOf((await pm.send('GET', `${P}/doc-control/register?recordType=rfi&search=${MARK}`)).body?.data).find((row) => String(row.title || '').startsWith(MARK)) || null;
  let row = await find();
  if (!row) {
    const made = await ask('PM', pm, 'POST', `${P}/rfi`, { subject: `${MARK} Design change to the inlet chamber — contractor and consultant only`, question: `${MARK} The consultant's revised reinforcement detail changes the price.`, priority: 'high', ownerPartyId: s.party.contractor.id, reviewerPartyId: s.party.consultant.id });
    if (made.status !== 201) throw new Error(`the PM could not raise the RFI: ${made.status} ${made.text}`);
    row = await find();
  }
  const rfiId = row.recordId;
  const rfi = await pm.GET(`${P}/rfi/${rfiId}`);
  line(`  RFI ${rfi.ref} ${rfiId}: owner party ${rfi.ownerPartyId}, reviewer party ${rfi.reviewerPartyId}; SUB-B's party is ${s.party.subB.id}`);
  const submittals = listOf((await pm.send('GET', `${P}/doc-control/register?recordType=submittal`)).body?.data);
  const submittalId = submittals[0]?.recordId || null;
  line(`  submittal ${submittals[0]?.ref} ${submittalId} (one of ${submittals.length} on the project)`);

  head('controls — the routed lists');
  const rfiList = listOf((await ask('SUB-B', subB, 'GET', `${P}/rfi?limit=100`)).body?.data);
  const subList = listOf((await ask('SUB-B', subB, 'GET', `${P}/submittals?limit=100`)).body?.data);
  line(`  SUB-B's RFI list: ${rfiList.length} row(s); the RFI among them: ${rfiList.some((item) => item.id === rfiId)}`);
  line(`  SUB-B's submittal list: ${subList.length} row(s); the submittal among them: ${subList.some((item) => item.id === submittalId)}`);

  head('the same records, asked for by id');
  const detail = await ask('SUB-B', subB, 'GET', `${P}/rfi/${rfiId}`);
  if (detail.status === 200) line(`      SUB-B reads: subject "${detail.body.data.subject}", question "${String(detail.body.data.question).slice(0, 90)}…", ${(detail.body.data.responses || []).length} response(s)`);
  const responses = await ask('SUB-B', subB, 'GET', `${P}/rfi/${rfiId}/responses`);
  const wrote = await ask('SUB-B', subB, 'POST', `${P}/rfi/${rfiId}/responses`, { body: `${LEAD} a response written by a party this RFI is not routed to` });
  // What the PM sees afterwards is the proof that the write landed; every response this script ever wrote is then removed.
  const asPm = listOf((await pm.send('GET', `${P}/rfi/${rfiId}/responses`)).body?.data);
  const mineOnRfi = asPm.filter((item) => String(item.body || '').startsWith(LEAD));
  line(`      the PM now sees ${asPm.length} response(s) on the RFI; written by SUB-B (${subB.email}): ${mineOnRfi.filter((item) => item.author?.email === subB.email).length}`);
  for (const item of mineOnRfi) {
    const removed = await subB.send('DELETE', `${P}/rfi/${rfiId}/responses/${item.id}`);
    line(`      (clean-up) SUB-B deletes its response ${item.id}: ${removed.status}`);
  }
  let subDetail = { status: null };
  let packages = { status: null };
  if (submittalId) {
    subDetail = await ask('SUB-B', subB, 'GET', `${P}/submittals/${submittalId}`);
    if (subDetail.status === 200) line(`      SUB-B reads: title "${subDetail.body.data.title}", status ${subDetail.body.data.status}, ${(subDetail.body.data.reviewSteps || []).length} review step(s)`);
    packages = await ask('SUB-B', subB, 'GET', `${P}/submittals/packages`);
    line(`      submittal packages given to SUB-B: ${listOf(packages.body?.data).length}`);
  }

  head('summary');
  const read = detail.status === 200 || responses.status === 200 || subDetail.status === 200;
  const written = wrote.status === 201;
  const packagesSeen = listOf(packages.body?.data).length > 0;
  line(`  RFI detail ${detail.status}; RFI responses ${responses.status}; response written ${wrote.status}; submittal detail ${subDetail.status}; packages listed ${packagesSeen}`);
  if (read || written || packagesSeen) {
    return verdict(LEAD, 'CONFIRMED', `a subcontractor party reads by id an RFI and a submittal that its own lists withhold (RFI detail ${detail.status}, responses ${responses.status}, submittal detail ${subDetail.status})${written ? ' and writes a response on the RFI (201)' : ''}.`);
  }
  return verdict(LEAD, 'NOT_REPRODUCED', 'every by-id RFI and submittal route refused the party the record is not routed to.');
});
