'use strict';

/**
 * Proof for the "commercial-2" group — the independent review of the
 * commercial-visibility round (findings R20-R28, R33): the same figures and
 * records reached through doors round 1 left open, within one company.
 *
 * Every guard is shown twice: the refusal of the caller the figure or record
 * is not theirs, AND the same request answering for the caller it belongs to
 * — so a fix that turned into a blanket refusal fails here too.
 *
 *   G1  the portfolio (JSON and XLSX) states a project's contract value, and
 *       their total, only where the caller may read the project's commercial
 *       terms (ipc:read on that project, as GET /projects/:id) (R20)
 *   G2  the budget revisions state the contract value — the original and
 *       current budget, every running total — only to the same callers; the
 *       changes themselves stay for every cost reader (R21)
 *   G3  the company's workflow templates are listed to a member only for
 *       tools whose module they read; company admins see them all (R23)
 *   G4  a commercial term a non-ipc editor typed is named back as not stored
 *       (ignoredFields), the form's own blanks and defaults are not (R24)
 *   G5  a run on a document revision is shown as the revision is: under the
 *       routing of the RFI it is filed on (R25, R33)
 *   G6  a party guest's page of runs is cut after their record rule, not
 *       before it: ?limit=N is the first N of what they may see, for their
 *       commitments and for document revisions alike (R26)
 *   G7  GET /projects decides a page's commercial terms in a fixed number of
 *       statements, not three or four per project (R28; in process only)
 *   G8  the OpenAPI contract documents the withheld terms and flags (R27,
 *       and the documents round's FILE_NOT_FOUND and job flags)
 *
 * Findings left as a product decision (R22, the LD rate through the EOT
 * module) and outside this group's files (the burn rate, cost.service) are
 * shown under NOTES, not proved.
 *
 * Stage: project 072-01 (company 072), its personas (pm, planner, qs, cost,
 * procurement, warehouse, site @c072) and its party guests SUB-X and
 * CONSULTANT (scripts/cert/leads/lib/party-visibility.js). Run in process:
 *
 *   $env:DATABASE_URL = $null; $env:CERT_INPROCESS = "1"; node scripts/cert/isolation/commercial-2-proof.js [--only=G1,G5]
 *
 * Writes (company 072 only): G3 makes one company workflow template for
 * payment certificates (not a default, no rules: it never starts on its
 * own); G4 PATCHes the project's name to itself and the LD rate to itself;
 * G5 makes three RFIs (one a draft), a revision on each, a project template
 * for document revisions and one run per revision, cancelled at once (all
 * reused on a re-run), and one API key of the PM's (workflow and document
 * control scopes, this project only) that it revokes before it ends; G6 starts and cancels a run on another vendor's commitment when
 * the newest commitment run is not already another vendor's, and one on a
 * revision SUB-X may not see when the newest revision run is SUB-X's.
 *
 * Exit 0 = every refusal and every allowed case holds; 2 = a refusal failed
 * (a defect is present); 3 = only an allowed case failed (over-blocking);
 * 1 = the script itself failed.
 */

// G7 counts the SQL statements of the application loaded in this process: the
// client it uses (config/db.js reads global.__prisma) is made here first, with
// query events on. Only in process — a running API's statements are not ours.
let statements = 0;
const INPROCESS = process.env.CERT_INPROCESS === '1';
const pv = require('../leads/lib/party-visibility');
if (INPROCESS) {
  // eslint-disable-next-line global-require
  const guard = require('../lib/cert-env');
  process.env.DATABASE_URL = guard.certDatabaseUrl();
  // eslint-disable-next-line global-require
  const { PrismaClient } = require('@prisma/client');
  const client = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
  client.$on('query', () => {
    statements += 1;
  });
  global.__prisma = client;
}
// eslint-disable-next-line global-require
const ExcelJS = require('exceljs');

const ONLY = (process.argv.find((arg) => arg.startsWith('--only=')) || '').slice('--only='.length).split(',').filter(Boolean);
const wants = (...guards) => !ONLY.length || guards.some((guard) => ONLY.includes(guard));
const results = [];

const check = (guard, kind, label, pass, detail = '') => {
  results.push({ guard, kind, label, pass: Boolean(pass), detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${guard} ${kind.padEnd(7)} ${label}${detail ? ` — ${detail}` : ''}`);
};
const note = (text) => console.log(`  NOTE ${text}`);
const said = (res) => `${res.status} ${res.body?.error?.code || ''}`.trim();
const data = (res) => res.body?.data;
const items = (res) => (Array.isArray(data(res)) ? data(res) : data(res)?.items || data(res)?.rows || []);
const persona = (key) => pv.api.as(`${key}@c${pv.CODE}.octapm-cert.test`);
const notFound = (res, code) => res.status === 404 && res.body?.error?.code === code;
const money = (value) => Math.round(Number(value) * 100) / 100;
const STAMP = 'C2';

/** The 'Contract value' cell of a project's row in the portfolio export, '' when blank; null when the row is missing. */
const exportedContractValue = async (res, projectName) => {
  if (res.status !== 200 || !Buffer.isBuffer(res.buffer)) return undefined;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(res.buffer);
  const sheet = workbook.getWorksheet('Portfolio');
  const header = sheet.getRow(1).values;
  const column = header.indexOf('Contract value');
  let found = null;
  sheet.eachRow((row, index) => {
    if (index > 1 && row.getCell(1).value === projectName) {
      const value = row.getCell(column).value;
      found = value === null || value === undefined ? '' : value;
    }
  });
  return found;
};

pv.main(async () => {
  const s = await pv.setup();
  const P = s.projectId;
  const PM = s.pm;
  const X = s.subX;
  const C = s.consultant;
  const planner = persona('planner');
  const procurement = persona('procurement');
  const qs = persona('qs');
  const cost = persona('cost');
  const site = persona('site');
  const warehouse = persona('warehouse');

  console.log(`commercial-2 proof — project ${P} (${pv.CODE}-01)${INPROCESS ? ' — in process' : ''}`);

  const pmProject = data(await PM.send('GET', `/projects/${P}`));
  const truth = { contractValue: pmProject?.contractValue, ldRatePerDay: pmProject?.ldRatePerDay, defaultRetentionRate: pmProject?.defaultRetentionRate };
  if (!(Number(truth.contractValue) > 0)) throw new Error(`project ${P} carries no contract value to prove with: ${JSON.stringify(truth)}`);
  const pmMe = await PM.GET('/auth/me');
  const pmUserId = pmMe?.id || pmMe?.user?.id;

  // ── G1 the portfolio ──────────────────────────────────────────────────────
  if (wants('G1')) {
    console.log('\n=== G1 the portfolio states contract values only where the terms may be read (R20) ===');
    const portfolioOf = async (who) => {
      const res = await who.send('GET', '/portfolio');
      const rows = data(res)?.rows || [];
      return { res, rows, row: rows.find((row) => row.id === P), summary: data(res)?.summary || {} };
    };
    const exportOf = async (who) => exportedContractValue(await who.send('GET', '/portfolio/export.xlsx', undefined, { binary: true }), pmProject.name);
    for (const [label, who] of [['planning engineer (portfolio:read, no ipc:read)', planner], ['procurement (portfolio:read, no ipc:read)', procurement]]) {
      const p = await portfolioOf(who);
      check('G1', 'refuse', `${label}: GET /portfolio — no row and no total carries a contract value`, p.res.status === 200 && p.row && p.rows.every((row) => row.contractValue === null && row.contractValueWithheld === true) && p.summary.contractValue === null && p.summary.contractValueWithheld === true, `${said(p.res)} row cv=${p.row?.contractValue}; total=${p.summary.contractValue} withheld=${p.summary.contractValueWithheld}`);
      const cell = await exportOf(who);
      check('G1', 'refuse', `${label}: GET /portfolio/export.xlsx — the project's Contract value cell is blank`, cell === '', `cell=${JSON.stringify(cell)}`);
    }
    const pm = await portfolioOf(PM);
    const pmTotal = money(pm.rows.reduce((sum, row) => sum + Number(row.contractValue || 0), 0));
    check('G1', 'allow', 'PM: the project\'s row and the total carry the contract value, nothing withheld', pm.res.status === 200 && pm.row?.contractValue === truth.contractValue && pm.row?.contractValueWithheld === undefined && pm.summary.contractValue === pmTotal && pm.summary.contractValue >= truth.contractValue && pm.summary.contractValueWithheld === undefined, `${said(pm.res)} row cv=${pm.row?.contractValue}; total=${pm.summary.contractValue} (rows add to ${pmTotal})`);
    const pmCell = await exportOf(PM);
    check('G1', 'allow', 'PM: the export\'s Contract value cell is the contract value', Number(pmCell) === truth.contractValue, `cell=${JSON.stringify(pmCell)}`);
    const q = await portfolioOf(qs);
    check('G1', 'allow', 'QS (ipc:read): the project\'s row carries the contract value', q.res.status === 200 && q.row?.contractValue === truth.contractValue && q.row?.contractValueWithheld === undefined, `${said(q.res)} row cv=${q.row?.contractValue}; total=${q.summary.contractValue}`);
    const qCell = await exportOf(qs);
    check('G1', 'allow', 'QS: the export\'s Contract value cell is the contract value', Number(qCell) === truth.contractValue, `cell=${JSON.stringify(qCell)}`);
  }

  // ── G2 budget revisions ───────────────────────────────────────────────────
  if (wants('G2')) {
    console.log('\n=== G2 the budget revisions state the contract value only to an ipc:read holder (R21) ===');
    const revisionsOf = async (who) => {
      const res = await who.send('GET', `/projects/${P}/budget-revisions`);
      return { res, d: data(res) || {} };
    };
    const pm = await revisionsOf(PM);
    if (!(pm.d.rows || []).length) throw new Error('project 072-01 has no budget revision to prove with');
    const p = await revisionsOf(planner);
    const carries = (d) => [d.summary?.originalBudget, d.summary?.currentBudget, ...(d.waterfall || []).map((point) => point.cumulative), ...(d.rows || []).map((row) => row.cumulativeBudget)].filter((value) => value !== null && value !== undefined);
    check('G2', 'refuse', 'planning engineer (cost:read, no ipc:read): no original budget, current budget, waterfall total or running total', p.res.status === 200 && carries(p.d).length === 0 && p.d.summary?.contractValueWithheld === true, `${said(p.res)} summary=${JSON.stringify(p.d.summary)}; figures carried: ${carries(p.d).length}`);
    check('G2', 'allow', 'planning engineer still reads every revision, its amount, the net change and each step\'s delta', p.res.status === 200 && (p.d.rows || []).length === pm.d.rows.length && p.d.summary?.netChange === pm.d.summary?.netChange && (p.d.waterfall || []).map((point) => point.delta).join() === (pm.d.waterfall || []).map((point) => point.delta).join() && (p.d.rows || []).every((row, index) => row.amount === pm.d.rows[index].amount), `rows ${(p.d.rows || []).length}/${pm.d.rows.length}; net ${p.d.summary?.netChange}/${pm.d.summary?.netChange}`);
    for (const [label, who] of [['PM', PM], ['QS (ipc:read)', qs], ['cost controller (ipc:read)', cost]]) {
      const r = label === 'PM' ? pm : await revisionsOf(who);
      const current = money(Number(truth.contractValue) + Number(r.d.summary?.netChange));
      check('G2', 'allow', `${label}: the original budget is the contract value, the current budget adds the approved changes, every running total is there`, r.res.status === 200 && r.d.summary?.originalBudget === truth.contractValue && money(r.d.summary?.currentBudget) === current && r.d.summary?.contractValueWithheld === undefined && (r.d.rows || []).every((row) => row.cumulativeBudget !== null && row.cumulativeBudget !== undefined), `${said(r.res)} summary=${JSON.stringify(r.d.summary)}`);
    }
  }

  // ── G3 company workflow templates ────────────────────────────────────────
  if (wants('G3')) {
    console.log('\n=== G3 company workflow templates only for tools the member reads (R23) ===');
    const name = `${STAMP} R23 company certificate route (cert)`;
    const listed = async (who, query = '') => items(await who.send('GET', `/company/workflow-templates${query}`));
    let template = (await listed(PM, '?tool=ipc_certificate')).find((row) => row.name === name);
    if (!template) {
      const made = await PM.send('POST', '/company/workflow-templates', {
        tool: 'ipc_certificate',
        name,
        description: 'Made for the commercial-2 proof (R23). Not a default, no rules: starts only when named.',
        isDefault: false,
        rules: [],
        steps: [{ key: 'review', name: 'PM review', type: 'response', assignees: [{ type: 'user', userId: pmUserId }], days: 5, responses: [{ key: 'approve', label: 'Approve', next: 'end_success' }, { key: 'reject', label: 'Reject', next: 'end_fail', requireComment: true }] }],
      });
      if (made.status !== 201) throw new Error(`could not make the company template: ${said(made)} ${JSON.stringify(made.body?.error || {})}`);
      template = data(made);
      console.log(`  (set-up) company template ${template.id} (${name})`);
    }
    const commercialTools = ['ipc_certificate', 'commitment', 'change_order', 'budget_revision', 'sub_pay_app'];
    for (const [label, who] of [['site engineer', site], ['warehouse', warehouse]]) {
      const rows = await listed(who);
      const one = await listed(who, '?tool=ipc_certificate');
      check('G3', 'refuse', `${label} (no commercial module): no certificate, commitment, change-order or budget route is listed`, rows.every((row) => !commercialTools.includes(row.tool)) && one.length === 0, `tools listed: ${[...new Set(rows.map((row) => row.tool))].join(',') || 'none'}; ?tool=ipc_certificate → ${one.length}`);
      check('G3', 'allow', `${label} still lists the company routes of tools it reads (correspondence)`, rows.some((row) => row.tool === 'correspondence'), `tools listed: ${[...new Set(rows.map((row) => row.tool))].join(',') || 'none'}`);
    }
    const pmRows = await listed(PM);
    check('G3', 'allow', 'PM (company admin): the certificate route is listed with its steps', pmRows.some((row) => row.id === template.id && (row.steps || []).length > 0), `PM lists ${pmRows.length}: ${[...new Set(pmRows.map((row) => row.tool))].join(',')}`);
    const qsRows = await listed(qs);
    check('G3', 'allow', 'QS (ipc:read, not an admin): the certificate route is listed', qsRows.some((row) => row.id === template.id), `QS lists ${[...new Set(qsRows.map((row) => row.tool))].join(',')}`);
  }

  // ── G4 terms typed by a non-ipc editor ───────────────────────────────────
  if (wants('G4')) {
    console.log('\n=== G4 a withheld term the editor typed is named back as not stored (R24) ===');
    const name = pmProject.name;
    const typed = await planner.send('PATCH', `/projects/${P}`, { name, contractValue: 123456789 });
    const after = data(await PM.send('GET', `/projects/${P}`));
    check('G4', 'refuse', 'planning engineer types a contract value: 200, not stored, and ignoredFields names it', typed.status === 200 && JSON.stringify(data(typed)?.ignoredFields) === '["contractValue"]' && data(typed)?.contractValue === null && after.contractValue === truth.contractValue, `${said(typed)} ignoredFields=${JSON.stringify(data(typed)?.ignoredFields)}; PM reads cv=${after.contractValue}`);
    const only = await planner.send('PATCH', `/projects/${P}`, { ldRatePerDay: 777 });
    check('G4', 'refuse', 'planning engineer sends only an LD rate: refused NO_UPDATES, and the details name it', only.status === 400 && only.body?.error?.code === 'NO_UPDATES' && JSON.stringify(only.body?.error?.details?.ignoredFields) === '["ldRatePerDay"]', `${said(only)} details=${JSON.stringify(only.body?.error?.details)}`);
    const form = await planner.send('PATCH', `/projects/${P}`, { name, ldRatePerDay: 0, defaultRetentionRate: 5 });
    check('G4', 'allow', 'planning engineer saves the form with its defaults for the hidden terms: 200, nothing named', form.status === 200 && data(form)?.ignoredFields === undefined && data(form)?.name === name, `${said(form)} ignoredFields=${JSON.stringify(data(form)?.ignoredFields)}`);
    const pmEdit = await PM.send('PATCH', `/projects/${P}`, { ldRatePerDay: truth.ldRatePerDay });
    check('G4', 'allow', 'PM (ipc:read) sets the LD rate: stored, nothing named', pmEdit.status === 200 && data(pmEdit)?.ignoredFields === undefined && data(pmEdit)?.ldRatePerDay === truth.ldRatePerDay, `${said(pmEdit)} ld=${data(pmEdit)?.ldRatePerDay}`);
  }

  // ── G5 runs on document revisions ────────────────────────────────────────
  if (wants('G5')) {
    console.log('\n=== G5 a run on a document revision is shown as the revision is (R25, R33) ===');
    const parties = s.parties;
    const subjects = {
      other: `${STAMP}-R33 OTHER RFI routed contractor to client only`,
      own: `${STAMP}-R33 OWN RFI routed SUB-X party to consultant`,
    };
    const routing = {
      other: { ownerPartyId: parties.contractor, reviewerPartyId: parties.client },
      own: { ownerPartyId: parties.subcontractor, reviewerPartyId: parties.consultant },
    };
    const KEYS = ['other', 'own'];
    const rfis = {};
    for (const key of KEYS) {
      let rfi = items(await PM.send('GET', `/projects/${P}/rfi?limit=100&search=${encodeURIComponent(`${STAMP}-R33 ${key.toUpperCase()}`)}`)).find((row) => row.subject === subjects[key]);
      if (!rfi) {
        const made = await PM.send('POST', `/projects/${P}/rfi`, { subject: subjects[key], question: `${subjects[key]} — made for the commercial-2 proof.`, priority: 'normal', ...routing[key] });
        if (made.status !== 201) throw new Error(`could not make RFI ${key}: ${said(made)} ${JSON.stringify(made.body?.error || {})}`);
        rfi = data(made);
        console.log(`  (set-up) RFI ${rfi.ref} (${key})`);
      }
      rfis[key] = rfi;
    }
    const templateName = `${STAMP} R33 document revision route (cert)`;
    let template = items(await PM.send('GET', `/projects/${P}/workflows/templates?tool=document_revision`)).find((row) => row.name === templateName && row.status === 'active');
    if (!template) {
      const made = await PM.send('POST', `/projects/${P}/workflows/templates`, {
        tool: 'document_revision',
        name: templateName,
        description: 'Made for the commercial-2 proof (R33). Not a default, no rules: starts only when named.',
        isDefault: false,
        rules: [],
        steps: [{ key: 'review', name: 'PM review', type: 'response', assignees: [{ type: 'user', userId: pmUserId }], days: 5, responses: [{ key: 'approve', label: 'Approve', next: 'end_success' }, { key: 'reject', label: 'Reject', next: 'end_fail', requireComment: true }] }],
      });
      if (made.status !== 201) throw new Error(`could not make the document-revision template: ${said(made)} ${JSON.stringify(made.body?.error || {})}`);
      template = data(made);
    }
    const revisionTitle = (key) => `${STAMP}-R33 ${key.toUpperCase()} revision`;
    let pmRuns = items(await PM.send('GET', `/projects/${P}/workflows/instances?tool=document_revision&limit=200`));
    const runs = {};
    for (const key of KEYS) {
      runs[key] = pmRuns.find((run) => run.context?.title === revisionTitle(key)) || null;
      if (runs[key]) continue;
      const file = (() => {
        const lines = [`${revisionTitle(key)} on ${rfis[key].ref}`];
        const stream = `BT /F1 11 Tf 56 780 Td (${lines[0].replace(/[()\\]/g, '-')}) Tj ET`;
        const objects = [null, '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [4 0 R] /Count 1 >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
        let out = '%PDF-1.4\n';
        const offsets = [];
        for (let n = 1; n < objects.length; n += 1) {
          offsets.push(Buffer.byteLength(out));
          out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
        }
        const xref = Buffer.byteLength(out);
        out += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
        return Buffer.from(out, 'latin1');
      })();
      const form = new FormData();
      form.append('revision', `${STAMP}-${key.toUpperCase()}-${Date.now().toString(36)}`);
      form.append('title', revisionTitle(key));
      form.append('notes', 'commercial-2 proof (R33)');
      form.append('file', new Blob([file], { type: 'application/pdf' }), `${STAMP}-R33-${key}.pdf`);
      const uploaded = await PM.send('POST', `/projects/${P}/doc-control/rfi/${rfis[key].id}/revisions/upload`, undefined, { form });
      if (uploaded.status !== 201) throw new Error(`could not file a revision on ${rfis[key].ref}: ${said(uploaded)} ${JSON.stringify(uploaded.body?.error || {})}`);
      const revision = data(uploaded)?.revision || data(uploaded);
      const started = await PM.send('POST', `/projects/${P}/workflows/instances`, { tool: 'document_revision', recordId: revision.id, templateId: template.id });
      if (started.status !== 201) throw new Error(`could not start a run on revision ${revision.id}: ${said(started)} ${JSON.stringify(started.body?.error || {})}`);
      runs[key] = data(started);
      await PM.send('POST', `/projects/${P}/workflows/instances/${runs[key].id}/cancel`, { reason: 'commercial-2 proof: started only to exist' });
      console.log(`  (set-up) revision ${revision.id} on ${rfis[key].ref} and its run ${runs[key].id}, started and cancelled`);
    }
    pmRuns = items(await PM.send('GET', `/projects/${P}/workflows/instances?tool=document_revision&limit=200`));
    if (runs.other.context?.title !== revisionTitle('other') || runs.own.context?.title !== revisionTitle('own')) throw new Error(`the runs do not carry the revision titles: ${JSON.stringify([runs.other.context, runs.own.context])}`);

    const listOf = async (who) => items(await who.send('GET', `/projects/${P}/workflows/instances?limit=200`));
    const xList = await listOf(X);
    const cList = await listOf(C);
    const pmList = await listOf(PM);
    for (const [label, who, list] of [['SUB-X guest (document_control + rfi read, not routed)', X, xList], ['CONSULTANT guest (not routed)', C, cList]]) {
      const one = await who.send('GET', `/projects/${P}/workflows/instances/${runs.other.id}`);
      check('G5', 'refuse', `${label}: the run on the revision of ${rfis.other.ref} is neither listed nor returned`, !list.some((row) => row.id === runs.other.id) && notFound(one, 'WORKFLOW_INSTANCE_NOT_FOUND'), `listed=${list.some((row) => row.id === runs.other.id)}; GET ${said(one)}${one.status === 200 ? ` title=${data(one)?.context?.title}` : ''}`);
    }
    const register = items(await X.send('GET', `/projects/${P}/doc-control/register?recordType=rfi&search=${encodeURIComponent(`${STAMP}-R33`)}`));
    note(`SUB-X's document register lists ${register.length} of the two RFIs (${register.map((row) => row.ref || row.title).join(', ') || 'none'}) — the rule the runs now follow (L23)`);
    for (const [label, who, list] of [['SUB-X guest (its party owns the RFI)', X, xList], ['CONSULTANT guest (its party reviews it)', C, cList]]) {
      const one = await who.send('GET', `/projects/${P}/workflows/instances/${runs.own.id}`);
      check('G5', 'allow', `${label}: the run on the revision of ${rfis.own.ref} is listed and returned`, list.some((row) => row.id === runs.own.id) && one.status === 200 && data(one)?.context?.title === revisionTitle('own'), `listed=${list.some((row) => row.id === runs.own.id)}; GET ${said(one)}`);
    }
    for (const key of ['other', 'own']) {
      const one = await PM.send('GET', `/projects/${P}/workflows/instances/${runs[key].id}`);
      check('G5', 'allow', `PM: the run on the revision of ${rfis[key].ref} is listed and returned`, pmList.some((row) => row.id === runs[key].id) && one.status === 200, `GET ${said(one)}`);
    }
    const siteOne = await site.send('GET', `/projects/${P}/workflows/instances/${runs.other.id}`);
    check('G5', 'allow', 'site engineer (company member, rfi read): the run on the RFI revision is returned', siteOne.status === 200, `GET ${said(siteOne)}`);

    // A draft RFI's revision run is its creator's and manager's only (as the
    // register shows the draft); the API cannot make a draft RFI (a new RFI
    // is open), so that clause is proved by the unit suite. Say how many exist.
    const drafts = items(await PM.send('GET', `/projects/${P}/rfi?limit=100&status=draft`));
    note(`draft RFIs on the project the PM can list: ${drafts.length} (POST /rfi with status draft is refused 409 APPROVAL_WORKFLOW_INVALID_TRANSITION)`);

    // The record's module: an API key acting as the site engineer (who is on
    // none of these runs' steps) for workflow and document control only — no
    // rfi scope — does not reach an RFI revision's run; given rfi:read, it
    // does. The key is a test key of this run, revoked at the end.
    const siteMe = await site.GET('/auth/me');
    const made = await PM.send('POST', '/integrations/api-clients', { name: `${STAMP} R33 proof key (workflow + documents)`, description: 'commercial-2 proof (R33): revoked by the proof', scopes: ['workflow:read', 'document_control:read'], projectIds: [P], userId: siteMe?.id || siteMe?.user?.id });
    if (made.status !== 201 || !data(made)?.token) throw new Error(`could not make the proof's API key: ${said(made)} ${JSON.stringify(made.body?.error || {})}`);
    const key = data(made);
    try {
      const withKey = (route) => pv.api.raw('GET', route, { token: key.token });
      const keyOwn = await withKey(`/projects/${P}/workflows/instances/${runs.own.id}`);
      const keyList = items(await withKey(`/projects/${P}/workflows/instances?limit=200`));
      check('G5', 'refuse', `API key without rfi:read: the run on the revision of ${rfis.own.ref} is neither listed nor returned`, !keyList.some((row) => row.tool === 'document_revision' && Object.values(runs).some((run) => run.id === row.id)) && notFound(keyOwn, 'WORKFLOW_INSTANCE_NOT_FOUND'), `GET ${said(keyOwn)}; revision runs listed ${keyList.filter((row) => row.tool === 'document_revision').length}`);
      const widened = await PM.send('PATCH', `/integrations/api-clients/${key.id}`, { scopes: ['workflow:read', 'document_control:read', 'rfi:read'] });
      if (widened.status !== 200) throw new Error(`could not widen the proof's API key: ${said(widened)}`);
      const keyOwnAfter = await withKey(`/projects/${P}/workflows/instances/${runs.own.id}`);
      check('G5', 'allow', `the same key given rfi:read: the run on the revision of ${rfis.own.ref} is returned`, keyOwnAfter.status === 200 && data(keyOwnAfter)?.context?.title === revisionTitle('own'), `GET ${said(keyOwnAfter)}`);
    } finally {
      await PM.send('DELETE', `/integrations/api-clients/${key.id}`);
    }
  }

  // ── G6 a party guest's page of runs ──────────────────────────────────────
  if (wants('G6')) {
    console.log('\n=== G6 a party guest\'s page is cut after their record rule (R26) ===');
    const xCompanies = new Set((data(await X.send('GET', `/projects/${P}`))?.projectAccess?.partyAccess || []).map((party) => party.companyId));
    const commitments = items(await PM.send('GET', `/projects/${P}/commitments?limit=100`));
    const vendorOf = new Map(commitments.map((row) => [row.id, row.vendorCompanyId]));
    const foreign = (run) => !xCompanies.has(vendorOf.get(run.recordId));
    let pmRuns = items(await PM.send('GET', `/projects/${P}/workflows/instances?tool=commitment&limit=200`));
    if (!pmRuns.some((run) => !foreign(run))) throw new Error('SUB-X has no commitment run of its own: run commercial-visibility-proof.js --only=G4 first');
    if (!pmRuns.length || !foreign(pmRuns[0])) {
      const other = commitments.find((row) => row.vendorCompanyId && !xCompanies.has(row.vendorCompanyId) && row.status !== 'void');
      const template = items(await PM.send('GET', `/projects/${P}/workflows/templates?tool=commitment`)).find((row) => row.name === 'PV L41 commitment route (cert leads)' && row.status === 'active');
      if (!other || !template) throw new Error('no other vendor\'s commitment or no L41 commitment template to set the stage with');
      const started = await PM.send('POST', `/projects/${P}/workflows/instances`, { tool: 'commitment', recordId: other.id, templateId: template.id });
      if (started.status !== 201) throw new Error(`could not start a run on ${other.ref}: ${said(started)}`);
      await PM.send('POST', `/projects/${P}/workflows/instances/${data(started).id}/cancel`, { reason: 'commercial-2 proof (R26): the newest commitment run is another vendor\'s' });
      console.log(`  (set-up) run ${data(started).id} on ${other.ref} (another vendor), started and cancelled`);
      pmRuns = items(await PM.send('GET', `/projects/${P}/workflows/instances?tool=commitment&limit=200`));
    }
    const newestForeign = pmRuns[0];
    const ownRuns = pmRuns.filter((run) => !foreign(run));
    const xAll = items(await X.send('GET', `/projects/${P}/workflows/instances?limit=200`));
    const xCommitment = items(await X.send('GET', `/projects/${P}/workflows/instances?tool=commitment&limit=200`));
    check('G6', 'refuse', `SUB-X: the newest commitment run (${newestForeign.recordRef}, another vendor's) is not on any page`, !xAll.some((row) => row.id === newestForeign.id) && !xCommitment.some((row) => row.id === newestForeign.id), `in full list=${xAll.some((row) => row.id === newestForeign.id)}`);
    const one = items(await X.send('GET', `/projects/${P}/workflows/instances?tool=commitment&limit=1`));
    check('G6', 'allow', `SUB-X ?tool=commitment&limit=1: its own newest commitment run (${ownRuns[0]?.recordRef}), not an empty page`, one.length === 1 && one[0].id === ownRuns[0]?.id, `got ${one.length}: ${one.map((row) => row.recordRef).join(',') || 'none'}`);
    for (const limit of [1, 3]) {
      const page = items(await X.send('GET', `/projects/${P}/workflows/instances?limit=${limit}`));
      const expected = xAll.slice(0, limit).map((row) => row.id);
      check('G6', 'allow', `SUB-X ?limit=${limit}: the first ${limit} of what it may see`, page.map((row) => row.id).join() === expected.join(), `got ${page.map((row) => `${row.tool}:${row.recordRef}`).join(',') || 'none'}`);
    }

    // The same for document revisions (R25/R33's rule, decided before the cut):
    // the newest revision run is one SUB-X may not see.
    const revisionsOf = async (who) => items(await who.send('GET', `/projects/${P}/workflows/instances?tool=document_revision&limit=200`));
    let pmRevisionRuns = await revisionsOf(PM);
    let xRevisionIds = new Set((await revisionsOf(X)).map((run) => run.id));
    if (!xRevisionIds.size) throw new Error('SUB-X sees no document-revision run: run this proof with G5 first');
    const otherRevisionRun = pmRevisionRuns.find((run) => run.context?.title === `${STAMP}-R33 OTHER revision`);
    if (!otherRevisionRun) throw new Error('the run on the revision of the RFI routed elsewhere is missing: run this proof with G5 first');
    // Decided on the record, not on what the code under test shows SUB-X.
    if (pmRevisionRuns[0]?.context?.title !== otherRevisionRun.context?.title) {
      const hidden = otherRevisionRun;
      const template = items(await PM.send('GET', `/projects/${P}/workflows/templates?tool=document_revision`)).find((row) => row.name === `${STAMP} R33 document revision route (cert)` && row.status === 'active');
      if (!template) throw new Error('no R33 template: run this proof with G5 first');
      const started = await PM.send('POST', `/projects/${P}/workflows/instances`, { tool: 'document_revision', recordId: hidden.recordId, templateId: template.id });
      if (started.status !== 201) throw new Error(`could not start a run on revision ${hidden.recordId}: ${said(started)}`);
      await PM.send('POST', `/projects/${P}/workflows/instances/${data(started).id}/cancel`, { reason: 'commercial-2 proof (R26): the newest revision run is not SUB-X\'s' });
      console.log(`  (set-up) run ${data(started).id} on a revision SUB-X may not see, started and cancelled`);
      pmRevisionRuns = await revisionsOf(PM);
      xRevisionIds = new Set((await revisionsOf(X)).map((run) => run.id));
    }
    const xRevisionRuns = await revisionsOf(X);
    check('G6', 'refuse', `SUB-X: the newest document-revision run (${pmRevisionRuns[0].recordRef}, routed elsewhere) is on none of its pages`, !xRevisionIds.has(pmRevisionRuns[0].id), `newest=${pmRevisionRuns[0].context?.title}`);
    const firstRevision = items(await X.send('GET', `/projects/${P}/workflows/instances?tool=document_revision&limit=1`));
    check('G6', 'allow', `SUB-X ?tool=document_revision&limit=1: its own newest revision run (${xRevisionRuns[0]?.context?.title}), not an empty page`, firstRevision.length === 1 && firstRevision[0].id === xRevisionRuns[0]?.id, `got ${firstRevision.length}: ${firstRevision.map((row) => row.context?.title).join(',') || 'none'}`);
  }

  // ── G7 GET /projects in a fixed number of statements ─────────────────────
  if (wants('G7')) {
    console.log('\n=== G7 GET /projects decides a page\'s terms without a round per project (R28) ===');
    if (!INPROCESS) {
      note('G7 counts statements of the application in this process: run with CERT_INPROCESS=1');
    } else {
      const TERMS = ['contractValue', 'ldRatePerDay', 'defaultRetentionRate'];
      for (const [label, who, readable] of [['planning engineer', planner, false], ['PM', PM, true], ['QS', qs, true]]) {
        await who.token();
        const count = async (limit) => {
          const before = statements;
          const res = await who.send('GET', `/projects?limit=${limit}`);
          return { res, n: statements - before, rows: items(res) };
        };
        const small = await count(1);
        const large = await count(100);
        check('G7', 'refuse', `${label}: ${large.rows.length} projects cost no more statements than 1 (+2)`, large.res.status === 200 && large.rows.length > 1 && large.n - small.n <= 2, `limit=1: ${small.n} statements; limit=100 (${large.rows.length} rows): ${large.n}`);
        const row = large.rows.find((project) => project.id === P);
        const right = readable
          ? TERMS.every((key) => row?.[key] === truth[key]) && row?.commercialTermsWithheld === false
          : TERMS.every((key) => row?.[key] === null) && row?.commercialTermsWithheld === true && large.rows.every((project) => project.commercialTermsWithheld === true);
        check('G7', 'allow', `${label}: the batched decision is the per-project one (${readable ? 'terms stated' : 'terms withheld on every row'})`, right, `cv=${row?.contractValue} withheld=${row?.commercialTermsWithheld}`);
      }
    }
  }

  // ── G8 the OpenAPI contract ──────────────────────────────────────────────
  if (wants('G8')) {
    console.log('\n=== G8 the OpenAPI contract documents what is withheld (R27) ===');
    // eslint-disable-next-line global-require
    const { openApiSpec: spec } = require('../../../src/openapi/spec');
    const schemas = spec.components.schemas;
    const response = (route, method) => spec.paths[route]?.[method]?.responses?.['200']?.content?.['application/json']?.schema?.properties?.data;
    const resolve = (schema) => (schema?.$ref ? schemas[schema.$ref.split('/').pop()] : schema);
    const project = schemas.Project?.properties || {};
    check('G8', 'doc', 'Project: the three terms are nullable and commercialTermsWithheld / ignoredFields are documented', ['contractValue', 'ldRatePerDay', 'defaultRetentionRate'].every((key) => project[key]?.nullable === true) && project.commercialTermsWithheld?.type === 'boolean' && project.ignoredFields?.type === 'array', JSON.stringify({ ld: project.ldRatePerDay, withheld: project.commercialTermsWithheld?.type }));
    check('G8', 'doc', 'GET/PATCH /projects/{projectId} answer with Project; GET /projects pages Project', resolve(response('/projects/{projectId}', 'get')) === schemas.Project && resolve(response('/projects/{projectId}', 'patch')) === schemas.Project && JSON.stringify(response('/projects', 'get')).includes('Project'), '');
    check('G8', 'doc', 'ProjectMutation accepts null for the LD rate', schemas.ProjectMutation?.properties?.ldRatePerDay?.nullable === true, JSON.stringify(schemas.ProjectMutation?.properties?.ldRatePerDay));
    const dashboard = JSON.stringify(spec.paths['/projects/workspace-dashboard']?.get || {});
    check('G8', 'doc', 'the workspace dashboard documents contractValueWithheld and totalContractValueWithheld', dashboard.includes('contractValueWithheld') && dashboard.includes('totalContractValueWithheld'), '');
    const portfolio = JSON.stringify(spec.paths['/portfolio']?.get || {});
    check('G8', 'doc', 'the portfolio documents contractValueWithheld', portfolio.includes('contractValueWithheld'), '');
    const revisions = JSON.stringify(spec.paths['/projects/{projectId}/budget-revisions']?.get || {});
    check('G8', 'doc', 'the budget revisions document contractValueWithheld', revisions.includes('contractValueWithheld'), '');
    const upload = spec.paths['/projects/{projectId}/workflow/uploads/{key}']?.get?.responses?.['404'];
    check('G8', 'doc', 'GET /projects/{projectId}/workflow/uploads/{key} documents its 404 FILE_NOT_FOUND', Boolean(upload) && JSON.stringify(upload).includes('FILE_NOT_FOUND'), JSON.stringify(upload || null).slice(0, 200));
    const job = schemas.BackgroundJob?.properties || {};
    check('G8', 'doc', 'BackgroundJob documents payloadWithheld { keys, reason } and resultWithheld { reason } for document jobs', Boolean(job.payloadWithheld?.properties?.keys && job.payloadWithheld?.properties?.reason && /document job/.test(job.payloadWithheld.description || '') && job.resultWithheld?.properties?.reason && /document job/.test(job.resultWithheld.description || '')), JSON.stringify({ payloadWithheld: Object.keys(job.payloadWithheld?.properties || {}), resultWithheld: Object.keys(job.resultWithheld?.properties || {}) }));
  }

  // ── notes: a product decision and another group's file ───────────────────
  if (!ONLY.length || ONLY.includes('NOTES')) {
    console.log('\n=== NOTES (not proved here) ===');
    const calc = await planner.send('POST', `/projects/${P}/eot/calculate`, { eventName: `${STAMP} note`, delayDays: 10, eotDaysGranted: 2 });
    note(`R22 (product decision): planning engineer POST /eot/calculate without a rate — ldRatePerDay=${data(calc)?.ldRatePerDay} (the project's ${truth.ldRatePerDay}), ldLiability=${data(calc)?.ldLiability}`);
    const register = items(await C.send('GET', `/projects/${P}/eot`));
    note(`R22: CONSULTANT GET /eot — ${register.length} claims with ldRatePerDay ${register.map((claim) => claim.ldRatePerDay).join(', ')}`);
    const burn = await planner.send('GET', `/projects/${P}/cost/burn-rate`);
    note(`R21 (cost.service, another group): planning engineer GET /cost/burn-rate — budgetRate=${data(burn)?.budgetRate}, i.e. the contract value / the project's days`);
  }

  // ── verdict ────────────────────────────────────────────────────────────────
  const failedRefusals = results.filter((row) => (row.kind === 'refuse' || row.kind === 'doc') && !row.pass);
  const failedAllows = results.filter((row) => row.kind === 'allow' && !row.pass);
  console.log(`\n${results.length} checks: ${results.filter((row) => row.pass).length} pass, ${failedRefusals.length} refusal(s) failed, ${failedAllows.length} allowed case(s) failed`);
  for (const row of [...failedRefusals, ...failedAllows]) console.log(`  FAILED ${row.guard} ${row.kind} ${row.label} — ${row.detail}`);
  for (const guard of [...new Set(results.map((row) => row.guard))]) {
    const rows = results.filter((row) => row.guard === guard);
    console.log(`  ${guard}: refuse ${rows.filter((r) => r.kind !== 'allow' && r.pass).length}/${rows.filter((r) => r.kind !== 'allow').length}, allow ${rows.filter((r) => r.kind === 'allow' && r.pass).length}/${rows.filter((r) => r.kind === 'allow').length}`);
  }
  if (failedRefusals.length) {
    console.log('\nVERDICT commercial-2: DEFECT PRESENT');
    process.exitCode = 2;
  } else if (failedAllows.length) {
    console.log('\nVERDICT commercial-2: OVER-BLOCKING (a legitimate caller is refused)');
    process.exitCode = 3;
  } else {
    console.log('\nVERDICT commercial-2: FIXED (every refusal and every allowed case holds)');
    process.exitCode = 0;
  }
});
