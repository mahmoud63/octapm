'use strict';

/**
 * Subcontracts: commitments with their schedule of values, the agreement, the
 * change orders, the scope / closeout / evaluation sheets, and the payment
 * applications that turn certified work into subcontract actual cost.
 *
 * What one run leaves in a project (every run makes a fresh set, so a second
 * run adds to the first rather than colliding with it):
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
 * Later drivers find the commitments in ctx.refs.commitments ({ ref: id }) and
 * the detail in ctx.refs.subcontract.
 */

const { ApiError } = require('../lib/api');

const SUB_CODES = ['03-100', '04-100', '05-100'];
const MATERIAL_CODES = ['02-100', '02-200'];

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const listOf = (data) => (Array.isArray(data) ? data : data?.items || data?.orders || data?.rows || []);

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

  /**
   * A persona's session. Where a company's permissions refuse the persona a
   * step (a 403), the PM does it instead and the refusal is noted once, so one
   * tightened role does not cost the project all of its subcontract records.
   */
  const refusedOnce = new Set();
  const persona = (key) => {
    const who = ctx.who(key);
    if (who.email === pm.email) return who;
    const standIn = (method) => async (...args) => {
      try {
        return await who[method](...args);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 403) throw error;
        if (!refusedOnce.has(key)) {
          refusedOnce.add(key);
          ctx.note(`${key} was refused ${error.method} ${String(error.route).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')} (${error.code}); the PM stood in for that and any later refusal`);
        }
        return pm[method](...args);
      }
    };
    return { ...who, GET: standIn('GET'), POST: standIn('POST'), PATCH: standIn('PATCH'), PUT: standIn('PUT'), call: standIn('call'), upload: standIn('upload'), download: standIn('download') };
  };
  const qs = persona('qs');
  const procurement = persona('procurement');
  const finance = persona('finance');
  // The site and quality engineers are only ever tried first (asEither), so they stay as they are.
  const site = ctx.who('site');
  const quality = ctx.who('quality');

  const state = (ctx.refs.subcontract = ctx.refs.subcontract || {});
  state.run = (state.run || 0) + 1;
  state.byState = {};
  state.sovLines = state.sovLines || {};
  state.payApps = state.payApps || {};
  ctx.refs.commitments = ctx.refs.commitments || {};
  const tag = `run ${state.run}`;

  const subcontractor = ctx.companyRefs.directory.subcontractor;
  const supplier = ctx.companyRefs.directory.supplier;

  // ── helpers ──────────────────────────────────────────────────────────────

  /** A decision a running approval workflow owns is taken back from it first. */
  const decide = async (call) => {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'WORKFLOW_RUNNING' || !error.details?.instanceId) throw error;
      await pm.POST(`${P}/workflows/instances/${error.details.instanceId}/cancel`, { reason: `${ctx.canary('workflow_cancel')} decided directly` });
      ctx.note(`a workflow held ${error.route}; it was cancelled and the decision taken directly`);
      return call();
    }
  };

  /** The first of `people` the product lets do it; a 403 passes to the next. */
  const asEither = async (people, call) => {
    for (const [index, who] of people.entries()) {
      try {
        return await call(who);
      } catch (error) {
        if (error instanceof ApiError && error.status === 403 && index < people.length - 1) continue;
        throw error;
      }
    }
    return null;
  };

  /** Uploads a PDF onto a record; returns the project document's id. */
  const attach = async (who, recordType, recordId, label) => {
    const canary = ctx.canary('attachment');
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
    if (documentId) ctx.record('project_document', documentId);
    return documentId;
  };

  // Bill rows that are allocated to an activity: a schedule-of-values line
  // names the bill row, the activity that row is built by, a cost code and
  // that cost code's budget line.
  const allocated = Object.entries(ctx.refs.allocations || {})
    .filter(([code, parts]) => parts?.length && ctx.refs.boq[code] && ctx.refs.boqRows?.[code])
    .map(([code, parts]) => ({ code, activityCode: parts[0].activityCode }));
  const activityCodes = Object.keys(ctx.refs.activities);
  const pool = allocated.length
    ? allocated
    : Object.keys(ctx.refs.boq).map((code, index) => ({ code, activityCode: activityCodes[index % activityCodes.length] }));
  if (!pool.length || !activityCodes.length) throw new Error('subcontract: the foundation left no bill rows or no activities to tie a schedule of values to');
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
        description: `${ctx.canary('commitment_sov_line')} ${pick.code} works`,
        costCodeId: ctx.companyRefs.costCodes[costCode],
        budgetLineId: ctx.refs.budgetLines[costCode],
        boqItemId: ctx.refs.boq[pick.code],
        activityId: ctx.refs.activities[pick.activityCode],
        unit: row.unit,
        notes: `${ctx.canary('commitment_sov_note')} priced from the bill`,
      };
      // Every third line is a lump sum: an amount and no rate.
      return lumpSum && index % 3 === 2 ? { ...line, unit: 'sum', qty: 1, amount: round2(qty * rate) } : { ...line, qty, rate };
    });

  const remember = (commitment) => {
    ctx.refs.commitments[commitment.ref] = commitment.id;
    (state.byState[commitment.status] = state.byState[commitment.status] || []).push(commitment.id);
    state.sovLines[commitment.ref] = (commitment.lines || []).map((line) => ({ id: line.id, activityId: line.activityId, costCodeId: line.costCodeId, budgetLineId: line.budgetLineId, amount: line.amount }));
    for (const line of commitment.lines || []) ctx.record('commitment_sov_line', line.id);
    return commitment;
  };

  const raise = async (who, { type = 'subcontract', label, vendor = subcontractor, lines, extra = {} }) => {
    const canary = ctx.canary('commitment');
    const created = await who.POST(`${P}/commitments`, {
      type,
      title: `${canary} ${label} (${tag})`,
      description: `${canary} description: ${label}`,
      ...(vendor ? { vendorCompanyId: vendor } : {}),
      retentionRate: rng.pick([5, 10]),
      paymentTerms: `${canary} 30 days from certification`,
      startDate: ctx.daysAgo(120),
      endDate: ctx.daysAhead(180),
      notes: `${canary} notes`,
      lines,
      ...extra,
    });
    ctx.record('commitment', created.id);
    return created;
  };

  const submit = (who, id) => who.POST(`${P}/commitments/${id}/submit`);
  const approve = (id) => decide(() => pm.POST(`${P}/commitments/${id}/approve`));
  const executeWithFile = async (who, commitment) => {
    const canary = ctx.canary('commitment_signed');
    const executed = await who.upload('POST', `${P}/commitments/${commitment.id}/execute`, {
      field: 'file',
      filename: `${canary}-${commitment.ref}-signed.pdf`,
      contentType: 'application/pdf',
      body: pdfOf(`${canary} ${commitment.ref} countersigned by both parties`),
    });
    if (executed.executedDocument?.id) ctx.record('project_document', executed.executedDocument.id);
    return executed;
  };

  // ── payment applications ─────────────────────────────────────────────────

  let periodCursor = 0;
  const nextPeriod = () => {
    periodCursor += 1;
    const end = 150 - periodCursor * 12;
    return { periodStart: ctx.daysAgo(end + 11), periodEnd: ctx.daysAgo(end) };
  };

  const payAppFor = async (who, commitment, extra = {}) => {
    const canary = ctx.canary('sub_pay_app');
    const created = await who.POST(`${P}/pay-apps`, {
      commitmentId: commitment.id,
      periodLabel: `${canary} r${state.run}`.slice(0, 60),
      ...nextPeriod(),
      notes: `${canary} notes`,
      ...extra,
    });
    ctx.record('sub_pay_app', created.id);
    for (const line of created.lines || []) ctx.record('sub_pay_app_line', line.id);
    state.payApps[created.ref] = created.id;
    return created;
  };

  /**
   * What to claim this period on each line: `fraction` of the line (or all
   * that is left), never past the line's value nor past the approved progress
   * of its activity where the project has any.
   */
  const claimsFor = (payApp, fraction, { materialsOn = -1 } = {}) =>
    payApp.lines.map((line, index) => {
      const ceiling = line.revisedScheduledAmount;
      const left = ceiling - line.previousAmount;
      const room = line.capAmount === null || line.capAmount === undefined ? left : Math.min(left, line.capAmount - line.previousAmount);
      const want = fraction >= 1 ? left : Math.floor(ceiling * fraction);
      const amount = Math.max(0, round2(Math.min(want, room)));
      const claim = { sovLineId: line.sovLineId, thisPeriodAmount: amount, notes: `${ctx.canary('sub_pay_app_line')} measured on site` };
      if (index === materialsOn && left - amount > 2) claim.materialsOnSite = Math.floor((left - amount) / 10);
      return claim;
    });

  const claim = async (who, payApp, fraction, { extra = {}, materialsOn = -1 } = {}) => {
    const updated = await who.PATCH(`${P}/pay-apps/${payApp.id}`, { lines: claimsFor(payApp, fraction, { materialsOn }), ...extra });
    updated.claimed = updated.grossThisPeriod > 0.01;
    if (!updated.claimed) ctx.note(`${updated.ref}: nothing could be claimed (approved progress caps every line), so it stays a draft`);
    return updated;
  };

  const approvePayApp = async (payApp) => {
    try {
      return await decide(() => pm.POST(`${P}/pay-apps/${payApp.id}/approve`));
    } catch (error) {
      // The application that takes a subcontract to its full value runs the
      // closeout gate, and missing cover blocks any; the PM goes ahead with a reason.
      if (!(error instanceof ApiError) || !['CLOSEOUT_OUTSTANDING', 'SUB_PAY_APP_COMPLIANCE'].includes(error.code)) throw error;
      return decide(() =>
        pm.POST(`${P}/pay-apps/${payApp.id}/approve`, { complianceOverrideReason: `${ctx.canary('sub_pay_app_override')} approved against a written undertaking (${error.code})` })
      );
    }
  };

  const pay = async (payApp, share) => {
    const amount = round2(payApp.netThisPeriod * share);
    if (!(amount > 0)) return payApp;
    const canary = ctx.canary('sub_pay_app_payment');
    const before = new Set((payApp.payments || []).map((p) => p.id));
    const paid = await finance.POST(`${P}/pay-apps/${payApp.id}/payments`, {
      amount,
      paidAt: ctx.daysAgo(rng.int(1, 20)),
      method: 'bank_transfer',
      reference: `${canary}-REF`,
      note: `${canary} payment note`,
    });
    for (const payment of paid.payments || []) if (!before.has(payment.id)) ctx.record('sub_pay_app_payment', payment.id);
    return paid;
  };

  // ── change orders on a commitment ────────────────────────────────────────

  const changeOrder = async (who, commitment, { withLines = true, share = 0.08 } = {}) => {
    const canary = ctx.canary('commitment_change_order');
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
      notes: index % 5 === 0 ? `${ctx.canary('scope_matrix_item')} agreed at the pre-start meeting` : null,
      sortOrder: item.sortOrder,
    }));
    for (const kind of ['inclusion', 'exclusion', 'clarification', 'interface']) {
      const canary = ctx.canary('scope_matrix_item');
      items.push({ kind, section: 'Commercial', description: `${canary} ${kind}`, notes: `${canary} note`, sortOrder: items.length });
    }
    const canary = ctx.canary('scope_matrix');
    const saved = await qs.PUT(`${P}/commitments/${commitment.id}/scope`, { title: `${canary} ${commitment.ref} scope`, notes: `${canary} notes`, items });
    ctx.record('scope_matrix', saved.id);
    for (const item of saved.items) ctx.record('scope_matrix_item', item.id);
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
    for (const key of rated) await score(key, { score: rng.int(2, 5), note: `${ctx.canary('evaluation_criterion')} ${key}` });
    const canary = ctx.canary('evaluation_criterion');
    await score('quality', { score: rng.int(1, 4), overrideReason: `${canary} two defects were dealt with off the register`, note: `${canary} override note` });
    if (verdict !== null) {
      await asEither([qs, pm], (who) =>
        who.PATCH(`${P}/commitments/${commitment.id}/evaluation`, { wouldReuse: verdict, summary: `${ctx.canary('subcontractor_evaluation')} ${verdict ? 'would use again' : 'would not use again'}` })
      );
    }
    if (finalise) await asEither([qs, pm], (who) => who.POST(`${P}/commitments/${commitment.id}/evaluation/final`));
    if (reopen) await asEither([qs, pm], (who) => who.POST(`${P}/commitments/${commitment.id}/evaluation/reopen`, { reason: `${ctx.canary('subcontractor_evaluation')} a late defect came to light` }));
  };

  // ════════════════════════════════════════════════════════════════════════
  // main: the subcontract everything happens to
  // ════════════════════════════════════════════════════════════════════════
  {
    let main = await raise(qs, { label: 'blockwork and finishes subcontract', lines: sovLines(ctx.count(2, 4), SUB_CODES, { lumpSum: true }) });

    // Insurance: a required cover with its certificate on file, and an optional one.
    const certificate = await attach(qs, 'commitment', main.id, 'insurance-certificate');
    const cover = ctx.canary('commitment_insurance');
    await qs.PUT(`${P}/commitments/${main.id}/insurance`, {
      insurance: [
        { type: 'general_liability', label: `${cover} public liability`, required: true, documentId: certificate, expiresAt: ctx.daysAhead(300), note: `${cover} note` },
        { type: 'workers_compensation', label: `${cover} workers compensation`, required: false },
      ],
    });
    await qs.PATCH(`${P}/commitments/${main.id}`, { description: `${ctx.canary('commitment')} description, revised before submission`, endDate: ctx.daysAhead(200) });

    await scopeSheet(main, { complete: true });
    await qs.GET(`${P}/commitments/${main.id}/agreement`);
    const agreement = await qs.download(`${P}/commitments/${main.id}/agreement.pdf`);
    if (agreement.subarray(0, 4).toString() !== '%PDF') throw new Error(`${main.ref}: the agreement did not come back as a PDF`);

    await submit(qs, main.id);
    await approve(main.id);
    main = await executeWithFile(finance, main);
    if (main.status !== 'executed') throw new Error(`${main.ref}: expected executed, got ${main.status}`);
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
    await coStep(pm, refused, 'reject', { reason: `${ctx.canary('commitment_change_order')} not instructed by the engineer` });
    const draftCo = await changeOrder(qs, main, { withLines: false });
    await qs.PATCH(`${P}/commitments/change-orders/${draftCo.id}`, { description: `${ctx.canary('commitment_change_order')} description, repriced` });
    const voidCo = await changeOrder(qs, main, { withLines: false, share: 0.03 });
    await coStep(qs, voidCo, 'void', { reason: `${ctx.canary('commitment_change_order')} raised twice` });

    // A change order spawned from a prime (client) change order.
    await ctx.attempt('commitment change order from a prime change order', async () => {
      // Any prime change order of the project will do: one this driver raised
      // on an earlier run, or one the change driver left.
      const existing = listOf(await qs.GET(`${P}/change-orders`));
      let prime = existing.find((order) => order.id === state.primeChangeOrderId) || existing[0];
      if (!prime) {
        const line = main.lines[0];
        prime = await qs.POST(`${P}/change-orders`, {
          description: `${ctx.canary('change_order')} client instruction passed down to the subcontract`,
          activityId: line.activityId,
          budgetLineId: line.budgetLineId,
          value: Math.max(500, Math.round(line.amount * 0.1)),
          scheduleImpact: 2,
        });
        ctx.record('change_order', prime.id);
        state.primeChangeOrderId = prime.id;
      }
      const canary = ctx.canary('commitment_change_order');
      const spawned = await qs.POST(`${P}/commitments/change-orders/from-prime`, {
        primeChangeOrderId: prime.id,
        items: [{ commitmentId: main.id, title: `${canary} from the prime change`, description: `${canary} description`, value: Math.max(200, Math.round(main.lines[0].amount * 0.04)) }],
      });
      for (const co of spawned.items || []) ctx.record('commitment_change_order', co.id);
    });

    // Pay applications: paid, approved and part paid, void, submitted.
    let first = await claim(qs, await payAppFor(qs, main), 0.25);
    if (first.claimed) {
      await qs.POST(`${P}/pay-apps/${first.id}/submit`);
      await decide(() => qs.POST(`${P}/pay-apps/${first.id}/review`, { note: `${ctx.canary('sub_pay_app')} checked against the site measure` }));
      first = await approvePayApp(first);
      await pay(first, 1);
      await qs.download(`${P}/pay-apps/${first.id}/export.pdf`);

      let second = await claim(qs, await payAppFor(qs, main), 0.2);
      if (second.claimed) {
        // Deductions sized to the claim, each with its reason, and tax on what is left.
        const deductions = ctx.canary('sub_pay_app');
        await qs.PATCH(`${P}/pay-apps/${second.id}`, {
          backCharges: round2(second.grossThisPeriod * 0.03),
          backChargesNote: `${deductions} clearing up after the gang`,
          otherDeductions: round2(second.grossThisPeriod * 0.02),
          otherDeductionsNote: `${deductions} site power`,
          taxRate: 5,
        });
        await qs.POST(`${P}/pay-apps/${second.id}/submit`);
        second = await approvePayApp(second);
        await pay(second, 0.5);

        const scrapped = await payAppFor(qs, main);
        await pm.call('DELETE', `${P}/pay-apps/${scrapped.id}`, { reason: `${ctx.canary('sub_pay_app')} raised for the wrong period` });

        const waived = await payAppFor(qs, main, { waiverRequired: true });
        const waiver = await attach(qs, 'sub_pay_app', waived.id, 'lien-waiver');
        const third = await claim(qs, waived, 0.1, { extra: { waiverDocumentId: waiver } });
        if (third.claimed) await qs.POST(`${P}/pay-apps/${third.id}/submit`);
      }
    }

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
    const bond = ctx.canary('commitment_insurance');
    let second = await raise(procurement, {
      label: 'MEP first fix subcontract',
      lines: sovLines(2, ['04-100']),
      extra: { insurance: [{ type: 'bond', label: `${bond} performance bond`, required: true, note: `${bond} awaited from the surety` }] },
    });
    await submit(procurement, second.id);
    await decide(() => pm.POST(`${P}/commitments/${second.id}/return`, { reason: `${ctx.canary('commitment')} split the first-fix line by floor` }));
    second = await procurement.PUT(`${P}/commitments/${second.id}/lines`, { lines: sovLines(ctx.count(2, 3), ['04-100', '05-100']) });
    await scopeSheet(second, { complete: false });
    await submit(procurement, second.id);
    await approve(second.id);

    const signed = await attach(procurement, 'commitment', second.id, 'signed-agreement');
    const blocked = await pm.send('POST', `${P}/commitments/${second.id}/execute`, { documentId: signed });
    if (blocked.status !== 409) ctx.note(`${second.ref}: executing with a required bond missing answered ${blocked.status} ${blocked.body?.error?.code || ''}, not 409 COMMITMENT_INSURANCE_MISSING`);
    if (blocked.status !== 200) {
      second = await pm.POST(`${P}/commitments/${second.id}/execute`, { documentId: signed, override: true, overrideReason: `${ctx.canary('commitment')} bond to follow within 14 days` });
    } else second = blocked.body.data;
    if (second.status !== 'executed') throw new Error(`${second.ref}: expected executed, got ${second.status}`);

    // A pay application rejected, then the next one left as a draft.
    const rejected = await claim(qs, await payAppFor(qs, second), 0.15);
    if (rejected.claimed) {
      await qs.POST(`${P}/pay-apps/${rejected.id}/submit`);
      await decide(() => qs.POST(`${P}/pay-apps/${rejected.id}/reject`, { code: 'INCORRECT_QUANTITIES', reason: `${ctx.canary('sub_pay_app')} quantities do not match the site measure` }));
      await claim(qs, await payAppFor(qs, second), 0.12, { materialsOn: 0 });
    }

    // Closeout started: one document in, one waived, one not applicable, the missing bond waived.
    await qs.GET(`${P}/commitments/${second.id}/closeout`);
    const asBuilts = await attach(qs, 'commitment', second.id, 'as-built-records');
    await closeoutItem(second, 'as_builts', { status: 'complete', documentId: asBuilts, note: `${ctx.canary('closeout_item')} as-builts received` });
    await closeoutItem(second, 'om_manuals', { status: 'waived', waivedReason: `${ctx.canary('closeout_item')} manuals are the supplier's, not this trade's` });
    await closeoutItem(second, 'training', { status: 'not_applicable', note: `${ctx.canary('closeout_item')} no plant handed over` });
    await closeoutItem(second, 'insurance_current', { status: 'waived', waivedReason: `${ctx.canary('closeout_item')} bond replaced by a parent company guarantee` });
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
    let first = await claim(qs, await payAppFor(qs, done), 0.6);
    let settled = false;
    if (first.claimed) {
      await qs.POST(`${P}/pay-apps/${first.id}/submit`);
      await approvePayApp(first);
      const reopened = await pm.POST(`${P}/pay-apps/${first.id}/reopen`, { reason: `${ctx.canary('sub_pay_app')} certified against the wrong measure` });
      first = await claim(qs, reopened, 0.55);
      await qs.POST(`${P}/pay-apps/${first.id}/submit`);
      first = await approvePayApp(first);
      await pay(first, 1);

      // The final certificate: everything that is left.
      let last = await claim(qs, await payAppFor(qs, done), 1);
      if (last.claimed) {
        await qs.POST(`${P}/pay-apps/${last.id}/submit`);
        await decide(() => qs.POST(`${P}/pay-apps/${last.id}/review`, { note: `${ctx.canary('sub_pay_app')} final account agreed` }));
        last = await approvePayApp(last);
        await pay(last, 1);
        settled = true;
      }
    }

    // Closeout: the handover documents in, the held retention waived, then complete.
    await qs.GET(`${P}/commitments/${done.id}/closeout`);
    for (const key of ['as_builts', 'om_manuals', 'warranties', 'lien_waiver']) {
      const documentId = await attach(qs, 'commitment', done.id, key.replace(/_/g, '-'));
      await closeoutItem(done, key, { status: 'complete', documentId, note: `${ctx.canary('closeout_item')} ${key} received` });
    }
    await closeoutItem(done, 'training', { status: 'complete', note: `${ctx.canary('closeout_item')} toolbox handover given` });
    await closeoutItem(done, 'spares', { status: 'not_applicable' });
    await closeoutItem(done, 'retention_released', { status: 'waived', waivedReason: `${ctx.canary('closeout_item')} retention released on the final account` });
    const sheet = await qs.GET(`${P}/commitments/${done.id}/closeout`);
    const override = sheet.ready ? {} : { overrideReason: `${ctx.canary('subcontract_closeout')} completed with ${sheet.outstanding.join(', ')} outstanding` };
    await asEither([qs, pm], (who) => who.POST(`${P}/commitments/${done.id}/closeout/complete`, override));
    await recordCloseout(done);

    await evaluate(done, { verdict: true, finalise: true });

    const closing = sheet.ready && settled ? {} : { closeoutOverrideReason: `${ctx.canary('commitment')} closed on the PM's instruction` };
    await asEither([finance, pm], (who) => who.POST(`${P}/commitments/${done.id}/close`, closing));
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
      const bare = await who.POST(`${P}/commitments`, { type: 'subcontract', title: `${ctx.canary('commitment')} package not yet let (${tag})` });
      ctx.record('commitment', bare.id);
      remember(bare);
      continue;
    }
    let other = await raise(who, { label: `${kind} package`, lines: sovLines(ctx.count(1, 3), SUB_CODES) });
    if (kind !== 'draft') other = await submit(who, other.id);
    if (kind === 'approved') {
      // Approved, but not ready to sign: its required cover lapsed ten days ago.
      const lapsed = await attach(qs, 'commitment', other.id, 'lapsed-insurance-certificate');
      const cover = ctx.canary('commitment_insurance');
      await qs.PUT(`${P}/commitments/${other.id}/insurance`, {
        insurance: [{ type: 'general_liability', label: `${cover} public liability`, required: true, documentId: lapsed, expiresAt: ctx.daysAgo(10), note: `${cover} renewal chased` }],
      });
      other = await approve(other.id);
    }
    if (kind === 'returned') other = await decide(() => pm.POST(`${P}/commitments/${other.id}/return`, { reason: `${ctx.canary('commitment')} rates to be rechecked against the bill` }));
    if (kind === 'void') other = await pm.call('DELETE', `${P}/commitments/${other.id}`, { reason: `${ctx.canary('commitment')} package withdrawn` });
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
      const delivery = await claim(qs, await payAppFor(qs, order, { waiverRequired: true }), 0.3);
      if (delivery.claimed) {
        await qs.POST(`${P}/pay-apps/${delivery.id}/submit`);
        await decide(() => qs.POST(`${P}/pay-apps/${delivery.id}/review`, { note: `${ctx.canary('sub_pay_app')} delivery notes being matched` }));
      }
    }
    remember(await procurement.GET(`${P}/commitments/${order.id}`));
  }

  // ════════════════════════════════════════════════════════════════════════
  // once per company: prequalification of the two vendors
  // ════════════════════════════════════════════════════════════════════════
  const company = (ctx.companyRefs.subcontract = ctx.companyRefs.subcontract || {});
  company.prequalifications = company.prequalifications || {};
  if (!company.prequalified) {
    await ctx.attempt('vendor prequalification', async () => {
      for (const [vendorId, decideIt] of [[subcontractor, true], [supplier, false]]) {
        const sheet = await pm.GET(`/company/vendors/${vendorId}/prequalification`);
        if (!company.prequalifications[vendorId]) {
          company.prequalifications[vendorId] = sheet.id;
          ctx.record('vendor_prequalification', sheet.id, { scope: 'company' });
          for (const criterion of sheet.criteria) ctx.record('prequal_criterion', criterion.id, { scope: 'company' });
        }
        if (!['draft', 'under_review'].includes(sheet.status)) continue;
        const criteria = decideIt ? sheet.criteria : sheet.criteria.slice(0, 4);
        for (const criterion of criteria) {
          const canary = ctx.canary('prequal_criterion');
          await pm.PATCH(`/company/vendors/${vendorId}/prequalification/criteria/${criterion.key}`, {
            score: rng.int(3, 5),
            note: `${canary} ${criterion.key}`,
            reference: `${canary}-REF`,
            ...(criterion.tracksExpiry ? { expiresAt: ctx.daysAhead(330) } : {}),
          });
        }
        if (!decideIt) continue;
        const canary = ctx.canary('vendor_prequalification');
        await pm.POST(`/company/vendors/${vendorId}/prequalification/decision`, {
          status: 'conditionally_approved',
          validUntil: ctx.daysAhead(365),
          conditions: `${canary} audited accounts to be supplied each year`,
          decisionNote: `${canary} decided by the PM`,
        });
      }
      company.prequalified = true;
    });
  }

  state.executed = [...(state.byState.executed || [])];
  state.closed = [...(state.byState.closed || [])];
};

module.exports = { name: 'subcontract', needs: ['foundation'], depths: ['standard'], run };
