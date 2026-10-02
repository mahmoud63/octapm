'use strict';

/**
 * Change and cost control on one project.
 *
 *   change events    raised on site and by the QS, with scope lines and ROM
 *                    amounts on activities; RFQs to vendors answered through
 *                    the public quotation link; left open / pricing / priced /
 *                    converted / closed / void
 *   change orders    converted from events and raised directly; given their
 *                    budget line, impact summaries, activity links and a
 *                    supporting document; left draft / pending / approved /
 *                    rejected / reopened
 *   direct costs     invoice, expense, payroll, other — lines on cost code +
 *                    budget line + activity; left draft / returned / pending /
 *                    approved (part paid) / paid / void
 *   budget           activity allocations of a line, transfers, line
 *                    revisions, a snapshot, project budget revisions
 *                    (draft / submitted / approved / rejected)
 *   cost             activity cost records and forecasts, burn-rate entries,
 *                    time-phased cost loading (draft / submitted / approved /
 *                    rejected)
 *   delay            weather delays and extension-of-time claims
 *                    (draft / submitted / approved / rejected)
 *
 * Approving a direct cost is the only thing here that posts actual cost. The
 * driver reads the cost reconciliation before and after and notes whether the
 * ledger moved by exactly what it approved, and whether it still balances.
 *
 * Re-runnable: every reference is numbered by the product; the one thing the
 * driver numbers itself (a supplier's invoice number) carries a run counter
 * kept in ctx.refs.changeCost.
 */

const { ApiError } = require('../lib/api');

const EVENT_TYPES = ['owner_change', 'design_change', 'site_condition', 'error_omission', 'allowance', 'value_engineering', 'other'];
const UNITS = ['m2', 'm3', 'nr', 'day', 'ls', 'ton'];
const round2 = (value) => Math.round(Number(value) * 100) / 100;
const listOf = (data, ...keys) => {
  if (Array.isArray(data)) return data;
  for (const key of [...keys, 'items', 'rows', 'data']) if (Array.isArray(data?.[key])) return data[key];
  return [];
};

/**
 * A 5xx is a product finding, written to the notes with how long the call
 * took. Two of them are also worth a second try, because the product rolled
 * the whole request back: P2028 (an interactive transaction outlived Prisma's
 * limit) and P2034 (a write conflict). Anything else 5xx fails the driver.
 */
const ROLLED_BACK = new Set(['P2028', 'P2034']);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const steady = (session, ctx) => {
  const retry = (method, call) => async (route, ...rest) => {
    for (let attempt = 1; ; attempt += 1) {
      const started = Date.now();
      try {
        return await call(route, ...rest);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status < 500) throw error;
        const where = String(route).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id');
        ctx.note(`FINDING 5xx: ${method} ${where} -> ${error.status} ${error.code} after ${Date.now() - started} ms (attempt ${attempt}): ${String(error.serverMessage).replace(/\s+/g, ' ').slice(0, 220)}`);
        if (!ROLLED_BACK.has(error.code) || attempt >= 4) throw error;
        await wait(1500 * attempt);
      }
    }
  };
  return {
    ...session,
    GET: retry('GET', session.GET),
    POST: retry('POST', session.POST),
    PATCH: retry('PATCH', session.PATCH),
    PUT: retry('PUT', session.PUT),
    DELETE: retry('DELETE', session.DELETE),
    upload: (method, route, file) => retry(method, (r) => session.upload(method, r, file))(route),
  };
};

/** A one-page PDF that says `text`. */
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

const run = async (ctx) => {
  const { P, rng } = ctx;
  const sessionOf = (persona) => steady(ctx.who(persona), ctx);
  const pm = sessionOf('pm');
  const qs = sessionOf('qs');
  const cost = sessionOf('cost');
  const finance = sessionOf('finance');
  const planner = sessionOf('planner');
  const site = sessionOf('site');
  const procurement = sessionOf('procurement');

  const state = (ctx.refs.changeCost = ctx.refs.changeCost || { runs: 0 });
  state.runs += 1;
  const tag = `R${state.runs}`;
  const made = { changeEvents: {}, changeOrders: {}, directCosts: {}, budgetRevisions: {}, eotClaims: {}, costLoadings: {} };
  const tally = (bucket, status) => {
    made[bucket][status] = (made[bucket][status] || 0) + 1;
  };

  const activities = Object.entries(ctx.refs.activities || {}).map(([code, id]) => ({ code, id }));
  if (activities.length < 2) throw new Error('change-cost needs at least two activities from foundation');
  const activity = () => rng.pick(activities);

  // The budget lines foundation made, read back with their cost code and type.
  const readLines = async () => listOf(await cost.GET(`${P}/budget/lines`)).filter((line) => line.status === 'active');
  const known = new Set(Object.values(ctx.refs.budgetLines || {}));
  let budgetLines = (await readLines()).filter((line) => known.has(line.id));
  if (budgetLines.length < 2) budgetLines = await readLines();
  if (budgetLines.length < 2) throw new Error('change-cost needs at least two budget lines from foundation');
  const line = () => rng.pick(budgetLines);

  const supplierId = ctx.companyRefs.directory?.supplier || null;
  const subcontractorId = ctx.companyRefs.directory?.subcontractor || null;
  const partyMail = (name) => `${name}@parties.c${ctx.company.code}.octapm-cert.test`;

  const ledgerBefore = await cost.GET(`${P}/cost/reconciliation`);

  // ── files ────────────────────────────────────────────────────────────────
  const attach = async (who, { recordType, recordId, filename, contentType, body, caption }) => {
    const answer = await who.upload('POST', `${P}/attachments`, {
      field: 'files',
      filename,
      contentType,
      body,
      fields: { recordType, recordId, caption },
    });
    const rows = listOf(answer, 'attachments');
    const out = [];
    for (const row of rows) {
      const documentId = row.documentId ?? row.document?.id ?? null;
      if (row.id) ctx.record('attachment', row.id);
      if (documentId) ctx.record('project_document', documentId);
      out.push({ id: row.id, documentId });
    }
    if (!out[0]?.documentId) throw new Error(`the upload to ${recordType} answered without a document id: ${JSON.stringify(answer).slice(0, 300)}`);
    return out[0];
  };

  // ── change events ────────────────────────────────────────────────────────
  const newEvent = async (who, { lineCount = rng.int(1, 3), origin = 'manual' } = {}) => {
    const lines = Array.from({ length: lineCount }, () => {
      const budgetLine = line();
      const quantity = rng.int(1, 40);
      const unitCost = rng.int(50, 900);
      return {
        description: `Additional scope item — ${ctx.canary('change_event_line')}`,
        costCodeId: budgetLine.costCodeId,
        budgetLineId: budgetLine.id,
        activityId: activity().id,
        quantity,
        unit: rng.pick(UNITS),
        unitCost,
        romAmount: quantity * unitCost,
        notes: `ROM from site measure ${ctx.canary('change_event_line')}`,
      };
    });
    const created = await who.POST(`${P}/change-events`, {
      title: `Change event ${tag} — ${ctx.canary('change_event')}`,
      description: `Potential change noticed during the works. ${ctx.canary('change_event')}`,
      type: rng.pick(EVENT_TYPES),
      origin,
      activityId: activity().id,
      ...(lineCount ? {} : { romAmount: rng.int(2, 40) * 1000 }),
      scheduleImpactDays: rng.int(0, 15),
      ownerChange: rng.chance(0.5),
      notes: `Raised by ${who.email.split('@')[0]} ${ctx.canary('change_event')}`,
      lines,
    });
    ctx.record('change_event', created.id);
    for (const row of created.lines || []) ctx.record('change_event_line', row.id);
    return created;
  };

  /** What a vendor does with the link in the RFQ e-mail: no login, the token is the credential. */
  const portal = async (method, portalUrl, suffix, payload) => {
    const token = String(portalUrl || '').split('/rfq/')[1];
    if (!token) throw new Error('the RFQ answered without a portal link');
    const route = `/public/rfqs/${token}${suffix}`;
    const res = await pm.send(method, route, payload, { token: null });
    if (res.status < 200 || res.status >= 300) throw new ApiError(method, '/public/rfqs/<token>' + suffix, res.status, res.body);
    return res.body?.data;
  };

  const sendRfqs = async (event, recipients) => {
    const answer = await procurement.POST(`${P}/change-events/${event.id}/rfqs`, {
      recipients,
      dueDate: ctx.daysAhead(rng.int(7, 21)),
      instructions: `Price each line, delivered and installed. ${ctx.canary('rfq')}`,
      lineIds: (event.lines || []).map((row) => row.id),
    });
    for (const rfq of answer.rfqs || []) ctx.record('rfq', rfq.id);
    return answer.rfqs || [];
  };

  // ── change orders ────────────────────────────────────────────────────────
  let supportingDocumentId = null;

  /** The instruction a change order is argued from: uploaded once, cited by the others. */
  const supportingDocument = async (order) => {
    if (supportingDocumentId) return supportingDocumentId;
    const canary = ctx.canary('attachment');
    const file = await attach(qs, {
      recordType: 'change_order',
      recordId: order.id,
      filename: `${canary}-instruction-${tag}.pdf`,
      contentType: 'application/pdf',
      body: pdf(`Site instruction ${tag} for ${order.ref || 'a change order'} — ${canary}`),
      caption: `Instruction ${canary}`,
    });
    supportingDocumentId = file.documentId;
    return supportingDocumentId;
  };

  /** Everything the approval gate asks for: a budget line, both summaries, an activity, a document. */
  const makeApprovable = async (order, { keepBudget = false } = {}) => {
    const value = Number(order.value) || 0;
    const days = rng.int(0, 12);
    const first = activity();
    const second = activity();
    const documentId = await supportingDocument(order);
    return qs.PATCH(`${P}/change-orders/${order.id}`, {
      ...(keepBudget ? {} : { budgetLineId: line().id }),
      scheduleImpact: days,
      scheduleImpactSummary: `${days} working days on ${first.code}; the rest is absorbed in float. ${ctx.canary('change_order')}`,
      costImpactSummary: `${value} added for the instructed work, priced at agreed rates. ${ctx.canary('change_order')}`,
      activityLinks: [
        { activityId: first.id, relationType: 'impacted', scheduleImpactDays: days, costImpact: value, impactBasis: 'Time impact analysis', notes: `Directly affected ${ctx.canary('change_order')}` },
        ...(second.id === first.id ? [] : [{ activityId: second.id, relationType: 'related', scheduleImpactDays: 0, costImpact: 0, notes: `Follows on ${ctx.canary('change_order')}` }]),
      ],
      documentIds: [documentId],
    });
  };

  const newOrder = async (extra = {}) => {
    const value = rng.int(4, 60) * 1000;
    const created = await qs.POST(`${P}/change-orders`, {
      description: `Variation ${tag} — ${ctx.canary('change_order')}`,
      category: rng.pick(['labour', 'material', 'subcontract', 'equipment', 'indirect']),
      value,
      activityId: activity().id,
      scheduleImpact: rng.int(0, 10),
      raisedBy: `QS ${ctx.canary('change_order')}`,
      ...extra,
    });
    ctx.record('change_order', created.id);
    return created;
  };

  const convert = async (event, body = {}) => {
    const answer = await qs.POST(`${P}/change-events/${event.id}/convert`, {
      description: `From ${event.ref}: ${ctx.canary('change_order')}`,
      ...body,
    });
    ctx.record('change_order', answer.changeOrder.id);
    tally('changeEvents', 'converted');
    return answer.changeOrder;
  };

  const submit = (order) => qs.POST(`${P}/change-orders/${order.id}/submit`, { comment: `For approval ${ctx.canary('change_order')}` });
  const approve = (order) => pm.POST(`${P}/change-orders/${order.id}/approve`, { comment: `Approved under the instruction ${ctx.canary('change_order')}` });
  const reject = (order) => pm.POST(`${P}/change-orders/${order.id}/reject`, { reason: `Not substantiated: rates are not the contract rates. ${ctx.canary('change_order')}` });

  // 1. raised on site, tidied by the QS, converted, approved
  const first = await newEvent(site);
  await qs.PATCH(`${P}/change-events/${first.id}`, {
    description: `Confirmed with the engineer on site; measured by the QS. ${ctx.canary('change_event')}`,
    scheduleImpactDays: rng.int(1, 10),
    notes: `QS review ${ctx.canary('change_event')}`,
  });
  const approvedOrder = await convert(first);
  await makeApprovable(approvedOrder);
  await submit(approvedOrder);
  await approve(approvedOrder);
  tally('changeOrders', 'approved');
  let approvedChangeValue = Number(approvedOrder.value) || 0;

  // 2. raised by the QS, converted at an agreed value, rejected
  const second = await newEvent(qs);
  const rejectedOrder = await convert(second, { value: rng.int(3, 30) * 1000 });
  await makeApprovable(rejectedOrder);
  await submit(rejectedOrder);
  await reject(rejectedOrder);
  tally('changeOrders', 'rejected');

  // 3. priced by vendors through the public link, one quote accepted, converted, left waiting for approval
  const third = await newEvent(qs, { lineCount: 2 });
  const quoted = await ctx.attempt('change event RFQ, quote and acceptance', async () => {
    const [toSupplier, toOther] = await sendRfqs(third, [
      { ...(supplierId ? { vendorCompanyId: supplierId } : {}), companyName: `${ctx.company.canary} Steel & Cement Supply`, contactName: 'Rana Haddad', contactEmail: partyMail(`rfq.supplier.${tag.toLowerCase()}`) },
      { companyName: `Northern Works ${ctx.canary('rfq')}`, contactName: 'Ingrid Solberg', contactEmail: partyMail(`rfq.northern.${tag.toLowerCase()}`) },
    ]);
    await portal('GET', toSupplier.portalUrl, '');
    await portal('PUT', toSupplier.portalUrl, '/quote', {
      lines: (third.lines || []).map((row) => ({ lineId: row.id, amount: round2(row.romAmount * 1.08), note: `Firm for 30 days ${ctx.canary('rfq')}` })),
      notes: `Quotation ${ctx.canary('rfq')}`,
      validUntil: ctx.daysAhead(30),
      leadTimeDays: rng.int(5, 30),
      quotedBy: `Rana Haddad ${ctx.canary('rfq')}`,
    });
    await portal('POST', toOther.portalUrl, '/decline', { reason: `No capacity this quarter ${ctx.canary('rfq')}` });
    await qs.POST(`${P}/change-events/rfqs/${toSupplier.id}/accept`, { createCommitmentChangeOrder: false });
    return true;
  });
  const pendingOrder = await convert(third);
  await makeApprovable(pendingOrder);
  await submit(pendingOrder);
  tally('changeOrders', 'pending');

  // 4. out for pricing: one request reminded, one cancelled, one quote received and turned down
  const fourth = await newEvent(qs, { lineCount: 2 });
  const pricing = await ctx.attempt('change event RFQ reminder, cancel and rejection', async () => {
    const [open, cancelled, refused] = await sendRfqs(fourth, [
      { ...(subcontractorId ? { vendorCompanyId: subcontractorId } : {}), companyName: `${ctx.company.canary} Concrete Works`, contactName: 'Omar Said', contactEmail: partyMail(`rfq.sub.${tag.toLowerCase()}`) },
      { companyName: `Harbour Plant Hire ${ctx.canary('rfq')}`, contactEmail: partyMail(`rfq.harbour.${tag.toLowerCase()}`) },
      { companyName: `Delta Formwork ${ctx.canary('rfq')}`, contactEmail: partyMail(`rfq.delta.${tag.toLowerCase()}`) },
    ]);
    await procurement.POST(`${P}/change-events/rfqs/${open.id}/remind`);
    await procurement.POST(`${P}/change-events/rfqs/${cancelled.id}/cancel`);
    await portal('PUT', refused.portalUrl, '/quote', { lines: (fourth.lines || []).map((row) => ({ lineId: row.id, amount: round2(row.romAmount * 1.6) })), notes: `Budget price only ${ctx.canary('rfq')}` });
    await qs.POST(`${P}/change-events/rfqs/${refused.id}/reject`, { reason: `Well above the estimate ${ctx.canary('rfq')}` });
    return true;
  });
  tally('changeEvents', pricing ? 'pricing' : 'open');

  // 4b. priced: a quote accepted, the change order not raised yet
  const pricedEvent = await newEvent(qs, { lineCount: 1 });
  const priced = await ctx.attempt('change event left priced', async () => {
    const [only] = await sendRfqs(pricedEvent, [
      { ...(supplierId ? { vendorCompanyId: supplierId } : {}), companyName: `${ctx.company.canary} Steel & Cement Supply`, contactName: 'Rana Haddad', contactEmail: partyMail(`rfq.priced.${tag.toLowerCase()}`) },
    ]);
    await portal('PUT', only.portalUrl, '/quote', {
      lines: (pricedEvent.lines || []).map((row) => ({ lineId: row.id, amount: round2(row.romAmount * 0.95), note: ctx.canary('rfq') })),
      notes: `Quotation ${ctx.canary('rfq')}`,
      leadTimeDays: rng.int(3, 20),
    });
    return qs.POST(`${P}/change-events/rfqs/${only.id}/accept`, { createCommitmentChangeOrder: false });
  });
  tally('changeEvents', priced?.changeEvent?.status || 'open');

  // 5. closed without a change, 6. void
  const fifth = await newEvent(site, { lineCount: 0 });
  await qs.POST(`${P}/change-events/${fifth.id}/close`, { reason: `Covered by the contract scope ${ctx.canary('change_event')}` });
  tally('changeEvents', 'closed');
  const sixth = await newEvent(qs, { lineCount: 1 });
  await pm.POST(`${P}/change-events/${sixth.id}/void`, { reason: `Raised twice ${ctx.canary('change_event')}` });
  tally('changeEvents', 'void');

  // 7. still open, one with a photo-less note attached
  const openEvents = ctx.count(1, 4);
  for (let i = 0; i < openEvents; i += 1) {
    const event = await newEvent(i % 2 ? qs : site, { origin: rng.pick(['manual', 'meeting', 'other']) });
    tally('changeEvents', 'open');
    if (i === 0) {
      await ctx.attempt('change event attachment', async () => {
        const canary = ctx.canary('attachment');
        await attach(site, {
          recordType: 'change_event',
          recordId: event.id,
          filename: `${canary}-site-note-${tag}.txt`,
          contentType: 'text/plain',
          body: Buffer.from(`Site note for ${event.ref}\n${canary}\n`, 'utf8'),
          caption: `Site note ${canary}`,
        });
      });
    }
  }

  // 8. raised directly, split over two budget lines, left a draft
  const [lineA, lineB] = rng.shuffle(budgetLines);
  const splitValue = rng.int(6, 40) * 1000;
  const splitA = round2(splitValue * 0.6);
  await newOrder({
    value: splitValue,
    budgetAllocations: [{ budgetLineId: lineA.id, amount: splitA }, { budgetLineId: lineB.id, amount: round2(splitValue - splitA) }],
    scheduleImpactSummary: `No programme effect expected. ${ctx.canary('change_order')}`,
    costImpactSummary: `Split 60/40 over two budget lines. ${ctx.canary('change_order')}`,
    affectedActivityIds: [activity().id],
  });
  tally('changeOrders', 'draft');

  // 9. a draft the cost controller puts on a budget line from the budget screen
  const lineless = await newOrder();
  await ctx.attempt('budget line of a change order', () => cost.PUT(`${P}/budget/change-orders/${lineless.id}/line`, { lineId: line().id }));
  tally('changeOrders', 'draft');

  // 10. submitted, rejected, reopened: a draft again with its history
  const reopened = await newOrder();
  await makeApprovable(reopened);
  await submit(reopened);
  await reject(reopened);
  const back = await ctx.attempt('change order reopen', () => qs.POST(`${P}/change-orders/${reopened.id}/reopen`, { comment: `Re-priced at contract rates ${ctx.canary('change_order')}` }));
  tally('changeOrders', back ? `reopened:${back.status}` : 'rejected');

  // 10b. raised by mistake and archived by the PM (DELETE archives, it does not remove)
  const archived = await newOrder({ value: rng.int(1, 5) * 1000 });
  const archivedAnswer = await ctx.attempt('change order archive', () => pm.DELETE(`${P}/change-orders/${archived.id}`));
  tally('changeOrders', archivedAnswer ? 'archived' : 'draft');

  // 11. a few more, raised directly and approved
  const moreApproved = ctx.count(0, 2);
  for (let i = 0; i < moreApproved; i += 1) {
    const order = await newOrder();
    await makeApprovable(order);
    await submit(order);
    await approve(order);
    approvedChangeValue += Number(order.value) || 0;
    tally('changeOrders', 'approved');
  }

  // ── direct costs ─────────────────────────────────────────────────────────
  let invoiceSeq = 0;
  const newDirectCost = async ({ type, label, vendor = false, lineCount = rng.int(1, 3), tax = false }) => {
    const lines = Array.from({ length: lineCount }, () => {
      const budgetLine = line();
      const quantity = rng.int(1, 12);
      const unitCost = rng.int(40, 750);
      return {
        description: `${label} item — ${ctx.canary('direct_cost_line')}`,
        costCodeId: budgetLine.costCodeId,
        budgetLineId: budgetLine.id,
        activityId: activity().id,
        costType: budgetLine.costType,
        quantity,
        unit: rng.pick(UNITS),
        unitCost,
        amount: quantity * unitCost,
        notes: ctx.canary('direct_cost_line'),
      };
    });
    const subtotal = lines.reduce((sum, row) => sum + row.amount, 0);
    invoiceSeq += 1;
    const created = await cost.POST(`${P}/direct-costs`, {
      type,
      description: `${label} ${tag} — ${ctx.canary('direct_cost')}`,
      costDate: ctx.daysAgo(rng.int(1, 45)),
      receivedDate: ctx.daysAgo(1),
      dueDate: ctx.daysAhead(rng.int(5, 45)),
      paymentTerms: 'Net 30',
      notes: `Booked by cost control ${ctx.canary('direct_cost')}`,
      ...(vendor && supplierId
        ? { vendorCompanyId: supplierId, invoiceNumber: `INV-${ctx.project.key}-${tag}-${String(invoiceSeq).padStart(2, '0')}` }
        : { vendorName: `Sundry payee ${ctx.canary('direct_cost')}` }),
      ...(tax ? { tax: round2(subtotal * 0.05) } : {}),
      lines,
    });
    ctx.record('direct_cost', created.id);
    for (const row of created.lines || []) ctx.record('direct_cost_line', row.id);
    return { ...created, subtotalSent: subtotal };
  };
  const submitCost = (row) => cost.POST(`${P}/direct-costs/${row.id}/submit`);
  const approveCost = (row) => finance.POST(`${P}/direct-costs/${row.id}/approve`);
  const pay = async (row, amount, reference) => {
    const answer = await finance.POST(`${P}/direct-costs/${row.id}/payments`, {
      amount,
      paidAt: `${ctx.today}T09:00:00.000Z`,
      method: rng.pick(['bank_transfer', 'cheque', 'card']),
      reference,
      note: `Paid ${ctx.canary('direct_cost_payment')}`,
    });
    const payment = (answer.payments || []).find((p) => p.reference === reference) || (answer.payments || [])[0];
    if (payment?.id) ctx.record('direct_cost_payment', payment.id);
    return answer;
  };

  let postedByThisRun = 0;

  // an invoice, approved and paid in full
  const paid = await newDirectCost({ type: 'invoice', label: 'Supplier invoice', vendor: true, tax: true });
  await submitCost(paid);
  const paidApproved = await approveCost(paid);
  postedByThisRun += paid.subtotalSent;
  const paidAnswer = await pay(paid, Number(paidApproved.total), `PAY-${tag}-${ctx.canary('direct_cost_payment')}`);
  tally('directCosts', paidAnswer.status);

  // an expense, approved and part paid
  const partPaid = await newDirectCost({ type: 'expense', label: 'Site expense' });
  await submitCost(partPaid);
  const partApproved = await approveCost(partPaid);
  postedByThisRun += partPaid.subtotalSent;
  const partAnswer = await pay(partPaid, round2(Number(partApproved.total) * 0.4), `PAY-${tag}-${ctx.canary('direct_cost_payment')}`);
  tally('directCosts', `${partAnswer.status}+part_paid`);

  // payroll, waiting for approval
  const pendingCost = await newDirectCost({ type: 'payroll', label: 'Weekly payroll' });
  await submitCost(pendingCost);
  tally('directCosts', 'pending');

  // other, a draft that was edited
  const draftCost = await newDirectCost({ type: 'other', label: 'Permit fee', lineCount: 1 });
  await cost.PATCH(`${P}/direct-costs/${draftCost.id}`, { notes: `Receipt to follow ${ctx.canary('direct_cost')}`, paymentTerms: 'On receipt' });
  tally('directCosts', 'draft');

  // an invoice returned by finance
  const returned = await newDirectCost({ type: 'invoice', label: 'Plant hire invoice', vendor: true });
  await submitCost(returned);
  const returnedAnswer = await finance.POST(`${P}/direct-costs/${returned.id}/reject`, { reason: `Hire dates do not match the delivery ticket ${ctx.canary('direct_cost')}` });
  tally('directCosts', `returned:${returnedAnswer.status}`);

  // an invoice approved in error and voided: posted, then reversed
  const voided = await newDirectCost({ type: 'invoice', label: 'Duplicate invoice', vendor: true, lineCount: 1 });
  await submitCost(voided);
  await approveCost(voided);
  const voidAnswer = await finance.POST(`${P}/direct-costs/${voided.id}/void`, { reason: `Booked twice ${ctx.canary('direct_cost')}` });
  tally('directCosts', voidAnswer.status);

  const moreCosts = ctx.count(0, 3);
  for (let i = 0; i < moreCosts; i += 1) {
    const row = await newDirectCost({ type: rng.pick(['invoice', 'expense', 'other']), label: 'Sundry cost', vendor: i % 2 === 0 });
    await submitCost(row);
    await approveCost(row);
    postedByThisRun += row.subtotalSent;
    tally('directCosts', 'approved');
  }

  // ── budget: allocations, transfers, line revisions, snapshot ─────────────
  const spread = rng.shuffle(budgetLines).slice(0, ctx.count(1, 3));
  for (const budgetLine of spread) {
    const targets = rng.shuffle(activities).slice(0, Math.min(activities.length, rng.int(2, 4)));
    const weight = Math.floor(100 / targets.length);
    const answer = await ctx.attempt(`budget line allocations ${budgetLine.costCode?.code || ''}`, () =>
      cost.PUT(`${P}/budget/lines/${budgetLine.id}/allocations`, {
        allocations: targets.map((target, index) => ({ activityId: target.id, weight: index === 0 ? 100 - weight * (targets.length - 1) : weight })),
      })
    );
    for (const allocation of answer?.allocations || []) if (allocation.id) ctx.record('budget_line_activity_allocation', allocation.id);
  }
  // The PUT replaces a line's allocations, so a second run removes rows the
  // first recorded: the inventory keeps only the ones that still exist.
  if (ctx.records.budget_line_activity_allocation) {
    const live = new Set((await readLines()).flatMap((row) => (row.allocations || []).map((allocation) => allocation.id)));
    ctx.records.budget_line_activity_allocation = [...new Set(ctx.records.budget_line_activity_allocation)].filter((id) => live.has(id));
  }

  const transfers = ctx.count(1, 3);
  for (let i = 0; i < transfers; i += 1) {
    const [from, to] = rng.shuffle(budgetLines);
    const note = `Transfer ${tag}-${i + 1} ${ctx.canary('budget_line_change')}`;
    const amount = Math.max(100, Math.round(Number(from.originalBudget || 10000) * 0.01));
    const answer = await finance.POST(`${P}/budget/transfers`, { fromLineId: from.id, toLineId: to.id, amount, note });
    for (const row of listOf(answer)) for (const change of row.changes || []) if (change.note === note) ctx.record('budget_line_change', change.id);
  }

  const lineRevisions = ctx.count(1, 3);
  for (let i = 0; i < lineRevisions; i += 1) {
    const budgetLine = line();
    const note = `Line revision ${tag}-${i + 1} ${ctx.canary('budget_line_change')}`;
    const amount = (i % 2 ? -1 : 1) * rng.int(1, 9) * 500;
    const answer = await finance.POST(`${P}/budget/lines/${budgetLine.id}/revisions`, { amount, note });
    for (const change of answer.changes || []) if (change.note === note) ctx.record('budget_line_change', change.id);
  }

  await ctx.attempt('budget snapshot', async () => {
    const snapshot = await finance.POST(`${P}/budget/snapshots`, { label: `Budget ${tag} ${ctx.canary('budget_snapshot')}` });
    ctx.record('budget_snapshot', snapshot.id);
    await cost.GET(`${P}/budget/snapshots/${snapshot.id}`);
  });

  // ── project budget revisions: draft, submitted, approved, rejected ───────
  const newRevision = async (who, status, changeType = 'addition') => {
    const created = await who.POST(`${P}/budget-revisions`, {
      title: `Budget revision ${tag} — ${ctx.canary('budget_revision')}`,
      changeType,
      amount: rng.int(2, 40) * 1000,
      effectiveDate: ctx.daysAgo(rng.int(0, 20)),
      ...(status ? { status } : {}),
      notes: `Raised from the monthly cost review ${ctx.canary('budget_revision')}`,
      linkedChangeOrder: approvedOrder.ref || null,
    });
    ctx.record('budget_revision', created.id);
    return created;
  };
  await newRevision(cost, 'draft');
  tally('budgetRevisions', 'draft');
  await newRevision(cost, 'submitted', 'deduction');
  tally('budgetRevisions', 'submitted');
  const toApprove = await newRevision(cost, 'submitted');
  const approvedRevision = await pm.PATCH(`${P}/budget-revisions/${toApprove.id}`, { status: 'approved' });
  tally('budgetRevisions', approvedRevision.status);
  const toReject = await newRevision(cost, 'submitted', 'deduction');
  const rejectedRevision = await pm.PATCH(`${P}/budget-revisions/${toReject.id}`, { status: 'rejected', notes: `Not agreed with the client ${ctx.canary('budget_revision')}` });
  tally('budgetRevisions', rejectedRevision.status);
  const extraRevisions = ctx.count(0, 2);
  for (let i = 0; i < extraRevisions; i += 1) {
    const row = await newRevision(pm, null);
    tally('budgetRevisions', row.status);
  }
  // Approving a change order writes a budget revision of its own: those are
  // records too. Whatever the register holds that the inventory does not is
  // recorded here (an earlier run's included).
  const recorded = new Set(ctx.records.budget_revision || []);
  for (const row of listOf(await cost.GET(`${P}/budget-revisions`))) {
    if (recorded.has(row.id)) continue;
    ctx.record('budget_revision', row.id);
    tally('budgetRevisions', `${row.status} (${row.linkedChangeOrder ? 'written by a change-order approval' : 'found in the register'})`);
  }

  // ── activity cost records, forecasts, burn rate ──────────────────────────
  const costed = rng.shuffle(activities).slice(0, Math.min(activities.length, ctx.count(3, 8)));
  const costRecords = [];
  for (const [index, target] of costed.entries()) {
    const base = rng.int(8, 120) * 1000;
    const record = await cost.POST(`${P}/cost/activity/${target.id}`, {
      labour: round2(base * 0.35),
      material: round2(base * 0.3),
      equipment: round2(base * 0.15),
      subcontract: round2(base * 0.1),
      indirect: round2(base * 0.05),
      overhead: round2(base * 0.03),
      contingency: round2(base * 0.02),
      // Two in three carry an entered forecast; the rest keep the product's default.
      ...(index % 3 === 2 ? {} : { forecast: round2(base * (0.9 + rng.next() * 0.3)) }),
    });
    ctx.record('cost_record', record.id);
    costRecords.push(record);
  }
  // One cost record per activity: a second run edits the same rows.
  ctx.records.cost_record = [...new Set(ctx.records.cost_record)];
  if (costRecords[0]) {
    await cost.PATCH(`${P}/cost/${costRecords[0].id}`, { forecast: round2((Number(costRecords[0].forecast) || 10000) * 1.07), actualThroughDate: ctx.today });
  }
  const burns = ctx.count(1, 3);
  for (let i = 0; i < burns; i += 1) {
    const entry = await ctx.attempt('burn-rate entry', () =>
      cost.POST(`${P}/cost/burn-rate`, {
        date: ctx.daysAgo(7 * (i + 1)),
        amount: rng.int(5, 90) * 1000,
        category: rng.pick(['labour', 'material', 'equipment', 'subcontract']),
        note: `Weekly spend ${tag} ${ctx.canary('burn_rate_entry')}`,
      })
    );
    if (entry?.id) ctx.record('burn_rate_entry', entry.id);
  }

  // ── time-phased cost loading: draft, submitted, approved, rejected ───────
  await ctx.attempt('cost loading', async () => {
    const newLoading = async (status, daysBack) => {
      const row = await cost.POST(`${P}/reports/cost-loading`, {
        activityId: activity().id,
        plannedDate: ctx.daysAgo(daysBack),
        plannedValue: rng.int(5, 80) * 1000,
        source: 'manual',
        status,
        notes: `Planned value ${tag} ${ctx.canary('activity_cost_loading')}`,
      });
      ctx.record('activity_cost_loading', row.id);
      return row;
    };
    const draft = await newLoading('draft', 5);
    await cost.PATCH(`${P}/reports/cost-loading/${draft.id}`, { notes: `Re-phased ${ctx.canary('activity_cost_loading')}` });
    tally('costLoadings', 'draft');
    await newLoading('submitted', 12);
    tally('costLoadings', 'submitted');
    const loadingApprovals = ctx.count(1, 3);
    for (let i = 0; i < loadingApprovals; i += 1) {
      const row = await newLoading('draft', 20 + i * 15);
      await cost.POST(`${P}/reports/cost-loading/${row.id}/submit`);
      const approved = await finance.POST(`${P}/reports/cost-loading/${row.id}/approve`);
      tally('costLoadings', approved.status);
    }
    const refused = await newLoading('submitted', 3);
    const refusedAnswer = await finance.POST(`${P}/reports/cost-loading/${refused.id}/reject`, { reason: `Does not follow the baseline ${ctx.canary('activity_cost_loading')}` });
    tally('costLoadings', refusedAnswer.status);
  });

  // ── delay: weather delays and extension-of-time claims ───────────────────
  const weatherIds = [];
  const delays = ctx.count(1, 3);
  for (let i = 0; i < delays; i += 1) {
    const hit = activity();
    const start = ctx.daysAgo(30 + i * 9);
    const days = rng.int(1, 3);
    const row = await ctx.attempt('weather delay', () =>
      planner.POST(`${P}/weather-delays`, {
        description: `Heavy rain stopped external works ${tag} — ${ctx.canary('weather_delay')}`,
        date: start,
        delayDays: days,
        contractual: i % 2 === 0,
        activityLinks: [{ activityId: hit.id, delayStart: start, delayEnd: ctx.daysAgo(30 + i * 9 - days), delayDays: days }],
      })
    );
    if (row?.id) {
      ctx.record('weather_delay', row.id);
      weatherIds.push(row.id);
    }
  }
  if (weatherIds[0]) {
    await ctx.attempt('weather delay edit', () => planner.PATCH(`${P}/weather-delays/${weatherIds[0]}`, { delayDays: 2, contractual: true }));
  }

  const claimBody = (status, { withProof = true } = {}) => {
    const hit = activity();
    const delayDays = rng.int(3, 20);
    return {
      eventName: `Delay event ${tag} — ${ctx.canary('eot_claim')}`,
      eventType: rng.pick(['weather', 'client_instruction', 'late_information', 'unforeseen_conditions']),
      delayDays,
      eotDaysGranted: Math.max(1, delayDays - rng.int(0, 2)),
      ldRatePerDay: rng.int(1, 9) * 500,
      activityLinks: [{ activityId: hit.id, delayStart: ctx.daysAgo(40), delayEnd: ctx.daysAgo(40 - delayDays), delayDays, impactBasis: `As-built against baseline ${ctx.canary('eot_claim')}` }],
      ...(weatherIds.length ? { weatherDelayIds: [rng.pick(weatherIds)] } : {}),
      ...(withProof && supportingDocumentId ? { documentIds: [supportingDocumentId] } : {}),
      analysis: `The event delayed ${hit.code} beyond its float. ${ctx.canary('eot_claim')}`,
      comment: `Notice served in time ${ctx.canary('eot_claim')}`,
      status,
    };
  };
  await ctx.attempt('extension-of-time claims', async () => {
    await planner.POST(`${P}/eot/calculate`, (({ eventName, eventType, delayDays, eotDaysGranted, ldRatePerDay, activityLinks, analysis }) => ({ eventName, eventType, delayDays, eotDaysGranted, ldRatePerDay, activityLinks, analysis }))(claimBody('draft')));

    const draft = await planner.POST(`${P}/eot`, claimBody('draft', { withProof: false }));
    ctx.record('eot_claim', draft.id);
    await planner.PATCH(`${P}/eot/${draft.id}`, { analysis: `Float analysis to follow. ${ctx.canary('eot_claim')}` });
    tally('eotClaims', 'draft');

    const submitted = await planner.POST(`${P}/eot`, claimBody('submitted'));
    ctx.record('eot_claim', submitted.id);
    tally('eotClaims', submitted.status);

    const granted = await planner.POST(`${P}/eot`, claimBody('draft'));
    ctx.record('eot_claim', granted.id);
    await planner.POST(`${P}/eot/${granted.id}/submit`, { comment: `Submitted with particulars ${ctx.canary('eot_claim')}` });
    const grantedAnswer = await pm.POST(`${P}/eot/${granted.id}/approve`, { comment: `Entitlement agreed ${ctx.canary('eot_claim')}` });
    tally('eotClaims', grantedAnswer.status);

    const refused = await planner.POST(`${P}/eot`, claimBody('draft'));
    ctx.record('eot_claim', refused.id);
    await planner.POST(`${P}/eot/${refused.id}/submit`, { comment: `Submitted ${ctx.canary('eot_claim')}` });
    const refusedAnswer = await pm.POST(`${P}/eot/${refused.id}/reject`, { reason: `Concurrent contractor delay ${ctx.canary('eot_claim')}` });
    tally('eotClaims', refusedAnswer.status);
  });

  // ── the read side, and what it says after all that ───────────────────────
  const registers = await ctx.attempt('registers', async () => ({
    events: await qs.GET(`${P}/change-events`),
    event: await qs.GET(`${P}/change-events/${third.id}`),
    orders: await qs.GET(`${P}/change-orders?includeArchived=true`),
    costs: await cost.GET(`${P}/direct-costs`),
    cost: await cost.GET(`${P}/direct-costs/${paid.id}`),
    revisions: await cost.GET(`${P}/budget-revisions`),
    claims: await planner.GET(`${P}/eot`),
    weather: await planner.GET(`${P}/weather-delays`),
    costRows: await cost.GET(`${P}/cost?limit=50`),
    summary: await cost.GET(`${P}/cost/summary`),
    explain: await cost.GET(`${P}/cost/reconciliation/explain?activityId=${costed[0].id}`),
  }));

  // What a reader does with a forecast: a risk and a task raised from it. No
  // model is called; the action is the caller's own text (the explanation
  // route, which is the AI one, is left alone).
  await ctx.attempt('forecast actions', async () => {
    const risk = await pm.POST(`${P}/forecast/actions`, {
      action: { type: 'create_risk', activityId: costed[0].id, title: `Cost overrun risk ${tag} — ${ctx.canary('risk')}`, description: `Forecast shows cost pressure on ${costed[0].code}. ${ctx.canary('risk')}`, probability: 'medium', impact: 'high', mitigation: `Re-price and re-sequence ${ctx.canary('risk')}` },
    });
    if (risk?.record?.id) ctx.record('risk', risk.record.id);
    const task = await pm.POST(`${P}/forecast/actions`, {
      action: { type: 'create_task', activityId: costed[0].id, title: `Review the forecast ${tag} — ${ctx.canary('task')}`, description: `Agree the cost to complete with the QS. ${ctx.canary('task')}` },
    });
    if (task?.record?.id) ctx.record('task', task.record.id);
  });

  const ledgerAfter = await cost.GET(`${P}/cost/reconciliation`);
  const budgetCheck = await cost.GET(`${P}/budget/reconciliation`);
  const forecast = await planner.GET(`${P}/forecast`);
  const ev = await cost.GET(`${P}/reports/ev?cutoffDate=${ctx.today}`);
  const linesAfter = await cost.GET(`${P}/budget/lines`);

  const directBefore = Number(ledgerBefore?.ledger?.bySource?.direct_cost || 0);
  const directAfter = Number(ledgerAfter?.ledger?.bySource?.direct_cost || 0);
  const moved = round2(directAfter - directBefore);
  const totals = linesAfter?.summary?.totals || {};

  ctx.note(
    `made — change events ${JSON.stringify(made.changeEvents)}${quoted ? ' (one priced through the vendor link)' : ''}; change orders ${JSON.stringify(made.changeOrders)}; direct costs ${JSON.stringify(made.directCosts)}; budget revisions ${JSON.stringify(made.budgetRevisions)}; cost loadings ${JSON.stringify(made.costLoadings)}; EOT claims ${JSON.stringify(made.eotClaims)}`
  );
  ctx.note(
    `cost reconciliation: balanced=${ledgerAfter?.balanced} ledger total ${ledgerBefore?.ledger?.total} -> ${ledgerAfter?.ledger?.total} (${ledgerAfter?.ledger?.entries} entries); direct_cost ${directBefore} -> ${directAfter}, moved ${moved}, this run approved and kept ${round2(postedByThisRun)}; budget lines recorded actual ${ledgerAfter?.budget?.recordedTotal} vs derived ${ledgerAfter?.budget?.derivedTotal}; activities recorded ${ledgerAfter?.activity?.recordedTotal} vs derived ${ledgerAfter?.activity?.derivedTotal}; migration required=${ledgerAfter?.migration?.required}`
  );
  if (Math.abs(moved - round2(postedByThisRun)) > 0.005) {
    ctx.note(`FINDING? the ledger's direct cost moved by ${moved} but this run approved (and did not void) ${round2(postedByThisRun)}`);
  }
  if (ledgerAfter?.balanced !== true) ctx.note(`FINDING? cost reconciliation is not balanced after direct-cost approvals: ${JSON.stringify(ledgerAfter?.budget?.variances || []).slice(0, 200)} ${JSON.stringify(ledgerAfter?.activity?.variances || []).slice(0, 200)}`);
  ctx.note(
    `budget register: original ${totals.originalBudget} + approved changes ${totals.approvedChanges} + revisions ${totals.revisions} = revised ${totals.revisedBudget}; actual ${totals.actual}; this run approved change orders worth ${approvedChangeValue}; budget reconciliation balanced=${budgetCheck?.balanced} (lines ${budgetCheck?.totals?.budgetLines} vs activity budget ${budgetCheck?.totals?.activityBudget}, difference ${budgetCheck?.totals?.difference}, mismatches ${budgetCheck?.mismatches?.length})`
  );
  if (Math.abs(round2(Number(totals.originalBudget) + Number(totals.approvedChanges) + Number(totals.revisions)) - Number(totals.revisedBudget)) > 0.005) {
    ctx.note(`FINDING? revised budget ${totals.revisedBudget} is not original + approved changes + revisions`);
  }
  ctx.note(
    `forecast: slip ${forecast?.schedule?.slipDays}d, cost budget ${forecast?.cost?.budget} bac ${forecast?.cost?.bac} eac ${forecast?.cost?.eac} (${forecast?.cost?.eacBasis}) actual ${forecast?.cost?.actual} overrun ${forecast?.cost?.overrun}; levels schedule=${forecast?.summary?.scheduleLevel} cost=${forecast?.summary?.costLevel}; ${(forecast?.dataQualityItems || []).length} data-quality notes [${(forecast?.dataQualityItems || []).map((item) => item.kind).join(', ')}]`
  );
  ctx.note(`EV at ${ctx.today}: BAC ${ev?.totalBudget} PV ${ev?.pv} EV ${ev?.ev} AC ${ev?.ac} SPI ${ev?.spi} CPI ${ev?.cpi} EAC ${ev?.eac} (${ev?.eacBasis})`);
  if (registers) {
    ctx.note(
      `registers: ${registers.events?.summary?.count} change events ${JSON.stringify(registers.events?.summary?.byStatus)}; ${listOf(registers.orders, 'orders').length} change orders, approved total ${registers.orders?.summary?.totalApproved}; ${registers.costs?.summary?.count} direct costs total ${registers.costs?.summary?.total} paid ${registers.costs?.summary?.paid}; ${listOf(registers.revisions).length} budget revisions, current budget ${registers.revisions?.summary?.currentBudget}; ${listOf(registers.claims).length} EOT claims; weather allowance used ${registers.weather?.summary?.contractualUsed}/${registers.weather?.summary?.allowance}`
    );
  }

  state.last = { tag, approvedOrderId: approvedOrder.id, rejectedOrderId: rejectedOrder.id, pendingOrderId: pendingOrder.id, paidDirectCostId: paid.id, voidDirectCostId: voided.id, supportingDocumentId };
};

module.exports = { name: 'change-cost', needs: ['foundation'], depths: ['standard'], run };
