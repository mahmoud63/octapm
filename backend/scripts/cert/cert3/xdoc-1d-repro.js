'use strict';

/**
 * XDOC-ISS and XDOC-CP confirm-first reproduction (the round-3 leads).
 *   XDOC-ISS  a revision's issuedBy stores ANOTHER company's user id — filed
 *             through each document record's own create and update (the
 *             revisions door: workflow-support.service.js:463, :493, :807) and
 *             through document control (doc-control.service.js:805, route :195);
 *   XDOC-CP   ContractProfile.documentIds stores ANOTHER company's document ids —
 *             PUT the contract profile (contract.service.js:149, :157, :235-287;
 *             routes/contract.js:39, :47).
 * And no read path of company A resolves either into company B's person (name,
 * e-mail) or into company B's document (bytes, text, file name, metadata).
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/xdoc-1d-repro.js
 *
 * No flags. In process (CERT_INPROCESS=1, through the lock runner only) on the
 * certification database, under the CERT-3 harness (./lib/harness: fixed plan,
 * G.5xx sweep, exit 0/2/1, result file, provisional classification).
 *
 * SOURCES. The round-3 leads: docs/certification/OCTAPM_LAUNCH_BLOCKERS.md:300
 * (XDOC-ISS) and :301 (XDOC-CP). The round-3 adjudication:
 * C:\Temp\octapm-cert\scratch\wp2\codex-plan-review-r3-adjudication.md:31
 * (XDOC-ISS, "Revision issuedBy takes a request value, defaulting to the
 * caller's id, and stores it unchecked ... Smallest closure if confirmed:
 * same-org validation of WHOLE-UUID issuer values; non-UUID labels such as
 * 'UAT Consultant' are preserved") and :32 (XDOC-CP, "PUT contract profile
 * accepts documentIds without scope validation and stores them. With one
 * readable own document it persists the combined list. Reads look closed"),
 * and :41-43 ("Both are reproduced live (xdoc-1d-repro.js, drafted read-only)
 * BEFORE the batch is implemented. If confirmed, both join the HR-X1 batch").
 * CERT-2's scale, OCTAPM_LAUNCH_BLOCKERS.md:146-149: a stored reference to
 * another company's record (here a user id or a document id) is a cross-company
 * write (P1); an answer carrying another company's identifiers or records is a
 * cross-company read. The model: xdoc-1c-repro.js (its harness, the 087/088
 * pair, B's user picked by rule, own / label / random controls, the reads that
 * prove nothing of B is exposed, the cleanup and residue census, the exit codes
 * and the result file). XDOC-ISS and XDOC-CP are "seen in passing" in the
 * xdoc-1c header (SEEN IN PASSING: revisions[].issuedBy and the record entry's
 * issuedBy come from the payload first; ContractProfile.documentIds is stored
 * as sent): this repro traces and reproduces them.
 *
 * THE CODE AT HEAD (product f599e67), every path traced.
 *
 *  (1) issuedBy on a revision. normalizeRevisionRefs
 *      (workflow-support.service.js:436-531) sets issuedBy from the payload
 *      first on every entry it builds: an explicit revisions[] entry (:463
 *      issuedBy = trimOrNull(entry.issuedBy) || userId || null) and the record
 *      entry it adds from a top-level revision (:493, same). recordDocumentRevisions
 *      (:760-818) clamps status/isLatest/approvedBy/supersededBy (:778-785) but
 *      NEVER issuedBy, and stores every added entry as sent (createMany :807-815).
 *      issuedBy is not a document key, so assertDocumentsLinkable (:799-805) never
 *      looks at it, and an entry that names no file is stored all the same (the
 *      filter keeps any entry with a revision code, :471). Each document record's
 *      own create and update files through this door: rfi.service.js:431 / :659,
 *      submittal.service.js:466 / :702, drawing.service.js:99 / :207,
 *      transmittal.service.js:99 / :202, correspondence.service.js:109 / :231. The
 *      routes accept revisions (an array) and a top-level revision/issuedBy
 *      unvalidated beyond the array shape (rfi.js:161; the inner fields are not
 *      judged). Document control's own upload route takes issuedBy too: POST
 *      /doc-control/:recordType/:recordId/revisions (routes/doc-control.js:195
 *      body("issuedBy").isString().max 120) stores it at doc-control.service.js:805
 *      (issuedBy = trimOrNull(payload.issuedBy) || userId || null). A revision whose
 *      code the record already has is skipped (skipDuplicates; @@unique
 *      schema.prisma:4603), and no product route deletes a revision, so every stored
 *      one stays (residue). issuedBy is NOT a USER_REF_FIELD
 *      (workflow-support.service.js:34-40), so loadReferencedUsers (:876-888) never
 *      resolves it; every serialiser emits it raw (serializeRevision
 *      workflow-support.service.js:827-838 spreads it; doc-control.service.js:194
 *      issuedBy = revision.issuedBy || null). So at HEAD a whole-UUID issuedBy
 *      naming company B's user is stored and echoed as a raw id, never resolved
 *      into a person.
 *  (2) ContractProfile.documentIds. updateProfile (contract.service.js:133-160)
 *      stores documentIds = the de-duplicated payload list capped at 20 (:149),
 *      with no scope check; confirm keeps the same list (:153-157). extractClauses
 *      (:233-295) merges payload + existing documentIds (:235-236) and stores them
 *      (:289-290). The route validates each id is a UUID (routes/contract.js:39-40)
 *      and nothing more. getProfile serialises documentIds raw (serializeProfile
 *      :106, :107 -> row.documentIds). A read that resolves an id — extractClauses
 *      (:233) -> getDocumentText (document-text.service.js:1080-1097, findFirst
 *      where { id, orgId, projectId }) — is scoped to the caller's org and project,
 *      so company B's document is DOCUMENT_NOT_FOUND there and comes back as
 *      "unavailable", by its id only. So at HEAD company B's document id is stored
 *      and echoed as a raw id, and no read resolves it into B's bytes, text, file
 *      name or metadata.
 *
 * WHERE. Company A = 087, company B = 088 (the XDOC-1 pair): fixed codes, each
 * required in the population and resolved to EXACTLY ONE organisation by its
 * certification slug (cert-<code>-%), proven by the guard
 * (assertCertOrganisation); A and B distinct; never a first row. B's USER is
 * chosen by rule: B's PM persona (pm@<B's domain>, scripts/cert/lib/spec.js:236),
 * resolved in process — exactly one User row with that e-mail, the id /auth/me
 * answers for B's own session (routes/auth.js), an active membership in B and
 * none in A; A's PM (the writer) the same way in A. Every write is A's PM (087)
 * through a product route; SQL only reads. Throwaway: B's PM creates PB ("CERT3
 * XDOC1d repro B <stamp>") with a canary file D_B; A's PM creates PA1 ("CERT3
 * XDOC1d repro A <stamp>"), two own files and the standing records; nothing else
 * is touched.
 *
 * THE WRITES (each judged on its own, in the database and through A's PM's read-back).
 *
 *  ISS, the revisions door (surface s = RFI, submittal, drawing, transmittal,
 *  correspondence), door d = entry (an explicit revisions[] entry carrying
 *  issuedBy, :463) or record (a top-level revision + issuedBy, :493), on create
 *  (POST a new record) and update (PATCH the standing record), each with a fresh
 *  code (a code is filed once):
 *    ISS.s.own        control: A's PM's own user id as issuedBy, entry door, create
 *                     and update: accepted and stored (an own-organisation user)  HEAD PASS
 *    ISS.s.{create,update}.{entry,record}  DEFECT issuedBy = B's PM's user id.
 *                     Fixed expectation (ISS-W): the stored issuedBy (database and
 *                     read-back) is NOT B's user — a user of A, the writer, or empty,
 *                     or the request is refused 4xx with nothing stored (on a create
 *                     no record left; on an update the record still there).
 *                     HEAD: stored as sent -> B's user id is the revision's issuedBy  HEAD FAIL
 *    C.ISS.s          control (no oracle): the four B writes repeated with a random
 *                     uuid that is nobody answer and store exactly as B's did
 *                     (HEAD: both stored; a fix refuses/drops both the same)  HEAD PASS (equal)
 *  ISS, document control (doc-control upload on a dedicated RFI, naming A's own
 *  readable file; create only — a revision upload is always a new revision):
 *    ISS.dc.own       control: issuedBy = A's PM, stored                         HEAD PASS
 *    ISS.dc           DEFECT issuedBy = B's PM's user id. Fixed as ISS-W.        HEAD FAIL: stored
 *    C.ISS.dc         control (no oracle): a random uuid answers and stores as B's did  HEAD PASS
 *  ISS, the non-UUID label (one global guard):
 *    ISS.label        guard: issuedBy = "UAT Consultant" on an RFI entry create is
 *                     accepted and stored as TEXT (the fix preserves non-UUID labels,
 *                     adjudication :31); it must NOT be refused                  HEAD PASS
 *  CP, the contract profile (one unit; the profile's documentIds is the standing
 *  state, replaced whole by each PUT; reset to [own] before each B write, proven):
 *    CP.own           control: PUT documentIds = [A's own PA1 document]: stored,
 *                     the GET echoes it                                          HEAD PASS
 *    CP.alone         DEFECT PUT documentIds = [D_B] (B's document alone). Fixed
 *                     expectation (CP-W): D_B is not stored (database and read-back),
 *                     refused 4xx or dropped. HEAD: stored                       HEAD FAIL
 *    CP.combined      DEFECT PUT documentIds = [A's own document, D_B]. Fixed: the
 *                     own id kept, D_B not stored (contract.service.js:235-287: HEAD
 *                     persists the combined list). HEAD: both stored             HEAD FAIL
 *    C.CP             control (no oracle): a random uuid (alone, and with the own id)
 *                     answers and stores as D_B did                              HEAD PASS (equal)
 *  Read stage: before the reads, the ISS surfaces carry B's user as issuedBy on the
 *  standing records (the four forms HEAD stores), and the contract profile carries
 *  [own, D_B] (observed; a fixed product refuses/drops them and the reads still hold).
 *
 * THE READS (as A's PM, the broadest reader of A; an answer below 400 where a
 * refusal is expected, any of B's bytes or metadata (the canary, B's originalName,
 * B's sha256), B's PM's e-mail (or name, when no member of A shares it), or a
 * person object carrying B's user id with a name or an e-mail, is OPEN, P0 class):
 *   R.iss.detail    the five revision records as the PM reads them (list and single
 *                   GETs) and the doc-control RFI: issuedBy echoed as a raw id only
 *                   (counted, not failed), B's user never resolved into a person, no
 *                   B metadata                                                  HEAD PASS
 *   R.iss.register  GET /doc-control/register: revisions' issuedBy raw, no B person  HEAD PASS
 *   R.iss.audit     the standing records' audit history: no issuedBy of B resolved, no B person  HEAD PASS
 *   R.iss.export    the RFI PDFs of the standing RFI and the doc-control RFI: none of B's person  HEAD PASS
 *   R.cp.profile    GET /contract: documentIds echoes D_B's id (counted), no B metadata, no person  HEAD PASS
 *   R.cp.extract    POST /contract/extract (profile = [own, D_B]): reads A's own text,
 *                   D_B is "unavailable" by its id only; none of B's text/file name  HEAD PASS
 *   R.cp.notices    GET /contract/notices: the summary, none of B                HEAD PASS
 *   R.cp.download   A: GET D_B through PA1 and PB attachments/workflow/text routes:
 *                   refused (404), none of B's bytes or text                    HEAD PASS
 *   R.cp.search     A: PA1 and global document search for the canary: no hit naming D_B  HEAD PASS
 *   R.B.unchanged   D_B as B left it; B still reads it (200, canary)            HEAD PASS
 *   R.B.user        B's PM's user row and memberships unchanged, none in A       HEAD PASS
 *
 * THE CHECKS (fixed before the first run): 3 setup + (5 x 6 ISS surface) + 4 ISS
 * global + 4 CP + 11 reads = 52 in the plan, + the harness's G.5xx = 53
 * (EXPECTED_CHECKS). Kinds: 3 setup; 23 defect (XDOC-ISS 21 = 5x4 revisions door
 * + 1 doc-control; XDOC-CP 2); 15 guard (5 own + 5 random + label + dc.own +
 * dc.random + CP.own + C.CP) + G.5xx; 11 check (reads).
 *
 * EXPECTED AT HEAD (product f599e67), from the trace above, never run by the
 * author: 53 recorded, 23 FAIL (every defect check), exit 2, DEFECT_PRESENT;
 * harness provisional classification CONFIRMED (23 of 23).
 *   per unit (observation 'classification'):
 *     XDOC-ISS  CONFIRMED on iss.rfi, iss.submittal, iss.drawing, iss.transmittal,
 *               iss.correspondence (4 of 4 each) and iss.dc (1 of 1)
 *     XDOC-CP   CONFIRMED on cp (2 of 2)
 *   no failed guard, no oracle, no open read.
 * On a tree with the r3 closures (same-org validation of whole-UUID issuers,
 * non-UUID labels kept; scope validation of contract documentIds): exit 0, PASS,
 * every unit REJECTED. A fix that refuses the whole revision write rather than
 * dropping issuedBy also PASSES (the check accepts a 4xx with nothing stored); a
 * fix that keeps issuedBy but empties it (the writer or null) PASSES too.
 *
 * CLASSIFICATION (observation 'classification', computed in cleanup; the
 * harness's own over the 23 defect checks beside it). Per unit u, over its defect
 * checks D(u): UNDETERMINED on a setup error, a thrown section, a check of D(u)
 * not run, or a failed own control (a door that refuses A's own value proves
 * nothing by refusing B's); CONFIRMED when all of D(u) fail; REJECTED when none
 * does; PARTIAL otherwise. Per suspect (XDOC-ISS, XDOC-CP): CONFIRMED / REJECTED
 * when every unit is, UNDETERMINED when none is determined, PARTIAL otherwise.
 * Beside it, never folded in: a failed C.* (an existence oracle), a failed R.*
 * read (an open cross-tenant read, P0 class), a failed R.B.* (B's state changed
 * by A's writes). The non-UUID label guard (ISS.label) is reported beside the
 * classification, not folded in.
 *
 * Exit 0 every check holds (the fixed behaviour), 2 a check failed (a defect
 * present), 1 setup error (harness rules). Results:
 * C:\Temp\octapm-cert\results\cert3\xdoc-1d-repro.json.
 *
 * DRAFT (read-only preparation, 2026-10-10): never run against the product by its
 * author. Checked without a database or an API: node --check and
 * registration-check.js (the real harness registers exactly these 53 checks), both
 * in C:\Temp\octapm-cert\scratch\wp2\xdoc1d\. Claude Main installs it as
 * backend/scripts/cert/cert3/xdoc-1d-repro.js and runs it through the lock runner.
 */

const harness = require('./lib/harness');

// FIRST: the in-process app on the certification database, machinery off.
harness.prepareInProcess();

const crypto = require('crypto');
const api = require('../lib/api');
const certEnv = require('../lib/cert-env');

const NAME = 'xdoc-1d-repro';
const COMPANY_A = '087';
const COMPANY_B = '088';
const DEFECT_ISS = 'XDOC-ISS';
const DEFECT_CP = 'XDOC-CP';
const STAMP = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${crypto.randomBytes(2).toString('hex')}`;
/** Letters only: one token for the full-text parser, so a search finds it whole. */
const CANARY = `xdocdcanary${Array.from(crypto.randomBytes(16), (b) => String.fromCharCode(97 + (b % 26))).join('')}`;
const PROJECT_A = `CERT3 XDOC1d repro A ${STAMP}`;
const PROJECT_B = `CERT3 XDOC1d repro B ${STAMP}`;
const START = '2026-01-05';
const END = '2026-12-31';
const LABEL_ISSUER = 'UAT Consultant';
const B_FILE = `xdoc1d-b-private-evidence-${STAMP}.txt`;
const B_TEXT = `XDOC-1d reproduction ${STAMP}: company B's private evidence. ${CANARY}\nOnly company B may read this file; its canary is ${CANARY}.\n`;
const OWN_MARK = `XDOC-1d reproduction ${STAMP}: company A's own evidence`;
/** The own contract document A names in its profile; long enough that extraction yields readable text (> 200 chars). */
const OWN_CP_TEXT = `${OWN_MARK} for the contract profile.\nClause 20.1: the Contractor shall give notice within 28 days of the event giving rise to the claim. ${OWN_MARK}. ${OWN_MARK}. This is A's own contract text, readable only inside company A's own project; it exists so the extraction read has a document of A's own to read while company B's named document stays unavailable.\n`;

let seq = 0;
const next = () => {
  seq += 1;
  return seq;
};
/** A revision code no record of this run has yet; Submittal.revision takes at most 20 characters. */
const revCode = () => `X${String(next()).padStart(4, '0')}`;

/** The five document record surfaces whose own create/update file revisions (recordDocumentRevisions). */
const SURFACES = Object.freeze([
  { key: 'rfi', label: 'RFI', recordType: 'rfi', table: 'Rfi', base: 'rfi', single: true, listQuery: '?limit=100', revSites: ['rfi.service.js:431', 'rfi.service.js:659'],
    body: (tag) => ({ subject: `XDOC-1d repro RFI ${tag}`, question: `XDOC-1d reproduction ${tag}` }) },
  { key: 'submittal', label: 'submittal', recordType: 'submittal', table: 'Submittal', base: 'submittals', single: true, listQuery: '?limit=100', revSites: ['submittal.service.js:466', 'submittal.service.js:702'],
    body: (tag) => ({ title: `XDOC-1d repro submittal ${tag}` }) },
  { key: 'drawing', label: 'drawing', recordType: 'drawing', table: 'DrawingRecord', base: 'drawings', single: false, listQuery: '', revSites: ['drawing.service.js:99', 'drawing.service.js:207'],
    body: (tag) => ({ drawingNumber: `X1D-${STAMP}-${next()}`, title: `XDOC-1d repro drawing ${tag}` }) },
  { key: 'transmittal', label: 'transmittal', recordType: 'transmittal', table: 'Transmittal', base: 'transmittals', single: false, listQuery: '', revSites: ['transmittal.service.js:99', 'transmittal.service.js:202'],
    body: (tag) => ({ subject: `XDOC-1d repro transmittal ${tag}`, sender: 'XDOC-1d repro', recipient: 'XDOC-1d repro' }) },
  { key: 'correspondence', label: 'correspondence', recordType: 'correspondence', table: 'Correspondence', base: 'correspondence', single: false, listQuery: '', revSites: ['correspondence.service.js:109', 'correspondence.service.js:231'],
    body: (tag) => ({ direction: 'outgoing', type: 'letter', subject: `XDOC-1d repro letter ${tag}` }) },
]);
const SURFACE = Object.freeze(Object.fromEntries(SURFACES.map((s) => [s.key, s])));
const ISS_DOORS = Object.freeze([
  ['entry', 'an explicit revisions[] entry carrying issuedBy (workflow-support.service.js:463)'],
  ['record', 'a top-level revision + issuedBy, the record entry (workflow-support.service.js:493)'],
]);
const OPS = Object.freeze(['create', 'update']);
/** The body of one issuedBy write under code c through door d. */
const issBody = (door, code, issuedBy) =>
  door === 'entry' ? { revisions: [{ revision: code, issuedBy }] } : { revision: code, issuedBy };

const ADJ3 = 'C:/Temp/octapm-cert/scratch/wp2/codex-plan-review-r3-adjudication.md';
const BLOCKERS = 'docs/certification/OCTAPM_LAUNCH_BLOCKERS.md';
const RULES = Object.freeze({
  'ISS-W': {
    status: 'decided',
    statement: 'The issuedBy stored on a revision — filed through a document record\'s own create or update (the revisions door) or through document control — is a user of the writer\'s own organisation, or a non-UUID label kept as text, or empty; a whole-UUID issuedBy naming another company\'s user is refused (4xx) with nothing stored, or is not stored (the stored issuedBy is a user of A, the writer, or empty). Another company\'s user is never stored as issuedBy. An own-organisation user id and a non-UUID label are accepted and stored. A stored reference to another company\'s record is a cross-company write (P1).',
    sources: [`${BLOCKERS}:146-149`, `${BLOCKERS}:300 (XDOC-ISS P1 suspect)`, `${ADJ3}:31 (round-3 lead; smallest closure: same-org validation of whole-UUID issuers, non-UUID labels preserved)`, 'backend/src/services/workflow-support.service.js:463, :493, :807', 'backend/src/services/doc-control.service.js:805', 'backend/src/routes/doc-control.js:195'],
  },
  'CP-W': {
    status: 'decided',
    statement: 'The documentIds stored on a contract profile name only documents of the caller\'s own organisation and project; a documentId naming another company\'s document is refused (4xx) with nothing stored, or is dropped (not stored, database and read-back), while the writer\'s own readable document in the combined list is kept. A stored reference to another company\'s record is a cross-company write (P1).',
    sources: [`${BLOCKERS}:146-149`, `${BLOCKERS}:301 (XDOC-CP P1 suspect)`, `${ADJ3}:32 (round-3 lead; PUT contract profile stores documentIds without scope validation)`, 'backend/src/services/contract.service.js:149, :157, :235-287', 'backend/src/routes/contract.js:39, :47'],
  },
  'ISS-U': {
    status: 'decided',
    statement: 'A sent issuedBy that is another company\'s user and one (a whole-UUID) that exists nowhere get the same answer and the same stored result (no oracle).',
    sources: [`${ADJ3}:31`, 'backend/src/services/workflow-support.service.js:463, :493'],
  },
  'CP-U': {
    status: 'decided',
    statement: 'A sent documentId that is another company\'s document and one (a UUID) that exists nowhere get the same answer and the same stored result (no oracle).',
    sources: [`${ADJ3}:32`, 'backend/src/services/contract.service.js:149'],
  },
  'XDOC-R': {
    status: 'decided',
    statement: 'No read path of company A resolves a stored reference into another company\'s document (bytes, text, file name, search hit or metadata) or another company\'s user into a person (name, e-mail); a cross-company read is P0 class. The raw id A itself sent may be echoed (recorded, not judged).',
    sources: [`${BLOCKERS}:146-149`, `${BLOCKERS}:300-301 (served as a raw id)`, 'backend/src/services/workflow-support.service.js:34-40, :876-888 (issuedBy is not a USER_REF_FIELD)', 'backend/src/services/document-text.service.js:1080-1097 (getDocumentText scoped to org and project)'],
  },
  'ISS-LABEL': {
    status: 'decided',
    statement: 'A non-UUID issuer label (for example "UAT Consultant") is accepted and stored as text; the same-org validation of issuers judges whole-UUID values only.',
    sources: [`${ADJ3}:31 ("non-UUID labels such as \\"UAT Consultant\\" are preserved")`],
  },
});

// ── the plan (fixed) ─────────────────────────────────────────────────────────
const issDefectIds = (s) => OPS.flatMap((op) => ISS_DOORS.map(([d]) => `ISS.${s.key}.${op}.${d}`));
const PLAN = [
  ['S.B', 'setup B (088): PM creates PB, uploads a text file with the canary through /workflow/uploads (201; D_B available, unlinked, in B\'s org and PB); its text extracted in process (ready); B downloads it (200, canary) and finds it by the canary in PB\'s document search and in the global search (positive controls)', { setup: true }],
  ['S.A', 'setup A (087): PM creates PA1, uploads two own text files in one request (own-cp, extracted ready, for the contract profile; own-doc for the doc-control door; each available, unlinked, in PA1, uploaded by the PM) and creates the five standing revision records (RFI, submittal, drawing, transmittal, correspondence) and a dedicated doc-control RFI: 201 each, no revision naming a file', { setup: true }],
  ['S.U', 'setup U (087/088): B\'s user is B\'s PM persona (pm@<B domain>) resolved in process (one User row; /auth/me as B\'s PM answers that id; an active membership in B, none in A), A\'s PM the same way in A; neither is a first row', { setup: true }],
  ...SURFACES.flatMap((s) => [
    [`ISS.${s.key}.own`, `control: A's PM's own user id as a revision's issuedBy (entry door, create and update) on the ${s.label} is accepted and stored (an own-organisation user) [${s.revSites.join(', ')}]`, { guard: true, rule: 'ISS-W' }],
    ...OPS.flatMap((op) => ISS_DOORS.map(([d, what]) => [
      `ISS.${s.key}.${op}.${d}`,
      `${s.label} ${op === 'create' ? 'POST (a new record)' : 'PATCH (the standing record)'} with ${what} = B's PM's user id: the stored issuedBy (database and read-back) is NOT B's user (a user of A, the writer, or empty), or the request is refused 4xx with nothing stored${op === 'create' ? ' and no record left' : ' and the record still there'} [HEAD FAIL: stored as sent; ${s.revSites[op === 'create' ? 0 : 1]}]`,
      { defect: DEFECT_ISS, rule: 'ISS-W' },
    ])),
    [`C.ISS.${s.key}`, `control (no oracle): on the ${s.label}, the four issuedBy = B writes repeated with a whole-UUID that is nobody answer exactly as the foreign writes did (status) and are stored exactly when they were (HEAD: equal)`, { guard: true, rule: 'ISS-U' }],
  ]),
  ['ISS.label', `guard: issuedBy = "${LABEL_ISSUER}" (a non-UUID label) on an RFI entry-door create is accepted and stored as text; it must NOT be refused (the fix judges whole-UUID issuers only)`, { guard: true, rule: 'ISS-LABEL' }],
  ['ISS.dc.own', 'control: POST /doc-control/rfi/:id/revisions naming A\'s own readable file with issuedBy = A\'s PM is accepted and stored (doc-control.service.js:805, route :195)', { guard: true, rule: 'ISS-W' }],
  ['ISS.dc', 'document control: POST /doc-control/rfi/:id/revisions naming A\'s own readable file with issuedBy = B\'s PM\'s user id: the stored issuedBy (database and read-back) is NOT B\'s user, or the request is refused 4xx with nothing stored [HEAD FAIL: stored as sent; doc-control.service.js:805]', { defect: DEFECT_ISS, rule: 'ISS-W' }],
  ['C.ISS.dc', 'control (no oracle): the doc-control write repeated with a whole-UUID that is nobody answers and stores exactly as B\'s did (HEAD: equal)', { guard: true, rule: 'ISS-U' }],
  ['CP.own', 'control: PUT /contract documentIds = [A\'s own PA1 document] is accepted and stored, the GET echoes it (contract.service.js:149; routes/contract.js:39, :47)', { guard: true, rule: 'CP-W' }],
  ['CP.alone', 'PUT /contract documentIds = [D_B] (company B\'s document alone): D_B is not stored (database and read-back), the request refused 4xx or D_B dropped [HEAD FAIL: stored as sent]', { defect: DEFECT_CP, rule: 'CP-W' }],
  ['CP.combined', 'PUT /contract documentIds = [A\'s own document, D_B]: D_B is not stored and A\'s own id is kept, or the request refused 4xx with nothing changed [HEAD FAIL: the combined list is persisted, contract.service.js:235-287]', { defect: DEFECT_CP, rule: 'CP-W' }],
  ['C.CP', 'control (no oracle): a random uuid (alone, and with the own id) answers exactly as D_B did (status) and is stored exactly when D_B was (HEAD: equal)', { guard: true, rule: 'CP-U' }],
  ['R.iss.detail', 'A: the five revision records (list and the RFI/submittal single GETs) and the doc-control RFI as the PM reads them: every standing record found; a revision\'s issuedBy echoes only a raw id (counted, not judged), B\'s user is never resolved into a person (no name, no e-mail), and no revision carries B\'s document metadata', { rule: 'XDOC-R' }],
  ['R.iss.register', 'A: GET /projects/PA1/doc-control/register (200): revisions\' issuedBy raw only, no person of B, no metadata of B', { rule: 'XDOC-R' }],
  ['R.iss.audit', 'A: the audit history of every standing revision record and the doc-control RFI (200, events present): no issuedBy of B resolved into a person, no metadata of B, no canary', { rule: 'XDOC-R' }],
  ['R.iss.export', 'A: the RFI PDF of the standing RFI and of the doc-control RFI (200 each): none of B\'s person, none of B\'s bytes or metadata', { rule: 'XDOC-R' }],
  ['R.cp.profile', 'A: GET /projects/PA1/contract (200): documentIds echoes D_B\'s id (counted, not judged), no originalName, sizeBytes or sha256 of D_B, no person of B', { rule: 'XDOC-R' }],
  ['R.cp.extract', 'A: POST /projects/PA1/contract/extract (profile = [own, D_B]): A\'s own document read, D_B returned "unavailable" by its id only (200 degraded or 409); none of B\'s text, file name or metadata', { rule: 'XDOC-R' }],
  ['R.cp.notices', 'A: GET /projects/PA1/contract/notices (200): the notice summary, none of B\'s identifiers or person', { rule: 'XDOC-R' }],
  ['R.cp.download', 'A: GET D_B through /projects/PA1/attachments/documents, /workflow/uploads and /documents/:id/text, and the same on PB: refused (404), none of B\'s bytes or text', { rule: 'XDOC-R' }],
  ['R.cp.search', 'A: GET /projects/PA1/documents/search?q=<canary> and /search?q=<canary>: no hit naming D_B, the canary or B\'s file', { rule: 'XDOC-R' }],
  ['R.B.unchanged', 'B: D_B\'s orgId, projectId, status, linkedEntityType and linkedEntityId unchanged (available, unlinked) and B still reads it through /attachments/documents (200, canary)', { rule: 'XDOC-R' }],
  ['R.B.user', 'B: B\'s PM\'s user row (e-mail, name, home org) and its memberships unchanged by the run, still none in A', { rule: 'ISS-W' }],
];
/** Fixed before the first run: 52 in the plan + the harness's G.5xx. */
const EXPECTED_CHECKS = 53;
if (PLAN.length + 1 !== EXPECTED_CHECKS) throw new Error(`${NAME}: the plan lists ${PLAN.length} checks + G.5xx, EXPECTED_CHECKS is ${EXPECTED_CHECKS}`);
const DEFECT_IDS = PLAN.filter((entry) => entry[2]?.defect).map((entry) => entry[0]);
const HEAD_FAILS = [...DEFECT_IDS];
if (DEFECT_IDS.length !== 23) throw new Error(`${NAME}: ${DEFECT_IDS.length} defect checks, 23 expected`);

/** The classification units: each with its own control, its defect checks and the section that runs it. */
const UNITS = Object.freeze([
  ...SURFACES.map((s) => ({ unit: `iss.${s.key}`, suspect: DEFECT_ISS, own: `ISS.${s.key}.own`, random: `C.ISS.${s.key}`, defects: issDefectIds(s), sites: s.revSites, head: 'CONFIRMED' })),
  { unit: 'iss.dc', suspect: DEFECT_ISS, own: 'ISS.dc.own', random: 'C.ISS.dc', defects: ['ISS.dc'], sites: ['doc-control.service.js:805', 'routes/doc-control.js:195'], head: 'CONFIRMED' },
  { unit: 'cp', suspect: DEFECT_CP, own: 'CP.own', random: 'C.CP', defects: ['CP.alone', 'CP.combined'], sites: ['contract.service.js:149', 'contract.service.js:235-287'], head: 'CONFIRMED' },
]);

const CLASSIFICATION_RULE = 'Per unit (iss.<surface>, iss.dc, cp) over its defect checks: UNDETERMINED on a setup error, a thrown section, a check not run, or a failed own control; CONFIRMED when all fail; REJECTED when none fails; PARTIAL otherwise. Per suspect (XDOC-ISS, XDOC-CP): CONFIRMED / REJECTED when every unit is; UNDETERMINED when none is determined; PARTIAL otherwise. Beside it, never folded in: a failed C.* (an existence oracle), a failed R.* read (open cross-tenant read, P0 class), a failed R.B.* (B\'s state changed), the non-UUID label guard ISS.label.';

const h = harness.createHarness({
  name: NAME,
  plan: PLAN,
  rules: RULES,
  meta: {
    suspects: [DEFECT_ISS, DEFECT_CP],
    model: 'backend/scripts/cert/cert3/xdoc-1c-repro.js',
    leads: `${ADJ3}:31 (XDOC-ISS), :32 (XDOC-CP), :41-43 (reproduced live by xdoc-1d-repro.js before the batch)`,
    companies: { A: COMPANY_A, B: COMPANY_B, rule: 'fixed codes (the XDOC-1 pair), each in the population and exactly one organisation by slug; never a first row' },
    bUserRule: 'B\'s PM persona (pm@<B domain>, scripts/cert/lib/spec.js:236): one User row, /auth/me as B\'s PM answers its id, an active membership in B and none in A; never a first row',
    projects: { A: PROJECT_A, B: PROJECT_B },
    stamp: STAMP,
    expectedChecks: EXPECTED_CHECKS,
    headExpectation: {
      fail: HEAD_FAILS,
      exit: 2,
      verdict: 'DEFECT_PRESENT',
      classification: 'harness CONFIRMED (23 of 23); XDOC-ISS CONFIRMED on its six units; XDOC-CP CONFIRMED on cp',
      perUnit: Object.fromEntries(UNITS.map((u) => [u.unit, u.head])),
    },
    classificationRule: CLASSIFICATION_RULE,
    callSites: Object.fromEntries(UNITS.map((u) => [u.unit, u.sites])),
  },
});

// ── small helpers ────────────────────────────────────────────────────────────
const listOf = (data) => (Array.isArray(data) ? data : []);
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
/** A document id in a documentIds list (strings only). */
const idsOf = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);

// ── run state (shared with cleanup) ─────────────────────────────────────────
const ctx = { db: null, q: null, pmA: null, pmB: null, orgA: null, orgB: null, projectA: null, projectB: null, D_B: null, docB: null, aPm: null, bUser: null, rev: {}, dc: { rfiId: null, ids: [] }, ownCp: null, ownDoc: null };
const verdict = new Map();
const failedSections = new Set();
let mainError = null;
const obs = { writes: {}, random: {}, readStage: {}, reads: {}, own: {} };

const check = (id, ok, detail) => {
  verdict.set(id, ok === true);
  return h.check(id, ok, detail);
};
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
  obs.companies = { A: { code: COMPANY_A, orgId: orgA.id, slug: orgA.slug }, B: { code: COMPANY_B, orgId: orgB.id, slug: orgB.slug } };
  const pmA = api.as({ email: `pm@${companyA.domain}`, orgId: orgA.id });
  const pmB = api.as({ email: `pm@${companyB.domain}`, orgId: orgB.id });
  ctx.pmA = pmA;
  ctx.pmB = pmB;
  console.log(`${NAME}: A ${COMPANY_A} ${orgA.name} (${orgA.id}); B ${COMPANY_B} ${orgB.name} (${orgB.id}); stamp ${STAMP}; in process`);

  const docRow = async (id) =>
    (await q('select id, "orgId", "projectId", "documentType", "originalName", "fileName", "sizeBytes", sha256, "storageKey", status, "scanStatus", "uploadedBy", "linkedEntityType", "linkedEntityId" from "ProjectDocument" where id = $1', [id]))[0] || null;
  const upload = async (who, label, projectRoute, path, files) => {
    const form = new FormData();
    for (const f of files) form.append('files', new Blob([f.body], { type: f.type }), f.name);
    const res = await ask(who, label, 'POST', `${projectRoute}/${path}`, undefined, { form });
    const rows = res.status === 201 ? rowsOf(res.body?.data) : [];
    return { res, ids: rows.map((r) => r?.documentId || null).filter(Boolean) };
  };

  // ── setup B: the other company's document (as xdoc-1c-repro.js) ──────────
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
      `PB ${said(createdB)}; upload ${said(upB.res)} (${upB.ids.length} id(s)); D_B ${D_B} ${json(docB && { orgId: docB.orgId, projectId: docB.projectId, status: docB.status, storageKey: docB.storageKey })}; extraction ${json(extracted)}; B download ${said(readB)} canary ${readB ? textOf(readB).includes(CANARY) : false}; B project search ${said(searchB)} hit ${hitB(searchB)}; B global search ${said(globalB)} hit ${hitB(globalB)}`);
  });
  if (verdict.get('S.B') !== true) throw new Error('setup incomplete: company B');
  const D_B = ctx.D_B;
  const docB = ctx.docB;
  const PB = `/projects/${ctx.projectB}`;
  const B_KEYS = [D_B, docB.storageKey].filter(Boolean);
  const namesDB = (text) => B_KEYS.some((k) => k && String(text).includes(k));
  /** What of company B an answer must never carry: B's bytes and metadata now, B's person once resolved (setup U). */
  const markers = [['canary', CANARY], ['originalName', docB.originalName], ['sha256', docB.sha256]];
  const leakIn = (text) => {
    const t = String(text || '').toLowerCase();
    return markers.filter(([, v]) => v && t.includes(String(v).toLowerCase())).map(([k]) => k);
  };
  /** A ref naming D_B that carries D_B's own metadata (only the document row could have given it). */
  const metaOfB = (ref) =>
    ref && typeof ref === 'object' && Boolean(
      ref.projectDocument
        || (ref.sizeBytes !== null && ref.sizeBytes !== undefined && Number(ref.sizeBytes) === Number(docB.sizeBytes) && namesDB(json(ref, 1e6)))
        || (ref.sha256 && ref.sha256 === docB.sha256)
        || ref.originalName === docB.originalName,
    );
  /** B's user resolved into a person somewhere in an answer: an object with B's user id and a name or an e-mail. */
  const personOfB = (value, depth = 0) => {
    if (!ctx.bUser || !value || typeof value !== 'object' || depth > 14) return false;
    if (Array.isArray(value)) return value.some((v) => personOfB(v, depth + 1));
    if (value.id === ctx.bUser.id && (value.name || value.email)) return true;
    return Object.values(value).some((v) => personOfB(v, depth + 1));
  };

  // ── setup A: the project, two own files and the standing records ─────────
  await h.section('setup A', async () => {
    const createdA = await ask(pmA, 'A: PM creates PA1', 'POST', '/projects', { name: PROJECT_A, startDate: START, endDate: END, projectCalendar: 'five_day' });
    ctx.projectA = createdA.status === 201 ? createdA.body?.data?.id || null : null;
    const PA = `/projects/${ctx.projectA}`;
    for (const s of SURFACES) ctx.rev[s.key] = { route: `${PA}/${s.base}`, standingId: null, ids: [] };
    const ownFiles = [
      { slot: 'cp', name: `xdoc1d-a-own-cp-${STAMP}.txt`, text: OWN_CP_TEXT },
      { slot: 'doc', name: `xdoc1d-a-own-doc-${STAMP}.txt`, text: `${OWN_MARK} for the document-control door.\n` },
    ];
    const ownUp = ctx.projectA ? await upload(pmA, 'A: PM uploads its own files (two, one request)', PA, 'workflow/uploads', ownFiles.map((f) => ({ name: f.name, body: Buffer.from(f.text, 'utf8'), type: 'text/plain' }))) : { res: null, ids: [] };
    const ownOk = [];
    for (const id of ownUp.ids) {
      const row = await docRow(id);
      const file = ownFiles.find((f) => f.name === row?.originalName);
      if (file && !ctx[file.slot === 'cp' ? 'ownCp' : 'ownDoc']) {
        ctx[file.slot === 'cp' ? 'ownCp' : 'ownDoc'] = row;
        ownOk.push(row.projectId === ctx.projectA && row.orgId === orgA.id && row.status === 'available' && !row.linkedEntityType && !row.linkedEntityId);
      }
    }
    // Extract the own contract document in process (the worker is off), so the extraction read has readable A text.
    let ownCpExtract = null;
    if (ctx.ownCp) {
      try {
        // eslint-disable-next-line global-require
        ownCpExtract = await require('../../../src/services/document-text.service').runDocumentExtractJob({ job: { orgId: orgA.id }, payload: { documentId: ctx.ownCp.id } });
      } catch (error) {
        ownCpExtract = { status: 'error', reason: error.message };
      }
    }
    obs.ownCpExtract = ownCpExtract;

    const standing = {};
    const make = async (s, holder, label) => {
      const res = await ask(pmA, `A: PM creates ${label}`, 'POST', holder.route, s.body(`standing ${STAMP}`));
      const id = res.status === 201 ? res.body?.data?.id || null : null;
      holder.standingId = id;
      if (id) holder.ids.push(id);
      const filesNaming = id ? Number((await q('select count(*)::int as n from "DocumentRevision" where "projectId" = $1 and "recordType" = $2 and "recordId" = $3 and coalesce("storageKey", "fileUrl", "projectDocumentId") is not null', [ctx.projectA, s.recordType, id]))[0].n) : null;
      standing[label] = { answer: saidLong(res), id, revisionsWithAFile: filesNaming };
    };
    for (const s of SURFACES) if (ctx.projectA) await make(s, ctx.rev[s.key], `the standing ${s.label}`);
    // The dedicated doc-control RFI (so its revisions never mix with the rfi surface's).
    const dcHolder = { route: `${PA}/${SURFACE.rfi.base}`, standingId: null, ids: [] };
    if (ctx.projectA) await make(SURFACE.rfi, dcHolder, 'the doc-control RFI');
    ctx.dc.rfiId = dcHolder.standingId;
    if (dcHolder.standingId) ctx.dc.ids.push(dcHolder.standingId);

    obs.projectA = ctx.projectA;
    obs.projectB = ctx.projectB;
    obs.ownDocuments = { ownCp: ctx.ownCp?.id || null, ownDoc: ctx.ownDoc?.id || null };
    obs.standing = standing;
    check('S.A',
      createdA.status === 201 && Boolean(ctx.projectA)
        && ownUp.res?.status === 201 && ownUp.ids.length === ownFiles.length && ownOk.length === ownFiles.length && ownOk.every(Boolean)
        && Boolean(ctx.ownCp) && Boolean(ctx.ownDoc) && ownCpExtract?.status === 'ready'
        && SURFACES.every((s) => Boolean(ctx.rev[s.key]?.standingId)) && Boolean(ctx.dc.rfiId)
        && Object.values(standing).every((x) => Boolean(x.id) && x.revisionsWithAFile === 0),
      `PA1 ${said(createdA)}; own upload ${said(ownUp.res)} (${ownUp.ids.length} id(s), ${ownOk.filter(Boolean).length} matched); own-cp extraction ${json(ownCpExtract)}; standing records ${json(standing, 2200)}`);
  });
  if (verdict.get('S.A') !== true) throw new Error('setup incomplete: company A');
  const PA = `/projects/${ctx.projectA}`;

  // ── setup U: the people resolved by rule ─────────────────────────────────
  await h.section('setup U', async () => {
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
    check('S.U',
      aOk && bOk,
      `A's PM ${json({ rows: a.rows.length, me: a.me, sameId: a.meId === a.user?.id, memberships: a.memberships.length })}; B's user ${json({ rows: b.rows.length, me: b.me, sameId: b.meId === b.user?.id, inB: b.memberships.some((m) => m.orgId === orgB.id && m.status === 'active'), inA: b.memberships.some((m) => m.orgId === orgA.id), nameMarker })}`);
  });
  if (verdict.get('S.U') !== true) throw new Error('setup incomplete: the people');

  const B = ctx.bUser.id;
  const aPm = ctx.aPm;
  const randomUuid = () => crypto.randomUUID();
  const who = (v) => (v === null || v === undefined || v === '' ? 'empty' : v === aPm ? 'A\'s PM (the writer)' : v === B ? 'B\'s PM' : v === LABEL_ISSUER ? 'the label' : /^[0-9a-f-]{36}$/i.test(String(v)) ? 'a uuid that is nobody' : `another value ${v}`);

  // ── SQL readers (reads only) ──────────────────────────────────────────────
  const recordCount = async (table) => Number((await q(`select count(*)::int as n from "${table}" where "projectId" = $1`, [ctx.projectA]))[0].n);
  const revRows = async (recordType, recordId) => q('select id, revision, "issuedBy", "projectDocumentId", "storageKey", "fileUrl" from "DocumentRevision" where "projectId" = $1 and "recordType" = $2 and "recordId" = $3 order by "createdAt"', [ctx.projectA, recordType, recordId]);
  const cpDocumentIds = async () => idsOf(((await q('select "documentIds" as d from "ContractProfile" where "projectId" = $1', [ctx.projectA]))[0] || {}).d);
  /** The record as the PM reads it: its single GET where the module has one, else its list. */
  const readBack = async (s, route, id, label) => {
    const res = await ask(pmA, label, 'GET', s.single ? `${route}/${id}` : `${route}${s.listQuery || ''}`);
    let rec = null;
    if (res.status === 200) rec = s.single ? (res.body?.data?.id === id ? res.body.data : null) : rowsOf(res.body?.data).find((r) => r?.id === id) || null;
    return { res, rec };
  };

  // ── (1) issuedBy through the revisions door ────────────────────────────────
  /** A create, judged on its own: the answer, the new record's revision under our code, the read-back, the table's count. */
  const issCreate = async (s, label, door, code, issuedBy) => {
    const R = ctx.rev[s.key];
    const before = await recordCount(s.table);
    const res = await ask(pmA, `iss ${s.key} create ${label}: PM POSTs a new ${s.label}`, 'POST', R.route, { ...s.body(`iss ${label} ${STAMP}`), ...issBody(door, code, issuedBy) });
    const id = res.status === 201 ? res.body?.data?.id || null : null;
    if (id) R.ids.push(id);
    const after = await recordCount(s.table);
    const dbRevs = id ? (await revRows(s.recordType, id)).filter((r) => r.revision === code) : [];
    const back = id ? await readBack(s, R.route, id, `iss ${s.key} create ${label}: PM reads the new ${s.label} back`) : null;
    const apiRevs = back ? listOf(back.rec?.revisions).filter((r) => r.revision === code) : [];
    const issued = [...dbRevs.map((r) => r.issuedBy ?? null), ...apiRevs.map((r) => r.issuedBy ?? null)];
    return { op: 'create', res, said: saidLong(res), id, before, after, recordLeft: after !== before, dbRevs, apiRevs, issued, readBack: back ? said(back.res) : null };
  };
  /** An update of the standing record, judged on its own: this write's code, the read-back. */
  const issUpdate = async (s, label, door, code, issuedBy) => {
    const R = ctx.rev[s.key];
    const res = await ask(pmA, `iss ${s.key} update ${label}: PM PATCHes the standing ${s.label}`, 'PATCH', `${R.route}/${R.standingId}`, issBody(door, code, issuedBy));
    const dbRevs = (await revRows(s.recordType, R.standingId)).filter((r) => r.revision === code);
    const back = await readBack(s, R.route, R.standingId, `iss ${s.key} update ${label}: PM reads the standing ${s.label} back`);
    const apiRevs = listOf(back.rec?.revisions).filter((r) => r.revision === code);
    const issued = [...dbRevs.map((r) => r.issuedBy ?? null), ...apiRevs.map((r) => r.issuedBy ?? null)];
    return { op: 'update', res, said: saidLong(res), id: R.standingId, dbRevs, apiRevs, issued, found: Boolean(back.rec), readBack: said(back.res) };
  };
  const storedBOf = (o) => o.issued.includes(B);
  const issOk = (o) => {
    if (storedBOf(o)) return false;
    if (o.op === 'create') return o.res.status === 201 ? Boolean(o.id) : (is4xx(o.res) && !o.recordLeft);
    return o.res.status === 200 ? o.found : (is4xx(o.res) && o.found);
  };
  const issNote = (o, issuedBy) => `PM ${o.op === 'create' ? 'POST' : 'PATCH'} issuedBy ${who(issuedBy)} -> ${o.said}; stored issuedBy of this code [${o.issued.map(who).join(', ') || 'none'}]${o.op === 'create' ? `; record ${o.id || 'none'}; ${o.before} -> ${o.after} record(s) of the table` : `; read back ${o.readBack}${o.found ? '' : ' (record NOT found)'}`}`;

  for (const s of SURFACES) {
    await h.section(`revisions door: ${s.label}`, async () => {
      // ISS.s.own: A's PM's own user id, create then update, entry door.
      const ownC = await issCreate(s, 'own', 'entry', revCode(), aPm);
      const ownU = await issUpdate(s, 'own', 'entry', revCode(), aPm);
      obs.own[`iss.${s.key}`] = { create: { answer: ownC.said, id: ownC.id, issued: ownC.issued.map(who) }, update: { answer: ownU.said, issued: ownU.issued.map(who) } };
      check(`ISS.${s.key}.own`,
        ownC.res.status === 201 && Boolean(ownC.id) && ownC.issued.length > 0 && ownC.issued.every((v) => v === aPm)
          && ownU.res.status === 200 && ownU.issued.length > 0 && ownU.issued.every((v) => v === aPm),
        `create ${issNote(ownC, aPm)}; update ${issNote(ownU, aPm)}`);

      const foreign = { create: {}, update: {} };
      for (const op of OPS) {
        for (const [d] of ISS_DOORS) {
          const id = `ISS.${s.key}.${op}.${d}`;
          const code = revCode();
          const o = op === 'create' ? await issCreate(s, `${op}-${d}`, d, code, B) : await issUpdate(s, `${op}-${d}`, d, code, B);
          foreign[op][d] = o;
          obs.writes[id] = { sent: 'B\'s PM\'s user id', answer: o.said, storedIssuedBy: o.issued.map(who), keptB: storedBOf(o), record: o.id, ...(op === 'create' ? { recordLeft: o.recordLeft } : { found: o.found }) };
          check(id, issOk(o), `${issNote(o, B)}; HEAD FAIL: stored as sent${storedBOf(o) ? ' -- B\'s user id stored as the revision\'s issuedBy (XDOC-ISS, cross-company reference stored, P1 class)' : ''}`);
        }
      }

      // C.ISS.s: the four B writes repeated with a uuid that is nobody answer and store exactly as B's did.
      const pairs = [];
      for (const op of OPS) {
        for (const [d] of ISS_DOORS) {
          const r = randomUuid();
          const o = op === 'create' ? await issCreate(s, `${op}-${d}-random`, d, revCode(), r) : await issUpdate(s, `${op}-${d}-random`, d, revCode(), r);
          const f = foreign[op][d];
          const same = said(o.res) === said(f.res) && o.issued.includes(r) === storedBOf(f) && (op === 'create' ? Boolean(o.id) === Boolean(f.id) && o.recordLeft === f.recordLeft : o.found === f.found);
          pairs.push({ op, door: d, random: { answer: said(o.res), stored: o.issued.includes(r) }, foreign: { answer: said(f.res), stored: storedBOf(f) }, same });
        }
      }
      obs.random[`iss.${s.key}`] = pairs;
      const differ = pairs.filter((p) => !p.same);
      check(`C.ISS.${s.key}`, differ.length === 0,
        `${differ.length ? `ORACLE: ${differ.map((p) => `${p.op}.${p.door} random ${p.random.answer}${p.random.stored ? ' stored' : ''} vs B ${p.foreign.answer}${p.foreign.stored ? ' stored' : ''}`).join('; ')}. ` : ''}${pairs.map((p) => `${p.op}.${p.door} ${p.random.answer}${p.random.stored ? ' stored' : ''} = ${p.foreign.answer}${p.foreign.stored ? ' stored' : ''}`).join('; ')}`);

      // Read stage: the standing record carries B's user as issuedBy (the four forms HEAD stores), for the reads.
      for (const [d] of ISS_DOORS) await issUpdate(s, `read stage ${d}`, d, revCode(), B);
    }, { onError: async () => { failedSections.add(`iss.${s.key}`); } });
  }

  // ── the non-UUID label guard ───────────────────────────────────────────────
  await h.section('revisions door: non-UUID label', async () => {
    const o = await issCreate(SURFACE.rfi, 'label', 'entry', revCode(), LABEL_ISSUER);
    obs.own['iss.label'] = { answer: o.said, id: o.id, issued: o.issued };
    check('ISS.label',
      o.res.status === 201 && Boolean(o.id) && o.issued.length > 0 && o.issued.every((v) => v === LABEL_ISSUER),
      `PM POST issuedBy "${LABEL_ISSUER}" -> ${o.said}; stored issuedBy [${o.issued.join(', ') || 'none'}] (a non-UUID label must stay accepted and stored as text)`);
  }, { onError: async () => { failedSections.add('iss.label'); } });

  // ── (1b) issuedBy through document control ─────────────────────────────────
  await h.section('document control', async () => {
    const ownDocId = ctx.ownDoc.id;
    const route = `${PA}/doc-control/rfi/${ctx.dc.rfiId}/revisions`;
    const fileOne = async (label, issuedBy) => {
      const code = revCode();
      const res = await ask(pmA, `dc ${label}: PM files a revision with issuedBy ${who(issuedBy)}`, 'POST', route, { revision: code, projectDocumentId: ownDocId, issuedBy });
      const dbRevs = (await revRows('rfi', ctx.dc.rfiId)).filter((r) => r.revision === code);
      const apiIssued = res.status === 201 ? res.body?.data?.issuedBy ?? null : null;
      const issued = [...dbRevs.map((r) => r.issuedBy ?? null), ...(res.status === 201 ? [apiIssued] : [])];
      const anywhere = Number((await q('select count(*)::int as n from "DocumentRevision" where "projectId" = $1 and "recordType" = $2 and "recordId" = $3 and revision = $4', [ctx.projectA, 'rfi', ctx.dc.rfiId, code]))[0].n);
      return { res, said: saidLong(res), code, issued, anywhere };
    };
    const ownO = await fileOne('own', aPm);
    obs.own['iss.dc'] = { answer: ownO.said, issued: ownO.issued.map(who) };
    check('ISS.dc.own',
      ownO.res.status === 201 && ownO.issued.length > 0 && ownO.issued.every((v) => v === aPm),
      `PM POST issuedBy ${who(aPm)} -> ${ownO.said}; stored issuedBy [${ownO.issued.map(who).join(', ') || 'none'}]`);

    const bO = await fileOne('B', B);
    obs.writes['ISS.dc'] = { sent: 'B\'s PM\'s user id', answer: bO.said, storedIssuedBy: bO.issued.map(who), keptB: bO.issued.includes(B), stored: bO.anywhere };
    const dcOk = (bO.issued.length > 0 && !bO.issued.includes(B)) || (is4xx(bO.res) && bO.anywhere === 0);
    check('ISS.dc', dcOk,
      `PM POST issuedBy ${who(B)} -> ${bO.said}; stored issuedBy [${bO.issued.map(who).join(', ') || 'none'}]; ${bO.anywhere} revision(s) with this code; HEAD FAIL: stored as sent${bO.issued.includes(B) ? ' -- B\'s user id stored as the revision\'s issuedBy (XDOC-ISS, cross-company reference stored, P1 class)' : ''}`);

    const rUuid = randomUuid();
    const rO = await fileOne('random', rUuid);
    const same = said(rO.res) === said(bO.res) && rO.issued.includes(rUuid) === bO.issued.includes(B) && (rO.anywhere > 0) === (bO.anywhere > 0);
    obs.random['iss.dc'] = { random: { answer: said(rO.res), stored: rO.issued.includes(rUuid) }, foreign: { answer: said(bO.res), stored: bO.issued.includes(B) }, same };
    check('C.ISS.dc', same,
      `${same ? '' : 'ORACLE: '}random ${said(rO.res)}${rO.issued.includes(rUuid) ? ' stored' : ''} ${same ? '=' : 'vs'} B ${said(bO.res)}${bO.issued.includes(B) ? ' stored' : ''}`);
  }, { onError: async () => { failedSections.add('iss.dc'); } });

  // ── (2) ContractProfile.documentIds ────────────────────────────────────────
  await h.section('contract profile documentIds', async () => {
    const route = `${PA}/contract`;
    const ownCpId = ctx.ownCp.id;
    const put = async (label, documentIds) => {
      const res = await ask(pmA, `cp ${label}: PM PUTs the contract profile documentIds`, 'PUT', route, { documentIds });
      const dbIds = await cpDocumentIds();
      const get = await ask(pmA, `cp ${label}: PM GETs the contract profile`, 'GET', route);
      const apiIds = get.status === 200 ? idsOf(get.body?.data?.documentIds) : [];
      return { res, said: saidLong(res), dbIds, apiIds, get: said(get) };
    };
    const reset = async () => {
      const res = await ask(pmA, 'cp: PM resets documentIds to [own]', 'PUT', route, { documentIds: [ownCpId] });
      const dbIds = await cpDocumentIds();
      if (res.status !== 200 || !(dbIds.length === 1 && dbIds[0] === ownCpId)) throw new Error(`the contract profile could not be reset to [own] (${saidLong(res)}; documentIds ${json(dbIds)})`);
    };

    // CP.own: the own document is accepted and stored, the GET echoes it.
    const ownO = await put('own', [ownCpId]);
    obs.own.cp = { answer: ownO.said, dbIds: ownO.dbIds, apiIds: ownO.apiIds };
    check('CP.own',
      ownO.res.status === 200 && ownO.dbIds.includes(ownCpId) && ownO.apiIds.includes(ownCpId),
      `PUT [own] -> ${ownO.said}; stored ${json(ownO.dbIds)}; GET ${ownO.get} ${json(ownO.apiIds)}`);

    // CP.alone: D_B alone must not be stored.
    await reset();
    const aloneO = await put('alone (D_B)', [D_B]);
    const aloneStored = aloneO.dbIds.includes(D_B) || aloneO.apiIds.includes(D_B);
    obs.writes['CP.alone'] = { sent: '[D_B]', answer: aloneO.said, stored: aloneStored, dbIds: aloneO.dbIds };
    check('CP.alone', !aloneStored,
      `PUT [D_B] -> ${aloneO.said}; stored documentIds ${json(aloneO.dbIds)}; read-back ${json(aloneO.apiIds)}; HEAD FAIL: stored as sent${aloneStored ? ' -- B\'s document id stored in the contract profile (XDOC-CP, cross-company reference stored, P1 class)' : ''}`);

    // CP.combined: D_B dropped, the own id kept.
    await reset();
    const combinedO = await put('combined (own + D_B)', [ownCpId, D_B]);
    const combinedStoredB = combinedO.dbIds.includes(D_B) || combinedO.apiIds.includes(D_B);
    const combinedKeptOwn = combinedO.dbIds.includes(ownCpId);
    obs.writes['CP.combined'] = { sent: '[own, D_B]', answer: combinedO.said, storedB: combinedStoredB, keptOwn: combinedKeptOwn, dbIds: combinedO.dbIds };
    check('CP.combined', !combinedStoredB && combinedKeptOwn,
      `PUT [own, D_B] -> ${combinedO.said}; stored documentIds ${json(combinedO.dbIds)}; HEAD FAIL: the combined list is persisted${combinedStoredB ? ' -- B\'s document id stored in the contract profile (XDOC-CP, cross-company reference stored, P1 class)' : ''}${combinedKeptOwn ? '' : ' (own id NOT kept)'}`);

    // C.CP: a uuid that is nobody, alone and with the own id, answers and stores as D_B did.
    await reset();
    const r1 = randomUuid();
    const randAlone = await put('random alone', [r1]);
    await reset();
    const r2 = randomUuid();
    const randCombined = await put('random combined', [ownCpId, r2]);
    const pairs = [
      { case: 'alone', random: { answer: said(randAlone.res), stored: randAlone.dbIds.includes(r1) }, foreign: { answer: aloneO.said, stored: aloneStored }, same: said(randAlone.res) === said(aloneO.res) && randAlone.dbIds.includes(r1) === aloneStored },
      { case: 'combined', random: { answer: said(randCombined.res), stored: randCombined.dbIds.includes(r2), keptOwn: randCombined.dbIds.includes(ownCpId) }, foreign: { answer: said(combinedO.res), stored: combinedStoredB, keptOwn: combinedKeptOwn }, same: said(randCombined.res) === said(combinedO.res) && randCombined.dbIds.includes(r2) === combinedStoredB && randCombined.dbIds.includes(ownCpId) === combinedKeptOwn },
    ];
    obs.random.cp = pairs;
    const differ = pairs.filter((p) => !p.same);
    check('C.CP', differ.length === 0,
      `${differ.length ? 'ORACLE: ' : ''}${pairs.map((p) => `${p.case} random ${p.random.answer}${p.random.stored ? ' stored' : ''} ${p.same ? '=' : 'vs'} D_B ${p.foreign.answer}${p.foreign.stored ? ' stored' : ''}`).join('; ')}`);

    // Read stage: the profile carries [own, D_B], for the reads.
    const staged = await put('read stage', [ownCpId, D_B]);
    obs.readStage.cp = { answer: staged.said, dbIds: staged.dbIds };
  }, { onError: async () => { failedSections.add('cp'); } });

  // ── the reads: no door resolves B's person or B's document for A ───────────
  await h.section('reads', async () => {
    // R.iss.detail: the five revision records and the doc-control RFI.
    const detail = {};
    let anyPerson = false;
    let anyMeta = false;
    let anyLeak = [];
    let echoes = 0;
    for (const s of SURFACES) {
      const R = ctx.rev[s.key];
      const list = await ask(pmA, `A: PM lists the ${s.label}s`, 'GET', `${R.route}${s.listQuery || ''}`);
      const records = list.status === 200 ? rowsOf(list.body?.data) : [];
      const single = s.single ? await ask(pmA, `A: PM reads the standing ${s.label}`, 'GET', `${R.route}/${R.standingId}`) : null;
      const recs = [...records, ...(single && single.status === 200 && single.body?.data ? [single.body.data] : [])];
      const found = records.some((r) => r?.id === R.standingId) && (!s.single || (single?.status === 200 && single.body?.data?.id === R.standingId));
      const revs = recs.flatMap((r) => listOf(r?.revisions));
      const person = [list, single].some((res) => res && res.status === 200 && personOfB(res.body?.data));
      const leaked = [...new Set([list, single].flatMap((res) => (res && res.status === 200 ? leakIn(json(res.body?.data, 1e9)) : [])))];
      echoes += revs.filter((r) => r?.issuedBy === B).length;
      const meta = revs.some(metaOfB);
      anyPerson = anyPerson || person;
      anyMeta = anyMeta || meta;
      anyLeak = [...new Set([...anyLeak, ...leaked])];
      detail[s.key] = { list: said(list), single: single ? said(single) : null, records: records.length, found, issuedByEchoes: revs.filter((r) => r?.issuedBy === B).length, person, meta, leaked };
    }
    // The doc-control RFI, by its own single GET.
    const dcGet = await ask(pmA, 'A: PM reads the doc-control RFI', 'GET', `${ctx.rev.rfi.route}/${ctx.dc.rfiId}`);
    const dcRevs = dcGet.status === 200 ? listOf(dcGet.body?.data?.revisions) : [];
    const dcPerson = dcGet.status === 200 && personOfB(dcGet.body?.data);
    const dcLeak = dcGet.status === 200 ? leakIn(json(dcGet.body?.data, 1e9)) : [];
    echoes += dcRevs.filter((r) => r?.issuedBy === B).length;
    detail.dc = { get: said(dcGet), issuedByEchoes: dcRevs.filter((r) => r?.issuedBy === B).length, person: dcPerson, found: dcGet.status === 200 && dcGet.body?.data?.id === ctx.dc.rfiId, leaked: dcLeak };
    obs.reads['R.iss.detail'] = { ...detail, totalIssuedByEchoes: echoes };
    const allFound = SURFACES.every((s) => detail[s.key].found) && detail.dc.found;
    check('R.iss.detail',
      allFound && !anyPerson && !dcPerson && !anyMeta && anyLeak.length === 0 && dcLeak.length === 0,
      `${anyPerson || dcPerson || anyMeta || anyLeak.length || dcLeak.length ? `P0 OPEN (B's person or B's document metadata on A's records): person ${anyPerson || dcPerson}, meta ${anyMeta}, leaked ${[...anyLeak, ...dcLeak].join('+') || 'none'}. ` : ''}${allFound ? 'every standing record found' : 'NOT all standing records found'}; issuedBy raw-id echoes of B ${echoes} (A's own input, not judged); ${json(detail, 1200)}`);

    // R.iss.register.
    const register = await ask(pmA, 'A: PM reads the document register', 'GET', `${PA}/doc-control/register`);
    const regRows = register.status === 200 ? rowsOf(register.body?.data) : [];
    const regRefs = regRows.flatMap((row) => [...listOf(row?.revisions), ...(row?.latestRevision ? [row.latestRevision] : [])]);
    const regPerson = register.status === 200 && personOfB(register.body?.data);
    const regLeak = register.status === 200 ? leakIn(json(register.body?.data, 1e9)) : [];
    const regMeta = regRefs.some(metaOfB);
    obs.reads['R.iss.register'] = { said: said(register), rows: regRows.length, issuedByEchoes: regRefs.filter((r) => r?.issuedBy === B).length, person: regPerson, meta: regMeta, leaked: regLeak };
    check('R.iss.register', register.status === 200 && regRows.length > 0 && !regPerson && !regMeta && regLeak.length === 0,
      `${regPerson || regMeta || regLeak.length ? 'P0 OPEN (B\'s person or metadata in A\'s register). ' : ''}register ${said(register)}, ${regRows.length} row(s), issuedBy echoes ${obs.reads['R.iss.register'].issuedByEchoes}`);

    // R.iss.audit.
    const audit = {};
    const standing = [
      ...SURFACES.map((s) => [`iss.${s.key}`, s.recordType, ctx.rev[s.key].standingId]),
      ['iss.dc', 'rfi', ctx.dc.rfiId],
    ];
    for (const [key, entityType, entityId] of standing) {
      const res = await ask(pmA, `A: PM reads the ${key} audit history`, 'GET', `${PA}/audit?entityType=${entityType}&entityId=${entityId}&limit=100`);
      const events = rowsOf(res.body?.data);
      audit[key] = { said: said(res), events: events.length, person: personOfB(events), leaked: leakIn(json(events, 1e9)) };
    }
    obs.reads['R.iss.audit'] = audit;
    const auditBad = Object.entries(audit).filter(([, a]) => a.said !== '200' || a.events === 0 || a.person || a.leaked.length);
    check('R.iss.audit', auditBad.length === 0,
      `${auditBad.some(([, a]) => a.person || a.leaked.length) ? 'P0 OPEN (B\'s person or metadata in A\'s audit history). ' : ''}${Object.entries(audit).map(([k, a]) => `${k} ${a.said} ${a.events} event(s)${a.person ? ' B person' : ''}${a.leaked.length ? ` leaked ${a.leaked.join('+')}` : ''}`).join('; ')}`);

    // R.iss.export: the RFI PDFs.
    const exports = [
      ['RFI PDF of the standing RFI', `${ctx.rev.rfi.route}/${ctx.rev.rfi.standingId}/export.pdf`],
      ['RFI PDF of the doc-control RFI', `${ctx.rev.rfi.route}/${ctx.dc.rfiId}/export.pdf`],
    ];
    const exported = [];
    for (const [label, r] of exports) {
      const res = await ask(pmA, `A: ${label}`, 'GET', r, undefined, { binary: true });
      exported.push({ label, said: said(res), bytes: res.buffer ? res.buffer.length : null, leaked: leakIn(textOf(res)) });
    }
    obs.reads['R.iss.export'] = exported;
    check('R.iss.export', exported.every((x) => x.said === '200' && x.leaked.length === 0),
      `${exported.some((x) => x.leaked.length) ? 'P0 OPEN (B\'s bytes or person in A\'s export). ' : ''}${exported.map((x) => `${x.label} -> ${x.said}${x.bytes !== null ? ` (${x.bytes} bytes)` : ''}, leaked ${x.leaked.join('+') || 'none'}`).join('; ')}`);

    // R.cp.profile.
    const profile = await ask(pmA, 'A: PM reads the contract profile', 'GET', `${PA}/contract`);
    const profIds = profile.status === 200 ? idsOf(profile.body?.data?.documentIds) : [];
    const profPerson = profile.status === 200 && personOfB(profile.body?.data);
    const profLeak = profile.status === 200 ? leakIn(json(profile.body?.data, 1e9)) : [];
    obs.reads['R.cp.profile'] = { said: said(profile), documentIds: profIds.length, echoesDB: profIds.includes(D_B), person: profPerson, leaked: profLeak };
    check('R.cp.profile', profile.status === 200 && !profPerson && profLeak.length === 0,
      `${profPerson || profLeak.length ? 'P0 OPEN (B\'s person or metadata in A\'s contract profile). ' : ''}profile ${said(profile)}, ${profIds.length} documentId(s), echoes D_B ${profIds.includes(D_B)} (A's own input, not judged)`);

    // R.cp.extract: reads A's own text; D_B unavailable by its id only.
    const extract = await ask(pmA, 'A: PM runs contract extraction', 'POST', `${PA}/contract/extract`, {});
    const extractText = json(extract.body, 1e9);
    const extractLeak = leakIn(extractText);
    const extractPerson = extract.status === 200 && personOfB(extract.body?.data);
    const dbEcho = extractText.includes(D_B);
    const okStatus = extract.status === 200 || extract.status === 409;
    obs.reads['R.cp.extract'] = { said: said(extract), okStatus, echoesDB: dbEcho, person: extractPerson, leaked: extractLeak, documents: extract.status === 200 ? listOf(extract.body?.data?.documents).map((d) => ({ id: d?.id, status: d?.status, readable: d?.readable })) : null };
    check('R.cp.extract', okStatus && !extractPerson && extractLeak.length === 0,
      `${extractLeak.length || extractPerson ? `P0 OPEN (B's text, file name or person in A's extraction): leaked ${extractLeak.join('+') || 'none'}${extractPerson ? ', B person' : ''}. ` : ''}extract ${said(extract)}; D_B echoed as a raw id ${dbEcho} (not judged); ${json(obs.reads['R.cp.extract'].documents, 500)}`);

    // R.cp.notices.
    const notices = await ask(pmA, 'A: PM reads the notice monitor', 'GET', `${PA}/contract/notices`);
    const notPerson = notices.status === 200 && personOfB(notices.body?.data);
    const notLeak = notices.status === 200 ? leakIn(json(notices.body?.data, 1e9)) : [];
    obs.reads['R.cp.notices'] = { said: said(notices), person: notPerson, leaked: notLeak };
    check('R.cp.notices', notices.status === 200 && !notPerson && notLeak.length === 0,
      `${notPerson || notLeak.length ? 'P0 OPEN (B\'s person or metadata in A\'s notice monitor). ' : ''}notices ${said(notices)}`);

    // R.cp.download: D_B's bytes/text unreachable from A.
    const refusedReads = async (id, requests) => {
      const seen = [];
      for (const [label, route] of requests) {
        const res = await ask(pmA, `A: ${label}`, 'GET', route, undefined, { binary: true });
        seen.push({ label, said: said(res), served: res.status < 400, leaked: leakIn(textOf(res)) });
      }
      obs.reads[id] = seen;
      const open = seen.filter((x) => x.served || x.leaked.length);
      check(id, open.length === 0,
        `${open.length ? `P0 OPEN (cross-tenant read of B's document): ${open.map((x) => `${x.label} ${x.said}${x.leaked.length ? ` leaked ${x.leaked.join('+')}` : ''}`).join('; ')}. ` : ''}${seen.map((x) => `${x.label} -> ${x.said}`).join('; ')}`);
    };
    await refusedReads('R.cp.download', [
      ['GET PA1 /attachments/documents/D_B', `${PA}/attachments/documents/${D_B}`],
      ['GET PA1 /workflow/uploads/D_B', `${PA}/workflow/uploads/${D_B}`],
      ['GET PA1 /documents/D_B/text', `${PA}/documents/${D_B}/text`],
      ['GET PB /attachments/documents/D_B', `${PB}/attachments/documents/${D_B}`],
      ['GET PB /documents/D_B/text', `${PB}/documents/${D_B}/text`],
    ]);

    // R.cp.search: the canary finds nothing of B for A.
    const Q = encodeURIComponent(CANARY);
    const searchReqs = [
      ['PA1 document search for the canary', `${PA}/documents/search?q=${Q}`],
      ['global search (documents) for the canary', `/search?q=${Q}&types=document&limit=50`],
    ];
    const searchSeen = [];
    for (const [label, route] of searchReqs) {
      const res = await ask(pmA, `A: ${label}`, 'GET', route);
      const hits = res.status === 200 ? json(rowsOf(res.body?.data), 1e9) : textOf(res);
      searchSeen.push({ label, said: said(res), hits: res.status === 200 ? rowsOf(res.body?.data).length : null, leaked: [...leakIn(hits), ...(hits.includes(D_B) ? ['D_B'] : [])] });
    }
    obs.reads['R.cp.search'] = searchSeen;
    const searchOpen = searchSeen.filter((x) => x.leaked.length);
    check('R.cp.search', searchOpen.length === 0,
      `${searchOpen.length ? `P0 OPEN (B's document found by A): ${searchOpen.map((x) => `${x.label} ${x.said} ${x.leaked.join('+')}`).join('; ')}. ` : ''}${searchSeen.map((x) => `${x.label} -> ${x.said}${x.hits !== null ? `, ${x.hits} hit(s)` : ''}`).join('; ')}`);

    // R.B.unchanged and R.B.user.
    const docAfter = await docRow(D_B);
    const readAfter = await ask(pmB, 'B: PM reads D_B through /attachments/documents', 'GET', `${PB}/attachments/documents/${D_B}`, undefined, { binary: true });
    const FIELDS = ['orgId', 'projectId', 'status', 'linkedEntityType', 'linkedEntityId'];
    const changed = FIELDS.filter((k) => (docAfter?.[k] ?? null) !== (docB[k] ?? null));
    obs.docBAfter = docAfter && Object.fromEntries(FIELDS.map((k) => [k, docAfter[k]]));
    check('R.B.unchanged',
      Boolean(docAfter) && changed.length === 0 && docAfter.status === 'available' && !docAfter.linkedEntityType && !docAfter.linkedEntityId
        && readAfter.status === 200 && textOf(readAfter).includes(CANARY),
      `D_B after: ${json(obs.docBAfter)}${changed.length ? ` CHANGED ${changed.join(', ')}` : ' (unchanged)'}; B reads it ${said(readAfter)} canary ${textOf(readAfter).includes(CANARY)}`);

    const userAfter = (await q('select id, name, email, "orgId" from "User" where id = $1', [ctx.bUser.id]))[0] || null;
    const membershipsAfter = await q('select "orgId", role, status from "OrganizationMembership" where "userId" = $1 order by "orgId", role, status', [ctx.bUser.id]);
    const userSame = Boolean(userAfter) && userAfter.email === ctx.bUser.email && userAfter.name === ctx.bUser.name && userAfter.orgId === ctx.bUser.orgId;
    const membershipsSame = json(membershipsAfter, 1e6) === json(ctx.bUser.memberships, 1e6);
    const inA = membershipsAfter.some((m) => m.orgId === orgA.id);
    obs.bUserAfter = { userSame, membershipsSame, inA, memberships: membershipsAfter };
    check('R.B.user', userSame && membershipsSame && !inA,
      `B's PM: user row ${userSame ? 'unchanged' : 'CHANGED'}; memberships ${membershipsSame ? 'unchanged' : 'CHANGED'}; ${inA ? 'NOW A MEMBER OF A' : 'none in A'}`);
  });
};

/** The per-unit and per-suspect classification (observation; the harness classifies the 23 defect checks as a whole beside it). */
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
  return {
    rule: CLASSIFICATION_RULE,
    bySuspect: { [DEFECT_ISS]: overallOf(DEFECT_ISS), [DEFECT_CP]: overallOf(DEFECT_CP) },
    perUnit,
    labelGuardFailed: verdict.get('ISS.label') === false,
    oracles: failedIds.filter((id) => id.startsWith('C.')),
    openReadsP0: failedIds.filter((id) => id.startsWith('R.') && !id.startsWith('R.B.')),
    foreignStateChanged: failedIds.filter((id) => id.startsWith('R.B.')),
    headExpectation: {
      fail: HEAD_FAILS.length,
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
    // What the product lets A's PM clear: the contract profile's documentIds (the profile row itself cannot be deleted).
    try {
      const res = await ask(pmA, 'cleanup: contract documentIds cleared', 'PUT', `${`/projects/${ctx.projectA}`}/contract`, { documentIds: [] });
      notes.push(`contract documentIds cleared ${said(res)}`);
    } catch (error) {
      notes.push(`contract documentIds not cleared: ${error.message}`);
    }
    // What of PA1 still names D_B or B's user: the census residue (a revision cannot be removed through the product).
    const residue = {};
    if (q) {
      const needles = [['D_B', ctx.D_B], ['bUser', ctx.bUser?.id]].filter(([, v]) => v);
      const tables = ['DocumentRevision', 'ContractProfile', 'WorkflowAttachment', 'AuditEvent', 'ProjectDocument', ...SURFACES.map((s) => s.table)];
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
    notes.push(`rows of PA1 still naming D_B or B's user ${json(residue)} (a stored revision cannot be removed through the product; the contract profile row persists: known residue of this throwaway project)`);
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
  h.observe('xdoc1d', obs);
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
