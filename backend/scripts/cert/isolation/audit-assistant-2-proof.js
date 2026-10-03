'use strict';

/**
 * Proof for the "audit-assistant-2" group — the independent review of the
 * first audit / custom-field / assistant round (findings R14-R19; one
 * company's own project: a party guest or a role reaching what is not theirs).
 *
 * Every guard is shown twice: the refusal of the caller the record is not
 * theirs, AND the same request answered for the caller it belongs to — so a
 * fix that turned into a blanket refusal fails here too.
 *
 *   J1  R15  the assistant reads a document as the record it is filed on reads
 *            the guest: no text of a file on another party's RFI
 *   J2  R16  a company member without project-wide task visibility gets, in
 *            the history and the custom-field values, only the tasks GET
 *            /tasks shows them
 *   J3  R16  (the draft half is not reproducible: no product path makes a
 *            draft RFI) the rule's everyone-part leaves a company member
 *            every sent RFI, in the history and the custom-field values
 *   J4  R17  the history's cursor never names an event the reader is not
 *            given, and no page comes back empty with a cursor
 *   J5  R19  the report assistant decides the run's project before it reads,
 *            asks a model or stores a run
 *   J0  (R14, R18 — not reproduced) the stage facts: no subcontractor
 *            valuation can be made, and no background-job event exists,
 *            on this certification bed
 *
 * Stage: company 072 — project 072-01, its PM, QS, site engineer and planner,
 * the party guests SUB-X and SUB-Y (scripts/cert/leads/lib/party-visibility.js)
 * and james.rojas.9@c072 (a site engineer NOT on 072-01). Run in process:
 *
 *   $env:CERT_INPROCESS = "1"; node scripts/cert/isolation/audit-assistant-2-proof.js [--only=J1,J4]
 *
 * Two steps run product code in this process beside the API, and say so:
 * J1 runs the product's own text-extraction job handler (document.extract)
 * on the one file it uploads — the certification API runs without a job
 * worker, so no document text is ever extracted on this bed; J5 replaces the
 * AI provider's two calls with a local stand-in that returns a fixed answer
 * (no AI API is called) for the length of J5 only.
 *
 * Exit 0 = every refusal and every allowed case holds; 2 = a refusal failed
 * (a defect is present); 3 = only an allowed case failed (over-blocking);
 * 1 = the script itself failed.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pv = require('../leads/lib/party-visibility');
const { pdfFile } = require('../leads/_files-fixture');

const ONLY = (process.argv.find((arg) => arg.startsWith('--only=')) || '').slice('--only='.length).split(',').filter(Boolean);
const wants = (...guards) => !ONLY.length || guards.some((guard) => ONLY.includes(guard));
const stamp = () => new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const results = [];

const check = (guard, kind, label, pass, detail = '') => {
  results.push({ guard, kind, label, pass: Boolean(pass), detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${guard} ${kind.padEnd(7)} ${label}${detail ? ` — ${detail}` : ''}`);
};
const said = (res) => `${res.status} ${res.body?.error?.code || ''}`.trim();
const data = (res) => res.body?.data;
const items = (res) => (Array.isArray(data(res)) ? data(res) : data(res)?.items || data(res)?.rows || []);
const need = (value, what) => {
  if (!value) throw new Error(`set-up: ${what}`);
  return value;
};

const EMAIL = (who) => `${who}@c${pv.CODE}.octapm-cert.test`;
const OUTSIDER = `james.rojas.9@c${pv.CODE}.octapm-cert.test`;
const MAX_PAGES = 400;

/** Every event of a history query, following nextCursor, with what each page and cursor said. */
const pageAll = async (who, base) => {
  const seen = new Map();
  const pages = [];
  let cursor = null;
  let status = 200;
  const cursors = new Set();
  for (;;) {
    const res = await who.send('GET', `${base}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    status = res.status;
    if (res.status !== 200) break;
    const events = data(res).events || [];
    for (const event of events) seen.set(event.id, event);
    pages.push({ events, nextCursor: data(res).nextCursor || null });
    cursor = data(res).nextCursor;
    if (!cursor || cursors.has(cursor) || pages.length >= MAX_PAGES) break;
    cursors.add(cursor);
  }
  return { events: [...seen.values()], pages, status };
};
/** The row id a cursor of the current form names (h1.<base64url of "<ms>.<rank>.<id>">). */
const cursorRowId = (cursor) => {
  const raw = Buffer.from(String(cursor).slice(3), 'base64url').toString('utf8');
  const match = raw.match(/^\d+\.\d\.(.+)$/);
  return match ? match[1] : null;
};
const recordOf = (event) => event.recordId || event.entityId;

pv.main(async () => {
  const s = await pv.setup({ log: () => {} });
  const P = s.projectId;
  const tag = stamp();
  const X = s.subX;
  const Y = s.subY;
  const PM = s.pm;
  const qs = pv.api.as(EMAIL('qs'));
  const site = pv.api.as(EMAIL('site'));
  const planner = pv.api.as(EMAIL('planner'));
  const outsider = pv.api.as(OUTSIDER);
  console.log(`audit-assistant-2 proof — project ${P} (072-01), run ${tag}${ONLY.length ? `, only ${ONLY.join(',')}` : ''}${process.env.CERT_INPROCESS === '1' ? ' (in process)' : ''}`);

  // eslint-disable-next-line global-require
  const guard = require('../lib/cert-env');
  const db = await guard.connectCertPrisma();
  const userIdOf = async (email) => need((await db.user.findFirst({ where: { email }, select: { id: true } }))?.id, `no user ${email}`);
  try {
    const project = need(data(await PM.send('GET', `/projects/${P}`)), 'the PM opens 072-01');
    const orgId = need(project.orgId, '072-01 names its company');
    const firstOr = async (who, route, create) => items(await who.send('GET', route))[0] || data(await who.send('POST', create.route, create.body));
    const yRfi = need(await firstOr(Y, `/projects/${P}/rfi?limit=20`, { route: `/projects/${P}/rfi`, body: { subject: `PROOF AA2 Y ${tag}`, question: 'Y-only question', status: 'open' } }), "an RFI of SUB-Y's company");
    const xRfi = need(await firstOr(X, `/projects/${P}/rfi?limit=20`, { route: `/projects/${P}/rfi`, body: { subject: `PROOF AA2 X ${tag}`, question: 'X question', status: 'open' } }), "an RFI of SUB-X's company");
    if (xRfi.id === yRfi.id) throw new Error('set-up: SUB-X and SUB-Y list the same RFI');
    // A text field of the project for a record type (a project field is in the schema whatever fieldset the project uses).
    const ensureField = async (recordType, key, label) => {
      const schema = data(await PM.send('GET', `/projects/${P}/custom-fields/schema?recordType=${recordType}`));
      if ((schema?.fields || []).some((row) => row.key === key)) return key;
      const made = await PM.send('POST', `/projects/${P}/custom-fields/definitions`, { recordType, type: 'text', label, key });
      need(made.status === 201 && data(made)?.key, `the project ${recordType} custom field (${said(made)})`);
      return data(made).key;
    };

    // ── J0: the stage facts behind R14 and R18 (not reproduced) ─────────────
    if (wants('J0')) {
      console.log('\n== J0 — R14 / R18 stage facts (informational, no verdict) ==');
      const made = await PM.send('POST', `/projects/${P}/sub-valuations`, { subcontractor: `AA2 ${tag}`, period: '2026-09', grossValue: 1000 });
      const listed = await PM.send('GET', `/projects/${P}/sub-valuations`);
      const [valuations, valuationEvents, jobEvents, queued, readyText] = await Promise.all([
        db.subValuation.count(),
        db.auditEvent.count({ where: { entityType: 'sub_valuation' } }),
        db.auditEvent.count({ where: { entityType: 'background_job' } }),
        db.backgroundJob.count({ where: { status: 'queued' } }),
        db.documentText.count({ where: { status: 'ready' } }),
      ]);
      console.log(`  R14: POST /sub-valuations as the PM -> ${said(made)}; GET -> ${said(listed)} with ${(data(listed)?.rows || []).length} rows; SubValuation rows in the whole database: ${valuations}; audit events of type sub_valuation: ${valuationEvents}`);
      console.log(`  R18: audit events of type background_job in the whole database: ${jobEvents}; jobs queued and never run (the API runs without a job worker): ${queued}`);
      console.log(`  (J1 context) DocumentText rows ready before this run: ${readyText}`);
    }

    // ── J1 / R15: the assistant's document pass ─────────────────────────────
    if (wants('J1')) {
      console.log("\n== J1 / R15 — the assistant reads a file as its RFI's own rule reads the guest ==");
      if (process.env.CERT_INPROCESS !== '1') throw new Error('J1 runs the product extraction handler in process: set CERT_INPROCESS=1');
      const token = `cobaltheron${tag}`;
      const price = `41${tag.slice(-3)}7`;
      const file = pdfFile(`aa2-${tag}`, [`${token} valve price agreed with company Y only: ${price}`, 'Confidential to company Y']);
      const stored = await PM.upload('POST', `/projects/${P}/attachments`, { field: 'files', ...file, fields: { recordType: 'rfi', recordId: yRfi.id } });
      const documentId = need((stored?.items || [])[0]?.documentId, "the file filed on company Y's RFI");
      // The product's own document.extract handler, for this one file (the API runs no job worker).
      // eslint-disable-next-line global-require
      const documentText = require('../../../src/services/document-text.service');
      const extracted = await documentText.runDocumentExtractJob({ job: { id: `cert-aa2-${tag}`, orgId }, payload: { documentId } });
      console.log(`  (set-up) ${documentId} filed on company Y's RFI ${yRfi.ref || yRfi.id}; text ${extracted?.status || JSON.stringify(extracted)}`);
      need(extracted?.status === 'ready', 'the uploaded file has extracted text');

      const conversations = [];
      const ask = async (who, label) => {
        const res = await who.send('POST', `/projects/${P}/assistant/ask`, { question: token });
        if (data(res)?.conversationId) conversations.push([who, data(res).conversationId]);
        const message = data(res)?.message || {};
        const sources = message.sources || [];
        const hit = sources.find((source) => source.id === documentId);
        const leaked = JSON.stringify(message).includes(price);
        console.log(`  [${label}] POST /projects/${P}/assistant/ask -> ${said(res)}; ${sources.length} source(s)${hit ? `, the file as [${hit.n}] ${hit.type}` : ''}${leaked ? ', its price in the answer' : ''}`);
        return { res, hit, leaked };
      };
      const x = await ask(X, 'SUB-X');
      check('J1', 'refused', "SUB-X's question is answered with no source and no text of the file on company Y's RFI", x.res.status === 200 && !x.hit && !x.leaked, said(x.res));
      const y = await ask(Y, 'SUB-Y');
      check('J1', 'allowed', "SUB-Y, the RFI's own party, is answered from the file", y.res.status === 200 && Boolean(y.hit) && y.leaked, said(y.res));
      const pm = await ask(PM, 'PM');
      check('J1', 'allowed', 'the PM is answered from the file', pm.res.status === 200 && Boolean(pm.hit), said(pm.res));
      for (const [who, id] of conversations) await who.send('DELETE', `/projects/${P}/assistant/conversations/${id}`);
    }

    // ── J2 / R16: a member's tasks ─────────────────────────────────────────
    if (wants('J2')) {
      console.log("\n== J2 / R16 — a QS and a site engineer read only the tasks GET /tasks shows them ==");
      const [qsId, siteId] = [await userIdOf(EMAIL('qs')), await userIdOf(EMAIL('site'))];
      const T = (id) => `/projects/${P}/tasks/${id}`;
      const toQs = need(data(await PM.send('POST', `/projects/${P}/tasks`, { title: `AA2 task for the QS ${tag}`, assigneeId: qsId, priority: 'high' })), 'a task assigned to the QS');
      const toSite = need(data(await PM.send('POST', `/projects/${P}/tasks`, { title: `AA2 task for the site ${tag}`, description: `site-only ${tag}`, assigneeId: siteId, priority: 'high' })), 'a task assigned to the site engineer');
      const marker = `AA2-TASK-${tag}: note on the site engineer's task`;
      const commented = await PM.send('POST', `/projects/${P}/comments`, { recordType: 'task', recordId: toSite.id, body: marker });
      need(commented.status === 201, `the PM comments on the site's task (${said(commented)})`);
      const premiseQs = await qs.send('GET', T(toSite.id));
      const premiseSite = await site.send('GET', T(toQs.id));
      console.log(`  (premise) the task routes: QS GET the site's task -> ${said(premiseQs)}; site GET the QS's task -> ${said(premiseSite)}`);
      need(premiseQs.status === 404 && premiseSite.status === 404, 'GET /tasks/:id refuses a colleague\'s task to a QS and a site engineer');

      const history = (who, id) => pageAll(who, `/projects/${P}/audit?source=all&entityType=task${id ? `&entityId=${id}` : ''}&limit=100&order=desc`);
      const qsOther = await history(qs, toSite.id);
      check('J2', 'refused', "the QS's history holds no event of the site engineer's task (title, assignee, comment)", qsOther.status === 200 && qsOther.events.length === 0, `${qsOther.events.length} events`);
      const siteOther = await history(site, toQs.id);
      check('J2', 'refused', "the site engineer's history holds no event of the QS's task", siteOther.status === 200 && siteOther.events.length === 0, `${siteOther.events.length} events`);
      // Every task event the QS is given is on a task the QS may open (the database names the others).
      const qsTasks = await history(qs, null);
      // (decided here, not by a NOT in the query: NOT over a null assignee drops the row)
      const tasks = await db.task.findMany({ where: { projectId: P }, select: { id: true, assigneeId: true, createdById: true } });
      const foreignIds = new Set(tasks.filter((row) => row.assigneeId !== qsId && row.createdById !== qsId).map((row) => row.id));
      const leaked = qsTasks.events.filter((event) => foreignIds.has(recordOf(event)));
      check('J2', 'refused', "no task event of the whole history is on a task that is not the QS's", qsTasks.status === 200 && leaked.length === 0, `${qsTasks.events.length} task events given, ${leaked.length} on ${foreignIds.size} tasks not the QS's`);
      check('J2', 'refused', "the PM's comment on the site's task is not in the QS's history", !qsTasks.events.some((event) => String(event.comment || '').includes(marker)));
      const qsOwn = await history(qs, toQs.id);
      check('J2', 'allowed', 'the QS reads the history of the task assigned to them', qsOwn.status === 200 && qsOwn.events.length > 0, `${qsOwn.events.length} events`);
      const siteOwn = await history(site, toSite.id);
      check('J2', 'allowed', "the site engineer reads their own task's history, the PM's comment included", siteOwn.events.some((event) => String(event.comment || '').includes(marker)), `${siteOwn.events.length} events`);
      const plannerOther = await history(planner, toSite.id);
      check('J2', 'allowed', 'the planner (project-wide task visibility) reads the site engineer\'s task history', plannerOther.status === 200 && plannerOther.events.length > 0, `${plannerOther.events.length} events`);

      // custom-field values of the same tasks
      const FIELD = await ensureField('task', 'cert_aa2_task_pf', 'Cert AA2 task probe (project)');
      const V = (id) => `/projects/${P}/custom-fields/values/task/${id}`;
      const put = (who, id, value) => who.send('PUT', V(id), { values: { [FIELD]: value }, partial: true });
      const valueOf = (res) => data(res)?.values?.[FIELD];
      const pmWrites = [await put(PM, toQs.id, `pm-qs-${tag}`), await put(PM, toSite.id, `pm-site-${tag}`)];
      need(pmWrites.every((res) => res.status === 200), `the PM writes both tasks' values (${pmWrites.map((res) => `${said(res)} ${res.body?.error?.message || ''}`).join(', ')})`);
      const qsRead = await qs.send('GET', V(toSite.id));
      check('J2', 'refused', "the QS reads the values of the site engineer's task → 404", qsRead.status === 404 && qsRead.body?.error?.code === 'CUSTOM_FIELD_RECORD_NOT_FOUND', said(qsRead));
      const siteRead = await site.send('GET', V(toQs.id));
      check('J2', 'refused', "the site engineer reads the values of the QS's task → 404", siteRead.status === 404 && siteRead.body?.error?.code === 'CUSTOM_FIELD_RECORD_NOT_FOUND', said(siteRead));
      const siteWrite = await put(site, toQs.id, `site-wrote-${tag}`);
      check('J2', 'refused', "… and writes them → 404, unchanged", siteWrite.status === 404 && valueOf(await PM.send('GET', V(toQs.id))) === `pm-qs-${tag}`, said(siteWrite));
      const bulk = await site.send('GET', `/projects/${P}/custom-fields/values?recordType=task&recordIds=${toQs.id},${toSite.id}`);
      check('J2', 'refused', "… and the bulk read leaves the QS's task out", bulk.status === 200 && !(toQs.id in (data(bulk)?.items || {})) && toSite.id in (data(bulk)?.items || {}), said(bulk));
      const qsOwnValues = await qs.send('GET', V(toQs.id));
      check('J2', 'allowed', "the QS reads the values of the task assigned to them", qsOwnValues.status === 200 && valueOf(qsOwnValues) === `pm-qs-${tag}`, said(qsOwnValues));
      const siteOwnWrite = await put(site, toSite.id, `site-own-${tag}`);
      check('J2', 'allowed', 'the site engineer writes the values of their own task', siteOwnWrite.status === 200 && valueOf(siteOwnWrite) === `site-own-${tag}`, said(siteOwnWrite));
      const plannerRead = await planner.send('GET', V(toQs.id));
      check('J2', 'allowed', "the planner reads the values of the QS's task", plannerRead.status === 200, said(plannerRead));
    }

    // ── J3 / R16: draft RFIs (not reproducible here) and the RFIs a member keeps ──
    if (wants('J3')) {
      console.log("\n== J3 / R16 — draft RFIs: none can be made on this bed; a member keeps every sent RFI ==");
      const direct = await PM.send('POST', `/projects/${P}/rfi`, { subject: `AA2 draft probe ${tag}`, question: 'q', status: 'draft' });
      const viaAssistant = await PM.send('POST', `/projects/${P}/assistant/actions`, { action: { type: 'create_rfi', subject: `AA2 draft probe ${tag}`, question: 'q' } });
      const drafts = await db.rfi.count({ where: { status: 'draft' } });
      console.log(`  (stage) POST /rfi status draft -> ${said(direct)}; the assistant's "raise an RFI" action (a draft) -> ${said(viaAssistant)}; draft RFIs in the whole database: ${drafts}`);
      // The rule's everyone-part (a draft is its author's) binds a company member: it must leave out no sent RFI.
      const base = `/projects/${P}/audit?source=all&entityType=rfi&limit=100&order=desc`;
      const [pmAll, siteAll] = [await pageAll(PM, base), await pageAll(site, base)];
      const pmIds = new Set(pmAll.events.map((event) => event.id));
      const same = siteAll.events.length === pmAll.events.length && siteAll.events.every((event) => pmIds.has(event.id));
      check('J3', 'allowed', "the site engineer is given every RFI event the PM is (no draft exists to leave out)", pmAll.status === 200 && siteAll.status === 200 && same && pmAll.events.length > 0, `${siteAll.events.length}/${pmAll.events.length}`);
      const FIELD = await ensureField('rfi', 'cert_aa2_rfi_pf', 'Cert AA2 RFI probe (project)');
      const V = `/projects/${P}/custom-fields/values/rfi/${xRfi.id}`;
      const siteWrite = await site.send('PUT', V, { values: { [FIELD]: `site-${tag}` }, partial: true });
      const siteRead = await site.send('GET', V);
      check('J3', 'allowed', "the site engineer writes and reads a sent RFI's values", siteWrite.status === 200 && siteRead.body?.data?.values?.[FIELD] === `site-${tag}`, `${said(siteWrite)} / ${said(siteRead)}`);
    }

    // ── J4 / R17: the cursor ───────────────────────────────────────────────
    if (wants('J4')) {
      console.log("\n== J4 / R17 — the history's cursor never names an event the reader is not given ==");
      const base = `/projects/${P}/audit?source=audit&entityType=attachment&order=desc`;
      const inDb = await db.auditEvent.count({ where: { projectId: P, entityType: 'attachment' } });
      const one = await pageAll(X, `${base}&limit=1`);
      const whole = await pageAll(X, `${base}&limit=100`);
      console.log(`  attachment events on 072-01: ${inDb}; SUB-X is given ${whole.events.length}; paged one at a time in ${one.pages.length} page(s)`);
      need(inDb > whole.events.length, 'events SUB-X is not given exist (the check would be empty otherwise)');
      const empty = one.pages.filter((page) => !page.events.length && page.nextCursor);
      check('J4', 'refused', 'no page comes back empty with a cursor', one.status === 200 && empty.length === 0, `${empty.length} empty page(s) with a cursor`);
      const strays = one.pages.filter((page) => page.nextCursor && cursorRowId(page.nextCursor) !== page.events[page.events.length - 1]?.rawId);
      check('J4', 'refused', 'every cursor names the last event of its own page, never one withheld', strays.length === 0, `${strays.length} cursor(s) naming another row`);
      const sameSet = one.events.length === whole.events.length && whole.events.every((event) => one.events.some((other) => other.id === event.id));
      check('J4', 'allowed', 'SUB-X paged one at a time gets every event it is given, each once, then the end', one.status === 200 && sameSet && one.pages.length === whole.events.length, `${one.events.length}/${whole.events.length} in ${one.pages.length} page(s)`);
      const pm = await pageAll(PM, `${base}&limit=7`);
      check('J4', 'allowed', 'the PM pages every attachment event of the project', pm.status === 200 && pm.events.length === inDb && pm.pages.every((page) => page.events.length || !page.nextCursor), `${pm.events.length}/${inDb} in ${pm.pages.length} page(s)`);
    }

    // ── J5 / R19: the report assistant's project ───────────────────────────
    if (wants('J5')) {
      console.log("\n== J5 / R19 — the report assistant decides the run's project first ==");
      if (process.env.CERT_INPROCESS !== '1') throw new Error('J5 replaces the AI provider in process: set CERT_INPROCESS=1');
      // eslint-disable-next-line global-require
      const ai = require('../../../src/services/ai-provider.service');
      const saved = { isEnabled: ai.isEnabled, complete: ai.complete };
      const definition = { name: `AA2 report ${tag}`, description: 'open RFIs', source: 'rfi', columns: ['ref', 'subject', 'status'], filters: [], sort: null, groupBy: null, aggregates: [{ fn: 'count' }], chart: null, explanation: 'stand-in', assumptions: [] };
      const narrative = { headline: 'stand-in headline', summary: 'stand-in summary', highlights: [], caveats: [] };
      ai.isEnabled = () => true;
      ai.complete = async ({ system }) => ({ text: JSON.stringify(/summarise/i.test(String(system)) ? narrative : definition), usage: null, provider: 'cert-stand-in', model: 'cert-stand-in' });
      const runs = [];
      try {
        const outsiderId = await userIdOf(OUTSIDER);
        const storedFor = (projectId) => db.assistantConversation.count({ where: { userId: outsiderId, projectId, kind: { in: ['report_nl', 'report_narrative'] } } });
        const theirs = items(await outsider.send('GET', '/projects?limit=100')).filter((row) => row.id !== P);
        const direct = await outsider.send('GET', `/projects/${P}`);
        need(theirs.length && direct.status === 403, `${OUTSIDER} is on other projects and refused 072-01 (${said(direct)})`);
        const Q = theirs[0].id;
        const foreign = Object.values(JSON.parse(fs.readFileSync(path.join(process.env.CERT_STATE_DIR || 'C:/Temp/octapm-cert/state', 'projects.json'), 'utf8'))['026'])[0].id;
        const nowhere = crypto.randomUUID();
        const before = { P: await storedFor(P), foreign: await storedFor(foreign) };
        const ask = (who, projectId) => who.send('POST', '/reports/ask', { question: 'open RFIs by status', projectId });
        const narrate = (who, projectId) => who.send('POST', '/reports/narrate', { source: 'rfi', groupBy: 'status', projectId });
        const keep = (res) => {
          if (data(res)?.message?.id) runs.push(data(res).message.id);
          return res;
        };

        const onP = keep(await ask(outsider, P));
        check('J5', 'refused', 'a member not on 072-01 asks for a report on 072-01 → 403 PROJECT_ACCESS_DENIED', onP.status === 403 && onP.body?.error?.code === 'PROJECT_ACCESS_DENIED', said(onP));
        const narrated = keep(await narrate(outsider, P));
        check('J5', 'refused', '… and asks for its narrative → 403 PROJECT_ACCESS_DENIED', narrated.status === 403 && narrated.body?.error?.code === 'PROJECT_ACCESS_DENIED', said(narrated));
        const onForeign = keep(await ask(outsider, foreign));
        const onNowhere = keep(await ask(outsider, nowhere));
        check('J5', 'refused', "another company's project and an id that names no project are answered alike → 404 PROJECT_NOT_FOUND", onForeign.status === 404 && onNowhere.status === 404 && onForeign.body?.error?.code === 'PROJECT_NOT_FOUND' && onNowhere.body?.error?.code === 'PROJECT_NOT_FOUND', `${said(onForeign)} / ${said(onNowhere)}`);
        const after = { P: await storedFor(P), foreign: await storedFor(foreign) };
        check('J5', 'refused', 'no run is stored against 072-01 nor against the other company\'s project', after.P === before.P && after.foreign === before.foreign, `072-01 ${before.P} → ${after.P}, 026-01 ${before.foreign} → ${after.foreign}`);

        const own = keep(await ask(outsider, Q));
        const ownNarrated = keep(await narrate(outsider, Q));
        check('J5', 'allowed', 'the same member asks for a report and its narrative on a project they are on → 200, the runs stored against it', own.status === 200 && Boolean(data(own)?.message?.id) && ownNarrated.status === 200 && Boolean(data(ownNarrated)?.message?.id) && (await storedFor(Q)) >= 2, `${said(own)} / ${said(ownNarrated)}`);
        const pm = keep(await ask(PM, P));
        check('J5', 'allowed', 'the PM asks for a report on 072-01 → 200, the run stored', pm.status === 200 && Boolean(data(pm)?.message?.id), said(pm));
      } finally {
        ai.isEnabled = saved.isEnabled;
        ai.complete = saved.complete;
        // The runs this section stored are removed by their owners.
        for (const messageId of runs) {
          const row = await db.assistantMessage.findFirst({ where: { id: messageId }, select: { conversation: { select: { id: true, userId: true } } } });
          if (!row?.conversation) continue;
          const owner = row.conversation.userId === (await userIdOf(OUTSIDER)) ? outsider : PM;
          await owner.send('DELETE', `/assistant/conversations/${row.conversation.id}`);
        }
      }
    }
  } finally {
    await db.$disconnect();
  }

  // ── verdict ────────────────────────────────────────────────────────────
  const failedRefusals = results.filter((r) => !r.pass && r.kind === 'refused');
  const failedAllowed = results.filter((r) => !r.pass && r.kind === 'allowed');
  console.log(`\nSummary: ${results.filter((r) => r.pass).length}/${results.length} checks pass`);
  for (const guardName of [...new Set(results.map((r) => r.guard))]) {
    const own = results.filter((r) => r.guard === guardName);
    console.log(`  ${guardName}: ${own.every((r) => r.pass) ? 'HOLDS' : 'FAILS'} (${own.filter((r) => r.kind === 'refused' && r.pass).length}/${own.filter((r) => r.kind === 'refused').length} refusals, ${own.filter((r) => r.kind === 'allowed' && r.pass).length}/${own.filter((r) => r.kind === 'allowed').length} allowed)`);
  }
  process.exitCode = failedRefusals.length ? 2 : failedAllowed.length ? 3 : 0;
});
