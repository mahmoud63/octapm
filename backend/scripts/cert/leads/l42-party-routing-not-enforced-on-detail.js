'use strict';

/**
 * L42 (D-09) — Party routing not enforced on RFI / submittal detail, thread,
 * export, AI and package endpoints.
 *
 * Actors, all guests on project 072-01:
 *   SUB-X  subcontractor company X      (the reader / attacker)
 *   SUB-Y  subcontractor company Y      (the owner of the records)
 *   CONS   the consultant               (holds rfi.answer; not routed on Y's RFI)
 *
 * The product's rule, as its lists and its update route apply it: a party
 * member reads and changes an RFI or submittal only when it is routed to
 * their company (owner / reviewer / approver party) —
 * applyPartyWorkflowVisibility and assertPartyWorkflowAccess.
 *
 * Exit code 0 = every by-id endpoint refuses SUB-X on Y's records; 2 = any
 * of them answers.
 */

const pv = require('./lib/party-visibility');

const stamp = () => new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const RFI_SUBJECT = 'PV L42 company Y query (cert leads)';
const RFI_SECRET = 'CONFIDENTIAL-Y: our rate for the remedial works is 1,234 per m3';
const SUB_TITLE = 'PV L42 company Y shop drawing (cert leads)';
const PKG_NAME = 'PV L42 company Y package (cert leads)';

pv.main(async () => {
  const s = await pv.setup();
  const P = s.projectId;
  const tag = stamp();
  const leaks = [];
  const controls = [];
  const notes = [];

  console.log('L42 — records of subcontractor Y, as reached by a guest of subcontractor X');
  console.log(`project ${P} (072-01); X = ${s.subX.email}; Y = ${s.subY.email}; consultant = ${s.consultant.email}`);

  // ── set-up: Y's RFI with a thread, Y's submittal in Y's package ───────────
  console.log('\n=== Set-up: company Y raises an RFI and a submittal; the PM replies in the thread ===');
  const yRfis = (await s.subY.GET(`/projects/${P}/rfi?limit=100`)).rows || [];
  let rfi = yRfis.find((r) => r.subject === RFI_SUBJECT && r.status === 'open');
  if (!rfi) rfi = await s.subY.POST(`/projects/${P}/rfi`, { subject: RFI_SUBJECT, question: RFI_SECRET, status: 'open' });
  const pmReply = await s.pm.send('POST', `/projects/${P}/rfi/${rfi.id}/responses`, { body: `PM reply ${tag}: noted, hold the rate until the variation is agreed.` });
  const thread = (await s.pm.GET(`/projects/${P}/rfi/${rfi.id}/responses`)).items || [];
  const pmResponse = thread.filter((r) => String(r.body || '').startsWith(`PM reply ${tag}`)).pop();
  console.log(`  RFI ${rfi.ref} ${rfi.id} ownerPartyId=${rfi.ownerPartyId} (Y's party ${s.parties.subcontractorY}); PM reply ${pmReply.status} ${pmResponse?.id}`);

  const ySubs = (await s.subY.GET(`/projects/${P}/submittals?limit=100`)).rows || [];
  let submittal = ySubs.find((r) => r.title === SUB_TITLE);
  if (!submittal) submittal = await s.subY.POST(`/projects/${P}/submittals`, { title: SUB_TITLE, specRef: 'Y-ONLY-03 30 00' });
  const packages = (await s.pm.GET(`/projects/${P}/submittals/packages`)).items || [];
  let pkg = packages.find((p) => p.name === PKG_NAME);
  if (!pkg) pkg = await s.subY.POST(`/projects/${P}/submittals/packages`, { name: PKG_NAME, description: 'Y only', submittalIds: [submittal.id] });
  console.log(`  submittal ${submittal.ref} ${submittal.id} ownerPartyId=${submittal.ownerPartyId}; package ${pkg.ref || pkg.number} ${pkg.id}`);

  // ── controls: where the rule is applied ───────────────────────────────────
  console.log('\n=== Controls: the list and the update route apply the party rule ===');
  const xList = await pv.show(s.subX, 'SUB-X', 'GET', `/projects/${P}/rfi?limit=100`, undefined, { pick: (b) => ({ refs: (b?.data?.rows || []).map((r) => r.ref), containsY: (b?.data?.rows || []).some((r) => r.id === rfi.id) }) });
  const listHidesY = xList.status === 200 && !(xList.body?.data?.rows || []).some((r) => r.id === rfi.id);
  controls.push(`RFI list hides Y's RFI from X: ${listHidesY}`);
  const xPatch = await pv.show(s.subX, 'SUB-X', 'PATCH', `/projects/${P}/rfi/${rfi.id}`, { discipline: 'X was here' });
  controls.push(`PATCH Y's RFI as X: ${xPatch.status} ${xPatch.body?.error?.code || ''}`);
  const xSubList = await pv.show(s.subX, 'SUB-X', 'GET', `/projects/${P}/submittals?limit=100`, undefined, { pick: (b) => ({ refs: (b?.data?.rows || []).map((r) => r.ref), containsY: (b?.data?.rows || []).some((r) => r.id === submittal.id) }) });
  controls.push(`submittal list hides Y's submittal from X: ${xSubList.status === 200 && !(xSubList.body?.data?.rows || []).some((r) => r.id === submittal.id)}`);

  // ── RFI by id ─────────────────────────────────────────────────────────────
  console.log('\n=== RFI detail, thread and thread writes ===');
  const detail = await pv.show(s.subX, 'SUB-X', 'GET', `/projects/${P}/rfi/${rfi.id}`, undefined, {
    pick: (b) => (b?.data ? { ref: b.data.ref, subject: b.data.subject, question: b.data.question, ownerPartyId: b.data.ownerPartyId, responses: (b.data.responses || []).map((r) => ({ author: r.author?.name || r.authorName, body: String(r.body).slice(0, 60) })), manager: b.data.manager, assignees: b.data.assignees } : b),
  });
  if (detail.status === 200 && detail.body?.data?.question === RFI_SECRET) leaks.push(`GET rfi/:id → 200 with Y's question ("${RFI_SECRET.slice(0, 30)}…") and ${detail.body.data.responses?.length || 0} response(s)`);
  const responses = await pv.show(s.subX, 'SUB-X', 'GET', `/projects/${P}/rfi/${rfi.id}/responses`, undefined, { pick: (b) => (b?.data?.items ? b.data.items.map((r) => ({ id: r.id, author: r.author, body: String(r.body).slice(0, 70), isOfficial: r.isOfficial })) : b) });
  if (responses.status === 200 && (responses.body?.data?.items || []).length) leaks.push(`GET rfi/:id/responses → 200 with ${(responses.body.data.items || []).length} thread entries and their authors`);
  const xWrite = await pv.show(s.subX, 'SUB-X', 'POST', `/projects/${P}/rfi/${rfi.id}/responses`, { body: `Company X writing in company Y's thread ${tag}` }, { pick: (b) => (b?.data ? { ref: b.data.ref, responses: (b.data.responses || []).length } : b) });
  if (xWrite.status === 201) {
    leaks.push('POST rfi/:id/responses → 201: X wrote a response into Y\'s RFI thread (and the RFI\'s people are notified)');
    const after = (await s.pm.GET(`/projects/${P}/rfi/${rfi.id}/responses`)).items || [];
    const mine = after.find((r) => String(r.body || '').includes(`Company X writing in company Y's thread ${tag}`));
    if (mine) {
      const edit = await pv.show(s.subX, 'SUB-X', 'PATCH', `/projects/${P}/rfi/${rfi.id}/responses/${mine.id}`, { body: `edited ${tag}` }, { pick: (b) => (b?.data ? { ref: b.data.ref } : b) });
      const remove = await pv.show(s.subX, 'SUB-X', 'DELETE', `/projects/${P}/rfi/${rfi.id}/responses/${mine.id}`);
      notes.push(`X edits (${edit.status}) and removes (${remove.status}) its response on Y's RFI`);
    }
  }
  const pdf = await pv.show(s.subX, 'SUB-X', 'GET', `/projects/${P}/rfi/${rfi.id}/export.pdf`, undefined, { max: 200 });
  notes.push(`export.pdf as X: ${pdf.status} ${pdf.body?.error?.details?.action ? `(needs rfi:${pdf.body.error.details.action}, which no party profile holds)` : ''}`);
  if (pdf.status === 200) leaks.push('GET rfi/:id/export.pdf → 200');
  const del = await pv.show(s.subX, 'SUB-X', 'DELETE', `/projects/${P}/rfi/${rfi.id}`, undefined, { max: 200 });
  notes.push(`DELETE rfi as X: ${del.status} (rfi:delete is held by the PM only)`);
  if (del.status === 200) leaks.push('DELETE rfi/:id → 200');

  // ── RFI assistant ─────────────────────────────────────────────────────────
  console.log('\n=== RFI assistant on Y\'s RFI (no AI key is configured: does the record check come first?) ===');
  const summary = await pv.show(s.subX, 'SUB-X', 'POST', `/projects/${P}/rfi/${rfi.id}/ai/summary`, {}, { max: 500 });
  const suggest = await pv.show(s.subX, 'SUB-X', 'POST', `/projects/${P}/rfi/${rfi.id}/ai/response`, {}, { max: 500 });
  for (const [name, res] of [['ai/summary', summary], ['ai/response', suggest]]) {
    const refusedForRecord = [403, 404].includes(res.status) && /PARTY|NOT_FOUND|FORBIDDEN/.test(res.body?.error?.code || '') && res.body?.error?.details?.module !== 'rfi';
    if (res.status === 200 || (!refusedForRecord && res.status !== 403)) leaks.push(`POST rfi/:id/${name} → ${res.status} ${res.body?.error?.code || (res.body?.data?.degraded ? '(degraded: reached the model step)' : '')}: Y's RFI was loaded for X before any party check`);
    else notes.push(`${name} as X: ${res.status} ${res.body?.error?.code || ''}`);
  }
  const similar = await pv.show(s.subX, 'SUB-X', 'GET', `/projects/${P}/rfi/ai/similar?q=${encodeURIComponent('company Y query remedial works rate')}`, undefined, { max: 600 });
  if (similar.status === 200 && JSON.stringify(similar.body).includes(rfi.id)) leaks.push('GET rfi/ai/similar → 200 listing Y\'s RFI');

  // ── official-answer flag ──────────────────────────────────────────────────
  console.log('\n=== Consultant (rfi.answer, not routed on Y\'s RFI) promotes a thread entry to the official answer ===');
  if (pmResponse?.id) {
    const before = ((await s.pm.GET(`/projects/${P}/rfi/${rfi.id}/responses`)).items || []).find((r) => r.id === pmResponse.id);
    const promote = await pv.show(s.consultant, 'CONSULTANT', 'POST', `/projects/${P}/rfi/${rfi.id}/responses/${pmResponse.id}/official`, {});
    const afterRows = await s.pm.GET(`/projects/${P}/rfi/${rfi.id}/responses`);
    const after = (afterRows.items || []).find((r) => r.id === pmResponse.id);
    const rfiNow = await s.pm.GET(`/projects/${P}/rfi/${rfi.id}`);
    console.log(`  response ${pmResponse.id}: isOfficial ${before?.isOfficial} → ${after?.isOfficial}; RFI status ${rfiNow.status}, officialResponseId ${rfiNow.officialResponseId}`);
    if (promote.status === 200) leaks.push('POST rfi/:id/responses/:id/official → 200: a consultant not routed on the RFI answered it');
    else if (after?.isOfficial === true && before?.isOfficial !== true) leaks.push(`POST rfi/:id/responses/:id/official → ${promote.status} ${promote.body?.error?.code}, yet the response is now flagged official while the RFI is still "${rfiNow.status}" (flags written before the party check)`);
    else notes.push(`official as consultant: ${promote.status} ${promote.body?.error?.code || ''}, flag unchanged`);
  }

  // ── submittal by id and packages ──────────────────────────────────────────
  console.log('\n=== Submittal detail and packages ===');
  const subDetail = await pv.show(s.subX, 'SUB-X', 'GET', `/projects/${P}/submittals/${submittal.id}`, undefined, { pick: (b) => (b?.data ? { ref: b.data.ref, title: b.data.title, specRef: b.data.specRef, ownerPartyId: b.data.ownerPartyId, status: b.data.status } : b) });
  if (subDetail.status === 200 && subDetail.body?.data?.id === submittal.id) leaks.push(`GET submittals/:id → 200 with Y's submittal ${subDetail.body.data.ref}`);
  const pkgList = await pv.show(s.subX, 'SUB-X', 'GET', `/projects/${P}/submittals/packages`, undefined, { max: 900, pick: (b) => (b?.data?.items ? b.data.items.map((p) => ({ id: p.id, name: p.name, items: (p.items || p.submittals || []).map((i) => `${i.ref} ${i.title}`) })) : b) });
  const yPkgSeen = (pkgList.body?.data?.items || []).find((p) => p.id === pkg.id);
  if (pkgList.status === 200 && yPkgSeen) leaks.push(`GET submittals/packages → 200 listing ${(pkgList.body.data.items || []).length} package(s), Y's included with its items`);
  const pkgDetail = await pv.show(s.subX, 'SUB-X', 'GET', `/projects/${P}/submittals/packages/${pkg.id}`, undefined, { max: 500 });
  if (pkgDetail.status === 200) leaks.push('GET submittals/packages/:id → 200 for Y\'s package');
  const pkgEdit = await pv.show(s.subX, 'SUB-X', 'PATCH', `/projects/${P}/submittals/packages/${pkg.id}`, { description: `edited by company X ${tag}` }, { max: 300 });
  if (pkgEdit.status === 200) leaks.push('PATCH submittals/packages/:id → 200: X edited Y\'s package');
  const pkgSteal = await pv.show(s.subX, 'SUB-X', 'POST', `/projects/${P}/submittals/packages`, { name: `PV L42 X takes Y's submittal ${tag}`, submittalIds: [submittal.id] }, { max: 500 });
  if (pkgSteal.status === 201) {
    const now = await s.pm.GET(`/projects/${P}/submittals/${submittal.id}`);
    const moved = now.packageId === pkgSteal.body?.data?.id || now.package?.id === pkgSteal.body?.data?.id;
    if (moved) leaks.push('POST submittals/packages {submittalIds:[Y\'s]} → 201: X moved Y\'s submittal into a package of its own');
    // put it back
    await s.pm.send('POST', `/projects/${P}/submittals/packages/${pkg.id}/items`, { submittalIds: [submittal.id] });
  }
  const subDel = await pv.show(s.subX, 'SUB-X', 'DELETE', `/projects/${P}/submittals/${submittal.id}`, undefined, { max: 200 });
  notes.push(`DELETE submittal as X: ${subDel.status} (submittal:delete is held by the PM only)`);

  console.log('\nSummary');
  for (const line of controls) console.log(`  control: ${line}`);
  for (const line of leaks) console.log(`  - ${line}`);
  for (const line of notes) console.log(`  note: ${line}`);

  if (leaks.length) {
    return pv.verdict('L42', leaks.length >= 3 ? 'CONFIRMED' : 'PARTLY_CONFIRMED', `a guest of subcontractor X reaches subcontractor Y's RFI and submittal by id although the lists hide them and the update route answers 403: ${leaks.length} endpoint(s) answered, reads and writes.`);
  }
  return pv.verdict('L42', 'NOT_REPRODUCED', 'every by-id endpoint refused the other company\'s guest.');
});
