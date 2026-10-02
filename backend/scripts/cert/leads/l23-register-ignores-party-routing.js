'use strict';

/**
 * L23 — the document register and the revision download ignore the party
 * routing of RFIs and submittals.
 *
 * Stage: company 041, project 041-01 (see _files-fixture.js).
 *
 *   1. The PM raises an RFI routed between the contractor party and the
 *      consultant party, and files a revision (a PDF) on it.
 *   2. SUB-B — a subcontractor party that the RFI is not routed to — asks for
 *      its RFI and submittal lists (the controls: the routed lists).
 *   3. SUB-B asks for the document register and the dashboard.
 *   4. SUB-B downloads and previews the revision file.
 *
 * Exit code 0 when the register shows SUB-B only what is routed to it and the
 * revision file is refused; 2 otherwise.
 */

const { ask, fetchFile, head, line, listOf, main, pdfFile, sha, stage, verdict, whoIs } = require('./_files-fixture');

const MARK = 'CERT-L23';
const strip = (url) => String(url || '').replace(/^\/api\/v1/, '');

main(async () => {
  const s = await stage();
  const { P, pm, subB } = s;
  if (!s.party.contractor || !s.party.consultant) throw new Error('project 041-01 has no contractor or consultant party');

  head('who is who on project 041-01');
  await whoIs(pm, P, subB.email);
  line(`  contractor party ${s.party.contractor.id} (${s.party.contractor.company?.name}); consultant party ${s.party.consultant.id} (${s.party.consultant.company?.name}); SUB-B party ${s.party.subB.id}`);

  // ── 1. an RFI routed between contractor and consultant, with a revision file ─
  head('1. the PM raises an RFI routed contractor -> consultant and files a revision');
  const registerRow = async (session) => listOf((await session.send('GET', `${P}/doc-control/register?recordType=rfi&search=${MARK}`)).body?.data).find((row) => String(row.title || '').startsWith(MARK)) || null;
  let row = await registerRow(pm);
  if (!row) {
    const made = await ask('PM', pm, 'POST', `${P}/rfi`, {
      subject: `${MARK} Design change to the inlet chamber — contractor and consultant only`,
      question: `${MARK} The consultant's revised reinforcement detail changes the price. Confirm before we instruct anyone.`,
      priority: 'high',
      ownerPartyId: s.party.contractor.id,
      reviewerPartyId: s.party.consultant.id,
    });
    if (made.status !== 201) throw new Error(`the PM could not raise the RFI: ${made.status} ${made.text}`);
    row = await registerRow(pm);
  }
  const rfiId = row.recordId;
  const rfi = (await pm.GET(`${P}/rfi/${rfiId}`)) || {};
  line(`  RFI ${rfiId} ${rfi.ref}: ownerPartyId=${rfi.ownerPartyId} reviewerPartyId=${rfi.reviewerPartyId} (neither is SUB-B's party ${s.party.subB.id})`);

  // The PM's own revision "A" — other scripts may have filed further revisions on the same RFI.
  const pick = (item) => item.revision === 'A' && item.downloadUrl;
  let revision = (row.revisions || []).find(pick);
  if (!revision) {
    const secret = `${MARK}-SECRET-${Date.now()}`;
    const out = await pm.upload('POST', `${P}/doc-control/rfi/${rfiId}/revisions/upload`, { field: 'file', ...pdfFile(secret, ['Revised reinforcement detail with the agreed price', secret]), fields: { revision: 'A', title: `${MARK} revised detail` } });
    line(`  [PM] POST ${P}/doc-control/rfi/${rfiId}/revisions/upload -> 201 revision ${out?.revision?.id}`);
    row = await registerRow(pm);
    revision = (row.revisions || []).find(pick);
  }
  if (!revision) throw new Error('the RFI has no revision with a file');
  const real = await fetchFile('PM', pm, strip(revision.downloadUrl));
  if (!real.buffer) throw new Error('the PM could not download the revision');
  const wanted = sha(real.buffer);
  line(`  revision ${revision.id} "${revision.revision}", document ${revision.projectDocumentId}, sha256 ${wanted.slice(0, 16)}…`);

  // ── 2. the controls: the routed lists ────────────────────────────────────
  head('2. controls — what the routed lists give SUB-B');
  const rfiList = listOf((await ask('SUB-B', subB, 'GET', `${P}/rfi?limit=100`)).body?.data);
  const submittalList = listOf((await ask('SUB-B', subB, 'GET', `${P}/submittals?limit=100`)).body?.data);
  line(`  SUB-B's RFI list: ${rfiList.length} row(s), the routed RFI among them: ${rfiList.some((item) => item.id === rfiId)}`);
  line(`  SUB-B's submittal list: ${submittalList.length} row(s)`);
  const allRfis = listOf((await pm.send('GET', `${P}/doc-control/register?recordType=rfi`)).body?.data).length;
  const allSubmittals = listOf((await pm.send('GET', `${P}/doc-control/register?recordType=submittal`)).body?.data).length;
  line(`  the project has ${allRfis} RFI(s) and ${allSubmittals} submittal(s) in the PM's register`);

  // ── 3. the register and the dashboard ────────────────────────────────────
  head('3. SUB-B asks for the document register');
  const regRfi = await ask('SUB-B', subB, 'GET', `${P}/doc-control/register?recordType=rfi`);
  const regRfiRows = listOf(regRfi.body?.data);
  const seen = regRfiRows.find((item) => item.recordId === rfiId) || null;
  line(`  register (rfi) gives SUB-B ${regRfiRows.length} row(s); its routed list gave ${rfiList.length}`);
  if (seen) {
    const rev = (seen.revisions || []).find((item) => item.downloadUrl);
    line(`  the routed RFI is listed: title "${seen.title}", status ${seen.status}, owner ${JSON.stringify(seen.owner)}, reviewer ${JSON.stringify(seen.reviewer)}`);
    line(`  with revision "${rev?.revision}", fileName ${rev?.fileName}, downloadUrl ${rev?.downloadUrl}`);
  }
  const regSub = await ask('SUB-B', subB, 'GET', `${P}/doc-control/register?recordType=submittal`);
  const regSubRows = listOf(regSub.body?.data);
  line(`  register (submittal) gives SUB-B ${regSubRows.length} row(s); its routed list gave ${submittalList.length}`);
  const dash = await ask('SUB-B', subB, 'GET', `${P}/doc-control/dashboard`);
  line(`  dashboard metrics for SUB-B: ${JSON.stringify(dash.body?.data?.metrics || null)}`);

  // ── 4. the revision file ─────────────────────────────────────────────────
  head('4. SUB-B downloads and previews the revision file');
  const download = await fetchFile('SUB-B', subB, `${P}/doc-control/revisions/${revision.id}/download`);
  const preview = await fetchFile('SUB-B', subB, `${P}/doc-control/revisions/${revision.id}/preview`);
  const doorA = await fetchFile('SUB-B', subB, `${P}/attachments/documents/${revision.projectDocumentId}`);
  const got = (res) => Boolean(res.buffer) && sha(res.buffer) === wanted;
  line(`  download served the bytes: ${got(download)}; preview: ${got(preview)}; /attachments/documents: ${got(doorA)}`);

  head('summary');
  const listed = Boolean(seen);
  const registerWide = regRfiRows.length > rfiList.length || regSubRows.length > submittalList.length;
  const served = got(download) || got(preview) || got(doorA);
  line(`  the register lists the RFI that is not routed to SUB-B: ${listed}`);
  line(`  the register gives SUB-B more RFIs/submittals than its routed lists: ${registerWide} (RFI ${regRfiRows.length} vs ${rfiList.length}; submittal ${regSubRows.length} vs ${submittalList.length})`);
  line(`  the revision file is served to SUB-B: ${served}`);

  if (listed && served) return verdict('L23', 'CONFIRMED', `a subcontractor party sees every RFI and submittal of the project in the document register (${regRfiRows.length} RFIs, ${regSubRows.length} submittals; its routed lists give ${rfiList.length} and ${submittalList.length}) and downloads the revision file of an RFI routed between two other parties.`);
  if (listed || registerWide || served) return verdict('L23', 'PARTLY_CONFIRMED', `register lists the unrouted RFI: ${listed}; register wider than the routed lists: ${registerWide}; revision file served: ${served}.`);
  return verdict('L23', 'NOT_REPRODUCED', 'the register gives a party only the records routed to it and the revision file is refused.');
});
