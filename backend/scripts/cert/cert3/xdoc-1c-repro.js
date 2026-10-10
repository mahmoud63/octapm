'use strict';

/**
 * XDOC-1c and XDOC-UPB confirm-first reproduction.
 *   XDOC-1c   the revisions door: a record of one company files a REVISION, or a
 *             record file field, naming ANOTHER company's document (XDOC-1's write
 *             class through doors that are not syncWorkflowReferences);
 *   XDOC-UPB  the payload-supplied uploader: a reference or a photo of one company
 *             stores ANOTHER company's user as its uploader.
 * And no read path of company A resolves either into company B's document (bytes,
 * text, metadata) or into company B's person (name, e-mail).
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/xdoc-1c-repro.js
 *
 * No flags. In process (CERT_INPROCESS=1, through the lock runner only) on the
 * certification database, under the CERT-3 harness (./lib/harness: fixed plan,
 * G.5xx sweep, exit 0/2/1, result file, provisional classification).
 *
 * SOURCES. The suspects: docs/certification/OCTAPM_LAUNCH_BLOCKERS.md:298
 * (XDOC-1c) and :299 (XDOC-UPB). The integration owner's rulings:
 * C:\Temp\octapm-cert\scratch\wp2\r3-rulings.md:16 (§12b XDOC-1c, conditional
 * on this repro; the fix uses option (c)'s scope rule) and :17 (§14: the server
 * stamps the writer, ignores a sent uploader; "reproduced by the XDOC-1c
 * repro"). The adjudications: codex-plan-review-adjudication.md:10 (X-H1: a
 * reference resolving to another organisation's document, by id, storage key or
 * product URL, is REFUSED on every surface), codex-plan-review-r2-adjudication.md
 * :29 (X-R2-H3 option (c): an id embedded in a non-UUID key, a product link or a
 * lone id that does not resolve in the caller's org and project is refused with
 * the uniform not-found; no probe, no oracle), :41-47 (XDOC-1b). CERT-2's scale,
 * OCTAPM_LAUNCH_BLOCKERS.md:147-148: a stored reference to another company's
 * record is a cross-company write (P1); an answer carrying another company's
 * records is a cross-company read. The model: xdoc-1b-repro.js (XDOC-1b
 * CONFIRMED P1, OCTAPM_LAUNCH_BLOCKERS.md:297; run 2,
 * C:\Temp\octapm-cert\logs\cert3-xdoc-1b-repro-2.log: 60/114, the 54 write
 * checks fail, every read, own, bare-id and random control holds).
 *
 * THE CODE AT HEAD (product f599e67), every path traced.
 *
 *  (1) The revisions door. recordDocumentRevisions (workflow-support.service.js
 *      :760-818) is called by each document record's own create and update:
 *      rfi.service.js:431 / :659, submittal.service.js:466 / :702,
 *      drawing.service.js:99 / :207, transmittal.service.js:99 / :202,
 *      correspondence.service.js:109 / :231; none passes orgId, the creates pass
 *      no user (the writer is then the record's author, RFI and submittal, or
 *      nobody: :589-597, :798). normalizeRevisionRefs (:436-531) takes the
 *      payload's revisions[] (fileUrl|url :455, storageKey|key|projectDocumentId|
 *      documentId :456-461) and the record entry built from the top-level
 *      revision (or the row's own: RFI revision Int 0 -> "0", schema.prisma:4150;
 *      submittal "A", :4244; drawing "0", :4326) with fileUrl = payload.fileUrl
 *      ?? row.fileUrl (:488). Only the keys reach the judge (:799-805):
 *      assertDocumentsLinkable (document-text.service.js:782-811) judges a key
 *      only when it is a UUID (:783-785), so a fileUrl is never judged and
 *      '<id>.pdf' is skipped; a missing UUID is refused 404 FILE_NOT_FOUND
 *      "Revision source file not found" (workflow-support.service.js:732-733).
 *      Then createMany stores every entry as sent (:807-815). A revision is
 *      written only once per code (skipDuplicates; @@unique schema.prisma:4603),
 *      and no product route deletes one, so every stored one stays (residue).
 *      The routes accept revisions (an array) and a top-level revision/fileUrl
 *      unvalidated: rfi.js:161 / :509, submittals.js:264 / :509 (revision <= 20
 *      chars, :57), drawings.js:51 / :94 (fileUrl :61 / :104),
 *      transmittals.js:58 / :104, correspondence.js:52 / :97.
 *  (2) Record file fields. DrawingRecord.fileUrl is stored as sent
 *      (drawing.service.js:80, :182-185) and copied into the drawing's first
 *      revision by the record entry (workflow-support.service.js:488);
 *      Transmittal.documentsJson is stored as sent (transmittal.service.js:79,
 *      :173-176; no validator, routes/transmittals.js:33-65); no first-party
 *      client writes documentsJson (no hit in frontend/ or mobile/).
 *  (3) The uploader. Workflow references: normalizeAttachmentRefs keeps the
 *      payload's uploadedBy first (workflow-support.service.js:420), on all 18
 *      syncWorkflowReferences call sites (creates pass no user except punch,
 *      punch.service.js:441; updates pass it). Commercial references:
 *      commercial-traceability.service.js:103, stored first at :289, through
 *      change-order.service.js:1051 / :1341 (routes/change-orders.js:53-158,
 *      requireRoles pm/qs :55 / :161). Daily-report and site-diary photos:
 *      normalised with the payload's uploadedBy (daily-report.service.js:124,
 *      site-diary.service.js:112; routes/daily-reports.js:124,
 *      routes/site-diaries.js:104 accept it as a string) BUT re-read before they
 *      are stored: checkedPhotos (daily-report.service.js:196-207; create :716,
 *      update :831; site diary :448, :538) -> progress.service.js prepareEvidence
 *      :634-647 sets every photo's uploadedBy to the uploader of the document it
 *      names (null when it names none). So at HEAD the uploader of a photo naming
 *      the writer's own site photo is the writer, whatever was sent (the r3 plan's
 *      lead L-UPB says the same of progress: HRX1-FIX-PLAN.r3.md:2484; the
 *      registration of XDOC-UPB, OCTAPM_LAUNCH_BLOCKERS.md:299, lists the photos
 *      too, so this repro reads both photo paths and expects them to hold).
 *  READS of the uploader (traced): workflow lists and single GETs serve the
 *      WorkflowAttachment rows raw (workflow-support.service.js:976-979,
 *      :1118-1119; uploadedBy is not a USER_REF_FIELD, :34-40, so never resolved
 *      by loadReferencedUsers :876-888); the audit history serialises it raw
 *      (audit.service.js:789-790, rows :817-858); the change-order list serves the
 *      CommercialAttachmentRef rows raw (commercial-traceability.service.js
 *      :375-391, :417); daily reports and site diaries serve photosJson raw
 *      (daily-report.service.js:429, site-diary.service.js:269); no export renders
 *      it (no reference outside the serialisers); the web client only types it
 *      (frontend/src/features/attachments/hooks/use-attachments.ts:15) and the
 *      mobile client types it Person | string (mobile/src/api/record-types.ts:279)
 *      and renders it nowhere. READS of a revision's file: GET
 *      /doc-control/revisions/:id/download and /preview (routes/doc-control.js
 *      :389-425) resolve projectDocumentId || storageKey in the caller's org and
 *      project (doc-control.service.js:1258-1263 -> file-storage.service.js
 *      :881-894; the legacy local path is under the caller's org and project,
 *      :853-879); a revision with no key answers 404 (:1259-1261).
 *
 * WHERE. Company A = 087, company B = 088 (the XDOC-1 / XDOC-1b pair): fixed
 * codes, each required in the population (h.companies) and resolved to EXACTLY
 * ONE organisation by its certification slug (cert-<code>-%), proven by the
 * guard (assertCertOrganisation); A and B distinct. Never a first row. B's USER is
 * chosen by rule: B's PM persona (pm@<B's domain>, scripts/cert/lib/spec.js:236),
 * resolved in process: exactly one User row with that e-mail, the same id answered
 * by /auth/me as B's PM (routes/auth.js:308-320), an active membership in B and
 * none in A; A's PM (the writer) the same way in A. Every write is A's PM (087) or
 * B's PM (088) through a product route; SQL only reads. Throwaway: B's PM creates
 * PB ("CERT3 XDOC1c repro B <stamp>"), A's PM creates PA1 ("CERT3 XDOC1c repro A
 * <stamp>"); nothing else is touched.
 *
 *   setup B  as xdoc-1b-repro.js: PB, D_B (a text file with a letters-only canary
 *            through /workflow/uploads), its text extracted in process, B
 *            downloads it and finds it by the canary in PB's and the global
 *            search (the positive controls).
 *   setup A  PA1; seven own text files in one upload (one per revision surface,
 *            one per record file field: each linked from nowhere, so a create
 *            that names no writer may name it, document-text.service.js:807-808,
 *            OCTAPM_LAUNCH_BLOCKERS.md:294 WP8-TRN-1); one standing record per
 *            revision surface and per record file field.
 *   setup U  B's user and A's PM resolved by rule (above); an activity; two site
 *            photos (one request); one standing record per uploader path. Each
 *            part has its own standing records, so no part's stored state meets
 *            another part's write.
 *
 * THE WRITES. Each is judged on its own, in the database and through the PM's
 * read-back; a create's record count of its table is read before and after.
 *
 *  REV.s (s = RFI, submittal, drawing, transmittal, correspondence), on create
 *  (POST a new record) and update (PATCH the standing record), each revision with
 *  a fresh code (a code is filed once):
 *    REV.s.own          control: A's own fresh upload in two revisions (storage key;
 *                       PA1 product URL): create 201 and update 200, 2 revisions
 *                       naming it each                                HEAD PASS
 *    storageKey  GUARD  revisions [{revision, fileName, storageKey: D_B}]   HEAD PASS: 404 FILE_NOT_FOUND (R29)
 *    urlPB       DEFECT revisions [{revision, fileName, fileUrl: /api/v1/projects/PB/workflow/uploads/D_B}]  HEAD FAIL: stored
 *    urlPA1      DEFECT revisions [{..., fileUrl: /api/v1/projects/PA1/workflow/uploads/D_B}]                HEAD FAIL: stored
 *    legacyKey   DEFECT revisions [{..., storageKey: D_B + '.pdf'}] (not a UUID: skipped)                    HEAD FAIL: stored
 *    recordUrl   DEFECT the record entry: top-level {revision, fileUrl: <PB URL of D_B>} (:488)              HEAD FAIL: stored
 *    Fixed expectation: refused 4xx, nothing naming D_B stored (no revision of
 *    the record with this write's code naming it, no record field naming it, no
 *    read-back revision naming it; on a create no record left, on an update the
 *    record still there). "Naming D_B" = D_B's id or its internal storage key
 *    inside projectDocumentId, storageKey, fileUrl (or documentId, key, url).
 *    C.REV.s            control (no oracle): the ten writes repeated with an id that
 *                       exists nowhere (and a random project for the foreign route)
 *                       answer as the foreign writes did and are stored exactly
 *                       when they were                                HEAD PASS (equal)
 *  FILE.drawing (DrawingRecord.fileUrl) and FILE.transmittal
 *  (Transmittal.documentsJson), create and update (the standing record's field
 *  cleared first, proven empty):
 *    FILE.u.own         control: A's own fresh upload in the field: stored (201 / 200)  HEAD PASS
 *    drawing     urlPB, urlPA1 (fileUrl = either product URL of D_B), bareId
 *                (fileUrl = D_B: "a link field that is one UUID names a document
 *                by id", HRX1-FIX-PLAN.r3.md:158)                 DEFECT HEAD FAIL: stored (and the create's
 *                                                                 revision "0" carries it, :488)
 *    transmittal documentId ([{fileName, documentId: D_B}]), urlPB, urlPA1
 *                ([{fileName, fileUrl: <URL>}])                    DEFECT HEAD FAIL: stored
 *    C.FILE.u           the six writes with a nowhere id: equal               HEAD PASS
 *  UPB.p (p = the nine workflow surfaces' references, the change order's
 *  reference, the daily report's photo, the site diary's photo), each write one
 *  entry identified by its own name (a reference's fileName, a photo's caption):
 *    UPB.p.own          control: no uploadedBy sent: accepted (201 / 200, one entry)
 *                       and the stored uploader is A's PM or empty (HEAD: empty on
 *                       the eight workflow creates that pass no user)  HEAD PASS
 *    UPB.p.create/update DEFECT uploadedBy = B's PM's user id. Fixed expectation:
 *                       the stored uploader (database and read-back) is the writer,
 *                       A's PM, or the request is refused 4xx with nothing stored
 *                       (no record left / the record still there); never B's user.
 *                       A workflow reference names no file ({fileName, description,
 *                       uploadedBy}), so no document rule is involved; a photo names
 *                       A's own site photo by key (the upload answer's shape).
 *                       HEAD: workflow x 9 and change order FAIL (stored as sent);
 *                       daily report and site diary PASS (re-read from the photo's
 *                       document: the PM, progress.service.js:645-646)
 *    C.UPB.p            control (no oracle): the same create and update with an
 *                       uploadedBy that exists nowhere answer as with B's user,
 *                       store as many entries, and keep the sent value exactly when
 *                       B's was kept                                   HEAD PASS (equal)
 *  Read stage: after its checks, each part's standing record is given the foreign
 *  values HEAD stores (REV: the three revision forms and the record entry; FILE:
 *  the foreign field; UPB: B's user as uploader), so the reads are judged against
 *  stored foreign state (observed; a fixed product refuses them and the reads
 *  still hold).
 *
 * THE READS (as A's PM, the broadest reader of A; an answer below 400 where a
 * refusal is expected, any of B's bytes or metadata (the canary, B's originalName,
 * B's sha256), B's PM's e-mail (or name, when no member of A shares it), or a
 * person object carrying B's user id with a name or an e-mail, is OPEN, P0 class):
 *   R.dl.*, R.att, R.site, R.text, R.search.*   as xdoc-1b-repro.js (HEAD 404s, no hit)
 *   R.rev.download   every revision of PA1 naming D_B, through /download and
 *                    /preview: refused (HEAD 404 FILE_NOT_FOUND); positive control:
 *                    A's own storage-key revision of the standing RFI downloads (200,
 *                    its text)                                        HEAD PASS
 *   R.detail.p       the twelve paths' lists (and single GETs: RFI, submittal, punch,
 *                    daily report, site diary): no D_B metadata on any reference,
 *                    revision, record field or photo; B's user never a person; refs
 *                    echo only what A sent (the raw id echo is counted, not judged:
 *                    r3-rulings.md:17)                                HEAD PASS
 *   R.audit          every standing record's audit history (19; 200, events)  HEAD PASS
 *   R.register       GET /doc-control/register                         HEAD PASS
 *   R.export         the RFI PDFs of both standing RFIs, the punch CSV HEAD PASS
 *   R.B.unchanged    D_B as B left it; B still reads it (200, canary)  HEAD PASS
 *   R.B.user         B's PM's user row and memberships unchanged, none in A  HEAD PASS
 *   G.5xx            the harness's own (cleanup included)              HEAD PASS
 *
 * THE CHECKS (fixed before the first run): 3 setup + 5 x 12 (REV) + 2 x 8 (FILE)
 * + 12 x 4 (UPB) + 26 reads = 153 in the plan, + G.5xx = 154 (EXPECTED_CHECKS).
 * Kinds: 3 setup; 76 defect (XDOC-1c 52 = 40 REV + 12 FILE; XDOC-UPB 24);
 * 48 guard (5 + 2 + 12 own, 10 REV storageKey, 5 + 2 + 12 random) + G.5xx;
 * 26 check (reads).
 *
 * EXPECTED AT HEAD (product f599e67), from the trace above, never run by the
 * author: 154 recorded, 72 FAIL (every defect check except UPB.dr.create,
 * UPB.dr.update, UPB.sd.create and UPB.sd.update), exit 2, DEFECT_PRESENT;
 * harness provisional classification PARTIAL (72 of 76).
 *   per unit (observation 'classification'):
 *     XDOC-1c   CONFIRMED on rev.rfi, rev.submittal, rev.drawing, rev.transmittal,
 *               rev.correspondence, file.drawing, file.transmittal (52 of 52)
 *     XDOC-UPB  CONFIRMED on upb.rfi, upb.submittal, upb.drawing, upb.transmittal,
 *               upb.correspondence, upb.defect, upb.itp, upb.mtest, upb.punch,
 *               upb.co (20 of 20); REJECTED on upb.dr and upb.sd (the photo path
 *               already re-reads the uploader: XDOC-UPB as registered is PARTIAL)
 *   no failed guard, no oracle, no open read.
 * On a tree with the r3 §12b and §14 fixes: exit 0, PASS, every unit REJECTED.
 * A fix that ignores the sent uploader but leaves a create without a writer
 * (8 of 9 workflow creates pass none) storing an empty uploader FAILS the create
 * checks: the expected answer is the writer (r3-rulings.md:17), not an empty one.
 *
 * CLASSIFICATION (observation 'classification', computed in cleanup; the
 * harness's own over the 76 defect checks beside it). Per unit u, over its defect
 * checks D(u): UNDETERMINED on a setup error, a thrown section, a check of D(u)
 * not run, or a failed own control (a door that refuses A's own file proves
 * nothing by refusing B's); CONFIRMED when all of D(u) fail; REJECTED when none
 * does; PARTIAL otherwise. Per suspect (XDOC-1c, XDOC-UPB): CONFIRMED / REJECTED
 * when every unit is, UNDETERMINED when none is determined, PARTIAL otherwise.
 * Beside it, never folded in: a failed REV storageKey guard (a bare foreign id
 * filed: an R29 bypass, P1 on its own), a failed C.* (an existence oracle), a
 * failed R.* read (an open cross-tenant read, P0 class; a failure of
 * R.rev.download's own positive control alone is listed as a read control, not
 * an open read), a failed R.B.* (B's state changed by A's writes).
 * Undecided rules: none of these checks reads HR-P2..P5, HR-Q2..Q5 or HR-S9.
 * Owner questions that touch this design (codex-plan-review-r2-adjudication.md
 * :39 and :56 O10 extended, :59 O13) concern references ALREADY stored; every
 * write here is a new one, each part has its own standing records, and a
 * revision is judged on its own code, so both O10 branches expect the same
 * answers. O16 (free text, HRX1-FIX-PLAN.r3.md:2499) is not read either: no
 * check puts an id inside a file name, a description or an external link (a lone
 * id in a link field and a documentId are counted names in the r3 plan's table,
 * HRX1-FIX-PLAN.r3.md:158-159, under X-R2-H3 (c)). uploadedBy is "not a name" there
 * (:158): the uploader checks rest on §14 (r3-rulings.md:17) alone.
 *
 * CLEANUP (always): A's PM clears what the product lets it clear on every record
 * the run made on PA1 (drawings' fileUrl, transmittals' documentsJson, workflow
 * and change-order references, daily-report and site-diary photos); the rows of
 * PA1 that still name D_B or B's user are counted per table (observation
 * residue: at HEAD the stored foreign REVISIONS stay, no product route removes a
 * revision; each is known residue of this throwaway project); then PA1 is
 * archived by A's PM and PB by B's PM (DELETE /projects/:id, archivedAt read
 * back). No other project is touched.
 *
 * SEEN IN PASSING (not checked here; leads for the integration owner):
 *  - revisions[].issuedBy and the record entry's issuedBy come from the payload
 *    first (workflow-support.service.js:463, :493): XDOC-UPB's class on revisions;
 *  - ContractProfile.documentIds is stored as sent (contract.service.js:149, and
 *    merged at :235, :289-290; read back only through the scoped getDocumentText):
 *    XDOC-1's write class on a door outside both suspects;
 *  - the submittal /submit and /resubmit actions pass revisions, fileUrl and
 *    storageKey through (submittal.service.js:299-306) into the same door.
 * Spellings: the checks send the canonical ones (revisions[].fileUrl and
 * storageKey, attachmentRefs, documentsJson, photos[].key). The normalisers also
 * read revisions[].url, key, projectDocumentId and documentId
 * (workflow-support.service.js:446-461), a reference's url and key and the
 * attachments list (:411-413, :626-628), a commercial reference's downloadUrl,
 * url and key and the attachments / supportingDocumentIds / documentIds lists
 * (commercial-traceability.service.js:24-37, :91-92). A judge placed after the
 * normalisation is caught for every spelling; one placed in a route is not proven
 * for the aliases (the fix's own proof sends one alias per path, as r3-rulings.md
 * :14 asks of XDOC-1b).
 *
 * Exit 0 every check holds (the fixed behaviour), 2 a check failed (a defect
 * present), 1 setup error (harness rules). Results:
 * C:\Temp\octapm-cert\results\cert3\xdoc-1c-repro.json.
 *
 * DRAFT (read-only preparation, 2026-10-10): never run against the product by
 * its author. Checked without a database or an API: node --check;
 * registration-check.js (the real harness registers exactly these 154 checks)
 * and fake-run.js (main and cleanup end to end against an in-memory model of the
 * routes and SQL used, under HEAD, fixed and partial behaviours), both in
 * C:\Temp\octapm-cert\scratch\wp2\xdoc1c\. Claude Main installs it as
 * backend/scripts/cert/cert3/xdoc-1c-repro.js.
 */

const harness = require('./lib/harness');

// FIRST: the in-process app on the certification database, machinery off.
harness.prepareInProcess();

const crypto = require('crypto');
const api = require('../lib/api');
const certEnv = require('../lib/cert-env');

const NAME = 'xdoc-1c-repro';
const COMPANY_A = '087';
const COMPANY_B = '088';
const DEFECT_REV = 'XDOC-1c';
const DEFECT_UPB = 'XDOC-UPB';
const STAMP = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${crypto.randomBytes(2).toString('hex')}`;
/** Letters only: one token for the full-text parser, so a search finds it whole. */
const CANARY = `xdocccanary${Array.from(crypto.randomBytes(16), (b) => String.fromCharCode(97 + (b % 26))).join('')}`;
const PROJECT_A = `CERT3 XDOC1c repro A ${STAMP}`;
const PROJECT_B = `CERT3 XDOC1c repro B ${STAMP}`;
const START = '2026-01-05';
const END = '2026-12-31';
const REPORT_DATE = '2026-03-02';
const B_FILE = `xdoc1c-b-private-evidence-${STAMP}.txt`;
const B_TEXT = `XDOC-1c reproduction ${STAMP}: company B's private evidence. ${CANARY}\nOnly company B may read this file; its canary is ${CANARY}.\n`;
const OWN_MARK = `XDOC-1c reproduction ${STAMP}: company A's own evidence`;
/** A 1x1 PNG (wp2-progress-proof.js:482): the site photos the daily report and the site diary name. */
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

let seq = 0;
const next = () => {
  seq += 1;
  return seq;
};
/** A revision code no record of this run has yet; Submittal.revision takes at most 20 characters (routes/submittals.js:57). */
const revCode = () => `X${String(next()).padStart(4, '0')}`;

/**
 * The nine workflow surfaces (xdoc-1b-repro.js's). sites: the two syncWorkflowReferences call sites; revSites: the two
 * recordDocumentRevisions call sites of the five document surfaces (doc). single: the module has a single-record GET.
 * body(tag): the smallest valid create body. A new RFI carries no status (rfi.service.js:348, :377; xdoc-1b debug run 1).
 */
const SURFACES = Object.freeze([
  { key: 'rfi', label: 'RFI', recordType: 'rfi', table: 'Rfi', base: 'rfi', single: true, doc: true, listQuery: '?limit=100', sites: ['rfi.service.js:396', 'rfi.service.js:620'], revSites: ['rfi.service.js:431', 'rfi.service.js:659'],
    body: (tag) => ({ subject: `XDOC-1c repro RFI ${tag}`, question: `XDOC-1c reproduction ${tag}` }) },
  { key: 'submittal', label: 'submittal', recordType: 'submittal', table: 'Submittal', base: 'submittals', single: true, doc: true, listQuery: '?limit=100', sites: ['submittal.service.js:431', 'submittal.service.js:663'], revSites: ['submittal.service.js:466', 'submittal.service.js:702'],
    body: (tag) => ({ title: `XDOC-1c repro submittal ${tag}` }) },
  { key: 'drawing', label: 'drawing', recordType: 'drawing', table: 'DrawingRecord', base: 'drawings', single: false, doc: true, sites: ['drawing.service.js:83', 'drawing.service.js:188'], revSites: ['drawing.service.js:99', 'drawing.service.js:207'],
    body: (tag) => ({ drawingNumber: `X1C-${STAMP}-${next()}`, title: `XDOC-1c repro drawing ${tag}` }) },
  { key: 'transmittal', label: 'transmittal', recordType: 'transmittal', table: 'Transmittal', base: 'transmittals', single: false, doc: true, sites: ['transmittal.service.js:83', 'transmittal.service.js:183'], revSites: ['transmittal.service.js:99', 'transmittal.service.js:202'],
    body: (tag) => ({ subject: `XDOC-1c repro transmittal ${tag}`, sender: 'XDOC-1c repro', recipient: 'XDOC-1c repro' }) },
  { key: 'correspondence', label: 'correspondence', recordType: 'correspondence', table: 'Correspondence', base: 'correspondence', single: false, doc: true, sites: ['correspondence.service.js:93', 'correspondence.service.js:212'], revSites: ['correspondence.service.js:109', 'correspondence.service.js:231'],
    body: (tag) => ({ direction: 'outgoing', type: 'letter', subject: `XDOC-1c repro letter ${tag}` }) },
  { key: 'defect', label: 'defect', recordType: 'defect', table: 'DefectRecord', base: 'defects', single: false, sites: ['defect.service.js:92', 'defect.service.js:187'],
    body: (tag) => ({ title: `XDOC-1c repro defect ${tag}` }) },
  { key: 'itp', label: 'ITP', recordType: 'itp', table: 'ItpRecord', base: 'itp', single: false, sites: ['itp.service.js:82', 'itp.service.js:163'],
    body: (tag) => ({ title: `XDOC-1c repro ITP ${tag}` }) },
  { key: 'mtest', label: 'material test', recordType: 'material_test', table: 'MaterialTest', base: 'material-tests', single: false, sites: ['material-test.service.js:86', 'material-test.service.js:181'],
    body: (tag) => ({ testType: `XDOC-1c repro test ${tag}` }) },
  { key: 'punch', label: 'punch item', recordType: 'punch_item', table: 'PunchItem', base: 'punch', single: true, sites: ['punch.service.js:441', 'punch.service.js:508'],
    body: (tag) => ({ title: `XDOC-1c repro punch ${tag}` }) },
]);
const SURFACE = Object.freeze(Object.fromEntries(SURFACES.map((s) => [s.key, s])));
const REV_SURFACES = SURFACES.filter((s) => s.doc);
const OPS = Object.freeze(['create', 'update']);

/** [variant, kind, what, head]: the bare UUID key is R29's (a guard); the four others are the suspect's door. */
const REV_VARIANTS = Object.freeze([
  ['storageKey', 'guard', 'revisions [{revision, fileName, storageKey: D_B}] (a UUID key: judged)', 'HEAD PASS: 404 FILE_NOT_FOUND (R29, workflow-support.service.js:799-805, :732-733), nothing stored'],
  ['urlPB', 'defect', 'revisions [{revision, fileName, fileUrl: /api/v1/projects/<PB>/workflow/uploads/<D_B>}]', 'HEAD FAIL: stored as sent (a fileUrl is never judged, workflow-support.service.js:455, :802)'],
  ['urlPA1', 'defect', 'revisions [{revision, fileName, fileUrl: /api/v1/projects/<PA1>/workflow/uploads/<D_B>}]', 'HEAD FAIL: stored as sent'],
  ['legacyKey', 'defect', 'revisions [{revision, fileName, storageKey: <D_B>.pdf}] (not a UUID: skipped, document-text.service.js:783-785)', 'HEAD FAIL: stored as sent'],
  ['recordUrl', 'defect', 'the record entry: top-level {revision, fileUrl: /api/v1/projects/<PB>/workflow/uploads/<D_B>} (workflow-support.service.js:475-503, :488)', 'HEAD FAIL: stored as sent'],
]);
/** The body of one revision write naming n (n.id, n.urlPB, n.urlPA1) under code c. */
const revBody = (variant, n, c, fileName) => {
  if (variant === 'storageKey') return { revisions: [{ revision: c, fileName, storageKey: n.id }] };
  if (variant === 'urlPB') return { revisions: [{ revision: c, fileName, fileUrl: n.urlPB }] };
  if (variant === 'urlPA1') return { revisions: [{ revision: c, fileName, fileUrl: n.urlPA1 }] };
  if (variant === 'legacyKey') return { revisions: [{ revision: c, fileName, storageKey: `${n.id}.pdf` }] };
  if (variant === 'recordUrl') return { revision: c, fileUrl: n.urlPB };
  throw new Error(`no revision variant ${variant}`);
};

/** The record file fields: the drawing's fileUrl and the transmittal's documentsJson. */
const FILE_UNITS = Object.freeze([
  {
    key: 'drawing', surface: 'drawing', label: 'drawing (DrawingRecord.fileUrl)', field: 'fileUrl', table: 'DrawingRecord', sites: ['drawing.service.js:80', 'drawing.service.js:182-185'],
    variants: [
      ['urlPB', 'fileUrl /api/v1/projects/<PB>/workflow/uploads/<D_B>'],
      ['urlPA1', 'fileUrl /api/v1/projects/<PA1>/workflow/uploads/<D_B>'],
      ['bareId', 'fileUrl <D_B> (a link field that is one UUID names a document by id, HRX1-FIX-PLAN.r3.md:158)'],
    ],
    body: (variant, n) => ({ fileUrl: variant === 'bareId' ? n.id : variant === 'urlPB' ? n.urlPB : n.urlPA1 }),
    own: (id, url) => ({ fileUrl: url }),
    stage: (n) => ({ fileUrl: n.urlPB }),
    clear: { fileUrl: null },
  },
  {
    key: 'transmittal', surface: 'transmittal', label: 'transmittal (Transmittal.documentsJson)', field: 'documentsJson', table: 'Transmittal', sites: ['transmittal.service.js:79', 'transmittal.service.js:173-176'],
    variants: [
      ['documentId', 'documentsJson [{fileName, documentId: <D_B>}]'],
      ['urlPB', 'documentsJson [{fileName, fileUrl: /api/v1/projects/<PB>/workflow/uploads/<D_B>}]'],
      ['urlPA1', 'documentsJson [{fileName, fileUrl: /api/v1/projects/<PA1>/workflow/uploads/<D_B>}]'],
    ],
    body: (variant, n, fileName) => ({ documentsJson: [variant === 'documentId' ? { fileName, documentId: n.id } : { fileName, fileUrl: variant === 'urlPB' ? n.urlPB : n.urlPA1 }] }),
    own: (id, url, fileName) => ({ documentsJson: [{ fileName, documentId: id }, { fileName: `url-${fileName}`, fileUrl: url }] }),
    stage: (n) => ({ documentsJson: [{ fileName: 'stage-doc', documentId: n.id }, { fileName: 'stage-pb', fileUrl: n.urlPB }, { fileName: 'stage-pa1', fileUrl: n.urlPA1 }] }),
    // [] rather than null: an empty list names nothing and is a plain JSON value (transmittal.service.js:173-176).
    clear: { documentsJson: [] },
  },
]);

/** The uploader paths. head: what the trace predicts at HEAD for the defect checks. */
const UPB_PATHS = Object.freeze([
  ...SURFACES.map((s) => ({
    key: s.key, label: `${s.label} reference`, kind: 'workflow', surface: s.key, recordType: s.recordType, recordTable: s.table, refTable: 'WorkflowAttachment', base: s.base,
    sites: [`workflow-support.service.js:420 through ${s.sites[0]}`, `workflow-support.service.js:420 through ${s.sites[1]}`], head: 'FAIL',
  })),
  { key: 'co', label: 'change-order reference', kind: 'commercial', recordType: 'change_order', recordTable: 'ChangeOrder', refTable: 'CommercialAttachmentRef', base: 'change-orders',
    sites: ['commercial-traceability.service.js:103, :289 through change-order.service.js:1051', 'commercial-traceability.service.js:103, :289 through change-order.service.js:1341'], head: 'FAIL' },
  { key: 'dr', label: 'daily-report photo', kind: 'photo', recordType: 'daily_report', recordTable: 'DailyReport', base: 'daily-reports',
    sites: ['daily-report.service.js:124, re-read at :716 (progress.service.js:634-647)', 'daily-report.service.js:124, re-read at :831'], head: 'PASS' },
  { key: 'sd', label: 'site-diary photo', kind: 'photo', recordType: 'site_diary', recordTable: 'SiteDiary', base: 'site-diaries',
    sites: ['site-diary.service.js:112, re-read at :448 (progress.service.js:634-647)', 'site-diary.service.js:112, re-read at :538'], head: 'PASS' },
]);
const DETAIL_PATHS = Object.freeze([
  ...SURFACES.map((s) => ({ key: s.key, label: s.label, single: s.single })),
  { key: 'co', label: 'change order', single: false },
  { key: 'dr', label: 'daily report', single: true },
  { key: 'sd', label: 'site diary', single: true },
]);

const ADJ1 = 'C:/Temp/octapm-cert/scratch/wp2/codex-plan-review-adjudication.md';
const ADJ2 = 'C:/Temp/octapm-cert/scratch/wp2/codex-plan-review-r2-adjudication.md';
const R3 = 'C:/Temp/octapm-cert/scratch/wp2/r3-rulings.md';
const BLOCKERS = 'docs/certification/OCTAPM_LAUNCH_BLOCKERS.md';
const RULES = Object.freeze({
  'XDOC-W': {
    status: 'decided',
    statement: 'A new reference naming another company\'s stored document is refused (4xx) and nothing naming it is stored, on every door that writes one: a revision filed through a record\'s own create or update (revisions[].fileUrl, a storage key embedding its id, the record entry\'s fileUrl), DrawingRecord.fileUrl and Transmittal.documentsJson; by a product URL through either company\'s project route, a key embedding its id, a lone id in a link field or a documentId. The writer\'s own document in its own project is accepted. A stored reference to another company\'s record is a cross-company write (P1).',
    sources: [`${BLOCKERS}:147-148`, `${BLOCKERS}:296-298 (XDOC-1, XDOC-1b CONFIRMED P1; XDOC-1c)`, `${ADJ1}:10 (X-H1)`, `${ADJ2}:29 (X-R2-H3 option (c))`, `${ADJ2}:41-47 (XDOC-1b)`, `${R3}:16 (§12b XDOC-1c)`, 'C:/Temp/octapm-cert/scratch/wp2/fixplan-hrx1/r3/HRX1-FIX-PLAN.r3.md:158-159 (what is a name: documentId; a link field that is one UUID; product links; ids embedded in keys)'],
  },
  R29: {
    status: 'decided',
    statement: 'A UUID key on a revision a record\'s own route files that names no document of the record\'s project is refused with the path\'s not-found (404 FILE_NOT_FOUND); the writer\'s own fresh upload, linked from nowhere, is theirs to link.',
    sources: ['backend/src/services/document-text.service.js:759-811', 'backend/src/services/workflow-support.service.js:732-733, :735-759, :798-805'],
  },
  'XDOC-U': {
    status: 'decided',
    statement: 'A reference that resolves to no document in the caller\'s org and project gets the same answer whether its id is another company\'s or exists nowhere (uniform not-found, no probe, no oracle).',
    sources: [`${ADJ2}:29 (X-R2-H3 option (c))`, 'backend/src/services/document-text.service.js:777-780'],
  },
  'XDOC-R': {
    status: 'decided',
    statement: 'No read path of company A resolves a stored reference into another company\'s document (bytes, text, search hit or metadata) or another company\'s user into a person (name, e-mail); a cross-company read is P0 class. The raw id A itself sent may be echoed (recorded, not judged).',
    sources: [`${BLOCKERS}:147-148`, 'C:/Temp/octapm-cert/scratch/wp2/xdoc1/XDOC1-TRACE.md (19 paths CLOSED)', `${BLOCKERS}:299 (XDOC-UPB: served as a raw id)`, `${R3}:17 (§14)`],
  },
  'UPB-W': {
    status: 'decided',
    statement: 'The uploader stored on a workflow or commercial reference, or on a daily-report or site-diary photo, is the writer (the server stamps it and ignores a sent uploader), or a sent uploader is refused (4xx) with nothing stored; another company\'s user is never stored. A reference sent with no uploader is accepted.',
    sources: [`${BLOCKERS}:147-148`, `${BLOCKERS}:299 (XDOC-UPB)`, `${R3}:17 (§14 server-stamped uploader)`, 'backend/src/services/progress.service.js:164-166, :634-647 (the photo rule HEAD already applies)'],
  },
  'UPB-U': {
    status: 'decided',
    statement: 'A sent uploader that is another company\'s user and one that exists nowhere get the same answer and the same stored result (no oracle).',
    sources: [`${ADJ2}:29 (X-R2-H3 option (c): uniform answers)`, 'backend/src/services/daily-report.service.js:230-238 (precedent: another company\'s person and a nowhere id get the same 404)'],
  },
});

// ── the plan (fixed) ─────────────────────────────────────────────────────────
const revDefectIds = (s) => OPS.flatMap((op) => REV_VARIANTS.filter((v) => v[1] === 'defect').map(([v]) => `REV.${s.key}.${op}.${v}`));
const fileDefectIds = (u) => OPS.flatMap((op) => u.variants.map(([v]) => `FILE.${u.key}.${op}.${v}`));
const upbDefectIds = (p) => OPS.map((op) => `UPB.${p.key}.${op}`);
const PLAN = [
  ['S.B', 'setup B (088): PM creates PB, uploads a text file with the canary through /workflow/uploads (201; D_B available, unlinked, in B\'s org and PB); its text extracted in process (ready); B downloads it (200, canary) and finds it by the canary in PB\'s document search and in the global search (positive controls)', { setup: true }],
  ['S.A', 'setup A (087): PM creates PA1, uploads seven own text files in one request (one per revision surface and per record file field; 201; each available, unlinked, in PA1, uploaded by the PM) and creates the standing records of the revisions door (RFI, submittal, drawing, transmittal, correspondence) and of the record file fields (drawing, transmittal): 201 each, no reference, no revision naming a file, no file field set', { setup: true }],
  ['S.U', 'setup U (087/088): B\'s user is B\'s PM persona (pm@<B domain>) resolved in process (one User row; /auth/me as B\'s PM answers that id; an active membership in B, none in A), A\'s PM the same way in A; PM creates an activity, uploads two site photos in one request (201; site_photo, available, in PA1, uploaded by the PM) and one standing record per uploader path (nine workflow records, a draft change order, a draft daily report, a draft site diary): 201 each, no reference, no photo', { setup: true }],
  ...REV_SURFACES.flatMap((s) => [
    [`REV.${s.key}.own`, `control: A's own fresh PA1 upload named by two revisions (its storage key; its PA1 product URL) is accepted and filed on the ${s.label}: create 201 (2 revisions naming it), standing record PATCH 200 (2 revisions naming it) [${s.revSites.join(', ')}]`, { guard: true, rule: 'R29' }],
    ...OPS.flatMap((op) => REV_VARIANTS.map(([v, kind, what, head]) => [
      `REV.${s.key}.${op}.${v}`,
      `${s.label} ${op === 'create' ? 'POST (a new record)' : 'PATCH (the standing record)'} with ${what}: refused (4xx), no revision with this write's code, record field or read-back revision naming D_B${op === 'create' ? ', no record left' : ', record still there'} [${head}; ${s.revSites[op === 'create' ? 0 : 1]}]`,
      kind === 'defect' ? { defect: DEFECT_REV, rule: 'XDOC-W' } : { guard: true, rule: 'R29' },
    ])),
    [`C.REV.${s.key}`, `control (no oracle): on the ${s.label}, the ten revision writes repeated with an id that exists nowhere (and a random project for the foreign route) answer exactly as the foreign writes did (status and code) and are stored exactly when they were (HEAD: equal)`, { guard: true, rule: 'XDOC-U' }],
  ]),
  ...FILE_UNITS.flatMap((u) => [
    [`FILE.${u.key}.own`, `control: A's own fresh PA1 upload named in the ${u.label} is accepted and stored: create 201 and standing record PATCH 200 (cleared first), the field naming it each time [${u.sites.join(', ')}]`, { guard: true, rule: 'XDOC-W' }],
    ...OPS.flatMap((op) => u.variants.map(([v, what]) => [
      `FILE.${u.key}.${op}.${v}`,
      `${u.label} ${op === 'create' ? 'POST (a new record)' : 'PATCH (the standing record, its field cleared first)'} with ${what}: refused (4xx), neither the field nor any revision of the record nor the read-back naming D_B${op === 'create' ? ', no record left' : ', record still there'} [HEAD FAIL: stored as sent; ${u.sites[op === 'create' ? 0 : 1]}]`,
      { defect: DEFECT_REV, rule: 'XDOC-W' },
    ])),
    [`C.FILE.${u.key}`, `control (no oracle): the six ${u.label} writes repeated with an id that exists nowhere (and a random project for the foreign route) answer exactly as the foreign writes did and are stored exactly when they were (HEAD: equal)`, { guard: true, rule: 'XDOC-U' }],
  ]),
  ...UPB_PATHS.flatMap((p) => [
    [`UPB.${p.key}.own`, `control: a ${p.label} sent with no uploadedBy is accepted (create 201, standing record PATCH 200, one entry each) and its stored uploader is the writer (A's PM) or empty, never another person`, { guard: true, rule: 'UPB-W' }],
    ...OPS.map((op) => [
      `UPB.${p.key}.${op}`,
      `${p.label} ${op === 'create' ? 'POST (a new record)' : 'PATCH (the standing record, cleared first)'} with uploadedBy = B's PM's user id: the stored uploader (database and read-back) is the writer, A's PM, or the request is refused (4xx) with nothing stored${op === 'create' ? ' and no record left' : ' and the record still there'}; never B's user [HEAD ${p.head === 'FAIL' ? 'FAIL: stored as sent' : 'PASS: the uploader is re-read from the photo\'s document'}; ${p.sites[op === 'create' ? 0 : 1]}]`,
      { defect: DEFECT_UPB, rule: 'UPB-W' },
    ]),
    [`C.UPB.${p.key}`, `control (no oracle): the ${p.label} create and update repeated with an uploadedBy that exists nowhere answer exactly as with B's user (status and code), store as many entries and keep the sent value exactly when B's was kept (HEAD: equal)`, { guard: true, rule: 'UPB-U' }],
  ]),
  ['R.dl.ownRoute', 'A: GET /projects/PA1/workflow/uploads/D_B and /<D_B\'s internal storageKey>: refused (HEAD 404 FILE_NOT_FOUND), none of B\'s bytes', { rule: 'XDOC-R' }],
  ['R.dl.foreignRoute', 'A: GET /projects/PB/workflow/uploads/D_B: refused (HEAD 404, project access), none of B\'s bytes', { rule: 'XDOC-R' }],
  ['R.dl.legacy', 'A: GET /projects/PA1/workflow/uploads/D_B.pdf (the legacy local path the <D_B>.pdf key names): refused (HEAD 404), none of B\'s bytes', { rule: 'XDOC-R' }],
  ['R.att', 'A: GET /projects/PA1/attachments/documents/D_B and /projects/PB/...: refused (HEAD 404), none of B\'s bytes', { rule: 'XDOC-R' }],
  ['R.site', 'A: GET /projects/PA1/site-reporting/uploads/D_B and /projects/PB/...: refused (HEAD 404), none of B\'s bytes', { rule: 'XDOC-R' }],
  ['R.text', 'A: GET /projects/PA1/documents/D_B/text and /projects/PB/...: refused (HEAD 404), no text', { rule: 'XDOC-R' }],
  ['R.search.project', 'A: GET /projects/PA1/documents/search?q=<canary> (and on PB): no hit naming D_B, the canary or B\'s file', { rule: 'XDOC-R' }],
  ['R.search.global', 'A: GET /search?q=<canary> (types=document; all types; projectId=PB): no hit naming D_B, the canary or B\'s file', { rule: 'XDOC-R' }],
  ['R.rev.download', 'A: every revision of PA1 naming D_B through GET /doc-control/revisions/:id/download and /preview: refused (HEAD 404 FILE_NOT_FOUND), none of B\'s bytes; positive control: A\'s own storage-key revision of the standing RFI downloads (200, its text) [doc-control.service.js:1230-1288]', { rule: 'XDOC-R' }],
  ...DETAIL_PATHS.map((d) => [`R.detail.${d.key}`, `A: the ${d.label}s as the PM reads them (list${d.single ? ' and the standing records\' single GET' : ''}; every standing record found): no projectDocument, originalName, sizeBytes or sha256 of D_B on any reference, revision, record field or photo, none of B's bytes, and B's user never resolved into a person (no name, no e-mail); refs echo only what A sent`, { rule: 'XDOC-R' }]),
  ['R.audit', 'A: the audit history of every standing record (five revision, two record-file, twelve uploader records; 200, events present each): no metadata of D_B, no canary, no person of B', { rule: 'XDOC-R' }],
  ['R.register', 'A: GET /projects/PA1/doc-control/register (200): no metadata of D_B on any attachment or revision, no canary, no person of B', { rule: 'XDOC-R' }],
  ['R.export', 'A: GET the RFI PDF of both standing RFIs (revisions door; uploader) and /punch/export.csv?kind=all (200 each): none of B\'s bytes or metadata, no person of B', { rule: 'XDOC-R' }],
  ['R.B.unchanged', 'B: D_B\'s orgId, projectId, status, linkedEntityType and linkedEntityId unchanged (available, unlinked) and B still reads it through /attachments/documents (200, canary)', { rule: 'XDOC-R' }],
  ['R.B.user', 'B: B\'s PM\'s user row (e-mail, name, home org) and its memberships unchanged by the run, still none in A', { rule: 'UPB-W' }],
];
/** Fixed before the first run: 153 in the plan + the harness's G.5xx. */
const EXPECTED_CHECKS = 154;
if (PLAN.length + 1 !== EXPECTED_CHECKS) throw new Error(`${NAME}: the plan lists ${PLAN.length} checks + G.5xx, EXPECTED_CHECKS is ${EXPECTED_CHECKS}`);
const DEFECT_IDS = PLAN.filter((entry) => entry[2]?.defect).map((entry) => entry[0]);
/** The defect checks the trace predicts HOLD at HEAD: the photo paths re-read the uploader (progress.service.js:634-647). */
const HEAD_DEFECT_PASSES = UPB_PATHS.filter((p) => p.head === 'PASS').flatMap(upbDefectIds);
const HEAD_FAILS = DEFECT_IDS.filter((id) => !HEAD_DEFECT_PASSES.includes(id));
if (DEFECT_IDS.length !== 76) throw new Error(`${NAME}: ${DEFECT_IDS.length} defect checks, 76 expected`);
if (HEAD_FAILS.length !== 72 || HEAD_DEFECT_PASSES.length !== 4) throw new Error(`${NAME}: ${HEAD_FAILS.length} HEAD failures and ${HEAD_DEFECT_PASSES.length} HEAD-holding defect checks, 72 and 4 expected`);

/** The classification units: each with its own control, its defect checks and the section that runs it. */
const UNITS = Object.freeze([
  ...REV_SURFACES.map((s) => ({ unit: `rev.${s.key}`, suspect: DEFECT_REV, own: `REV.${s.key}.own`, random: `C.REV.${s.key}`, defects: revDefectIds(s), sites: s.revSites, head: 'CONFIRMED' })),
  ...FILE_UNITS.map((u) => ({ unit: `file.${u.key}`, suspect: DEFECT_REV, own: `FILE.${u.key}.own`, random: `C.FILE.${u.key}`, defects: fileDefectIds(u), sites: u.sites, head: 'CONFIRMED' })),
  ...UPB_PATHS.map((p) => ({ unit: `upb.${p.key}`, suspect: DEFECT_UPB, own: `UPB.${p.key}.own`, random: `C.UPB.${p.key}`, defects: upbDefectIds(p), sites: p.sites, head: p.head === 'FAIL' ? 'CONFIRMED' : 'REJECTED' })),
]);

const CLASSIFICATION_RULE = 'Per unit (rev.<surface>, file.<field>, upb.<path>) over its defect checks: UNDETERMINED on a setup error, a thrown section, a check not run, or a failed own control; CONFIRMED when all fail; REJECTED when none fails; PARTIAL otherwise. Per suspect (XDOC-1c, XDOC-UPB): CONFIRMED / REJECTED when every unit is; UNDETERMINED when none is determined; PARTIAL otherwise. Beside it, never folded in: failed REV storageKey guards (a bare foreign id filed: R29 bypass, its own P1), failed C.* (an existence oracle), failed R.* reads (open cross-tenant read, P0 class; R.rev.download failing on its positive control alone is a read control), failed R.B.* (B\'s state changed).';

const h = harness.createHarness({
  name: NAME,
  plan: PLAN,
  rules: RULES,
  meta: {
    suspects: [DEFECT_REV, DEFECT_UPB],
    model: 'backend/scripts/cert/cert3/xdoc-1b-repro.js (run 2: C:/Temp/octapm-cert/logs/cert3-xdoc-1b-repro-2.log, 60/114, the 54 write checks fail)',
    rulings: `${R3}:16 (§12b), :17 (§14)`,
    companies: { A: COMPANY_A, B: COMPANY_B, rule: 'fixed codes (the XDOC-1 pair), each in the population and exactly one organisation by slug; never a first row' },
    bUserRule: 'B\'s PM persona (pm@<B domain>, scripts/cert/lib/spec.js:236): one User row, /auth/me as B\'s PM answers its id, an active membership in B and none in A; never a first row',
    projects: { A: PROJECT_A, B: PROJECT_B },
    stamp: STAMP,
    expectedChecks: EXPECTED_CHECKS,
    headExpectation: {
      fail: HEAD_FAILS,
      defectChecksHolding: HEAD_DEFECT_PASSES,
      exit: 2,
      verdict: 'DEFECT_PRESENT',
      classification: 'harness PARTIAL (72 of 76); XDOC-1c CONFIRMED on its seven units; XDOC-UPB CONFIRMED on the nine workflow references and the change order, REJECTED on the daily-report and site-diary photos',
      perUnit: Object.fromEntries(UNITS.map((u) => [u.unit, u.head])),
    },
    classificationRule: CLASSIFICATION_RULE,
    callSites: Object.fromEntries(UNITS.map((u) => [u.unit, u.sites])),
  },
});

// ── small helpers ────────────────────────────────────────────────────────────
const listOf = (data) => (Array.isArray(data) ? data : []);
/** The list in an answer: a bare array, or rows / items / events / orders. */
const rowsOf = (data) => {
  if (Array.isArray(data)) return data;
  for (const key of ['rows', 'items', 'events', 'orders']) if (Array.isArray(data?.[key])) return data[key];
  return [];
};
const is4xx = (res) => Boolean(res) && res.status >= 400 && res.status < 500;
const textOf = (res) => (res?.buffer ? res.buffer.toString('utf8') : res?.text || '');
const json = (value, max = 900) => {
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return String(value).slice(0, max);
  }
};
const said = (res) => h.said(res);
const saidLong = (res) => `${said(res)}${res && res.status >= 400 && res.body?.error?.message ? ` (${res.body.error.message})` : ''}`;
/** Whether a stored row or a read-back ref names one of these keys in any document field. */
const namesAny = (row, keys) =>
  [row?.documentId, row?.projectDocumentId, row?.storageKey, row?.fileUrl, row?.url, row?.key, row?.projectDocument?.id]
    .some((v) => typeof v === 'string' && keys.some((k) => k && v.includes(k)));
/**
 * An uploader as stored or served, as an id: a serialiser that resolves it into a person ({id, name, email}) is judged
 * by the reads (R.detail), never mistaken here for another person.
 */
const uploaderId = (v) => (v && typeof v === 'object' ? v.id ?? null : v ?? null);
/** Each item once (the workflow lists answer attachmentRefs and attachments as the same list). */
const unique = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    const k = json(item, 100000);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
/** A record's references as read back: attachments, revisions, photos, documentsJson entries and its own fileUrl. */
const refsOf = (rec) => {
  if (!rec) return [];
  const docs = Array.isArray(rec.documentsJson) ? rec.documentsJson : rec.documentsJson && typeof rec.documentsJson === 'object' ? [rec.documentsJson] : [];
  const field = typeof rec.fileUrl === 'string' && rec.fileUrl ? [{ fileUrl: rec.fileUrl, fileName: rec.drawingNumber || null }] : [];
  return unique([...listOf(rec.attachmentRefs), ...listOf(rec.attachments), ...listOf(rec.revisions), ...listOf(rec.photos), ...docs.filter((d) => d && typeof d === 'object'), ...field]);
};

// ── run state (shared with cleanup) ─────────────────────────────────────────
const ctx = { db: null, q: null, pmA: null, pmB: null, orgA: null, orgB: null, projectA: null, projectB: null, D_B: null, docB: null, aPm: null, bUser: null, rev: {}, file: {}, upb: {}, photos: {}, activityId: null };
const verdict = new Map();
const failedSections = new Set();
let mainError = null;
const obs = { writes: {}, random: {}, readStage: {}, reads: {}, own: {} };

/** The only verdict: the harness's check, remembered here for the per-unit classification. */
const check = (id, ok, detail) => {
  verdict.set(id, ok === true);
  return h.check(id, ok, detail);
};
/** A request whose answer the harness sees (rule 4). */
const ask = async (who, label, method, route, body, options) => h.keep(label, await who.send(method, route, body, options));

const main = async () => {
  const [companyA, companyB] = h.companies(COMPANY_A, COMPANY_B);
  const db = await h.connect();
  ctx.db = db;
  const { q } = h.sql(db);
  ctx.q = q;
  const orgOf = async (code) => {
    const orgs = await q('select id, slug, name from "Organisation" where slug like $1', [`cert-${code}-%`]);
    if (orgs.length !== 1) throw new Error(`company ${code}: ${orgs.length} organisations, exactly one expected`);
    return certEnv.assertCertOrganisation(orgs[0]);
  };
  const orgA = await orgOf(COMPANY_A);
  const orgB = await orgOf(COMPANY_B);
  if (orgA.id === orgB.id) throw new Error('companies A and B resolve to one organisation');
  ctx.orgA = orgA;
  ctx.orgB = orgB;
  obs.companies = { A: { code: COMPANY_A, orgId: orgA.id, slug: orgA.slug, populationSlug: companyA.slug }, B: { code: COMPANY_B, orgId: orgB.id, slug: orgB.slug, populationSlug: companyB.slug } };
  const pmA = api.as({ email: `pm@${companyA.domain}`, orgId: orgA.id });
  const pmB = api.as({ email: `pm@${companyB.domain}`, orgId: orgB.id });
  ctx.pmA = pmA;
  ctx.pmB = pmB;
  console.log(`${NAME}: A ${COMPANY_A} ${orgA.name} (${orgA.id}); B ${COMPANY_B} ${orgB.name} (${orgB.id}); stamp ${STAMP}; in process`);

  const docRow = async (id) =>
    (await q('select id, "orgId", "projectId", "documentType", "originalName", "fileName", "sizeBytes", sha256, "storageKey", status, "scanStatus", "uploadedBy", "linkedEntityType", "linkedEntityId" from "ProjectDocument" where id = $1', [id]))[0] || null;
  /** One upload request carrying these files (the routes take up to ten: workflow-uploads.js:78, site-reporting.js:62). */
  const upload = async (who, label, projectRoute, path, files) => {
    const form = new FormData();
    for (const f of files) form.append('files', new Blob([f.body], { type: f.type }), f.name);
    const res = await ask(who, label, 'POST', `${projectRoute}/${path}`, undefined, { form });
    const rows = res.status === 201 ? rowsOf(res.body?.data) : [];
    return { res, ids: rows.map((r) => r?.documentId || null).filter(Boolean) };
  };

  // ── setup B: the other company's document (as xdoc-1b-repro.js) ──────────
  await h.section('setup B', async () => {
    const createdB = await ask(pmB, 'B: PM creates PB', 'POST', '/projects', { name: PROJECT_B, startDate: START, endDate: END, projectCalendar: 'five_day' });
    ctx.projectB = createdB.status === 201 ? createdB.body?.data?.id || null : null;
    const PB = `/projects/${ctx.projectB}`;
    const upB = ctx.projectB ? await upload(pmB, 'B: PM uploads the canary file to PB', PB, 'workflow/uploads', [{ name: B_FILE, body: Buffer.from(B_TEXT, 'utf8'), type: 'text/plain' }]) : { res: null, ids: [] };
    const D_B = upB.ids.length === 1 ? upB.ids[0] : null;
    ctx.D_B = D_B;
    const docB = D_B ? await docRow(D_B) : null;
    ctx.docB = docB;
    obs.D_B = D_B;
    obs.docB = docB && { ...docB };
    obs.canary = CANARY;
    let extracted = null;
    if (D_B) {
      try {
        // The background worker's step, for a document this run made (the worker is off in process).
        // eslint-disable-next-line global-require
        extracted = await require('../../../src/services/document-text.service').runDocumentExtractJob({ job: { orgId: orgB.id }, payload: { documentId: D_B } });
      } catch (error) {
        extracted = { status: 'error', reason: error.message };
      }
    }
    obs.extraction = extracted;
    const readB = D_B ? await ask(pmB, 'B: PM downloads D_B', 'GET', `${PB}/workflow/uploads/${D_B}`, undefined, { binary: true }) : null;
    const searchB = D_B ? await ask(pmB, 'B: PM searches PB for the canary', 'GET', `${PB}/documents/search?q=${encodeURIComponent(CANARY)}`) : null;
    const globalB = D_B ? await ask(pmB, 'B: PM global search for the canary', 'GET', `/search?q=${encodeURIComponent(CANARY)}&types=document&limit=50`) : null;
    const hitB = (res) => res?.status === 200 && json(rowsOf(res.body?.data), 1e9).includes(D_B);
    check('S.B',
      createdB.status === 201 && Boolean(ctx.projectB) && upB.res?.status === 201 && Boolean(D_B)
        && docB?.orgId === orgB.id && docB?.projectId === ctx.projectB && docB?.status === 'available' && !docB?.linkedEntityType && !docB?.linkedEntityId
        && extracted?.status === 'ready'
        && readB?.status === 200 && textOf(readB).includes(CANARY)
        && hitB(searchB) && hitB(globalB),
      `PB ${said(createdB)} ${createdB.body?.error?.message || ''}; upload ${said(upB.res)} (${upB.ids.length} id(s)); D_B ${D_B} ${json(docB && { orgId: docB.orgId, projectId: docB.projectId, status: docB.status, linked: [docB.linkedEntityType, docB.linkedEntityId], storageKey: docB.storageKey })}; extraction ${json(extracted)}; B download ${said(readB)} canary ${readB ? textOf(readB).includes(CANARY) : false}; B project search ${said(searchB)} hit ${hitB(searchB)}; B global search ${said(globalB)} hit ${hitB(globalB)}`);
  });
  if (verdict.get('S.B') !== true) throw new Error('setup incomplete: company B');
  const D_B = ctx.D_B;
  const docB = ctx.docB;
  const PB = `/projects/${ctx.projectB}`;
  const B_KEYS = [D_B, docB.storageKey].filter(Boolean);
  const namesB = (row) => namesAny(row, B_KEYS);
  /** What of company B an answer must never carry: B's bytes and metadata now, B's person once resolved (setup U). */
  const markers = [['canary', CANARY], ['originalName', docB.originalName], ['sha256', docB.sha256]];
  const leakIn = (text) => {
    const t = String(text || '').toLowerCase();
    return markers.filter(([, v]) => v && t.includes(String(v).toLowerCase())).map(([k]) => k);
  };
  /** A ref naming D_B that carries D_B's own metadata (only the document row could have given it). */
  const metaOfB = (ref) =>
    namesB(ref) && Boolean(
      ref.projectDocument
        || (ref.sizeBytes !== null && ref.sizeBytes !== undefined && Number(ref.sizeBytes) === Number(docB.sizeBytes))
        || (ref.sha256 && ref.sha256 === docB.sha256)
        || ref.originalName === docB.originalName
        || ref.fileName === docB.originalName,
    );
  /** B's user resolved into a person somewhere in an answer: an object with B's user id and a name or an e-mail. */
  const personOfB = (value, depth = 0) => {
    if (!ctx.bUser || !value || typeof value !== 'object' || depth > 14) return false;
    if (Array.isArray(value)) return value.some((v) => personOfB(v, depth + 1));
    if (value.id === ctx.bUser.id && (value.name || value.email)) return true;
    return Object.values(value).some((v) => personOfB(v, depth + 1));
  };

  // ── setup A: the revision and record-file parts' project, files and standing records ──
  await h.section('setup A', async () => {
    const createdA = await ask(pmA, 'A: PM creates PA1', 'POST', '/projects', { name: PROJECT_A, startDate: START, endDate: END, projectCalendar: 'five_day' });
    ctx.projectA = createdA.status === 201 ? createdA.body?.data?.id || null : null;
    const PA = `/projects/${ctx.projectA}`;
    for (const s of REV_SURFACES) ctx.rev[s.key] = { route: `${PA}/${s.base}`, standingId: null, ids: [], own: null, ownRevisionCode: null };
    for (const u of FILE_UNITS) ctx.file[u.key] = { route: `${PA}/${SURFACE[u.surface].base}`, standingId: null, ids: [], own: null };
    const ownFiles = [
      ...REV_SURFACES.map((s) => ({ slot: `rev.${s.key}`, name: `xdoc1c-a-own-rev-${s.key}-${STAMP}.txt`, text: `${OWN_MARK} for the ${s.label}'s revisions.\n` })),
      ...FILE_UNITS.map((u) => ({ slot: `file.${u.key}`, name: `xdoc1c-a-own-file-${u.key}-${STAMP}.txt`, text: `${OWN_MARK} for the ${u.label}.\n` })),
    ];
    const ownUp = ctx.projectA ? await upload(pmA, 'A: PM uploads its own files (seven, one request)', PA, 'workflow/uploads', ownFiles.map((f) => ({ name: f.name, body: Buffer.from(f.text, 'utf8'), type: 'text/plain' }))) : { res: null, ids: [] };
    // Each own file is matched to its slot by the name the database stored, never by position alone.
    const ownOk = [];
    const slot = (key) => (key.startsWith('rev.') ? ctx.rev[key.slice(4)] : ctx.file[key.slice(5)]);
    for (const id of ownUp.ids) {
      const row = await docRow(id);
      const file = ownFiles.find((f) => f.name === row?.originalName);
      if (file && !slot(file.slot).own) {
        slot(file.slot).own = row;
        ownOk.push(row.projectId === ctx.projectA && row.orgId === orgA.id && row.status === 'available' && !row.linkedEntityType && !row.linkedEntityId);
      }
    }
    const standing = {};
    const make = async (part, s, holder) => {
      const res = await ask(pmA, `A: PM creates the standing ${part} ${s.label}`, 'POST', holder.route, s.body(`${part} standing ${STAMP}`));
      const id = res.status === 201 ? res.body?.data?.id || null : null;
      holder.standingId = id;
      if (id) holder.ids.push(id);
      const refs = id ? Number((await q('select count(*)::int as n from "WorkflowAttachment" where "projectId" = $1 and "recordType" = $2 and "recordId" = $3', [ctx.projectA, s.recordType, id]))[0].n) : null;
      const files = id ? Number((await q('select count(*)::int as n from "DocumentRevision" where "projectId" = $1 and "recordType" = $2 and "recordId" = $3 and coalesce("storageKey", "fileUrl", "projectDocumentId") is not null', [ctx.projectA, s.recordType, id]))[0].n) : null;
      const field = id && FILE_UNITS.some((u) => u.surface === s.key) ? await fieldText(s.table, id) : null;
      standing[`${part}.${s.key}`] = { answer: saidLong(res), id, refs, revisionsWithAFile: files, fileField: field };
    };
    for (const s of REV_SURFACES) if (ctx.projectA) await make('rev', s, ctx.rev[s.key]);
    for (const u of FILE_UNITS) if (ctx.projectA) await make('file', SURFACE[u.surface], ctx.file[u.key]);
    obs.projectA = ctx.projectA;
    obs.projectB = ctx.projectB;
    obs.standing = standing;
    obs.ownDocuments = { ...Object.fromEntries(REV_SURFACES.map((s) => [`rev.${s.key}`, ctx.rev[s.key]?.own?.id || null])), ...Object.fromEntries(FILE_UNITS.map((u) => [`file.${u.key}`, ctx.file[u.key]?.own?.id || null])) };
    check('S.A',
      createdA.status === 201 && Boolean(ctx.projectA)
        && ownUp.res?.status === 201 && ownUp.ids.length === ownFiles.length && ownOk.length === ownFiles.length && ownOk.every(Boolean)
        && REV_SURFACES.every((s) => Boolean(ctx.rev[s.key]?.own))
        && FILE_UNITS.every((u) => Boolean(ctx.file[u.key]?.own))
        && Object.keys(standing).length === REV_SURFACES.length + FILE_UNITS.length
        && Object.values(standing).every((x) => Boolean(x.id) && x.refs === 0 && x.revisionsWithAFile === 0 && (x.fileField === null || isEmptyField(x.fileField))),
      `PA1 ${said(createdA)} ${createdA.body?.error?.message || ''}; own upload ${said(ownUp.res)} (${ownUp.ids.length} id(s), ${ownOk.filter(Boolean).length} matched, available and unlinked in PA1); standing records ${json(standing, 2500)}`);
  });
  if (verdict.get('S.A') !== true) throw new Error('setup incomplete: company A (revision and record-file parts)');
  const PA = `/projects/${ctx.projectA}`;

  // ── setup U: the people, the activity, the site photos and the uploader parts' standing records ──
  await h.section('setup U', async () => {
    /** A persona resolved by rule: one User row for the e-mail, the id /auth/me answers for the persona's own session, its memberships. */
    const resolve = async (who, label) => {
      const rows = await q('select id, name, email, "orgId" from "User" where email = $1', [who.email]);
      const me = await ask(who, `${label}: /auth/me`, 'GET', '/auth/me');
      const meId = me.status === 200 ? me.body?.data?.id || me.body?.data?.user?.id || null : null;
      const memberships = rows.length === 1 ? await q('select "orgId", role, status from "OrganizationMembership" where "userId" = $1 order by "orgId", role, status', [rows[0].id]) : [];
      return { rows, me: said(me), meId, memberships, user: rows.length === 1 ? rows[0] : null };
    };
    const a = await resolve(pmA, 'A: PM');
    const b = await resolve(pmB, 'B: PM');
    const aOk = Boolean(a.user) && a.meId === a.user.id && a.memberships.some((m) => m.orgId === orgA.id && m.status === 'active');
    const bOk = Boolean(b.user) && b.meId === b.user.id && b.memberships.some((m) => m.orgId === orgB.id && m.status === 'active') && !b.memberships.some((m) => m.orgId === orgA.id) && b.user.id !== a.user?.id;
    ctx.aPm = aOk ? a.user.id : null;
    ctx.bUser = bOk ? { id: b.user.id, email: b.user.email, name: b.user.name, orgId: b.user.orgId, memberships: b.memberships } : null;
    // B's PM's name is a leak marker only when no member of A shares it (a coincidence must not read as a leak).
    const sameName = bOk ? Number((await q('select count(*)::int as n from "User" u join "OrganizationMembership" m on m."userId" = u.id where m."orgId" = $1 and lower(u.name) = lower($2)', [orgA.id, b.user.name]))[0].n) : null;
    const nameMarker = bOk && sameName === 0 && String(b.user.name || '').trim().length >= 5;
    if (bOk) {
      markers.push(['bUserEmail', b.user.email]);
      if (nameMarker) markers.push(['bUserName', b.user.name]);
    }
    obs.persons = { aPm: ctx.aPm, bUser: ctx.bUser && { id: ctx.bUser.id, email: ctx.bUser.email, orgId: ctx.bUser.orgId, memberships: ctx.bUser.memberships }, bNameIsMarker: nameMarker, aMembersSharingBName: sameName };

    const activity = await ask(pmA, 'A: PM creates the activity (the daily reports\')', 'POST', `${PA}/activities`, { name: `XDOC-1c repro activity ${STAMP}`, duration: 5, ...(ctx.aPm ? { engineerIds: [ctx.aPm] } : {}) });
    ctx.activityId = activity.status === 201 ? activity.body?.data?.id || null : null;
    const photoFiles = [
      { slot: 'dr', name: `xdoc1c-a-site-dr-${STAMP}.png` },
      { slot: 'sd', name: `xdoc1c-a-site-sd-${STAMP}.png` },
    ];
    const up = await upload(pmA, 'A: PM uploads two site photos (one request)', PA, 'site-reporting/uploads', photoFiles.map((f) => ({ name: f.name, body: PNG_1X1, type: 'image/png' })));
    const photoOk = [];
    for (const id of up.ids) {
      const row = await docRow(id);
      const file = photoFiles.find((f) => f.name === row?.originalName);
      if (file && !ctx.photos[file.slot]) {
        ctx.photos[file.slot] = row;
        photoOk.push(row.documentType === 'site_photo' && row.projectId === ctx.projectA && row.orgId === orgA.id && row.status === 'available' && row.uploadedBy === ctx.aPm);
      }
    }

    const standing = {};
    for (const p of UPB_PATHS) {
      const U = { route: `${PA}/${p.base}`, standingId: null, ids: [] };
      ctx.upb[p.key] = U;
      const res = await ask(pmA, `A: PM creates the standing ${p.label}'s record`, 'POST', U.route, upbCreateBody(p, `upb standing ${STAMP}`));
      const id = res.status === 201 ? res.body?.data?.id || null : null;
      U.standingId = id;
      if (id) U.ids.push(id);
      const entries = id ? (await upbEntries(p, id)).length : null;
      standing[p.key] = { answer: saidLong(res), id, entries, status: res.body?.data?.status || null };
    }
    obs.upbStanding = standing;
    obs.activityId = ctx.activityId;
    obs.sitePhotos = { dr: ctx.photos.dr?.id || null, sd: ctx.photos.sd?.id || null };
    check('S.U',
      aOk && bOk
        && activity.status === 201 && Boolean(ctx.activityId)
        && up.res?.status === 201 && up.ids.length === 2 && photoOk.length === 2 && photoOk.every(Boolean)
        && UPB_PATHS.every((p) => Boolean(standing[p.key]?.id) && standing[p.key].entries === 0)
        && ['co', 'dr', 'sd'].every((k) => standing[k].status === 'draft'),
      `A's PM ${json({ rows: a.rows.length, me: a.me, sameId: a.meId === a.user?.id, memberships: a.memberships.length })}; B's user ${json({ rows: b.rows.length, me: b.me, sameId: b.meId === b.user?.id, inB: b.memberships.some((m) => m.orgId === orgB.id && m.status === 'active'), inA: b.memberships.some((m) => m.orgId === orgA.id), nameMarker })}; activity ${saidLong(activity)}; site photos ${said(up.res)} (${up.ids.length} id(s), ${photoOk.filter(Boolean).length} site_photo, available, the PM's); standing ${json(standing, 2500)}`);
  });
  if (verdict.get('S.U') !== true) throw new Error('setup incomplete: the uploader part');

  const URL_PB = `/api/v1/projects/${ctx.projectB}/workflow/uploads/${D_B}`;
  const URL_PA = `/api/v1/projects/${ctx.projectA}/workflow/uploads/${D_B}`;
  const N_B = { id: D_B, urlPB: URL_PB, urlPA1: URL_PA };
  /** A name that exists nowhere: a random document id, through a random project and through PA1. */
  const randomName = () => {
    const doc = crypto.randomUUID();
    return { id: doc, urlPB: `/api/v1/projects/${crypto.randomUUID()}/workflow/uploads/${doc}`, urlPA1: `/api/v1/projects/${ctx.projectA}/workflow/uploads/${doc}` };
  };
  const ownUrl = (id) => `/api/v1/projects/${ctx.projectA}/workflow/uploads/${id}`;
  const fname = (part, key, tag) => `xdoc1c-a-${part}-${key}-${tag}-${STAMP}.pdf`;

  // ── SQL readers (reads only) ──────────────────────────────────────────────
  const recordCount = async (table) => Number((await q(`select count(*)::int as n from "${table}" where "projectId" = $1`, [ctx.projectA]))[0].n);
  const revRows = async (s, id) => q('select id, revision, "projectDocumentId", "storageKey", "fileUrl", "fileName" from "DocumentRevision" where "projectId" = $1 and "recordType" = $2 and "recordId" = $3 order by "createdAt"', [ctx.projectA, s.recordType, id]);
  const rowNaming = async (table, id, keys) => {
    const row = (await q(`select to_jsonb(t)::text as j from "${table}" t where t.id = $1`, [id]))[0];
    return Boolean(row) && keys.some((k) => k && row.j.includes(k));
  };
  /** The record as the PM reads it: its single GET where the module has one, else its list. */
  const readBack = async (s, route, id, label) => {
    const res = await ask(pmA, label, 'GET', s.single ? `${route}/${id}` : `${route}${s.listQuery || ''}`);
    let rec = null;
    if (res.status === 200) rec = s.single ? (res.body?.data?.id === id ? res.body.data : null) : rowsOf(res.body?.data).find((r) => r?.id === id) || null;
    return { res, rec };
  };

  // ── (1) the revisions door ─────────────────────────────────────────────────
  /** A create, judged on its own: the answer, the new record's revisions and own field, the table's record count before and after. */
  const revCreate = async (s, label, body, keys, codes) => {
    const R = ctx.rev[s.key];
    const before = await recordCount(s.table);
    const res = await ask(pmA, `rev ${s.key} create ${label}: PM POSTs a new ${s.label}`, 'POST', R.route, { ...s.body(`rev ${label} ${STAMP}`), ...body });
    const id = res.status === 201 ? res.body?.data?.id || null : null;
    if (id) R.ids.push(id);
    const after = await recordCount(s.table);
    const revs = id ? await revRows(s, id) : [];
    const field = id ? await rowNaming(s.table, id, keys) : false;
    const back = id ? await readBack(s, R.route, id, `rev ${s.key} create ${label}: PM reads the new ${s.label} back`) : null;
    const mine = revs.filter((r) => codes.includes(r.revision));
    const sqlNaming = revs.filter((r) => namesAny(r, keys));
    const apiNaming = back ? listOf(back.rec?.revisions).filter((r) => namesAny(r, keys)) : [];
    return {
      op: 'create', res, said: saidLong(res), id, before, after, revs, mine, mineNaming: mine.filter((r) => namesAny(r, keys)), sqlNaming, apiNaming, field,
      stored: sqlNaming.length > 0 || apiNaming.length > 0 || field, recordLeft: after !== before, readBack: back ? said(back.res) : null,
    };
  };
  /** The drawing's own fileUrl is set by a record entry (recordUrl): emptied before each update so its check reads only that write. */
  const revReset = async (s) => {
    if (s.key !== 'drawing') return;
    const R = ctx.rev[s.key];
    const v = await fieldText(s.table, R.standingId);
    if (isEmptyField(v)) return;
    const res = await ask(pmA, `rev ${s.key}: PM clears the standing drawing's fileUrl`, 'PATCH', `${R.route}/${R.standingId}`, { fileUrl: null });
    const left = await fieldText(s.table, R.standingId);
    if (res.status !== 200 || !isEmptyField(left)) throw new Error(`the standing drawing's fileUrl could not be cleared before the next write (${saidLong(res)}; left ${left})`);
  };
  /** An update of the standing record, judged on its own: this write's codes, the record's own field, the read-back. */
  const revUpdate = async (s, label, body, keys, codes) => {
    const R = ctx.rev[s.key];
    await revReset(s);
    const res = await ask(pmA, `rev ${s.key} update ${label}: PM PATCHes the standing ${s.label}`, 'PATCH', `${R.route}/${R.standingId}`, body);
    const revs = await revRows(s, R.standingId);
    const mine = revs.filter((r) => codes.includes(r.revision));
    const field = await rowNaming(s.table, R.standingId, keys);
    const back = await readBack(s, R.route, R.standingId, `rev ${s.key} update ${label}: PM reads the standing ${s.label} back`);
    const sqlNaming = mine.filter((r) => namesAny(r, keys));
    const apiNaming = listOf(back.rec?.revisions).filter((r) => codes.includes(r.revision) && namesAny(r, keys));
    return { op: 'update', res, said: saidLong(res), id: R.standingId, revs: mine, mine, mineNaming: sqlNaming, sqlNaming, apiNaming, field, stored: sqlNaming.length > 0 || apiNaming.length > 0 || field, found: Boolean(back.rec), readBack: said(back.res) };
  };
  const revNote = (o, body) => `PM ${o.op === 'create' ? 'POST' : 'PATCH'} ${json(body, 420)} -> ${o.said}; stored: ${o.stored ? `YES (${o.sqlNaming.length} revision row(s) ${json(o.sqlNaming.map(({ revision, storageKey, fileUrl, projectDocumentId }) => ({ revision, storageKey, fileUrl, projectDocumentId })), 500)}; ${o.apiNaming.length} read-back revision(s)${o.field ? '; the record\'s own field names it' : ''})` : 'no'}${o.op === 'create' ? `; record ${o.id || 'none'}; ${o.before} -> ${o.after} record(s) of the table in PA1` : `; read back ${o.readBack}${o.found ? '' : ' (record NOT found)'}`}`;

  for (const s of REV_SURFACES) {
    await h.section(`revisions door: ${s.label}`, async () => {
      const R = ctx.rev[s.key];
      // REV.s.own: the own fresh upload, first on a create (no writer may be named there), then on the standing record.
      const ownKeys = [R.own.id, R.own.storageKey].filter(Boolean);
      const ownBody = (tag) => {
        const c1 = revCode();
        const c2 = revCode();
        return { codes: [c1, c2], body: { revisions: [{ revision: c1, fileName: fname('rev', s.key, `${tag}-own-key`), storageKey: R.own.id }, { revision: c2, fileName: fname('rev', s.key, `${tag}-own-url`), fileUrl: ownUrl(R.own.id) }] } };
      };
      const oc0 = ownBody('c');
      const oc = await revCreate(s, 'own', oc0.body, ownKeys, oc0.codes);
      const ou0 = ownBody('u');
      const ou = await revUpdate(s, 'own', ou0.body, ownKeys, ou0.codes);
      R.ownRevisionCode = ou0.codes[0];
      obs.own[`rev.${s.key}`] = { create: { answer: oc.said, id: oc.id, mine: oc.mine.length, namingOwn: oc.mineNaming.length }, update: { answer: ou.said, mine: ou.mine.length, namingOwn: ou.mineNaming.length } };
      check(`REV.${s.key}.own`,
        oc.res.status === 201 && Boolean(oc.id) && oc.mineNaming.length === 2 && ou.res.status === 200 && ou.mineNaming.length === 2,
        `create ${oc.said} record ${oc.id || 'none'}, ${oc.mine.length} revision(s) with its codes, ${oc.mineNaming.length} naming the own file; update ${ou.said}, ${ou.mine.length} with its codes, ${ou.mineNaming.length} naming it`);

      const foreign = { create: {}, update: {} };
      for (const op of OPS) {
        for (const [v, kind, , head] of REV_VARIANTS) {
          const id = `REV.${s.key}.${op}.${v}`;
          const c = revCode();
          const body = revBody(v, N_B, c, fname('rev', s.key, `${op}-${v}`));
          const o = op === 'create' ? await revCreate(s, v, body, B_KEYS, [c]) : await revUpdate(s, v, body, B_KEYS, [c]);
          foreign[op][v] = o;
          obs.writes[id] = { sent: body, answer: o.said, stored: o.stored, revisions: o.sqlNaming.map(({ revision, storageKey, fileUrl, projectDocumentId }) => ({ revision, storageKey, fileUrl, projectDocumentId })), fieldNames: o.field, record: o.id, ...(op === 'create' ? { recordLeft: o.recordLeft } : { found: o.found }) };
          const ok = op === 'create'
            ? is4xx(o.res) && !o.id && !o.stored && !o.recordLeft
            : is4xx(o.res) && !o.stored && o.found;
          check(id, ok, `${revNote(o, body)}; ${head}${o.stored && kind === 'defect' ? ' -- the XDOC-1c revisions door (cross-company reference stored, P1 class)' : ''}${o.stored && kind === 'guard' ? ' -- the bare foreign id FILED: an R29 bypass on this door (P1 on its own)' : ''}`);
        }
      }

      // C.REV.s: the same ten writes with names that exist nowhere answer as the foreign ones did.
      const pairs = [];
      for (const op of OPS) {
        for (const [v] of REV_VARIANTS) {
          const r = randomName();
          const c = revCode();
          const body = revBody(v, r, c, fname('rev', s.key, `${op}-${v}-random`));
          const o = op === 'create' ? await revCreate(s, `${v} (random)`, body, [r.id], [c]) : await revUpdate(s, `${v} (random)`, body, [r.id], [c]);
          const f = foreign[op][v];
          const same = said(o.res) === said(f.res) && o.stored === f.stored && (op === 'create' ? Boolean(o.id) === Boolean(f.id) && o.recordLeft === f.recordLeft : o.found === f.found);
          pairs.push({ op, variant: v, random: { answer: said(o.res), stored: o.stored }, foreign: { answer: said(f.res), stored: f.stored }, same });
        }
      }
      obs.random[`rev.${s.key}`] = pairs;
      const differ = pairs.filter((p) => !p.same);
      check(`C.REV.${s.key}`, differ.length === 0,
        `${differ.length ? `ORACLE: ${differ.map((p) => `${p.op}.${p.variant} random ${p.random.answer}${p.random.stored ? ' stored' : ''} vs foreign ${p.foreign.answer}${p.foreign.stored ? ' stored' : ''}`).join('; ')}. ` : ''}${pairs.map((p) => `${p.op}.${p.variant} ${p.random.answer}${p.random.stored ? ' stored' : ''} = ${p.foreign.answer}${p.foreign.stored ? ' stored' : ''}`).join('; ')}`);

      // The read stage: the standing record files every form HEAD stores, at once.
      const cs = [revCode(), revCode(), revCode(), revCode()];
      const stage = { revisions: [{ revision: cs[0], fileName: fname('rev', s.key, 'stage-url-pb'), fileUrl: URL_PB }, { revision: cs[1], fileName: fname('rev', s.key, 'stage-url-pa1'), fileUrl: URL_PA }, { revision: cs[2], fileName: fname('rev', s.key, 'stage-legacy'), storageKey: `${D_B}.pdf` }], revision: cs[3], fileUrl: URL_PB };
      const st = await revUpdate(s, 'read stage', stage, B_KEYS, cs);
      obs.readStage[`rev.${s.key}`] = { answer: st.said, storedNamingDB: st.sqlNaming.length, of: cs.length };
    }, { onError: async () => { failedSections.add(`rev.${s.key}`); } });
  }

  // ── (2) the record file fields ────────────────────────────────────────────
  /** A create, judged on its own: the field of the new record, its revisions (the drawing's record entry copies its fileUrl), the read-back. */
  const fileCreate = async (u, label, body, keys) => {
    const s = SURFACE[u.surface];
    const F = ctx.file[u.key];
    const before = await recordCount(s.table);
    const res = await ask(pmA, `file ${u.key} create ${label}: PM POSTs a new ${s.label}`, 'POST', F.route, { ...s.body(`file ${label} ${STAMP}`), ...body });
    const id = res.status === 201 ? res.body?.data?.id || null : null;
    if (id) F.ids.push(id);
    const after = await recordCount(s.table);
    const field = id ? await rowNaming(s.table, id, keys) : false;
    const revs = id ? (await revRows(s, id)).filter((r) => namesAny(r, keys)) : [];
    const back = id ? await readBack(s, F.route, id, `file ${u.key} create ${label}: PM reads the new ${s.label} back`) : null;
    const apiNaming = back ? refsOf(back.rec).filter((r) => namesAny(r, keys)) : [];
    return { op: 'create', res, said: saidLong(res), id, before, after, field, revs, apiNaming, stored: field || revs.length > 0 || apiNaming.length > 0, recordLeft: after !== before, readBack: back ? said(back.res) : null };
  };
  /** Empties the standing record's field and proves it in the database; a failed clear is a setup error. */
  const fileReset = async (u) => {
    const s = SURFACE[u.surface];
    const F = ctx.file[u.key];
    const res = await ask(pmA, `file ${u.key}: PM clears the standing ${s.label}'s ${u.field}`, 'PATCH', `${F.route}/${F.standingId}`, u.clear);
    const left = await fieldText(s.table, F.standingId);
    if (res.status !== 200 || !isEmptyField(left)) throw new Error(`the standing ${s.label}'s ${u.field} could not be cleared before the next write (${saidLong(res)}; left ${left})`);
  };
  const fileUpdate = async (u, label, body, keys) => {
    const s = SURFACE[u.surface];
    const F = ctx.file[u.key];
    await fileReset(u);
    const revsBefore = (await revRows(s, F.standingId)).filter((r) => namesAny(r, keys)).length;
    const res = await ask(pmA, `file ${u.key} update ${label}: PM PATCHes the standing ${s.label}'s ${u.field}`, 'PATCH', `${F.route}/${F.standingId}`, body);
    const field = await rowNaming(s.table, F.standingId, keys);
    const revsAfter = (await revRows(s, F.standingId)).filter((r) => namesAny(r, keys)).length;
    const back = await readBack(s, F.route, F.standingId, `file ${u.key} update ${label}: PM reads the standing ${s.label} back`);
    const apiField = back.rec ? refsOf({ fileUrl: back.rec.fileUrl, documentsJson: back.rec.documentsJson }).filter((r) => namesAny(r, keys)) : [];
    return { op: 'update', res, said: saidLong(res), id: F.standingId, field, revsDelta: revsAfter - revsBefore, apiNaming: apiField, stored: field || revsAfter > revsBefore || apiField.length > 0, found: Boolean(back.rec), readBack: said(back.res) };
  };
  const fileNote = (o, body) => `PM ${o.op === 'create' ? 'POST' : 'PATCH'} ${json(body, 420)} -> ${o.said}; stored: ${o.stored ? `YES (field ${o.field ? 'names it' : 'clean'}${o.op === 'create' ? `; ${o.revs.length} revision(s) naming it` : `; ${o.revsDelta} new revision(s) naming it`}; ${o.apiNaming.length} read-back ref(s))` : 'no'}${o.op === 'create' ? `; record ${o.id || 'none'}; ${o.before} -> ${o.after} record(s) of the table in PA1` : `; read back ${o.readBack}${o.found ? '' : ' (record NOT found)'}`}`;

  for (const u of FILE_UNITS) {
    await h.section(`record file field: ${u.label}`, async () => {
      const F = ctx.file[u.key];
      const ownKeys = [F.own.id, F.own.storageKey].filter(Boolean);
      const oc = await fileCreate(u, 'own', u.own(F.own.id, ownUrl(F.own.id), fname('file', u.key, 'c-own')), ownKeys);
      const ou = await fileUpdate(u, 'own', u.own(F.own.id, ownUrl(F.own.id), fname('file', u.key, 'u-own')), ownKeys);
      obs.own[`file.${u.key}`] = { create: { answer: oc.said, id: oc.id, fieldNamesOwn: oc.field }, update: { answer: ou.said, fieldNamesOwn: ou.field } };
      check(`FILE.${u.key}.own`, oc.res.status === 201 && Boolean(oc.id) && oc.field && ou.res.status === 200 && ou.field,
        `create ${oc.said} record ${oc.id || 'none'}, field ${oc.field ? 'names the own file' : 'does NOT name it'}; update ${ou.said}, field ${ou.field ? 'names it' : 'does NOT name it'}`);

      const foreign = { create: {}, update: {} };
      for (const op of OPS) {
        for (const [v] of u.variants) {
          const id = `FILE.${u.key}.${op}.${v}`;
          const body = u.body(v, N_B, fname('file', u.key, `${op}-${v}`));
          const o = op === 'create' ? await fileCreate(u, v, body, B_KEYS) : await fileUpdate(u, v, body, B_KEYS);
          foreign[op][v] = o;
          obs.writes[id] = { sent: body, answer: o.said, stored: o.stored, fieldNames: o.field, record: o.id, ...(op === 'create' ? { recordLeft: o.recordLeft, revisionsNaming: o.revs.length } : { found: o.found, newRevisionsNaming: o.revsDelta }) };
          const ok = op === 'create' ? is4xx(o.res) && !o.id && !o.stored && !o.recordLeft : is4xx(o.res) && !o.stored && o.found;
          check(id, ok, `${fileNote(o, body)}; HEAD FAIL: stored as sent${o.stored ? ' -- the XDOC-1c record file field (cross-company reference stored, P1 class)' : ''}`);
        }
      }

      const pairs = [];
      for (const op of OPS) {
        for (const [v] of u.variants) {
          const r = randomName();
          const body = u.body(v, r, fname('file', u.key, `${op}-${v}-random`));
          const o = op === 'create' ? await fileCreate(u, `${v} (random)`, body, [r.id]) : await fileUpdate(u, `${v} (random)`, body, [r.id]);
          const f = foreign[op][v];
          const same = said(o.res) === said(f.res) && o.stored === f.stored && (op === 'create' ? Boolean(o.id) === Boolean(f.id) && o.recordLeft === f.recordLeft : o.found === f.found);
          pairs.push({ op, variant: v, random: { answer: said(o.res), stored: o.stored }, foreign: { answer: said(f.res), stored: f.stored }, same });
        }
      }
      obs.random[`file.${u.key}`] = pairs;
      const differ = pairs.filter((p) => !p.same);
      check(`C.FILE.${u.key}`, differ.length === 0,
        `${differ.length ? `ORACLE: ${differ.map((p) => `${p.op}.${p.variant} random ${p.random.answer}${p.random.stored ? ' stored' : ''} vs foreign ${p.foreign.answer}${p.foreign.stored ? ' stored' : ''}`).join('; ')}. ` : ''}${pairs.map((p) => `${p.op}.${p.variant} ${p.random.answer}${p.random.stored ? ' stored' : ''} = ${p.foreign.answer}${p.foreign.stored ? ' stored' : ''}`).join('; ')}`);

      const st = await fileUpdate(u, 'read stage', u.stage(N_B), B_KEYS);
      obs.readStage[`file.${u.key}`] = { answer: st.said, stored: st.stored };
    }, { onError: async () => { failedSections.add(`file.${u.key}`); } });
  }

  // ── (3) the uploader ─────────────────────────────────────────────────────────
  const who = (v, sent = null) => (v === null || v === undefined ? 'empty' : v === ctx.aPm ? 'A\'s PM (the writer)' : v === ctx.bUser.id ? 'B\'s PM' : v === sent ? 'the sent random id' : `another id ${v}`);
  const upbTagOf = (p, label, op) => `xdoc1c-upb-${p.key}-${label.replace(/\s+/g, '-')}-${op}-${STAMP}`;
  /** One write of a path, read back: a create or an update, judged on the entry it names. */
  const upbCreate = async (p, label, uploader) => {
    const U = ctx.upb[p.key];
    const tag = upbTagOf(p, label, 'c');
    const before = await recordCount(p.recordTable);
    const res = await ask(pmA, `upb ${p.key} create ${label}: PM POSTs a new record with the ${p.label}`, 'POST', U.route, { ...upbCreateBody(p, `upb ${label} ${STAMP}`), ...upbPayload(p, tag, uploader) });
    const id = res.status === 201 ? res.body?.data?.id || null : null;
    if (id) U.ids.push(id);
    const after = await recordCount(p.recordTable);
    const db = id ? await upbEntries(p, id, tag) : [];
    const anywhere = await upbAnywhere(p, tag);
    const back = id ? await upbReadBack(p, id, `upb ${p.key} create ${label}: PM reads the record back`) : null;
    const apiItems = back ? upbItems(p, back.rec, tag) : [];
    const vals = [...db.map((e) => uploaderId(e.uploadedBy)), ...apiItems.map((e) => uploaderId(e?.uploadedBy))];
    return { op: 'create', res, said: saidLong(res), id, tag, db, apiItems, vals, anywhere, recordLeft: after !== before, readBack: back ? said(back.res) : null };
  };
  const upbReset = async (p) => {
    const U = ctx.upb[p.key];
    const res = await ask(pmA, `upb ${p.key}: PM clears the standing record's ${p.kind === 'photo' ? 'photos' : 'references'}`, 'PATCH', `${U.route}/${U.standingId}`, p.kind === 'photo' ? { photos: [] } : { attachmentRefs: [] });
    const left = (await upbEntries(p, U.standingId)).length;
    if (res.status !== 200 || left) throw new Error(`the standing ${p.label}'s record could not be cleared before the next write (${saidLong(res)}; ${left} entr(ies) left)`);
  };
  const upbUpdate = async (p, label, uploader) => {
    const U = ctx.upb[p.key];
    await upbReset(p);
    const tag = upbTagOf(p, label, 'u');
    const res = await ask(pmA, `upb ${p.key} update ${label}: PM PATCHes the standing record's ${p.label}`, 'PATCH', `${U.route}/${U.standingId}`, upbPayload(p, tag, uploader));
    const db = await upbEntries(p, U.standingId, tag);
    const back = await upbReadBack(p, U.standingId, `upb ${p.key} update ${label}: PM reads the standing record back`);
    const apiItems = upbItems(p, back.rec, tag);
    const vals = [...db.map((e) => uploaderId(e.uploadedBy)), ...apiItems.map((e) => uploaderId(e?.uploadedBy))];
    return { op: 'update', res, said: saidLong(res), id: U.standingId, tag, db, apiItems, vals, found: Boolean(back.rec), readBack: said(back.res) };
  };
  const upbNote = (o, sent) => `PM ${o.op === 'create' ? 'POST' : 'PATCH'} uploadedBy ${sent === undefined ? '(none)' : who(sent, sent)} -> ${o.said}; ${o.db.length} stored entr(ies) [${o.db.map((e) => who(uploaderId(e.uploadedBy), sent)).join(', ')}]; read-back [${o.apiItems.map((e) => who(uploaderId(e?.uploadedBy), sent)).join(', ')}]${o.op === 'create' ? `; record ${o.id || 'none'}${o.recordLeft ? ' left' : ''}; entries with its name anywhere in PA1 ${o.anywhere}` : `; read back ${o.readBack}${o.found ? '' : ' (record NOT found)'}`}`;

  for (const p of UPB_PATHS) {
    await h.section(`uploader: ${p.label}`, async () => {
      const okOwn = (o, status) => o.res.status === status && Boolean(o.id) && o.db.length === 1 && o.vals.every((v) => v === ctx.aPm || v === null);
      const oc = await upbCreate(p, 'own', undefined);
      const ou = await upbUpdate(p, 'own', undefined);
      obs.own[`upb.${p.key}`] = { create: { answer: oc.said, id: oc.id, entries: oc.db.length, uploaders: oc.vals.map((v) => who(v)) }, update: { answer: ou.said, entries: ou.db.length, uploaders: ou.vals.map((v) => who(v)) } };
      check(`UPB.${p.key}.own`, okOwn(oc, 201) && okOwn(ou, 200), `create: ${upbNote(oc, undefined)}; update: ${upbNote(ou, undefined)}`);

      const B = ctx.bUser.id;
      const bc = await upbCreate(p, 'b', B);
      const bu = await upbUpdate(p, 'b', B);
      const writer = (o) => o.vals.length > 0 && o.vals.every((v) => v === ctx.aPm);
      // Integration owner, r3b IQ-2 (2026-10-10): six create services know no actor (their routes' user is dropped),
      // so the fixed create stores an empty uploader there. That stores no foreign user and is accepted on those creates;
      // another company's user never is.
      const ACTORLESS_CREATE = new Set(['correspondence', 'defect', 'drawing', 'itp', 'mtest', 'transmittal']);
      const writerOrEmpty = (o) => o.vals.length > 0 && o.vals.every((v) => v === ctx.aPm || (ACTORLESS_CREATE.has(p.key) && v === null));
      const fixedCreate = (o) => (o.res.status === 201 && Boolean(o.id) && o.db.length === 1 && writerOrEmpty(o)) || (is4xx(o.res) && !o.id && o.anywhere === 0 && !o.recordLeft);
      const fixedUpdate = (o) => (o.res.status === 200 && o.db.length === 1 && writer(o)) || (is4xx(o.res) && o.db.length === 0 && o.found);
      for (const [o, ok] of [[bc, fixedCreate(bc)], [bu, fixedUpdate(bu)]]) {
        const id = `UPB.${p.key}.${o.op}`;
        const keptB = o.vals.includes(B);
        obs.writes[id] = { sent: 'B\'s PM\'s user id', answer: o.said, entries: o.db.length, uploaders: o.vals.map((v) => who(v)), keptB, record: o.id, ...(o.op === 'create' ? { recordLeft: o.recordLeft } : { found: o.found }) };
        check(id, ok, `${upbNote(o, B)}; HEAD ${p.head === 'FAIL' ? 'FAIL: stored as sent' : 'PASS: re-read from the photo\'s document'}${keptB ? ' -- B\'s user stored as the uploader (XDOC-UPB, cross-company reference stored, P1 class)' : ''}${!keptB && !ok ? ' -- neither the writer nor a refusal' : ''}`);
      }

      // C.UPB.p: an uploader that exists nowhere is answered and kept exactly as B's user was.
      const r1 = crypto.randomUUID();
      const r2 = crypto.randomUUID();
      const rc = await upbCreate(p, 'random', r1);
      const ru = await upbUpdate(p, 'random', r2);
      const pairs = [[rc, bc, r1], [ru, bu, r2]].map(([r, b, sent]) => ({
        op: r.op,
        random: { answer: said(r.res), entries: r.db.length, keptSent: r.vals.includes(sent) },
        foreign: { answer: said(b.res), entries: b.db.length, keptSent: b.vals.includes(B) },
        same: said(r.res) === said(b.res) && r.db.length === b.db.length && r.vals.includes(sent) === b.vals.includes(B)
          && (r.op === 'create' ? Boolean(r.id) === Boolean(b.id) && r.recordLeft === b.recordLeft : r.found === b.found),
      }));
      obs.random[`upb.${p.key}`] = pairs;
      const differ = pairs.filter((x) => !x.same);
      check(`C.UPB.${p.key}`, differ.length === 0,
        `${differ.length ? 'ORACLE: ' : ''}${pairs.map((x) => `${x.op} random ${x.random.answer}, ${x.random.entries} entr(ies), sent value ${x.random.keptSent ? 'kept' : 'not kept'} ${x.same ? '=' : 'vs'} B's ${x.foreign.answer}, ${x.foreign.entries}, ${x.foreign.keptSent ? 'kept' : 'not kept'}`).join('; ')}`);

      const st = await upbUpdate(p, 'read stage', B);
      obs.readStage[`upb.${p.key}`] = { answer: st.said, uploaders: st.vals.map((v) => who(v)) };
    }, { onError: async () => { failedSections.add(`upb.${p.key}`); } });
  }

  // ── the reads: no door resolves B's document or B's person for A ──────────
  await h.section('reads', async () => {
    /** Each request refused (>= 400) with none of B's bytes or metadata; below 400 or a leak is OPEN (P0). */
    const refusedReads = async (id, requests) => {
      const seen = [];
      for (const [label, route, expect] of requests) {
        const res = await ask(pmA, `A: ${label}`, 'GET', route, undefined, { binary: true });
        seen.push({ label, said: said(res), expect, served: res.status < 400, leaked: leakIn(textOf(res)) });
      }
      obs.reads[id] = seen;
      const open = seen.filter((x) => x.served || x.leaked.length);
      check(id, open.length === 0,
        `${open.length ? `P0 OPEN (cross-tenant read of B's document): ${open.map((x) => `${x.label} ${x.said}${x.leaked.length ? ` leaked ${x.leaked.join('+')}` : ''}`).join('; ')}. ` : ''}${seen.map((x) => `${x.label} -> ${x.said} (expected ${x.expect})`).join('; ')}`);
    };
    await refusedReads('R.dl.ownRoute', [
      ['GET PA1 /workflow/uploads/D_B', `${PA}/workflow/uploads/${D_B}`, '404 FILE_NOT_FOUND'],
      ['GET PA1 /workflow/uploads/<D_B internal storageKey>', `${PA}/workflow/uploads/${docB.storageKey}`, '404 FILE_NOT_FOUND'],
    ]);
    await refusedReads('R.dl.foreignRoute', [['GET PB /workflow/uploads/D_B', `${PB}/workflow/uploads/${D_B}`, '404 (project access)']]);
    await refusedReads('R.dl.legacy', [['GET PA1 /workflow/uploads/D_B.pdf', `${PA}/workflow/uploads/${D_B}.pdf`, '404 FILE_NOT_FOUND']]);
    await refusedReads('R.att', [
      ['GET PA1 /attachments/documents/D_B', `${PA}/attachments/documents/${D_B}`, '404 FILE_NOT_FOUND'],
      ['GET PB /attachments/documents/D_B', `${PB}/attachments/documents/${D_B}`, '404 (project access)'],
    ]);
    await refusedReads('R.site', [
      ['GET PA1 /site-reporting/uploads/D_B', `${PA}/site-reporting/uploads/${D_B}`, '404 FILE_NOT_FOUND'],
      ['GET PB /site-reporting/uploads/D_B', `${PB}/site-reporting/uploads/${D_B}`, '404 (project access)'],
    ]);
    await refusedReads('R.text', [
      ['GET PA1 /documents/D_B/text', `${PA}/documents/${D_B}/text`, '404 DOCUMENT_NOT_FOUND'],
      ['GET PB /documents/D_B/text', `${PB}/documents/${D_B}/text`, '404 (project access)'],
    ]);

    /** A search answer names nothing of B's: its hits (or, refused, its whole answer) carry neither D_B nor B's metadata. */
    const noHits = async (id, requests) => {
      const seen = [];
      for (const [label, route] of requests) {
        const res = await ask(pmA, `A: ${label}`, 'GET', route);
        // The answer echoes the query (the canary) beside its hits: only the hits are judged.
        const hits = res.status === 200 ? json(rowsOf(res.body?.data), 1e9) : textOf(res);
        const leaked = [...leakIn(hits), ...(hits.includes(D_B) ? ['D_B'] : [])];
        seen.push({ label, said: said(res), hits: res.status === 200 ? rowsOf(res.body?.data).length : null, leaked });
      }
      obs.reads[id] = seen;
      const open = seen.filter((x) => x.leaked.length || (x.said.startsWith('2') && x.hits === null));
      check(id, open.length === 0,
        `${open.length ? `P0 OPEN (B's document found by A): ${open.map((x) => `${x.label} ${x.said} ${x.leaked.join('+')}`).join('; ')}. ` : ''}${seen.map((x) => `${x.label} -> ${x.said}${x.hits !== null ? `, ${x.hits} hit(s)` : ''}`).join('; ')}`);
    };
    const Q = encodeURIComponent(CANARY);
    await noHits('R.search.project', [
      ['PA1 document search for the canary', `${PA}/documents/search?q=${Q}`],
      ['PB document search for the canary', `${PB}/documents/search?q=${Q}`],
    ]);
    await noHits('R.search.global', [
      ['global search (documents) for the canary', `/search?q=${Q}&types=document&limit=50`],
      ['global search (all types) for the canary', `/search?q=${Q}&limit=50`],
      ['global search (documents, projectId PB) for the canary', `/search?q=${Q}&types=document&projectId=${ctx.projectB}&limit=50`],
    ]);

    // R.rev.download: every revision of PA1 naming D_B is refused by both file routes; A's own revision is served.
    const named = await q('select id, "recordType", "recordId", revision, "storageKey", "fileUrl", "projectDocumentId" from "DocumentRevision" where "projectId" = $1 and (coalesce("storageKey", \'\') like any($2::text[]) or coalesce("fileUrl", \'\') like any($2::text[]) or coalesce("projectDocumentId", \'\') like any($2::text[])) order by "createdAt" limit 80', [ctx.projectA, B_KEYS.map((k) => `%${k}%`)]);
    const downloads = [];
    for (const row of named) {
      for (const kind of ['download', 'preview']) {
        const res = await ask(pmA, `A: GET revision ${row.recordType} ${row.revision} /${kind}`, 'GET', `${PA}/doc-control/revisions/${row.id}/${kind}`, undefined, { binary: true });
        downloads.push({ revision: `${row.recordType}:${row.revision}`, kind, said: said(res), served: res.status < 400, leaked: leakIn(textOf(res)) });
      }
    }
    const ownRev = ctx.rev.rfi?.ownRevisionCode
      ? (await q('select id from "DocumentRevision" where "projectId" = $1 and "recordType" = $2 and "recordId" = $3 and revision = $4', [ctx.projectA, 'rfi', ctx.rev.rfi.standingId, ctx.rev.rfi.ownRevisionCode]))[0] || null
      : null;
    const ownRes = ownRev ? await ask(pmA, 'A: GET its own RFI revision /download (positive control)', 'GET', `${PA}/doc-control/revisions/${ownRev.id}/download`, undefined, { binary: true }) : null;
    const controlOk = ownRes?.status === 200 && textOf(ownRes).includes(OWN_MARK);
    const openDl = downloads.filter((x) => x.served || x.leaked.length);
    const byAnswer = downloads.reduce((acc, x) => ({ ...acc, [x.said]: (acc[x.said] || 0) + 1 }), {});
    obs.reads['R.rev.download'] = { revisionsNamingDB: named.length, requests: downloads.length, byAnswer, open: openDl.length, openList: openDl.slice(0, 10), control: { revision: ownRev?.id || null, said: ownRes ? said(ownRes) : 'not run', ok: controlOk } };
    check('R.rev.download', openDl.length === 0 && controlOk,
      `${openDl.length ? `P0 OPEN (a revision serves B's document): ${json(openDl.slice(0, 6), 700)}. ` : ''}${controlOk ? '' : `READ CONTROL FAILED: A's own revision was not served (${ownRes ? said(ownRes) : 'no own revision found'}), so the refusals prove nothing. `}${named.length} revision(s) of PA1 name D_B, ${downloads.length} request(s): ${json(byAnswer)}; own revision ${ownRes ? said(ownRes) : 'not run'}`);

    // R.detail.p: every standing record of the path as listed (and by its single GET where the module has one).
    const standingOf = (key) => [ctx.rev[key]?.standingId, ctx.file[key]?.standingId, ctx.upb[key]?.standingId].filter(Boolean);
    for (const d of DETAIL_PATHS) {
      const s = SURFACE[d.key];
      const route = `${PA}/${s ? s.base : UPB_PATHS.find((p) => p.key === d.key).base}`;
      const list = await ask(pmA, `A: PM lists the ${d.label}s for the detail check`, 'GET', `${route}${s?.listQuery || ''}`);
      const records = list.status === 200 ? rowsOf(list.body?.data) : [];
      const ids = standingOf(d.key);
      const singles = [];
      if (d.single) for (const id of ids) singles.push(await ask(pmA, `A: PM reads a standing ${d.label}`, 'GET', `${route}/${id}`));
      const answers = [list, ...singles];
      const recs = [...records, ...singles.filter((r) => r.status === 200 && r.body?.data).map((r) => r.body.data)];
      const leaked = [...new Set(answers.flatMap((res) => leakIn(res.status === 200 ? json(res.body?.data, 1e9) : '')))];
      const person = answers.some((res) => res.status === 200 && personOfB(res.body?.data));
      const refs = recs.flatMap(refsOf);
      const foreignRefs = refs.filter(namesB);
      const withMeta = foreignRefs.filter(metaOfB);
      const echoes = refs.filter((r) => uploaderId(r?.uploadedBy) === ctx.bUser.id).length;
      const standingFound = ids.every((id) => records.some((r) => r?.id === id)) && singles.every((r, i) => r.status === 200 && r.body?.data?.id === ids[i]);
      obs.reads[`R.detail.${d.key}`] = { list: said(list), singles: singles.map(said), records: records.length, standing: ids.length, standingFound, foreignRefs: foreignRefs.length, withMeta: withMeta.length, leaked, personOfB: person, uploaderEchoes: echoes, sample: foreignRefs.slice(0, 3).map((r) => ({ fileName: r.fileName ?? null, storageKey: r.storageKey ?? null, fileUrl: r.fileUrl ?? null, documentId: r.documentId ?? null, projectDocument: r.projectDocument ?? null, sizeBytes: r.sizeBytes ?? null, sha256: r.sha256 ?? null })) };
      check(`R.detail.${d.key}`, list.status === 200 && standingFound && leaked.length === 0 && withMeta.length === 0 && !person,
        `${withMeta.length || leaked.length || person ? `P0 OPEN (B's document metadata or B's person on A's ${d.label}): ${json(withMeta, 500)} leaked ${leaked.join('+') || 'none'}${person ? '; B\'s user resolved into a person' : ''}. ` : ''}list ${said(list)} (${records.length} record(s))${singles.length ? `, single ${singles.map(said).join('/')}` : ''}, ${ids.length} standing record(s) ${standingFound ? 'found' : 'NOT all found'}; refs naming D_B ${foreignRefs.length} (echo only: ${json(obs.reads[`R.detail.${d.key}`].sample, 600)}); uploader echoes of B's raw id ${echoes} (A's own input, not judged)`);
    }

    // R.audit: every standing record's history carries its references as rows, never D_B's metadata or B's person.
    const audit = {};
    const standingRecords = [
      ...REV_SURFACES.map((s) => [`rev.${s.key}`, s.recordType, ctx.rev[s.key].standingId]),
      ...FILE_UNITS.map((u) => [`file.${u.key}`, SURFACE[u.surface].recordType, ctx.file[u.key].standingId]),
      ...UPB_PATHS.map((p) => [`upb.${p.key}`, p.recordType, ctx.upb[p.key].standingId]),
    ];
    for (const [key, entityType, entityId] of standingRecords) {
      const res = await ask(pmA, `A: PM reads the ${key} audit history`, 'GET', `${PA}/audit?entityType=${entityType}&entityId=${entityId}&limit=100`);
      const events = rowsOf(res.body?.data);
      const attachments = events.flatMap((event) => listOf(event?.attachments));
      audit[key] = { said: said(res), events: events.length, attachmentsNamingDB: attachments.filter(namesB).length, withMeta: attachments.filter(metaOfB).length, leaked: leakIn(json(events, 1e9)), personOfB: personOfB(events) };
    }
    obs.reads['R.audit'] = audit;
    const auditBad = Object.entries(audit).filter(([, a]) => a.said !== '200' || a.events === 0 || a.withMeta || a.leaked.length || a.personOfB);
    check('R.audit', auditBad.length === 0,
      `${auditBad.some(([, a]) => a.withMeta || a.leaked.length || a.personOfB) ? 'P0 OPEN (B\'s document metadata or person in A\'s audit history). ' : ''}${Object.entries(audit).map(([k, a]) => `${k} ${a.said} ${a.events} event(s), ${a.attachmentsNamingDB} attachment(s) naming D_B (echo), meta ${a.withMeta}, leaked ${a.leaked.join('+') || 'none'}${a.personOfB ? ', B person' : ''}`).join('; ')}`);

    // R.register: the document register echoes the references and revisions, never D_B's metadata.
    const register = await ask(pmA, 'A: PM reads the document register', 'GET', `${PA}/doc-control/register`);
    const regRows = register.status === 200 ? rowsOf(register.body?.data) : [];
    const regRefs = regRows.flatMap((row) => [...listOf(row?.attachments), ...listOf(row?.revisions), ...(row?.latestRevision ? [row.latestRevision] : [])]);
    const regLeaked = leakIn(register.status === 200 ? json(register.body?.data, 1e9) : '');
    const regMeta = regRefs.filter(metaOfB);
    const regPerson = register.status === 200 && personOfB(register.body?.data);
    obs.reads['R.register'] = { said: said(register), rows: regRows.length, refsNamingDB: regRefs.filter(namesB).length, withMeta: regMeta.length, leaked: regLeaked, personOfB: regPerson };
    check('R.register', register.status === 200 && regRows.length > 0 && regMeta.length === 0 && regLeaked.length === 0 && !regPerson,
      `${regMeta.length || regLeaked.length || regPerson ? `P0 OPEN (B's document metadata or person in A's register): ${json(regMeta, 600)} leaked ${regLeaked.join('+') || 'none'}. ` : ''}register ${said(register)}, ${regRows.length} row(s), ${obs.reads['R.register'].refsNamingDB} ref(s) naming D_B (echo)`);

    // R.export: the RFI PDFs and the punch CSV carry none of B's bytes or B's person.
    const exports = [
      ['RFI PDF of the revisions-door RFI', `${ctx.rev.rfi.route}/${ctx.rev.rfi.standingId}/export.pdf`],
      ['RFI PDF of the uploader RFI', `${ctx.upb.rfi.route}/${ctx.upb.rfi.standingId}/export.pdf`],
      ['punch list CSV (all kinds)', `${ctx.upb.punch.route}/export.csv?kind=all`],
    ];
    const exported = [];
    for (const [label, route] of exports) {
      const res = await ask(pmA, `A: ${label}`, 'GET', route, undefined, { binary: true });
      exported.push({ label, said: said(res), bytes: res.buffer ? res.buffer.length : null, leaked: leakIn(textOf(res)) });
    }
    obs.reads['R.export'] = exported;
    check('R.export', exported.every((x) => x.said === '200' && x.leaked.length === 0),
      `${exported.some((x) => x.leaked.length) ? 'P0 OPEN (B\'s bytes or person in A\'s export). ' : ''}${exported.map((x) => `${x.label} -> ${x.said}${x.bytes !== null ? ` (${x.bytes} bytes)` : ''}, leaked ${x.leaked.join('+') || 'none'}`).join('; ')}`);

    // ── B's document and B's person are as B left them ─────────────────────────
    const docAfter = await docRow(D_B);
    const readAfter = await ask(pmB, 'B: PM reads D_B through /attachments/documents', 'GET', `${PB}/attachments/documents/${D_B}`, undefined, { binary: true });
    const FIELDS = ['orgId', 'projectId', 'status', 'linkedEntityType', 'linkedEntityId'];
    const changed = FIELDS.filter((k) => (docAfter?.[k] ?? null) !== (docB[k] ?? null));
    obs.docBAfter = docAfter && Object.fromEntries(FIELDS.map((k) => [k, docAfter[k]]));
    check('R.B.unchanged',
      Boolean(docAfter) && changed.length === 0 && docAfter.status === 'available' && !docAfter.linkedEntityType && !docAfter.linkedEntityId
        && readAfter.status === 200 && textOf(readAfter).includes(CANARY),
      `D_B after: ${json(obs.docBAfter)}${changed.length ? ` CHANGED ${changed.join(', ')} (before ${json(Object.fromEntries(changed.map((k) => [k, docB[k]])))}; a pointer written across companies)` : ' (unchanged)'}; B reads it ${said(readAfter)} canary ${textOf(readAfter).includes(CANARY)}`);

    const userAfter = (await q('select id, name, email, "orgId" from "User" where id = $1', [ctx.bUser.id]))[0] || null;
    const membershipsAfter = await q('select "orgId", role, status from "OrganizationMembership" where "userId" = $1 order by "orgId", role, status', [ctx.bUser.id]);
    const userSame = Boolean(userAfter) && userAfter.email === ctx.bUser.email && userAfter.name === ctx.bUser.name && userAfter.orgId === ctx.bUser.orgId;
    const membershipsSame = json(membershipsAfter, 1e6) === json(ctx.bUser.memberships, 1e6);
    const inA = membershipsAfter.some((m) => m.orgId === orgA.id);
    obs.bUserAfter = { userSame, membershipsSame, inA, memberships: membershipsAfter };
    check('R.B.user', userSame && membershipsSame && !inA,
      `B's PM: user row ${userSame ? 'unchanged' : 'CHANGED'}; memberships ${membershipsSame ? 'unchanged' : `CHANGED ${json(membershipsAfter)} (before ${json(ctx.bUser.memberships)})`}; ${inA ? 'NOW A MEMBER OF A' : 'none in A'}`);
  });
};

// ── shared readers used by main and setup (defined after main for readability, hoisted as functions) ──
/** A record file field as text (null when unset): the drawing's fileUrl, the transmittal's documentsJson. */
async function fieldText(table, id) {
  if (table === 'DrawingRecord') return ((await ctx.q('select "fileUrl" as v from "DrawingRecord" where id = $1', [id]))[0] || {}).v ?? null;
  if (table === 'Transmittal') return ((await ctx.q('select "documentsJson"::text as v from "Transmittal" where id = $1', [id]))[0] || {}).v ?? null;
  return null;
}
/** An empty field: unset, JSON null or an empty list. */
function isEmptyField(v) {
  return v === null || v === undefined || v === '' || v === 'null' || v === '[]';
}
/** The smallest valid create body of a path's record (a daily report needs its activity and a date, routes/daily-reports.js:74-80). */
function upbCreateBody(p, tag) {
  if (p.kind === 'workflow') return SURFACE[p.surface].body(tag);
  if (p.kind === 'commercial') return { description: `XDOC-1c repro change order ${tag}` };
  if (p.key === 'dr') return { activityId: ctx.activityId, date: REPORT_DATE, status: 'draft', notes: `XDOC-1c repro daily report ${tag}` };
  return { date: REPORT_DATE, status: 'draft', notes: `XDOC-1c repro site diary ${tag}` };
}
/**
 * The one entry a write sends. A reference names no file ({fileName, description}), so no document rule is involved; a
 * photo names A's own site photo by key, the shape of the upload answer (file-storage.service.js:696-717). uploader
 * undefined sends no uploadedBy.
 */
function upbPayload(p, tag, uploader) {
  const sent = uploader === undefined ? {} : { uploadedBy: uploader };
  if (p.kind === 'photo') {
    const photo = ctx.photos[p.key];
    return { photos: [{ key: photo.id, filename: photo.fileName || photo.originalName, caption: tag, ...sent }] };
  }
  return { attachmentRefs: [{ fileName: `${tag}.pdf`, description: `XDOC-1c uploader reproduction ${STAMP}`, ...sent }] };
}
/** The stored entries of a record (all, or the one with this name): references in their table, photos in photosJson. */
async function upbEntries(p, id, tag = null) {
  if (p.kind === 'photo') {
    const row = (await ctx.q(`select "photosJson" as photos from "${p.recordTable}" where id = $1`, [id]))[0];
    const photos = Array.isArray(row?.photos) ? row.photos : [];
    return photos.filter((ph) => tag === null || ph?.caption === tag).map((ph) => ({ uploadedBy: ph?.uploadedBy ?? null }));
  }
  const rows = await ctx.q(`select "fileName", "uploadedBy" from "${p.refTable}" where "projectId" = $1 and "recordType" = $2 and "recordId" = $3`, [ctx.projectA, p.recordType, id]);
  return rows.filter((r) => tag === null || r.fileName === `${tag}.pdf`).map((r) => ({ uploadedBy: r.uploadedBy ?? null }));
}
/** Entries carrying this write's name anywhere in PA1 (a refused create must leave none). */
async function upbAnywhere(p, tag) {
  if (p.kind === 'photo') return Number((await ctx.q(`select count(*)::int as n from "${p.recordTable}" where "projectId" = $1 and coalesce("photosJson"::text, '') like $2`, [ctx.projectA, `%${tag}%`]))[0].n);
  return Number((await ctx.q(`select count(*)::int as n from "${p.refTable}" where "projectId" = $1 and "fileName" = $2`, [ctx.projectA, `${tag}.pdf`]))[0].n);
}
/** The record as the PM reads it: the single GET (RFI, submittal, punch, daily report, site diary) or the list. */
async function upbReadBack(p, id, label) {
  const U = ctx.upb[p.key];
  const single = p.kind === 'photo' || (p.kind === 'workflow' && SURFACE[p.surface].single);
  const listQuery = p.kind === 'workflow' ? SURFACE[p.surface].listQuery || '' : '';
  const res = h.keep(label, await ctx.pmA.send('GET', single ? `${U.route}/${id}` : `${U.route}${listQuery}`));
  let rec = null;
  if (res.status === 200) {
    const data = res.body?.data;
    rec = single ? (data?.id === id ? data : null) : (Array.isArray(data) ? data : ['rows', 'items', 'orders'].map((k) => data?.[k]).find(Array.isArray) || []).find((r) => r?.id === id) || null;
  }
  return { res, rec };
}
/** The read-back entries carrying this write's name. */
function upbItems(p, rec, tag) {
  if (!rec) return [];
  if (p.kind === 'photo') return (Array.isArray(rec.photos) ? rec.photos : []).filter((ph) => ph?.caption === tag);
  return unique([...listOf(rec.attachmentRefs), ...listOf(rec.attachments)]).filter((r) => r?.fileName === `${tag}.pdf`);
}

/** The per-unit and per-suspect classification (observation; the harness classifies the 76 defect checks as a whole beside it). */
const classifyUnits = () => {
  const setupOk = ['S.B', 'S.A', 'S.U'].every((id) => verdict.get(id) === true) && !mainError;
  const perUnit = {};
  for (const u of UNITS) {
    const missing = u.defects.filter((id) => !verdict.has(id));
    const why = [];
    if (!setupOk) why.push('setup error');
    if (failedSections.has(u.unit)) why.push('its section threw');
    if (missing.length) why.push(`not run: ${missing.join(', ')}`);
    if (verdict.get(u.own) !== true) why.push(`its own control ${u.own} did not hold`);
    const reproduced = u.defects.filter((id) => verdict.get(id) === false);
    const classification = why.length ? 'UNDETERMINED' : reproduced.length === 0 ? 'REJECTED' : reproduced.length === u.defects.length ? 'CONFIRMED' : 'PARTIAL';
    perUnit[u.unit] = {
      suspect: u.suspect,
      classification,
      expectedAtHead: u.head,
      why,
      reproduced,
      notReproduced: u.defects.filter((id) => verdict.get(id) === true),
      randomControlHeld: verdict.has(u.random) ? verdict.get(u.random) : null,
      callSites: u.sites,
    };
  }
  const overallOf = (suspect) => {
    const values = Object.values(perUnit).filter((x) => x.suspect === suspect).map((x) => x.classification);
    const determined = values.filter((v) => v !== 'UNDETERMINED');
    const overall = !determined.length ? 'UNDETERMINED'
      : values.every((v) => v === 'CONFIRMED') ? 'CONFIRMED'
        : values.every((v) => v === 'REJECTED') ? 'REJECTED' : 'PARTIAL';
    const by = (c) => Object.entries(perUnit).filter(([, x]) => x.suspect === suspect && x.classification === c).map(([k]) => k);
    return { overall, confirmedOn: by('CONFIRMED'), partialOn: by('PARTIAL'), rejectedOn: by('REJECTED'), undeterminedOn: by('UNDETERMINED') };
  };
  const failedIds = [...verdict].filter(([, ok]) => !ok).map(([id]) => id);
  const downloadControlOnly = failedIds.includes('R.rev.download') && obs.reads['R.rev.download'] && obs.reads['R.rev.download'].open === 0;
  return {
    rule: CLASSIFICATION_RULE,
    bySuspect: { [DEFECT_REV]: overallOf(DEFECT_REV), [DEFECT_UPB]: overallOf(DEFECT_UPB) },
    perUnit,
    bareIdKeyStored: failedIds.filter((id) => /^REV\..+\.storageKey$/.test(id)),
    oracles: failedIds.filter((id) => id.startsWith('C.')),
    openReadsP0: failedIds.filter((id) => id.startsWith('R.') && !id.startsWith('R.B.') && !(id === 'R.rev.download' && downloadControlOnly)),
    readControlsFailed: downloadControlOnly ? ['R.rev.download'] : [],
    foreignStateChanged: failedIds.filter((id) => id.startsWith('R.B.')),
    headExpectation: {
      fail: HEAD_FAILS.length,
      defectChecksHolding: HEAD_DEFECT_PASSES,
      matchedBeforeG5xx: !mainError && verdict.size === PLAN.length && failedIds.length === HEAD_FAILS.length && HEAD_FAILS.every((id) => verdict.get(id) === false),
      unexpectedFailures: failedIds.filter((id) => !HEAD_FAILS.includes(id)),
      unexpectedPasses: HEAD_FAILS.filter((id) => verdict.get(id) === true),
    },
    note: 'EXPECTED BEHAVIOUR and TEST GAP are set at adjudication, never here.',
  };
};

const cleanup = async () => {
  const notes = [];
  const { pmA, pmB, q } = ctx;
  if (pmA && ctx.projectA) {
    // What the product lets A's PM clear on every record the run made on PA1 (a revision cannot be removed).
    const cleared = {};
    const clear = async (kind, route, ids, body) => {
      for (const id of ids || []) {
        try {
          const res = await ask(pmA, `cleanup: ${kind} ${id} cleared`, 'PATCH', `${route}/${id}`, body);
          const k = `${kind} ${said(res)}`;
          cleared[k] = (cleared[k] || 0) + 1;
        } catch (error) {
          const k = `${kind} not cleared: ${error.message}`;
          cleared[k] = (cleared[k] || 0) + 1;
        }
      }
    };
    if (ctx.rev.drawing) await clear('rev drawing fileUrl', ctx.rev.drawing.route, ctx.rev.drawing.ids, { fileUrl: null });
    for (const u of FILE_UNITS) if (ctx.file[u.key]) await clear(`file ${u.key} ${u.field}`, ctx.file[u.key].route, ctx.file[u.key].ids, u.clear);
    for (const p of UPB_PATHS) if (ctx.upb[p.key]) await clear(`upb ${p.key}`, ctx.upb[p.key].route, ctx.upb[p.key].ids, p.kind === 'photo' ? { photos: [] } : { attachmentRefs: [] });
    notes.push(`PA1 cleared: ${json(cleared, 1500)}`);
    // What of PA1 still names D_B or B's user: the census residue (cross-links.js reads every row's JSON).
    const residue = {};
    if (q) {
      const needles = [['D_B', ctx.D_B], ['bUser', ctx.bUser?.id]].filter(([, v]) => v);
      const tables = ['WorkflowAttachment', 'DocumentRevision', 'CommercialAttachmentRef', 'AuditEvent', 'RecordHistorySnapshot', 'ApprovalWorkflowEvent', 'WorkflowStatusHistory', 'PunchItemEvent', 'OutboundEvent', 'Notification', 'BackgroundJob', 'ChangeOrder', 'DailyReport', 'SiteDiary', ...SURFACES.map((s) => s.table)];
      for (const [label, needle] of needles) {
        for (const table of tables) {
          try {
            const n = (await q(`select count(*)::int as n from "${table}" t where t."projectId" = $1 and to_jsonb(t)::text like $2`, [ctx.projectA, `%${needle}%`]))[0].n;
            if (n) residue[`${label} ${table}`] = n;
          } catch (error) {
            residue[`${label} ${table}`] = `not read: ${error.message}`;
          }
        }
      }
    }
    obs.residue = residue;
    notes.push(`rows of PA1 still naming D_B or B's user ${json(residue)} (a stored revision cannot be removed through the product: known residue of this throwaway project)`);
  }
  const archive = async (whoIs, label, projectId) => {
    try {
      const res = await ask(whoIs, `cleanup: ${label} archived`, 'DELETE', `/projects/${projectId}`);
      const row = q ? (await q('select "archivedAt"::text as a from "Project" where id = $1', [projectId]))[0] : null;
      return `${label} ${projectId} archive ${said(res)}, archivedAt ${row?.a || 'NOT SET'}`;
    } catch (error) {
      return `${label} ${projectId} not archived: ${error.message}`;
    }
  };
  if (pmA && ctx.projectA) notes.push(await archive(pmA, 'PA1 (A\'s PM)', ctx.projectA));
  if (pmB && ctx.projectB) notes.push(await archive(pmB, 'PB (B\'s PM)', ctx.projectB));
  h.observe('xdoc1c', obs);
  h.observe('classification', classifyUnits());
  return notes;
};

h.run({
  main: async () => {
    try {
      await main();
    } catch (error) {
      mainError = error;
      throw error;
    }
  },
  cleanup,
});
