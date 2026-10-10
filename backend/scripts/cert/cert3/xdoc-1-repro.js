'use strict';

/**
 * XDOC-1 confirm-first reproduction: a change order, an EOT claim, an NCR and
 * a safety incident of one company store a reference naming ANOTHER company's
 * document (the cross-company WRITE gap of the HEAD suspect XDOC-1), and no
 * read path resolves such a reference into that document's bytes, text or
 * metadata.
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/xdoc-1-repro.js
 *
 * Sources: the read-only trace C:\Temp\octapm-cert\scratch\wp2\xdoc1\XDOC1-TRACE.md
 * (live recipes R1, R2, R3; R4 and R5 are out of scope: R5 ran read-only and
 * found 0 rows); the adjudication
 * C:\Temp\octapm-cert\scratch\wp2\codex-plan-review-adjudication.md, "HEAD
 * suspect raised by the review" (XDOC-1) and X-H1 (a reference that resolves
 * to a stored document of another organisation or project, by id, by storage
 * key or by a product URL, is REFUSED on every surface); CERT-2's scale
 * (docs/certification/OCTAPM_LAUNCH_BLOCKERS.md:147-149: a stored reference to
 * another company's record is a cross-company write, P1; a read of it, P0).
 *
 * In process (CERT_INPROCESS=1) on the certification database, through the
 * lock runner only. Company A = 087 (its PM and QS), company B = 088 (its PM).
 *
 *   setup B  B's PM creates the scratch project PB ("CERT3 XDOC1 repro B
 *            <stamp>") and uploads a small text file carrying a random
 *            letters-only canary through POST /projects/PB/workflow/uploads:
 *            D_B (its documentId, which the upload answer also gives as its
 *            storageKey; the row's internal storageKey is read from the
 *            database). Its text is extracted here, in process (the worker's
 *            step, as isolation/documents-refs-proof.js does), so the search
 *            checks have something to find; B downloads D_B and finds it by
 *            the canary in PB's document search and in the global search:
 *            the positive controls that make A's "no hit" checks mean
 *            something.
 *   setup A  A's PM creates PA1 ("CERT3 XDOC1 repro A <stamp>") and puts the
 *            QS on its team (role qs: POST/PATCH change-orders and eot are
 *            requireRoles pm/qs). The QS uploads its own text file to PA1
 *            (ownQ) and makes one draft change order and one draft EOT claim;
 *            the PM uploads its own file (ownP), makes one NCR, one safety
 *            incident and one activity (the PM as its engineer). Nothing
 *            carries an attachment.
 *
 * Every write below is a PATCH of attachmentRefs alone by the record's writer
 * (QS for the change order and the EOT claim, PM for the NCR and the safety
 * incident). Each is judged ON ITS OWN: the record's references are cleared
 * first (PATCH attachmentRefs: [], verified empty in the database; a failed
 * clear is a setup error), then the one write is sent, then the database rows
 * of the record (CommercialAttachmentRef / WorkflowAttachment) and the PM's
 * read-back of the record are inspected. "Stored" = a row or a read-back ref
 * naming D_B (its id or its internal storage key) in documentId, storageKey or
 * fileUrl. The FIXED expectation of a foreign write: refused with a 4xx and
 * nothing stored.
 *
 *   id                   what                                                    HEAD
 *   S.B                  setup B (above), positive controls                      PASS (else exit 1)
 *   S.A                  setup A (above)                                          PASS (else exit 1)
 *   W.own                control: each writer's OWN fresh upload, by storage key  PASS
 *                        and by its PA1 product URL, is accepted (200) and stored
 *                        on all four records (a fix that refuses everything fails)
 *   W.co.storageKey      CO  [{fileName, storageKey: D_B}]                        FAIL: 200, stored
 *   W.co.urlPB           CO  [{fileName, fileUrl: /api/v1/projects/PB/workflow/uploads/D_B}]   FAIL: 200, stored
 *   W.co.urlPA1          CO  [{fileName, fileUrl: /api/v1/projects/PA1/workflow/uploads/D_B}]  FAIL: 200, stored
 *   W.co.documentId      control: CO [{fileName, documentId: D_B}]                PASS: 400 COMMERCIAL_DOCUMENT_NOT_FOUND
 *   W.eot.storageKey     EOT as W.co.storageKey                                   FAIL: 200, stored
 *   W.eot.urlPB          EOT as W.co.urlPB                                        FAIL: 200, stored
 *   W.eot.urlPA1         EOT as W.co.urlPA1                                       FAIL: 200, stored
 *   W.eot.documentId     control: EOT as W.co.documentId                          PASS: 400 COMMERCIAL_DOCUMENT_NOT_FOUND
 *   W.ncr.urlPB          NCR [{fileName, fileUrl: PB URL}]                         FAIL: 200, stored
 *   W.ncr.legacyKey      NCR [{fileName, storageKey: D_B + '.pdf'}] (skips R29)    FAIL: 200, stored
 *   W.ncr.storageKey     control (R2): NCR [{fileName, storageKey: D_B}]          PASS: 404 FILE_NOT_FOUND (R29)
 *   W.safety.urlPB       safety as W.ncr.urlPB                                     FAIL: 200, stored
 *   W.safety.legacyKey   safety as W.ncr.legacyKey                                 FAIL: 200, stored
 *   W.safety.storageKey  control (R2): safety as W.ncr.storageKey                 PASS: 404 FILE_NOT_FOUND
 *   R3.key               progress on the PA1 activity, evidence.photos [{key: D_B}]: 400, no submission   PASS (CERT-2 C2-R1)
 *   R3.url               the same with [{url: /api/v1/projects/PB/site-reporting/uploads/D_B}]: 400   PASS
 *
 * Read stage. Before the reads, every record is given all its foreign refs at
 * once (CO / EOT: storageKey, PB URL, PA1 URL; NCR / safety: PB URL, D_B.pdf);
 * HEAD stores them, so the reads are judged against stored foreign references
 * (observed.readStage records what was stored; a fixed product refuses them
 * and the reads still hold). Every read is A's PM (the broadest reader of A).
 * Any answer below 400, or any of B's bytes or metadata (the canary, B's
 * originalName, B's sha256) in an answer, is OPEN, labelled P0 in the detail.
 *
 *   R.dl.ownRoute        GET /projects/PA1/workflow/uploads/D_B (and /<D_B's internal storageKey>)   PASS: 404 FILE_NOT_FOUND
 *   R.dl.foreignRoute    GET /projects/PB/workflow/uploads/D_B                                       PASS: 404 (project access)
 *   R.dl.legacy          GET /projects/PA1/workflow/uploads/D_B.pdf (legacy local path)              PASS: 404
 *   R.att                GET /projects/PA1|PB/attachments/documents/D_B                               PASS: 404
 *   R.site               GET /projects/PA1|PB/site-reporting/uploads/D_B                              PASS: 404
 *   R.text               GET /projects/PA1|PB/documents/D_B/text                                      PASS: 404
 *   R.search.project     GET /projects/PA1|PB/documents/search?q=<canary>: no hit naming D_B or the canary   PASS
 *   R.search.global      GET /search?q=<canary> (types=document; all types; projectId=PB): no such hit       PASS
 *   R.detail.co          the CO in the PM's list: no projectDocument / originalName / sizeBytes /
 *                        sha256 of D_B, no canary (refs echo only what A sent)                       PASS
 *   R.detail.eot         the same for the EOT claim                                                   PASS
 *   R.detail.ncr         the same for the NCR                                                         PASS
 *   R.detail.safety      the same for the safety incident                                             PASS
 *   R.audit              the CO's and the EOT claim's audit history (events present): no B metadata  PASS
 *   R.B.unchanged        as B: D_B's orgId / projectId / status / linkedEntityType / linkedEntityId
 *                        unchanged (available, unlinked) and B still reads it (200, canary)        PASS
 *   G.5xx                no answer was a 5xx (cleanup included)                                       PASS
 *
 * Expected at HEAD (114e9f1 = product f599e67): 34 checks, 10 FAIL (W.co.storageKey,
 * W.co.urlPB, W.co.urlPA1, W.eot.storageKey, W.eot.urlPB, W.eot.urlPA1,
 * W.ncr.urlPB, W.ncr.legacyKey, W.safety.urlPB, W.safety.legacyKey), exit 2,
 * verdict DEFECT_PRESENT; out.headExpectation.matched says whether exactly
 * those failed. Any R.* failure is a P0-class open read (cross-tenant).
 *
 * Cleanup (always, whatever happened): A's four records have their references
 * cleared (PATCH attachmentRefs: []), the rows of PA1 that still name D_B are
 * counted per table (observed.residue: at HEAD the audit/approval history keeps
 * the echo of A's foreign refs, which the CERT-2 census, cross-links.js, will
 * count as cross-company references), then PA1 is archived by A's PM and PB by
 * B's PM (DELETE /projects/:id). No other project is touched.
 *
 * Exit 0 when every check holds (the fixed behaviour), 2 when one fails (the
 * defect is present), 1 on a setup error. Results:
 * C:\Temp\octapm-cert\results\cert3\xdoc-1-repro.json.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const guard = require('../lib/cert-env');
process.env.DATABASE_URL = guard.certDatabaseUrl();
// The background machinery and the per-request log stay off in process.
for (const name of ['JOB_WORKER_ENABLED', 'SCHEDULERS_ENABLED', 'EXCEPTIONS_ENGINE_ENABLED']) process.env[name] = 'false';
process.env.REQUEST_LOG_FORMAT = 'off';

const crypto = require('crypto');
const fs = require('fs');
const api = require('../lib/api');
const { buildPopulation } = require('../lib/spec');

const NAME = 'xdoc-1-repro';
const COMPANY_A = '087';
const COMPANY_B = '088';
const RESULTS = `C:/Temp/octapm-cert/results/cert3/${NAME}.json`;
const STAMP = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${crypto.randomBytes(2).toString('hex')}`;
/** Letters only: one token for the full-text parser, so a search finds it whole. */
const CANARY = `xdoccanary${Array.from(crypto.randomBytes(16), (b) => String.fromCharCode(97 + (b % 26))).join('')}`;
const PROJECT_A = `CERT3 XDOC1 repro A ${STAMP}`;
const PROJECT_B = `CERT3 XDOC1 repro B ${STAMP}`;
const START = '2026-01-05';
const END = '2026-12-31';
const B_FILE = `xdoc1-b-private-evidence-${STAMP}.txt`;
const B_TEXT = `XDOC-1 reproduction ${STAMP}: company B's private evidence. ${CANARY}\nOnly company B may read this file; its canary is ${CANARY}.\n`;

const DEFECT = 'FAIL at HEAD: answered 200 and stored (the XDOC-1 write gap, P1 class on the CERT-2 scale)';
const HOLDS = 'PASS at HEAD';
/** Fixed before the first run: id, what HEAD is expected to answer, what is judged. */
const CHECKS = [
  ['S.B', 'setup', 'B (088) PM creates PB, uploads a text file with the canary through /workflow/uploads (201; D_B available, unlinked, in B\'s org and PB); its text is extracted in process (ready); B downloads it (200, canary) and finds it by the canary in PB\'s document search and in the global search (positive controls)'],
  ['S.A', 'setup', 'A (087) PM creates PA1 and puts the QS on its team (qs); the QS uploads its own file (ownQ) and makes a draft change order and a draft EOT claim; the PM uploads its own file (ownP), makes an NCR, a safety incident and an activity (PM engineer); none carries a reference'],
  ['W.own', HOLDS, 'control: each writer\'s own fresh PA1 upload, by storage key and by its PA1 product URL, is accepted (200) and stored (2 rows naming it) on the change order, the EOT claim (QS, ownQ), the NCR and the safety incident (PM, ownP)'],
  ['W.co.storageKey', DEFECT, 'the QS PATCHes the draft change order with attachmentRefs [{fileName, storageKey: D_B}]: refused (4xx), nothing naming D_B stored'],
  ['W.co.urlPB', DEFECT, 'change order [{fileName, fileUrl: /api/v1/projects/<PB>/workflow/uploads/<D_B>}]: refused (4xx), nothing stored'],
  ['W.co.urlPA1', DEFECT, 'change order [{fileName, fileUrl: /api/v1/projects/<PA1>/workflow/uploads/<D_B>}]: refused (4xx), nothing stored'],
  ['W.co.documentId', HOLDS, 'control: change order [{fileName, documentId: D_B}]: refused (HEAD 400 COMMERCIAL_DOCUMENT_NOT_FOUND), nothing stored'],
  ['W.eot.storageKey', DEFECT, 'the QS PATCHes the draft EOT claim with [{fileName, storageKey: D_B}]: refused (4xx), nothing stored'],
  ['W.eot.urlPB', DEFECT, 'EOT claim [{fileName, fileUrl: PB URL of D_B}]: refused (4xx), nothing stored'],
  ['W.eot.urlPA1', DEFECT, 'EOT claim [{fileName, fileUrl: PA1 URL of D_B}]: refused (4xx), nothing stored'],
  ['W.eot.documentId', HOLDS, 'control: EOT claim [{fileName, documentId: D_B}]: refused (HEAD 400 COMMERCIAL_DOCUMENT_NOT_FOUND), nothing stored'],
  ['W.ncr.urlPB', DEFECT, 'the PM PATCHes the NCR with [{fileName, fileUrl: PB URL of D_B}]: refused (4xx), nothing stored'],
  ['W.ncr.legacyKey', DEFECT, 'NCR [{fileName, storageKey: D_B + ".pdf"}] (a non-UUID key, skipped by R29): refused (4xx), nothing stored'],
  ['W.ncr.storageKey', HOLDS, 'control (R2): NCR [{fileName, storageKey: D_B}]: refused (HEAD 404 FILE_NOT_FOUND, R29), nothing stored'],
  ['W.safety.urlPB', DEFECT, 'the PM PATCHes the safety incident with [{fileName, fileUrl: PB URL of D_B}]: refused (4xx), nothing stored'],
  ['W.safety.legacyKey', DEFECT, 'safety incident [{fileName, storageKey: D_B + ".pdf"}]: refused (4xx), nothing stored'],
  ['W.safety.storageKey', HOLDS, 'control (R2): safety incident [{fileName, storageKey: D_B}]: refused (HEAD 404 FILE_NOT_FOUND), nothing stored'],
  ['R3.key', HOLDS, 'regression (CERT-2 C2-R1): progress on the PA1 activity with evidence.photos [{key: D_B}]: 400 INVALID_SITE_PHOTO_REFERENCE, no submission written'],
  ['R3.url', HOLDS, 'regression (CERT-2 C2-R1): progress with evidence.photos [{url: /api/v1/projects/<PB>/site-reporting/uploads/<D_B>}]: 400 INVALID_SITE_PHOTO_REFERENCE, no submission written'],
  ['R.dl.ownRoute', HOLDS, 'A: GET /projects/PA1/workflow/uploads/D_B and /<D_B\'s internal storageKey>: refused (HEAD 404 FILE_NOT_FOUND), none of B\'s bytes'],
  ['R.dl.foreignRoute', HOLDS, 'A: GET /projects/PB/workflow/uploads/D_B: refused (HEAD 404, project access), none of B\'s bytes'],
  ['R.dl.legacy', HOLDS, 'A: GET /projects/PA1/workflow/uploads/D_B.pdf (the legacy local path the D_B.pdf key would name): refused (HEAD 404), none of B\'s bytes'],
  ['R.att', HOLDS, 'A: GET /projects/PA1/attachments/documents/D_B and /projects/PB/...: refused (HEAD 404), none of B\'s bytes'],
  ['R.site', HOLDS, 'A: GET /projects/PA1/site-reporting/uploads/D_B and /projects/PB/...: refused (HEAD 404), none of B\'s bytes'],
  ['R.text', HOLDS, 'A: GET /projects/PA1/documents/D_B/text and /projects/PB/...: refused (HEAD 404 DOCUMENT_NOT_FOUND / project access), no text'],
  ['R.search.project', HOLDS, 'A: GET /projects/PA1/documents/search?q=<canary> (and on PB): no hit naming D_B, the canary or B\'s file'],
  ['R.search.global', HOLDS, 'A: GET /search?q=<canary> (types=document; all types; projectId=PB): no hit naming D_B, the canary or B\'s file'],
  ['R.detail.co', HOLDS, 'A: the change order in the PM\'s list: no projectDocument, originalName, sizeBytes or sha256 of D_B and no canary (its refs echo only what A sent)'],
  ['R.detail.eot', HOLDS, 'A: the EOT claim in the PM\'s list: no metadata of D_B, no canary'],
  ['R.detail.ncr', HOLDS, 'A: the NCR in the PM\'s list: no metadata of D_B, no canary'],
  ['R.detail.safety', HOLDS, 'A: the safety incident in the PM\'s list: no metadata of D_B, no canary'],
  ['R.audit', HOLDS, 'A: the change order\'s and the EOT claim\'s audit history (200, events present): no metadata of D_B, no canary'],
  ['R.B.unchanged', HOLDS, 'B: D_B\'s orgId, projectId, status, linkedEntityType and linkedEntityId are unchanged (available, unlinked: no pointer written across companies) and B still reads it through /attachments/documents (200, canary)'],
  ['G.5xx', HOLDS, 'no answer was a 5xx (cleanup included)'],
].map(([id, head, what]) => ({ id, head, what }));
/** Fixed before the first run: S.B, S.A, W.own, 14 writes, R3 x2, 14 reads, G.5xx. */
const EXPECTED_CHECKS = 34;
const HEAD_FAILS = CHECKS.filter((c) => c.head === DEFECT).map((c) => c.id);

const results = [];
const answers = [];
const observed = { writes: {}, reads: {} };
const check = (id, ok, detail = '') => {
  const spec = CHECKS.find((c) => c.id === id);
  if (!spec) throw new Error(`no check ${id} in CHECKS`);
  if (results.some((r) => r.id === id)) throw new Error(`check ${id} recorded twice`);
  results.push({ id, name: `${id}: ${spec.what}`, atHead: spec.head, ok: Boolean(ok), detail: String(detail).slice(0, 3000) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}: ${spec.what}${!ok && detail ? `\n        ${String(detail).slice(0, 1500)}` : ''}`);
};
const said = (res) => (res ? `${res.status} ${res.body?.error?.code || ''}`.trim() : 'no answer');
const keep = (label, res) => {
  if (res) answers.push({ label, status: res.status, said: said(res) });
  return res;
};
const listOf = (data) => (Array.isArray(data) ? data : []);
/** The list in an answer: a bare array, or rows (NCR, safety), orders (CO), items (search), events (audit). */
const rowsOf = (data) => {
  if (Array.isArray(data)) return data;
  for (const key of ['rows', 'orders', 'items', 'events']) if (Array.isArray(data?.[key])) return data[key];
  return [];
};
const is4xx = (res) => Boolean(res) && res.status >= 400 && res.status < 500;
const textOf = (res) => (res?.buffer ? res.buffer.toString('utf8') : res?.text || '');
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

const cleanup = [];
const ctx = { db: null, projectA: null, projectB: null, D_B: null, surfaces: null, pmA: null, pmB: null };

const main = async () => {
  if (process.env.CERT_INPROCESS !== '1') throw new Error('run through C:\\Temp\\octapm-cert\\run-locked.js (CERT_INPROCESS=1)');
  if (!process.env.CERT_PASSWORD) throw new Error('CERT_PASSWORD is not set');
  if (CHECKS.length !== EXPECTED_CHECKS) throw new Error(`CHECKS lists ${CHECKS.length} checks, EXPECTED_CHECKS is ${EXPECTED_CHECKS}`);
  const population = buildPopulation().companies;
  const companyA = population.find((c) => c.code === COMPANY_A);
  const companyB = population.find((c) => c.code === COMPANY_B);
  if (!companyA || !companyB) throw new Error(`no company ${!companyA ? COMPANY_A : COMPANY_B} in the population`);
  const db = await guard.connectCert();
  ctx.db = db;
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const orgOf = async (code) => {
    const orgs = await q('select id, slug, name from "Organisation" where slug like $1', [`cert-${code}-%`]);
    if (orgs.length !== 1) throw new Error(`company ${code}: ${orgs.length} organisations, exactly one expected`);
    return guard.assertCertOrganisation(orgs[0]);
  };
  const orgA = await orgOf(COMPANY_A);
  const orgB = await orgOf(COMPANY_B);
  if (orgA.id === orgB.id) throw new Error('companies A and B resolve to one organisation');
  const userId = async (email) => {
    const rows = await q('select id from "User" where email = $1', [email]);
    if (rows.length !== 1) throw new Error(`${email}: ${rows.length} users`);
    return rows[0].id;
  };
  const pmA = api.as({ email: `pm@${companyA.domain}`, orgId: orgA.id });
  const qsA = api.as({ email: `qs@${companyA.domain}`, orgId: orgA.id });
  const pmB = api.as({ email: `pm@${companyB.domain}`, orgId: orgB.id });
  ctx.pmA = pmA;
  ctx.pmB = pmB;
  const pmAId = await userId(pmA.email);
  const qsAId = await userId(qsA.email);
  console.log(`${NAME}: A ${COMPANY_A} ${orgA.name} (${orgA.id}); B ${COMPANY_B} ${orgB.name} (${orgB.id}); stamp ${STAMP}; in process\n`);

  const docRow = async (id) =>
    (await q('select id, "orgId", "projectId", "documentType", "originalName", "sizeBytes", sha256, "storageKey", status, "linkedEntityType", "linkedEntityId" from "ProjectDocument" where id = $1', [id]))[0] || null;
  const uploadText = async (who, label, projectRoute, filename, text) => {
    const res = keep(label, await who.send('POST', `${projectRoute}/workflow/uploads`, undefined, {
      form: api.multipart({ field: 'files', filename, contentType: 'text/plain', body: Buffer.from(text, 'utf8') }),
    }));
    const doc = res.status === 201 ? rowsOf(res.body?.data)[0] || null : null;
    return { res, id: doc?.documentId || null, answer: doc };
  };
  const archive = (who, label, projectId) => async () => {
    const res = keep(`cleanup: ${label} archived`, await who.send('DELETE', `/projects/${projectId}`));
    const row = (await q('select "archivedAt"::text as a from "Project" where id = $1', [projectId]))[0];
    return `${label} ${projectId} archive ${said(res)}, archivedAt ${row?.a || 'NOT SET'}`;
  };

  // ── setup B: the other company's document ───────────────────────────────
  console.log('── setup B ──');
  const createdB = keep('B: PM creates PB', await pmB.send('POST', '/projects', { name: PROJECT_B, startDate: START, endDate: END, projectCalendar: 'five_day' }));
  ctx.projectB = createdB.status === 201 ? createdB.body?.data?.id || null : null;
  if (ctx.projectB) cleanup.push(archive(pmB, 'PB (B\'s PM)', ctx.projectB));
  const PB = `/projects/${ctx.projectB}`;
  const upB = ctx.projectB ? await uploadText(pmB, 'B: PM uploads the canary file to PB', PB, B_FILE, B_TEXT) : { res: null, id: null };
  const D_B = upB.id;
  ctx.D_B = D_B;
  const docB = D_B ? await docRow(D_B) : null;
  observed.D_B = D_B;
  observed.docB = docB && { ...docB };
  observed.canary = CANARY;
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
  observed.extraction = extracted;
  const readB = D_B ? keep('B: PM downloads D_B', await pmB.send('GET', `${PB}/workflow/uploads/${D_B}`, undefined, { binary: true })) : null;
  const searchB = D_B ? keep('B: PM searches PB for the canary', await pmB.send('GET', `${PB}/documents/search?q=${encodeURIComponent(CANARY)}`)) : null;
  const globalB = D_B ? keep('B: PM global search for the canary', await pmB.send('GET', `/search?q=${encodeURIComponent(CANARY)}&types=document&limit=50`)) : null;
  const hitB = (res) => res?.status === 200 && JSON.stringify(rowsOf(res.body?.data)).includes(D_B);
  check('S.B',
    createdB.status === 201 && Boolean(ctx.projectB) && upB.res?.status === 201 && Boolean(D_B)
      && docB?.orgId === orgB.id && docB?.projectId === ctx.projectB && docB?.status === 'available' && !docB?.linkedEntityType && !docB?.linkedEntityId
      && extracted?.status === 'ready'
      && readB?.status === 200 && textOf(readB).includes(CANARY)
      && hitB(searchB) && hitB(globalB),
    `PB ${said(createdB)} ${createdB.body?.error?.message || ''}; upload ${said(upB.res)}; D_B ${D_B} ${JSON.stringify(docB && { orgId: docB.orgId, projectId: docB.projectId, status: docB.status, linked: [docB.linkedEntityType, docB.linkedEntityId], storageKey: docB.storageKey })}; extraction ${JSON.stringify(extracted)}; B download ${said(readB)} canary ${readB ? textOf(readB).includes(CANARY) : false}; B project search ${said(searchB)} hit ${hitB(searchB)}; B global search ${said(globalB)} hit ${hitB(globalB)}`);
  if (!results.every((r) => r.ok)) throw new Error('setup incomplete: company B');
  const B_KEYS = [D_B, docB.storageKey].filter(Boolean);
  /** Whether a stored row or a read-back ref names D_B (by id or internal storage key) in any document field. */
  const namesAny = (row, keys) => [row?.documentId, row?.storageKey, row?.fileUrl, row?.projectDocument?.id].some((v) => typeof v === 'string' && keys.some((k) => v.includes(k)));
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

  // ── setup A: the scratch project, its records ───────────────────────────
  console.log('\n── setup A ──');
  const createdA = keep('A: PM creates PA1', await pmA.send('POST', '/projects', { name: PROJECT_A, startDate: START, endDate: END, projectCalendar: 'five_day' }));
  ctx.projectA = createdA.status === 201 ? createdA.body?.data?.id || null : null;
  if (ctx.projectA) {
    cleanup.push(async () => {
      const cleared = [];
      for (const s of Object.values(ctx.surfaces || {}).filter((x) => x.id)) {
        try {
          const res = keep(`cleanup: ${s.key} references cleared`, await s.writer.send('PATCH', s.route, { attachmentRefs: [] }));
          cleared.push(`${s.key} ${said(res)}`);
        } catch (error) {
          cleared.push(`${s.key} not cleared: ${error.message}`);
        }
      }
      // What of PA1 still names D_B: the census residue (cross-links.js reads every row's JSON).
      const residue = {};
      for (const table of ['CommercialAttachmentRef', 'WorkflowAttachment', 'AuditEvent', 'RecordHistorySnapshot', 'ApprovalWorkflowEvent', 'WorkflowStatusHistory', 'OutboundEvent', 'Notification', 'BackgroundJob', 'ProgressSubmission', 'ChangeOrder', 'EotClaim', 'NcrRecord', 'SafetyIncident']) {
        if (!ctx.D_B) break;
        try {
          const n = (await q(`select count(*)::int as n from "${table}" t where t."projectId" = $1 and to_jsonb(t)::text like $2`, [ctx.projectA, `%${ctx.D_B}%`]))[0].n;
          if (n) residue[table] = n;
        } catch (error) {
          residue[table] = `not read: ${error.message}`;
        }
      }
      observed.residue = residue;
      const archived = await archive(pmA, 'PA1 (A\'s PM)', ctx.projectA)();
      return `PA1 references cleared (${cleared.join(', ') || 'no records'}); rows of PA1 still naming D_B ${JSON.stringify(residue)}; ${archived}`;
    });
  }
  observed.projectA = ctx.projectA;
  observed.projectB = ctx.projectB;
  const PA = `/projects/${ctx.projectA}`;
  const teamQs = ctx.projectA ? keep('A: PM puts the QS on the team', await pmA.send('POST', `${PA}/team`, { userId: qsAId, role: 'qs' })) : null;
  const ownQ = ctx.projectA ? await uploadText(qsA, 'A: QS uploads its own file', PA, `xdoc1-a-own-qs-${STAMP}.txt`, `XDOC-1 reproduction ${STAMP}: company A's own evidence (QS).\n`) : { res: null, id: null };
  const ownP = ctx.projectA ? await uploadText(pmA, 'A: PM uploads its own file', PA, `xdoc1-a-own-pm-${STAMP}.txt`, `XDOC-1 reproduction ${STAMP}: company A's own evidence (PM).\n`) : { res: null, id: null };
  const ownQRow = ownQ.id ? await docRow(ownQ.id) : null;
  const ownPRow = ownP.id ? await docRow(ownP.id) : null;
  const coMade = ctx.projectA ? keep('A: QS creates the draft change order', await qsA.send('POST', `${PA}/change-orders`, { description: `XDOC-1 repro change order ${STAMP}` })) : null;
  const eotMade = ctx.projectA ? keep('A: QS creates the draft EOT claim', await qsA.send('POST', `${PA}/eot`, { eventName: `XDOC-1 repro EOT ${STAMP}`, delayDays: 3 })) : null;
  const ncrMade = ctx.projectA ? keep('A: PM creates the NCR', await pmA.send('POST', `${PA}/ncr`, { description: `XDOC-1 repro NCR ${STAMP}`, severity: 'minor' })) : null;
  const safetyMade = ctx.projectA ? keep('A: PM creates the safety incident', await pmA.send('POST', `${PA}/safety`, { incidentType: 'near_miss', title: `XDOC-1 repro safety ${STAMP}` })) : null;
  const activityMade = ctx.projectA ? keep('A: PM creates the activity', await pmA.send('POST', `${PA}/activities`, { name: `XDOC-1 repro activity ${STAMP}`, duration: 5, engineerIds: [pmAId] })) : null;
  const idOf = (res) => (res?.status === 201 ? res.body?.data?.id || null : null);
  const ids = { co: idOf(coMade), eot: idOf(eotMade), ncr: idOf(ncrMade), safety: idOf(safetyMade), activity: idOf(activityMade) };
  observed.ids = { ...ids, ownQ: ownQ.id, ownP: ownP.id };
  const surfaces = {
    co: { key: 'co', label: 'change order', writer: qsA, writerName: 'QS', own: ownQRow, id: ids.co, route: `${PA}/change-orders/${ids.co}`, list: `${PA}/change-orders`, table: 'CommercialAttachmentRef', recordType: 'change_order' },
    eot: { key: 'eot', label: 'EOT claim', writer: qsA, writerName: 'QS', own: ownQRow, id: ids.eot, route: `${PA}/eot/${ids.eot}`, list: `${PA}/eot`, table: 'CommercialAttachmentRef', recordType: 'eot_claim' },
    ncr: { key: 'ncr', label: 'NCR', writer: pmA, writerName: 'PM', own: ownPRow, id: ids.ncr, route: `${PA}/ncr/${ids.ncr}`, list: `${PA}/ncr`, table: 'WorkflowAttachment', recordType: 'ncr' },
    safety: { key: 'safety', label: 'safety incident', writer: pmA, writerName: 'PM', own: ownPRow, id: ids.safety, route: `${PA}/safety/${ids.safety}`, list: `${PA}/safety`, table: 'WorkflowAttachment', recordType: 'safety_incident' },
  };
  ctx.surfaces = surfaces;
  /** The record's evidence rows as stored. */
  const storedRows = async (s) => q(
    `select id, ${s.table === 'CommercialAttachmentRef' ? '"documentId"' : 'null::text as "documentId"'}, "fileName", "fileUrl", "storageKey" from "${s.table}" where "projectId" = $1 and "recordType" = $2 and "recordId" = $3 order by "createdAt"`,
    [ctx.projectA, s.recordType, s.id],
  );
  const initialRows = {};
  for (const s of Object.values(surfaces)) initialRows[s.key] = s.id ? (await storedRows(s)).length : null;
  check('S.A',
    createdA.status === 201 && Boolean(ctx.projectA) && [200, 201].includes(teamQs?.status)
      && ownQ.res?.status === 201 && ownQRow?.projectId === ctx.projectA && ownP.res?.status === 201 && ownPRow?.projectId === ctx.projectA
      && Boolean(ids.co) && coMade.body?.data?.status === 'draft'
      && Boolean(ids.eot) && eotMade.body?.data?.status === 'draft'
      && Boolean(ids.ncr) && ncrMade.body?.data?.status === 'open'
      && Boolean(ids.safety) && safetyMade.body?.data?.status === 'open'
      && Boolean(ids.activity)
      && Object.values(initialRows).every((n) => n === 0),
    `PA1 ${said(createdA)} ${createdA.body?.error?.message || ''}; team QS ${said(teamQs)}; ownQ ${said(ownQ.res)}; ownP ${said(ownP.res)}; CO ${said(coMade)} ${coMade?.body?.data?.status || coMade?.body?.error?.message || ''}; EOT ${said(eotMade)} ${eotMade?.body?.data?.status || eotMade?.body?.error?.message || ''}; NCR ${said(ncrMade)} ${ncrMade?.body?.data?.status || ncrMade?.body?.error?.message || ''}; safety ${said(safetyMade)} ${safetyMade?.body?.data?.status || safetyMade?.body?.error?.message || ''}; activity ${said(activityMade)} ${activityMade?.body?.error?.message || ''}; reference rows at creation ${JSON.stringify(initialRows)}`);
  if (!results.every((r) => r.ok)) throw new Error('setup incomplete: company A');

  /** The record as the PM reads it in the module's list (there is no single-record GET for these four). */
  const readBack = async (s, label) => {
    const res = keep(label, await pmA.send('GET', s.list));
    const rec = res.status === 200 ? rowsOf(res.body?.data).find((r) => r.id === s.id) || null : null;
    // NCR and safety answer the same list twice (attachmentRefs and attachments): each ref counted once.
    const seen = new Set();
    const refs = rec ? [...listOf(rec.attachmentRefs), ...listOf(rec.attachments)].filter((r) => {
      const k = JSON.stringify(r);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }) : [];
    return { res, rec, refs };
  };
  /** Clears the record's references and proves it in the database; a failed clear is a setup error. */
  const reset = async (s) => {
    const res = keep(`${s.key}: ${s.writerName} clears the references`, await s.writer.send('PATCH', s.route, { attachmentRefs: [] }));
    const left = await storedRows(s);
    if (res.status !== 200 || left.length) throw new Error(`the ${s.label}'s references could not be cleared before the next write (${said(res)} ${res.body?.error?.message || ''}; ${left.length} row(s) left)`);
  };
  /** One write, judged on its own: cleared first, then sent, then read in the database and through the API. */
  const write = async (s, variant, refs) => {
    await reset(s);
    const res = keep(`${s.key} ${variant}: ${s.writerName} PATCHes the references`, await s.writer.send('PATCH', s.route, { attachmentRefs: refs }));
    const rows = await storedRows(s);
    const back = await readBack(s, `${s.key} ${variant}: PM reads the record back`);
    return {
      res,
      said: `${said(res)}${res.status >= 400 && res.body?.error?.message ? ` (${res.body.error.message})` : ''}`,
      rows: rows.map(({ documentId, storageKey, fileUrl, fileName }) => ({ documentId, storageKey, fileUrl, fileName })),
      back,
    };
  };
  const ref = (s, variant, extra) => ({ fileName: `xdoc1-a-${s.key}-${variant}-${STAMP}.pdf`, ...extra });
  const URL_PB = `/api/v1/projects/${ctx.projectB}/workflow/uploads/${D_B}`;
  const URL_PA = `/api/v1/projects/${ctx.projectA}/workflow/uploads/${D_B}`;
  const LEGACY_KEY = `${D_B}.pdf`;

  // ── W.own: the writers' own documents are accepted (control) ────────────
  console.log('\n── writes ──');
  const own = {};
  for (const s of Object.values(surfaces)) {
    const refs = [ref(s, 'own-key', { storageKey: s.own.id }), ref(s, 'own-url', { fileUrl: `/api/v1/projects/${ctx.projectA}/workflow/uploads/${s.own.id}` })];
    const o = await write(s, 'own', refs);
    const ownKeys = [s.own.id, s.own.storageKey].filter(Boolean);
    own[s.key] = { answer: o.said, rows: o.rows.length, namingOwn: o.rows.filter((row) => namesAny(row, ownKeys)).length, readBack: said(o.back.res) };
  }
  observed.own = own;
  check('W.own',
    Object.values(own).every((o) => o.answer.startsWith('200') && o.rows === 2 && o.namingOwn === 2),
    JSON.stringify(own));

  // ── the foreign writes, each on its own ─────────────────────────────────
  const foreignWrite = async (id, s, variant, refs, headAnswer) => {
    const o = await write(s, variant, refs);
    const sqlStored = o.rows.filter(namesB);
    const apiStored = o.back.refs.filter(namesB);
    const stored = sqlStored.length > 0 || apiStored.length > 0;
    observed.writes[id] = { sent: refs, answer: o.said, stored, rows: o.rows, readBackRefsNamingDB: apiStored.length, readBack: said(o.back.res), found: Boolean(o.back.rec) };
    check(id, is4xx(o.res) && !stored && Boolean(o.back.rec),
      `${s.writerName} PATCH ${s.label} attachmentRefs ${JSON.stringify(refs)} -> ${o.said}; stored: ${stored ? `YES (${sqlStored.length} row(s) ${JSON.stringify(sqlStored)}; ${apiStored.length} read-back ref(s) naming D_B)` : 'no'}; read back ${said(o.back.res)}${o.back.rec ? '' : ' (record NOT found)'}; HEAD expectation: ${headAnswer}${stored ? ' -- the XDOC-1 write gap (cross-company reference stored, P1 class)' : ''}`);
  };
  for (const s of [surfaces.co, surfaces.eot]) {
    await foreignWrite(`W.${s.key}.storageKey`, s, 'storageKey', [ref(s, 'sk', { storageKey: D_B })], '200, stored');
    await foreignWrite(`W.${s.key}.urlPB`, s, 'urlPB', [ref(s, 'url-pb', { fileUrl: URL_PB })], '200, stored');
    await foreignWrite(`W.${s.key}.urlPA1`, s, 'urlPA1', [ref(s, 'url-pa1', { fileUrl: URL_PA })], '200, stored');
    await foreignWrite(`W.${s.key}.documentId`, s, 'documentId', [ref(s, 'doc', { documentId: D_B })], '400 COMMERCIAL_DOCUMENT_NOT_FOUND, nothing stored');
  }
  for (const s of [surfaces.ncr, surfaces.safety]) {
    await foreignWrite(`W.${s.key}.urlPB`, s, 'urlPB', [ref(s, 'url-pb', { fileUrl: URL_PB })], '200, stored');
    await foreignWrite(`W.${s.key}.legacyKey`, s, 'legacyKey', [ref(s, 'legacy', { storageKey: LEGACY_KEY })], '200, stored (a non-UUID key skips R29)');
    await foreignWrite(`W.${s.key}.storageKey`, s, 'storageKey', [ref(s, 'sk', { storageKey: D_B })], '404 FILE_NOT_FOUND (R29), nothing stored');
  }

  // ── the read stage: every foreign ref at once (HEAD stores them) ────────
  console.log('\n── read stage ──');
  observed.readStage = {};
  for (const s of Object.values(surfaces)) {
    const refs = s.table === 'CommercialAttachmentRef'
      ? [ref(s, 'sk', { storageKey: D_B }), ref(s, 'url-pb', { fileUrl: URL_PB }), ref(s, 'url-pa1', { fileUrl: URL_PA })]
      : [ref(s, 'url-pb', { fileUrl: URL_PB }), ref(s, 'legacy', { storageKey: LEGACY_KEY })];
    const o = await write(s, 'read stage', refs);
    observed.readStage[s.key] = { answer: o.said, storedNamingDB: o.rows.filter(namesB).length, of: refs.length };
  }
  const stageNote = (key) => `foreign refs stored for the read stage: ${observed.readStage[key]?.storedNamingDB ?? '?'} of ${observed.readStage[key]?.of ?? '?'} (${observed.readStage[key]?.answer || ''})`;

  // ── R3: progress evidence naming B's document (regression) ──────────────
  console.log('\n── R3 progress ──');
  const submissions = async () => Number((await q('select count(*)::int as n from "ProgressSubmission" where "activityId" = $1', [ids.activity]))[0].n);
  const progress = async (id, label, photos) => {
    const before = await submissions();
    const res = keep(`R3 ${label}: PM submits progress`, await pmA.send('POST', `${PA}/activities/${ids.activity}/progress`, {
      status: 'submitted', source: 'manual', pctComplete: 10, evidence: { photos }, notes: `XDOC-1 repro ${label} ${STAMP}`,
    }));
    const after = await submissions();
    observed.writes[id] = { sent: photos, answer: said(res), submissionsBefore: before, submissionsAfter: after };
    // The code too: a 400 for another reason (a body this proof got wrong) would pass vacuously.
    check(id, res.status === 400 && res.body?.error?.code === 'INVALID_SITE_PHOTO_REFERENCE' && after === before,
      `${said(res)} ${res.body?.error?.message || ''} (expected 400 INVALID_SITE_PHOTO_REFERENCE); progress submissions of the activity before ${before}, after ${after}`);
  };
  await progress('R3.key', 'key', [{ key: D_B }]);
  await progress('R3.url', 'url', [{ url: `/api/v1/projects/${ctx.projectB}/site-reporting/uploads/${D_B}` }]);

  // ── reads: no door resolves B's document for A ──────────────────────────
  console.log('\n── reads ──');
  /** Each request refused (>= 400) with none of B's bytes or metadata; below 400 or a leak is OPEN (P0). */
  const refusedReads = async (id, requests) => {
    const seen = [];
    for (const [label, route, expect] of requests) {
      const res = keep(`A: ${label}`, await pmA.send('GET', route, undefined, { binary: true }));
      seen.push({ label, said: said(res), expect, served: res.status < 400, leaked: leakIn(textOf(res)) });
    }
    observed.reads[id] = seen;
    const open = seen.filter((s) => s.served || s.leaked.length);
    check(id, open.length === 0,
      `${open.length ? `P0 OPEN (cross-tenant read of B's document): ${open.map((s) => `${s.label} ${s.said}${s.leaked.length ? ` leaked ${s.leaked.join('+')}` : ''}`).join('; ')}. ` : ''}${seen.map((s) => `${s.label} -> ${s.said} (expected ${s.expect})`).join('; ')}`);
  };
  await refusedReads('R.dl.ownRoute', [
    ['GET PA1 /workflow/uploads/D_B', `${PA}/workflow/uploads/${D_B}`, '404 FILE_NOT_FOUND'],
    ['GET PA1 /workflow/uploads/<D_B internal storageKey>', `${PA}/workflow/uploads/${docB.storageKey}`, '404 FILE_NOT_FOUND'],
  ]);
  await refusedReads('R.dl.foreignRoute', [['GET PB /workflow/uploads/D_B', `${PB}/workflow/uploads/${D_B}`, '404 (project access)']]);
  await refusedReads('R.dl.legacy', [['GET PA1 /workflow/uploads/D_B.pdf', `${PA}/workflow/uploads/${LEGACY_KEY}`, '404 FILE_NOT_FOUND']]);
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
      const res = keep(`A: ${label}`, await pmA.send('GET', route));
      // The answer echoes the query (the canary) beside its hits: only the hits are judged.
      const hits = res.status === 200 ? JSON.stringify(rowsOf(res.body?.data)) : textOf(res);
      const leaked = [...leakIn(hits), ...(hits.includes(D_B) ? ['D_B'] : [])];
      seen.push({ label, said: said(res), hits: res.status === 200 ? rowsOf(res.body?.data).length : null, leaked });
    }
    observed.reads[id] = seen;
    const open = seen.filter((s) => s.leaked.length || (s.said.startsWith('2') && s.hits === null));
    check(id, open.length === 0,
      `${open.length ? `P0 OPEN (B's document found by A): ${open.map((s) => `${s.label} ${s.said} ${s.leaked.join('+')}`).join('; ')}. ` : ''}${seen.map((s) => `${s.label} -> ${s.said}${s.hits !== null ? `, ${s.hits} hit(s)` : ''}`).join('; ')}`);
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

  for (const s of Object.values(surfaces)) {
    const back = await readBack(s, `A: PM reads the ${s.label} for the detail check`);
    const json = back.rec ? JSON.stringify(back.rec) : '';
    const leaked = leakIn(json);
    const foreign = back.refs.filter(namesB);
    const withMeta = foreign.filter(metaOfB);
    observed.reads[`R.detail.${s.key}`] = { said: said(back.res), found: Boolean(back.rec), foreignRefs: foreign.length, withMeta: withMeta.length, leaked, refs: foreign.map((r) => ({ fileName: r.fileName, storageKey: r.storageKey, fileUrl: r.fileUrl, documentId: r.documentId ?? null, projectDocument: r.projectDocument ?? null, sizeBytes: r.sizeBytes ?? null, sha256: r.sha256 ?? null })) };
    check(`R.detail.${s.key}`, back.res.status === 200 && Boolean(back.rec) && leaked.length === 0 && withMeta.length === 0,
      `${withMeta.length || leaked.length ? `P0 OPEN (B's document metadata on A's ${s.label}): ${JSON.stringify(withMeta).slice(0, 600)} leaked ${leaked.join('+') || 'none'}. ` : ''}list ${said(back.res)}, record ${back.rec ? 'found' : 'NOT found'}; refs naming D_B ${foreign.length} (echo only: ${JSON.stringify(observed.reads[`R.detail.${s.key}`].refs).slice(0, 900)}); ${stageNote(s.key)}`);
  }

  const auditOf = async (entityType, id) => keep(`A: PM reads the ${entityType} audit history`, await pmA.send('GET', `${PA}/audit?entityType=${entityType}&entityId=${id}&limit=100`));
  const auditCo = await auditOf('change_order', ids.co);
  const auditEot = await auditOf('eot_claim', ids.eot);
  const eventsCo = rowsOf(auditCo.body?.data);
  const eventsEot = rowsOf(auditEot.body?.data);
  const auditLeaks = [...leakIn(JSON.stringify(eventsCo)), ...leakIn(JSON.stringify(eventsEot))];
  const auditMeta = [...eventsCo, ...eventsEot].flatMap((event) => listOf(event?.attachments)).filter(metaOfB);
  const auditForeign = [...eventsCo, ...eventsEot].flatMap((event) => listOf(event?.attachments)).filter(namesB).length;
  observed.reads['R.audit'] = { co: { said: said(auditCo), events: eventsCo.length }, eot: { said: said(auditEot), events: eventsEot.length }, attachmentsNamingDB: auditForeign, withMeta: auditMeta.length, leaked: auditLeaks };
  check('R.audit',
    auditCo.status === 200 && auditEot.status === 200 && eventsCo.length > 0 && eventsEot.length > 0 && auditLeaks.length === 0 && auditMeta.length === 0,
    `${auditLeaks.length || auditMeta.length ? `P0 OPEN (B's document metadata in A's audit history): ${JSON.stringify(auditMeta).slice(0, 600)} leaked ${auditLeaks.join('+') || 'none'}. ` : ''}change order history ${said(auditCo)} ${eventsCo.length} event(s); EOT history ${said(auditEot)} ${eventsEot.length} event(s); attachments naming D_B ${auditForeign} (echo of A's refs)`);

  // ── B's document is as B left it ────────────────────────────────────────
  console.log('\n── company B ──');
  const docAfter = await docRow(D_B);
  const readAfter = keep('B: PM reads D_B through /attachments/documents', await pmB.send('GET', `${PB}/attachments/documents/${D_B}`, undefined, { binary: true }));
  const FIELDS = ['orgId', 'projectId', 'status', 'linkedEntityType', 'linkedEntityId'];
  const changed = FIELDS.filter((k) => (docAfter?.[k] ?? null) !== (docB[k] ?? null));
  observed.docBAfter = docAfter && Object.fromEntries(FIELDS.map((k) => [k, docAfter[k]]));
  check('R.B.unchanged',
    Boolean(docAfter) && changed.length === 0 && docAfter.status === 'available' && !docAfter.linkedEntityType && !docAfter.linkedEntityId
      && readAfter.status === 200 && textOf(readAfter).includes(CANARY),
    `D_B after: ${JSON.stringify(observed.docBAfter)}${changed.length ? ` CHANGED ${changed.join(', ')} (before ${JSON.stringify(Object.fromEntries(changed.map((k) => [k, docB[k]])))}; a pointer written across companies)` : ' (unchanged)'}; B reads it ${said(readAfter)} canary ${textOf(readAfter).includes(CANARY)}`);
};

const finish = async (error = null) => {
  const cleaned = [];
  for (const step of cleanup.reverse()) {
    try {
      cleaned.push(String(await step()));
    } catch (e) {
      cleaned.push(`cleanup failed: ${e.message}`);
    }
  }
  console.log(`\ncleanup: ${cleaned.join('; ') || 'nothing to remove'}`);
  // G.5xx, after main and cleanup: every answer seen, the cleanup's too.
  if (!error || results.length) {
    const fives = answers.filter((a) => a.status >= 500);
    check('G.5xx', fives.length === 0, fives.map((a) => `${a.label} ${a.said}`).join(', '));
  }
  if (ctx.db) await ctx.db.end().catch(() => {});
  const failed = results.filter((r) => !r.ok);
  const failedIds = failed.map((r) => r.id);
  const missing = CHECKS.filter((c) => !results.some((r) => r.id === c.id)).map((c) => c.id);
  const complete = results.length === EXPECTED_CHECKS && missing.length === 0;
  const ok = !error && failed.length === 0 && complete;
  const out = {
    proof: NAME,
    kind: 'confirm-first reproduction (XDOC-1: another company\'s document stored as a reference on a change order, EOT claim, NCR, safety incident; no read resolves it)',
    plan: 'C:/Temp/octapm-cert/scratch/wp2/xdoc1/XDOC1-TRACE.md R1-R3; codex-plan-review-adjudication.md XDOC-1 and X-H1',
    companies: { A: COMPANY_A, B: COMPANY_B },
    projects: { A: PROJECT_A, B: PROJECT_B },
    stamp: STAMP,
    at: new Date().toISOString(),
    expected: EXPECTED_CHECKS,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    missing,
    exitCode: error ? 1 : ok ? 0 : 2,
    verdict: error ? 'SETUP_ERROR' : ok ? 'FIXED_BEHAVIOUR_HOLDS' : 'DEFECT_PRESENT',
    headExpectation: { fail: HEAD_FAILS, matched: !error && complete && sameSet(failedIds, HEAD_FAILS) },
    classification: {
      writeGap: failedIds.filter((id) => HEAD_FAILS.includes(id)),
      openReadsP0: failedIds.filter((id) => id.startsWith('R.')),
      controlsOrRegressions: failedIds.filter((id) => !HEAD_FAILS.includes(id) && !id.startsWith('R.')),
    },
    error: error ? String(error.stack || error.message) : null,
    observed,
    answers: answers.reduce((acc, a) => ({ ...acc, [a.status]: (acc[a.status] || 0) + 1 }), {}),
    cleanup: cleaned,
    results,
  };
  try {
    fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
    fs.writeFileSync(RESULTS, `${JSON.stringify(out, null, 2)}\n`);
  } catch (e) {
    console.error(`could not write ${RESULTS}: ${e.message}`);
  }
  console.log(`\n${NAME}: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length} (fixed count ${EXPECTED_CHECKS})${complete ? '' : ` -- INCOMPLETE (missing ${missing.join(', ')})`}; HEAD expectation ${out.headExpectation.matched ? 'matched' : 'NOT matched'}${out.classification.openReadsP0.length ? `; P0 OPEN READS: ${out.classification.openReadsP0.join(', ')}` : ''}; exit ${out.exitCode}`);
  process.exitCode = out.exitCode;
};

main()
  .then(() => finish())
  .catch(async (error) => {
    console.error(`SCRIPT ERROR: ${error.stack || error.message}`);
    await finish(error);
  })
  .finally(() => {
    // The in-process app keeps database handles open; leave once the result is written.
    setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
  });
