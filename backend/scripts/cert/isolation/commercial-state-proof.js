'use strict';

/**
 * The proof of the CERT-2 commercial pairs the injection sweep could not
 * judge: every replay was refused by the attacker company's OWN record state
 * (409 locked / approved / transition invalid / duplicate invoice) or its own
 * billing (402) before the product looked at the foreign id.
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/commercial-state-proof.js [attacker=047] [victim=048]
 *
 * The pairs (results/isolation gap list, the code that hid each one):
 *   POST  /projects/{projectId}/direct-costs                           lines[].costCodeId          409 DIRECT_COST_DUPLICATE_INVOICE
 *   PATCH /projects/{projectId}/pay-apps/{payAppId}                    lines[].sovLineId           409 SUB_PAY_APP_LOCKED
 *   PUT   /projects/{projectId}/commitments/{commitmentId}/lines       lines[].costCodeId | budgetLineId | boqItemId | activityId   409 COMMITMENT_LOCKED
 *   POST  /projects/{projectId}/commitments/{commitmentId}/execute     documentId                  409 COMMITMENT_TRANSITION_INVALID
 *   PATCH /projects/{projectId}/change-orders/{id}                     budgetLineId | activityLinks[].activityId | documentIds[]   409 CHANGE_ORDER_APPROVED_LOCKED
 *
 * For each pair the attacker company's own people first build a record in the
 * state where the request is legitimately accepted — a unique invoice number,
 * a fresh draft commitment, a freshly approved commitment, a fresh draft
 * payment application on a freshly executed commitment, a fresh draft change
 * order — and then, on that same open record:
 *   ALLOWED  the attacker's own id is accepted and stored (read back from the database);
 *   REFUSED  the victim company's id (proven to be the victim's) is refused with
 *            a 4xx, never a 5xx, with exactly the status, code and message an id
 *            that exists nowhere gets; nothing is stored (the record is read
 *            back, and no row of the attacker company names the id afterwards);
 *            the answer does not carry the id;
 *   OPEN     the record is still open afterwards: the own id is accepted again.
 * The change-order pair's activity reaches the order's own row as well
 * (ChangeOrder.activityId, a foreign key) and arrives three ways — activityLinks,
 * affectedActivityIds, activityId — on this route and on the create route; all
 * six are proven with the same checks. Before the fix an id that exists nowhere
 * failed on that key (500 P2003) where another company's activity was refused
 * (400 CHANGE_ORDER_ACTIVITY_NOT_FOUND): the answer told which ids exist.
 * A payment application's claim names a line of its own commitment's schedule
 * of values; a claim for any other line is dropped (the application has no
 * line to put it on). For that pair the victim's line must be dropped exactly
 * as a line that exists nowhere is, with nothing stored and nothing returned.
 *
 * No answer may be a 500 or carry the victim's ids, names, addresses or
 * canaries; nothing the run wrote for the attacker company (audit,
 * notifications, outbound events, jobs) may name a victim id; and the victim
 * company's data must not change in any table.
 *
 * Exit code 0 when every check holds, 2 otherwise.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { as, multipart } = require('../lib/api');
const { buildPopulation } = require('../lib/spec');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');

const ATTACKER = process.argv[2] || '047';
const VICTIM = process.argv[3] || '048';
const GROUP = 'commercial';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `CSP-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const INPROCESS = process.env.CERT_INPROCESS === '1';
const results = [];
const answers = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const said = (res) => `${res.status} ${res.body?.error?.code || ''} ${res.body?.error?.message || ''}`.trim();
const ok2xx = (res) => res.status >= 200 && res.status < 300;
const nowhere = () => crypto.randomUUID();
const today = () => new Date().toISOString().slice(0, 10);

// In process, the product's local e-mail transport writes each message to the
// console: they are counted and kept out of the proof's output.
const emails = [];
const print = console.log.bind(console);
console.log = (...args) => {
  const text = args.map(String).join(' ');
  if (text.startsWith('[email:local]')) {
    emails.push(text.split('\n')[0]);
    return;
  }
  print(...args);
};

/** A one-page PDF that says `text` (as the change-cost driver makes them). */
const pdf = (text) => {
  const safe = String(text).replace(/[()\\]/g, ' ');
  const stream = `BT /F1 11 Tf 40 760 Td (${safe}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
};

/** The company that owns a record, read from the database (its organisation id). */
const OWNER_SQL = {
  CostCode: 'select "orgId" as org from "CostCode" where id = $1',
  BudgetLine: 'select p."orgId" as org from "BudgetLine" t join "Project" p on p.id = t."projectId" where t.id = $1',
  BoqItem: 'select p."orgId" as org from "BoqItem" t join "Project" p on p.id = t."projectId" where t.id = $1',
  Activity: 'select p."orgId" as org from "Activity" t join "Project" p on p.id = t."projectId" where t.id = $1',
  ProjectDocument: 'select p."orgId" as org from "ProjectDocument" t join "Project" p on p.id = t."projectId" where t.id = $1',
  CommitmentSovLine: 'select p."orgId" as org from "CommitmentSovLine" t join "Project" p on p.id = t."projectId" where t.id = $1',
  Company: 'select "orgId" as org from "Company" where id = $1',
};

/** Every column of the attacker company's commercial rows that one of these requests could fill with an id. */
const REF_COLUMNS = [
  ['DirectCostLine', 'costCodeId'],
  ['DirectCostLine', 'budgetLineId'],
  ['DirectCostLine', 'activityId'],
  ['CommitmentSovLine', 'costCodeId'],
  ['CommitmentSovLine', 'budgetLineId'],
  ['CommitmentSovLine', 'boqItemId'],
  ['CommitmentSovLine', 'activityId'],
  ['Commitment', 'executedDocumentId'],
  ['SubPayAppLine', 'sovLineId'],
  ['ChangeOrder', 'budgetLineId'],
  ['ChangeOrder', 'activityId'],
  ['ChangeOrderActivityLink', 'activityId'],
  ['CommercialAttachmentRef', 'documentId'],
];

/** Strips what differs between two identical answers given a moment apart. */
const VOLATILE = new Set(['updatedAt', 'createdAt', 'requestId']);
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !VOLATILE.has(k)).map(([k, v]) => [k, stable(v)]));
  return value;
};

const main = async () => {
  console.log(`attacker ${ATTACKER}, victim ${VICTIM}, stamp ${STAMP}${INPROCESS ? ', in process (the working tree\'s code)' : ' — NOT in process: this asks the running API, which does not run the working tree\'s code'}\n`);
  const { companies } = buildPopulation();
  const attacker = companies.find((c) => c.code === ATTACKER);
  const victim = companies.find((c) => c.code === VICTIM);
  if (!attacker || !victim) throw new Error(`unknown company ${ATTACKER} or ${VICTIM}`);

  const db = await guard.connectCert();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args) => (await q(sql, args))[0]?.id || null;
  const orgOf = async (code) => (await q('select id, name from "Organisation" where slug like $1', [`cert-${code}-%`]))[0] || null;
  const atkOrg = await orgOf(ATTACKER);
  const vicOrg = await orgOf(VICTIM);
  if (!atkOrg || !vicOrg) throw new Error('both companies must exist in the certification database');
  const [{ started }] = await q('select now() as started');
  const ownerOf = async (table, id) => (await q(OWNER_SQL[table], [id]))[0]?.org || null;

  // ── the attacker's project and own ids ──────────────────────────────────
  const inv = JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'inventory', `${ATTACKER}.json`), 'utf8'));
  const candidates = Object.values(inv.projects).filter((p) => p.depth === 'standard' && p.refs?.commitments && p.refs?.budgetLines && p.refs?.activities && p.refs?.boq).map((p) => p.id);
  const projectId = await one(`select id from "Project" where id = any($1::text[]) and "orgId" = $2 and status = 'active' order by "createdAt" limit 1`, [candidates, atkOrg.id]);
  if (!projectId) throw new Error(`company ${ATTACKER} has no active standard project`);
  const AP = `/projects/${projectId}`;
  const own = {
    CostCode: await one('select pc."costCodeId" as id from "ProjectCostCode" pc join "CostCode" c on c.id = pc."costCodeId" where pc."projectId" = $1 and c."orgId" = $2 order by c.code limit 1', [projectId, atkOrg.id]),
    BudgetLine: await one(`select id from "BudgetLine" where "projectId" = $1 and status = 'active' order by "createdAt" limit 1`, [projectId]),
    BoqItem: await one('select id from "BoqItem" where "projectId" = $1 order by "createdAt" limit 1', [projectId]),
    Activity: await one('select id from "Activity" where "projectId" = $1 and "isActive" order by "createdAt" limit 1', [projectId]),
    Company: await one('select id from "Company" where id = $1 and "orgId" = $2 and "isVendor"', [inv.company.refs?.directory?.subcontractor || null, atkOrg.id]),
  };
  // ── the victim's ids of each kind ───────────────────────────────────────
  const foreign = {
    CostCode: await one('select id from "CostCode" where "orgId" = $1 order by code limit 1', [vicOrg.id]),
    BudgetLine: await one(`select t.id from "BudgetLine" t join "Project" p on p.id = t."projectId" where p."orgId" = $1 and t.status = 'active' order by t."createdAt" limit 1`, [vicOrg.id]),
    BoqItem: await one('select t.id from "BoqItem" t join "Project" p on p.id = t."projectId" where p."orgId" = $1 order by t."createdAt" limit 1', [vicOrg.id]),
    Activity: await one('select t.id from "Activity" t join "Project" p on p.id = t."projectId" where p."orgId" = $1 and t."isActive" order by t."createdAt" limit 1', [vicOrg.id]),
    ProjectDocument: await one(`select t.id from "ProjectDocument" t join "Project" p on p.id = t."projectId" where p."orgId" = $1 and t."scanStatus" = 'clean' order by t."createdAt" limit 1`, [vicOrg.id]),
    CommitmentSovLine: await one('select t.id from "CommitmentSovLine" t join "Project" p on p.id = t."projectId" where p."orgId" = $1 order by t."createdAt" limit 1', [vicOrg.id]),
  };
  check(`setup: project ${projectId} is company ${ATTACKER}'s, active`, true);
  for (const [table, id] of Object.entries(own)) {
    const org = id ? await ownerOf(table, id) : null;
    check(`setup: own ${table} ${id} is company ${ATTACKER}'s`, Boolean(id) && org === atkOrg.id, `owner ${org}`);
  }
  for (const [table, id] of Object.entries(foreign)) {
    const org = id ? await ownerOf(table, id) : null;
    check(`setup: foreign ${table} ${id} is company ${VICTIM}'s`, Boolean(id) && org === vicOrg.id, `owner ${org}`);
  }
  if (results.some((r) => !r.ok)) throw new Error('setup incomplete');
  const foreignIds = Object.values(foreign);

  /** Rows of the attacker company that name `id` in any column these requests write. */
  const namedByAttacker = async (id) => {
    const where = [];
    for (const [table, column] of REF_COLUMNS) {
      const n = Number((await q(`select count(*)::int n from "${table}" t join "Project" p on p.id = t."projectId" where p."orgId" = $1 and t."${column}" = $2`, [atkOrg.id, id]))[0].n);
      if (n) where.push(`${table}.${column} x${n}`);
    }
    const split = Number((await q('select count(*)::int n from "ChangeOrder" t join "Project" p on p.id = t."projectId" where p."orgId" = $1 and t."budgetAllocationsJson"::text like $2', [atkOrg.id, `%${id}%`]))[0].n);
    if (split) where.push(`ChangeOrder.budgetAllocationsJson x${split}`);
    return where;
  };
  const namedBefore = {};
  for (const id of foreignIds) namedBefore[id] = await namedByAttacker(id);

  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const shot = await fingerprint.take(db);
    await db.query('rollback');
    return shot;
  };
  const before = await snapshot();

  const people = Object.fromEntries(['pm', 'qs', 'cost', 'procurement', 'finance'].map((who) => [who, as(`${who}@${attacker.domain}`)]));
  const send = async (who, method, route, body) => {
    const res = await people[who].send(method, route, body);
    answers.push({ route: `${who} ${method} ${route}`, status: res.status, text: res.text || '' });
    return res;
  };
  const uploadOwn = async (who, recordType, recordId, tag) => {
    const res = await people[who].send('POST', `${AP}/attachments`, undefined, {
      form: multipart({ field: 'files', filename: `proof-${tag}-${STAMP}.pdf`, contentType: 'application/pdf', body: pdf(`Proof ${tag} ${STAMP}`), fields: { recordType, recordId } }),
    });
    answers.push({ route: `${who} POST ${AP}/attachments`, status: res.status, text: res.text || '' });
    const data = res.body?.data;
    const rows = Array.isArray(data) ? data : data?.items || data?.attachments || [];
    const documentId = rows[0]?.documentId ?? rows[0]?.document?.id ?? null;
    return { res, documentId };
  };

  /**
   * The refusal checks for one pair: `bad` carried the victim's id, `none` an
   * id that exists nowhere. `kept` says the open record still holds only its
   * own ids, read back from the database after both requests.
   */
  const refused = async (label, foreignId, bad, none, kept) => {
    check(`${label}: company ${VICTIM}'s id is refused with a 4xx (never a 5xx)`, bad.status >= 400 && bad.status < 500, said(bad));
    check(`${label}: …exactly as an id that exists nowhere (status, code and message)`, said(bad) === said(none), `${said(bad)} | ${said(none)}`);
    check(`${label}: …the record keeps its own ids, nothing of the request stored`, kept.ok, kept.detail);
    const named = (await namedByAttacker(foreignId)).filter((w) => !namedBefore[foreignId].includes(w));
    check(`${label}: …no row of company ${ATTACKER} names the foreign id`, named.length === 0, named.length ? `STORED: ${named.join(', ')} -> company ${VICTIM}'s record` : '');
    check(`${label}: …and the answer does not carry it`, !(bad.text || '').includes(foreignId), `${bad.status}`);
  };

  // ── 1. direct costs: lines[].costCodeId ─────────────────────────────────
  {
    const label = 'POST direct-costs lines[].costCodeId';
    const invoice = (tag) => `${STAMP}-${tag}`;
    const body = (tag, costCodeId) => ({
      type: 'invoice',
      description: `Proof invoice ${tag} ${STAMP}`,
      costDate: today(),
      vendorName: `Proof vendor ${STAMP}`,
      invoiceNumber: invoice(tag),
      tax: 0,
      lines: [{ description: `Proof line ${tag} ${STAMP}`, costCodeId, costType: 'material', quantity: 2, unit: 'nr', unitCost: 50 }],
    });
    const stored = async (tag) => {
      const row = (await q('select id from "DirectCost" where "projectId" = $1 and "invoiceNumber" = $2', [projectId, invoice(tag)]))[0] || null;
      const lines = row ? await q('select "costCodeId" from "DirectCostLine" where "directCostId" = $1', [row.id]) : [];
      return { row, lines };
    };
    const ok = await send('cost', 'POST', `${AP}/direct-costs`, body('OWN', own.CostCode));
    const mine = await stored('OWN');
    check(`${label}: a fresh invoice number with the company's own cost code is accepted (201) and stored`, ok.status === 201 && mine.lines.length === 1 && mine.lines[0].costCodeId === own.CostCode, `${said(ok)}; stored ${JSON.stringify(mine.lines)}`);
    const bad = await send('cost', 'POST', `${AP}/direct-costs`, body('FOREIGN', foreign.CostCode));
    const none = await send('cost', 'POST', `${AP}/direct-costs`, body('NOWHERE', nowhere()));
    const badRow = await stored('FOREIGN');
    const noneRow = await stored('NOWHERE');
    await refused(label, foreign.CostCode, bad, none, {
      ok: !badRow.row && !noneRow.row,
      detail: badRow.row ? `STORED: DirectCost ${badRow.row.id} lines ${JSON.stringify(badRow.lines)}` : noneRow.row ? `STORED: DirectCost ${noneRow.row.id}` : '',
    });
    const again = await send('cost', 'POST', `${AP}/direct-costs`, body('OWN-AGAIN', own.CostCode));
    check(`${label}: …and the same request with a fresh invoice and the own cost code is still accepted`, again.status === 201, said(again));
  }

  // ── 2. commitment schedule of values: PUT lines ─────────────────────────
  const sov = (over = {}) => ({ lineNumber: 1, description: `Proof SOV line ${STAMP}`, costCodeId: own.CostCode, budgetLineId: own.BudgetLine, boqItemId: own.BoqItem, activityId: own.Activity, unit: 'nr', qty: 10, rate: 100, ...over });
  const newCommitment = async (tag) => send('qs', 'POST', `${AP}/commitments`, { type: 'subcontract', title: `Proof ${tag} ${STAMP}`, vendorCompanyId: own.Company, retentionRate: 5, lines: [sov({ description: `Proof ${tag} line ${STAMP}` })] });
  const commitmentRow = async (id) => (await q('select status, "executedDocumentId" from "Commitment" where id = $1', [id]))[0] || {};
  const sovLines = async (id) => q('select id, description, "costCodeId", "budgetLineId", "boqItemId", "activityId" from "CommitmentSovLine" where "commitmentId" = $1 order by "lineNumber"', [id]);
  {
    const created = await newCommitment('SOV');
    const commitmentId = created.body?.data?.id;
    check('setup: a fresh draft commitment', created.status === 201 && (await commitmentRow(commitmentId)).status === 'draft', said(created));
    const LP = `${AP}/commitments/${commitmentId}/lines`;
    const ownDesc = `Own SOV ${STAMP}`;
    const ok = await send('procurement', 'PUT', LP, { lines: [sov({ description: ownDesc })] });
    const lines = await sovLines(commitmentId);
    const ownStored = lines.length === 1 && lines[0].description === ownDesc && lines[0].costCodeId === own.CostCode && lines[0].budgetLineId === own.BudgetLine && lines[0].boqItemId === own.BoqItem && lines[0].activityId === own.Activity;
    check('PUT commitments/{id}/lines: the company\'s own cost code, budget line, BOQ item and activity are accepted (200) and stored', ok.status === 200 && ownStored, `${said(ok)}; stored ${JSON.stringify(lines)}`);
    for (const [field, table] of [['costCodeId', 'CostCode'], ['budgetLineId', 'BudgetLine'], ['boqItemId', 'BoqItem'], ['activityId', 'Activity']]) {
      const label = `PUT commitments/{id}/lines lines[].${field}`;
      const bad = await send('procurement', 'PUT', LP, { lines: [sov({ description: `Foreign ${field} ${STAMP}`, [field]: foreign[table] })] });
      const none = await send('procurement', 'PUT', LP, { lines: [sov({ description: `Nowhere ${field} ${STAMP}`, [field]: nowhere() })] });
      const after = await sovLines(commitmentId);
      const kept = after.length === 1 && after[0].description === ownDesc && after[0][field] === own[table];
      await refused(label, foreign[table], bad, none, { ok: kept, detail: kept ? '' : `the commitment's lines now ${JSON.stringify(after)}` });
    }
    const again = await send('procurement', 'PUT', LP, { lines: [sov({ description: `Own again ${STAMP}` })] });
    check('PUT commitments/{id}/lines: …the commitment is still a draft and its own ids are still accepted', again.status === 200 && (await commitmentRow(commitmentId)).status === 'draft', said(again));
  }

  // ── 3. executing a commitment: documentId ───────────────────────────────
  const approvedCommitment = async (tag) => {
    const created = await newCommitment(tag);
    const id = created.body?.data?.id;
    const submitted = id ? await send('qs', 'POST', `${AP}/commitments/${id}/submit`, {}) : null;
    const approved = id ? await send('pm', 'POST', `${AP}/commitments/${id}/approve`, {}) : null;
    const row = id ? await commitmentRow(id) : {};
    check(`setup: commitment ${tag} built, submitted and approved by the company's own people`, created.status === 201 && submitted?.status === 200 && approved?.status === 200 && row.status === 'approved', `${said(created)} / ${submitted ? said(submitted) : '-'} / ${approved ? said(approved) : '-'} -> ${row.status}`);
    return id;
  };
  let executedId = null;
  {
    const label = 'POST commitments/{id}/execute documentId';
    // ALLOWED, first: a freshly approved commitment executed with the company's own document.
    const first = await approvedCommitment('EXEC-OWN');
    const firstDoc = await uploadOwn('pm', 'commitment', first, 'executed-own');
    check('setup: the company\'s own executed agreement uploaded', ok2xx(firstDoc.res) && Boolean(firstDoc.documentId), said(firstDoc.res));
    const ok = await send('pm', 'POST', `${AP}/commitments/${first}/execute`, { documentId: firstDoc.documentId });
    const firstRow = await commitmentRow(first);
    check(`${label}: an approved commitment with the company's own document is executed (200) and the document stored`, ok.status === 200 && firstRow.status === 'executed' && firstRow.executedDocumentId === firstDoc.documentId, `${said(ok)}; now ${JSON.stringify(firstRow)}`);
    executedId = firstRow.status === 'executed' ? first : null;
    // REFUSED on a second approved commitment, which is then executed with its own document.
    const second = await approvedCommitment('EXEC-FOREIGN');
    const bad = await send('pm', 'POST', `${AP}/commitments/${second}/execute`, { documentId: foreign.ProjectDocument });
    const none = await send('pm', 'POST', `${AP}/commitments/${second}/execute`, { documentId: nowhere() });
    const after = await commitmentRow(second);
    await refused(label, foreign.ProjectDocument, bad, none, { ok: after.status === 'approved' && !after.executedDocumentId, detail: `the commitment is now ${JSON.stringify(after)}` });
    const secondDoc = await uploadOwn('pm', 'commitment', second, 'executed-own-2');
    const again = await send('pm', 'POST', `${AP}/commitments/${second}/execute`, { documentId: secondDoc.documentId });
    const finalRow = await commitmentRow(second);
    check(`${label}: …the same commitment was open: its own document executes it`, again.status === 200 && finalRow.status === 'executed' && finalRow.executedDocumentId === secondDoc.documentId, `${said(again)}; ${JSON.stringify(finalRow)}`);
  }

  // ── 4. a payment application's claims: lines[].sovLineId ───────────────
  {
    const label = 'PATCH pay-apps/{id} lines[].sovLineId';
    const created = executedId ? await send('qs', 'POST', `${AP}/pay-apps`, { commitmentId: executedId, periodLabel: `Proof ${STAMP}`, notes: `Proof ${STAMP}` }) : { status: 0 };
    const payAppId = created.body?.data?.id;
    const payAppLines = async () => q('select "sovLineId", "thisPeriodAmount"::float8 as amount, notes from "SubPayAppLine" where "payAppId" = $1 order by "sortOrder"', [payAppId]);
    const status = async () => (await q('select status from "SubPayApp" where id = $1', [payAppId]))[0]?.status;
    check('setup: a fresh draft payment application on the freshly executed commitment', created.status === 201 && (await status()) === 'draft', said(created));
    const ownSov = (await sovLines(executedId))[0]?.id;
    const PP = `${AP}/pay-apps/${payAppId}`;
    const ok = await send('qs', 'PATCH', PP, { lines: [{ sovLineId: ownSov, thisPeriodAmount: 100, notes: `Own claim ${STAMP}` }] });
    const mine = await payAppLines();
    const ownStored = mine.length === 1 && mine[0].sovLineId === ownSov && mine[0].amount === 100 && mine[0].notes === `Own claim ${STAMP}`;
    check(`${label}: a claim on the commitment's own line is accepted (200) and stored on that line`, ok.status === 200 && ownStored, `${said(ok)}; lines ${JSON.stringify(mine)}`);
    const claim = (sovLineId, tag) => ({ lines: [{ sovLineId, thisPeriodAmount: 37, notes: `${tag} claim ${STAMP}` }] });
    const bad = await send('qs', 'PATCH', PP, claim(foreign.CommitmentSovLine, 'Foreign'));
    const none = await send('qs', 'PATCH', PP, claim(nowhere(), 'Nowhere'));
    const after = await payAppLines();
    const kept = after.length === 1 && after[0].sovLineId === ownSov && after[0].amount === 100 && after[0].notes === `Own claim ${STAMP}`;
    check(`${label}: company ${VICTIM}'s line is answered exactly as a line that exists nowhere (status and whole answer)`, bad.status === none.status && JSON.stringify(stable(bad.body)) === JSON.stringify(stable(none.body)), `${said(bad)} | ${said(none)}`);
    check(`${label}: …never a 5xx`, bad.status < 500 && none.status < 500, `${bad.status} / ${none.status}`);
    check(`${label}: …the claim lands nowhere: the application keeps its one line, its own claim`, kept, `lines now ${JSON.stringify(after)}`);
    const named = (await namedByAttacker(foreign.CommitmentSovLine)).filter((w) => !namedBefore[foreign.CommitmentSovLine].includes(w));
    check(`${label}: …no row of company ${ATTACKER} names the foreign line`, named.length === 0, named.join(', '));
    check(`${label}: …and the answer does not carry it`, !(bad.text || '').includes(foreign.CommitmentSovLine), `${bad.status}`);
    const again = await send('qs', 'PATCH', PP, { lines: [{ sovLineId: ownSov, thisPeriodAmount: 120, notes: `Own claim again ${STAMP}` }] });
    check(`${label}: …the application is still a draft and its own line is still claimed`, again.status === 200 && (await status()) === 'draft' && (await payAppLines())[0]?.amount === 120, said(again));
  }

  // ── 5. change orders: budgetLineId, activityLinks[].activityId, documentIds[] ──
  {
    const created = await send('qs', 'POST', `${AP}/change-orders`, { description: `Proof change ${STAMP}`, value: 1500, category: 'variation' });
    const coId = created.body?.data?.id;
    const coRow = async () => (await q('select status, "budgetLineId", "activityId", "budgetAllocationsJson"::text as split from "ChangeOrder" where id = $1', [coId]))[0] || {};
    const coLinks = async () => (await q('select "activityId" from "ChangeOrderActivityLink" where "changeOrderId" = $1 order by "activityId"', [coId])).map((r) => r.activityId);
    const coDocs = async () => (await q(`select "documentId" from "CommercialAttachmentRef" where "recordType" = 'change_order' and "recordId" = $1 order by "documentId"`, [coId])).map((r) => r.documentId);
    check('setup: a fresh draft change order', created.status === 201 && (await coRow()).status === 'draft', said(created));
    const doc = await uploadOwn('qs', 'change_order', coId, 'change-order');
    check('setup: the company\'s own supporting document uploaded on it', ok2xx(doc.res) && Boolean(doc.documentId), said(doc.res));
    const CP = `${AP}/change-orders/${coId}`;
    const body = (over = {}) => ({
      budgetLineId: own.BudgetLine,
      scheduleImpact: 2,
      scheduleImpactSummary: `2 working days ${STAMP}`,
      costImpactSummary: `1500 added ${STAMP}`,
      activityLinks: [{ activityId: own.Activity, relationType: 'impacted', scheduleImpactDays: 2, costImpact: 1500, impactBasis: `Proof ${STAMP}` }],
      documentIds: [doc.documentId],
      ...over,
    });
    const ok = await send('qs', 'PATCH', CP, body());
    const row = await coRow();
    const ownStored = row.budgetLineId === own.BudgetLine && row.activityId === own.Activity && JSON.stringify(await coLinks()) === JSON.stringify([own.Activity]) && JSON.stringify(await coDocs()) === JSON.stringify([doc.documentId]);
    check('PATCH change-orders/{id}: the company\'s own budget line, activity and document are accepted (200) and stored', ok.status === 200 && ownStored, `${said(ok)}; row ${JSON.stringify(row)}, links ${JSON.stringify(await coLinks())}, documents ${JSON.stringify(await coDocs())}`);
    const FIELDS = [
      ['budgetLineId', 'BudgetLine', (id) => ({ budgetLineId: id })],
      ['activityLinks[].activityId', 'Activity', (id) => ({ activityLinks: [{ activityId: id, relationType: 'impacted', scheduleImpactDays: 2, costImpact: 1500, impactBasis: `Proof ${STAMP}` }] })],
      ['documentIds[]', 'ProjectDocument', (id) => ({ documentIds: [id] })],
    ];
    for (const [field, table, over] of FIELDS) {
      const label = `PATCH change-orders/{id} ${field}`;
      const bad = await send('qs', 'PATCH', CP, body(over(foreign[table])));
      const none = await send('qs', 'PATCH', CP, body(over(nowhere())));
      const after = await coRow();
      const links = await coLinks();
      const docs = await coDocs();
      const kept = after.status === 'draft' && after.budgetLineId === own.BudgetLine && after.activityId === own.Activity && !after.split.includes(foreign[table]) && JSON.stringify(links) === JSON.stringify([own.Activity]) && JSON.stringify(docs) === JSON.stringify([doc.documentId]);
      await refused(label, foreign[table], bad, none, { ok: kept, detail: kept ? '' : `row ${JSON.stringify(after)}, links ${JSON.stringify(links)}, documents ${JSON.stringify(docs)}` });
    }
    // The order's own row names an activity too (ChangeOrder.activityId, a
    // foreign key), from activityLinks, affectedActivityIds or activityId, on
    // this route and on the create route: each way is refused alike.
    const SAME_GUARD = [
      ['activityId', (id) => ({ activityId: id, activityLinks: undefined })],
      ['affectedActivityIds[]', (id) => ({ affectedActivityIds: [id], activityLinks: undefined })],
    ];
    for (const [field, over] of SAME_GUARD) {
      const label = `PATCH change-orders/{id} ${field} (the same activity guard)`;
      const bad = await send('qs', 'PATCH', CP, body(over(foreign.Activity)));
      const none = await send('qs', 'PATCH', CP, body(over(nowhere())));
      const after = await coRow();
      const links = await coLinks();
      const kept = after.status === 'draft' && after.activityId === own.Activity && JSON.stringify(links) === JSON.stringify([own.Activity]);
      await refused(label, foreign.Activity, bad, none, { ok: kept, detail: kept ? '' : `row ${JSON.stringify(after)}, links ${JSON.stringify(links)}` });
    }
    const again = await send('qs', 'PATCH', CP, body({ scheduleImpactSummary: `3 working days ${STAMP}` }));
    check('PATCH change-orders/{id}: …the change order is still a draft and its own ids are still accepted', again.status === 200 && (await coRow()).status === 'draft', said(again));

    const CREATE = [
      ['activityLinks[].activityId', (id) => ({ activityLinks: [{ activityId: id, relationType: 'impacted', scheduleImpactDays: 1, costImpact: 10 }] })],
      ['activityId', (id) => ({ activityId: id })],
      ['affectedActivityIds[]', (id) => ({ affectedActivityIds: [id] })],
    ];
    const byDescription = async (description) => (await q('select id, "activityId" from "ChangeOrder" where "projectId" = $1 and description = $2', [projectId, description]))[0] || null;
    for (const [field, over] of CREATE) {
      const label = `POST change-orders ${field} (the same activity guard)`;
      const ownDesc = `Proof create own ${field} ${STAMP}`;
      const ok = await send('qs', 'POST', `${AP}/change-orders`, { description: ownDesc, value: 10, ...over(own.Activity) });
      const mine = await byDescription(ownDesc);
      check(`${label}: the company's own activity is accepted (201) and stored on the order`, ok.status === 201 && mine?.activityId === own.Activity, `${said(ok)}; stored ${mine?.activityId ?? 'nothing'}`);
      const badDesc = `Proof create foreign ${field} ${STAMP}`;
      const noneDesc = `Proof create nowhere ${field} ${STAMP}`;
      const bad = await send('qs', 'POST', `${AP}/change-orders`, { description: badDesc, value: 10, ...over(foreign.Activity) });
      const none = await send('qs', 'POST', `${AP}/change-orders`, { description: noneDesc, value: 10, ...over(nowhere()) });
      const badRow = await byDescription(badDesc);
      const noneRow = await byDescription(noneDesc);
      await refused(label, foreign.Activity, bad, none, { ok: !badRow && !noneRow, detail: badRow ? `STORED: ChangeOrder ${badRow.id} .activityId = ${badRow.activityId}` : noneRow ? `STORED: ChangeOrder ${noneRow.id}` : '' });
    }
  }

  // ── after ──────────────────────────────────────────────────────────────
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const victimTraces = new RegExp([`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`, escape(vicOrg.name.replace(/\s*\(CERT-\d{3}\)$/, '')), ...foreignIds].join('|'));
  const leaked = answers.filter((a) => victimTraces.test(a.text));
  check(`no answer to company ${ATTACKER} carries company ${VICTIM}'s ids, names, addresses or canaries`, leaked.length === 0, leaked.slice(0, 6).map((a) => `${a.status} ${a.route} -> ${(a.text.match(victimTraces) || [])[0]}`).join('\n        '));
  const errors = answers.filter((a) => a.status >= 500);
  check('no answer is a server error', errors.length === 0, errors.slice(0, 6).map((a) => `${a.status} ${a.route} ${a.text.slice(0, 160)}`).join('\n        '));
  const idPattern = foreignIds.join('|');
  const written = [];
  for (const table of ['AuditEvent', 'Notification', 'OutboundEvent', 'BackgroundJob']) {
    const n = Number((await q(`select count(*)::int n from "${table}" t where t."orgId" = $1 and t."createdAt" >= $2 and t::text ~ $3`, [atkOrg.id, started, idPattern]))[0].n);
    if (n) written.push(`${table} x${n}`);
  }
  check(`nothing the run wrote for company ${ATTACKER} (audit, notifications, outbound events, jobs) names a victim id`, written.length === 0, written.join(', '));
  const victimMail = emails.filter((line) => line.includes(`@c${VICTIM}.`));
  check(`no e-mail went to company ${VICTIM}`, victimMail.length === 0, victimMail.slice(0, 3).join(' | '));
  const after = await snapshot();
  const moved = fingerprint.compare(before, after).filter((c) => !c.noise && c.org === VICTIM);
  check(`company ${VICTIM}'s data did not change (every table)`, moved.length === 0, moved.slice(0, 8).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
  await db.end();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${GROUP} state proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${GROUP} state proof: ${results.length - failed.length} passed, ${failed.length + 1} failed of ${results.length + 1} (stopped: ${error.message})`);
  process.exit(2);
});
