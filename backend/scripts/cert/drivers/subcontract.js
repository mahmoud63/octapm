'use strict';

/**
 * Subcontracts: commitments with their schedule of values, the agreement, the
 * change orders, the scope / closeout / evaluation sheets, and the payment
 * applications that turn certified work into subcontract actual cost.
 *
 * What one run leaves in a project (every run makes a fresh set, so a second
 * run adds to the first rather than colliding with it; titles say "(run N)"
 * and every canary of a second or later run ends in "-R<N>"):
 *
 *   main      subcontract, executed with an uploaded signed agreement; insurance
 *             on file; scope agreed; change orders approved / pending /
 *             rejected / draft / void (+ one spawned from a prime change);
 *             pay apps paid, approved (part paid), void and submitted;
 *             evaluation part rated
 *   second    subcontract raised by procurement, returned once, executed by
 *             naming a document already on the project and overriding a missing
 *             bond; pay apps rejected and draft; closeout part done; scope part
 *             allocated; evaluation finalised then reopened
 *   closed    subcontract claimed in full (a certification revoked and made
 *             again on the way), paid, closed out, evaluated and closed
 *   others    subcontracts left pending, approved (its required cover lapsed),
 *             draft, returned, void and draft with nothing on them
 *   purchase  purchase-order commitments with the supplier: one executed with
 *             a change order and a pay app under review that needs a lien
 *             waiver it does not have, the rest pending / approved
 *
 * Once per company: the subcontractor's prequalification is scored and
 * decided, the supplier's is left under review.
 *
 * Dates. Certified cost is posted on the pay application's period end, so the
 * periods sit inside the project's life (never before its start, never after
 * today or its end) and after the last LOCKED reporting period, within the
 * last 180 days. The window used is kept in ctx.refs.subcontract.periods.
 * The project's stage is not a reason to skip: an on-hold, completed or
 * archived job still carries its subcontracts (noted when it is not active).
 *
 * Who. Each step is done by the persona that does it in practice. Where the
 * company refuses that persona the step for want of permission (403 FORBIDDEN
 * or PROJECT_ACCESS_DENIED), the PM stands in and every distinct refused step
 * is noted; any other refusal fails the run.
 *
 * Later drivers find the commitments in ctx.refs.commitments ({ ref: id }) and
 * the detail in ctx.refs.subcontract.
 */

const { ApiError } = require('../lib/api');

const SUB_CODES = ['03-100', '04-100', '05-100'];
const MATERIAL_CODES = ['02-100', '02-200'];
/** The refusals that mean "this person may not", not "this cannot be done". */
const PERMISSION_CODES = new Set(['FORBIDDEN', 'PROJECT_ACCESS_DENIED', 'SUB_PAY_APP_REVOKE_FORBIDDEN']);
const DAY = 86_400_000;

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const listOf = (data) => (Array.isArray(data) ? data : data?.items || data?.orders || data?.rows || data?.periods || data?.activities || []);
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (iso) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00.000Z`);
const shortRoute = (route) => String(route).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id').replace(/\?.*$/, '');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// A writer may name only a file it may read (certification R29): another
// person's evidence is refused as missing, 404, so for asEither it is the same
// as a permission refusal — the next person, who may read the file, is asked.
const DOCUMENT_LINK_CODES = new Set(['DOCUMENT_NOT_FOUND', 'FILE_NOT_FOUND', 'COMMERCIAL_DOCUMENT_NOT_FOUND']);
const isPermissionRefusal = (error) =>
  error instanceof ApiError && ((error.status === 403 && PERMISSION_CODES.has(error.code)) || (error.status === 404 && DOCUMENT_LINK_CODES.has(error.code)));

/** A one-page PDF that says `text`. */
const pdfOf = (text) => {
  const safe = String(text).replace(/[()\\]/g, ' ');
  const stream = `BT /F1 11 Tf 30 150 Td (${safe}) Tj ET`;
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 520 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
};

const run = async (ctx) => {
  const { P, rng } = ctx;
  const pm = ctx.who('pm');

  const state = (ctx.refs.subcontract = ctx.refs.subcontract || {});
  state.run = (state.run || 0) + 1;
  state.byState = {};
  state.sovLines = state.sovLines || {};
  state.payApps = state.payApps || {};
  ctx.refs.commitments = ctx.refs.commitments || {};
  const tag = `run ${state.run}`;
  /** The canary, made unique to this run: the counters behind ctx.canary restart every run. */
  const mark = (type) => (state.run > 1 ? `${ctx.canary(type)}-R${state.run}` : ctx.canary(type));

  const subcontractor = ctx.companyRefs.directory?.subcontractor;
  const supplier = ctx.companyRefs.directory?.supplier;
  if (!subcontractor || !supplier) throw new Error('subcontract: the foundation left no subcontractor or supplier in the company directory');

  // ── who does what ────────────────────────────────────────────────────────

  const noted = new Set();
  const noteOnce = (key, text) => {
    if (noted.has(key)) return;
    noted.add(key);
    ctx.note(text);
  };
  const handle = (who) => who.email.split('@')[0];

  /**
   * A persona's session. Where the company's permissions refuse the persona a
   * step (FORBIDDEN / PROJECT_ACCESS_DENIED), the PM does it instead; each
   * distinct refused step (persona, method, route) is noted once. Any other
   * refusal is the run's failure.
   */
  const persona = (key) => {
    const who = ctx.who(key);
    if (who.email === pm.email) return who;
    const standIn = (method) => async (...args) => {
      try {
        return await who[method](...args);
      } catch (error) {
        if (!isPermissionRefusal(error)) throw error;
        const step = `${error.method} ${shortRoute(error.route)}`;
        noteOnce(`persona ${key} ${step}`, `${key} (${handle(who)}) was refused ${step} (${error.status} ${error.code}); the PM stood in`);
        return pm[method](...args);
      }
    };
    return { ...who, GET: standIn('GET'), POST: standIn('POST'), PATCH: standIn('PATCH'), PUT: standIn('PUT'), DELETE: standIn('DELETE'), call: standIn('call'), upload: standIn('upload'), download: standIn('download') };
  };
  const qs = persona('qs');
  const procurement = persona('procurement');
  const finance = persona('finance');
  // The site and quality engineers are only ever tried first (asEither), so they stay as they are.
  const site = ctx.who('site');
  const quality = ctx.who('quality');

  /** The first of `people` the company lets do it; a permission refusal passes to the next, and is noted. */
  const asEither = async (people, call) => {
    for (const [index, who] of people.entries()) {
      try {
        return await call(who);
      } catch (error) {
        if (isPermissionRefusal(error) && index < people.length - 1) {
          const next = people[index + 1];
          const step = `${error.method} ${shortRoute(error.route)}`;
          noteOnce(`either ${who.email} ${step}`, `${handle(who)} was refused ${step} (${error.code}); ${handle(next)} was asked next`);
          continue;
        }
        throw error;
      }
    }
    return null;
  };

  if (ctx.project.stage && ctx.project.stage !== 'active') ctx.note(`the project is ${ctx.project.stage}: its subcontracts are made like an active job's, dated inside the project's life`);

  // ── the approval workflows that could own a decision ─────────────────────
  // A submit starts a workflow after it answers (fire-and-forget), so a
  // decision sent at once can land before the workflow exists and leave it
  // running on a decided record. Where a template exists for the tool, the
  // driver waits for the workflow after each submit and cancels it (noted),
  // and looks again after each decision.
  const workflowTools = new Set();
  for (const tool of ['commitment', 'sub_pay_app']) {
    const templates = listOf(await pm.GET(`${P}/workflows/templates?tool=${tool}`));
    if (templates.length) workflowTools.add(tool);
  }
  if (workflowTools.size) ctx.note(`approval workflow templates are active for ${[...workflowTools].join(', ')}: each decision is taken after cancelling the workflow`);

  const runningWorkflow = async (tool, recordId) =>
    listOf(await pm.GET(`${P}/workflows/instances?tool=${tool}&recordId=${recordId}&status=running`))[0] || null;
  const cancelWorkflow = async (instance, why) => {
    await pm.POST(`${P}/workflows/instances/${instance.id}/cancel`, { reason: `${mark('workflow_cancel')} ${why}` });
    ctx.note(`workflow ${instance.template?.name || instance.templateId || instance.id} on a ${instance.tool} was cancelled: ${why}`);
  };
  /** After a submit: waits up to ~3 s for the auto-started workflow and cancels it. */
  const settle = async (tool, recordId) => {
    if (!workflowTools.has(tool)) return;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const running = await runningWorkflow(tool, recordId);
      if (running) return cancelWorkflow(running, 'decided directly by the certification driver');
      await sleep(300);
    }
    return undefined;
  };
  /** After a decision: a workflow that started too late to lock it is a product lead, noted and cancelled. */
  const afterDecision = async (tool, recordId) => {
    if (!workflowTools.has(tool)) return;
    const running = await runningWorkflow(tool, recordId);
    if (running) await cancelWorkflow(running, 'PRODUCT LEAD: it was still running on a record already decided');
  };

  /** A decision a running approval workflow owns is taken back from it first. */
  const decide = async (tool, recordId, call) => {
    let result;
    try {
      result = await call();
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'WORKFLOW_RUNNING' || !error.details?.instanceId) throw error;
      await pm.POST(`${P}/workflows/instances/${error.details.instanceId}/cancel`, { reason: `${mark('workflow_cancel')} decided directly` });
      ctx.note(`a workflow held ${error.method} ${shortRoute(error.route)}; it was cancelled and the decision taken directly`);
      result = await call();
    }
    await afterDecision(tool, recordId);
    return result;
  };

  // ── dates: the window certified cost may be posted in ────────────────────
  const projectStart = String(ctx.project.startDate || ctx.daysAgo(120)).slice(0, 10);
  const projectEnd = String(ctx.project.endDate || ctx.daysAhead(365)).slice(0, 10);
  const reportingPeriods = listOf(await pm.GET(`${P}/reports/periods`));
  const lockedThrough = reportingPeriods
    .filter((period) => period.status === 'locked' && period.periodEnd)
    .reduce((latest, period) => (String(period.periodEnd).slice(0, 10) > latest ? String(period.periodEnd).slice(0, 10) : latest), '');
  const windowEnd = projectEnd < ctx.today ? projectEnd : ctx.today;
  let windowStart = [projectStart, lockedThrough ? isoDay(dayMs(lockedThrough) + DAY) : '', isoDay(dayMs(windowEnd) - 180 * DAY)].reduce((a, b) => (b > a ? b : a), '');
  if (windowStart > windowEnd) {
    ctx.note(`no open day between the project's start ${projectStart}, the locked periods (through ${lockedThrough || 'none'}) and ${windowEnd}: every pay-app period is ${windowEnd}`);
    windowStart = windowEnd;
  }
  state.periods = { windowStart, windowEnd, lockedThrough: lockedThrough || null, projectStart, projectEnd, byPayApp: state.periods?.byPayApp || {} };
  const windowDays = Math.round((dayMs(windowEnd) - dayMs(windowStart)) / DAY) + 1;
  /** `count` consecutive periods that split the window, oldest first. */
  const slotsOf = (count) =>
    Array.from({ length: count }, (_, index) => {
      const from = Math.floor((index * windowDays) / count);
      const to = Math.max(from, Math.floor(((index + 1) * windowDays) / count) - 1);
      return { periodStart: isoDay(dayMs(windowStart) + from * DAY), periodEnd: isoDay(dayMs(windowStart) + to * DAY) };
    });
  const schedule = new Map();
  const nextPeriod = (commitment, planned) => {
    if (!schedule.has(commitment.id)) schedule.set(commitment.id, { slots: slotsOf(planned), next: 0 });
    const plan = schedule.get(commitment.id);
    const slot = plan.slots[Math.min(plan.next, plan.slots.length - 1)];
    plan.next += 1;
    return slot;
  };
  /** A payment date: some days after the period, never after today. */
  const paidOn = (payApp) => {
    const after = isoDay(dayMs(payApp.periodEnd || windowEnd) + rng.int(3, 20) * DAY);
    return after < ctx.today ? after : ctx.today;
  };
  const commitmentStart = projectStart;
  const commitmentEnd = projectEnd > projectStart ? projectEnd : isoDay(dayMs(projectStart) + 180 * DAY);

  // ── helpers ──────────────────────────────────────────────────────────────

  /** Uploads a PDF onto a record; returns the project document's id. */
  const attach = async (who, recordType, recordId, label) => {
    const canary = mark('attachment');
    const result = await who.upload('POST', `${P}/attachments`, {
      field: 'files',
      filename: `${canary}-${label}.pdf`,
      contentType: 'application/pdf',
      body: pdfOf(`${canary} ${label}`),
      fields: { recordType, recordId, caption: `${canary} ${label}` },
    });
    const item = listOf(result)[0] || result;
    ctx.record('attachment', item.id);
    const documentId = item.documentId || item.document?.id;
    if (!documentId) throw new Error(`the attachment ${item.id} on ${recordType} ${recordId} came back without its project document`);
    ctx.record('project_document', documentId);
    return documentId;
  };

  // Bill rows that are allocated to an activity: a schedule-of-values line
  // names the bill row, the activity that row is built by, a cost code and
  // that cost code's budget line.
  const allocated = Object.entries(ctx.refs.allocations || {})
    .filter(([code, parts]) => parts?.length && ctx.refs.boq?.[code] && ctx.refs.boqRows?.[code])
    .map(([code, parts]) => ({ code, activityCode: parts[0].activityCode }));
  const activityCodes = Object.keys(ctx.refs.activities || {});
  const everyRow = allocated.length
    ? allocated
    : Object.keys(ctx.refs.boq || {}).map((code, index) => ({ code, activityCode: activityCodes[index % activityCodes.length] }));
  if (!everyRow.length || !activityCodes.length) throw new Error('subcontract: the foundation left no bill rows or no activities to tie a schedule of values to');

  // A pay application is capped by the approved progress of each line's
  // activity. Lines go on activities with no approved progress (no cap) or
  // with most of it approved, so the certificates below can be claimed.
  const progress = new Map(
    listOf(await pm.GET(`${P}/activities`)).map((row) => [row.activityCode, { approved: Boolean(row.approvedProgressUpdatedAt), pct: Number(row.pctComplete) || 0 }])
  );
  const claimable = everyRow.filter(({ activityCode }) => {
    const p = progress.get(activityCode);
    return !p || !p.approved || p.pct >= 60;
  });
  const pool = claimable.length ? claimable : [...everyRow].sort((a, b) => (progress.get(b.activityCode)?.pct || 0) - (progress.get(a.activityCode)?.pct || 0));
  if (pool.length < everyRow.length) ctx.note(`${everyRow.length - pool.length} of ${everyRow.length} bill rows were left off the schedules of values: their activity's approved progress would cap a claim`);

  let cursor = rng.int(0, pool.length - 1);
  const sovLines = (count, costCodes, { lumpSum = false } = {}) =>
    Array.from({ length: count }, (_, index) => {
      const pick = pool[cursor % pool.length];
      cursor += 1;
      const row = ctx.refs.boqRows?.[pick.code] || { quantity: 100, rate: 50, unit: 'item' };
      const costCode = costCodes[index % costCodes.length];
      const qty = Math.max(1, Math.round(row.quantity * (rng.int(10, 40) / 100)));
      const rate = Math.max(1, round2(row.rate * (rng.int(70, 95) / 100)));
      const line = {
        lineNumber: index + 1,
        description: `${mark('commitment_sov_line')} ${pick.code} works`,
        costCodeId: ctx.companyRefs.costCodes[costCode],
        budgetLineId: ctx.refs.budgetLines[costCode],
        boqItemId: ctx.refs.boq[pick.code],
        activityId: ctx.refs.activities[pick.activityCode],
        unit: row.unit,
        notes: `${mark('commitment_sov_note')} priced from the bill`,
      };
      // Every third line is a lump sum: an amount and no rate.
      return lumpSum && index % 3 === 2 ? { ...line, unit: 'sum', qty: 1, amount: round2(qty * rate) } : { ...line, qty, rate };
    });

  const recordLines = (commitment) => {
    for (const line of commitment.lines || []) ctx.record('commitment_sov_line', line.id);
  };

  /** Fills the refs from a commitment as it now stands (its records were recorded when made). */
  const remember = (commitment) => {
    ctx.refs.commitments[commitment.ref] = commitment.id;
    (state.byState[commitment.status] = state.byState[commitment.status] || []).push(commitment.id);
    state.sovLines[commitment.ref] = (commitment.lines || []).map((line) => ({ id: line.id, activityId: line.activityId, costCodeId: line.costCodeId, budgetLineId: line.budgetLineId, amount: line.amount }));
    return commitment;
  };

  /** Raises a commitment and records it and its lines at once (unless the lines are about to be replaced). */
  const raise = async (who, { type = 'subcontract', label, vendor = subcontractor, lines, extra = {}, linesReplacedLater = false }) => {
    const canary = mark('commitment');
    const created = await who.POST(`${P}/commitments`, {
      type,
      title: `${canary} ${label} (${tag})`,
      description: `${canary} description: ${label}`,
      ...(vendor ? { vendorCompanyId: vendor } : {}),
      retentionRate: rng.pick([5, 10]),
      paymentTerms: `${canary} 30 days from certification`,
      startDate: commitmentStart,
      endDate: commitmentEnd,
      notes: `${canary} notes`,
      lines,
      ...extra,
    });
    ctx.record('commitment', created.id);
    if (!linesReplacedLater) recordLines(created);
    if ((created.lines || []).length !== lines.length) throw new Error(`${created.ref}: ${lines.length} schedule-of-values lines were sent, ${(created.lines || []).length} came back`);
    return created;
  };

  const submit = async (who, id) => {
    const submitted = await who.POST(`${P}/commitments/${id}/submit`);
    await settle('commitment', id);
    return submitted;
  };
  const approve = (id) => decide('commitment', id, () => pm.POST(`${P}/commitments/${id}/approve`));
  const executeWithFile = async (who, commitment) => {
    const canary = mark('commitment_signed');
    const executed = await who.upload('POST', `${P}/commitments/${commitment.id}/execute`, {
      field: 'file',
      filename: `${canary}-${commitment.ref}-signed.pdf`,
      contentType: 'application/pdf',
      body: pdfOf(`${canary} ${commitment.ref} countersigned by both parties`),
    });
    const documentId = executed.executedDocument?.id || executed.executedDocumentId;
    if (documentId) ctx.record('project_document', documentId);
    if (executed.status !== 'executed') throw new Error(`${commitment.ref}: expected executed, got ${executed.status}`);
    return executed;
  };

  // ── payment applications ─────────────────────────────────────────────────

  const payAppFor = async (who, commitment, { planned, extra = {} }) => {
    const canary = mark('sub_pay_app');
    const period = nextPeriod(commitment, planned);
    const created = await who.POST(`${P}/pay-apps`, {
      commitmentId: commitment.id,
      periodLabel: `${period.periodEnd.slice(0, 7)} ${canary}`.slice(0, 60),
      ...period,
      notes: `${canary} notes`,
      ...extra,
    });
    ctx.record('sub_pay_app', created.id);
    for (const line of created.lines || []) ctx.record('sub_pay_app_line', line.id);
    state.payApps[created.ref] = created.id;
    state.periods.byPayApp[created.ref] = period;
    return created;
  };
  const submitPayApp = async (who, payApp) => {
    const submitted = await who.POST(`${P}/pay-apps/${payApp.id}/submit`);
    await settle('sub_pay_app', payApp.id);
    return submitted;
  };

  /** Materials certified on a line by this run's approved applications; the serialised line does not carry them. */
  const materialsCertified = new Map();

  /**
   * What to claim this period on each line: `fraction` of the line (or all
   * that is left), never past the line's value (less materials already
   * certified on it) nor past the approved progress of its activity.
   */
  const claimsFor = (payApp, fraction, { materialsOn = -1 } = {}) =>
    payApp.lines.map((line, index) => {
      const ceiling = line.revisedScheduledAmount;
      const left = ceiling - line.previousAmount - (materialsCertified.get(line.sovLineId) || 0);
      const room = line.capAmount === null || line.capAmount === undefined ? left : Math.min(left, line.capAmount - line.previousAmount);
      const want = fraction >= 1 ? left : Math.floor(ceiling * fraction);
      const amount = Math.max(0, round2(Math.min(want, room)));
      const claim = { sovLineId: line.sovLineId, thisPeriodAmount: amount, notes: `${mark('sub_pay_app_line')} measured on site` };
      if (index === materialsOn && left - amount > 2) claim.materialsOnSite = Math.floor((left - amount) / 10);
      return claim;
    });

  /** Claims on a draft. `required` claims must come to something: a certificate the run is built on cannot be empty. */
  const claim = async (who, payApp, fraction, { extra = {}, materialsOn = -1, required = true } = {}) => {
    const updated = await who.PATCH(`${P}/pay-apps/${payApp.id}`, { lines: claimsFor(payApp, fraction, { materialsOn }), ...extra });
    updated.claimed = updated.grossThisPeriod > 0.01;
    if (!updated.claimed) {
      if (required) throw new Error(`${updated.ref}: nothing could be claimed (approved progress caps every line), so the certificate this run needs cannot be made`);
      ctx.note(`${updated.ref}: nothing could be claimed, so it stays an empty draft`);
    }
    return updated;
  };

  /**
   * Approval. A compliance or closeout refusal is approved over with a reason
   * and noted; `expectOverride` says the run planned it (the final certificate
   * of a subcontract whose closeout is not finished), and any other is noted
   * as unexpected.
   */
  const approvePayApp = async (payApp, { expectOverride = false } = {}) => {
    let approved;
    try {
      approved = await decide('sub_pay_app', payApp.id, () => pm.POST(`${P}/pay-apps/${payApp.id}/approve`));
    } catch (error) {
      if (!(error instanceof ApiError) || !['CLOSEOUT_OUTSTANDING', 'SUB_PAY_APP_COMPLIANCE'].includes(error.code)) throw error;
      ctx.note(`${payApp.ref}: approved with a compliance override (${error.code}: ${error.serverMessage})${expectOverride ? '' : ' — UNEXPECTED, the run did not plan this override'}`.slice(0, 300));
      approved = await decide('sub_pay_app', payApp.id, () =>
        pm.POST(`${P}/pay-apps/${payApp.id}/approve`, { complianceOverrideReason: `${mark('sub_pay_app_override')} approved against a written undertaking (${error.code})` })
      );
    }
    if (!['approved', 'paid'].includes(approved.status)) throw new Error(`${approved.ref}: expected approved, got ${approved.status}`);
    for (const line of approved.lines || []) {
      if (line.materialsOnSite > 0) materialsCertified.set(line.sovLineId, round2((materialsCertified.get(line.sovLineId) || 0) + line.materialsOnSite));
    }
    return approved;
  };

  const pay = async (payApp, share) => {
    const amount = round2(payApp.netThisPeriod * share);
    if (!(amount > 0)) throw new Error(`${payApp.ref}: a net of ${payApp.netThisPeriod} leaves nothing to pay`);
    const canary = mark('sub_pay_app_payment');
    const before = new Set((payApp.payments || []).map((p) => p.id));
    const paid = await finance.POST(`${P}/pay-apps/${payApp.id}/payments`, {
      amount,
      paidAt: paidOn(payApp),
      method: 'bank_transfer',
      reference: `${canary}-REF`,
      note: `${canary} payment note`,
    });
    const fresh = (paid.payments || []).filter((payment) => !before.has(payment.id));
    if (fresh.length !== 1) throw new Error(`${payApp.ref}: one payment was recorded, ${fresh.length} new payments came back`);
    ctx.record('sub_pay_app_payment', fresh[0].id);
    return paid;
  };

  // ── change orders on a commitment ────────────────────────────────────────

  const changeOrder = async (who, commitment, { withLines = true, share = 0.08 } = {}) => {
    const canary = mark('commitment_change_order');
    const line = commitment.lines[rng.int(0, commitment.lines.length - 1)];
    const amount = Math.max(100, Math.round(line.amount * share));
    const created = await who.POST(`${P}/commitments/${commitment.id}/change-orders`, {
      title: `${canary} variation (${tag})`,
      description: `${canary} description`,
      ...(withLines
        ? { lines: [{ amount, sovLineId: line.id, description: `${canary} extra to line ${line.lineNumber}`, costCodeId: line.costCodeId, budgetLineId: line.budgetLineId, activityId: line.activityId }] }
        : { value: amount }),
    });
    ctx.record('commitment_change_order', created.id);
    return created;
  };
  const coStep = (who, co, step, body = {}) => who.POST(`${P}/commitments/change-orders/${co.id}/${step}`, body);

  // ── the scope / closeout / evaluation sheets ─────────────────────────────

  const scopeSheet = async (commitment, { complete }) => {
    const sheet = await qs.GET(`${P}/commitments/${commitment.id}/scope`);
    const parties = ['subcontractor', 'gc', 'subcontractor', 'shared', 'subcontractor', 'by_others', 'not_applicable'];
    const items = sheet.items.map((item, index) => ({
      kind: item.kind,
      section: item.section,
      description: item.description,
      responsibility: complete || index % 3 !== 0 ? parties[index % parties.length] : null,
      notes: index % 5 === 0 ? `${mark('scope_matrix_item')} agreed at the pre-start meeting` : null,
      sortOrder: item.sortOrder,
    }));
    for (const kind of ['inclusion', 'exclusion', 'clarification', 'interface']) {
      const canary = mark('scope_matrix_item');
      items.push({ kind, section: `Commercial ${canary}`.slice(0, 80), description: `${canary} ${kind}`, notes: `${canary} note`, sortOrder: items.length });
    }
    const canary = mark('scope_matrix');
    const saved = await qs.PUT(`${P}/commitments/${commitment.id}/scope`, { title: `${canary} ${commitment.ref} scope`, notes: `${canary} notes`, items });
    ctx.record('scope_matrix', saved.id);
    for (const item of saved.items) ctx.record('scope_matrix_item', item.id);
    if (saved.items.length !== items.length) throw new Error(`${commitment.ref}: ${items.length} scope rows were sent, ${saved.items.length} came back`);
    if (complete) await asEither([qs, pm], (who) => who.POST(`${P}/commitments/${commitment.id}/scope/agree`));
    return saved;
  };

  const closeoutItem = (commitment, key, body) =>
    asEither([site, quality, qs, pm], (who) => who.PATCH(`${P}/commitments/${commitment.id}/closeout/items/${key}`, body));

  const recordCloseout = async (commitment) => {
    const sheet = await qs.GET(`${P}/commitments/${commitment.id}/closeout`);
    ctx.record('subcontract_closeout', sheet.id);
    for (const item of sheet.items) if (item.id) ctx.record('closeout_item', item.id);
    return sheet;
  };

  const evaluate = async (commitment, { verdict = null, finalise = false, reopen = false, rated = ['schedule', 'management'] } = {}) => {
    const sheet = await qs.GET(`${P}/commitments/${commitment.id}/evaluation`);
    ctx.record('subcontractor_evaluation', sheet.id);
    for (const criterion of sheet.criteria || []) if (criterion.id) ctx.record('evaluation_criterion', criterion.id);
    const score = (key, body) => asEither([site, quality, qs, pm], (who) => who.PATCH(`${P}/commitments/${commitment.id}/evaluation/criteria/${key}`, body));
    for (const key of rated) await score(key, { score: rng.int(2, 5), note: `${mark('evaluation_criterion')} ${key}` });
    const canary = mark('evaluation_criterion');
    await score('quality', { score: rng.int(1, 4), overrideReason: `${canary} two defects were dealt with off the register`, note: `${canary} override note` });
    if (verdict !== null) {
      await asEither([qs, pm], (who) =>
        who.PATCH(`${P}/commitments/${commitment.id}/evaluation`, { wouldReuse: verdict, summary: `${mark('subcontractor_evaluation')} ${verdict ? 'would use again' : 'would not use again'}` })
      );
    }
    if (finalise) await asEither([qs, pm], (who) => who.POST(`${P}/commitments/${commitment.id}/evaluation/final`));
    if (reopen) await asEither([qs, pm], (who) => who.POST(`${P}/commitments/${commitment.id}/evaluation/reopen`, { reason: `${mark('subcontractor_evaluation')} a late defect came to light` }));
  };

  // ════════════════════════════════════════════════════════════════════════
  // main: the subcontract everything happens to
  // ════════════════════════════════════════════════════════════════════════
  {
    let main = await raise(qs, { label: 'blockwork and finishes subcontract', lines: sovLines(ctx.count(2, 4), SUB_CODES, { lumpSum: true }) });

    // Insurance: a required cover with its certificate on file, and an optional one.
    const certificate = await attach(qs, 'commitment', main.id, 'insurance-certificate');
    const cover = mark('commitment_insurance');
    await qs.PUT(`${P}/commitments/${main.id}/insurance`, {
      insurance: [
        { type: 'general_liability', label: `${cover} public liability`, required: true, documentId: certificate, expiresAt: ctx.daysAhead(300), note: `${cover} note` },
        { type: 'workers_compensation', label: `${cover} workers compensation`, required: false },
      ],
    });
    await qs.PATCH(`${P}/commitments/${main.id}`, { description: `${mark('commitment')} description, revised before submission`, endDate: isoDay(Math.max(dayMs(commitmentStart), dayMs(commitmentEnd) - 7 * DAY)) });

    await scopeSheet(main, { complete: true });
    await qs.GET(`${P}/commitments/${main.id}/agreement`);
    const agreement = await qs.download(`${P}/commitments/${main.id}/agreement.pdf`);
    if (agreement.subarray(0, 4).toString() !== '%PDF') throw new Error(`${main.ref}: the agreement did not come back as a PDF`);

    await submit(qs, main.id);
    await approve(main.id);
    main = await executeWithFile(finance, main);
    await qs.download(`${P}/commitments/${main.id}/export.pdf`);

    // Change orders, one in each state.
    const approvedCos = ctx.count(1, 2);
    for (let i = 0; i < approvedCos; i += 1) {
      const co = await changeOrder(qs, main);
      if (i === 0) await attach(qs, 'commitment_change_order', co.id, 'variation-instruction');
      await coStep(qs, co, 'submit');
      await coStep(pm, co, 'approve');
    }
    await coStep(qs, await changeOrder(qs, main, { share: 0.05 }), 'submit');
    const refused = await changeOrder(qs, main, { share: 0.2 });
    await coStep(qs, refused, 'submit');
    await coStep(pm, refused, 'reject', { reason: `${mark('commitment_change_order')} not instructed by the engineer` });
    const draftCo = await changeOrder(qs, main, { withLines: false });
    await qs.PATCH(`${P}/commitments/change-orders/${draftCo.id}`, { description: `${mark('commitment_change_order')} description, repriced` });
    const voidCo = await changeOrder(qs, main, { withLines: false, share: 0.03 });
    await coStep(qs, voidCo, 'void', { reason: `${mark('commitment_change_order')} raised twice` });

    // A change order spawned from a prime (client) change order. The prime
    // change order is this driver's own: raised on the first run, reused after.
    let primeId = state.primeChangeOrderId || null;
    if (!primeId) {
      const line = main.lines[0];
      const prime = await qs.POST(`${P}/change-orders`, {
        description: `${mark('change_order')} client instruction passed down to the subcontract`,
        activityId: line.activityId,
        budgetLineId: line.budgetLineId,
        value: Math.max(500, Math.round(line.amount * 0.1)),
        scheduleImpact: 2,
      });
      ctx.record('change_order', prime.id);
      primeId = state.primeChangeOrderId = prime.id;
    }
    const spawnedCanary = mark('commitment_change_order');
    const spawned = await qs.POST(`${P}/commitments/change-orders/from-prime`, {
      primeChangeOrderId: primeId,
      items: [{ commitmentId: main.id, title: `${spawnedCanary} from the prime change`, description: `${spawnedCanary} description`, value: Math.max(200, Math.round(main.lines[0].amount * 0.04)) }],
    });
    if ((spawned.items || []).length !== 1) throw new Error(`${main.ref}: one change order was asked of the prime change order, ${(spawned.items || []).length} came back`);
    for (const co of spawned.items) ctx.record('commitment_change_order', co.id);

    // Pay applications: paid, approved and part paid, void, submitted.
    let first = await claim(qs, await payAppFor(qs, main, { planned: 4 }), 0.25);
    await submitPayApp(qs, first);
    await decide('sub_pay_app', first.id, () => qs.POST(`${P}/pay-apps/${first.id}/review`, { note: `${mark('sub_pay_app')} checked against the site measure` }));
    first = await approvePayApp(first);
    await pay(first, 1);
    await qs.download(`${P}/pay-apps/${first.id}/export.pdf`);

    let second = await claim(qs, await payAppFor(qs, main, { planned: 4 }), 0.2);
    // Deductions sized to the claim, each with its reason, and tax on what is left.
    const deductions = mark('sub_pay_app');
    second = await qs.PATCH(`${P}/pay-apps/${second.id}`, {
      backCharges: round2(second.grossThisPeriod * 0.03),
      backChargesNote: `${deductions} clearing up after the gang`,
      otherDeductions: round2(second.grossThisPeriod * 0.02),
      otherDeductionsNote: `${deductions} site power`,
      taxRate: 5,
    });
    await submitPayApp(qs, second);
    second = await approvePayApp(second);
    await pay(second, 0.5);

    const scrapped = await payAppFor(qs, main, { planned: 4 });
    const voided = await pm.call('DELETE', `${P}/pay-apps/${scrapped.id}`, { reason: `${mark('sub_pay_app')} raised for the wrong period` });
    if (voided.status !== 'void') throw new Error(`${scrapped.ref}: expected void, got ${voided.status}`);

    const waived = await payAppFor(qs, main, { planned: 4, extra: { waiverRequired: true } });
    const waiver = await attach(qs, 'sub_pay_app', waived.id, 'lien-waiver');
    const third = await claim(qs, waived, 0.1, { extra: { waiverDocumentId: waiver } });
    await submitPayApp(qs, third);

    await evaluate(main, { rated: ['schedule'] });
    // The closeout checklist exists from its first read; it is opened here so it is on the inventory.
    await recordCloseout(main);
    remember(await qs.GET(`${P}/commitments/${main.id}`));
  }

  // ════════════════════════════════════════════════════════════════════════
  // second: raised by procurement, returned once, executed on a document
  // already on the project with a missing bond overridden
  // ════════════════════════════════════════════════════════════════════════
  {
    const bond = mark('commitment_insurance');
    let second = await raise(procurement, {
      label: 'MEP first fix subcontract',
      lines: sovLines(2, ['04-100']),
      extra: { insurance: [{ type: 'bond', label: `${bond} performance bond`, required: true, note: `${bond} awaited from the surety` }] },
      linesReplacedLater: true,
    });
    await submit(procurement, second.id);
    await decide('commitment', second.id, () => pm.POST(`${P}/commitments/${second.id}/return`, { reason: `${mark('commitment')} split the first-fix line by floor` }));
    second = await procurement.PUT(`${P}/commitments/${second.id}/lines`, { lines: sovLines(ctx.count(2, 3), ['04-100', '05-100']) });
    recordLines(second);
    await scopeSheet(second, { complete: false });
    await submit(procurement, second.id);
    await approve(second.id);

    const signed = await attach(procurement, 'commitment', second.id, 'signed-agreement');
    // Executing with the required bond missing and no override must be refused.
    const blocked = await pm.send('POST', `${P}/commitments/${second.id}/execute`, { documentId: signed });
    if (blocked.status >= 500) ctx.note(`PRODUCT 5xx: POST ${P}/commitments/:id/execute without the required bond answered ${blocked.status} ${blocked.body?.error?.code || ''}`);
    else if (blocked.status === 200) ctx.note(`PRODUCT: ${second.ref} was executed with its required bond missing and no override (expected 409 COMMITMENT_INSURANCE_MISSING)`);
    else if (blocked.status !== 409 || blocked.body?.error?.code !== 'COMMITMENT_INSURANCE_MISSING') ctx.note(`${second.ref}: executing with a required bond missing answered ${blocked.status} ${blocked.body?.error?.code || ''}, not 409 COMMITMENT_INSURANCE_MISSING`);
    if (blocked.status !== 200) {
      second = await pm.POST(`${P}/commitments/${second.id}/execute`, { documentId: signed, override: true, overrideReason: `${mark('commitment')} bond to follow within 14 days` });
    } else second = blocked.body.data;
    if (second.status !== 'executed') throw new Error(`${second.ref}: expected executed, got ${second.status}`);

    // A pay application rejected, then the next one left as a draft with materials on site.
    const rejected = await claim(qs, await payAppFor(qs, second, { planned: 2 }), 0.15);
    await submitPayApp(qs, rejected);
    await decide('sub_pay_app', rejected.id, () => qs.POST(`${P}/pay-apps/${rejected.id}/reject`, { code: 'INCORRECT_QUANTITIES', reason: `${mark('sub_pay_app')} quantities do not match the site measure` }));
    await claim(qs, await payAppFor(qs, second, { planned: 2 }), 0.12, { materialsOn: 0, required: false });

    // Closeout started: one document in, one waived, one not applicable, the missing bond waived.
    await qs.GET(`${P}/commitments/${second.id}/closeout`);
    const asBuilts = await attach(qs, 'commitment', second.id, 'as-built-records');
    await closeoutItem(second, 'as_builts', { status: 'complete', documentId: asBuilts, note: `${mark('closeout_item')} as-builts received` });
    await closeoutItem(second, 'om_manuals', { status: 'waived', waivedReason: `${mark('closeout_item')} manuals are the supplier's, not this trade's` });
    await closeoutItem(second, 'training', { status: 'not_applicable', note: `${mark('closeout_item')} no plant handed over` });
    await closeoutItem(second, 'insurance_current', { status: 'waived', waivedReason: `${mark('closeout_item')} bond replaced by a parent company guarantee` });
    await recordCloseout(second);

    await evaluate(second, { verdict: false, finalise: true, reopen: true });
    remember(await qs.GET(`${P}/commitments/${second.id}`));
  }

  // ════════════════════════════════════════════════════════════════════════
  // closed: claimed in full, paid, closed out, evaluated, closed
  // ════════════════════════════════════════════════════════════════════════
  {
    let done = await raise(qs, { label: 'site clearance subcontract', lines: sovLines(ctx.count(1, 2), ['03-100', '05-100']) });
    await scopeSheet(done, { complete: true });
    await submit(qs, done.id);
    await approve(done.id);
    done = await executeWithFile(pm, done);

    // First certificate: approved, revoked for a correction, approved again, paid.
    let first = await claim(qs, await payAppFor(qs, done, { planned: 2 }), 0.6);
    await submitPayApp(qs, first);
    await approvePayApp(first);
    const reopened = await pm.POST(`${P}/pay-apps/${first.id}/reopen`, { reason: `${mark('sub_pay_app')} certified against the wrong measure` });
    if (reopened.status !== 'draft' || !(reopened.certificationRevision >= 1)) throw new Error(`${first.ref}: a revoked certificate should be a draft at revision 1 or more, got ${reopened.status} r${reopened.certificationRevision}`);
    first = await claim(qs, reopened, 0.55);
    await submitPayApp(qs, first);
    first = await approvePayApp(first);
    await pay(first, 1);

    // The final certificate: everything that is left. The closeout is not
    // finished yet, so the closeout gate refuses it and it is approved over.
    let last = await claim(qs, await payAppFor(qs, done, { planned: 2 }), 1);
    await submitPayApp(qs, last);
    await decide('sub_pay_app', last.id, () => qs.POST(`${P}/pay-apps/${last.id}/review`, { note: `${mark('sub_pay_app')} final account agreed` }));
    last = await approvePayApp(last, { expectOverride: true });
    await pay(last, 1);

    // Closeout: the handover documents in, the held retention waived, then complete.
    await qs.GET(`${P}/commitments/${done.id}/closeout`);
    for (const key of ['as_builts', 'om_manuals', 'warranties', 'lien_waiver']) {
      const documentId = await attach(qs, 'commitment', done.id, key.replace(/_/g, '-'));
      await closeoutItem(done, key, { status: 'complete', documentId, note: `${mark('closeout_item')} ${key} received` });
    }
    await closeoutItem(done, 'training', { status: 'complete', note: `${mark('closeout_item')} toolbox handover given` });
    await closeoutItem(done, 'spares', { status: 'not_applicable', note: `${mark('closeout_item')} no attic stock for clearance works` });
    await closeoutItem(done, 'retention_released', { status: 'waived', waivedReason: `${mark('closeout_item')} retention released on the final account` });
    const sheet = await qs.GET(`${P}/commitments/${done.id}/closeout`);
    const override = sheet.ready ? {} : { overrideReason: `${mark('subcontract_closeout')} completed with ${sheet.outstanding.join(', ')} outstanding` };
    if (!sheet.ready) ctx.note(`${done.ref}: closeout completed over ${sheet.outstanding.join(', ')}`.slice(0, 300));
    await asEither([qs, pm], (who) => who.POST(`${P}/commitments/${done.id}/closeout/complete`, override));
    await recordCloseout(done);

    await evaluate(done, { verdict: true, finalise: true });

    // Every certificate is paid in full, so the account is settled; only an unfinished closeout needs a reason.
    const closing = sheet.ready ? {} : { closeoutOverrideReason: `${mark('commitment')} closed on the PM's instruction` };
    const closed = await asEither([finance, pm], (who) => who.POST(`${P}/commitments/${done.id}/close`, closing));
    if (closed.status !== 'closed') throw new Error(`${done.ref}: expected closed, got ${closed.status}`);
    remember(await qs.GET(`${P}/commitments/${done.id}`));
  }

  // ════════════════════════════════════════════════════════════════════════
  // others: one subcontract in each state short of executed
  // ════════════════════════════════════════════════════════════════════════
  const kinds = ['pending', 'approved', 'draft', 'returned', 'void', 'bare'];
  const wanted = [...kinds, ...rng.shuffle(kinds).slice(0, ctx.count(0, 3))];
  for (const kind of wanted) {
    const who = rng.pick([qs, procurement, pm]);
    if (kind === 'bare') {
      // Nothing on it yet: no vendor, no schedule of values.
      const bare = await who.POST(`${P}/commitments`, { type: 'subcontract', title: `${mark('commitment')} package not yet let (${tag})` });
      ctx.record('commitment', bare.id);
      remember(bare);
      continue;
    }
    let other = await raise(who, { label: `${kind} package`, lines: sovLines(ctx.count(1, 3), SUB_CODES) });
    if (kind !== 'draft') other = await submit(who, other.id);
    if (kind === 'approved') {
      // Approved, but not ready to sign: its required cover lapsed ten days ago.
      const lapsed = await attach(qs, 'commitment', other.id, 'lapsed-insurance-certificate');
      const cover = mark('commitment_insurance');
      await qs.PUT(`${P}/commitments/${other.id}/insurance`, {
        insurance: [{ type: 'general_liability', label: `${cover} public liability`, required: true, documentId: lapsed, expiresAt: ctx.daysAgo(10), note: `${cover} renewal chased` }],
      });
      other = await approve(other.id);
    }
    if (kind === 'returned') other = await decide('commitment', other.id, () => pm.POST(`${P}/commitments/${other.id}/return`, { reason: `${mark('commitment')} rates to be rechecked against the bill` }));
    if (kind === 'void') other = await pm.call('DELETE', `${P}/commitments/${other.id}`, { reason: `${mark('commitment')} package withdrawn` });
    const expected = { pending: 'pending', approved: 'approved', draft: 'draft', returned: 'draft', void: 'void' }[kind];
    if (other.status !== expected) throw new Error(`${other.ref}: the ${kind} package should be ${expected}, got ${other.status}`);
    remember(other);
  }

  // ════════════════════════════════════════════════════════════════════════
  // purchase: purchase-order commitments with the supplier
  // ════════════════════════════════════════════════════════════════════════
  const purchases = ctx.count(1, 3);
  for (let i = 0; i < purchases; i += 1) {
    let order = await raise(procurement, { type: 'purchase_order', label: 'supply-only commitment', vendor: supplier, lines: sovLines(ctx.count(1, 3), MATERIAL_CODES) });
    order = await submit(procurement, order.id);
    if (i !== 1) order = await approve(order.id);
    if (i === 0) {
      order = await executeWithFile(finance, order);
      const co = await changeOrder(procurement, order);
      await coStep(procurement, co, 'submit');
      await coStep(pm, co, 'approve');
      // Under review with a lien waiver required and none on file: it cannot be approved as it stands.
      const delivery = await claim(qs, await payAppFor(qs, order, { planned: 1, extra: { waiverRequired: true } }), 0.3);
      await submitPayApp(qs, delivery);
      await decide('sub_pay_app', delivery.id, () => qs.POST(`${P}/pay-apps/${delivery.id}/review`, { note: `${mark('sub_pay_app')} delivery notes being matched` }));
    }
    remember(await procurement.GET(`${P}/commitments/${order.id}`));
  }

  // ════════════════════════════════════════════════════════════════════════
  // once per company: prequalification of the two vendors
  // ════════════════════════════════════════════════════════════════════════
  const company = (ctx.companyRefs.subcontract = ctx.companyRefs.subcontract || {});
  company.prequalifications = company.prequalifications || {};
  if (!company.prequalified) {
    for (const [vendorId, decideIt] of [[subcontractor, true], [supplier, false]]) {
      const sheet = await pm.GET(`/company/vendors/${vendorId}/prequalification`);
      if (!company.prequalifications[vendorId]) {
        company.prequalifications[vendorId] = sheet.id;
        ctx.record('vendor_prequalification', sheet.id, { scope: 'company' });
        for (const criterion of sheet.criteria) ctx.record('prequal_criterion', criterion.id, { scope: 'company' });
      }
      if (!['draft', 'under_review'].includes(sheet.status)) {
        ctx.note(`the ${decideIt ? 'subcontractor' : 'supplier'}'s prequalification was already ${sheet.status}; left as it is`);
        continue;
      }
      const criteria = decideIt ? sheet.criteria : sheet.criteria.slice(0, 4);
      for (const criterion of criteria) {
        const canary = mark('prequal_criterion');
        await pm.PATCH(`/company/vendors/${vendorId}/prequalification/criteria/${criterion.key}`, {
          score: rng.int(3, 5),
          note: `${canary} ${criterion.key}`,
          reference: `${canary}-REF`,
          ...(criterion.tracksExpiry ? { expiresAt: ctx.daysAhead(330) } : {}),
        });
      }
      if (!decideIt) continue;
      const canary = mark('vendor_prequalification');
      const decided = await pm.POST(`/company/vendors/${vendorId}/prequalification/decision`, {
        status: 'conditionally_approved',
        validUntil: ctx.daysAhead(365),
        conditions: `${canary} audited accounts to be supplied each year`,
        decisionNote: `${canary} decided by the PM`,
      });
      if (decided.status !== 'conditionally_approved') throw new Error(`the subcontractor's prequalification should be conditionally_approved, got ${decided.status}`);
    }
    company.prequalified = true;
  }

  state.executed = [...(state.byState.executed || [])];
  state.closed = [...(state.byState.closed || [])];
};

module.exports = { name: 'subcontract', needs: ['foundation'], depths: ['standard'], run };
