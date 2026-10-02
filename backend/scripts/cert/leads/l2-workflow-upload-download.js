'use strict';

/**
 * L2 — GET /projects/:pid/workflow/uploads/:key serves any workflow document
 * of the project to anyone with project access, and GET /projects/:pid/jobs
 * publishes the document ids.
 *
 * Stage: company 041, project 041-01 (see _files-fixture.js).
 *
 *   1. SUB-A raises an RFI (it is routed to SUB-A's party) and attaches a PDF.
 *   2. SUB-B — another subcontractor party — is refused the RFI, its attachment
 *      list and the document through /attachments/documents (the controls).
 *   3. SUB-B reads the document's id from the jobs list and downloads the
 *      document through /workflow/uploads.
 *   4. The same door, for SUB-B and for the site engineer, against another
 *      subcontractor's executed agreement and lien waiver.
 *   5. An API key with a single unrelated scope through the same door.
 *   6. Control: somebody from another company (031) is refused.
 *
 * Exit code 0 when every forbidden download is refused, 2 when one is served.
 */

const { as, ask, askWithKey, fetchFile, head, line, listOf, main, pdfFile, sha, stage, verdict, whoIs, projectId } = require('./_files-fixture');

const MARK = 'CERT-L2';

main(async () => {
  const s = await stage();
  const { P, pm, subA, subB, site } = s;

  head('who is who on project 041-01');
  await whoIs(pm, P, subA.email);
  await whoIs(pm, P, subB.email);
  await whoIs(pm, P, site.email);
  line(`  SUB-A party ${s.party.subA.id} (${s.party.subA.company?.name}); SUB-B party ${s.party.subB.id} (${s.party.subB.company?.name})`);

  // ── 1. SUB-A's RFI and its attachment ───────────────────────────────────
  head('1. SUB-A raises an RFI and attaches a PDF');
  const mine = listOf((await ask('SUB-A', subA, 'GET', `${P}/rfi`)).body?.data);
  let rfi = mine.find((row) => String(row.subject || '').startsWith(MARK));
  if (!rfi) {
    const made = await ask('SUB-A', subA, 'POST', `${P}/rfi`, {
      subject: `${MARK} Formwork striking times — private to Sub A`,
      question: `${MARK} When may the soffit formwork on level 2 be struck? Our rates depend on the answer.`,
      priority: 'normal',
    });
    if (made.status !== 201) throw new Error(`SUB-A could not raise the RFI: ${made.status} ${made.text}`);
    rfi = made.body.data;
  }
  line(`  RFI ${rfi.id} ${rfi.ref || ''} ownerPartyId=${rfi.ownerPartyId} (SUB-A's party: ${rfi.ownerPartyId === s.party.subA.id})`);

  // The attachment must be linked to the RFI and to nothing else: a document that is also filed as a
  // document-control revision is readable under document control (that is lead L23, not this one).
  const filedAsRevision = new Set(
    listOf((await pm.send('GET', `${P}/doc-control/register?recordType=rfi&search=${MARK}`)).body?.data)
      .flatMap((row) => row.revisions || [])
      .map((revision) => revision.projectDocumentId)
      .filter(Boolean),
  );
  const idOf = (link) => link.documentId || link.document?.id;
  let links = listOf((await ask('SUB-A', subA, 'GET', `${P}/attachments?recordType=rfi&recordId=${rfi.id}`)).body?.data).filter((link) => !filedAsRevision.has(idOf(link)));
  if (!links.length) {
    const secret = `${MARK}-SECRET-${Date.now()}`;
    const out = await subA.upload('POST', `${P}/attachments`, { field: 'files', ...pdfFile(secret, ['Sub A method statement and rates', secret]), fields: { recordType: 'rfi', recordId: rfi.id, caption: `${MARK} method statement` } });
    line(`  [SUB-A] POST ${P}/attachments (recordType=rfi) -> 201, ${listOf(out).length} attachment(s)`);
    links = listOf(out);
  }
  const documentId = idOf(links[0]);
  if (!documentId) throw new Error('the attachment came back without a document id');
  const original = await fetchFile('SUB-A', subA, `${P}/attachments/documents/${documentId}`);
  if (!original.buffer) throw new Error('SUB-A could not download its own attachment');
  const wanted = sha(original.buffer);
  line(`  document ${documentId}, ${original.buffer.length} bytes, sha256 ${wanted.slice(0, 16)}…`);

  // ── 2. the controls: SUB-B is refused everywhere the record rule is asked ─
  head('2. controls — SUB-B asks for the record, its attachments and the document');
  const rfiAsB = await ask('SUB-B', subB, 'GET', `${P}/rfi/${rfi.id}`);
  const listAsB = await ask('SUB-B', subB, 'GET', `${P}/attachments?recordType=rfi&recordId=${rfi.id}`);
  const doorA = await fetchFile('SUB-B', subB, `${P}/attachments/documents/${documentId}`);
  const rfiListAsB = listOf((await ask('SUB-B', subB, 'GET', `${P}/rfi`)).body?.data);
  line(`  SUB-B's own RFI list has ${rfiListAsB.length} row(s); SUB-A's RFI among them: ${rfiListAsB.some((row) => row.id === rfi.id)}`);
  const controlsHold = listAsB.status === 404 && doorA.status === 404;

  // ── 3. the id from the jobs list, the bytes from /workflow/uploads ────────
  head('3. SUB-B reads the id from the jobs list and downloads through /workflow/uploads');
  const jobsAsB = await ask('SUB-B', subB, 'GET', `${P}/jobs?type=document.extract&limit=100`);
  const jobIds = [...new Set(listOf(jobsAsB.body?.data).map((job) => job.payload?.documentId).filter(Boolean))];
  const idPublished = jobIds.includes(documentId);
  line(`  the jobs list gives SUB-B ${jobIds.length} distinct document id(s); SUB-A's document among them: ${idPublished}`);
  const doorB = await fetchFile('SUB-B', subB, `${P}/workflow/uploads/${documentId}`);
  const served = Boolean(doorB.buffer) && sha(doorB.buffer) === wanted;
  line(`  same bytes as SUB-A's attachment: ${served}`);

  // ── 4. another subcontractor's executed agreement and lien waiver ────────
  head("4. Concrete Works' executed subcontract and lien waiver");
  const commitments = listOf(await pm.GET(`${P}/commitments`));
  const executed = commitments.find((row) => row.type === 'subcontract' && row.executedDocument?.id && /Concrete Works/.test(row.vendorCompany?.name || row.vendor?.name || ''))
    || commitments.find((row) => row.executedDocument?.id);
  const payApps = listOf(await pm.GET(`${P}/pay-apps`));
  const waiver = payApps.find((row) => row.waiverDocumentId);
  const others = [];
  if (executed) others.push({ what: `executed agreement of commitment #${executed.number} (${executed.vendorCompany?.name || executed.vendor?.name || executed.vendorCompanyId})`, record: `${P}/commitments/${executed.id}`, documentId: executed.executedDocument.id });
  else line('  (no executed commitment on the project; this variant is skipped)');
  if (waiver) others.push({ what: `lien waiver of payment application ${waiver.id}`, record: `${P}/pay-apps/${waiver.id}`, documentId: waiver.waiverDocumentId });
  else line('  (no payment application with a waiver; this variant is skipped)');

  const variants = [];
  for (const other of others) {
    const real = await fetchFile('PM', pm, `${P}/workflow/uploads/${other.documentId}`);
    const realSha = real.buffer ? sha(real.buffer) : null;
    line(`  ${other.what}: document ${other.documentId}`);
    for (const [label, session] of [['SUB-B', subB], ['SITE ENGINEER', site]]) {
      const record = await ask(label, session, 'GET', other.record);
      const jobs = await session.send('GET', `${P}/jobs?type=document.extract&limit=100`);
      const published = listOf(jobs.body?.data).some((job) => job.payload?.documentId === other.documentId);
      line(`      the jobs list gives ${label} this document id: ${published}`);
      const file = await fetchFile(label, session, `${P}/workflow/uploads/${other.documentId}`);
      variants.push({ label, what: other.what, recordStatus: record.status, published, served: Boolean(file.buffer) && sha(file.buffer) === realSha });
    }
  }

  // ── 5. an API key with one unrelated scope ───────────────────────────────
  head('5. an API key whose only scope is inventory:read');
  let keyServed = null;
  // The answer carries the key's secret, so it is not printed: only the status and what the key may do.
  const created = await pm.send('POST', '/integrations/api-clients', { name: `${MARK} inventory-only key ${Date.now()}`, scopes: ['inventory:read'], projectIds: [s.pid] });
  line(`  [PM (company admin)] POST /integrations/api-clients { scopes: ["inventory:read"], projectIds: [041-01] }`);
  line(`      -> ${created.status} scopes=${JSON.stringify(created.body?.data?.scopes || null)} owner=${created.body?.data?.owner?.email || ''} (the secret is not printed)`);
  const token = created.body?.data?.token || created.body?.data?.key || created.body?.data?.secret;
  if (created.status === 201 && token) {
    try {
      const keyDoorA = await askWithKey('API KEY inventory:read', token, 'GET', `${P}/attachments/documents/${documentId}`);
      const keyJobs = await askWithKey('API KEY inventory:read', token, 'GET', `${P}/jobs?type=document.extract&limit=100`);
      const keyDoorB = await askWithKey('API KEY inventory:read', token, 'GET', `${P}/workflow/uploads/${documentId}`);
      keyServed = Boolean(keyDoorB.buffer) && sha(keyDoorB.buffer) === wanted;
      line(`  control /attachments/documents refused the key: ${keyDoorA.status !== 200}; the jobs list answered ${keyJobs.status}; /workflow/uploads served the key the bytes: ${keyServed}`);
    } finally {
      const revoked = await pm.send('DELETE', `/integrations/api-clients/${created.body.data.id}`);
      line(`  key revoked: ${revoked.status}`);
    }
  } else {
    line(`  the key could not be made (${created.status}); this variant is not tested`);
  }

  // ── 6. control: another company ──────────────────────────────────────────
  head('6. control — company 031 asks for the same document');
  const stranger = as('pm@c031.octapm-cert.test');
  const cross1 = await fetchFile('PM of 031', stranger, `${P}/workflow/uploads/${documentId}`);
  const cross2 = await fetchFile('PM of 031', stranger, `/projects/${projectId('031', '031-01')}/workflow/uploads/${documentId}`);
  const crossCompany = Boolean(cross1.buffer) || Boolean(cross2.buffer);

  // ── the answer ───────────────────────────────────────────────────────────
  head('summary');
  line(`  controls (record rule on /attachments): ${controlsHold ? 'hold' : 'DO NOT HOLD'}; RFI detail to SUB-B: ${rfiAsB.status}`);
  line(`  SUB-B downloads SUB-A's RFI attachment through /workflow/uploads: ${served} (id published by the jobs list: ${idPublished})`);
  for (const v of variants) line(`  ${v.label}: record ${v.recordStatus}, id published ${v.published}, ${v.what} served: ${v.served}`);
  line(`  API key with inventory:read only served: ${keyServed === null ? 'not tested' : keyServed}`);
  line(`  another company served: ${crossCompany}`);

  const anyServed = served || variants.some((v) => v.served) || keyServed === true;
  const anyPublished = idPublished || variants.some((v) => v.published);
  if (crossCompany) return verdict('L2', 'CONFIRMED', 'the document was served to a different company — worse than the lead.');
  if (anyServed) {
    return verdict('L2', 'CONFIRMED', `/workflow/uploads/:key serves workflow documents the caller is refused everywhere else (another party's RFI attachment${variants.some((v) => v.served) ? ', an executed subcontract, a lien waiver' : ''}${keyServed ? ', and to an API key with an unrelated scope' : ''}); the jobs list ${anyPublished ? 'hands out the ids' : 'did not show the ids this time'}; the company boundary holds.`);
  }
  if (anyPublished) return verdict('L2', 'PARTLY_CONFIRMED', 'the download is refused, but the jobs list still gives a party the ids of documents it may not read.');
  return verdict('L2', 'NOT_REPRODUCED', 'every forbidden download was refused and the jobs list did not give the ids.');
});
