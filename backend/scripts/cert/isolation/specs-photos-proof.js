'use strict';

/**
 * Proof for the "specs-photos" group — the independent review's findings on
 * the specification routes, the photo gallery and its assistant, and the
 * workspace dashboard's RFI and submittal queues (R30, R31, R7), plus one
 * found while reproducing them (N1: PATCH /photos/:id).
 *
 * Every guard is shown twice: the refusal of the caller the record is not
 * theirs, AND the same request succeeding for the caller it belongs to — so a
 * fix that turned into a blanket refusal fails here too.
 *
 *   S1  (R30) GET /specifications/documents lists a document only to a reader
 *       of the record it is linked from
 *   S2  (R30) POST /specifications/index indexes only a document the caller
 *       may read — a hidden one is answered as a missing one, and a scan of
 *       the whole project neither indexes nor names it
 *   S3  (R30) GET /specifications lists the sections (and counts the
 *       divisions) of readable documents only
 *   S4  (R30) GET /specifications/:id and POST /:id/conflicts open a section
 *       of a readable document only (404 as a missing one)
 *   S5  (R30) GET /specifications/scope-gaps checks readable documents only
 *   S6  (R30) POST /specifications/:id/rfi raises from a readable section only
 *   S7  (R7)  a section's related RFIs are those the RFI register lists to the
 *       caller: party routing (a draft only to its author and manager is in
 *       the code, as the register has it, but no draft RFI can be made here)
 *   S8  (R7)  ... and only to a caller who may read RFIs (an API key scoped to
 *       document_control:read alone gets none; with rfi:read it gets them)
 *   S9  (R7)  GET /projects/workspace-dashboard lists and counts overdue RFIs
 *       and submittals exactly as the caller's own registers list them
 *   S10 (R31) GET /photos lists a photo, its records, its tags and the total
 *       only as the caller may read them
 *   S11 (R31) GET /photos/:id/file and /thumbnail serve a readable photo only
 *   S12 (R31) the photo assistant (/photos/:id/ai, /ai/analyze, /ai/apply,
 *       /ai/observation and the batch /photos/ai/analyze) works on readable
 *       photos only — an observation raised from a hidden photo attached that
 *       photo to the caller's own punch item
 *   S13 (N1)  PATCH /photos/:id edits a readable photo only
 *
 * Stage: project 072-01 (company 072): the PM, the planner (internal, not
 * party-scoped, no sub_pay_app read), and the party guests SUB-X, SUB-Y and
 * CONSULTANT (scripts/cert/leads/lib/party-visibility.js). The stage is made
 * through the API by the PM and found again on the next run:
 *   RFI-X   routed to SUB-X's party, spec section 09 90 00, overdue
 *   RFI-Y   routed to SUB-Y's party, spec section 09 90 00, overdue
 *   (no draft RFI: the RFI transition table has no edge into "draft")
 *   SUBM-X  a pending submittal routed to SUB-X's party, overdue
 *   D-X     a specification (03 30 00) attached to RFI-X
 *   D-OPEN  a specification (09 90 00) uploaded and linked to nothing
 *   D-PAY   a specification (05 12 00) attached to a subcontractor pay app
 *   P-X     a photo attached to RFI-X (tagged cert-sp-x-secret)
 *   P-OPEN  a photo attached to a location AND to RFI-X
 *
 * The certification API runs without the job worker (JOB_WORKER_ENABLED is
 * false), so no document's text is ever extracted on this bed. In process,
 * the proof runs the product's own extraction step (document-text.service
 * runDocumentExtractJob — what the worker runs for a document.extract job)
 * for D-X, D-OPEN and D-PAY only, once, when their text is not ready. Lookups
 * of the proof's own documents by name are read-only (cert-env connectCert).
 * A run without the guards (the reproduction, a mutation) leaves residue that
 * the next stage undoes through the API: P-X's tags and caption are reset, and
 * P-X is unlinked from every observation the consultant raised from it.
 *
 * Run the guest set-up once WITHOUT CERT_INPROCESS (the invitation link is
 * read from the certification API's log), then the proof in process:
 *
 *   node scripts/cert/isolation/specs-photos-proof.js --setup-guests
 *   $env:DATABASE_URL = $null; $env:CERT_INPROCESS = "1"; node scripts/cert/isolation/specs-photos-proof.js [--only=S1,S9]
 *
 * Exit 0 = every refusal and every allowed case holds; 2 = a refusal failed
 * (a defect is present); 3 = only an allowed case failed (over-blocking);
 * 1 = the script itself failed.
 */

const zlib = require('zlib');
const crypto = require('crypto');
const pv = require('../leads/lib/party-visibility');
const { pdf } = require('../leads/_files-fixture');
const { connectCert } = require('../lib/cert-env');

const ONLY = (process.argv.find((arg) => arg.startsWith('--only=')) || '').slice('--only='.length).split(',').filter(Boolean);
const wants = (...guards) => !ONLY.length || guards.some((guard) => ONLY.includes(guard));
const INPROCESS = process.env.CERT_INPROCESS === '1';
const MISSING = '0b5e2c1a-7d4f-4e3a-9c1b-2f6d8e0a4b7c';
const results = [];

const check = (guard, kind, label, pass, detail = '') => {
  results.push({ guard, kind, label, pass: Boolean(pass), detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${guard.padEnd(3)} ${kind.padEnd(6)} ${label}${detail ? ` — ${detail}` : ''}`);
};
const said = (res) => `${res.status} ${res.body?.error?.code || ''}`.trim();
const data = (res) => res.body?.data;
const ok = (res) => res.status >= 200 && res.status < 300;
const same = (a, b) => a.status === b.status && (a.body?.error?.code || null) === (b.body?.error?.code || null) && (a.body?.error?.message || null) === (b.body?.error?.message || null);
const listOf = (value) => (Array.isArray(value) ? value : value?.items || value?.rows || value?.records || []);
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const head = (title) => console.log(`\n── ${title} ${'─'.repeat(Math.max(4, 74 - title.length))}`);

class StageError extends Error {}
const need = (value, what) => {
  if (!value) throw new StageError(`the stage lacks ${what}`);
  return value;
};

// ── files ───────────────────────────────────────────────────────────────────
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, body) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
};
/** A small valid PNG whose pixels follow `seed`, so each photo has its own bytes. */
const png = (seed) => {
  const width = 4;
  const height = 4;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = 1 + width * 3;
  const raw = Buffer.alloc(height * row);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width * 3; x += 1) raw[y * row + 1 + x] = (seed.charCodeAt(x % seed.length) * (y + 3)) & 255;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
};

/** A specification of one CSI section, long enough (over 300 words) for a project scan to pick it up. */
const specLines = ({ code, title, secret, words }) => [
  `SECTION ${code} - ${title}`,
  'PART 1 - GENERAL',
  `1.01 SUMMARY: This section specifies ${words}. ${secret}`,
  ...Array.from({ length: 12 }, (_, i) => `1.${String(i + 2).padStart(2, '0')} REQUIREMENT ${i + 1}: The contractor shall provide ${words} to the approved samples, standards and tolerances.`),
  'PART 2 - PRODUCTS',
  ...Array.from({ length: 10 }, (_, i) => `2.${String(i + 1).padStart(2, '0')} PRODUCT ${i + 1}: Materials for ${words} shall be new, of one manufacturer and stored dry on site.`),
  'PART 3 - EXECUTION',
  ...Array.from({ length: 10 }, (_, i) => `3.${String(i + 1).padStart(2, '0')} EXECUTION ${i + 1}: Install ${words} in accordance with the manufacturer's written instructions.`),
  'END OF SECTION',
];
const DOCS = {
  x: { name: 'CERT-SP-SPEC-X.pdf', code: '03 30 00', title: 'CAST-IN-PLACE CONCRETE', secret: 'CERT-SP-X-SECRET concrete grade C40 for the inlet chamber', words: 'cast-in-place concrete, formwork and reinforcement' },
  open: { name: 'CERT-SP-SPEC-OPEN.pdf', code: '09 90 00', title: 'PAINTING AND COATING', secret: 'CERT-SP-OPEN-TEXT acrylic finish', words: 'painting and coating of plastered surfaces' },
  pay: { name: 'CERT-SP-SPEC-PAY.pdf', code: '05 12 00', title: 'STRUCTURAL STEEL FRAMING', secret: 'CERT-SP-PAY-SECRET agreed steel rate 4,250 per tonne', words: 'structural steel framing and bolted connections' },
};
const pdfOf = (doc) => ({ filename: doc.name, contentType: 'application/pdf', body: pdf(specLines(doc)) });

// ── read-only lookups of the proof's own documents ──────────────────────────
let pg = null;
const db = async () => {
  pg ||= await connectCert();
  return pg;
};
const documentByName = async (projectId, name) => {
  const client = await db();
  const rows = (await client.query('select d.id, d."orgId" as "orgId", t.status as "textStatus" from "ProjectDocument" d left join "DocumentText" t on t."documentId" = d.id where d."projectId" = $1 and d."originalName" = $2 order by d."uploadedAt" asc limit 1', [projectId, name])).rows;
  return rows[0] || null;
};

// ── the stage ───────────────────────────────────────────────────────────────
const stage = async () => {
  const s = await pv.setup();
  const P = s.projectId;
  const B = `/projects/${P}`;
  const PM = s.pm;
  const planner = pv.api.as(`planner@c${pv.CODE}.octapm-cert.test`);
  const partyX = need(s.parties.subcontractor, "SUB-X's party");
  const partyY = need(s.parties.subcontractorY, "SUB-Y's party");
  const PAST = '2026-01-15T00:00:00.000Z';

  const findRfi = async (subject) => listOf(data(await PM.send('GET', `${B}/rfi?limit=100&search=${encodeURIComponent(subject)}`))).find((row) => row.subject === subject) || null;
  const rfiOf = async (subject, body) => {
    const found = await findRfi(subject);
    if (found) return found;
    const made = await PM.send('POST', `${B}/rfi`, { subject, question: `${subject}: which coating system applies?`, priority: 'normal', specSection: '09 90 00', responseRequiredBy: PAST, ...body });
    if (made.status !== 201) throw new StageError(`the PM could not raise "${subject}": ${said(made)} ${JSON.stringify(made.body?.error?.details || '').slice(0, 300)}`);
    console.log(`  (set-up) raised ${data(made).ref} "${subject}"`);
    return data(made);
  };
  const rfiX = await rfiOf('CERT-SP R7 RFI routed to SUB-X only', { ownerPartyId: partyX, status: 'open' });
  const rfiY = await rfiOf('CERT-SP R7 RFI routed to SUB-Y only', { ownerPartyId: partyY, status: 'open' });

  const subjectS = 'CERT-SP R7 submittal routed to SUB-X only';
  let submittalX = listOf(data(await PM.send('GET', `${B}/submittals?limit=100&search=${encodeURIComponent(subjectS)}`))).find((row) => row.title === subjectS) || null;
  if (!submittalX) {
    const made = await PM.send('POST', `${B}/submittals`, { title: subjectS, ownerPartyId: partyX, dueDate: PAST });
    if (made.status !== 201) throw new StageError(`the PM could not file the submittal: ${said(made)}`);
    submittalX = data(made);
    console.log(`  (set-up) filed ${submittalX.ref} "${subjectS}"`);
  }

  // the documents
  const attach = async (recordType, recordId, file) => PM.upload('POST', `${B}/attachments`, { field: 'files', ...file, fields: { recordType, recordId } });
  const payApp = need(listOf(data(await PM.send('GET', `${B}/pay-apps`)))[0], 'a subcontractor payment application on 072-01');
  if (!(await documentByName(P, DOCS.x.name))) await attach('rfi', rfiX.id, pdfOf(DOCS.x));
  if (!(await documentByName(P, DOCS.pay.name))) await attach('sub_pay_app', payApp.id, pdfOf(DOCS.pay));
  if (!(await documentByName(P, DOCS.open.name))) await PM.upload('POST', `${B}/workflow/uploads`, { field: 'files', ...pdfOf(DOCS.open) });
  const doc = {};
  for (const [key, spec] of Object.entries(DOCS)) {
    let row = need(await documentByName(P, spec.name), `the uploaded ${spec.name}`);
    if (row.textStatus !== 'ready') {
      if (!INPROCESS) throw new StageError(`the text of ${spec.name} is not extracted; run the proof in process once (CERT_INPROCESS=1)`);
      // The worker's step for this document's document.extract job (the bed runs no worker).
      // eslint-disable-next-line global-require
      const extracted = await require('../../../src/services/document-text.service').runDocumentExtractJob({ job: { orgId: row.orgId }, payload: { documentId: row.id } });
      console.log(`  (set-up) extracted ${spec.name}: ${extracted.status}, ${extracted.wordCount} words`);
      row = await documentByName(P, spec.name);
      if (row.textStatus !== 'ready') throw new StageError(`${spec.name} did not extract (${row.textStatus})`);
    }
    doc[key] = row.id;
  }
  const indexed = data(await PM.send('POST', `${B}/specifications/index`, { documentIds: Object.values(doc) }));
  if (!indexed || indexed.documents.some((row) => row.error || !row.sections)) throw new StageError(`the PM could not index the specifications: ${JSON.stringify(indexed)}`);
  const sectionsAll = listOf(data(await PM.send('GET', `${B}/specifications`)));
  const section = {};
  for (const [key, spec] of Object.entries(DOCS)) section[key] = need(sectionsAll.find((row) => row.documentId === doc[key] && row.code === spec.code), `the section ${spec.code} of ${spec.name}`).id;

  // No draft RFI can be made on this bed: the RFI transition table has no
  // edge into "draft", so POST /rfi with status draft, the specification's
  // "raise a draft RFI" and the assistant's create_rfi all answer 409
  // APPROVAL_WORKFLOW_INVALID_TRANSITION, and the certification database
  // holds no draft RFI. The draft half of R7 is therefore not staged here.

  // the photos
  const photoOn = async (recordType, recordId, name) => {
    const links = listOf(data(await PM.send('GET', `${B}/attachments?recordType=${recordType}&recordId=${recordId}`)));
    let link = links.find((row) => row.document?.originalName === name);
    if (!link) {
      await attach(recordType, recordId, { filename: name, contentType: 'image/png', body: png(name) });
      link = listOf(data(await PM.send('GET', `${B}/attachments?recordType=${recordType}&recordId=${recordId}`))).find((row) => row.document?.originalName === name);
      console.log(`  (set-up) attached ${name} to ${recordType} ${recordId}`);
    }
    return need(link?.photo, `the photo ${name}`);
  };
  const location = need(listOf(data(await PM.send('GET', `${B}/locations`)))[0], 'a location on 072-01');
  const photoX = await photoOn('rfi', rfiX.id, 'CERT-SP-PHOTO-X.png');
  const photoOpen = await photoOn('location', location.id, 'CERT-SP-PHOTO-OPEN.png');
  const onRfiX = listOf(data(await PM.send('GET', `${B}/attachments?recordType=rfi&recordId=${rfiX.id}`)));
  if (!onRfiX.some((row) => row.documentId === photoOpen.documentId)) {
    await PM.send('POST', `${B}/attachments`, { recordType: 'rfi', recordId: rfiX.id, documentIds: [photoOpen.documentId], role: 'reference' });
    console.log('  (set-up) linked P-OPEN to RFI-X as well');
  }
  if (!(photoOpen.tags || []).includes('cert-sp-open')) await PM.PATCH(`${B}/photos/${photoOpen.id}`, { tags: ['cert-sp-open'] });
  // P-X as the stage wants it, whatever an earlier run without the guards left
  // on it: its own tag only, the stage's caption.
  const tagsX = (photoX.tags || []).filter((tag) => tag !== 'cert-sp-by-sub-y');
  if (!tagsX.includes('cert-sp-x-secret')) tagsX.push('cert-sp-x-secret');
  await PM.PATCH(`${B}/photos/${photoX.id}`, { tags: tagsX, caption: 'CERT-SP P-X (stage caption)' });
  // An observation raised from P-X by the consultant on a run without the
  // guard attached P-X to the consultant's own punch item, which made P-X
  // readable to it: the PM unlinks P-X from every such punch item.
  const observations = listOf(data(await PM.send('GET', `${B}/punch?kind=observation&limit=200&search=${encodeURIComponent('CERT-SP S12 observation')}`)));
  for (const item of observations) {
    const links = listOf(data(await PM.send('GET', `${B}/attachments?recordType=punch_item&recordId=${item.id}`)));
    for (const link of links.filter((row) => row.documentId === photoX.documentId)) {
      const removed = await PM.send('DELETE', `${B}/attachments/${link.id}`);
      console.log(`  (set-up) unlinked P-X from the consultant's ${item.ref}: ${said(removed)}`);
    }
  }

  return { ...s, P, B, PM, planner, X: s.subX, Y: s.subY, C: s.consultant, partyX, partyY, rfiX, rfiY, submittalX, payApp, doc, section, photoX, photoOpen, location };
};

// ── the checks ──────────────────────────────────────────────────────────────
const run = async () => {
  if (process.argv.includes('--setup-guests')) {
    if (INPROCESS) throw new Error('--setup-guests runs against the certification API (no CERT_INPROCESS): the invitation link is read from its log');
    const s = await pv.setup();
    console.log(`guests ready on ${s.projectId}: SUB-X, SUB-Y, CONSULTANT (party ${s.parties.subcontractorY})`);
    return;
  }
  if (!INPROCESS) console.log('NOTE: not in process — this run exercises the certification API, not the working tree.');
  const t = await stage();
  const { B, PM, planner, X, Y, C } = t;
  console.log(`specs-photos proof — project ${t.P} (072-01)${ONLY.length ? `, only ${ONLY.join(',')}` : ''}`);
  console.log(`  RFI-X ${t.rfiX.ref}, RFI-Y ${t.rfiY.ref}, SUBM-X ${t.submittalX.ref}; D-X ${t.doc.x}, D-OPEN ${t.doc.open}, D-PAY ${t.doc.pay}; P-X ${t.photoX.id}, P-OPEN ${t.photoOpen.id}`);

  // ── S1 ────────────────────────────────────────────────────────────────────
  if (wants('S1')) {
    head('S1 (R30) GET /specifications/documents');
    const ids = async (who) => listOf(data(await who.send('GET', `${B}/specifications/documents`))).map((row) => row.id);
    const pm = await ids(PM);
    const x = await ids(X);
    const y = await ids(Y);
    const pl = await ids(planner);
    check('S1', 'allow', 'the PM lists D-X, D-OPEN and D-PAY', [t.doc.x, t.doc.open, t.doc.pay].every((id) => pm.includes(id)), `${pm.length} listed`);
    check('S1', 'allow', 'SUB-X lists D-X (on its own RFI) and D-OPEN', x.includes(t.doc.x) && x.includes(t.doc.open));
    check('S1', 'refuse', 'SUB-X does not list D-PAY (a pay app document)', !x.includes(t.doc.pay));
    check('S1', 'allow', 'SUB-Y lists D-OPEN', y.includes(t.doc.open));
    check('S1', 'refuse', "SUB-Y lists neither D-X (on SUB-X's RFI) nor D-PAY", !y.includes(t.doc.x) && !y.includes(t.doc.pay), `${y.length} listed`);
    check('S1', 'allow', 'the planner lists D-X and D-OPEN', pl.includes(t.doc.x) && pl.includes(t.doc.open));
    check('S1', 'refuse', 'the planner (no sub_pay_app read) does not list D-PAY', !pl.includes(t.doc.pay));
  }

  // ── S2 ────────────────────────────────────────────────────────────────────
  if (wants('S2')) {
    head('S2 (R30) POST /specifications/index');
    const index = (who, body) => who.send('POST', `${B}/specifications/index`, body);
    const hidden = await index(planner, { documentIds: [t.doc.pay] });
    const missing = await index(planner, { documentIds: [MISSING] });
    const hiddenRow = data(hidden)?.documents?.[0];
    const missingRow = data(missing)?.documents?.[0];
    check('S2', 'refuse', 'the planner indexing D-PAY gets the answer of a missing document', ok(hidden) && hiddenRow?.sections === 0 && hiddenRow?.error && hiddenRow.error === missingRow?.error && !hiddenRow.title, `${JSON.stringify(hiddenRow)} vs ${JSON.stringify(missingRow)}`);
    const own = await index(planner, { documentIds: [t.doc.x] });
    check('S2', 'allow', 'the planner indexes D-X (a document it may read)', ok(own) && data(own)?.documents?.[0]?.sections >= 1 && !data(own)?.documents?.[0]?.error, JSON.stringify(data(own)?.documents?.[0]));
    const scan = await index(planner, {});
    const scanned = (data(scan)?.documents || []).map((row) => row.documentId);
    check('S2', 'refuse', "the planner's project scan neither indexes nor names D-PAY", ok(scan) && !scanned.includes(t.doc.pay), `${scanned.length} scanned`);
    check('S2', 'allow', "the planner's project scan indexes D-X and D-OPEN", scanned.includes(t.doc.x) && scanned.includes(t.doc.open));
    const pmScan = await index(PM, {});
    const pmScanned = (data(pmScan)?.documents || []).map((row) => row.documentId);
    check('S2', 'allow', "the PM's project scan indexes D-X, D-OPEN and D-PAY", [t.doc.x, t.doc.open, t.doc.pay].every((id) => pmScanned.includes(id)), `${pmScanned.length} scanned`);
    t.section = Object.fromEntries(await Promise.all(Object.entries(DOCS).map(async ([key, spec]) => [key, listOf(data(await PM.send('GET', `${B}/specifications`))).find((row) => row.documentId === t.doc[key] && row.code === spec.code)?.id])));
  }

  // ── S3 ────────────────────────────────────────────────────────────────────
  if (wants('S3')) {
    head('S3 (R30) GET /specifications');
    const list = async (who, query = '') => data(await who.send('GET', `${B}/specifications${query}`)) || {};
    const pm = await list(PM);
    const y = await list(Y);
    const pmDocs = new Set(listOf(pm).map((row) => row.documentId));
    const yDocs = new Set(listOf(y).map((row) => row.documentId));
    check('S3', 'allow', "the PM lists the sections of D-X, D-OPEN and D-PAY", [t.doc.x, t.doc.open, t.doc.pay].every((id) => pmDocs.has(id)));
    check('S3', 'allow', 'SUB-Y lists the section of D-OPEN', yDocs.has(t.doc.open));
    check('S3', 'refuse', 'SUB-Y lists no section of D-X or D-PAY', !yDocs.has(t.doc.x) && !yDocs.has(t.doc.pay), `${listOf(y).length} listed`);
    const division = (answer, code) => (answer.divisions || []).find((row) => row.division === code)?.count || 0;
    check('S3', 'refuse', "SUB-Y's divisions and total count only its sections", y.total === listOf(y).length && division(y, '03') === listOf(y).filter((row) => row.division === '03').length && division(y, '05') === listOf(y).filter((row) => row.division === '05').length, `total ${y.total}, listed ${listOf(y).length}, div 03 ${division(y, '03')}, div 05 ${division(y, '05')}`);
    check('S3', 'allow', "the PM's divisions count D-X's and D-PAY's sections", division(pm, '03') >= 1 && division(pm, '05') >= 1 && pm.total >= listOf(pm).length);
    const yOnX = await list(Y, `?documentId=${t.doc.x}`);
    check('S3', 'refuse', "SUB-Y filtering by D-X's id gets nothing", listOf(yOnX).length === 0);
    const xOnX = await list(X, `?documentId=${t.doc.x}`);
    check('S3', 'allow', "SUB-X filtering by D-X's id gets its section", listOf(xOnX).some((row) => row.id === t.section.x));
  }

  // ── S4 ────────────────────────────────────────────────────────────────────
  if (wants('S4')) {
    head('S4 (R30) GET /specifications/:id and POST /:id/conflicts');
    const open = (who, id) => who.send('GET', `${B}/specifications/${id}`);
    const missing = await open(Y, MISSING);
    const yOnX = await open(Y, t.section.x);
    check('S4', 'refuse', "SUB-Y opening D-X's section is answered as a missing section", !ok(yOnX) && same(yOnX, missing) && !JSON.stringify(yOnX.body).includes('CERT-SP-X-SECRET'), `${said(yOnX)} vs ${said(missing)}`);
    const xOnX = await open(X, t.section.x);
    check('S4', 'allow', "SUB-X opens D-X's section with its text", ok(xOnX) && String(data(xOnX)?.text).includes('CERT-SP-X-SECRET'), said(xOnX));
    const plOnPay = await open(planner, t.section.pay);
    check('S4', 'refuse', "the planner opening D-PAY's section is answered as a missing section", !ok(plOnPay) && same(plOnPay, await open(planner, MISSING)) && !JSON.stringify(plOnPay.body).includes('CERT-SP-PAY-SECRET'), said(plOnPay));
    const pmOnPay = await open(PM, t.section.pay);
    check('S4', 'allow', "the PM opens D-PAY's section with its text", ok(pmOnPay) && String(data(pmOnPay)?.text).includes('CERT-SP-PAY-SECRET'), said(pmOnPay));
    const yOpen = await open(Y, t.section.open);
    check('S4', 'allow', "SUB-Y opens D-OPEN's section", ok(yOpen) && String(data(yOpen)?.text).includes('CERT-SP-OPEN-TEXT'), said(yOpen));
    const conflicts = (who, id) => who.send('POST', `${B}/specifications/${id}/conflicts`, {});
    const yConf = await conflicts(Y, t.section.x);
    check('S4', 'refuse', "SUB-Y's conflict check on D-X's section is answered as a missing section", !ok(yConf) && same(yConf, await conflicts(Y, MISSING)), said(yConf));
    const xConf = await conflicts(X, t.section.x);
    check('S4', 'allow', "SUB-X runs the conflict check on D-X's section", ok(xConf) && data(xConf)?.section?.id === t.section.x, said(xConf));
  }

  // ── S5 ────────────────────────────────────────────────────────────────────
  if (wants('S5')) {
    head('S5 (R30) GET /specifications/scope-gaps');
    const gaps = async (who) => data(await who.send('GET', `${B}/specifications/scope-gaps`)) || {};
    const y = await gaps(Y);
    const pm = await gaps(PM);
    const ySections = (y.sections || []).map((row) => row.id);
    const pmSections = (pm.sections || []).map((row) => row.id);
    check('S5', 'refuse', "SUB-Y's scope check holds no section of D-X or D-PAY", !ySections.includes(t.section.x) && !ySections.includes(t.section.pay) && y.summary?.sections === ySections.length, `${ySections.length} sections`);
    check('S5', 'allow', "SUB-Y's scope check holds D-OPEN's section", ySections.includes(t.section.open));
    check('S5', 'allow', "the PM's scope check holds all three", [t.section.x, t.section.open, t.section.pay].every((id) => pmSections.includes(id)));
  }

  // ── S6 ────────────────────────────────────────────────────────────────────
  if (wants('S6')) {
    head('S6 (R30) POST /specifications/:id/rfi');
    const raise = (who, id) => who.send('POST', `${B}/specifications/${id}/rfi`, { subject: 'CERT-SP S6 raised from a section' });
    const yOnX = await raise(Y, t.section.x);
    check('S6', 'refuse', "SUB-Y raising an RFI from D-X's section is answered as a missing section", !ok(yOnX) && same(yOnX, await raise(Y, MISSING)), said(yOnX));
    const xOnX = await raise(X, t.section.x);
    check('S6', 'allow', "SUB-X's request on D-X's section gets past the section (201, or the transition table's 409 that every draft RFI gets here)", xOnX.status === 201 || xOnX.body?.error?.code === 'APPROVAL_WORKFLOW_INVALID_TRANSITION', said(xOnX));
  }

  // ── S7 ────────────────────────────────────────────────────────────────────
  if (wants('S7')) {
    head("S7 (R7) a section's related RFIs follow the RFI register");
    const related = async (who) => {
      const res = await who.send('GET', `${B}/specifications/${t.section.open}`);
      return new Set((data(res)?.related?.rfis || []).map((row) => row.id));
    };
    const pm = await related(PM);
    const x = await related(X);
    const y = await related(Y);
    const pl = await related(planner);
    check('S7', 'allow', 'the PM sees RFI-X and RFI-Y', pm.has(t.rfiX.id) && pm.has(t.rfiY.id));
    check('S7', 'allow', 'SUB-X sees RFI-X (routed to it)', x.has(t.rfiX.id));
    check('S7', 'refuse', 'SUB-X does not see RFI-Y', !x.has(t.rfiY.id));
    check('S7', 'allow', 'SUB-Y sees RFI-Y (routed to it)', y.has(t.rfiY.id));
    check('S7', 'refuse', 'SUB-Y does not see RFI-X', !y.has(t.rfiX.id));
    check('S7', 'allow', 'the planner sees RFI-X and RFI-Y', pl.has(t.rfiX.id) && pl.has(t.rfiY.id));
    const conflicts = await Y.send('POST', `${B}/specifications/${t.section.open}/conflicts`, {});
    const conflictIds = (data(conflicts)?.related?.rfis || []).map((row) => row.id);
    check('S7', 'refuse', "SUB-Y's conflict check carries no RFI-X", ok(conflicts) && !conflictIds.includes(t.rfiX.id) && conflictIds.includes(t.rfiY.id), said(conflicts));
    const gapCount = async (who) => ((data(await who.send('GET', `${B}/specifications/scope-gaps`))?.sections || []).find((row) => row.id === t.section.open)?.counts?.rfis);
    const yCount = await gapCount(Y);
    const pmCount = await gapCount(PM);
    check('S7', 'refuse', "SUB-Y's scope check counts only the RFIs it sees", yCount === y.size, `${yCount} counted, ${y.size} seen`);
    check('S7', 'allow', "the PM's scope check counts the RFIs it sees", pmCount === pm.size, `${pmCount} counted, ${pm.size} seen`);
  }

  // ── S8 ────────────────────────────────────────────────────────────────────
  if (wants('S8')) {
    head('S8 (R7) related RFIs need RFI read (API keys)');
    const keys = [];
    try {
      for (const scopes of [['document_control:read'], ['document_control:read', 'rfi:read']]) {
        const made = await PM.send('POST', '/integrations/api-clients', { name: `CERT-SP key ${scopes.join('+')} ${Date.now().toString(36)}`, scopes, projectIds: [t.P] });
        const token = data(made)?.token || data(made)?.key || data(made)?.secret;
        if (made.status !== 201 || !token) throw new StageError(`an API key could not be made (${said(made)})`);
        keys.push({ id: data(made).id, token, scopes });
      }
      const [docOnly, withRfi] = keys;
      const asKey = (key) => pv.api.raw('GET', `${B}/specifications/${t.section.open}`, { token: key.token });
      const a = await asKey(docOnly);
      check('S8', 'refuse', 'a key scoped to document_control:read gets the section without RFIs', a.status === 200 && (a.body?.data?.related?.rfis || []).length === 0, `${a.status} ${(a.body?.data?.related?.rfis || []).length} RFIs`);
      const b = await asKey(withRfi);
      const ids = (b.body?.data?.related?.rfis || []).map((row) => row.id);
      check('S8', 'allow', 'a key with rfi:read as well gets the related RFIs', b.status === 200 && ids.includes(t.rfiX.id) && ids.includes(t.rfiY.id), `${b.status} ${ids.length} RFIs`);
    } finally {
      for (const key of keys) await PM.send('DELETE', `/integrations/api-clients/${key.id}`);
    }
  }

  // ── S9 ────────────────────────────────────────────────────────────────────
  if (wants('S9')) {
    head('S9 (R7) GET /projects/workspace-dashboard overdue RFI and submittal queues');
    const now = Date.now();
    const pages = async (who, route) => {
      const rows = [];
      let cursor = null;
      for (let i = 0; i < 50; i += 1) {
        const res = await who.send('GET', `${route}?limit=100${cursor ? `&cursor=${cursor}` : ''}`);
        if (!ok(res)) return rows;
        rows.push(...listOf(data(res)));
        cursor = data(res)?.pagination?.nextCursor || null;
        if (!cursor) break;
      }
      return rows;
    };
    // What the caller's own registers list as overdue, judged as the dashboard judges it.
    const registers = async (who) => {
      const projects = listOf(data(await who.send('GET', '/projects?limit=100')));
      const rfis = new Set();
      const submittals = new Set();
      for (const project of projects) {
        for (const row of await pages(who, `/projects/${project.id}/rfi`)) {
          const due = row.responseRequiredBy || row.dueDate;
          if (due && new Date(due).getTime() < now && !['answered', 'closed'].includes(String(row.status).toLowerCase())) rfis.add(row.id);
        }
        for (const row of await pages(who, `/projects/${project.id}/submittals`)) {
          if (row.dueDate && new Date(row.dueDate).getTime() < now && ['pending', 'under_review', 'resubmit'].includes(String(row.status).toLowerCase())) submittals.add(row.id);
        }
      }
      return { rfis, submittals, projects: projects.length };
    };
    const queues = async (who) => {
      const res = await who.send('GET', '/projects/workspace-dashboard');
      const all = data(res)?.workflowQueues || [];
      const q = (key) => all.find((row) => row.key === key) || { count: null, items: [] };
      return { status: res.status, rfis: q('overdueRfis'), submittals: q('overdueSubmittals') };
    };
    for (const [label, who, kind] of [['SUB-Y', Y, 'refuse'], ['SUB-X', X, 'refuse'], ['the planner', planner, 'allow'], ['the PM', PM, 'allow']]) {
      const reg = await registers(who);
      const dash = await queues(who);
      const rfiItems = dash.rfis.items.map((row) => row.id);
      const subItems = dash.submittals.items.map((row) => row.id);
      check('S9', kind, `${label}: overdue RFIs counted and listed as its registers list them`, dash.status === 200 && dash.rfis.count === reg.rfis.size && rfiItems.every((id) => reg.rfis.has(id)), `dashboard ${dash.rfis.count}, registers ${reg.rfis.size} over ${reg.projects} project(s)`);
      check('S9', kind, `${label}: overdue submittals counted and listed as its registers list them`, dash.status === 200 && dash.submittals.count === reg.submittals.size && subItems.every((id) => reg.submittals.has(id)), `dashboard ${dash.submittals.count}, registers ${reg.submittals.size}`);
      if (who === X) check('S9', 'allow', 'SUB-X keeps RFI-X and SUBM-X among its overdue records', reg.rfis.has(t.rfiX.id) && reg.submittals.has(t.submittalX.id));
      if (who === Y) check('S9', 'refuse', "RFI-X and SUBM-X are not SUB-Y's", !reg.rfis.has(t.rfiX.id) && !reg.submittals.has(t.submittalX.id) && !rfiItems.includes(t.rfiX.id) && !subItems.includes(t.submittalX.id));
      if (who === PM) check('S9', 'allow', 'the PM keeps RFI-X, RFI-Y and SUBM-X', [t.rfiX.id, t.rfiY.id].every((id) => reg.rfis.has(id)) && reg.submittals.has(t.submittalX.id));
    }
  }

  // ── S10 ───────────────────────────────────────────────────────────────────
  if (wants('S10')) {
    head('S10 (R31) GET /photos');
    const gallery = async (who, query = '') => {
      const items = [];
      let summary = null;
      let cursor = null;
      let first = null;
      for (let i = 0; i < 40; i += 1) {
        const res = await who.send('GET', `${B}/photos?limit=7${query}${cursor ? `&cursor=${cursor}` : ''}`);
        first ||= res;
        if (!ok(res)) break;
        items.push(...listOf(data(res)));
        summary ||= data(res)?.summary;
        cursor = data(res)?.pagination?.nextCursor || null;
        if (!cursor) break;
      }
      return { status: first?.status, items, summary: summary || {}, ids: items.map((row) => row.id) };
    };
    const pm = await gallery(PM);
    const x = await gallery(X);
    const y = await gallery(Y);
    check('S10', 'allow', 'the PM lists P-X and P-OPEN', pm.ids.includes(t.photoX.id) && pm.ids.includes(t.photoOpen.id), `${pm.items.length} photos`);
    check('S10', 'allow', 'SUB-X lists P-X (on its RFI) and P-OPEN', x.ids.includes(t.photoX.id) && x.ids.includes(t.photoOpen.id));
    check('S10', 'allow', 'SUB-Y lists P-OPEN (on a location)', y.ids.includes(t.photoOpen.id));
    check('S10', 'refuse', "SUB-Y does not list P-X (on SUB-X's RFI)", !y.ids.includes(t.photoX.id) && !y.items.some((row) => row.documentId === t.photoX.documentId), `${y.items.length} photos`);
    check('S10', 'refuse', 'SUB-Y pages through without repeats', new Set(y.ids).size === y.ids.length);
    const recordsOf = (answer, id) => (answer.items.find((row) => row.id === id)?.records || []).map((row) => `${row.recordType}:${row.recordId}`);
    check('S10', 'refuse', "SUB-Y does not see P-OPEN's link to RFI-X", !recordsOf(y, t.photoOpen.id).includes(`rfi:${t.rfiX.id}`), JSON.stringify(recordsOf(y, t.photoOpen.id)));
    check('S10', 'allow', "SUB-Y sees P-OPEN's link to its location; SUB-X and the PM see its link to RFI-X", recordsOf(y, t.photoOpen.id).includes(`location:${t.location.id}`) && recordsOf(x, t.photoOpen.id).includes(`rfi:${t.rfiX.id}`) && recordsOf(pm, t.photoOpen.id).includes(`rfi:${t.rfiX.id}`));
    const tags = (answer) => (answer.summary.tags || []).map((row) => row.tag);
    check('S10', 'refuse', "SUB-Y's summary counts only its photos and their tags", y.summary.total === y.items.length && !tags(y).includes('cert-sp-x-secret'), `total ${y.summary.total}, listed ${y.items.length}, tags ${tags(y).length}`);
    check('S10', 'allow', "the PM's and SUB-X's summaries count P-X's tag", tags(pm).includes('cert-sp-x-secret') && tags(x).includes('cert-sp-x-secret') && pm.summary.total === pm.items.length);
    const yByRfi = await gallery(Y, `&recordType=rfi&recordId=${t.rfiX.id}`);
    check('S10', 'refuse', 'SUB-Y filtering the gallery by RFI-X gets nothing', yByRfi.items.length === 0, `${yByRfi.status} ${yByRfi.items.length}`);
    const xByRfi = await gallery(X, `&recordType=rfi&recordId=${t.rfiX.id}`);
    check('S10', 'allow', 'SUB-X filtering by RFI-X gets P-X and P-OPEN', xByRfi.ids.includes(t.photoX.id) && xByRfi.ids.includes(t.photoOpen.id));
  }

  // ── S11 ───────────────────────────────────────────────────────────────────
  if (wants('S11')) {
    head('S11 (R31) GET /photos/:id/file and /thumbnail');
    const file = (who, id, variant) => who.send('GET', `${B}/photos/${id}/${variant}`, undefined, { binary: true });
    for (const variant of ['file', 'thumbnail']) {
      const pmFile = await file(PM, t.photoX.id, variant);
      const wanted = pmFile.buffer ? sha(pmFile.buffer) : null;
      check('S11', 'allow', `the PM gets P-X's ${variant}`, Boolean(wanted), said(pmFile));
      const xFile = await file(X, t.photoX.id, variant);
      check('S11', 'allow', `SUB-X gets P-X's ${variant}`, Boolean(xFile.buffer) && sha(xFile.buffer) === wanted, said(xFile));
      const yFile = await file(Y, t.photoX.id, variant);
      const yMissing = await file(Y, MISSING, variant);
      check('S11', 'refuse', `SUB-Y is refused P-X's ${variant} as a missing photo`, !yFile.buffer && same(yFile, yMissing), `${said(yFile)} vs ${said(yMissing)}`);
      const yOpen = await file(Y, t.photoOpen.id, variant);
      check('S11', 'allow', `SUB-Y gets P-OPEN's ${variant}`, Boolean(yOpen.buffer), said(yOpen));
    }
  }

  // ── S12 ───────────────────────────────────────────────────────────────────
  if (wants('S12')) {
    head('S12 (R31) the photo assistant');
    const ai = (who, method, path, body) => who.send(method, `${B}/photos${path}`, body);
    const latestY = await ai(Y, 'GET', `/${t.photoX.id}/ai`);
    check('S12', 'refuse', "SUB-Y reading P-X's analysis is answered as a missing photo", !ok(latestY) && same(latestY, await ai(Y, 'GET', `/${MISSING}/ai`)), said(latestY));
    const latestX = await ai(X, 'GET', `/${t.photoX.id}/ai`);
    check('S12', 'allow', "SUB-X reads P-X's analysis", ok(latestX) && data(latestX)?.photo?.id === t.photoX.id, said(latestX));
    const analyzeY = await ai(Y, 'POST', `/${t.photoX.id}/ai/analyze`, {});
    check('S12', 'refuse', 'SUB-Y analysing P-X is answered as a missing photo', !ok(analyzeY) && same(analyzeY, await ai(Y, 'POST', `/${MISSING}/ai/analyze`, {})), said(analyzeY));
    const analyzeX = await ai(X, 'POST', `/${t.photoX.id}/ai/analyze`, {});
    check('S12', 'allow', 'SUB-X analyses P-X', ok(analyzeX) && data(analyzeX)?.photo?.id === t.photoX.id, said(analyzeX));
    // force skips the stored analysis, so this is analyzePhoto's own door
    const forceY = await ai(Y, 'POST', `/${t.photoX.id}/ai/analyze`, { force: true });
    check('S12', 'refuse', 'SUB-Y forcing a new analysis of P-X is answered as a missing photo', !ok(forceY) && same(forceY, await ai(Y, 'POST', `/${MISSING}/ai/analyze`, { force: true })) && !JSON.stringify(forceY.body || {}).includes(t.photoX.documentId), said(forceY));
    const forceX = await ai(X, 'POST', `/${t.photoX.id}/ai/analyze`, { force: true });
    check('S12', 'allow', 'SUB-X forces a new analysis of P-X', ok(forceX) && data(forceX)?.photo?.id === t.photoX.id, said(forceX));
    const applyY = await ai(Y, 'POST', `/${t.photoX.id}/ai/apply`, { tags: ['cert-sp-by-sub-y'] });
    check('S12', 'refuse', 'SUB-Y applying tags to P-X is answered as a missing photo, and P-X keeps its tags', !ok(applyY) && same(applyY, await ai(Y, 'POST', `/${MISSING}/ai/apply`, { tags: ['cert-sp-by-sub-y'] })), said(applyY));
    const applyX = await ai(X, 'POST', `/${t.photoX.id}/ai/apply`, { tags: ['cert-sp-by-sub-x'] });
    check('S12', 'allow', 'SUB-X applies a tag to P-X', ok(applyX) && (data(applyX)?.photo?.tags || []).includes('cert-sp-by-sub-x'), said(applyX));
    const pmPhotos = listOf(data(await PM.send('GET', `${B}/photos?limit=200&tag=cert-sp-by-sub-y`)));
    check('S12', 'refuse', 'no photo carries the tag SUB-Y tried to apply', !pmPhotos.some((row) => row.id === t.photoX.id));
    // One photo per batch: with no AI provider a batch stops after its first (degraded) photo.
    const batchY = await ai(Y, 'POST', '/ai/analyze', { photoIds: [t.photoX.id] });
    const batchYIds = (data(batchY)?.items || []).map((row) => row.photoId);
    check('S12', 'refuse', "SUB-Y's batch analysis of P-X skips it", ok(batchY) && !batchYIds.includes(t.photoX.id) && !JSON.stringify(data(batchY) || {}).includes(t.photoX.documentId), JSON.stringify(batchYIds));
    const batchYOpen = await ai(Y, 'POST', '/ai/analyze', { photoIds: [t.photoOpen.id] });
    check('S12', 'allow', "SUB-Y's batch analysis takes P-OPEN", (data(batchYOpen)?.items || []).some((row) => row.photoId === t.photoOpen.id), said(batchYOpen));
    const batchX = await ai(X, 'POST', '/ai/analyze', { photoIds: [t.photoX.id] });
    check('S12', 'allow', "SUB-X's batch analysis takes P-X", (data(batchX)?.items || []).some((row) => row.photoId === t.photoX.id), said(batchX));
    // The consultant (punch create) raising an observation from P-X attached P-X to its own punch item.
    const docRoute = `${B}/attachments/documents/${t.photoX.documentId}`;
    const before = await C.send('GET', docRoute, undefined, { binary: true });
    if (before.buffer) throw new StageError('the consultant can already read P-X; the stage is not what this proof needs');
    const hazard = `CERT-SP S12 observation ${Date.now().toString(36)}`;
    const obsC = await ai(C, 'POST', `/${t.photoX.id}/ai/observation`, { hazard });
    const obsMissing = await ai(C, 'POST', `/${MISSING}/ai/observation`, { hazard });
    const after = await C.send('GET', docRoute, undefined, { binary: true });
    const punches = listOf(data(await PM.send('GET', `${B}/punch?kind=observation&limit=100&search=${encodeURIComponent(hazard)}`)));
    check('S12', 'refuse', 'the consultant raising an observation from P-X is answered as a missing photo, no punch item is made, and P-X stays unreadable to it', !ok(obsC) && same(obsC, obsMissing) && !after.buffer && !punches.some((row) => row.title === hazard), `${said(obsC)} vs ${said(obsMissing)}; file ${after.status}; ${punches.length} punch item(s)`);
    const obsOpen = await ai(C, 'POST', `/${t.photoOpen.id}/ai/observation`, { hazard: `CERT-SP S12 allowed ${Date.now().toString(36)}` });
    check('S12', 'allow', 'the consultant raises an observation from P-OPEN, with the photo attached', obsOpen.status === 201 && data(obsOpen)?.attached === true, said(obsOpen));
  }

  // ── S13 ───────────────────────────────────────────────────────────────────
  if (wants('S13')) {
    head('S13 (N1) PATCH /photos/:id');
    const patch = (who, id, caption) => who.send('PATCH', `${B}/photos/${id}`, { caption });
    const yPatch = await patch(Y, t.photoX.id, 'CERT-SP captioned by SUB-Y');
    const yMissing = await patch(Y, MISSING, 'CERT-SP captioned by SUB-Y');
    const now = listOf(data(await PM.send('GET', `${B}/photos?limit=200&search=CERT-SP-PHOTO-X`))).find((row) => row.id === t.photoX.id);
    check('S13', 'refuse', 'SUB-Y editing P-X is answered as a missing photo, and the caption is unchanged', !ok(yPatch) && same(yPatch, yMissing) && now?.caption !== 'CERT-SP captioned by SUB-Y', `${said(yPatch)} vs ${said(yMissing)}; caption ${JSON.stringify(now?.caption)}`);
    const xPatch = await patch(X, t.photoX.id, 'CERT-SP captioned by SUB-X');
    check('S13', 'allow', 'SUB-X edits P-X', ok(xPatch) && data(xPatch)?.caption === 'CERT-SP captioned by SUB-X', said(xPatch));
    const yOpen = await patch(Y, t.photoOpen.id, 'CERT-SP open photo captioned by SUB-Y');
    check('S13', 'allow', 'SUB-Y edits P-OPEN', ok(yOpen), said(yOpen));
  }

  // ── verdict ───────────────────────────────────────────────────────────────
  const failedRefusals = results.filter((row) => row.kind === 'refuse' && !row.pass);
  const failedAllows = results.filter((row) => row.kind === 'allow' && !row.pass);
  console.log(`\n${results.length} checks: ${results.filter((row) => row.pass).length} pass, ${failedRefusals.length} refusal(s) failed, ${failedAllows.length} allowed case(s) failed`);
  for (const row of [...failedRefusals, ...failedAllows]) console.log(`  FAILED ${row.guard} ${row.kind} ${row.label} — ${row.detail}`);
  for (const guard of [...new Set(results.map((row) => row.guard))]) {
    const rows = results.filter((row) => row.guard === guard);
    console.log(`  ${guard}: refuse ${rows.filter((r) => r.kind === 'refuse' && r.pass).length}/${rows.filter((r) => r.kind === 'refuse').length}, allow ${rows.filter((r) => r.kind === 'allow' && r.pass).length}/${rows.filter((r) => r.kind === 'allow').length}`);
  }
  if (failedRefusals.length) {
    console.log('\nVERDICT specs-photos: DEFECT PRESENT');
    process.exitCode = 2;
  } else if (failedAllows.length) {
    console.log('\nVERDICT specs-photos: OVER-BLOCKING (a legitimate caller is refused)');
    process.exitCode = 3;
  } else {
    console.log('\nVERDICT specs-photos: FIXED (every refusal and every allowed case holds)');
    process.exitCode = 0;
  }
};

run()
  .catch((error) => {
    console.error(`\n${error instanceof StageError ? 'STAGE' : 'SCRIPT'} ERROR: ${error.stack || error.message}`);
    process.exitCode = error instanceof StageError ? 3 : 1;
  })
  .finally(async () => {
    if (pg) await pg.end().catch(() => {});
    if (INPROCESS) {
      // eslint-disable-next-line global-require
      await require('../../../src/config/db').prisma.$disconnect().catch(() => {});
    }
  });
