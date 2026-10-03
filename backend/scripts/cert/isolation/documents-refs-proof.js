'use strict';

/**
 * The proof of the "documents-refs" pairs of the CERT-2 injection sweep: a
 * company's attachment, insurance certificate and specification index may
 * name only its own project's records and documents.
 *
 *   POST /projects/:id/attachments            recordId    = another company's bid package
 *   PUT  /projects/:id/commitments/:id/insurance  insurance[].documentId = another company's document
 *   POST /projects/:id/specifications/index   documentIds[] = another company's document
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/documents-refs-proof.js [attacker=001] [victim=002]
 *
 * Per pair, both ways round: the attacker company's own id is ACCEPTED (so a
 * fix that refused everything would fail here), the victim company's id is
 * REFUSED exactly as an id that exists nowhere is, and nothing naming it is
 * stored — not the attachment, its document, its photo, its audit row, its
 * outbound event or history snapshot, a queued job, a notification, a
 * commitment's insurance list or a specification section. No answer may be a
 * 500 or carry the victim's names, addresses, canaries or document text, and
 * the victim's data must not change in any table.
 *
 * The specification index never read another company's document (loadText
 * looks a document up within the caller's own organisation and project): a
 * foreign id is answered per document as "Document not found", exactly as an
 * id that exists nowhere, nothing is indexed, audited or returned. The proof
 * keeps that so.
 *
 * Each run makes its own specification documents, one in each company (a
 * text file attached to the company's own project), so no section of the
 * population is replaced. In process (CERT_INPROCESS=1), their text is
 * extracted here — the step the background worker would take — so the other
 * company's document has text ready to be read and the own one is indexed
 * into sections; through a server, the text stays pending and the own
 * document answers "not extracted yet".
 *
 * Exit code 0 when every case behaves, 2 otherwise.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { as, multipart } = require('../lib/api');
const { buildPopulation } = require('../lib/spec');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');

const ATTACKER = process.argv[2] || '001';
const VICTIM = process.argv[3] || '002';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const IN_PROCESS = process.env.CERT_INPROCESS === '1';
const STAMP = crypto.randomBytes(3).toString('hex');
/** A specification with three CSI sections, carrying a company's canary. */
const specText = (canary) =>
  [
    `PROJECT SPECIFICATION ${canary}`,
    'SECTION 03 30 00',
    'CAST-IN-PLACE CONCRETE',
    'PART 1 - GENERAL',
    `A. This section covers cast-in-place concrete for foundations and slabs. ${canary} concrete clause.`,
    'END OF SECTION',
    'SECTION 09 91 00',
    'PAINTING',
    'PART 1 - GENERAL',
    `A. This section covers surface preparation and field painting. ${canary} painting clause.`,
    'END OF SECTION',
    'SECTION 26 05 19',
    'LOW-VOLTAGE ELECTRICAL POWER CONDUCTORS AND CABLES',
    'PART 1 - GENERAL',
    `A. This section covers building wires and cables rated 600 V and less. ${canary} cable clause.`,
    'END OF SECTION',
  ].join('\n');
const results = [];
const answers = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const listOf = (data) => (Array.isArray(data) ? data : data?.items || data?.rows || []);
const said = (res) => `${res.status} ${res.body?.error?.code || ''} ${res.body?.error?.message || ''}`.trim();
const ok2xx = (res) => res.status >= 200 && res.status < 300;
const nowhere = () => crypto.randomUUID();

const main = async () => {
  const { companies } = buildPopulation();
  const attacker = companies.find((c) => c.code === ATTACKER);
  const victim = companies.find((c) => c.code === VICTIM);
  const projects = JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'projects.json'), 'utf8'));
  const AP_ID = Object.values(projects[ATTACKER] || {}).find((p) => p.id && p.depth === 'standard')?.id;
  const VP_ID = Object.values(projects[VICTIM] || {}).find((p) => p.id && p.depth === 'standard')?.id;
  if (!AP_ID || !VP_ID) throw new Error('both companies need a standard project (state/projects.json)');
  const AP = `/projects/${AP_ID}`;
  const VP = `/projects/${VP_ID}`;

  const atk = as(`pm@${attacker.domain}`);
  const vic = as(`pm@${victim.domain}`);
  const send = async (method, route, body, options) => {
    const res = await atk.send(method, route, body, options);
    answers.push({ route: `${method} ${route}`, status: res.status, text: res.text || '' });
    return res;
  };
  const fileForm = (fields, { filename = `documents-refs-proof-${STAMP}.pdf`, contentType = 'application/pdf', body = `%PDF-1.4 documents-refs proof ${STAMP}` } = {}) => ({
    form: multipart({ field: 'files', filename, contentType, body: Buffer.from(body), fields }),
  });
  const upload = (fields) => send('POST', `${AP}/attachments`, undefined, fileForm(fields));
  const made = async (who, method, route, body, label, options) => {
    const res = await who.send(method, route, body, options);
    if (!ok2xx(res)) throw new Error(`setup ${label}: ${said(res)}`);
    return res.body.data;
  };

  const db = await guard.connectCert();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0] || null;
  const orgOf = async (code) => (await one('select id::text as id from "Organisation" where slug like $1', [`cert-${code}-%`]))?.id;
  const atkOrg = await orgOf(ATTACKER);
  const vicOrg = await orgOf(VICTIM);

  /** A company's own specification document: a text file on its own project, its text extracted in process. */
  const specDocument = async (who, projectId, orgId, canary, label) => {
    const data = await made(who, 'POST', `/projects/${projectId}/attachments`, undefined, label, fileForm({ recordType: 'project', recordId: projectId, caption: canary }, { filename: `${canary}.txt`, contentType: 'text/plain', body: specText(canary) }));
    const documentId = listOf(data)[0]?.documentId;
    if (!documentId) throw new Error(`setup ${label}: the upload returned no document`);
    if (IN_PROCESS) {
      // The background worker's step, for a document this run made (the worker is off in process).
      // eslint-disable-next-line global-require
      const extracted = await require('../../../src/services/document-text.service').runDocumentExtractJob({ job: { orgId }, payload: { documentId } });
      if (extracted.status !== 'ready') throw new Error(`setup ${label}: text extraction ended ${extracted.status}`);
    }
    return documentId;
  };

  // ── the victim's ids, read or made as the victim ─────────────────────────
  const foreignPackage = listOf((await vic.send('GET', `${VP}/bids`)).body?.data)[0]?.id;
  const foreignTemplate = listOf((await vic.send('GET', `${VP}/forms/templates`)).body?.data)[0]?.id;
  const foreignCommitment = listOf((await vic.send('GET', `${VP}/commitments`)).body?.data)[0]?.id;
  if (!foreignPackage || !foreignTemplate || !foreignCommitment) {
    throw new Error(`the victim needs a bid package, a form template and a commitment: ${foreignPackage} ${foreignTemplate} ${foreignCommitment}`);
  }
  const victimCanary = `CANARY-${VICTIM}-PROOF-SPEC-${STAMP}`;
  const foreignDocument = await specDocument(vic, VP_ID, vicOrg, victimCanary, 'victim specification');
  const victimText = `${victimCanary} concrete clause`;
  // the victim indexes its own specification, so it has sections an intruder's index could replace
  const victimIndexed = await made(vic, 'POST', `${VP}/specifications/index`, { documentIds: [foreignDocument] }, 'victim index');
  if (IN_PROCESS && victimIndexed?.sections !== 3) throw new Error(`setup victim index: ${JSON.stringify(victimIndexed)}`);

  // ── the attacker's own ids ───────────────────────────────────────────────
  const ownPackage = listOf((await atk.send('GET', `${AP}/bids`)).body?.data)[0]?.id;
  const ownTemplate = listOf((await atk.send('GET', `${AP}/forms/templates`)).body?.data)[0]?.id;
  if (!ownPackage || !ownTemplate) throw new Error(`the attacker needs a bid package and a form template: ${ownPackage} ${ownTemplate}`);
  const ownSpecDocument = await specDocument(atk, AP_ID, atkOrg, `OWN-${ATTACKER}-PROOF-SPEC-${STAMP}`, 'own specification');
  const ownCommitment = await made(atk, 'POST', `${AP}/commitments`, { title: `documents-refs proof ${STAMP}`, type: 'subcontract' }, 'own commitment');

  // ── before ───────────────────────────────────────────────────────────────
  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const print = await fingerprint.take(db);
    await db.query('rollback');
    return print;
  };
  const before = await snapshot();
  // The product's timestamps are UTC without a zone: compare them with the database's clock in UTC, as text.
  const now = async () => (await one("select to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS.US') as t")).t;
  const victimSections = async () => one('select count(*)::int as n, max("updatedAt")::text as at from "SpecSection" where "documentId" = $1', [foreignDocument]);
  const victimSectionsBefore = await victimSections();
  const victimTextBefore = await one('select "updatedAt"::text as at, status from "DocumentText" where "documentId" = $1', [foreignDocument]);

  /** Rows of the attacker's company written since `from` that name any of these ids. */
  const TABLES = [
    ['Attachment', 'createdAt'], ['ProjectDocument', 'updatedAt'], ['Photo', 'updatedAt'], ['AuditEvent', 'createdAt'],
    ['OutboundEvent', 'createdAt'], ['RecordHistorySnapshot', 'createdAt'], ['BackgroundJob', 'createdAt'], ['Notification', 'createdAt'],
    ['Commitment', 'updatedAt'], ['SpecSection', 'updatedAt'], ['DocumentText', 'updatedAt'],
  ];
  const ownerOf = async (id) => {
    const row = await one(
      `select x.t, o.slug from (
          select 'bid_package' as t, "orgId" as org from "BidPackage" where id = $1
          union all select 'project_document', "orgId" from "ProjectDocument" where id = $1
          union all select 'commitment', "orgId" from "Commitment" where id = $1
          union all select 'form_template', "orgId" from "FormTemplate" where id = $1
          union all select 'project', "orgId" from "Project" where id = $1) x
        join "Organisation" o on o.id = x.org limit 1`,
      [id]
    );
    return row ? `${row.t} of ${row.slug}` : 'a record that exists nowhere';
  };
  const storedNaming = async (ids, from) => {
    const wanted = ids.map((id) => id.toLowerCase());
    const hits = [];
    for (const [table, at] of TABLES) {
      const rows = (await db.query(`select id::text as id, to_jsonb(t)::text as body from "${table}" t where t."orgId" = $1 and t."${at}" >= $2::timestamp and lower(to_jsonb(t)::text) ~ $3 limit 5`, [atkOrg, from, wanted.join('|')])).rows;
      for (const row of rows) {
        const named = wanted.filter((id) => row.body.toLowerCase().includes(id));
        hits.push({ table, id: row.id, body: row.body, names: await Promise.all(named.map(async (id) => `${id} (${await ownerOf(id)})`)) });
      }
    }
    return hits;
  };
  const shown = (hits) => hits.map((h) => `${h.table} ${h.id} names ${h.names.join(', ')}: ${h.body.slice(0, 160)}`).join('\n        ');

  console.log(`attacker ${ATTACKER} (${AP_ID}), victim ${VICTIM} (${VP_ID})${process.env.CERT_INPROCESS === '1' ? ', in process' : ''}\n`);

  // ── 1. POST /attachments recordId = another company's record ─────────────
  const attachmentsFrom = await now();
  const ownUpload = await upload({ recordType: 'bid_package', recordId: ownPackage, caption: `own package ${STAMP}` });
  check('attachments: a file on the company\'s own bid package is accepted (201)', ownUpload.status === 201, said(ownUpload));
  const ownDocument = listOf(ownUpload.body?.data)[0]?.documentId;
  const nowhereIds = [];
  const refused = async (label, attempt, foreign, expect) => {
    const away = nowhere();
    nowhereIds.push(away);
    const bad = await attempt(foreign);
    const none = await attempt(away);
    check(`${label}: another company's id is refused (404 ${expect})`, bad.status === 404 && bad.body?.error?.code === expect, said(bad));
    check(`${label}: …exactly as an id that exists nowhere`, said(bad) === said(none), `${said(bad)} | ${said(none)}`);
  };
  await refused('attachments: upload to bid_package', (id) => upload({ recordType: 'bid_package', recordId: id, caption: `probe ${STAMP}` }), foreignPackage, 'ATTACHMENT_RECORD_NOT_FOUND');
  if (ownDocument) {
    await refused('attachments: link an own document to bid_package', (id) => send('POST', `${AP}/attachments`, { recordType: 'bid_package', recordId: id, documentIds: [ownDocument] }), foreignPackage, 'ATTACHMENT_RECORD_NOT_FOUND');
  } else check('attachments: the own upload returned its document', false, ownUpload.text?.slice(0, 200));
  // the same check for every record type: a record found by its project, one found through its parent, the project itself
  await refused('attachments: upload to commitment', (id) => upload({ recordType: 'commitment', recordId: id }), foreignCommitment, 'ATTACHMENT_RECORD_NOT_FOUND');
  await refused('attachments: upload to form_template', (id) => upload({ recordType: 'form_template', recordId: id }), foreignTemplate, 'ATTACHMENT_RECORD_NOT_FOUND');
  await refused('attachments: upload to project', (id) => upload({ recordType: 'project', recordId: id }), VP_ID, 'ATTACHMENT_RECORD_NOT_FOUND');
  const ownCommitmentUpload = await upload({ recordType: 'commitment', recordId: ownCommitment.id });
  check('attachments: a file on the company\'s own commitment is accepted (201)', ownCommitmentUpload.status === 201, said(ownCommitmentUpload));
  const ownTemplateUpload = await upload({ recordType: 'form_template', recordId: ownTemplate });
  check('attachments: a file on the company\'s own form template is accepted (201)', ownTemplateUpload.status === 201, said(ownTemplateUpload));
  const ownProjectUpload = await upload({ recordType: 'project', recordId: AP_ID });
  check('attachments: a file on the company\'s own project is accepted (201)', ownProjectUpload.status === 201, said(ownProjectUpload));
  if (ownDocument) {
    const ownLink = await send('POST', `${AP}/attachments`, { recordType: 'commitment', recordId: ownCommitment.id, documentIds: [ownDocument] });
    check('attachments: linking an own document to an own record is accepted (201)', ownLink.status === 201, said(ownLink));
  }
  const attachmentHits = await storedNaming([foreignPackage, foreignCommitment, foreignTemplate, VP_ID, ...nowhereIds], attachmentsFrom);
  check('attachments: nothing names the refused records (attachment, document, photo, audit, outbound event, history, job, notification)', attachmentHits.length === 0, shown(attachmentHits));
  const listed = await send('GET', `${AP}/attachments?recordType=bid_package&recordId=${foreignPackage}`);
  const thisRun = listOf(listed.body?.data).filter((item) => JSON.stringify(item).includes(STAMP)); // its caption or its file's name
  check('attachments: the attacker lists no attachment of this run on the other company\'s bid package', ok2xx(listed) && thisRun.length === 0, `${said(listed)} ${thisRun.length} of ${listOf(listed.body?.data).length} item(s)`);

  // ── 2. insurance[].documentId = another company's document ───────────────
  const insuranceFrom = await now();
  const nowhereBefore = nowhereIds.length;
  const entry = (documentId) => ({ insurance: [{ type: 'general_liability', label: `proof ${STAMP}`, required: true, documentId, expiresAt: '2030-01-01' }] });
  const insurance = (id) => send('PUT', `${AP}/commitments/${ownCommitment.id}/insurance`, entry(id));
  if (ownDocument) {
    const ownIns = await insurance(ownDocument);
    check('insurance: a certificate that is the company\'s own document is accepted (200)', ownIns.status === 200 && ownIns.body?.data?.insurance?.[0]?.documentId === ownDocument, said(ownIns));
  }
  /** Read back: the commitment's insurance still names its own certificate, and only that. */
  const stillOwn = async (label) => {
    const stored = await one('select "insuranceJson"::text as j from "Commitment" where id = $1', [ownCommitment.id]);
    check(`insurance: after the refused ${label} the commitment still names only its own certificate`, Boolean(stored) && !stored.j.toLowerCase().includes(foreignDocument.toLowerCase()) && (!ownDocument || stored.j.includes(ownDocument)), stored?.j?.slice(0, 240));
  };
  await refused('insurance: PUT /insurance', insurance, foreignDocument, 'DOCUMENT_NOT_FOUND');
  await stillOwn('PUT');
  await refused('insurance: POST /commitments', (id) => send('POST', `${AP}/commitments`, { title: `documents-refs proof insured ${STAMP}`, type: 'subcontract', ...entry(id) }), foreignDocument, 'DOCUMENT_NOT_FOUND');
  await refused('insurance: PATCH /commitments/:id', (id) => send('PATCH', `${AP}/commitments/${ownCommitment.id}`, entry(id)), foreignDocument, 'DOCUMENT_NOT_FOUND');
  await stillOwn('PATCH');
  if (ownDocument) {
    const created = await send('POST', `${AP}/commitments`, { title: `documents-refs proof insured ${STAMP}`, type: 'subcontract', ...entry(ownDocument) });
    check('insurance: a new commitment insured by the company\'s own document is accepted (201)', created.status === 201, said(created));
    const patched = await send('PATCH', `${AP}/commitments/${ownCommitment.id}`, entry(ownDocument));
    check('insurance: an edit naming the company\'s own document is accepted (200)', patched.status === 200, said(patched));
  }
  const insuranceHits = await storedNaming([foreignDocument, ...nowhereIds.slice(nowhereBefore)], insuranceFrom);
  check('insurance: no commitment, audit row or event of the company names the refused document', insuranceHits.length === 0, shown(insuranceHits));

  // ── 3. specification index documentIds[] = another company's document ────
  const specFrom = await now();
  const index = (id) => send('POST', `${AP}/specifications/index`, { documentIds: [id] });
  const foreignIndex = await index(foreignDocument);
  const away = nowhere();
  const noneIndex = await index(away);
  const shape = (res, id) => JSON.stringify(res.body).split(id).join('<id>');
  check('spec index: another company\'s document is answered exactly as one that exists nowhere', foreignIndex.status === noneIndex.status && shape(foreignIndex, foreignDocument) === shape(noneIndex, away), `${foreignIndex.status} ${shape(foreignIndex, foreignDocument)} | ${noneIndex.status} ${shape(noneIndex, away)}`);
  const foreignRow = foreignIndex.body?.data?.documents?.[0];
  check('spec index: …as a document not found, with nothing indexed', foreignRow?.sections === 0 && foreignRow?.error === 'Document not found' && foreignIndex.body?.data?.sections === 0, foreignIndex.text?.slice(0, 200));
  check('spec index: the answer carries none of the other company\'s document text', !victimText || !foreignIndex.text.includes(victimText), victimText ? `probe "${victimText.slice(0, 30)}…"` : 'the victim document has no text to look for');
  const victimSectionsAfter = await victimSections();
  check('spec index: the other company\'s sections are untouched', JSON.stringify(victimSectionsAfter) === JSON.stringify(victimSectionsBefore), `${JSON.stringify(victimSectionsBefore)} -> ${JSON.stringify(victimSectionsAfter)}`);
  const victimTextAfter = await one('select "updatedAt"::text as at, status from "DocumentText" where "documentId" = $1', [foreignDocument]);
  check('spec index: the other company\'s document text is untouched', JSON.stringify(victimTextAfter) === JSON.stringify(victimTextBefore));
  const specHits = await storedNaming([foreignDocument, away], specFrom);
  check('spec index: no section, audit row or event of the company names the other company\'s document', specHits.length === 0, shown(specHits));
  const ownIndex = await index(ownSpecDocument);
  const ownRow = ownIndex.body?.data?.documents?.[0];
  if (IN_PROCESS) {
    check('spec index: the company\'s own document is indexed into its sections (200)', ownIndex.status === 200 && ownRow?.documentId === ownSpecDocument && ownRow?.error === null && ownRow?.sections === 3, `${said(ownIndex)} ${ownIndex.text?.slice(0, 240)}`);
  } else {
    // through a server the text is still pending: the own document is found, and answered "not extracted yet"
    check('spec index: the company\'s own document is found (200, text not extracted yet)', ownIndex.status === 200 && ownRow?.documentId === ownSpecDocument && /not been extracted/.test(ownRow?.error || ''), `${said(ownIndex)} ${ownIndex.text?.slice(0, 240)}`);
  }

  // ── after ────────────────────────────────────────────────────────────────
  const victimTraces = new RegExp([`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`].join('|'));
  const leaked = answers.filter((a) => victimTraces.test(a.text) || (victimText && a.text.includes(victimText)));
  check('no answer to the attacker carries the victim company\'s names, addresses, canaries or text', leaked.length === 0, leaked.slice(0, 5).map((a) => `${a.status} ${a.route}`).join(', '));
  const errors = answers.filter((a) => a.status >= 500);
  check('no answer is a server error', errors.length === 0, errors.slice(0, 5).map((a) => `${a.status} ${a.route}`).join(', '));
  const after = await snapshot();
  const moved = fingerprint.compare(before, after).filter((c) => !c.noise && c.org === VICTIM);
  check('the victim company\'s data did not change (every table)', moved.length === 0, moved.slice(0, 8).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
  await db.end();

  const failed = results.filter((r) => !r.ok);
  console.log(`\ndocuments-refs proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
