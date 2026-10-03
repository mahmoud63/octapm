'use strict';

/**
 * Documents group proof — certification leads L2, L23, L24 and FILES-X2.
 *
 * A document, its text, its register row and its revisions reach only a
 * reader entitled to the record it is linked from. Every section asserts BOTH
 * sides: the refusal the lead asked for, and a legitimate reader of the same
 * company who must keep access (a PM, a QS, the party the record is routed
 * to, the vendor's own party member).
 *
 * Stage: company 041 (see ../leads/_files-fixture.js). Project 041-01 holds
 * the parties SUB-A and SUB-B (each reaching the project through its party
 * only); project 041-02 holds the bill uploaded by lead L24 and the site
 * engineer dina.mensah.14 whose permission template withholds the BOQ. The
 * vendor-party case runs on company 072, project 072-01, with the guests of
 * the party-visibility leads (../leads/lib/party-visibility.js): SUB-X, a
 * guest of the subcontractor party whose company holds the executed
 * agreements, and SUB-Y, a guest of another subcontractor party. (On 041-01
 * the Concrete Works member holds the company role "pm", which reaches every
 * project of the company, so is no party control.) Run the lead scripts once
 * first (l2-, l23-, l24-, x-files-2-); this proof makes only what it needs on
 * top and reuses it on the next run.
 *
 * Run in process on the working tree:
 *   $env:CERT_INPROCESS = "1"; node scripts/cert/isolation/documents-proof.js [section ...]
 * Sections (default: all):
 *   l2-door l2-key l2-jobs l2-evidence
 *   l23-register l23-dashboard l23-revision l23-attachment
 *   l24-bill l24-agreements l24-vendor-party l24-evidence
 *   l24-pointer-only l24-relation-only
 *   x2-party x2-status x2-linked x2-actions
 *
 * Exit 0 when every assertion holds, 1 when one fails, 3 when the stage is
 * missing something (not a verdict).
 */

const {
  EMAIL, as, ask, fetchFile, head, line, listOf, pdfFile, projectId, sha, stage, userId,
} = require('../leads/_files-fixture');

const DOMAIN = 'c041.octapm-cert.test';
const U_EMAIL = `dina.mensah.14@${DOMAIN}`; // 041-02 site engineer, template withholds the BOQ
const strip = (url) => String(url || '').replace(/^\/api\/v1/, '');
const stamp = Date.now().toString(36).toUpperCase();

// ── assertions ──────────────────────────────────────────────────────────────
const results = [];
const check = (section, kind, label, ok, detail = '') => {
  results.push({ section, kind, label, ok: Boolean(ok) });
  line(`  ${ok ? 'PASS' : 'FAIL'} [${kind}] ${label}${detail ? ` — ${detail}` : ''}`);
};
const refused = (section, label, ok, detail) => check(section, 'refused', label, ok, detail);
const allowed = (section, label, ok, detail) => check(section, 'allowed', label, ok, detail);

class StageError extends Error {}
const need = (value, what) => {
  if (!value) throw new StageError(`the stage lacks ${what}; run the lead scripts once first`);
  return value;
};

const served = (res, wanted = null) => Boolean(res.buffer) && (!wanted || sha(res.buffer) === wanted);
const isRefusal = (res) => res.status === 404 || res.status === 403;

// ── the stage, built once per run ───────────────────────────────────────────
let stagePromise = null;
const getStage = () => {
  stagePromise ||= (async () => {
    const s = await stage();
    const { P, pm, subA } = s;
    const registerRows = async (session, recordType, search) => listOf((await session.send('GET', `${P}/doc-control/register?recordType=${recordType}${search ? `&search=${encodeURIComponent(search)}` : ''}`)).body?.data);

    // L23's RFI, routed contractor -> consultant (neither SUB-A nor SUB-B)
    let routedRow = (await registerRows(pm, 'rfi', 'CERT-L23')).find((row) => String(row.title || '').startsWith('CERT-L23')) || null;
    if (!routedRow) {
      await pm.POST(`${P}/rfi`, { subject: 'CERT-L23 Design change to the inlet chamber — contractor and consultant only', question: 'CERT-L23 The consultant\'s revised detail changes the price.', priority: 'high', ownerPartyId: need(s.party.contractor, 'a contractor party').id, reviewerPartyId: need(s.party.consultant, 'a consultant party').id });
      routedRow = (await registerRows(pm, 'rfi', 'CERT-L23')).find((row) => String(row.title || '').startsWith('CERT-L23')) || null;
    }
    need(routedRow, "lead L23's RFI");
    let routedRevision = (routedRow.revisions || []).find((rev) => rev.revision === 'A' && rev.downloadUrl) || null;
    if (!routedRevision) {
      const secret = `CERT-L23-SECRET-${Date.now()}`;
      await pm.upload('POST', `${P}/doc-control/rfi/${routedRow.recordId}/revisions/upload`, { field: 'file', ...pdfFile(secret, ['Revised detail with the agreed price', secret]), fields: { revision: 'A', title: 'CERT-L23 revised detail' } });
      routedRow = (await registerRows(pm, 'rfi', 'CERT-L23')).find((row) => String(row.title || '').startsWith('CERT-L23'));
      routedRevision = (routedRow.revisions || []).find((rev) => rev.revision === 'A' && rev.downloadUrl) || null;
    }
    need(routedRevision, "revision 'A' on lead L23's RFI");

    // SUB-A's own RFI (lead L2's), owned by SUB-A's party, with its attachment
    const subARfis = listOf((await subA.send('GET', `${P}/rfi?limit=100`)).body?.data);
    const ownRfi = need(subARfis.find((row) => String(row.subject || '').startsWith('CERT-L2 ')), "SUB-A's CERT-L2 RFI (run l2-workflow-upload-download.js)");
    const filedAsRevision = new Set((await registerRows(pm, 'rfi')).flatMap((row) => row.revisions || []).map((rev) => rev.projectDocumentId).filter(Boolean));
    const ownLinks = listOf((await subA.send('GET', `${P}/attachments?recordType=rfi&recordId=${ownRfi.id}`)).body?.data);
    const ownDocId = need((ownLinks.map((link) => link.documentId || link.document?.id).filter((id) => id && !filedAsRevision.has(id)))[0], "SUB-A's RFI attachment");
    const ownDoc = await fetchFile('SUB-A (set-up)', subA, `${P}/attachments/documents/${ownDocId}`);
    need(ownDoc.buffer, "SUB-A's own download of its attachment");

    // Concrete Works' executed agreements and the lien waivers
    const commitments = listOf(await pm.GET(`${P}/commitments`)).filter((row) => row.executedDocument?.id);
    const payApps = listOf(await pm.GET(`${P}/pay-apps`)).filter((row) => row.waiverDocumentId);
    const concrete = (row) => /Concrete Works/.test(row.vendorCompany?.name || row.vendor?.name || '');
    const concreteAgreement = need(commitments.find(concrete), 'an executed Concrete Works agreement');
    const otherAgreement = commitments.find((row) => !concrete(row)) || null;
    const waiver = need(payApps[0], 'a payment application with a lien waiver');

    return { ...s, registerRows, routedRow, routedRevision, ownRfi, ownDocId, ownDocSha: sha(ownDoc.buffer), concreteAgreement, otherAgreement, waiver };
  })();
  return stagePromise;
};

const realSha = async (session, route) => {
  const res = await session.send('GET', route, undefined, { binary: true });
  return res.buffer ? sha(res.buffer) : null;
};

// ── L2: the /workflow/uploads door ──────────────────────────────────────────
const SECTIONS = {};

SECTIONS['l2-door'] = async () => {
  const S = 'l2-door';
  const t = await getStage();
  const { P, pm, qs, site, subA, subB } = t;
  head('L2 — GET /workflow/uploads/:key asks the record rule');
  const ownRoute = `${P}/workflow/uploads/${t.ownDocId}`;
  allowed(S, 'SUB-A downloads its own RFI attachment', served(await fetchFile('SUB-A', subA, ownRoute), t.ownDocSha));
  allowed(S, 'the PM downloads SUB-A\'s RFI attachment', served(await fetchFile('PM', pm, ownRoute), t.ownDocSha));
  const b = await fetchFile('SUB-B', subB, ownRoute);
  refused(S, 'SUB-B (another subcontractor party) is refused SUB-A\'s RFI attachment', !served(b) && b.status === 404, `${b.status}`);
  // the vendor party's own reading of its agreement is proven on 072-01 (section l24-vendor-party)

  for (const [what, documentId] of [['the executed Concrete Works agreement', t.concreteAgreement.executedDocument.id], ['the lien waiver', t.waiver.waiverDocumentId]]) {
    const route = `${P}/workflow/uploads/${documentId}`;
    const wanted = await realSha(pm, route);
    allowed(S, `the PM downloads ${what}`, Boolean(wanted));
    allowed(S, `the QS (commitment and payment-application reader) downloads ${what}`, served(await fetchFile('QS', qs, route), wanted));
    for (const [label, session] of [['SUB-B', subB], ['SITE ENGINEER', site]]) {
      const res = await fetchFile(label, session, route);
      refused(S, `${label} is refused ${what}`, !served(res) && res.status === 404, `${res.status}`);
    }
  }
  const missing = await fetchFile('PM', pm, `${P}/workflow/uploads/00000000-0000-4000-8000-000000000000`);
  check(S, 'control', 'an unknown key is still 404 FILE_NOT_FOUND', missing.status === 404, `${missing.status}`);
};

SECTIONS['l2-key'] = async () => {
  const S = 'l2-key';
  const t = await getStage();
  const { P, pm, pid } = t;
  head('L2 — an API key reaches a workflow document through its scopes only');
  const route = `${P}/workflow/uploads/${t.ownDocId}`;
  const keys = [];
  try {
    for (const scopes of [['inventory:read'], ['rfi:read']]) {
      const made = await pm.send('POST', '/integrations/api-clients', { name: `CERT-DOCPROOF key ${scopes.join('+')} ${stamp}`, scopes, projectIds: [pid] });
      line(`  [PM] POST /integrations/api-clients ${JSON.stringify(scopes)} -> ${made.status} (secret not printed)`);
      const token = made.body?.data?.token || made.body?.data?.key || made.body?.data?.secret;
      if (made.status !== 201 || !token) throw new StageError(`an API key could not be made (${made.status})`);
      keys.push({ id: made.body.data.id, token, scopes });
    }
    const { raw } = require('../lib/api');
    const [unrelated, rfiReader] = keys;
    const r1 = await raw('GET', route, { token: unrelated.token, binary: true });
    line(`  [KEY inventory:read] GET ${route} -> ${r1.status}`);
    refused(S, 'a key scoped to inventory:read is refused the RFI attachment', !served(r1) && r1.status === 404, `${r1.status}`);
    const r2 = await raw('GET', route, { token: rfiReader.token, binary: true });
    line(`  [KEY rfi:read] GET ${route} -> ${r2.status}`);
    allowed(S, 'a key scoped to rfi:read (owned by the PM) downloads the RFI attachment', served(r2, t.ownDocSha), `${r2.status}`);
  } finally {
    for (const key of keys) {
      const revoked = await pm.send('DELETE', `/integrations/api-clients/${key.id}`);
      line(`  key ${key.scopes.join('+')} revoked: ${revoked.status}`);
    }
  }
};

SECTIONS['l2-jobs'] = async () => {
  const S = 'l2-jobs';
  const t = await getStage();
  const { P, pm, subA, subB } = t;
  head('L2 — a job on a document carries its payload only to a reader of that document');
  const pmJobs = listOf((await pm.send('GET', `${P}/jobs?type=document.extract&limit=100`)).body?.data);
  const job = need(pmJobs.find((row) => row.payload?.documentId === t.ownDocId), "the document.extract job of SUB-A's attachment in the PM's newest 100");
  allowed(S, 'the PM\'s jobs list names SUB-A\'s document', true, `job ${job.id}`);
  const asA = await ask('SUB-A', subA, 'GET', `${P}/jobs/${job.id}`);
  allowed(S, 'SUB-A reads its own document\'s job with the payload', asA.status === 200 && asA.body?.data?.payload?.documentId === t.ownDocId);
  const asB = await ask('SUB-B', subB, 'GET', `${P}/jobs/${job.id}`);
  refused(S, 'SUB-B reads that job without the payload or the result', asB.status === 200 && !asB.body?.data?.payload?.documentId && asB.body?.data?.result == null && Boolean(asB.body?.data?.payloadWithheld), JSON.stringify(asB.body?.data?.payloadWithheld || null));
  const listB = listOf((await subB.send('GET', `${P}/jobs?type=document.extract&limit=100`)).body?.data);
  refused(S, 'SUB-B\'s jobs list does not name SUB-A\'s document', !listB.some((row) => row.payload?.documentId === t.ownDocId), `${listB.length} job(s)`);
  allowed(S, 'SUB-B\'s jobs list still names documents SUB-B may read', listB.some((row) => row.payload?.documentId) || listB.length === 0, `${listB.filter((row) => row.payload?.documentId).length} with a payload`);
};

SECTIONS['l2-evidence'] = async () => {
  const S = 'l2-evidence';
  const t = await getStage();
  const { P, pm, subA, subB } = t;
  head('L2/L24 — evidence filed through WorkflowAttachment (attachmentRefs) follows its record');
  // a file linked by this reference and nothing else (no Attachment row, no revision, no pointer)
  const subject = 'CERT-DOCPROOF refs-only evidence — Sub A only';
  let rfi = listOf((await subA.send('GET', `${P}/rfi?limit=100`)).body?.data).find((row) => row.subject === subject) || null;
  let documentId = null;
  if (!rfi) {
    const secret = `CERT-DOCPROOF-EVIDENCE-${Date.now()}`;
    const stored = await subA.upload('POST', `${P}/workflow/uploads`, { field: 'files', ...pdfFile(secret, ['Sub A site evidence', secret]) });
    const file = need(listOf(stored?.files || stored)[0] || stored, 'an uploaded evidence file');
    documentId = file.documentId || file.id;
    const made = await ask('SUB-A', subA, 'POST', `${P}/rfi`, { subject, question: 'CERT-DOCPROOF evidence attached by reference only.', priority: 'normal', attachmentRefs: [{ storageKey: documentId, fileName: file.fileName, fileUrl: file.fileUrl, mimeType: file.mimeType, sizeBytes: file.sizeBytes }] });
    if (made.status !== 201) throw new StageError(`SUB-A could not raise the evidence RFI: ${made.status}`);
    rfi = made.body.data;
  }
  const row = (await t.registerRows(pm, 'rfi', 'CERT-DOCPROOF')).find((item) => item.recordId === rfi.id);
  documentId ||= need((row?.attachments || []).map((ref) => ref.storageKey).find(Boolean), "the evidence RFI's reference");
  t.evidenceDocId = documentId;
  const route = `${P}/workflow/uploads/${documentId}`;
  const wanted = await realSha(subA, route);
  allowed(S, 'SUB-A downloads the evidence filed on its own RFI', Boolean(wanted));
  allowed(S, 'the PM downloads it', served(await fetchFile('PM', pm, route), wanted));
  const b = await fetchFile('SUB-B', subB, route);
  refused(S, 'SUB-B is refused evidence filed on an RFI routed to SUB-A', !served(b) && b.status === 404, `${b.status}`);
  const text = await ask('SUB-B', subB, 'GET', `${P}/documents/${documentId}/text`);
  refused(S, 'SUB-B is refused its text', text.status === 403, `${text.status}`);
};

// ── L23: the register, the dashboard, the revision file ─────────────────────
SECTIONS['l23-register'] = async () => {
  const S = 'l23-register';
  const t = await getStage();
  const { P, pm, subA, subB } = t;
  head('L23 — the register lists RFIs and submittals by their routing');
  const has = (rows, id) => rows.some((row) => row.recordId === id);
  const pmRows = await t.registerRows(pm, 'rfi');
  allowed(S, 'the PM\'s register lists the contractor->consultant RFI and SUB-A\'s RFI', has(pmRows, t.routedRow.recordId) && has(pmRows, t.ownRfi.id), `${pmRows.length} rows`);
  const aRows = await t.registerRows(subA, 'rfi');
  allowed(S, 'SUB-A\'s register lists SUB-A\'s own RFI', has(aRows, t.ownRfi.id), `${aRows.length} rows`);
  refused(S, 'SUB-A\'s register does not list the RFI routed to other parties', !has(aRows, t.routedRow.recordId));
  const bRows = await t.registerRows(subB, 'rfi');
  refused(S, 'SUB-B\'s register lists neither', !has(bRows, t.routedRow.recordId) && !has(bRows, t.ownRfi.id), `${bRows.length} rows`);
  const bList = listOf((await subB.send('GET', `${P}/rfi?limit=100`)).body?.data);
  check(S, 'refused', 'SUB-B\'s register gives no more RFIs than its routed list', bRows.length <= bList.length, `${bRows.length} vs ${bList.length}`);
  const bSub = await t.registerRows(subB, 'submittal');
  const bSubList = listOf((await subB.send('GET', `${P}/submittals?limit=100`)).body?.data);
  refused(S, 'SUB-B\'s submittal register gives no more than its routed submittal list', bSub.length <= bSubList.length, `${bSub.length} vs ${bSubList.length}`);
  const pmSub = await t.registerRows(pm, 'submittal');
  allowed(S, 'the PM\'s submittal register still lists the project\'s submittals', pmSub.length > 0, `${pmSub.length}`);
  const aDrawings = await t.registerRows(subA, 'drawing');
  const pmDrawings = await t.registerRows(pm, 'drawing');
  allowed(S, 'drawings (no party routing) stay in a party member\'s register, as in their own list', aDrawings.length === pmDrawings.length, `${aDrawings.length} vs ${pmDrawings.length}`);
};

SECTIONS['l23-dashboard'] = async () => {
  const S = 'l23-dashboard';
  const t = await getStage();
  const { P, pm, subA, subB } = t;
  head('L23 — the dashboard counts only the records the reader may see');
  const metrics = async (label, session) => (await ask(label, session, 'GET', `${P}/doc-control/dashboard`)).body?.data?.metrics || {};
  const [pmM, aM, bM] = [await metrics('PM', pm), await metrics('SUB-A', subA), await metrics('SUB-B', subB)];
  const bOpen = listOf((await subB.send('GET', `${P}/rfi?limit=100`)).body?.data).filter((row) => row.status !== 'closed').length;
  refused(S, 'SUB-B\'s open-RFI count is that of its routed list', bM.rfiOpen === bOpen, `${bM.rfiOpen} vs ${bOpen}`);
  allowed(S, 'SUB-A\'s open-RFI count includes its own open RFI', aM.rfiOpen >= 1, `${aM.rfiOpen}`);
  allowed(S, 'the PM\'s open-RFI count is the whole project\'s', pmM.rfiOpen > aM.rfiOpen, `${pmM.rfiOpen}`);
};

const ensureOwnRevision = async (t) => {
  const { P, subA } = t;
  const label = 'DOCPROOF-A';
  let rev = ((await t.registerRows(subA, 'rfi')).find((row) => row.recordId === t.ownRfi.id)?.revisions || []).find((item) => item.revision === label) || null;
  if (!rev) {
    await subA.upload('POST', `${P}/doc-control/rfi/${t.ownRfi.id}/revisions/upload`, { field: 'file', ...pdfFile(`CERT-DOCPROOF-${label}`, ['Sub A revision of its own RFI', label]), fields: { revision: label } });
    rev = ((await t.registerRows(subA, 'rfi')).find((row) => row.recordId === t.ownRfi.id)?.revisions || []).find((item) => item.revision === label) || null;
  }
  return need(rev, "SUB-A's own revision on its RFI");
};

SECTIONS['l23-revision'] = async () => {
  const S = 'l23-revision';
  const t = await getStage();
  const { P, pm, subA, subB } = t;
  head('L23 — a revision file is served to the readers of its record only');
  const routed = `${P}/doc-control/revisions/${t.routedRevision.id}`;
  const wanted = await realSha(pm, `${routed}/download`);
  allowed(S, 'the PM downloads the routed RFI\'s revision', Boolean(wanted));
  for (const [label, session] of [['SUB-B', subB], ['SUB-A', subA]]) {
    const d = await fetchFile(label, session, `${routed}/download`);
    const p = await fetchFile(label, session, `${routed}/preview`);
    refused(S, `${label} is refused the download and the preview of a revision of an RFI routed to other parties`, !served(d) && !served(p) && d.status === 404 && p.status === 404, `${d.status}/${p.status}`);
  }
  const own = await ensureOwnRevision(t);
  const ownRoute = `${P}/doc-control/revisions/${own.id}`;
  const ownSha = await realSha(subA, `${ownRoute}/download`);
  allowed(S, 'SUB-A downloads the revision of its own RFI', Boolean(ownSha));
  allowed(S, 'SUB-A previews it', served(await fetchFile('SUB-A', subA, `${ownRoute}/preview`), ownSha));
  allowed(S, 'the PM downloads it', served(await fetchFile('PM', pm, `${ownRoute}/download`), ownSha));
  const b = await fetchFile('SUB-B', subB, `${ownRoute}/download`);
  refused(S, 'SUB-B is refused it', !served(b) && b.status === 404, `${b.status}`);
};

SECTIONS['l23-attachment'] = async () => {
  const S = 'l23-attachment';
  const t = await getStage();
  const { P, pm, subA, subB } = t;
  head('L23 — /attachments/documents applies the routing of the revision\'s record');
  const routedDoc = `${P}/attachments/documents/${t.routedRevision.projectDocumentId}`;
  allowed(S, 'the PM reads the routed RFI\'s revision document', served(await fetchFile('PM', pm, routedDoc)));
  for (const [label, session] of [['SUB-B', subB], ['SUB-A', subA]]) {
    const res = await fetchFile(label, session, routedDoc);
    refused(S, `${label} is refused it`, !served(res) && res.status === 404, `${res.status}`);
  }
  const own = await ensureOwnRevision(t);
  const ownDoc = `${P}/attachments/documents/${own.projectDocumentId}`;
  allowed(S, 'SUB-A reads its own revision\'s document', served(await fetchFile('SUB-A', subA, ownDoc)));
  const b = await fetchFile('SUB-B', subB, ownDoc);
  refused(S, 'SUB-B is refused it', !served(b) && b.status === 404, `${b.status}`);
};

// ── L24: files linked outside the Attachment table ──────────────────────────
SECTIONS['l24-bill'] = async () => {
  const S = 'l24-bill';
  const pm = as(EMAIL.pm);
  const u = as(U_EMAIL);
  const P2 = `/projects/${projectId('041', '041-02')}`;
  head('L24 — the uploaded bill follows the BOQ (project 041-02)');
  let billId = null;
  const jobs = listOf((await pm.send('GET', `${P2}/jobs?limit=100`)).body?.data);
  for (const id of [...new Set(jobs.map((job) => job.payload?.documentId).filter(Boolean))]) {
    if ((await pm.send('GET', `${P2}/boq/uploads/${id}`, undefined, { binary: true })).buffer) { billId = id; break; }
  }
  need(billId, 'the bill uploaded by lead L24 on 041-02 (run l24-unlinked-documents.js)');
  const control = await ask('U', u, 'GET', `${P2}/boq`);
  if (control.status !== 403) throw new StageError(`U is not withheld the BOQ (GET /boq ${control.status}); run l24-unlinked-documents.js to bind the template`);
  const route = `${P2}/attachments/documents/${billId}`;
  const wanted = await realSha(pm, `${P2}/boq/uploads/${billId}`);
  allowed(S, 'the PM reads the bill as a document', served(await fetchFile('PM', pm, route), wanted));
  allowed(S, 'the PM opens its text route', (await ask('PM', pm, 'GET', `${P2}/documents/${billId}/text`)).status === 200);
  const res = await fetchFile('U', u, route);
  refused(S, 'U (template without the BOQ) is refused the bill as a document', !served(res) && res.status === 404, `${res.status}`);
  const text = await ask('U', u, 'GET', `${P2}/documents/${billId}/text`);
  refused(S, 'U is refused its text', text.status === 403, `${text.status}`);
  const uJobs = listOf((await u.send('GET', `${P2}/jobs?limit=100`)).body?.data);
  refused(S, 'U\'s jobs list does not name the bill', !uJobs.some((job) => job.payload?.documentId === billId), `${uJobs.length} job(s)`);
};

SECTIONS['l24-agreements'] = async () => {
  const S = 'l24-agreements';
  const t = await getStage();
  const { P, pm, qs, site, subB } = t;
  head('L24 — executed agreements and lien waivers follow their commitment and payment application');
  const probe = async (label, session, documentId) => ({
    file: await fetchFile(label, session, `${P}/attachments/documents/${documentId}`),
    text: await ask(label, session, 'GET', `${P}/documents/${documentId}/text`),
  });
  const targets = [
    { what: 'the executed Concrete Works agreement', documentId: t.concreteAgreement.executedDocument.id },
    { what: 'the lien waiver', documentId: t.waiver.waiverDocumentId },
  ];
  if (t.otherAgreement) targets.push({ what: `the executed agreement of another vendor (${t.otherAgreement.vendorCompany?.name || t.otherAgreement.vendorCompanyId})`, documentId: t.otherAgreement.executedDocument.id });
  for (const target of targets) {
    const wanted = await realSha(pm, `${P}/attachments/documents/${target.documentId}`);
    allowed(S, `the PM reads ${target.what}`, Boolean(wanted));
    const q = await probe('QS', qs, target.documentId);
    allowed(S, `the QS reads ${target.what} and its text route`, served(q.file, wanted) && q.text.status === 200, `${q.file.status}/${q.text.status}`);
    for (const [label, session] of [['SUB-B', subB], ['SITE ENGINEER', site]]) {
      const r = await probe(label, session, target.documentId);
      refused(S, `${label} is refused ${target.what} and its text route`, !served(r.file) && r.file.status === 404 && r.text.status === 403, `${r.file.status}/${r.text.status}`);
    }
  }
};

SECTIONS['l24-vendor-party'] = async () => {
  const S = 'l24-vendor-party';
  head('L24 — on 072-01 the vendor\'s own party reads its agreement and waiver; another subcontractor party does not');
  // the real guests of the party-visibility leads: each reaches 072-01 through its party only
  const pv = require('../leads/lib/party-visibility');
  const g = await pv.setup({ log: line, need: ['subX', 'subY'] });
  const P = `/projects/${g.projectId}`;
  const parties = listOf(await g.pm.GET(`${P}/parties?status=active`));
  const vendorCompanyId = need(parties.find((row) => row.id === g.parties.subcontractor)?.companyId, "SUB-X's party company");
  const commitments = listOf(await g.pm.GET(`${P}/commitments`)).filter((row) => row.executedDocument?.id && row.vendorCompanyId === vendorCompanyId);
  const payApps = listOf(await g.pm.GET(`${P}/pay-apps`)).filter((row) => row.waiverDocumentId);
  const waivers = [];
  for (const row of payApps) {
    const commitment = row.commitment || (await g.pm.send('GET', `${P}/commitments/${row.commitmentId}`)).body?.data;
    if (commitment?.vendorCompanyId === vendorCompanyId) waivers.push(row);
  }
  const targets = [
    ...commitments.slice(0, 2).map((row) => ({ what: `executed ${row.type} #${row.number}`, documentId: row.executedDocument.id })),
    ...waivers.slice(0, 1).map((row) => ({ what: `lien waiver of payment application #${row.number}`, documentId: row.waiverDocumentId })),
  ];
  need(targets.length, "an executed agreement or lien waiver of SUB-X's company on 072-01");
  for (const target of targets) {
    const wanted = await realSha(g.pm, `${P}/attachments/documents/${target.documentId}`);
    allowed(S, `the PM reads the ${target.what}`, Boolean(wanted));
    for (const door of ['attachments/documents', 'workflow/uploads']) {
      const x = await fetchFile('SUB-X (vendor party)', g.subX, `${P}/${door}/${target.documentId}`);
      allowed(S, `SUB-X, the vendor's own party, reads the ${target.what} through /${door}`, served(x, wanted), `${x.status}`);
      const y = await fetchFile('SUB-Y (another subcontractor)', g.subY, `${P}/${door}/${target.documentId}`);
      refused(S, `SUB-Y, another subcontractor party, is refused the ${target.what} through /${door}`, !served(y) && y.status === 404, `${y.status}`);
    }
    const xt = await ask('SUB-X', g.subX, 'GET', `${P}/documents/${target.documentId}/text`);
    allowed(S, `SUB-X opens the ${target.what}'s text route`, xt.status === 200, `${xt.status}`);
    const yt = await ask('SUB-Y', g.subY, 'GET', `${P}/documents/${target.documentId}/text`);
    refused(S, `SUB-Y is refused its text route`, yt.status === 403, `${yt.status}`);
  }
};

SECTIONS['l24-evidence'] = async () => {
  const S = 'l24-evidence';
  const t = await getStage();
  const { P, pm, qs, planner, site, subB } = t;
  head('L24 — change-order evidence follows the change order');
  const order = need(((await pm.GET(`${P}/change-orders`)).orders || []).find((row) => String(row.description || '').startsWith('CERT-L24')), "lead L24's change order (run l24-unlinked-documents.js)");
  const evidence = need((order.attachmentRefs || order.attachments || []).find((row) => row.documentId), 'the change order\'s evidence');
  const route = `${P}/attachments/documents/${evidence.documentId}`;
  const wanted = await realSha(pm, route);
  allowed(S, 'the PM reads the change-order evidence', Boolean(wanted));
  allowed(S, 'the QS (change-order reader) reads it', served(await fetchFile('QS', qs, route), wanted));
  allowed(S, 'the planner (change-order reader) reads it', served(await fetchFile('PLANNER', planner, route), wanted));
  allowed(S, 'the PM reads it through /workflow/uploads, the URL the change order hands out', served(await fetchFile('PM', pm, `${P}/workflow/uploads/${evidence.documentId}`), wanted));
  for (const [label, session] of [['SUB-B', subB], ['SITE ENGINEER', site]]) {
    const res = await fetchFile(label, session, route);
    const text = await ask(label, session, 'GET', `${P}/documents/${evidence.documentId}/text`);
    refused(S, `${label} (no change-order read) is refused it and its text route`, !served(res) && res.status === 404 && text.status === 403, `${res.status}/${text.status}`);
  }
};

/**
 * The two kinds of link that are redundant for the files above, each made the
 * only link of a file of its own, so each is proven on its own:
 *  - the document's own pointer (linkedEntityType/Id): evidence cited on a
 *    draft change order and then taken off it keeps only the pointer;
 *  - a relation column: a lien waiver set on a payment application from an
 *    existing upload (waiverDocumentId) writes no pointer.
 */
SECTIONS['l24-pointer-only'] = async () => {
  const S = 'l24-pointer-only';
  const t = await getStage();
  const { P, pm, qs, site, subB } = t;
  head('L24 — a file whose only link is its own pointer follows that record (evidence taken off a change order)');
  const marker = 'CERT-DOCPROOF pointer';
  let order = ((await pm.GET(`${P}/change-orders`)).orders || []).find((row) => String(row.description || '').startsWith(marker)) || null;
  if (!order) {
    const secret = `CERT-DOCPROOF-POINTER-${Date.now()}`;
    const stored = await pm.upload('POST', `${P}/workflow/uploads`, { field: 'files', ...pdfFile(secret, ['Evidence later taken off the change order', secret]) });
    const file = need(listOf(stored?.files || stored)[0] || stored, 'an uploaded evidence file');
    const made = await ask('PM', pm, 'POST', `${P}/change-orders`, { description: `${marker} (draft, no value) — evidence documentId ${file.documentId}`, category: 'client_instruction', value: 0, attachmentRefs: [{ documentId: file.documentId, description: marker }] });
    if (made.status !== 201) throw new StageError(`the change order could not be made: ${made.status}`);
    order = made.body.data;
  }
  const documentId = need(String(order.description).match(/documentId ([0-9a-f-]{36})/)?.[1], 'the pointer evidence id in the change order description');
  if ((order.attachmentRefs || order.attachments || []).some((row) => row.documentId)) {
    const cleared = await ask('PM', pm, 'PATCH', `${P}/change-orders/${order.id}`, { attachmentRefs: [] });
    if (cleared.status !== 200) throw new StageError(`the evidence could not be taken off: ${cleared.status}`);
  }
  const route = `${P}/attachments/documents/${documentId}`;
  const wanted = await realSha(pm, route);
  allowed(S, 'the PM reads the file', Boolean(wanted));
  allowed(S, 'the QS (change-order reader) reads it', served(await fetchFile('QS', qs, route), wanted));
  for (const [label, session] of [['SUB-B', subB], ['SITE ENGINEER', site]]) {
    const res = await fetchFile(label, session, route);
    refused(S, `${label} (no change-order read) is refused it`, !served(res) && res.status === 404, `${res.status}`);
  }
};

SECTIONS['l24-relation-only'] = async () => {
  const S = 'l24-relation-only';
  head('L24 — a lien waiver set from an existing upload (no pointer) follows its payment application (072-01)');
  const pv = require('../leads/lib/party-visibility');
  const g = await pv.setup({ log: line, need: ['subX', 'subY'] });
  const P = `/projects/${g.projectId}`;
  const parties = listOf(await g.pm.GET(`${P}/parties?status=active`));
  const vendorCompanyId = need(parties.find((row) => row.id === g.parties.subcontractor)?.companyId, "SUB-X's party company");
  const vendorCommitments = new Set(listOf(await g.pm.GET(`${P}/commitments`)).filter((row) => row.vendorCompanyId === vendorCompanyId).map((row) => row.id));
  const payApps = listOf(await g.pm.GET(`${P}/pay-apps`)).filter((row) => vendorCommitments.has(row.commitmentId || row.commitment?.id));
  const marker = 'CERT-DOCPROOF-WAIVER';
  let payApp = payApps.find((row) => String(row.waiverDocument?.fileName || '').startsWith(marker)) || null;
  if (!payApp) {
    payApp = need(payApps.find((row) => ['draft', 'submitted', 'under_review'].includes(row.status)), "an editable payment application of SUB-X's company on 072-01");
    const secret = `${marker}-${Date.now()}`;
    const stored = await g.pm.upload('POST', `${P}/workflow/uploads`, { field: 'files', ...pdfFile(secret, ['Lien waiver set from an existing upload', secret]) });
    const file = need(listOf(stored?.files || stored)[0] || stored, 'an uploaded waiver');
    const set = await ask('PM', g.pm, 'PATCH', `${P}/pay-apps/${payApp.id}`, { waiverDocumentId: file.documentId });
    if (set.status !== 200) throw new StageError(`the waiver could not be set: ${set.status} ${set.body?.error?.code || ''}`);
    payApp = set.body.data;
  }
  const documentId = need(payApp.waiverDocumentId, 'the waiver id');
  const route = `${P}/attachments/documents/${documentId}`;
  const wanted = await realSha(g.pm, route);
  allowed(S, 'the PM reads the waiver', Boolean(wanted));
  for (const door of ['attachments/documents', 'workflow/uploads']) {
    const x = await fetchFile('SUB-X (vendor party)', g.subX, `${P}/${door}/${documentId}`);
    allowed(S, `SUB-X, the vendor's own party, reads it through /${door}`, served(x, wanted), `${x.status}`);
    const y = await fetchFile('SUB-Y (another subcontractor)', g.subY, `${P}/${door}/${documentId}`);
    refused(S, `SUB-Y, another subcontractor party, is refused it through /${door}`, !served(y) && y.status === 404, `${y.status}`);
  }
};

// ── FILES-X2: filing a revision ──────────────────────────────────────────────
const fileRevision = (label, session, P, recordId, fields, note) =>
  ask(label, session, 'POST', `${P}/doc-control/rfi/${recordId}/revisions/upload`, undefined, {
    note,
    form: (() => {
      const form = new FormData();
      const file = pdfFile(`CERT-DOCPROOF-${fields.revision}`, ['CERT-DOCPROOF revision', fields.revision]);
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
      form.append('file', new Blob([file.body], { type: file.contentType }), file.filename);
      return form;
    })(),
  });

const revisionOn = async (t, recordId, label) =>
  ((await t.registerRows(t.pm, 'rfi')).find((row) => row.recordId === recordId)?.revisions || []).find((item) => item.revision === label) || null;

SECTIONS['x2-party'] = async () => {
  const S = 'x2-party';
  const t = await getStage();
  const { P, subA, subB } = t;
  head('FILES-X2 — a revision is filed only on a record routed to the filer');
  const labelB = `DPB-${stamp}`;
  const b = await fileRevision('SUB-B', subB, P, t.routedRow.recordId, { revision: labelB }, 'an RFI routed to other parties');
  refused(S, 'SUB-B cannot file a revision on an RFI routed to other parties', b.status === 404 && !(await revisionOn(t, t.routedRow.recordId, labelB)), `${b.status}`);
  const labelA = `DPA-${stamp}`;
  const a = await fileRevision('SUB-A', subA, P, t.ownRfi.id, { revision: labelA }, 'its own RFI');
  const landed = await revisionOn(t, t.ownRfi.id, labelA);
  allowed(S, 'SUB-A files a revision on its own RFI', a.status === 201 && landed?.status === 'uploaded', `${a.status} ${landed?.status}`);
};

SECTIONS['x2-status'] = async () => {
  const S = 'x2-status';
  const t = await getStage();
  const { P, pm, subA } = t;
  head('FILES-X2 — only an approver files a revision as approved');
  const labelA = `DPS-${stamp}`;
  const a = await fileRevision('SUB-A', subA, P, t.ownRfi.id, { revision: labelA, status: 'approved' }, 'status approved');
  refused(S, 'SUB-A (no approve right) cannot file a revision as approved', a.status === 403 && !(await revisionOn(t, t.ownRfi.id, labelA)), `${a.status}`);
  const labelPm = `DPM-${stamp}`;
  const p = await fileRevision('PM', pm, P, t.routedRow.recordId, { revision: labelPm, status: 'approved' }, 'status approved');
  const landed = await revisionOn(t, t.routedRow.recordId, labelPm);
  const pmId = userId(EMAIL.pm);
  allowed(S, 'the PM files a revision as approved, recorded with who approved it', p.status === 201 && landed?.status === 'approved' && landed?.approvedBy === pmId, `${p.status} ${landed?.status} approvedBy=${landed?.approvedBy}`);
};

SECTIONS['x2-linked'] = async () => {
  const S = 'x2-linked';
  const t = await getStage();
  const { P, subA } = t;
  head('FILES-X2 — a revision names only a file the filer may read (JSON route)');
  // The target is a fresh file each run, cited on a draft change order SUB-A may not read: should the
  // check be missing, the filing publishes that file in document control, so it must be no other section's.
  const { pm } = t;
  const marker = 'CERT-DOCPROOF x2-linked target';
  const secret = `CERT-DOCPROOF-X2L-${Date.now()}`;
  const stored = await pm.upload('POST', `${P}/workflow/uploads`, { field: 'files', ...pdfFile(secret, ['Change-order evidence SUB-A may not read', secret]) });
  const target = need(listOf(stored?.files || stored)[0] || stored, 'an uploaded target file').documentId;
  let order = ((await pm.GET(`${P}/change-orders`)).orders || []).find((row) => String(row.description || '').startsWith(marker)) || null;
  const cite = order
    ? await ask('PM', pm, 'PATCH', `${P}/change-orders/${order.id}`, { attachmentRefs: [{ documentId: target, description: marker }] })
    : await ask('PM', pm, 'POST', `${P}/change-orders`, { description: `${marker} (draft, no value)`, category: 'client_instruction', value: 0, attachmentRefs: [{ documentId: target, description: marker }] });
  if (![200, 201].includes(cite.status)) throw new StageError(`the target could not be cited: ${cite.status}`);
  const pre = await fetchFile('SUB-A', subA, `${P}/attachments/documents/${target}`);
  if (pre.status !== 404) throw new StageError(`SUB-A can already read the target (${pre.status})`);
  const foreign = await ask('SUB-A', subA, 'POST', `${P}/doc-control/rfi/${t.ownRfi.id}/revisions`, { revision: `DPL-${stamp}`, projectDocumentId: target });
  refused(S, 'SUB-A cannot file change-order evidence it may not read as a revision of its own RFI', foreign.status === 404 && !(await revisionOn(t, t.ownRfi.id, `DPL-${stamp}`)), `${foreign.status}`);
  // a file SUB-A may read and that is already filed on SUB-A's RFI, so filing it again changes no one's access
  const own = await ensureOwnRevision(t);
  const mine = await ask('SUB-A', subA, 'POST', `${P}/doc-control/rfi/${t.ownRfi.id}/revisions`, { revision: `DPO-${stamp}`, projectDocumentId: own.projectDocumentId });
  allowed(S, 'SUB-A files a file it may read as a revision of its own RFI', mine.status === 201, `${mine.status}`);
};

SECTIONS['x2-actions'] = async () => {
  const S = 'x2-actions';
  const t = await getStage();
  const { P, subA, subB } = t;
  head('FILES-X2 — a revision is sent for review only by a reader of its record');
  const b = await ask('SUB-B', subB, 'POST', `${P}/doc-control/revisions/${t.routedRevision.id}/submit-review`, { comment: 'CERT-DOCPROOF probe' });
  refused(S, 'SUB-B cannot send for review a revision of an RFI routed to other parties', b.status === 404, `${b.status}`);
  const own = await ensureOwnRevision(t);
  const a = await ask('SUB-A', subA, 'POST', `${P}/doc-control/revisions/${own.id}/submit-review`, { comment: 'CERT-DOCPROOF own revision' });
  allowed(S, 'SUB-A sends the revision of its own RFI for review', a.status === 200, `${a.status}`);
};

// ── run ─────────────────────────────────────────────────────────────────────
(async () => {
  const wanted = process.argv.slice(2);
  const names = wanted.length ? wanted : Object.keys(SECTIONS);
  const unknown = names.filter((name) => !SECTIONS[name]);
  if (unknown.length) throw new StageError(`unknown section(s): ${unknown.join(', ')}`);
  for (const name of names) await SECTIONS[name]();
  head('summary');
  const failed = results.filter((row) => !row.ok);
  const refusals = results.filter((row) => row.kind === 'refused');
  const allows = results.filter((row) => row.kind === 'allowed');
  line(`  ${results.length} assertion(s): ${refusals.filter((row) => row.ok).length}/${refusals.length} refusals hold, ${allows.filter((row) => row.ok).length}/${allows.length} allowed cases hold`);
  for (const row of failed) line(`  FAILED [${row.section}] [${row.kind}] ${row.label}`);
  line(failed.length ? '\nPROOF: FAILED' : '\nPROOF: HOLDS');
  process.exitCode = failed.length ? 1 : 0;
})().catch((error) => {
  console.error(`\n${error instanceof StageError ? 'STAGE' : 'ERROR'}: ${error.stack || error.message}`);
  process.exitCode = 3;
});
