'use strict';

/**
 * Extra finding FILES-X2 (found while reproducing L23) — filing a document
 * revision checks neither the party routing of the record nor the status the
 * caller asks for:
 *
 *   (1) SUB-B files a revision on an RFI routed between two other parties;
 *   (2) SUB-A — who may submit revisions but not approve them — files a
 *       revision on its own RFI with status "approved".
 *
 * Stage: company 041, project 041-01 (see _files-fixture.js); the RFIs are
 * those of L23 and L2, made here when absent. Each run adds one revision per
 * test (a revision cannot be deleted through the API).
 *
 * Exit code 0 when (1) is refused and (2) is refused or stored unapproved, 2 otherwise.
 */

const { ask, head, line, listOf, main, pdfFile, stage, verdict, whoIs } = require('./_files-fixture');

const LEAD = 'FILES-X2';

main(async () => {
  const s = await stage();
  const { P, pm, subA, subB } = s;
  const stamp = Date.now().toString(36).toUpperCase();

  head('who is who on project 041-01');
  await whoIs(pm, P, subA.email);
  await whoIs(pm, P, subB.email);

  // The RFI routed contractor -> consultant (L23's), and SUB-A's own RFI (L2's).
  const registerRow = async (mark) => listOf((await pm.send('GET', `${P}/doc-control/register?recordType=rfi&search=${mark}`)).body?.data).find((row) => String(row.title || '').startsWith(mark)) || null;
  let routed = await registerRow('CERT-L23');
  if (!routed) {
    await pm.POST(`${P}/rfi`, { subject: 'CERT-L23 Design change to the inlet chamber — contractor and consultant only', question: 'CERT-L23 The consultant\'s revised reinforcement detail changes the price.', priority: 'high', ownerPartyId: s.party.contractor.id, reviewerPartyId: s.party.consultant.id });
    routed = await registerRow('CERT-L23');
  }
  let own = await registerRow('CERT-L2 ');
  if (!own) {
    await subA.POST(`${P}/rfi`, { subject: 'CERT-L2 Formwork striking times — private to Sub A', question: 'CERT-L2 When may the soffit formwork on level 2 be struck?', priority: 'normal' });
    own = await registerRow('CERT-L2 ');
  }

  // ── (1) a revision on a record routed between two other parties ──────────
  head('(1) SUB-B files a revision on an RFI that is not routed to it');
  const routedRfi = await pm.GET(`${P}/rfi/${routed.recordId}`);
  line(`  RFI ${routedRfi.ref}: owner party ${routedRfi.ownerPartyId}, reviewer party ${routedRfi.reviewerPartyId}; SUB-B's party ${s.party.subB.id}`);
  const listed = listOf((await subB.send('GET', `${P}/rfi?limit=100`)).body?.data).some((row) => row.id === routed.recordId);
  line(`  control: the RFI is in SUB-B's own RFI list: ${listed}`);
  const labelB = `X2B-${stamp}`;
  const filed = await ask('SUB-B', subB, 'POST', `${P}/doc-control/rfi/${routed.recordId}/revisions/upload`, undefined, {
    form: (() => {
      const form = new FormData();
      const file = pdfFile(`${LEAD}-${labelB}`, [`${LEAD} a revision filed by a party the RFI is not routed to`, labelB]);
      form.append('revision', labelB);
      form.append('notes', `${LEAD} filed by SUB-B`);
      form.append('file', new Blob([file.body], { type: file.contentType }), file.filename);
      return form;
    })(),
  });
  const afterB = await registerRow('CERT-L23');
  const landedB = (afterB?.revisions || []).find((item) => item.revision === labelB) || null;
  line(`  the PM's register now shows revision "${labelB}" on ${routedRfi.ref}: ${Boolean(landedB)}${landedB ? ` (status ${landedB.status}, issuedBy ${landedB.issuedBy})` : ''}; revisions on the record: ${(afterB?.revisions || []).length}`);

  // ── (2) a revision filed as "approved" by someone who may not approve ────
  head('(2) SUB-A files a revision on its own RFI with status "approved"');
  const approveProbe = await ask('SUB-A', subA, 'POST', `${P}/doc-control/revisions/00000000-0000-4000-8000-000000000000/approve`, { comment: 'probe' }, { note: 'control, may SUB-A approve a revision at all' });
  const labelA = `X2A-${stamp}`;
  // A fresh file each time: linking one of the RFI's existing attachments as a
  // revision would change who may read that attachment (see L23), and L2 uses them.
  const self = await ask('SUB-A', subA, 'POST', `${P}/doc-control/rfi/${own.recordId}/revisions/upload`, undefined, {
    form: (() => {
      const form = new FormData();
      const file = pdfFile(`${LEAD}-${labelA}`, [`${LEAD} a revision filed as approved by a submitter`, labelA]);
      form.append('revision', labelA);
      form.append('status', 'approved');
      form.append('notes', `${LEAD} filed as approved by SUB-A`);
      form.append('file', new Blob([file.body], { type: file.contentType }), file.filename);
      return form;
    })(),
  });
  const afterA = await registerRow('CERT-L2 ');
  const landedA = (afterA?.revisions || []).find((item) => item.revision === labelA) || null;
  line(`  the PM's register now shows revision "${labelA}": ${Boolean(landedA)}${landedA ? ` (status ${landedA.status}, approvedBy ${landedA.approvedBy}, isLatest ${landedA.isLatest})` : ''}`);
  line(`  the record's "latest revision" in the PM's register: "${afterA?.latestRevision?.revision}" status ${afterA?.latestRevision?.status}`);

  head('summary');
  const partyHole = filed.status === 201 && Boolean(landedB);
  const statusHole = self.status === 201 && landedA?.status === 'approved';
  line(`  (1) revision filed on an unrouted RFI: ${filed.status} -> landed ${Boolean(landedB)}`);
  line(`  (2) approve route for SUB-A: ${approveProbe.status}; revision filed as approved: ${self.status} -> stored status ${landedA?.status ?? 'n/a'}`);
  if (partyHole || statusHole) {
    return verdict(LEAD, partyHole && statusHole ? 'CONFIRMED' : 'PARTLY_CONFIRMED', `${partyHole ? 'a subcontractor party files a revision on an RFI routed between two other parties (201)' : 'the unrouted record is refused'}; ${statusHole ? `a caller who is refused the approve route (${approveProbe.status}) files a revision already "approved" (201)` : 'a revision cannot be filed as approved without the approve right'}.`);
  }
  return verdict(LEAD, 'NOT_REPRODUCED', 'a revision on an unrouted record is refused and a revision cannot be filed as approved without the approve right.');
});
