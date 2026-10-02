'use strict';

/**
 * L24 — a file that is linked to its record outside the Attachment table
 * (the uploaded bill of quantities, an executed agreement, a lien waiver,
 * change-order evidence) counts as "unlinked", and an unlinked file is given
 * to anyone who can read document control: GET /attachments/documents/:id
 * serves it, GET /documents/:id/text opens its text, the content search
 * returns it.
 *
 *   (a) BOQ withholding — company 041, project 041-02 (an empty project).
 *       A site engineer whose permission template sets the BOQ tool to "none"
 *       is refused the bill and the upload's own route, and then asks for the
 *       same workbook as a document.
 *   (b) another party's executed agreement and lien waiver — project 041-01.
 *   (c) change-order evidence — project 041-01, for a subcontractor party and
 *       for the site engineer (neither may read change orders).
 *
 * The certification API runs without the job worker, so no document has
 * extracted text: the text route's authorisation is observable (200 or 403),
 * its content and the search hit are not.
 *
 * Exit code 0 when every forbidden document is refused, 2 when one is served.
 */

const { EMAIL, as, ask, fetchFile, head, line, listOf, main, pdfFile, projectId, sha, stage, userId, verdict, whoIs } = require('./_files-fixture');

const MARK = 'CERT-L24';
const WORD = 'CERTL24BILLMARKER';
const U_EMAIL = 'dina.mensah.14@c041.octapm-cert.test';
const TEMPLATE_NAME = `${MARK} site engineer without the BOQ`;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A small bill of quantities: the columns of the product's own template, three priced rows. */
const billWorkbook = async () => {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('BOQ');
  sheet.columns = [
    { header: 'Code', key: 'code' },
    { header: 'Description', key: 'description' },
    { header: 'Quantity', key: 'quantity' },
    { header: 'Unit', key: 'unit' },
    { header: 'Rate', key: 'rate' },
    { header: 'Amount', key: 'amount' },
  ];
  sheet.addRow({ code: 'L24.1', description: `${WORD} Bulk excavation`, quantity: 3500, unit: 'm3', rate: 22.75, amount: 79625 });
  sheet.addRow({ code: 'L24.2', description: `${WORD} Reinforced concrete foundation`, quantity: 450, unit: 'm3', rate: 351.5, amount: 158175 });
  sheet.addRow({ code: 'L24.3', description: `${WORD} Blockwork 200 mm`, quantity: 1200, unit: 'm2', rate: 41.25, amount: 49500 });
  return Buffer.from(await workbook.xlsx.writeBuffer());
};

/** Asks for a document three ways as one viewer: the bytes, the text, the search. */
const probe = async (label, session, P, documentId, realSha, searchWord = null) => {
  const file = await fetchFile(label, session, `${P}/attachments/documents/${documentId}`);
  const text = await ask(label, session, 'GET', `${P}/documents/${documentId}/text?maxChars=200000`);
  const textRow = text.body?.data?.text || null;
  if (text.status === 200) line(`      text row: status=${textRow?.status ?? 'none'} characters=${(textRow?.text || '').length}`);
  let hit = null;
  if (searchWord) {
    const search = await ask(label, session, 'GET', `${P}/documents/search?q=${encodeURIComponent(searchWord)}&limit=50`);
    hit = listOf(search.body?.data?.hits || search.body?.data).some((row) => (row.documentId || row.document?.id || row.id) === documentId);
    line(`      search hit for this document: ${hit}`);
  }
  return { label, served: Boolean(file.buffer) && sha(file.buffer) === realSha, status: file.status, textStatus: text.status, textReady: textRow?.status === 'ready', hit };
};

main(async () => {
  const results = [];

  // ═══ (a) the uploaded bill, for someone whose template withholds the BOQ ═══
  head('(a) BOQ withholding — project 041-02');
  const pm = as(EMAIL.pm);
  const u = as(U_EMAIL);
  const P2 = `/projects/${projectId('041', '041-02')}`;

  let template = listOf(await pm.GET('/permissions/templates')).find((row) => row.name === TEMPLATE_NAME);
  if (!template) {
    template = await pm.POST('/permissions/templates', { name: TEMPLATE_NAME, description: 'Certification lead L24: everything a site engineer has, without the bill of quantities.', kind: 'internal', baseRole: 'site_engineer', tools: [{ module: 'boq', level: 'none' }] });
    line(`  (set-up) permission template made: ${template.id}`);
  }
  const assigned = await ask('PM (company admin)', pm, 'PUT', `${P2}/team/${userId(U_EMAIL)}/permissions`, { templateId: template.id });
  if (assigned.status !== 200) throw new Error(`the template could not be assigned: ${assigned.status} ${assigned.text}`);
  await whoIs(pm, P2, U_EMAIL);

  // The workbook: found through the jobs list when an earlier run uploaded it.
  let billId = null;
  const jobs = listOf((await pm.send('GET', `${P2}/jobs?limit=100`)).body?.data);
  for (const id of [...new Set(jobs.map((job) => job.payload?.documentId).filter(Boolean))]) {
    const check = await pm.send('GET', `${P2}/boq/uploads/${id}`, undefined, { binary: true });
    if (check.buffer) { billId = id; break; }
  }
  if (!billId) {
    const out = await pm.upload('POST', `${P2}/boq/upload`, { field: 'file', filename: `${MARK}-bill.xlsx`, contentType: XLSX_TYPE, body: await billWorkbook(), fields: { label: `${MARK} bill` } });
    billId = out?.document?.documentId || out?.document?.id;
    line(`  [PM] POST ${P2}/boq/upload -> the bill is stored as document ${billId}`);
  }
  if (!billId) throw new Error('the bill was uploaded but no document id came back');
  const bill = await fetchFile('PM', pm, `${P2}/boq/uploads/${billId}`);
  if (!bill.buffer) throw new Error('the PM could not download the uploaded bill');
  const billSha = sha(bill.buffer);

  // The template takes up to its cache time (15 s) to bind; the control waits for it.
  let boqAsU = null;
  for (let tries = 0; tries < 8; tries += 1) {
    boqAsU = await u.send('GET', `${P2}/boq`);
    if (boqAsU.status === 403) break;
    await sleep(3000);
  }
  line(`  [U] GET ${P2}/boq`);
  line(`      -> ${boqAsU.status} ${boqAsU.body?.error?.code || ''} (control: the template withholds the BOQ)`);
  const ownRoute = await fetchFile('U', u, `${P2}/boq/uploads/${billId}`);
  const jobsAsU = await ask('U', u, 'GET', `${P2}/jobs?limit=100`);
  const published = listOf(jobsAsU.body?.data).some((job) => job.payload?.documentId === billId);
  line(`      the jobs list gives U the bill's document id: ${published} (job types U sees: ${[...new Set(listOf(jobsAsU.body?.data).map((job) => job.type))].join(', ') || 'none'})`);
  const a = await probe('U', u, P2, billId, billSha, WORD);
  results.push({ ...a, case: '(a) uploaded bill, BOQ withheld by template', control: boqAsU.status === 403 && ownRoute.status === 403, published });

  // ═══ (b) another party's executed agreement and lien waiver ═══════════════
  const s = await stage();
  const { P, subB, site } = s;
  head("(b) Concrete Works' executed agreements and lien waiver — project 041-01");
  await whoIs(pm, P, subB.email);
  await whoIs(pm, P, site.email);
  const commitments = listOf(await pm.GET(`${P}/commitments`)).filter((row) => row.executedDocument?.id);
  const waivers = listOf(await pm.GET(`${P}/pay-apps`)).filter((row) => row.waiverDocumentId);
  const targets = [
    ...commitments.map((row) => ({ what: `executed agreement, ${row.type} #${row.number} with ${row.vendorCompany?.name || row.vendor?.name || row.vendorCompanyId}`, record: `${P}/commitments/${row.id}`, documentId: row.executedDocument.id })),
    ...waivers.map((row) => ({ what: `lien waiver, payment application #${row.number}`, record: `${P}/pay-apps/${row.id}`, documentId: row.waiverDocumentId })),
  ];
  for (const target of targets) {
    line(`\n  ${target.what} — document ${target.documentId}`);
    const real = await pm.send('GET', `${P}/attachments/documents/${target.documentId}`, undefined, { binary: true });
    if (!real.buffer) { line(`      (the PM cannot download it: ${real.status}; skipped)`); continue; }
    for (const [label, session] of [['SUB-B', subB], ['SITE ENGINEER', site]]) {
      const record = await ask(label, session, 'GET', target.record);
      const r = await probe(label, session, P, target.documentId, sha(real.buffer));
      results.push({ ...r, case: `(b) ${target.what}`, control: record.status === 403 || record.status === 404 });
    }
  }

  // ═══ (c) change-order evidence ════════════════════════════════════════════
  head('(c) change-order evidence — project 041-01');
  const orders = (await pm.GET(`${P}/change-orders`)).orders || [];
  let order = orders.find((row) => String(row.description || '').startsWith(MARK));
  if (!order) {
    const secret = `${MARK}-SECRET-${Date.now()}`;
    const stored = await pm.upload('POST', `${P}/workflow/uploads`, { field: 'files', ...pdfFile(secret, ['Client instruction with the agreed variation price', secret]) });
    const file = listOf(stored?.files || stored)[0] || stored;
    const evidenceId = file?.documentId || file?.id;
    line(`  [PM] POST ${P}/workflow/uploads -> document ${evidenceId}`);
    const made = await ask('PM', pm, 'POST', `${P}/change-orders`, { description: `${MARK} variation with priced evidence (draft, no value)`, category: 'client_instruction', value: 0, attachmentRefs: [{ documentId: evidenceId, description: `${MARK} evidence` }] });
    if (made.status !== 201) throw new Error(`the change order could not be made: ${made.status} ${made.text}`);
    order = ((await pm.GET(`${P}/change-orders`)).orders || []).find((row) => String(row.description || '').startsWith(MARK));
  }
  const evidence = (order.attachmentRefs || order.attachments || []).find((row) => row.documentId);
  if (!evidence) throw new Error('the change order carries no evidence document');
  line(`  change order ${order.ref} ${order.id} (${order.status}) cites document ${evidence.documentId}`);
  const realEvidence = await pm.send('GET', `${P}/attachments/documents/${evidence.documentId}`, undefined, { binary: true });
  for (const [label, session] of [['SUB-B', subB], ['SITE ENGINEER', site]]) {
    const list = await ask(label, session, 'GET', `${P}/change-orders`);
    const r = await probe(label, session, P, evidence.documentId, sha(realEvidence.buffer));
    results.push({ ...r, case: '(c) change-order evidence', control: list.status === 403 });
  }

  // ── the answer ───────────────────────────────────────────────────────────
  head('summary');
  for (const r of results) line(`  ${r.case} — ${r.label}: record refused ${r.control}; bytes served ${r.served} (${r.status}); text route ${r.textStatus}${r.textReady ? ' (text ready)' : ''}${r.hit === null ? '' : `; search hit ${r.hit}`}`);
  const served = results.filter((r) => r.served);
  const textOpen = results.filter((r) => r.textStatus === 200);
  const searched = results.some((r) => r.hit === true);
  line(`  served: ${served.length} of ${results.length}; text route open: ${textOpen.length} of ${results.length}; a search hit: ${searched}`);
  line('  (no document on this API has extracted text — the job worker is not running — so the text content and the search hit could not be observed)');

  if (served.length) {
    const cases = [...new Set(served.map((r) => r.case.slice(0, 3)))].join(', ');
    return verdict('L24', 'CONFIRMED', `documents linked outside the Attachment table are served through /attachments/documents to people refused the record itself (cases ${cases}; ${served.length} of ${results.length} probes) and their text route answers 200; the search hit and the text content could not be observed because nothing is indexed here.`);
  }
  if (textOpen.length) return verdict('L24', 'PARTLY_CONFIRMED', 'the bytes are refused but the text route still opens for a document the viewer may not read.');
  return verdict('L24', 'NOT_REPRODUCED', 'every document linked outside the Attachment table was refused to a viewer who may not read its record.');
});
