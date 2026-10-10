'use strict';

/**
 * XDOC-1b confirm-first reproduction: on the nine workflow surfaces outside
 * the HR-X1 batch (RFI, submittal, drawing, transmittal, correspondence,
 * defect, ITP, material test, punch) a record of one company stores a
 * reference naming ANOTHER company's document (XDOC-1's write class, through
 * the shared helper syncWorkflowReferences), on create and on update, and no
 * read path resolves such a reference into that document's bytes, text or
 * metadata.
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/xdoc-1b-repro.js
 *
 * No flags. In process (CERT_INPROCESS=1, through the lock runner only) on the
 * certification database, under the CERT-3 harness (./lib/harness: fixed
 * plan, G.5xx sweep, exit 0/2/1, result file, provisional classification).
 *
 * SOURCES. The suspect: docs/certification/OCTAPM_LAUNCH_BLOCKERS.md:297
 * (registered 2026-10-10; "18 syncWorkflowReferences call sites outside the
 * HR-X1 surfaces"). The verifier's adjudication:
 * C:\Temp\octapm-cert\scratch\wp2\codex-plan-review-r2-adjudication.md
 * :41-47 (XDOC-1b; "reproduced live before Codex round 3 by xdoc-1b-repro.js,
 * modelled on xdoc-1-repro.js"), :29 (X-R2-H3 option (c): an embedded id in a
 * non-UUID key, or a product link, that does not resolve in the caller's org
 * and project is refused with the uniform not-found, no probe, no oracle).
 * The rule: codex-plan-review-adjudication.md:10 (X-H1: a reference that
 * resolves to a stored document of another organisation, by id, by storage
 * key or by a product URL, is REFUSED on every surface) and CERT-2's scale
 * (OCTAPM_LAUNCH_BLOCKERS.md:147-149: a stored reference to another company's
 * record is a cross-company write, P1; an answer carrying another company's
 * records is a cross-company read, P0). The model: xdoc-1-repro.js (XDOC-1,
 * CONFIRMED P1, LAUNCH_BLOCKERS.md:296; its HEAD result
 * C:\Temp\octapm-cert\results\cert3\xdoc-1-repro.json: 24/34, the 10 write
 * checks fail, every read holds) and the trace
 * C:\Temp\octapm-cert\scratch\wp2\xdoc1\XDOC1-TRACE.md (reads CLOSED, 19 paths).
 *
 * THE CODE AT HEAD (product f599e67). The 18 call sites, each confirmed: create
 * / update = correspondence.service.js:93 / :212, defect.service.js:92 / :187,
 * drawing.service.js:83 / :188, itp.service.js:82 / :163,
 * material-test.service.js:86 / :181, punch.service.js:441 / :508,
 * rfi.service.js:396 / :620, submittal.service.js:431 / :663,
 * transmittal.service.js:83 / :183. None passes orgId or a reader; the creates
 * pass no userId except punch (:441, the actor). syncWorkflowReferences
 * (workflow-support.service.js:614-699) normalises attachmentRefs (or
 * attachments) with normalizeAttachmentRefs (:406-424: fileUrl|url,
 * storageKey|key), hands ONLY the storage keys to assertDocumentsLinkable
 * (:666-681, keys :670), then deletes and rewrites the record's
 * WorkflowAttachment rows as sent (:682-694). assertDocumentsLinkable
 * (document-text.service.js:782-811, R29) judges only keys shaped like a UUID
 * (:783-785, UUID_KEY :726), looks them up in the record's own project
 * (:791-795) and refuses a missing one with the path's not-found (:804-805,
 * workflow FILE_NOT_FOUND :612). So, expected at HEAD on all 18 sites:
 *   - a bare foreign document id as the storage key: refused 404 FILE_NOT_FOUND
 *     (R29), nothing stored (a GUARD here, as W.ncr.storageKey was in XDOC-1);
 *   - a product URL naming the foreign document, through company B's project
 *     route or through the writer's own: stored as sent (fileUrl is never
 *     judged);
 *   - a storage key embedding the foreign id ('<id>.pdf'): stored (not a UUID,
 *     skipped at :785).
 * The routes accept attachmentRefs as an array on every create and update
 * (rfi.js:160 / :508, submittals.js:263 / :508, drawings.js:50 / :93,
 * transmittals.js:57 / :103, correspondence.js:51 / :96, defects.js:50 / :93,
 * itp.js:50 / :91, material-tests.js:49 / :92, punch.js:68 for both), mounted
 * under nestedProjectAccess (projects.js:533 defects, :532 itp, :534 punch,
 * :538-542 material-tests, :548 rfi, :549-553 submittals, :613 drawings,
 * :614-618 transmittals, :619-623 correspondence).
 *
 * WHERE. Company A = 087, company B = 088, the pair xdoc-1-repro.js used: fixed
 * codes, each required in the population (h.companies) and resolved to EXACTLY
 * ONE organisation by its certification slug (cert-<code>-%), proven by the
 * guard (assertCertOrganisation); A and B distinct. Never a first row. Every
 * write is A's PM (087) or B's PM (088) through a product route; SQL only
 * reads. Throwaway: B's PM creates PB ("CERT3 XDOC1b repro B <stamp>"), A's PM
 * creates PA1 ("CERT3 XDOC1b repro A <stamp>"); nothing else is touched.
 *
 *   setup B  B's PM creates PB, uploads a text file carrying a letters-only
 *            canary through POST /projects/PB/workflow/uploads: D_B. Its text is
 *            extracted in process (the worker's step, as xdoc-1-repro.js does);
 *            B downloads D_B and finds it by the canary in PB's document search
 *            and in the global search: the positive controls that make A's
 *            "no hit" checks mean something.
 *   setup A  A's PM creates PA1, uploads nine text files in one request (one
 *            per surface, each linked from nowhere: a create that passes no
 *            writer may name only such a file, document-text.service.js:807-808)
 *            and creates one STANDING record per surface with no reference.
 *
 * THE WRITES (per surface s; every reference carries a fileName):
 *   W.s.own       control: a create naming A's own fresh upload by storage key
 *                 and by its PA1 product URL answers 201 and stores both; the
 *                 standing record PATCHed with the same two answers 200 and
 *                 stores both (a fix that refuses everything fails here).
 *   W.s.create.V  POST a new record whose attachmentRefs is the one variant V;
 *   W.s.update.V  PATCH the standing record's attachmentRefs alone, after
 *                 clearing them (PATCH [] proven empty in the database; a failed
 *                 clear is a setup error);
 *     V = storageKey  [{fileName, storageKey: D_B}]                       GUARD   HEAD PASS: 404 FILE_NOT_FOUND (R29)
 *         urlPB       [{fileName, fileUrl: /api/v1/projects/PB/workflow/uploads/D_B}]   DEFECT  HEAD FAIL: stored
 *         urlPA1      [{fileName, fileUrl: /api/v1/projects/PA1/workflow/uploads/D_B}]  DEFECT  HEAD FAIL: stored
 *         legacyKey   [{fileName, storageKey: D_B + '.pdf'}]              DEFECT  HEAD FAIL: stored
 *     The fixed expectation of each: refused with a 4xx, nothing naming D_B
 *     stored (WorkflowAttachment rows, read-back refs), on a create no record
 *     left behind (the record count of the surface's table unchanged), on an
 *     update the record still there. "Naming D_B" = D_B's id or its internal
 *     storage key inside documentId, projectDocumentId, storageKey, fileUrl or
 *     projectDocument.id.
 *   C.s.random    control (no oracle): the same eight writes (create and update
 *                 x four variants) with a random id that exists nowhere (and a
 *                 random project id for the foreign route) answer exactly what
 *                 the foreign writes answered (status and code) and are stored
 *                 exactly when they were (X-R2-H3 (c): the uniform not-found;
 *                 R29's documented answer for a key naming no document of the
 *                 project, document-text.service.js:777-780). HEAD: equal.
 *   read stage    the standing record of each surface is given the three forms
 *                 HEAD stores (urlPB, urlPA1, legacyKey) at once, so the reads
 *                 are judged against stored foreign references (observed; a
 *                 fixed product refuses them and the reads still hold).
 *
 * THE READS (as A's PM, the broadest reader of A; any answer below 400, or any
 * of B's bytes or metadata (the canary, B's originalName, B's sha256) in an
 * answer, is OPEN: P0 class, labelled in the detail):
 *   R.dl.ownRoute      GET PA1 /workflow/uploads/D_B and /<D_B's internal key>   HEAD 404 FILE_NOT_FOUND
 *   R.dl.foreignRoute  GET PB /workflow/uploads/D_B                              HEAD 404 (project access)
 *   R.dl.legacy        GET PA1 /workflow/uploads/D_B.pdf (the legacy local path)  HEAD 404
 *   R.att / R.site / R.text   /attachments/documents, /site-reporting/uploads,
 *                      /documents/D_B/text on PA1 and PB                         HEAD 404
 *   R.search.project / R.search.global   the canary: no hit naming D_B          HEAD PASS
 *   R.detail.s         the surface's list (and its single GET: RFI, submittal,
 *                      punch): no metadata of D_B on any ref, no leak; refs echo
 *                      only what A sent (attachWorkflowDetailsToRecords,
 *                      workflow-support.service.js:976-979, :1118-1123)         HEAD PASS
 *   R.audit            each standing record's audit history (200, events > 0):
 *                      no metadata of D_B (audit.service.js:794-887, workflow
 *                      rows serialised raw :774-792, :845-851)                  HEAD PASS
 *   R.register         GET PA1 /doc-control/register: attachments echoed only
 *                      (doc-control.service.js:249, :280)                        HEAD PASS
 *   R.export           GET PA1 /rfi/<standing>/export.pdf (lists fileName and
 *                      role only, rfi-workflow.service.js:515-525) and
 *                      /punch/export.csv?kind=all: 200, none of B's bytes        HEAD PASS
 *   R.B.unchanged      as B: D_B's orgId / projectId / status / linkedEntityType /
 *                      linkedEntityId unchanged; B still reads it (200, canary)  HEAD PASS
 *   G.5xx              the harness's own: no answer was a 5xx (cleanup included)
 *
 * THE CHECKS (fixed before the first run): 2 setup + 9 x (W.own, 4 create, 4
 * update, C.random, R.detail) + 12 reads = 113 in the plan, + G.5xx = 114
 * (EXPECTED_CHECKS). Kinds: 2 setup, 54 defect (urlPB, urlPA1, legacyKey x
 * create/update x 9), 36 guard (W.own x 9, storageKey x 18, C.random x 9),
 * 21 check (reads) + the harness's G.5xx guard.
 *
 * EXPECTED AT HEAD (114e9f1 = product f599e67): 114 recorded, 54 FAIL (exactly
 * the defect checks), exit 2, DEFECT_PRESENT, harness classification CONFIRMED
 * (54 of 54); per surface CONFIRMED x 9; no open read. On a tree where the
 * judge sits in syncWorkflowReferences (r2 adjudication :46): exit 0, PASS,
 * REJECTED x 9.
 *
 * CLASSIFICATION (observation 'classification', computed in cleanup; the
 * harness's own over the 54 defect checks beside it). Per surface s, over its
 * six defect checks D(s) = W.s.{create,update}.{urlPB,urlPA1,legacyKey}:
 *   UNDETERMINED  a setup error, s's section threw, a check of D(s) was not
 *                 run, or W.s.own failed (a surface that refuses its own
 *                 document proves nothing by refusing B's);
 *   CONFIRMED     all six failed (stored in every form, on create and update);
 *   REJECTED      none failed;
 *   PARTIAL       some failed (listed: e.g. only the URL forms, or only update).
 * Overall: CONFIRMED / REJECTED when every surface is; UNDETERMINED when none
 * is determined; PARTIAL otherwise, with the per-surface list. Beside it, never
 * folded in: a failed storageKey guard (the bare foreign id stored too: an R29
 * bypass on that path, its own P1), a failed C.s.random (an existence oracle
 * across companies), and any failed R.* (an open cross-tenant read, P0 class).
 * Owner questions that touch this design (r2 adjudication :39 O10 extended,
 * :59 O13): both concern references ALREADY stored, never a new write; every
 * write here is preceded by a clear and no foreign reference survives into the
 * next write, so both branches (the unscoped stored probe as a documented
 * exception, or refusing every stored unresolved name) expect the same answers
 * and the same classification. Nothing here decides HR-P2..P5, HR-Q2..Q5 or
 * HR-S9; no check reads them.
 *
 * CLEANUP (always, whatever happened): every record the run made on PA1 has its
 * references cleared (PATCH attachmentRefs: [] by A's PM), the rows of PA1 that
 * still name D_B are counted per table (observation residue; at HEAD the
 * status/audit history keeps the echo), then PA1 is archived by A's PM and PB
 * by B's PM (DELETE /projects/:id, archivedAt read back). No other project is
 * touched.
 *
 * SEEN IN PASSING (not checked here; leads for the integration owner). The same
 * class reaches these records through doors that are NOT syncWorkflowReferences,
 * so a judge moved into that helper alone leaves them open:
 *  - revisions filed by a record's own create or update (RFI, submittal,
 *    drawing, transmittal, correspondence; the routes accept `revisions`, e.g.
 *    rfi.js:161): normalizeRevisionRefs takes revisions[].fileUrl and
 *    storageKey|key (workflow-support.service.js:455-461) and the record
 *    entry's fileUrl (:488); recordDocumentRevisions judges only the UUID keys
 *    (:799-805, document-text.service.js:785) and stores the rest (:807-815);
 *  - DrawingRecord.fileUrl (drawing.service.js:80, :182-185), copied into the
 *    drawing's revision (:488), and Transmittal.documentsJson
 *    (transmittal.service.js:79, :173-176), both stored as sent.
 * Spellings: normalizeAttachmentRefs also reads `url` and `key` (:412-413) and
 * syncWorkflowReferences reads `attachments` when `attachmentRefs` is absent
 * (:626-628). The checks send the canonical spellings: a judge placed after the
 * normalisation is caught for every spelling; one placed in a route is not
 * proven for the aliases.
 *
 * Exit 0 every check holds (the fixed behaviour), 2 a check failed (the defect
 * present), 1 setup error (harness rules). Results:
 * C:\Temp\octapm-cert\results\cert3\xdoc-1b-repro.json.
 *
 * DRAFT (read-only preparation, 2026-10-10): never run against the product by
 * its author. Checked without a database or an API: node --check;
 * registration-check.js (the real harness registers exactly these 114 checks)
 * and fake-run.js (main and cleanup end to end against an in-memory model of
 * the routes and SQL used, under HEAD, fixed and partial behaviours), both in
 * C:\Temp\octapm-cert\scratch\wp2\xdoc1b\. Claude Main installs it as
 * backend/scripts/cert/cert3/xdoc-1b-repro.js.
 */

const harness = require('./lib/harness');

// FIRST: the in-process app on the certification database, machinery off.
harness.prepareInProcess();

const crypto = require('crypto');
const api = require('../lib/api');
const certEnv = require('../lib/cert-env');

const NAME = 'xdoc-1b-repro';
const COMPANY_A = '087';
const COMPANY_B = '088';
const DEFECT = 'XDOC-1b';
const STAMP = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${crypto.randomBytes(2).toString('hex')}`;
/** Letters only: one token for the full-text parser, so a search finds it whole. */
const CANARY = `xdocbcanary${Array.from(crypto.randomBytes(16), (b) => String.fromCharCode(97 + (b % 26))).join('')}`;
const PROJECT_A = `CERT3 XDOC1b repro A ${STAMP}`;
const PROJECT_B = `CERT3 XDOC1b repro B ${STAMP}`;
const START = '2026-01-05';
const END = '2026-12-31';
const B_FILE = `xdoc1b-b-private-evidence-${STAMP}.txt`;
const B_TEXT = `XDOC-1b reproduction ${STAMP}: company B's private evidence. ${CANARY}\nOnly company B may read this file; its canary is ${CANARY}.\n`;

let seq = 0;
const next = () => {
  seq += 1;
  return seq;
};

/**
 * The nine surfaces. sites: the two syncWorkflowReferences call sites
 * (backend/src/services/<file>). single: the module has a single-record GET.
 * body(tag): the smallest valid create body (the route's required fields).
 * listQuery: RFI and submittal lists page at 25 by default (utils/list-query.js
 * DEFAULT_LIMIT); the detail read asks for 100 (rfi.js:92, submittals.js:84).
 */
const SURFACES = Object.freeze([
  { key: 'rfi', label: 'RFI', recordType: 'rfi', table: 'Rfi', base: 'rfi', single: true, listQuery: '?limit=100', sites: ['rfi.service.js:396', 'rfi.service.js:620'], routes: 'routes/rfi.js:139-188, :487-537',
    // No status: the service defaults a new RFI to 'open' and refuses a sent status without transition rights
    // (rfi.service.js:348, :377; debug run 1: 409 APPROVAL_WORKFLOW_INVALID_TRANSITION for 'draft').
    body: (tag) => ({ subject: `XDOC-1b repro RFI ${tag}`, question: `XDOC-1b reproduction ${tag}` }) },
  { key: 'submittal', label: 'submittal', recordType: 'submittal', table: 'Submittal', base: 'submittals', single: true, listQuery: '?limit=100', sites: ['submittal.service.js:431', 'submittal.service.js:663'], routes: 'routes/submittals.js:241-288, :486-534',
    body: (tag) => ({ title: `XDOC-1b repro submittal ${tag}` }) },
  { key: 'drawing', label: 'drawing', recordType: 'drawing', table: 'DrawingRecord', base: 'drawings', single: false, sites: ['drawing.service.js:83', 'drawing.service.js:188'], routes: 'routes/drawings.js:33-75, :77-119',
    body: (tag) => ({ drawingNumber: `X1B-${STAMP}-${next()}`, title: `XDOC-1b repro drawing ${tag}` }) },
  { key: 'transmittal', label: 'transmittal', recordType: 'transmittal', table: 'Transmittal', base: 'transmittals', single: false, sites: ['transmittal.service.js:83', 'transmittal.service.js:183'], routes: 'routes/transmittals.js:33-77, :79-124',
    body: (tag) => ({ subject: `XDOC-1b repro transmittal ${tag}`, sender: 'XDOC-1b repro', recipient: 'XDOC-1b repro' }) },
  { key: 'correspondence', label: 'correspondence', recordType: 'correspondence', table: 'Correspondence', base: 'correspondence', single: false, sites: ['correspondence.service.js:93', 'correspondence.service.js:212'], routes: 'routes/correspondence.js:33-76, :78-122',
    body: (tag) => ({ direction: 'outgoing', type: 'letter', subject: `XDOC-1b repro letter ${tag}` }) },
  { key: 'defect', label: 'defect', recordType: 'defect', table: 'DefectRecord', base: 'defects', single: false, sites: ['defect.service.js:92', 'defect.service.js:187'], routes: 'routes/defects.js:33-74, :76-119',
    body: (tag) => ({ title: `XDOC-1b repro defect ${tag}` }) },
  { key: 'itp', label: 'ITP', recordType: 'itp', table: 'ItpRecord', base: 'itp', single: false, sites: ['itp.service.js:82', 'itp.service.js:163'], routes: 'routes/itp.js:33-72, :74-114',
    body: (tag) => ({ title: `XDOC-1b repro ITP ${tag}` }) },
  { key: 'mtest', label: 'material test', recordType: 'material_test', table: 'MaterialTest', base: 'material-tests', single: false, sites: ['material-test.service.js:86', 'material-test.service.js:181'], routes: 'routes/material-tests.js:33-74, :76-118',
    body: (tag) => ({ testType: `XDOC-1b repro test ${tag}` }) },
  { key: 'punch', label: 'punch item', recordType: 'punch_item', table: 'PunchItem', base: 'punch', single: true, sites: ['punch.service.js:441', 'punch.service.js:508'], routes: 'routes/punch.js:166-179, :250-264',
    body: (tag) => ({ title: `XDOC-1b repro punch ${tag}` }) },
]);
const OPS = Object.freeze(['create', 'update']);
/** [variant, kind, what]: the bare id is R29's (a guard); the three others are the suspect's class. */
const VARIANTS = Object.freeze([
  ['storageKey', 'guard', 'the foreign document id as the storage key [{fileName, storageKey: D_B}]', 'HEAD PASS: 404 FILE_NOT_FOUND (R29), nothing stored'],
  ['urlPB', 'defect', 'a product URL through B\'s project route [{fileName, fileUrl: /api/v1/projects/<PB>/workflow/uploads/<D_B>}]', 'HEAD FAIL: stored as sent'],
  ['urlPA1', 'defect', 'a product URL through the writer\'s own route naming the foreign id [{fileName, fileUrl: /api/v1/projects/<PA1>/workflow/uploads/<D_B>}]', 'HEAD FAIL: stored as sent'],
  ['legacyKey', 'defect', 'a storage key embedding the foreign id [{fileName, storageKey: <D_B>.pdf}] (not a UUID: skipped by R29)', 'HEAD FAIL: stored as sent'],
]);

const ADJ1 = 'C:/Temp/octapm-cert/scratch/wp2/codex-plan-review-adjudication.md';
const ADJ2 = 'C:/Temp/octapm-cert/scratch/wp2/codex-plan-review-r2-adjudication.md';
const BLOCKERS = 'docs/certification/OCTAPM_LAUNCH_BLOCKERS.md';
const RULES = Object.freeze({
  'XDOC-W': {
    status: 'decided',
    statement: 'A new reference naming another company\'s stored document - by its id or storage key, by a product URL through either company\'s project route, or by a storage key embedding its id - is refused (4xx) and nothing naming it is stored; a stored reference to another company\'s record is a cross-company write (P1).',
    sources: [`${BLOCKERS}:147-149`, `${BLOCKERS}:296 (XDOC-1 CONFIRMED P1)`, `${ADJ1}:10 (X-H1)`, `${ADJ2}:29 (X-R2-H3 option (c))`, `${ADJ2}:41-47 (XDOC-1b)`],
  },
  R29: {
    status: 'decided',
    statement: 'A UUID storage key on a workflow record that names no document of the record\'s project is refused with the path\'s not-found (404 FILE_NOT_FOUND); the writer\'s own fresh upload, linked from nowhere, is theirs to link.',
    sources: ['backend/src/services/document-text.service.js:759-811', 'backend/src/services/workflow-support.service.js:612, :659-681'],
  },
  'XDOC-U': {
    status: 'decided',
    statement: 'A reference that resolves to no document in the caller\'s org and project gets the same answer whether its id is another company\'s or exists nowhere (uniform not-found, no probe, no oracle).',
    sources: [`${ADJ2}:29 (X-R2-H3 option (c))`, 'backend/src/services/document-text.service.js:777-780'],
  },
  'XDOC-R': {
    status: 'decided',
    statement: 'No read path resolves a stored reference into another company\'s document: no bytes, text, search hit or metadata (a cross-company read, P0).',
    sources: [`${BLOCKERS}:147-149`, 'C:/Temp/octapm-cert/scratch/wp2/xdoc1/XDOC1-TRACE.md (19 paths CLOSED)'],
  },
});

// ── the plan (fixed) ─────────────────────────────────────────────────────────
const defectIdsOf = (s) => OPS.flatMap((op) => VARIANTS.filter((v) => v[1] === 'defect').map(([v]) => `W.${s.key}.${op}.${v}`));
const PLAN = [
  ['S.B', 'setup B (088): PM creates PB, uploads a text file with the canary through /workflow/uploads (201; D_B available, unlinked, in B\'s org and PB); its text extracted in process (ready); B downloads it (200, canary) and finds it by the canary in PB\'s document search and in the global search (positive controls)', { setup: true }],
  ['S.A', 'setup A (087): PM creates PA1, uploads nine own text files in one request (201; each available, unlinked, in PA1) and creates one standing record per surface (201) with no reference (0 WorkflowAttachment rows)', { setup: true }],
  ...SURFACES.flatMap((s) => [
    [`W.${s.key}.own`, `control: A's own fresh PA1 upload, by storage key and by its PA1 product URL, accepted and stored on the ${s.label}: create 201 (2 rows naming it), standing record PATCH 200 (2 rows naming it)`, { guard: true, rule: 'R29' }],
    ...OPS.flatMap((op) => VARIANTS.map(([v, kind, what, head]) => [
      `W.${s.key}.${op}.${v}`,
      `${s.label} ${op === 'create' ? 'POST (a new record)' : 'PATCH (the standing record, cleared first)'} with ${what}: refused (4xx), nothing naming D_B stored${op === 'create' ? ', no record left' : ', record still there'} [${head}; ${s.sites[op === 'create' ? 0 : 1]}]`,
      kind === 'defect' ? { defect: DEFECT, rule: 'XDOC-W' } : { guard: true, rule: 'R29' },
    ])),
    [`C.${s.key}.random`, `control (no oracle): on the ${s.label}, the eight writes repeated with an id that exists nowhere (and a random project for the foreign route) answer exactly as the foreign writes did (status and code) and are stored exactly when they were (HEAD: equal)`, { guard: true, rule: 'XDOC-U' }],
  ]),
  ['R.dl.ownRoute', 'A: GET /projects/PA1/workflow/uploads/D_B and /<D_B\'s internal storageKey>: refused (HEAD 404 FILE_NOT_FOUND), none of B\'s bytes', { rule: 'XDOC-R' }],
  ['R.dl.foreignRoute', 'A: GET /projects/PB/workflow/uploads/D_B: refused (HEAD 404, project access), none of B\'s bytes', { rule: 'XDOC-R' }],
  ['R.dl.legacy', 'A: GET /projects/PA1/workflow/uploads/D_B.pdf (the legacy local path the <D_B>.pdf key names): refused (HEAD 404), none of B\'s bytes', { rule: 'XDOC-R' }],
  ['R.att', 'A: GET /projects/PA1/attachments/documents/D_B and /projects/PB/...: refused (HEAD 404), none of B\'s bytes', { rule: 'XDOC-R' }],
  ['R.site', 'A: GET /projects/PA1/site-reporting/uploads/D_B and /projects/PB/...: refused (HEAD 404), none of B\'s bytes', { rule: 'XDOC-R' }],
  ['R.text', 'A: GET /projects/PA1/documents/D_B/text and /projects/PB/...: refused (HEAD 404), no text', { rule: 'XDOC-R' }],
  ['R.search.project', 'A: GET /projects/PA1/documents/search?q=<canary> (and on PB): no hit naming D_B, the canary or B\'s file', { rule: 'XDOC-R' }],
  ['R.search.global', 'A: GET /search?q=<canary> (types=document; all types; projectId=PB): no hit naming D_B, the canary or B\'s file', { rule: 'XDOC-R' }],
  ...SURFACES.map((s) => [`R.detail.${s.key}`, `A: the ${s.label}s as the PM reads them (list${s.single ? ' and the standing record\'s single GET' : ''}): no projectDocument, originalName, sizeBytes or sha256 of D_B on any ref, no canary (refs echo only what A sent)`, { rule: 'XDOC-R' }]),
  ['R.audit', 'A: each standing record\'s audit history (200, events present): no metadata of D_B, no canary', { rule: 'XDOC-R' }],
  ['R.register', 'A: GET /projects/PA1/doc-control/register (200): no metadata of D_B on any attachment or revision, no canary', { rule: 'XDOC-R' }],
  ['R.export', 'A: GET /projects/PA1/rfi/<standing RFI>/export.pdf and /punch/export.csv?kind=all (200 each): none of B\'s bytes or metadata', { rule: 'XDOC-R' }],
  ['R.B.unchanged', 'B: D_B\'s orgId, projectId, status, linkedEntityType and linkedEntityId unchanged (available, unlinked) and B still reads it through /attachments/documents (200, canary)', { rule: 'XDOC-R' }],
];
/** Fixed before the first run: 113 in the plan + the harness's G.5xx. */
const EXPECTED_CHECKS = 114;
if (PLAN.length + 1 !== EXPECTED_CHECKS) throw new Error(`${NAME}: the plan lists ${PLAN.length} checks + G.5xx, EXPECTED_CHECKS is ${EXPECTED_CHECKS}`);
const HEAD_FAILS = PLAN.filter((entry) => entry[2]?.defect).map((entry) => entry[0]);
if (HEAD_FAILS.length !== 54) throw new Error(`${NAME}: ${HEAD_FAILS.length} defect checks, 54 expected`);

const CLASSIFICATION_RULE = 'Per surface over its six defect checks W.s.{create,update}.{urlPB,urlPA1,legacyKey}: UNDETERMINED on a setup error, a thrown section, a check not run, or a failed W.s.own; CONFIRMED when all six fail; REJECTED when none fails; PARTIAL otherwise. Overall: CONFIRMED / REJECTED when every surface is; UNDETERMINED when none is determined; PARTIAL otherwise. Beside it, never folded in: failed storageKey guards (bare foreign id stored: R29 bypass, its own P1), failed C.s.random (an existence oracle), failed R.* (open cross-tenant read, P0 class).';

const h = harness.createHarness({
  name: NAME,
  plan: PLAN,
  rules: RULES,
  meta: {
    suspect: DEFECT,
    model: 'backend/scripts/cert/cert3/xdoc-1-repro.js (results C:/Temp/octapm-cert/results/cert3/xdoc-1-repro.json)',
    trace: 'C:/Temp/octapm-cert/scratch/wp2/xdoc1/XDOC1-TRACE.md',
    companies: { A: COMPANY_A, B: COMPANY_B, rule: 'fixed codes (the XDOC-1 pair), each in the population and exactly one organisation by slug; never a first row' },
    projects: { A: PROJECT_A, B: PROJECT_B },
    stamp: STAMP,
    expectedChecks: EXPECTED_CHECKS,
    headExpectation: { fail: HEAD_FAILS, exit: 2, verdict: 'DEFECT_PRESENT', classification: 'CONFIRMED (54 of 54), CONFIRMED on each of the nine surfaces' },
    classificationRule: CLASSIFICATION_RULE,
    callSites: Object.fromEntries(SURFACES.map((s) => [s.key, s.sites])),
  },
});

// ── small helpers ────────────────────────────────────────────────────────────
const listOf = (data) => (Array.isArray(data) ? data : []);
/** The list in an answer: a bare array, or rows / items / events. */
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
  [row?.documentId, row?.projectDocumentId, row?.storageKey, row?.fileUrl, row?.projectDocument?.id]
    .some((v) => typeof v === 'string' && keys.some((k) => k && v.includes(k)));
/** A record's references as read back: attachmentRefs, attachments (the same list twice) and revisions, each once. */
const refsOf = (rec) => {
  if (!rec) return [];
  const seen = new Set();
  return [...listOf(rec.attachmentRefs), ...listOf(rec.attachments), ...listOf(rec.revisions)].filter((r) => {
    const k = json(r, 100000);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

// ── run state (shared with cleanup) ─────────────────────────────────────────
const ctx = { db: null, q: null, pmA: null, pmB: null, projectA: null, projectB: null, D_B: null, docB: null, run: {} };
const verdict = new Map();
const failedSections = new Set();
let mainError = null;
const obs = { writes: {}, random: {}, readStage: {}, reads: {}, own: {} };

/** The only verdict: the harness's check, remembered here for the per-surface classification. */
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
  obs.companies = { A: { code: COMPANY_A, orgId: orgA.id, slug: orgA.slug, populationSlug: companyA.slug }, B: { code: COMPANY_B, orgId: orgB.id, slug: orgB.slug, populationSlug: companyB.slug } };
  const pmA = api.as({ email: `pm@${companyA.domain}`, orgId: orgA.id });
  const pmB = api.as({ email: `pm@${companyB.domain}`, orgId: orgB.id });
  ctx.pmA = pmA;
  ctx.pmB = pmB;
  console.log(`${NAME}: A ${COMPANY_A} ${orgA.name} (${orgA.id}); B ${COMPANY_B} ${orgB.name} (${orgB.id}); stamp ${STAMP}; in process`);

  const docRow = async (id) =>
    (await q('select id, "orgId", "projectId", "documentType", "originalName", "sizeBytes", sha256, "storageKey", status, "linkedEntityType", "linkedEntityId" from "ProjectDocument" where id = $1', [id]))[0] || null;
  /** One upload request carrying these files (the route takes up to ten, workflow-uploads.js:78). */
  const upload = async (who, label, projectRoute, files) => {
    const form = new FormData();
    for (const f of files) form.append('files', new Blob([Buffer.from(f.text, 'utf8')], { type: 'text/plain' }), f.name);
    const res = await ask(who, label, 'POST', `${projectRoute}/workflow/uploads`, undefined, { form });
    const rows = res.status === 201 ? rowsOf(res.body?.data) : [];
    return { res, ids: rows.map((r) => r?.documentId || null).filter(Boolean) };
  };

  // ── setup B: the other company's document ─────────────────────────────────
  await h.section('setup B', async () => {
    const createdB = await ask(pmB, 'B: PM creates PB', 'POST', '/projects', { name: PROJECT_B, startDate: START, endDate: END, projectCalendar: 'five_day' });
    ctx.projectB = createdB.status === 201 ? createdB.body?.data?.id || null : null;
    const PB = `/projects/${ctx.projectB}`;
    const upB = ctx.projectB ? await upload(pmB, 'B: PM uploads the canary file to PB', PB, [{ name: B_FILE, text: B_TEXT }]) : { res: null, ids: [] };
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
  /** B's bytes or metadata in a text: the canary, B's original file name, B's sha256. */
  const leakIn = (text) => {
    const t = String(text || '').toLowerCase();
    return [['canary', CANARY], ['originalName', docB.originalName], ['sha256', docB.sha256]]
      .filter(([, v]) => v && t.includes(String(v).toLowerCase()))
      .map(([k]) => k);
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

  // ── setup A: the scratch project, its own files, one standing record per surface ──
  await h.section('setup A', async () => {
    const createdA = await ask(pmA, 'A: PM creates PA1', 'POST', '/projects', { name: PROJECT_A, startDate: START, endDate: END, projectCalendar: 'five_day' });
    ctx.projectA = createdA.status === 201 ? createdA.body?.data?.id || null : null;
    const PA = `/projects/${ctx.projectA}`;
    for (const s of SURFACES) ctx.run[s.key] = { route: `${PA}/${s.base}`, standingId: null, ids: [], own: null };
    const ownFiles = SURFACES.map((s) => ({ key: s.key, name: `xdoc1b-a-own-${s.key}-${STAMP}.txt`, text: `XDOC-1b reproduction ${STAMP}: company A's own evidence for the ${s.label}.\n` }));
    const ownUp = ctx.projectA ? await upload(pmA, 'A: PM uploads its own files (one per surface, one request)', PA, ownFiles) : { res: null, ids: [] };
    // Each own file is matched to its surface by the name the database stored, never by position alone.
    const ownOk = [];
    for (const id of ownUp.ids) {
      const row = await docRow(id);
      const file = ownFiles.find((f) => f.name === row?.originalName);
      if (file && !ctx.run[file.key].own) {
        ctx.run[file.key].own = row;
        ownOk.push(row.projectId === ctx.projectA && row.orgId === orgA.id && row.status === 'available' && !row.linkedEntityType && !row.linkedEntityId);
      }
    }
    const standing = {};
    for (const s of SURFACES) {
      if (!ctx.projectA) break;
      const res = await ask(pmA, `A: PM creates the standing ${s.label}`, 'POST', ctx.run[s.key].route, s.body(`standing ${STAMP}`));
      const id = res.status === 201 ? res.body?.data?.id || null : null;
      ctx.run[s.key].standingId = id;
      if (id) ctx.run[s.key].ids.push(id);
      const rows = id ? await q('select count(*)::int as n from "WorkflowAttachment" where "projectId" = $1 and "recordType" = $2 and "recordId" = $3', [ctx.projectA, s.recordType, id]) : [{ n: null }];
      standing[s.key] = { answer: saidLong(res), id, rows: rows[0]?.n ?? null };
    }
    obs.projectA = ctx.projectA;
    obs.projectB = ctx.projectB;
    obs.standing = standing;
    obs.ownDocuments = Object.fromEntries(SURFACES.map((s) => [s.key, ctx.run[s.key]?.own?.id || null]));
    check('S.A',
      createdA.status === 201 && Boolean(ctx.projectA)
        && ownUp.res?.status === 201 && ownUp.ids.length === SURFACES.length && ownOk.length === SURFACES.length && ownOk.every(Boolean)
        && SURFACES.every((s) => Boolean(ctx.run[s.key]?.own) && Boolean(standing[s.key]?.id) && standing[s.key].rows === 0),
      `PA1 ${said(createdA)} ${createdA.body?.error?.message || ''}; own upload ${said(ownUp.res)} (${ownUp.ids.length} id(s), ${ownOk.filter(Boolean).length} matched, available and unlinked in PA1); standing records ${json(standing, 2500)}`);
  });
  if (verdict.get('S.A') !== true) throw new Error('setup incomplete: company A');
  const PA = `/projects/${ctx.projectA}`;
  const URL_PB = `/api/v1/projects/${ctx.projectB}/workflow/uploads/${D_B}`;
  const URL_PA = `/api/v1/projects/${ctx.projectA}/workflow/uploads/${D_B}`;
  const FOREIGN = {
    storageKey: () => ({ storageKey: D_B }),
    urlPB: () => ({ fileUrl: URL_PB }),
    urlPA1: () => ({ fileUrl: URL_PA }),
    legacyKey: () => ({ storageKey: `${D_B}.pdf` }),
  };
  const RANDOM = {
    storageKey: (r) => ({ storageKey: r.doc }),
    urlPB: (r) => ({ fileUrl: `/api/v1/projects/${r.project}/workflow/uploads/${r.doc}` }),
    urlPA1: (r) => ({ fileUrl: `/api/v1/projects/${ctx.projectA}/workflow/uploads/${r.doc}` }),
    legacyKey: (r) => ({ storageKey: `${r.doc}.pdf` }),
  };
  const ref = (s, variant, extra) => ({ fileName: `xdoc1b-a-${s.key}-${variant}-${STAMP}.pdf`, ...extra });

  // ── the writes, judged in the database and through the API ────────────────
  const storedRows = async (s, id) => q(
    'select "recordId", "fileName", "fileUrl", "storageKey" from "WorkflowAttachment" where "projectId" = $1 and "recordType" = $2 and "recordId" = $3 order by "createdAt"',
    [ctx.projectA, s.recordType, id],
  );
  /** WorkflowAttachment rows of PA1 of this record type that name any of these keys. */
  const namingCount = async (s, keys) => Number((await q(
    'select count(*)::int as n from "WorkflowAttachment" where "projectId" = $1 and "recordType" = $2 and (coalesce("storageKey", \'\') like any($3::text[]) or coalesce("fileUrl", \'\') like any($3::text[]))',
    [ctx.projectA, s.recordType, keys.map((k) => `%${k}%`)],
  ))[0].n);
  const recordCount = async (s) => Number((await q(`select count(*)::int as n from "${s.table}" where "projectId" = $1`, [ctx.projectA]))[0].n);
  /** The record as the PM reads it: its single GET where the module has one, else its list. */
  const readBack = async (s, id, label) => {
    const R = ctx.run[s.key];
    const res = await ask(pmA, label, 'GET', s.single ? `${R.route}/${id}` : R.route);
    let rec = null;
    if (res.status === 200) rec = s.single ? (res.body?.data?.id === id ? res.body.data : null) : rowsOf(res.body?.data).find((r) => r?.id === id) || null;
    return { res, rec, refs: refsOf(rec) };
  };
  /** A create, judged on its own: the answer, the new record's rows, the table's record count and naming rows before and after. */
  const createWith = async (s, variant, refs, keys) => {
    const R = ctx.run[s.key];
    const before = { records: await recordCount(s), naming: await namingCount(s, keys) };
    const res = await ask(pmA, `${s.key} create ${variant}: PM POSTs a new ${s.label}`, 'POST', R.route, { ...s.body(`${variant} ${STAMP}`), attachmentRefs: refs });
    const id = res.status === 201 ? res.body?.data?.id || null : null;
    if (id) R.ids.push(id);
    const after = { records: await recordCount(s), naming: await namingCount(s, keys) };
    const rows = id ? await storedRows(s, id) : [];
    const back = id ? await readBack(s, id, `${s.key} create ${variant}: PM reads the new ${s.label} back`) : null;
    const sqlNaming = rows.filter((row) => namesAny(row, keys));
    const apiNaming = back ? back.refs.filter((r) => namesAny(r, keys)) : [];
    const stored = sqlNaming.length > 0 || apiNaming.length > 0 || after.naming > before.naming;
    return { op: 'create', res, said: saidLong(res), id, before, after, rows, back, stored, sqlNaming, apiNaming, recordLeft: after.records !== before.records };
  };
  /** Clears the standing record's references and proves it in the database; a failed clear is a setup error. */
  const reset = async (s) => {
    const R = ctx.run[s.key];
    const res = await ask(pmA, `${s.key}: PM clears the standing record's references`, 'PATCH', `${R.route}/${R.standingId}`, { attachmentRefs: [] });
    const left = await storedRows(s, R.standingId);
    if (res.status !== 200 || left.length) throw new Error(`the standing ${s.label}'s references could not be cleared before the next write (${saidLong(res)}; ${left.length} row(s) left)`);
  };
  /** An update of the standing record, judged on its own: cleared first, then sent, then read in the database and through the API. */
  const updateWith = async (s, variant, refs, keys) => {
    const R = ctx.run[s.key];
    await reset(s);
    const res = await ask(pmA, `${s.key} update ${variant}: PM PATCHes the standing ${s.label}'s references`, 'PATCH', `${R.route}/${R.standingId}`, { attachmentRefs: refs });
    const rows = await storedRows(s, R.standingId);
    const back = await readBack(s, R.standingId, `${s.key} update ${variant}: PM reads the standing ${s.label} back`);
    const sqlNaming = rows.filter((row) => namesAny(row, keys));
    const apiNaming = back.refs.filter((r) => namesAny(r, keys));
    return { op: 'update', res, said: saidLong(res), id: R.standingId, rows, back, stored: sqlNaming.length > 0 || apiNaming.length > 0, sqlNaming, apiNaming, found: Boolean(back.rec) };
  };
  const writeNote = (o, refs) => `PM ${o.op === 'create' ? 'POST' : 'PATCH'} attachmentRefs ${json(refs, 400)} -> ${o.said}; stored: ${o.stored ? `YES (${o.sqlNaming.length} row(s) ${json(o.sqlNaming, 500)}; ${o.apiNaming.length} read-back ref(s))` : 'no'}${o.op === 'create' ? `; record ${o.id || 'none'}; ${o.before.records} -> ${o.after.records} record(s) of the table in PA1` : `; read back ${said(o.back.res)}${o.found ? '' : ' (record NOT found)'}`}`;

  for (const s of SURFACES) {
    await h.section(`writes: ${s.label}`, async () => {
      const R = ctx.run[s.key];
      // W.s.own: the own fresh upload, first on a create (no writer may be named there), then on the standing record.
      const ownKeys = [R.own.id, R.own.storageKey].filter(Boolean);
      const ownRefs = (tag) => [ref(s, `${tag}-own-key`, { storageKey: R.own.id }), ref(s, `${tag}-own-url`, { fileUrl: `/api/v1/projects/${ctx.projectA}/workflow/uploads/${R.own.id}` })];
      const oc = await createWith(s, 'own', ownRefs('c'), ownKeys);
      const ou = await updateWith(s, 'own', ownRefs('u'), ownKeys);
      obs.own[s.key] = { create: { answer: oc.said, id: oc.id, rows: oc.rows.length, namingOwn: oc.sqlNaming.length }, update: { answer: ou.said, rows: ou.rows.length, namingOwn: ou.sqlNaming.length } };
      check(`W.${s.key}.own`,
        oc.res.status === 201 && Boolean(oc.id) && oc.rows.length === 2 && oc.sqlNaming.length === 2
          && ou.res.status === 200 && ou.rows.length === 2 && ou.sqlNaming.length === 2,
        `create ${oc.said} record ${oc.id || 'none'}, ${oc.rows.length} row(s), ${oc.sqlNaming.length} naming the own file; update ${ou.said}, ${ou.rows.length} row(s), ${ou.sqlNaming.length} naming it`);

      // The foreign writes, each on its own.
      const foreign = { create: {}, update: {} };
      for (const op of OPS) {
        for (const [v, kind, , head] of VARIANTS) {
          const id = `W.${s.key}.${op}.${v}`;
          const refs = [ref(s, `${op}-${v}`, FOREIGN[v]())];
          const o = op === 'create' ? await createWith(s, v, refs, B_KEYS) : await updateWith(s, v, refs, B_KEYS);
          foreign[op][v] = o;
          obs.writes[id] = { sent: refs, answer: o.said, stored: o.stored, rows: o.rows.map(({ fileName, fileUrl, storageKey }) => ({ fileName, fileUrl, storageKey })), record: o.id, ...(op === 'create' ? { recordLeft: o.recordLeft } : { found: o.found }) };
          const ok = op === 'create'
            ? is4xx(o.res) && !o.id && !o.stored && !o.recordLeft
            : is4xx(o.res) && !o.stored && o.found;
          check(id, ok, `${writeNote(o, refs)}; ${head}${o.stored && kind === 'defect' ? ' -- the XDOC-1b write gap (cross-company reference stored, P1 class)' : ''}${o.stored && kind === 'guard' ? ' -- the bare foreign id STORED: an R29 bypass on this path (P1 on its own)' : ''}`);
        }
      }

      // C.s.random: the same eight writes with ids that exist nowhere answer as the foreign ones did.
      const pairs = [];
      for (const op of OPS) {
        for (const [v] of VARIANTS) {
          const r = { doc: crypto.randomUUID(), project: crypto.randomUUID() };
          const refs = [ref(s, `${op}-${v}-random`, RANDOM[v](r))];
          const o = op === 'create' ? await createWith(s, `${v} (random)`, refs, [r.doc]) : await updateWith(s, `${v} (random)`, refs, [r.doc]);
          const f = foreign[op][v];
          const same = said(o.res) === said(f.res) && o.stored === f.stored && (op === 'create' ? Boolean(o.id) === Boolean(f.id) && o.recordLeft === f.recordLeft : o.found === f.found);
          pairs.push({ op, variant: v, random: { answer: said(o.res), stored: o.stored }, foreign: { answer: said(f.res), stored: f.stored }, same });
        }
      }
      obs.random[s.key] = pairs;
      const differ = pairs.filter((p) => !p.same);
      check(`C.${s.key}.random`, differ.length === 0,
        `${differ.length ? `ORACLE: ${differ.map((p) => `${p.op}.${p.variant} random ${p.random.answer}${p.random.stored ? ' stored' : ''} vs foreign ${p.foreign.answer}${p.foreign.stored ? ' stored' : ''}`).join('; ')}. ` : ''}${pairs.map((p) => `${p.op}.${p.variant} ${p.random.answer}${p.random.stored ? ' stored' : ''} = ${p.foreign.answer}${p.foreign.stored ? ' stored' : ''}`).join('; ')}`);

      // The read stage: the standing record holds every form HEAD stores, at once.
      const stageRefs = [ref(s, 'stage-url-pb', { fileUrl: URL_PB }), ref(s, 'stage-url-pa1', { fileUrl: URL_PA }), ref(s, 'stage-legacy', { storageKey: `${D_B}.pdf` })];
      const st = await updateWith(s, 'read stage', stageRefs, B_KEYS);
      obs.readStage[s.key] = { answer: st.said, storedNamingDB: st.sqlNaming.length, of: stageRefs.length };
    }, { onError: async () => { failedSections.add(s.key); } });
  }

  // ── the reads: no door resolves B's document for A ────────────────────────
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

    // R.detail.s: every record of the surface as listed, and the standing one by its own GET.
    for (const s of SURFACES) {
      const R = ctx.run[s.key];
      const list = await ask(pmA, `A: PM lists the ${s.label}s for the detail check`, 'GET', `${R.route}${s.listQuery || ''}`);
      const records = list.status === 200 ? rowsOf(list.body?.data) : [];
      const single = s.single ? await ask(pmA, `A: PM reads the standing ${s.label}`, 'GET', `${R.route}/${R.standingId}`) : null;
      const answers = [list, ...(single ? [single] : [])];
      const leaked = [...new Set(answers.flatMap((res) => leakIn(res.status === 200 ? json(res.body?.data, 1e9) : '')))];
      const recs = [...records, ...(single?.status === 200 && single.body?.data ? [single.body.data] : [])];
      const foreignRefs = recs.flatMap(refsOf).filter(namesB);
      const withMeta = foreignRefs.filter(metaOfB);
      const standingFound = records.some((r) => r?.id === R.standingId) && (!single || single.body?.data?.id === R.standingId);
      obs.reads[`R.detail.${s.key}`] = { list: said(list), single: single ? said(single) : null, records: records.length, standingFound, foreignRefs: foreignRefs.length, withMeta: withMeta.length, leaked, sample: foreignRefs.slice(0, 3).map((r) => ({ fileName: r.fileName, storageKey: r.storageKey ?? null, fileUrl: r.fileUrl ?? null, documentId: r.documentId ?? null, projectDocument: r.projectDocument ?? null, sizeBytes: r.sizeBytes ?? null, sha256: r.sha256 ?? null })) };
      check(`R.detail.${s.key}`, list.status === 200 && (!single || single.status === 200) && standingFound && leaked.length === 0 && withMeta.length === 0,
        `${withMeta.length || leaked.length ? `P0 OPEN (B's document metadata on A's ${s.label}): ${json(withMeta, 600)} leaked ${leaked.join('+') || 'none'}. ` : ''}list ${said(list)} (${records.length} record(s))${single ? `, single ${said(single)}` : ''}, standing record ${standingFound ? 'found' : 'NOT found'}; refs naming D_B ${foreignRefs.length} (echo only: ${json(obs.reads[`R.detail.${s.key}`].sample, 700)}); read stage stored ${obs.readStage[s.key]?.storedNamingDB ?? '?'} of ${obs.readStage[s.key]?.of ?? '?'} (${obs.readStage[s.key]?.answer || 'not run'})`);
    }

    // R.audit: each standing record's history carries its references as rows, never D_B's metadata.
    const audit = {};
    for (const s of SURFACES) {
      const R = ctx.run[s.key];
      const res = await ask(pmA, `A: PM reads the ${s.label} audit history`, 'GET', `${PA}/audit?entityType=${s.recordType}&entityId=${R.standingId}&limit=100`);
      const events = rowsOf(res.body?.data);
      const attachments = events.flatMap((event) => listOf(event?.attachments));
      audit[s.key] = { said: said(res), events: events.length, attachmentsNamingDB: attachments.filter(namesB).length, withMeta: attachments.filter(metaOfB).length, leaked: leakIn(json(events, 1e9)) };
    }
    obs.reads['R.audit'] = audit;
    const auditBad = Object.entries(audit).filter(([, a]) => a.said !== '200' || a.events === 0 || a.withMeta || a.leaked.length);
    check('R.audit', auditBad.length === 0,
      `${auditBad.some(([, a]) => a.withMeta || a.leaked.length) ? 'P0 OPEN (B\'s document metadata in A\'s audit history). ' : ''}${Object.entries(audit).map(([k, a]) => `${k} ${a.said} ${a.events} event(s), ${a.attachmentsNamingDB} attachment(s) naming D_B (echo), meta ${a.withMeta}, leaked ${a.leaked.join('+') || 'none'}`).join('; ')}`);

    // R.register: the document register echoes the references, never D_B's metadata.
    const register = await ask(pmA, 'A: PM reads the document register', 'GET', `${PA}/doc-control/register`);
    const regRows = register.status === 200 ? rowsOf(register.body?.data) : [];
    const regRefs = regRows.flatMap((row) => [...listOf(row?.attachments), ...listOf(row?.revisions), ...(row?.latestRevision ? [row.latestRevision] : [])]);
    const regLeaked = leakIn(register.status === 200 ? json(register.body?.data, 1e9) : '');
    const regMeta = regRefs.filter(metaOfB);
    obs.reads['R.register'] = { said: said(register), rows: regRows.length, refsNamingDB: regRefs.filter(namesB).length, withMeta: regMeta.length, leaked: regLeaked };
    check('R.register', register.status === 200 && regRows.length > 0 && regMeta.length === 0 && regLeaked.length === 0,
      `${regMeta.length || regLeaked.length ? `P0 OPEN (B's document metadata in A's register): ${json(regMeta, 600)} leaked ${regLeaked.join('+') || 'none'}. ` : ''}register ${said(register)}, ${regRows.length} row(s), ${obs.reads['R.register'].refsNamingDB} ref(s) naming D_B (echo)`);

    // R.export: the RFI PDF and the punch CSV carry none of B's bytes.
    const exports = [
      ['RFI PDF of the standing RFI', `${ctx.run.rfi.route}/${ctx.run.rfi.standingId}/export.pdf`],
      ['punch list CSV (all kinds)', `${ctx.run.punch.route}/export.csv?kind=all`],
    ];
    const exported = [];
    for (const [label, route] of exports) {
      const res = await ask(pmA, `A: ${label}`, 'GET', route, undefined, { binary: true });
      exported.push({ label, said: said(res), bytes: res.buffer ? res.buffer.length : null, leaked: leakIn(textOf(res)) });
    }
    obs.reads['R.export'] = exported;
    check('R.export', exported.every((x) => x.said === '200' && x.leaked.length === 0),
      `${exported.some((x) => x.leaked.length) ? 'P0 OPEN (B\'s bytes in A\'s export). ' : ''}${exported.map((x) => `${x.label} -> ${x.said}${x.bytes !== null ? ` (${x.bytes} bytes)` : ''}, leaked ${x.leaked.join('+') || 'none'}`).join('; ')}`);

    // ── B's document is as B left it ──────────────────────────────────────────
    const docAfter = await docRow(D_B);
    const readAfter = await ask(pmB, 'B: PM reads D_B through /attachments/documents', 'GET', `${PB}/attachments/documents/${D_B}`, undefined, { binary: true });
    const FIELDS = ['orgId', 'projectId', 'status', 'linkedEntityType', 'linkedEntityId'];
    const changed = FIELDS.filter((k) => (docAfter?.[k] ?? null) !== (docB[k] ?? null));
    obs.docBAfter = docAfter && Object.fromEntries(FIELDS.map((k) => [k, docAfter[k]]));
    check('R.B.unchanged',
      Boolean(docAfter) && changed.length === 0 && docAfter.status === 'available' && !docAfter.linkedEntityType && !docAfter.linkedEntityId
        && readAfter.status === 200 && textOf(readAfter).includes(CANARY),
      `D_B after: ${json(obs.docBAfter)}${changed.length ? ` CHANGED ${changed.join(', ')} (before ${json(Object.fromEntries(changed.map((k) => [k, docB[k]])))}; a pointer written across companies)` : ' (unchanged)'}; B reads it ${said(readAfter)} canary ${textOf(readAfter).includes(CANARY)}`);
  });
};

/** The per-surface classification (observation; the harness classifies the 54 defect checks as a whole beside it). */
const classifySurfaces = () => {
  const setupOk = verdict.get('S.B') === true && verdict.get('S.A') === true && !mainError;
  const perSurface = {};
  for (const s of SURFACES) {
    const defects = defectIdsOf(s);
    const missing = defects.filter((id) => !verdict.has(id));
    const why = [];
    if (!setupOk) why.push('setup error');
    if (failedSections.has(s.key)) why.push('its section threw');
    if (missing.length) why.push(`not run: ${missing.join(', ')}`);
    if (verdict.get(`W.${s.key}.own`) !== true) why.push(`its own-document control W.${s.key}.own did not hold`);
    const reproduced = defects.filter((id) => verdict.get(id) === false);
    const classification = why.length ? 'UNDETERMINED' : reproduced.length === 0 ? 'REJECTED' : reproduced.length === defects.length ? 'CONFIRMED' : 'PARTIAL';
    perSurface[s.key] = {
      classification,
      why,
      reproduced,
      notReproduced: defects.filter((id) => verdict.get(id) === true),
      bareIdKeyStored: OPS.map((op) => `W.${s.key}.${op}.storageKey`).filter((id) => verdict.get(id) === false),
      randomControlHeld: verdict.has(`C.${s.key}.random`) ? verdict.get(`C.${s.key}.random`) : null,
      callSites: s.sites,
    };
  }
  const values = Object.values(perSurface).map((x) => x.classification);
  const determined = values.filter((v) => v !== 'UNDETERMINED');
  const overall = !determined.length ? 'UNDETERMINED'
    : values.every((v) => v === 'CONFIRMED') ? 'CONFIRMED'
      : values.every((v) => v === 'REJECTED') ? 'REJECTED' : 'PARTIAL';
  const by = (c) => Object.entries(perSurface).filter(([, x]) => x.classification === c).map(([k]) => k);
  const failedIds = [...verdict].filter(([, ok]) => !ok).map(([id]) => id);
  return {
    rule: CLASSIFICATION_RULE,
    overall,
    confirmedOn: by('CONFIRMED'),
    partialOn: by('PARTIAL'),
    rejectedOn: by('REJECTED'),
    undeterminedOn: by('UNDETERMINED'),
    perSurface,
    bareIdKeyStored: failedIds.filter((id) => /\.storageKey$/.test(id)),
    oracles: failedIds.filter((id) => id.startsWith('C.')),
    openReadsP0: failedIds.filter((id) => id.startsWith('R.')),
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
  // Every record the run made on PA1 loses its references.
  if (pmA && ctx.projectA) {
    const cleared = {};
    for (const s of SURFACES) {
      const R = ctx.run[s.key];
      if (!R) continue;
      for (const id of R.ids) {
        try {
          const res = await ask(pmA, `cleanup: ${s.key} ${id} references cleared`, 'PATCH', `${R.route}/${id}`, { attachmentRefs: [] });
          const k = `${s.key} ${said(res)}`;
          cleared[k] = (cleared[k] || 0) + 1;
        } catch (error) {
          cleared[`${s.key} not cleared: ${error.message}`] = (cleared[`${s.key} not cleared: ${error.message}`] || 0) + 1;
        }
      }
    }
    notes.push(`PA1 references cleared: ${json(cleared, 1500)}`);
    // What of PA1 still names D_B: the census residue (cross-links.js reads every row's JSON).
    const residue = {};
    if (q && ctx.D_B) {
      for (const table of ['WorkflowAttachment', 'DocumentRevision', 'AuditEvent', 'RecordHistorySnapshot', 'ApprovalWorkflowEvent', 'WorkflowStatusHistory', 'PunchItemEvent', 'OutboundEvent', 'Notification', 'BackgroundJob', ...SURFACES.map((s) => s.table)]) {
        try {
          const n = (await q(`select count(*)::int as n from "${table}" t where t."projectId" = $1 and to_jsonb(t)::text like $2`, [ctx.projectA, `%${ctx.D_B}%`]))[0].n;
          if (n) residue[table] = n;
        } catch (error) {
          residue[table] = `not read: ${error.message}`;
        }
      }
    }
    obs.residue = residue;
    notes.push(`rows of PA1 still naming D_B ${json(residue)}`);
  }
  const archive = async (who, label, projectId) => {
    try {
      const res = await ask(who, `cleanup: ${label} archived`, 'DELETE', `/projects/${projectId}`);
      const row = q ? (await q('select "archivedAt"::text as a from "Project" where id = $1', [projectId]))[0] : null;
      return `${label} ${projectId} archive ${said(res)}, archivedAt ${row?.a || 'NOT SET'}`;
    } catch (error) {
      return `${label} ${projectId} not archived: ${error.message}`;
    }
  };
  if (pmA && ctx.projectA) notes.push(await archive(pmA, 'PA1 (A\'s PM)', ctx.projectA));
  if (pmB && ctx.projectB) notes.push(await archive(pmB, 'PB (B\'s PM)', ctx.projectB));
  h.observe('xdoc1b', obs);
  h.observe('classification', classifySurfaces());
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
