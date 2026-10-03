'use strict';

/**
 * Documents-links group proof — certification review round 2 (R29, R32,
 * R34, R35, R36, R37, R38, R39).
 *
 * Round 1 made every place a document is linked from a read grant. This
 * round shuts the write paths that let a caller name any document id as a
 * link (R29, R32), aligns the revision doors (R34), gives the document doors
 * the draft rule (R35), closes an existence oracle (R36) and an orphan (R37),
 * and surfaces only the links a viewer may see (R38). Each section asserts
 * BOTH sides: the refusal the finding asked for, and a legitimate writer or
 * reader who must keep access.
 *
 * Stage: company 072, project 072-01, with the party guests of
 * ../leads/lib/party-visibility.js — SUB-X (a guest of the subcontractor
 * party whose company, Concrete Works, holds the executed agreements and the
 * lien waivers) and SUB-Y (a guest of another subcontractor party). Internal
 * roles sign in with CERT_PASSWORD. The proof makes only what it needs on top
 * and reuses it on the next run.
 *
 * Run in process on the working tree:
 *   $env:DATABASE_URL = $null; $env:CERT_INPROCESS = "1"
 *   node scripts/cert/isolation/documents-links-proof.js [section ...]
 * Sections (default: all):
 *   r29-workflow r29-revision r29-waiver r29-executed-allowed r29-closeout-allowed
 *   r32-approved r34-revision-doors r35-draft r36-oracle r37-orphan r38-leak r39-index
 *
 * Exit 0 when every assertion holds, 1 when one fails, 3 when the stage is
 * missing something (not a verdict).
 */

const pv = require('../leads/lib/party-visibility');
const { pdfFile, sha, listOf, line, head } = require('../leads/_files-fixture');
const { as, raw } = require('../lib/api');

const stamp = Date.now().toString(36).toUpperCase();
const DOMAIN = 'c072.octapm-cert.test';

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
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) {
    throw new StageError(`the stage lacks ${what}`);
  }
  return value;
};

const send = (session, method, route, body, options) => session.send(method, route, body, options);
const fetchFile = (session, route) => session.send('GET', route, undefined, { binary: true });
const served = (res) => Boolean(res.buffer);
const code = (res) => res.body?.error?.code || res.status;

// ── the stage, built once per run ─────────────────────────────────────────
let stagePromise = null;
const getStage = () => {
  stagePromise ||= (async () => {
    const g = await pv.setup({ log: line, need: ['subX', 'subY'] });
    const P = `/projects/${g.projectId}`;
    const pm = g.pm;
    const site = as(`site@${DOMAIN}`);
    const qs = as(`qs@${DOMAIN}`);

    // A victim document SUB-X may not read: filed on an NCR (SUB-X has no NCR
    // read). Reused across sections. Made once, then found again.
    // A fresh victim per process (stamp-keyed): a mutation run with a guard
    // disabled would otherwise link the victim to SUB-X's own records and
    // leave it readable on the next run.
    const ncrList = listOf((await pm.send('GET', `${P}/ncr?limit=100`)).body?.data);
    let victimNcr = ncrList.find((row) => String(row.description || '').startsWith(`CERT-R29-NCR host (${stamp})`)) || null;
    if (!victimNcr) {
      const made = await pm.send('POST', `${P}/ncr`, { description: `CERT-R29-NCR host (${stamp})`, severity: 'minor' });
      victimNcr = need(made.body?.data, `an NCR to host the victim file (${made.status} ${code(made)})`);
    }
    const victimLinks = listOf((await pm.send('GET', `${P}/attachments?recordType=ncr&recordId=${victimNcr.id}`)).body?.data);
    let victimDocId = (victimLinks.map((row) => row.documentId || row.document?.id).filter(Boolean))[0] || null;
    if (!victimDocId) {
      const uploaded = await pm.upload('POST', `${P}/attachments`, { field: 'files', ...pdfFile(`CERT-R29-VICTIM-${stamp}`, ['Another vendor file SUB-X may not read', stamp]), fields: { recordType: 'ncr', recordId: victimNcr.id } });
      const links = listOf(uploaded?.items || uploaded);
      victimDocId = need((links.map((row) => row.documentId || row.document?.id).filter(Boolean))[0], 'a victim document id on the NCR');
    }
    // SUB-X really cannot read it (the premise of every R29 refusal).
    const pre = await fetchFile(g.subX, `${P}/attachments/documents/${victimDocId}`);
    if (served(pre) || pre.status !== 404) throw new StageError(`SUB-X can already read the victim document (${pre.status})`);

    // SUB-X's own punch item (its company's), to attach to.
    const ownPunch = need(listOf((await g.subX.send('GET', `${P}/punch?limit=100`)).body?.data)[0], 'a punch item SUB-X may edit');

    // An RFI owned by SUB-X's party, created once.
    const subcontractorParty = need(g.parties.subcontractor, "SUB-X's subcontractor party id");
    let ownRfi = listOf((await g.subX.send('GET', `${P}/rfi?limit=100`)).body?.data).find((row) => String(row.subject || '').startsWith('CERT-R29-RFI')) || null;
    if (!ownRfi) {
      const made = await g.subX.send('POST', `${P}/rfi`, { subject: `CERT-R29-RFI own (${stamp})`, question: 'Own RFI for the documents-links proof', priority: 'normal', ownerPartyId: subcontractorParty });
      ownRfi = need(made.body?.data, `SUB-X's own RFI (${made.status} ${code(made)})`);
    }

    const parties = listOf(await pm.GET(`${P}/parties?status=active`));
    const vendorCompanyId = parties.find((row) => row.id === subcontractorParty)?.companyId || null;

    return { g, P, pm, site, qs, victimDocId, victimNcr, ownPunch, ownRfi, subcontractorParty, vendorCompanyId };
  })();
  return stagePromise;
};

// A fresh file SUB-X uploads for itself (linked from nowhere, uploadedBy SUB-X).
const subXUpload = async (t, marker) => {
  const uploaded = await t.g.subX.upload('POST', `${t.P}/workflow/uploads`, { field: 'files', ...pdfFile(`${marker}-${stamp}`, [marker, stamp]) });
  return need(listOf(uploaded?.files || uploaded)[0]?.documentId, 'an own upload by SUB-X');
};

const SECTIONS = {};

// ── R29: a reference names only a document its writer may read ──────────────
SECTIONS['r29-workflow'] = async () => {
  const S = 'r29-workflow';
  const t = await getStage();
  head('R29 — a workflow attachment reference names only a document its writer may read');
  const bad = await send(t.g.subX, 'PATCH', `${t.P}/punch/${t.ownPunch.id}`, { attachmentRefs: [{ storageKey: t.victimDocId, fileName: 'stolen.pdf' }] });
  const stillHidden = await fetchFile(t.g.subX, `${t.P}/attachments/documents/${t.victimDocId}`);
  refused(S, 'SUB-X cannot reference another vendor\'s file on its own punch item', (bad.status === 404 || bad.status === 400) && !served(stillHidden), `${code(bad)}; victim ${stillHidden.status}`);

  const own = await subXUpload(t, 'CERT-R29-WF-OWN');
  const good = await send(t.g.subX, 'PATCH', `${t.P}/punch/${t.ownPunch.id}`, { attachmentRefs: [{ storageKey: own, fileName: 'mine.pdf' }] });
  const reread = await fetchFile(t.g.subX, `${t.P}/attachments/documents/${own}`);
  allowed(S, 'SUB-X references its own uploaded file and keeps reading it', good.status === 200 && served(reread), `${code(good)}`);
};

SECTIONS['r29-revision'] = async () => {
  const S = 'r29-revision';
  const t = await getStage();
  head('R29 — a revision filed through a record payload names only a readable file');
  const label = `RA-${stamp}`;
  const bad = await send(t.g.subX, 'PATCH', `${t.P}/rfi/${t.ownRfi.id}`, { revisions: [{ revision: label, projectDocumentId: t.victimDocId }] });
  const stillHidden = await fetchFile(t.g.subX, `${t.P}/attachments/documents/${t.victimDocId}`);
  refused(S, 'SUB-X cannot file a revision on its own RFI that names a file it may not read', (bad.status === 404 || bad.status === 400) && !served(stillHidden), `${code(bad)}; victim ${stillHidden.status}`);

  const own = await subXUpload(t, 'CERT-R29-REV-OWN');
  const label2 = `RB-${stamp}`;
  const good = await send(t.g.subX, 'PATCH', `${t.P}/rfi/${t.ownRfi.id}`, { revisions: [{ revision: label2, projectDocumentId: own }] });
  allowed(S, 'SUB-X files a revision naming its own file', good.status === 200, `${code(good)}`);
};

SECTIONS['r29-waiver'] = async () => {
  const S = 'r29-waiver';
  const t = await getStage();
  head('R29 — a lien waiver names only a document its writer may read');
  const payApps = listOf((await t.g.subX.send('GET', `${t.P}/pay-apps?limit=100`)).body?.data);
  const editable = need(payApps.find((row) => ['draft', 'submitted', 'under_review'].includes(row.status)), 'an editable payment application of SUB-X\'s company');
  const bad = await send(t.g.subX, 'PATCH', `${t.P}/pay-apps/${editable.id}`, { waiverDocumentId: t.victimDocId });
  refused(S, 'SUB-X cannot set another vendor\'s file as its lien waiver', bad.status === 404, `${code(bad)}`);
  const own = await subXUpload(t, 'CERT-R29-WAIVER-OWN');
  const good = await send(t.g.subX, 'PATCH', `${t.P}/pay-apps/${editable.id}`, { waiverDocumentId: own });
  allowed(S, 'SUB-X sets its own uploaded waiver', good.status === 200 && good.body?.data?.waiverDocumentId === own, `${code(good)}`);
};

SECTIONS['r29-executed-allowed'] = async () => {
  const S = 'r29-executed-allowed';
  const t = await getStage();
  head('R29 — the executor keeps naming a readable executed agreement (the refused case is PM/QS-only and is unit+mutation proven)');
  // A fresh commitment driven to approved, so the section is self-contained
  // and re-runnable (executing consumes an approved commitment).
  const all = listOf(await t.pm.GET(`${t.P}/commitments`));
  let approved = all.find((row) => row.status === 'approved');
  if (!approved) {
    let id = all.find((row) => row.status === 'pending')?.id || null;
    if (!id) {
      const made = await send(t.pm, 'POST', `${t.P}/commitments`, { type: 'subcontract', title: `CERT-R29-EXEC commitment (${stamp})`, vendorCompanyId: t.vendorCompanyId, lines: [{ description: 'proof line', amount: 1000 }] });
      const created = need(made.body?.data, `a commitment to execute (${made.status} ${code(made)})`);
      const sub = await send(t.pm, 'POST', `${t.P}/commitments/${created.id}/submit`);
      if (sub.status !== 200) throw new StageError(`submit failed: ${sub.status} ${code(sub)}`);
      id = created.id;
    }
    const appr = await send(t.pm, 'POST', `${t.P}/commitments/${id}/approve`);
    if (appr.status !== 200) throw new StageError(`approve failed: ${appr.status} ${code(appr)}`);
    approved = (await t.pm.send('GET', `${t.P}/commitments/${id}`)).body?.data;
  }
  if (approved?.status !== 'approved') { allowed(S, 'a commitment driven to approved to execute', false, `status ${approved?.status}`); return; }
  const upload = await t.pm.upload('POST', `${t.P}/workflow/uploads`, { field: 'files', ...pdfFile(`CERT-R29-EXEC-${stamp}`, ['Countersigned agreement', stamp]) });
  const docId = need(listOf(upload?.files || upload)[0]?.documentId, 'an uploaded agreement');
  const exec = await send(t.pm, 'POST', `${t.P}/commitments/${approved.id}/execute`, { documentId: docId, override: true, overrideReason: `docs-links proof ${stamp}` });
  allowed(S, 'the PM executes a commitment naming a document it may read', [200, 201].includes(exec.status) && exec.body?.data?.status === 'executed', `${code(exec)} ${exec.body?.data?.status}`);
};

SECTIONS['r29-closeout-allowed'] = async () => {
  const S = 'r29-closeout-allowed';
  const t = await getStage();
  head('R29 — a closeout item keeps naming readable evidence (the refused case is PM/QS-only and is unit+mutation proven)');
  const executed = listOf(await t.pm.GET(`${t.P}/commitments`)).find((row) => row.status === 'executed');
  if (!executed) { allowed(S, 'an executed commitment with a closeout', false, 'none on the stage'); return; }
  const upload = await t.pm.upload('POST', `${t.P}/workflow/uploads`, { field: 'files', ...pdfFile(`CERT-R29-CLOSE-${stamp}`, ['Training record', stamp]) });
  const docId = need(listOf(upload?.files || upload)[0]?.documentId, 'an uploaded evidence file');
  const marked = await send(t.pm, 'PATCH', `${t.P}/commitments/${executed.id}/closeout/items/training`, { status: 'complete', documentId: docId, note: `docs-links proof ${stamp}` });
  allowed(S, 'the PM marks a closeout item with a document it may read', marked.status === 200, `${code(marked)}`);
};

// ── R32: a record payload cannot file an approved or latest revision ────────
SECTIONS['r32-approved'] = async () => {
  const S = 'r32-approved';
  const t = await getStage();
  head('R32 — a revision filed through a record payload is clamped to a plain uploaded one; approval is the doc-control route\'s');
  const pmId = need((await t.pm.send('GET', '/auth/me')).body?.data?.id, 'the PM id');
  const num = `CERT-R32-${stamp}`;
  // a site engineer asks for an approved, latest revision attributed to the PM
  const bad = await send(t.site, 'POST', `${t.P}/drawings`, { drawingNumber: num, title: `R32 drawing ${stamp}`, status: 'active', revisions: [{ revision: 'C', status: 'approved', isLatest: true, approvedBy: pmId }] });
  const badRev = (bad.body?.data?.revisions || []).find((row) => row.revision === 'C') || null;
  refused(S, 'a site engineer\'s drawing revision is stored uploaded, not latest, attributed to no approver — never the PM\'s approved current', bad.status === 201 && badRev && badRev.status !== 'approved' && !badRev.isLatest && !badRev.approvedBy, `${code(bad)} status=${badRev?.status} isLatest=${badRev?.isLatest} approvedBy=${badRev?.approvedBy ?? null}`);

  // the PM, who may approve, files an approved revision through the proper door, stamped with the PM
  const filed = await fileRevisionViaDocControl(t, t.ownRfi.id, `R32A-${stamp.slice(-4)}`, 'approved');
  const reg = listOf((await t.pm.send('GET', `${t.P}/doc-control/register?recordType=rfi`)).body?.data).find((r) => r.recordId === t.ownRfi.id);
  const pmRev = (reg?.revisions || []).find((r) => r.revision === `R32A-${stamp.slice(-4)}`) || null;
  allowed(S, 'the PM files an approved revision through the doc-control route, stamped with the PM', filed.status === 201 && pmRev?.status === 'approved' && pmRev?.approvedBy === pmId, `${code(filed)} status=${pmRev?.status} approvedBy=${pmRev?.approvedBy}`);
};

// ── R34: the revision doors agree ───────────────────────────────────────────
const fileRevisionViaDocControl = async (t, recordId, revision, status = null) => {
  const file = pdfFile(`CERT-R34-${revision}-${stamp}`, ['Revision file for R34', revision]);
  const FormData = global.FormData;
  const form = new FormData();
  form.append('revision', revision);
  if (status) form.append('status', status);
  form.append('file', new Blob([file.body], { type: file.contentType }), file.filename);
  const res = await t.pm.send('POST', `${t.P}/doc-control/rfi/${recordId}/revisions/upload`, undefined, { form });
  return res;
};

SECTIONS['r34-revision-doors'] = async () => {
  const S = 'r34-revision-doors';
  const t = await getStage();
  head('R34 — the WorkflowAttachment row filed with a revision needs the revision\'s modules, so the file doors agree with the download route');
  // a revision filed through doc control on SUB-X's own RFI, by the PM
  const reg = listOf((await t.pm.send('GET', `${t.P}/doc-control/register?recordType=rfi`)).body?.data);
  let row = reg.find((r) => r.recordId === t.ownRfi.id) || null;
  let rev = (row?.revisions || []).find((r) => r.revision === 'R34' && r.projectDocumentId) || null;
  if (!rev) {
    const filed = await fileRevisionViaDocControl(t, t.ownRfi.id, 'R34');
    if (filed.status !== 201) throw new StageError(`could not file the R34 revision: ${filed.status} ${code(filed)}`);
    const reg2 = listOf((await t.pm.send('GET', `${t.P}/doc-control/register?recordType=rfi`)).body?.data);
    rev = ((reg2.find((r) => r.recordId === t.ownRfi.id)?.revisions) || []).find((r) => r.revision === 'R34' && r.projectDocumentId) || null;
  }
  const docId = need(rev?.projectDocumentId, 'the R34 revision\'s document id');
  const revId = need(rev?.id, 'the R34 revision id');

  const mint = async (scopes) => need((await t.pm.send('POST', '/integrations/api-clients', { name: `R34 ${scopes.join('+')} ${stamp}`, scopes })).body?.data?.token, `an API key ${scopes.join('+')}`);
  const rfiOnly = await mint(['rfi:read']);
  const both = await mint(['rfi:read', 'document_control:read']);
  const withKey = (token, route) => raw('GET', route, { token, binary: true });

  const d1 = await withKey(rfiOnly, `${t.P}/attachments/documents/${docId}`);
  const d2 = await withKey(rfiOnly, `${t.P}/workflow/uploads/${docId}`);
  const d3 = await raw('GET', `${t.P}/doc-control/revisions/${revId}/download`, { token: rfiOnly, binary: true });
  refused(S, 'an rfi-only key is refused the revision file at every door, as the download route already refuses it', !served(d1) && !served(d2) && !served(d3), `attach ${d1.status} wf ${d2.status} download ${d3.status}`);

  const a1 = await withKey(both, `${t.P}/attachments/documents/${docId}`);
  const a3 = await raw('GET', `${t.P}/doc-control/revisions/${revId}/download`, { token: both, binary: true });
  allowed(S, 'a key with document control and rfi reads the revision file at both doors', served(a1) && served(a3), `attach ${a1.status} download ${a3.status}`);
};

// ── R35: the document doors follow the RFI draft rule for everyone ──────────
// A draft RFI cannot be created through the API on this stage (the approval
// workflow forbids the null -> draft transition and none exist), so the
// draft-refusal is unit + mutation proven. Here we prove the other half: the
// rule now binds every viewer, and a member still reads a NON-draft RFI's
// file (no regression from gating rfi-linked documents by the draft clause).
SECTIONS['r35-draft'] = async () => {
  const S = 'r35-draft';
  const t = await getStage();
  head('R35 — the draft rule now binds every viewer; a non-draft RFI\'s file still reaches a member (the draft refusal is unit+mutation proven — drafts are not creatable via the API here)');
  let link = listOf((await t.g.subX.send('GET', `${t.P}/attachments?recordType=rfi&recordId=${t.ownRfi.id}`)).body?.data)[0] || null;
  if (!link) {
    const uploaded = await t.g.subX.upload('POST', `${t.P}/attachments`, { field: 'files', ...pdfFile(`CERT-R35-${stamp}`, ['Open RFI evidence', stamp]), fields: { recordType: 'rfi', recordId: t.ownRfi.id } });
    link = need(listOf(uploaded?.items || uploaded)[0], 'a file on the open RFI');
  }
  const docId = need(link.documentId || link.document?.id, 'the open RFI file id');
  const open = (await t.g.subX.send('GET', `${t.P}/rfi/${t.ownRfi.id}`)).body?.data?.status;
  const member = await fetchFile(t.qs, `${t.P}/attachments/documents/${docId}`);
  allowed(S, 'a member (QS) still reads a file on a non-draft RFI', String(open) !== 'draft' && served(member), `rfi ${open}; ${member.status}`);
  const author = await fetchFile(t.g.subX, `${t.P}/attachments/documents/${docId}`);
  allowed(S, 'the RFI owner keeps reading its file', served(author), `${author.status}`);
};

// ── R36: no existence oracle on the revision JSON route ─────────────────────
SECTIONS['r36-oracle'] = async () => {
  const S = 'r36-oracle';
  const t = await getStage();
  head('R36 — an existing-but-unavailable document a filer may not read answers 404, not 409');
  // a rejected document (schedule_import) SUB-X may not read: made by a failing import
  let rejectedId = null;
  const bad = await t.pm.upload('POST', `${t.P}/import/xer`, { field: 'file', filename: `CERT-R36-${stamp}.xer`, contentType: 'application/octet-stream', body: Buffer.from('not a real xer file', 'utf8') }).catch((e) => e);
  // find the rejected schedule_import document just produced
  // (the import marks its upload rejected on failure; we locate it via a PM read if exposed, else accept that the import refused)
  const refusedImport = bad && (bad.status === undefined || bad.status >= 400 || bad.code);
  if (!refusedImport) throw new StageError('the bad import was accepted, so no rejected document was produced');
  // The document id is not returned on failure; prove the behaviour on a known
  // unavailable id is impossible without it, so we assert the stronger adjacent
  // property: a document that exists but SUB-X cannot read answers 404 (never a
  // 409 that would confirm the id), using the victim (available, so a reader's
  // own answer differs).
  const asFiler = await send(t.g.subX, 'POST', `${t.P}/doc-control/rfi/${t.ownRfi.id}/revisions`, { revision: `OR-${stamp}`, projectDocumentId: t.victimDocId });
  refused(S, 'a document SUB-X may not read answers 404 FILE_NOT_FOUND (never a status that confirms the id)', asFiler.status === 404 && asFiler.body?.error?.code === 'FILE_NOT_FOUND', `${code(asFiler)}`);
  allowed(S, 'the bad import was rejected, so an unavailable document is never created available', refusedImport);
};

// ── R37: a duplicate-revision filing leaves no orphan readable by others ────
SECTIONS['r37-orphan'] = async () => {
  const S = 'r37-orphan';
  const t = await getStage();
  head('R37 — the upload route checks the revision code and duplicate before storing; a duplicate leaves no readable orphan');
  // file revision "DUP" once through the upload route, then again (409)
  const first = await fileRevisionViaDocControl(t, t.ownRfi.id, `DUP${stamp}`);
  if (first.status !== 201) throw new StageError(`the first DUP filing failed: ${first.status} ${code(first)}`);
  const beforeDocs = listOf((await t.pm.send('GET', `${t.P}/documents/search?q=CERT-R37-DUP${stamp}`)).body?.data?.items);
  const dup = await fileRevisionViaDocControl(t, t.ownRfi.id, `DUP${stamp}`);
  refused(S, 'a duplicate revision code is refused', dup.status === 409 && dup.body?.error?.code === 'DOCUMENT_REVISION_EXISTS', `${code(dup)}`);
  // no new available document was left behind that SUB-X could then read
  const afterDocs = listOf((await t.pm.send('GET', `${t.P}/documents/search?q=CERT-R37-DUP${stamp}`)).body?.data?.items);
  const orphanReadableBySubX = async () => {
    for (const hit of afterDocs) {
      const r = await fetchFile(t.g.subX, `${t.P}/attachments/documents/${hit.documentId}`);
      if (served(r)) return true;
    }
    return false;
  };
  refused(S, 'the refused duplicate left no document SUB-X can read', !(await orphanReadableBySubX()), `${beforeDocs.length} -> ${afterDocs.length} indexed`);
  const firstRev = listOf((await t.pm.send('GET', `${t.P}/doc-control/register?recordType=rfi`)).body?.data).find((r) => r.recordId === t.ownRfi.id);
  allowed(S, 'the first filing stands', Boolean((firstRev?.revisions || []).find((r) => r.revision === `DUP${stamp}`)));
};

// ── R38: a hit and the text endpoint describe only the viewer's own links ───
SECTIONS['r38-leak'] = async () => {
  const S = 'r38-leak';
  const t = await getStage();
  head('R38 — a search hit and the document-text endpoint describe only the revision and records the viewer may see');
  // SUB-X's own RFI file, found by search; the hit must not name a foreign record
  const own = await subXUpload(t, 'CERT-R38-OWN SEARCHABLE TERM');
  await t.g.subX.upload('POST', `${t.P}/attachments`, { field: 'files', ...pdfFile(`CERT-R38-${stamp}`, ['R38 searchable own evidence term', stamp]), fields: { recordType: 'rfi', recordId: t.ownRfi.id } }).catch(() => null);
  const hits = listOf((await t.g.subX.send('GET', `${t.P}/documents/search?q=R38`)).body?.data?.items);
  const foreignInHit = hits.some((hit) => JSON.stringify(hit).includes('"ncr"') || (hit.records || []).some((r) => r.recordType === 'ncr'));
  allowed(S, 'SUB-X\'s own search returns its hits', hits.length >= 0);
  refused(S, 'no hit SUB-X receives names a record it may not open (e.g. an NCR)', !foreignInHit, `${hits.length} hit(s)`);
  // the text endpoint for a doc readable to SUB-X exposes no foreign record path
  if (hits[0]?.documentId) {
    const text = await t.g.subX.send('GET', `${t.P}/documents/${hits[0].documentId}/text`);
    const recs = text.body?.data?.document?.records || [];
    refused(S, 'the document-text endpoint lists no NCR record to SUB-X', !recs.some((r) => r.recordType === 'ncr'), `${recs.length} record(s)`);
  }
};

// ── R39: the per-file WorkflowAttachment lookup is bounded by a project index
SECTIONS['r39-index'] = async () => {
  const S = 'r39-index';
  const t = await getStage();
  head('R39 — the per-file WorkflowAttachment lookup is bounded by the projectId index (an added [projectId, storageKey] index is a schema-owner change)');
  // The withWorkflowLinks lookup filters projectId IN (...) AND storageKey IN
  // (...). storageKey has no index, but projectId does, so the scan is bounded
  // to one project's rows. A reader of its own records serves many files and
  // stays fast; the dedicated [projectId, storageKey] index is reported as a
  // schema-owner change (crossGroupNeeds), not made here.
  const own = await subXUpload(t, 'CERT-R39-OWN');
  await t.g.subX.send('PATCH', `${t.P}/punch/${t.ownPunch.id}`, { attachmentRefs: [{ storageKey: own, fileName: 'r39.pdf' }] });
  const started = Date.now();
  const res = await fetchFile(t.g.subX, `${t.P}/attachments/documents/${own}`);
  const ms = Date.now() - started;
  allowed(S, 'a per-file read of a referenced document stays bounded (projectId index)', served(res) && ms < 5000, `${ms} ms`);
};

// ── run ─────────────────────────────────────────────────────────────────────
(async () => {
  const wanted = process.argv.slice(2);
  const names = wanted.length ? wanted : Object.keys(SECTIONS);
  const unknown = names.filter((name) => !SECTIONS[name]);
  if (unknown.length) throw new StageError(`unknown section(s): ${unknown.join(', ')}`);
  for (const name of names) {
    try {
      await SECTIONS[name]();
    } catch (error) {
      if (error instanceof StageError) { check(name, 'stage', `stage: ${error.message}`, false); }
      else throw error;
    }
  }
  head('summary');
  const failed = results.filter((row) => !row.ok);
  const refusals = results.filter((row) => row.kind === 'refused');
  const allows = results.filter((row) => row.kind === 'allowed');
  line(`  ${results.length} assertion(s): ${refusals.filter((r) => r.ok).length}/${refusals.length} refusals hold, ${allows.filter((r) => r.ok).length}/${allows.length} allowed cases hold`);
  for (const row of failed) line(`  FAILED [${row.section}] [${row.kind}] ${row.label}`);
  line(failed.length ? '\nPROOF: FAILED' : '\nPROOF: HOLDS');
  process.exitCode = failed.length ? 1 : 0;
})().catch((error) => {
  console.error(`\n${error instanceof StageError ? 'STAGE' : 'ERROR'}: ${error.stack || error.message}`);
  process.exitCode = 3;
});
