'use strict';

/**
 * Change and cost control on one project.
 *
 *   change events    raised on site and by the QS, with scope lines and ROM
 *                    amounts on activities; RFQs to vendors answered through
 *                    the public quotation link (quoted, declined, reminded,
 *                    cancelled, accepted, rejected); left open / pricing /
 *                    priced / converted / closed / void
 *   change orders    converted from events and raised directly; given their
 *                    budget line, impact summaries, activity links and a
 *                    supporting document; left draft / pending / approved /
 *                    rejected / reopened / archived
 *   direct costs     invoice, expense, payroll, other — lines on cost code +
 *                    budget line + activity; left draft / returned / pending /
 *                    approved (part paid) / paid / void
 *   budget           activity allocations of a line, transfers, line
 *                    revisions, a snapshot
 *   budget revisions draft / submitted / approved (by the PM's PATCH) /
 *                    rejected; 0-2 more the PM creates WITHOUT a status, which
 *                    the product makes approved at once for a cost approver
 *                    (an immediate addition to the project budget); and the
 *                    approved revision each change-order approval writes
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
 * Failure policy. Every record of the area is made outside ctx.attempt: a
 * refusal, a 5xx or an answer that lacks what was made fails the run. The one
 * attempt left is the read-only closing block, so that a refused read after
 * everything is posted does not make the loader run the whole driver (and post
 * a second set) again; a 5xx there is still a "FINDING 5xx" note. Every 5xx
 * anywhere is written as a "FINDING 5xx" note. Only a read, or a status
 * transition (…/submit, …/approve), whose 5xx is a Prisma roll-back (P2028,
 * P2034) is tried again: the status check makes a second try of a transition
 * harmless. A create or a payment is never retried. Money that does not add
 * up is a "FINDING" note: the run goes on, as product defects do not stop it.
 *
 * Re-running (--redo=change-cost) is additive: each run makes a further full
 * set, posts more actual cost and approved change value, and carries its run
 * tag (R1, R2, …) in every canary. The random source is the same on every run,
 * so a second run repeats the first one's choices on new records. Do not redo
 * it on a project where progress or client-billing have built on its figures.
 * The one number the driver chooses itself (a supplier's invoice number)
 * carries a time-based nonce, so a lost run counter cannot make it clash.
 */

const { ApiError } = require('../lib/api');

const EVENT_TYPES = ['owner_change', 'design_change', 'site_condition', 'error_omission', 'allowance', 'value_engineering', 'other'];
const UNITS = ['m2', 'm3', 'nr', 'day', 'ls', 'ton'];
const round2 = (value) => Math.round(Number(value) * 100) / 100;
const near = (a, b) => Math.abs(round2(a) - round2(b)) <= 0.005;
const listOf = (data, ...keys) => {
  if (Array.isArray(data)) return data;
  for (const key of [...keys, 'items', 'rows', 'data']) if (Array.isArray(data?.[key])) return data[key];
  return [];
};
const idless = (route) => String(route).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id');

/**
 * A 5xx is a product finding, written to the notes with how long the call
 * took, and then fails the step (and so the run). A read, or a status
 * transition, whose 5xx is a Prisma roll-back — P2028 (an interactive
 * transaction outlived its limit) or P2034 (a write conflict) — is tried
 * again: the whole request was rolled back, and a second approval of an
 * approved record is refused (409), never posted twice. A create or a payment
 * is never retried blindly (convert, for one, is not a single transaction).
 */
const ROLLED_BACK = new Set(['P2028', 'P2034']);
const TRANSITION = /\/(submit|approve)$/;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const steady = (session, ctx) => {
  const retry = (method, call) => async (route, ...rest) => {
    for (let attempt = 1; ; attempt += 1) {
      const started = Date.now();
      try {
        return await call(route, ...rest);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status < 500) throw error;
        ctx.note(`FINDING 5xx: ${method} ${idless(route)} -> ${error.status} ${error.code} after ${Date.now() - started} ms (attempt ${attempt}): ${String(error.serverMessage).replace(/\s+/g, ' ').slice(0, 220)}`);
        const path = String(route).split('?')[0];
        const again = ROLLED_BACK.has(error.code) && (method === 'GET' || (method === 'POST' && TRANSITION.test(path)));
        if (!again || attempt >= 4) throw error;
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
  if (state.last) {
    ctx.note(`re-run: run ${state.runs} (${tag}) adds a further full set on top of ${state.last.tag}'s — more actual cost, approved change value, approved budget revisions, weather days and granted EOT days`);
  }
  /** Every text this driver writes carries the record's canary and the run tag. */
  const canary = (type) => `${ctx.canary(type)}-${tag}`;
  const nonce = Date.now().toString(36).toUpperCase().slice(-5);
  const fail = (message) => {
    throw new Error(`change-cost: ${message}`);
  };
  const made = { changeEvents: {}, changeOrders: {}, directCosts: {}, budgetRevisions: {}, eotClaims: {}, costLoadings: {} };
  const tally = (bucket, status) => {
    made[bucket][status] = (made[bucket][status] || 0) + 1;
  };

  const activities = Object.entries(ctx.refs.activities || {}).map(([code, id]) => ({ code, id }));
  if (activities.length < 2) fail('needs at least two activities from foundation');
  const activity = () => rng.pick(activities);

  // The budget lines foundation made, read back with their cost code, type and allocations.
  const readLines = async () => listOf(await cost.GET(`${P}/budget/lines`)).filter((line) => line.status === 'active');
  const known = new Set(Object.values(ctx.refs.budgetLines || {}));
  let budgetLines = (await readLines()).filter((line) => known.has(line.id));
  if (budgetLines.length < 2) budgetLines = await readLines();
  if (budgetLines.length < 2) fail('needs at least two budget lines from foundation');
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
    if (!out[0]?.id || !out[0]?.documentId) fail(`the upload to ${recordType} answered without an attachment and document id: ${JSON.stringify(answer).slice(0, 300)}`);
    return out[0];
  };

  // ── change events ────────────────────────────────────────────────────────
  const newEvent = async (who, { lineCount = rng.int(1, 3), origin = 'manual' } = {}) => {
    const lines = Array.from({ length: lineCount }, () => {
      const budgetLine = line();
      const quantity = rng.int(1, 40);
      const unitCost = rng.int(50, 900);
      return {
        description: `Additional scope item — ${canary('change_event_line')}`,
        costCodeId: budgetLine.costCodeId,
        budgetLineId: budgetLine.id,
        activityId: activity().id,
        quantity,
        unit: rng.pick(UNITS),
        unitCost,
        romAmount: quantity * unitCost,
        notes: `ROM from site measure ${canary('change_event_line')}`,
      };
    });
    const created = await who.POST(`${P}/change-events`, {
      title: `Change event ${tag} — ${canary('change_event')}`,
      description: `Potential change noticed during the works. ${canary('change_event')}`,
      type: rng.pick(EVENT_TYPES),
      origin,
      activityId: activity().id,
      ...(lineCount ? {} : { romAmount: rng.int(2, 40) * 1000 }),
      scheduleImpactDays: rng.int(0, 15),
      ownerChange: rng.chance(0.5),
      notes: `Raised by ${who.email.split('@')[0]} ${canary('change_event')}`,
      lines,
    });
    ctx.record('change_event', created.id);
    const rows = created.lines || [];
    if (rows.length !== lines.length) fail(`${created.ref} came back with ${rows.length} of the ${lines.length} lines sent`);
    for (const row of rows) ctx.record('change_event_line', row.id);
    return created;
  };

  /**
   * What a vendor does with the link in the RFQ e-mail: no login, the token is
   * the credential. Sent with no actor and no company, so the corpus entry is
   * not taken for one of the company's people by the isolation replays.
   */
  const portal = async (method, portalUrl, suffix, payload) => {
    const token = String(portalUrl || '').split('/rfq/')[1];
    if (!token) fail('an RFQ answered without a portal link');
    const started = Date.now();
    const res = await pm.send(method, `/public/rfqs/${token}${suffix}`, payload, { token: null, actor: null, org: null });
    if (res.status >= 500) {
      ctx.note(`FINDING 5xx: ${method} /public/rfqs/<token>${suffix} -> ${res.status} ${res.body?.error?.code} after ${Date.now() - started} ms: ${String(res.body?.error?.message).replace(/\s+/g, ' ').slice(0, 220)}`);
    }
    if (res.status < 200 || res.status >= 300) throw new ApiError(method, `/public/rfqs/<token>${suffix}`, res.status, res.body);
    return res.body?.data;
  };

  const sendRfqs = async (event, recipients) => {
    const answer = await procurement.POST(`${P}/change-events/${event.id}/rfqs`, {
      recipients,
      dueDate: ctx.daysAhead(rng.int(7, 21)),
      instructions: `Price each line, delivered and installed. ${canary('rfq')}`,
      lineIds: (event.lines || []).map((row) => row.id),
    });
    const rfqs = answer.rfqs || [];
    if (rfqs.length !== recipients.length || rfqs.some((rfq) => !rfq.id || !rfq.portalUrl)) {
      fail(`${event.ref}: ${recipients.length} RFQs sent, the answer carried ${rfqs.length} (${rfqs.filter((rfq) => rfq.portalUrl).length} with a portal link)`);
    }
    for (const rfq of rfqs) ctx.record('rfq', rfq.id);
    return { rfqs, status: answer.changeEvent?.status };
  };

  // ── change orders ────────────────────────────────────────────────────────
  let supportingDocumentId = null;

  /** The instruction a change order is argued from: uploaded once, cited by the others. */
  const supportingDocument = async (order) => {
    if (supportingDocumentId) return supportingDocumentId;
    const text = canary('attachment');
    const file = await attach(qs, {
      recordType: 'change_order',
      recordId: order.id,
      filename: `${text}-instruction.pdf`,
      contentType: 'application/pdf',
      body: pdf(`Site instruction ${tag} for ${order.ref || 'a change order'} — ${text}`),
      caption: `Instruction ${text}`,
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
      scheduleImpactSummary: `${days} working days on ${first.code}; the rest is absorbed in float. ${canary('change_order')}`,
      costImpactSummary: `${value} added for the instructed work, priced at agreed rates. ${canary('change_order')}`,
      activityLinks: [
        { activityId: first.id, relationType: 'impacted', scheduleImpactDays: days, costImpact: value, impactBasis: `Time impact analysis ${canary('change_order')}`, notes: `Directly affected ${canary('change_order')}` },
        ...(second.id === first.id ? [] : [{ activityId: second.id, relationType: 'related', scheduleImpactDays: 0, costImpact: 0, notes: `Follows on ${canary('change_order')}` }]),
      ],
      documentIds: [documentId],
    });
  };

  const newOrder = async (extra = {}) => {
    const value = rng.int(4, 60) * 1000;
    const created = await qs.POST(`${P}/change-orders`, {
      description: `Variation ${tag} — ${canary('change_order')}`,
      category: rng.pick(['labour', 'material', 'subcontract', 'equipment', 'indirect']),
      value,
      activityId: activity().id,
      scheduleImpact: rng.int(0, 10),
      raisedBy: `QS ${canary('change_order')}`,
      ...extra,
    });
    ctx.record('change_order', created.id);
    return created;
  };

  const convert = async (event, body = {}) => {
    const answer = await qs.POST(`${P}/change-events/${event.id}/convert`, {
      description: `From ${event.ref}: ${canary('change_order')}`,
      ...body,
    });
    if (!answer?.changeOrder?.id) fail(`converting ${event.ref} answered without a change order`);
    ctx.record('change_order', answer.changeOrder.id);
    tally('changeEvents', answer.changeEvent?.status || 'converted');
    return answer.changeOrder;
  };

  const submit = (order) => qs.POST(`${P}/change-orders/${order.id}/submit`, { comment: `For approval ${canary('change_order')}` });
  const approve = (order) => pm.POST(`${P}/change-orders/${order.id}/approve`, { comment: `Approved under the instruction ${canary('change_order')}` });
  const reject = (order) => pm.POST(`${P}/change-orders/${order.id}/reject`, { reason: `Not substantiated: rates are not the contract rates. ${canary('change_order')}` });
  const approvedOrderIds = [];
  let approvedChangeValue = 0;
  const approveAndCount = async (order) => {
    const answer = await approve(order);
    if (answer?.status !== 'approved') fail(`approving ${order.ref} answered status ${answer?.status}`);
    approvedOrderIds.push(order.id);
    approvedChangeValue = round2(approvedChangeValue + (Number(answer.value ?? order.value) || 0));
    tally('changeOrders', 'approved');
    return answer;
  };

  // 1. raised on site, tidied by the QS, converted, approved
  const first = await newEvent(site);
  await qs.PATCH(`${P}/change-events/${first.id}`, {
    description: `Confirmed with the engineer on site; measured by the QS. ${canary('change_event')}`,
    scheduleImpactDays: rng.int(1, 10),
    notes: `QS review ${canary('change_event')}`,
  });
  const approvedOrder = await convert(first);
  await makeApprovable(approvedOrder);
  await submit(approvedOrder);
  await approveAndCount(approvedOrder);

  // 2. raised by the QS, converted at an agreed value, rejected
  const second = await newEvent(qs);
  const rejectedOrder = await convert(second, { value: rng.int(3, 30) * 1000 });
  await makeApprovable(rejectedOrder);
  await submit(rejectedOrder);
  tally('changeOrders', (await reject(rejectedOrder)).status);

  // 3. priced by vendors through the public link, one quote accepted, one declined; converted and left waiting for approval
  const third = await newEvent(qs, { lineCount: 2 });
  {
    const { rfqs: [toSupplier, toOther] } = await sendRfqs(third, [
      { ...(supplierId ? { vendorCompanyId: supplierId } : {}), companyName: `${ctx.company.canary} Steel & Cement Supply`, contactName: `Rana Haddad ${canary('rfq')}`, contactEmail: partyMail(`rfq.supplier.${tag.toLowerCase()}`) },
      { companyName: `Northern Works ${canary('rfq')}`, contactName: `Ingrid Solberg ${canary('rfq')}`, contactEmail: partyMail(`rfq.northern.${tag.toLowerCase()}`) },
    ]);
    await portal('GET', toSupplier.portalUrl, '');
    await portal('PUT', toSupplier.portalUrl, '/quote', {
      lines: (third.lines || []).map((row) => ({ lineId: row.id, amount: round2(row.romAmount * 1.08), note: `Firm for 30 days ${canary('rfq')}` })),
      notes: `Quotation ${canary('rfq')}`,
      validUntil: ctx.daysAhead(30),
      leadTimeDays: rng.int(5, 30),
      quotedBy: `Rana Haddad ${canary('rfq')}`,
    });
    await portal('POST', toOther.portalUrl, '/decline', { reason: `No capacity this quarter ${canary('rfq')}` });
    const accepted = await qs.POST(`${P}/change-events/rfqs/${toSupplier.id}/accept`, { createCommitmentChangeOrder: false });
    if (accepted?.changeEvent?.status !== 'priced') fail(`accepting the quote on ${third.ref} left it ${accepted?.changeEvent?.status}, not priced`);
  }
  const pendingOrder = await convert(third);
  await makeApprovable(pendingOrder);
  tally('changeOrders', (await submit(pendingOrder)).status);

  // 4. out for pricing: one request reminded, one cancelled, one quote received and turned down
  const fourth = await newEvent(qs, { lineCount: 2 });
  {
    const { rfqs: [open, cancelled, refused], status } = await sendRfqs(fourth, [
      { ...(subcontractorId ? { vendorCompanyId: subcontractorId } : {}), companyName: `${ctx.company.canary} Concrete Works`, contactName: `Omar Said ${canary('rfq')}`, contactEmail: partyMail(`rfq.sub.${tag.toLowerCase()}`) },
      { companyName: `Harbour Plant Hire ${canary('rfq')}`, contactName: `Hire desk ${canary('rfq')}`, contactEmail: partyMail(`rfq.harbour.${tag.toLowerCase()}`) },
      { companyName: `Delta Formwork ${canary('rfq')}`, contactName: `Estimating ${canary('rfq')}`, contactEmail: partyMail(`rfq.delta.${tag.toLowerCase()}`) },
    ]);
    await procurement.POST(`${P}/change-events/rfqs/${open.id}/remind`);
    await procurement.POST(`${P}/change-events/rfqs/${cancelled.id}/cancel`);
    await portal('PUT', refused.portalUrl, '/quote', { lines: (fourth.lines || []).map((row) => ({ lineId: row.id, amount: round2(row.romAmount * 1.6) })), notes: `Budget price only ${canary('rfq')}` });
    await qs.POST(`${P}/change-events/rfqs/${refused.id}/reject`, { reason: `Well above the estimate ${canary('rfq')}` });
    tally('changeEvents', status || 'pricing');
  }

  // 4b. priced: a quote accepted, the change order not raised yet
  const pricedEvent = await newEvent(qs, { lineCount: 1 });
  {
    const { rfqs: [only] } = await sendRfqs(pricedEvent, [
      { ...(supplierId ? { vendorCompanyId: supplierId } : {}), companyName: `${ctx.company.canary} Steel & Cement Supply`, contactName: `Rana Haddad ${canary('rfq')}`, contactEmail: partyMail(`rfq.priced.${tag.toLowerCase()}`) },
    ]);
    await portal('PUT', only.portalUrl, '/quote', {
      lines: (pricedEvent.lines || []).map((row) => ({ lineId: row.id, amount: round2(row.romAmount * 0.95), note: canary('rfq') })),
      notes: `Quotation ${canary('rfq')}`,
      leadTimeDays: rng.int(3, 20),
    });
    const accepted = await qs.POST(`${P}/change-events/rfqs/${only.id}/accept`, { createCommitmentChangeOrder: false });
    tally('changeEvents', accepted?.changeEvent?.status || 'unknown');
  }

  // 5. closed without a change, 6. void
  const fifth = await newEvent(site, { lineCount: 0 });
  tally('changeEvents', (await qs.POST(`${P}/change-events/${fifth.id}/close`, { reason: `Covered by the contract scope ${canary('change_event')}` })).status);
  const sixth = await newEvent(qs, { lineCount: 1 });
  tally('changeEvents', (await pm.POST(`${P}/change-events/${sixth.id}/void`, { reason: `Raised twice ${canary('change_event')}` })).status);

  // 7. still open; the first with a site note attached
  const openEvents = ctx.count(1, 4);
  for (let i = 0; i < openEvents; i += 1) {
    const event = await newEvent(i % 2 ? qs : site, { origin: rng.pick(['manual', 'meeting', 'other']) });
    tally('changeEvents', event.status || 'open');
    if (i === 0) {
      const text = canary('attachment');
      await attach(site, {
        recordType: 'change_event',
        recordId: event.id,
        filename: `${text}-site-note.txt`,
        contentType: 'text/plain',
        body: Buffer.from(`Site note for ${event.ref}\n${text}\n`, 'utf8'),
        caption: `Site note ${text}`,
      });
    }
  }

  // 8. raised directly, split over two budget lines, left a draft
  const [lineA, lineB] = rng.shuffle(budgetLines);
  const splitValue = rng.int(6, 40) * 1000;
  const splitA = round2(splitValue * 0.6);
  const split = await newOrder({
    value: splitValue,
    budgetAllocations: [{ budgetLineId: lineA.id, amount: splitA }, { budgetLineId: lineB.id, amount: round2(splitValue - splitA) }],
    scheduleImpactSummary: `No programme effect expected. ${canary('change_order')}`,
    costImpactSummary: `Split 60/40 over two budget lines. ${canary('change_order')}`,
    affectedActivityIds: [activity().id],
  });
  tally('changeOrders', split.status);

  // 9. a draft the cost controller puts on a budget line from the budget screen
  const lineless = await newOrder();
  const placed = await cost.PUT(`${P}/budget/change-orders/${lineless.id}/line`, { lineId: line().id });
  if (!placed?.budgetLineId) fail(`putting ${lineless.ref} on a budget line answered ${JSON.stringify(placed).slice(0, 200)}`);
  tally('changeOrders', lineless.status);

  // 10. submitted, rejected, reopened: a draft again with its history
  const reopened = await newOrder();
  await makeApprovable(reopened);
  await submit(reopened);
  await reject(reopened);
  const back = await qs.POST(`${P}/change-orders/${reopened.id}/reopen`, { comment: `Re-priced at contract rates ${canary('change_order')}` });
  tally('changeOrders', `reopened:${back.status}`);

  // 10b. raised by mistake and archived by the PM (DELETE archives, it does not remove)
  const archived = await newOrder({ value: rng.int(1, 5) * 1000 });
  const archivedAnswer = await pm.DELETE(`${P}/change-orders/${archived.id}`);
  tally('changeOrders', archivedAnswer?.status || 'archived');

  // 11. a few more, raised directly and approved
  const moreApproved = ctx.count(0, 2);
  for (let i = 0; i < moreApproved; i += 1) {
    const order = await newOrder();
    await makeApprovable(order);
    await submit(order);
    await approveAndCount(order);
  }

  // ── direct costs ─────────────────────────────────────────────────────────
  let invoiceSeq = 0;
  const newDirectCost = async ({ type, label, vendor = false, lineCount = rng.int(1, 3), tax = false }) => {
    const lines = Array.from({ length: lineCount }, () => {
      const budgetLine = line();
      const quantity = rng.int(1, 12);
      const unitCost = rng.int(40, 750);
      return {
        description: `${label} item — ${canary('direct_cost_line')}`,
        costCodeId: budgetLine.costCodeId,
        budgetLineId: budgetLine.id,
        activityId: activity().id,
        costType: budgetLine.costType,
        quantity,
        unit: rng.pick(UNITS),
        unitCost,
        amount: quantity * unitCost,
        notes: canary('direct_cost_line'),
      };
    });
    const subtotal = lines.reduce((sum, row) => sum + row.amount, 0);
    const taxAmount = tax ? round2(subtotal * 0.05) : 0;
    invoiceSeq += 1;
    const created = await cost.POST(`${P}/direct-costs`, {
      type,
      description: `${label} ${tag} — ${canary('direct_cost')}`,
      costDate: ctx.daysAgo(rng.int(1, 45)),
      receivedDate: ctx.daysAgo(1),
      dueDate: ctx.daysAhead(rng.int(5, 45)),
      paymentTerms: `Net 30 ${canary('direct_cost')}`,
      notes: `Booked by cost control ${canary('direct_cost')}`,
      ...(vendor && supplierId
        ? { vendorCompanyId: supplierId, invoiceNumber: `INV-${ctx.project.canary}-${tag}-${nonce}-${String(invoiceSeq).padStart(2, '0')}` }
        : { vendorName: `Sundry payee ${canary('direct_cost')}` }),
      ...(tax ? { tax: taxAmount } : {}),
      lines,
    });
    ctx.record('direct_cost', created.id);
    const rows = created.lines || [];
    if (rows.length !== lines.length) fail(`${created.ref} came back with ${rows.length} of the ${lines.length} lines sent`);
    for (const row of rows) ctx.record('direct_cost_line', row.id);
    if (!near(created.subtotal, subtotal) || !near(created.total, subtotal + taxAmount)) {
      ctx.note(`FINDING? ${created.ref}: lines sent add up to ${subtotal} + tax ${taxAmount}, the product says subtotal ${created.subtotal} total ${created.total}`);
    }
    return { ...created, subtotalSent: subtotal, taxSent: taxAmount };
  };
  const submitCost = (row) => cost.POST(`${P}/direct-costs/${row.id}/submit`);
  const approveCost = async (row) => {
    const answer = await finance.POST(`${P}/direct-costs/${row.id}/approve`);
    if (answer?.status !== 'approved') fail(`approving ${row.ref} answered status ${answer?.status}`);
    return answer;
  };
  const pay = async (row, amount, reference) => {
    const answer = await finance.POST(`${P}/direct-costs/${row.id}/payments`, {
      amount,
      paidAt: `${ctx.today}T09:00:00.000Z`,
      method: rng.pick(['bank_transfer', 'cheque', 'card']),
      reference,
      note: `Paid ${canary('direct_cost_payment')}`,
    });
    const payment = (answer.payments || []).find((p) => p.reference === reference);
    if (!payment?.id) fail(`the payment ${reference} on ${row.ref} is not in the answer (${(answer.payments || []).length} payments)`);
    ctx.record('direct_cost_payment', payment.id);
    return answer;
  };

  let postedByThisRun = 0;

  // an invoice with tax, approved and paid in full
  const paid = await newDirectCost({ type: 'invoice', label: 'Supplier invoice', vendor: true, tax: true });
  await submitCost(paid);
  const paidApproved = await approveCost(paid);
  postedByThisRun += paid.subtotalSent;
  const paidAnswer = await pay(paid, Number(paidApproved.total), `PAY-${canary('direct_cost_payment')}`);
  if (paidAnswer.status !== 'paid' || !near(paidAnswer.paidTotal, paidApproved.total) || !near(paidAnswer.balance, 0)) {
    ctx.note(`FINDING? ${paid.ref} paid in full (${paidApproved.total}) answered status ${paidAnswer.status}, paid ${paidAnswer.paidTotal}, balance ${paidAnswer.balance}`);
  }
  tally('directCosts', paidAnswer.status);

  // an expense, approved and part paid
  const partPaid = await newDirectCost({ type: 'expense', label: 'Site expense' });
  await submitCost(partPaid);
  const partApproved = await approveCost(partPaid);
  postedByThisRun += partPaid.subtotalSent;
  const partAmount = round2(Number(partApproved.total) * 0.4);
  const partAnswer = await pay(partPaid, partAmount, `PAY-${canary('direct_cost_payment')}`);
  if (!near(partAnswer.paidTotal, partAmount) || !near(partAnswer.balance, Number(partApproved.total) - partAmount)) {
    ctx.note(`FINDING? ${partPaid.ref} paid ${partAmount} of ${partApproved.total} answered paid ${partAnswer.paidTotal}, balance ${partAnswer.balance}`);
  }
  tally('directCosts', `${partAnswer.status}+part_paid`);

  // payroll, waiting for approval
  const pendingCost = await newDirectCost({ type: 'payroll', label: 'Weekly payroll' });
  tally('directCosts', (await submitCost(pendingCost)).status);

  // other, a draft that was edited
  const draftCost = await newDirectCost({ type: 'other', label: 'Permit fee', lineCount: 1 });
  const edited = await cost.PATCH(`${P}/direct-costs/${draftCost.id}`, { notes: `Receipt to follow ${canary('direct_cost')}`, paymentTerms: `On receipt ${canary('direct_cost')}` });
  tally('directCosts', edited.status);

  // an invoice returned by finance
  const returned = await newDirectCost({ type: 'invoice', label: 'Plant hire invoice', vendor: true });
  await submitCost(returned);
  const returnedAnswer = await finance.POST(`${P}/direct-costs/${returned.id}/reject`, { reason: `Hire dates do not match the delivery ticket ${canary('direct_cost')}` });
  tally('directCosts', `returned:${returnedAnswer.status}`);

  // an invoice approved in error and voided: posted, then reversed
  const voided = await newDirectCost({ type: 'invoice', label: 'Duplicate invoice', vendor: true, lineCount: 1 });
  await submitCost(voided);
  await approveCost(voided);
  const voidAnswer = await finance.POST(`${P}/direct-costs/${voided.id}/void`, { reason: `Booked twice ${canary('direct_cost')}` });
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
  // The PUT replaces every allocation on a line. Only a line whose present
  // allocations are all this driver's own (none, on a first run) is touched,
  // so no allocation another driver made can be removed.
  const mine = new Set(ctx.records.budget_line_activity_allocation || []);
  const free = budgetLines.filter((row) => (row.allocations || []).every((allocation) => mine.has(allocation.id)));
  const taken = budgetLines.length - free.length;
  if (taken) ctx.note(`budget line allocations: ${taken} line(s) skipped, they carry allocations this driver did not make`);
  const spread = rng.shuffle(free).slice(0, ctx.count(1, 3));
  for (const budgetLine of spread) {
    const targets = rng.shuffle(activities).slice(0, Math.min(activities.length, rng.int(2, 4)));
    const weight = Math.floor(100 / targets.length);
    const answer = await cost.PUT(`${P}/budget/lines/${budgetLine.id}/allocations`, {
      allocations: targets.map((target, index) => ({ activityId: target.id, weight: index === 0 ? 100 - weight * (targets.length - 1) : weight })),
    });
    const rows = (answer?.allocations || []).filter((allocation) => allocation.id);
    if (rows.length !== targets.length) fail(`allocating ${budgetLine.costCode?.code} to ${targets.length} activities answered ${rows.length} allocations`);
    for (const allocation of rows) ctx.record('budget_line_activity_allocation', allocation.id);
  }
  // The PUT replaced a line's earlier rows, so the inventory keeps only the ones that still exist.
  if (ctx.records.budget_line_activity_allocation) {
    const live = new Set((await readLines()).flatMap((row) => (row.allocations || []).map((allocation) => allocation.id)));
    ctx.records.budget_line_activity_allocation = [...new Set(ctx.records.budget_line_activity_allocation)].filter((id) => live.has(id));
  }

  const transfers = ctx.count(1, 3);
  for (let i = 0; i < transfers; i += 1) {
    const [from, to] = rng.shuffle(budgetLines);
    const note = `Transfer ${i + 1} ${canary('budget_line_change')}`;
    const amount = Math.max(100, Math.round(Number(from.originalBudget || 10000) * 0.01));
    const answer = await finance.POST(`${P}/budget/transfers`, { fromLineId: from.id, toLineId: to.id, amount, note });
    const changes = listOf(answer).flatMap((row) => (row.changes || []).filter((change) => change.note === note));
    if (changes.length !== 2) fail(`transfer ${i + 1} of ${amount}: the answer carries ${changes.length} change rows with its note, not 2 (out and in)`);
    for (const change of changes) ctx.record('budget_line_change', change.id);
    const out = changes.find((change) => change.kind === 'transfer_out');
    const into = changes.find((change) => change.kind === 'transfer_in');
    if (!out || !into || !near(out.amount, -amount) || !near(into.amount, amount)) ctx.note(`FINDING? transfer of ${amount}: out ${out?.amount}, in ${into?.amount}`);
  }

  const lineRevisions = ctx.count(1, 3);
  for (let i = 0; i < lineRevisions; i += 1) {
    const budgetLine = line();
    const note = `Line revision ${i + 1} ${canary('budget_line_change')}`;
    const amount = (i % 2 ? -1 : 1) * rng.int(1, 9) * 500;
    const answer = await finance.POST(`${P}/budget/lines/${budgetLine.id}/revisions`, { amount, note });
    const changes = (answer.changes || []).filter((change) => change.note === note);
    if (changes.length !== 1) fail(`line revision ${i + 1} on ${budgetLine.costCode?.code}: the answer carries ${changes.length} change rows with its note`);
    ctx.record('budget_line_change', changes[0].id);
  }

  const snapshot = await finance.POST(`${P}/budget/snapshots`, { label: `Budget ${canary('budget_snapshot')}` });
  ctx.record('budget_snapshot', snapshot.id);
  await cost.GET(`${P}/budget/snapshots/${snapshot.id}`);

  // ── project budget revisions: draft, submitted, approved, rejected ───────
  const newRevision = async (who, status, changeType = 'addition') => {
    const created = await who.POST(`${P}/budget-revisions`, {
      title: `Budget revision ${tag} — ${canary('budget_revision')}`,
      changeType,
      amount: rng.int(2, 40) * 1000,
      effectiveDate: ctx.daysAgo(rng.int(0, 20)),
      ...(status ? { status } : {}),
      notes: `Raised from the monthly cost review ${canary('budget_revision')}`,
    });
    ctx.record('budget_revision', created.id);
    return created;
  };
  tally('budgetRevisions', (await newRevision(cost, 'draft')).status);
  tally('budgetRevisions', (await newRevision(cost, 'submitted', 'deduction')).status);
  const toApprove = await newRevision(cost, 'submitted');
  tally('budgetRevisions', (await pm.PATCH(`${P}/budget-revisions/${toApprove.id}`, { status: 'approved' })).status);
  const toReject = await newRevision(cost, 'submitted', 'deduction');
  tally('budgetRevisions', (await pm.PATCH(`${P}/budget-revisions/${toReject.id}`, { status: 'rejected', notes: `Not agreed with the client ${canary('budget_revision')}` })).status);
  // No status: the product creates it approved for a cost approver (the PM).
  const extraRevisions = ctx.count(0, 2);
  for (let i = 0; i < extraRevisions; i += 1) {
    const row = await newRevision(pm, null);
    tally('budgetRevisions', `${row.status} (created with no status by the PM)`);
  }
  // Approving a change order writes an approved revision of its own, linked
  // by the order's id: those this run caused are recorded here. Anything else
  // in the register that the inventory lacks is reported, not claimed.
  {
    const register = await cost.GET(`${P}/budget-revisions`);
    const recorded = new Set(ctx.records.budget_revision || []);
    const caused = new Set(approvedOrderIds);
    const strangers = [];
    for (const row of listOf(register)) {
      if (recorded.has(row.id)) continue;
      if (caused.has(row.linkedChangeOrder)) {
        ctx.record('budget_revision', row.id);
        tally('budgetRevisions', `${row.status} (written by a change-order approval)`);
      } else {
        strangers.push(row.ref);
      }
    }
    if (strangers.length) ctx.note(`budget revisions in the register that this driver did not make or cause (not recorded): ${strangers.join(', ')}`);
    const missing = approvedOrderIds.filter((id) => !listOf(register).some((row) => row.linkedChangeOrder === id));
    if (missing.length) ctx.note(`FINDING? ${missing.length} approved change order(s) have no budget revision linked to them`);
    // Each approved revision stores the running budget after it, in effective-date order.
    const approvedRows = listOf(register)
      .filter((row) => row.status === 'approved')
      .sort((a, b) => String(a.effectiveDate).localeCompare(String(b.effectiveDate)) || String(a.createdAt).localeCompare(String(b.createdAt)));
    let running = Number(register?.summary?.originalBudget) || 0;
    const wrong = [];
    for (const row of approvedRows) {
      running = round2(running + (row.changeType === 'deduction' ? -1 : 1) * Number(row.amount));
      if (!near(row.cumulativeBudget, running)) wrong.push(`${row.ref} stores ${row.cumulativeBudget}, running total ${running}`);
    }
    if (wrong.length) ctx.note(`FINDING? budget revision cumulative budget out of step with the approved revisions in effective-date order: ${wrong.slice(0, 4).join('; ')}${wrong.length > 4 ? ` (+${wrong.length - 4} more)` : ''}`);
    if (!near(register?.summary?.currentBudget, running)) ctx.note(`FINDING? budget revision register current budget ${register?.summary?.currentBudget} is not original ${register?.summary?.originalBudget} + approved revisions (${running})`);
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
    // The forecast only: the record's actual-through date is left where the ledger put it.
    await cost.PATCH(`${P}/cost/${costRecords[0].id}`, { forecast: round2((Number(costRecords[0].forecast) || 10000) * 1.07) });
  }
  const burns = ctx.count(1, 3);
  for (let i = 0; i < burns; i += 1) {
    const entry = await cost.POST(`${P}/cost/burn-rate`, {
      date: ctx.daysAgo(7 * (i + 1)),
      amount: rng.int(5, 90) * 1000,
      category: rng.pick(['labour', 'material', 'equipment', 'subcontract']),
      note: `Weekly spend ${canary('burn_rate_entry')}`,
    });
    ctx.record('burn_rate_entry', entry?.id);
  }

  // ── time-phased cost loading: draft, submitted, approved, rejected ───────
  const newLoading = async (status, daysBack) => {
    const row = await cost.POST(`${P}/reports/cost-loading`, {
      activityId: activity().id,
      plannedDate: ctx.daysAgo(daysBack),
      plannedValue: rng.int(5, 80) * 1000,
      source: 'manual',
      status,
      notes: `Planned value ${canary('activity_cost_loading')}`,
    });
    ctx.record('activity_cost_loading', row?.id);
    return row;
  };
  {
    const draft = await newLoading('draft', 5);
    await cost.PATCH(`${P}/reports/cost-loading/${draft.id}`, { notes: `Re-phased ${canary('activity_cost_loading')}` });
    tally('costLoadings', draft.status);
    tally('costLoadings', (await newLoading('submitted', 12)).status);
    const loadingApprovals = ctx.count(1, 3);
    for (let i = 0; i < loadingApprovals; i += 1) {
      const row = await newLoading('draft', 20 + i * 15);
      await cost.POST(`${P}/reports/cost-loading/${row.id}/submit`);
      tally('costLoadings', (await finance.POST(`${P}/reports/cost-loading/${row.id}/approve`)).status);
    }
    const refused = await newLoading('submitted', 3);
    tally('costLoadings', (await finance.POST(`${P}/reports/cost-loading/${refused.id}/reject`, { reason: `Does not follow the baseline ${canary('activity_cost_loading')}` })).status);
  }

  // ── delay: weather delays and extension-of-time claims ───────────────────
  const weatherIds = [];
  const delays = ctx.count(1, 3);
  for (let i = 0; i < delays; i += 1) {
    const hit = activity();
    const start = ctx.daysAgo(30 + i * 9);
    const days = rng.int(1, 3);
    const row = await planner.POST(`${P}/weather-delays`, {
      description: `Heavy rain stopped external works ${tag} — ${canary('weather_delay')}`,
      date: start,
      delayDays: days,
      contractual: i % 2 === 0,
      activityLinks: [{ activityId: hit.id, delayStart: start, delayEnd: ctx.daysAgo(30 + i * 9 - days), delayDays: days }],
    });
    ctx.record('weather_delay', row?.id);
    weatherIds.push(row.id);
  }
  await planner.PATCH(`${P}/weather-delays/${weatherIds[0]}`, { delayDays: 2, contractual: true });

  const claimBody = (status, { withProof = true } = {}) => {
    const hit = activity();
    const delayDays = rng.int(3, 20);
    return {
      eventName: `Delay event ${tag} — ${canary('eot_claim')}`,
      eventType: rng.pick(['weather', 'client_instruction', 'late_information', 'unforeseen_conditions']),
      delayDays,
      eotDaysGranted: Math.max(1, delayDays - rng.int(0, 2)),
      ldRatePerDay: rng.int(1, 9) * 500,
      activityLinks: [{ activityId: hit.id, delayStart: ctx.daysAgo(40), delayEnd: ctx.daysAgo(40 - delayDays), delayDays, impactBasis: `As-built against baseline ${canary('eot_claim')}` }],
      weatherDelayIds: [rng.pick(weatherIds)],
      ...(withProof && supportingDocumentId ? { documentIds: [supportingDocumentId] } : {}),
      analysis: `The event delayed ${hit.code} beyond its float. ${canary('eot_claim')}`,
      comment: `Notice served in time ${canary('eot_claim')}`,
      status,
    };
  };
  {
    const pick = ({ eventName, eventType, delayDays, eotDaysGranted, ldRatePerDay, activityLinks, analysis }) => ({ eventName, eventType, delayDays, eotDaysGranted, ldRatePerDay, activityLinks, analysis });
    await planner.POST(`${P}/eot/calculate`, pick(claimBody('draft')));

    const draft = await planner.POST(`${P}/eot`, claimBody('draft', { withProof: false }));
    ctx.record('eot_claim', draft?.id);
    await planner.PATCH(`${P}/eot/${draft.id}`, { analysis: `Float analysis to follow. ${canary('eot_claim')}` });
    tally('eotClaims', draft.status);

    const submitted = await planner.POST(`${P}/eot`, claimBody('submitted'));
    ctx.record('eot_claim', submitted?.id);
    tally('eotClaims', submitted.status);

    const granted = await planner.POST(`${P}/eot`, claimBody('draft'));
    ctx.record('eot_claim', granted?.id);
    await planner.POST(`${P}/eot/${granted.id}/submit`, { comment: `Submitted with particulars ${canary('eot_claim')}` });
    tally('eotClaims', (await pm.POST(`${P}/eot/${granted.id}/approve`, { comment: `Entitlement agreed ${canary('eot_claim')}` })).status);

    const refused = await planner.POST(`${P}/eot`, claimBody('draft'));
    ctx.record('eot_claim', refused?.id);
    await planner.POST(`${P}/eot/${refused.id}/submit`, { comment: `Submitted ${canary('eot_claim')}` });
    tally('eotClaims', (await pm.POST(`${P}/eot/${refused.id}/reject`, { reason: `Concurrent contractor delay ${canary('eot_claim')}` })).status);
  }

  // What a reader does with a forecast: a risk and a task raised from it. No
  // model is called; the action is the caller's own text (the explanation
  // route, which is the AI one, is left alone).
  {
    const risk = await pm.POST(`${P}/forecast/actions`, {
      action: { type: 'create_risk', activityId: costed[0].id, title: `Cost overrun risk ${tag} — ${canary('risk')}`, description: `Forecast shows cost pressure on ${costed[0].code}. ${canary('risk')}`, probability: 'medium', impact: 'high', mitigation: `Re-price and re-sequence ${canary('risk')}` },
    });
    ctx.record('risk', risk?.record?.id);
    const task = await pm.POST(`${P}/forecast/actions`, {
      action: { type: 'create_task', activityId: costed[0].id, title: `Review the forecast ${tag} — ${canary('task')}`, description: `Agree the cost to complete with the QS. ${canary('task')}` },
    });
    ctx.record('task', task?.record?.id);
  }

  state.last = { tag, approvedOrderIds, rejectedOrderId: rejectedOrder.id, pendingOrderId: pendingOrder.id, paidDirectCostId: paid.id, voidDirectCostId: voided.id, supportingDocumentId };

  ctx.note(
    `made — change events ${JSON.stringify(made.changeEvents)} (one priced through the vendor link); change orders ${JSON.stringify(made.changeOrders)}; direct costs ${JSON.stringify(made.directCosts)}; budget revisions ${JSON.stringify(made.budgetRevisions)}; cost loadings ${JSON.stringify(made.costLoadings)}; EOT claims ${JSON.stringify(made.eotClaims)}`
  );

  // ── the read side, and what it says after all that ───────────────────────
  // Read-only, after every record is made: a refusal here is a note, so the
  // loader does not run the whole driver again over it.
  const closing = await ctx.attempt('closing reads', async () => ({
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
    ledgerAfter: await cost.GET(`${P}/cost/reconciliation`),
    budgetCheck: await cost.GET(`${P}/budget/reconciliation`),
    forecast: await planner.GET(`${P}/forecast`),
    ev: await cost.GET(`${P}/reports/ev?cutoffDate=${ctx.today}`),
    linesAfter: await cost.GET(`${P}/budget/lines`),
  }));
  if (!closing) return;
  const { ledgerAfter, budgetCheck, forecast, ev, linesAfter } = closing;

  const directBefore = Number(ledgerBefore?.ledger?.bySource?.direct_cost || 0);
  const directAfter = Number(ledgerAfter?.ledger?.bySource?.direct_cost || 0);
  const moved = round2(directAfter - directBefore);
  const totals = linesAfter?.summary?.totals || {};

  ctx.note(
    `cost reconciliation: balanced=${ledgerAfter?.balanced} ledger total ${ledgerBefore?.ledger?.total} -> ${ledgerAfter?.ledger?.total} (${ledgerAfter?.ledger?.entries} entries); direct_cost ${directBefore} -> ${directAfter}, moved ${moved}, this run approved and kept ${round2(postedByThisRun)}; budget lines recorded actual ${ledgerAfter?.budget?.recordedTotal} vs derived ${ledgerAfter?.budget?.derivedTotal}; activities recorded ${ledgerAfter?.activity?.recordedTotal} vs derived ${ledgerAfter?.activity?.derivedTotal}; migration required=${ledgerAfter?.migration?.required}`
  );
  if (!near(moved, postedByThisRun)) {
    ctx.note(`FINDING? the ledger's direct cost moved by ${moved} but this run approved (and did not void) ${round2(postedByThisRun)}`);
  }
  if (ledgerAfter?.balanced !== true) ctx.note(`FINDING? cost reconciliation is not balanced after direct-cost approvals: ${JSON.stringify(ledgerAfter?.budget?.variances || []).slice(0, 200)} ${JSON.stringify(ledgerAfter?.activity?.variances || []).slice(0, 200)}`);
  const registerApproved = Number(closing.orders?.summary?.totalApproved);
  ctx.note(
    `budget register: original ${totals.originalBudget} + approved changes ${totals.approvedChanges} + revisions ${totals.revisions} = revised ${totals.revisedBudget}; actual ${totals.actual}; change-order register approved total ${registerApproved} (this run approved ${approvedChangeValue}); budget reconciliation balanced=${budgetCheck?.balanced} (lines ${budgetCheck?.totals?.budgetLines} vs activity budget ${budgetCheck?.totals?.activityBudget}, difference ${budgetCheck?.totals?.difference}, mismatches ${budgetCheck?.mismatches?.length})`
  );
  // An approved change order posts its value to budget lines, so the lines'
  // approved changes are the register's approved total.
  if (!near(totals.approvedChanges, registerApproved)) {
    ctx.note(`FINDING? the budget lines carry approved changes of ${totals.approvedChanges}, the change-order register's approved total is ${registerApproved}`);
  }
  ctx.note(
    `forecast: slip ${forecast?.schedule?.slipDays}d, cost budget ${forecast?.cost?.budget} bac ${forecast?.cost?.bac} eac ${forecast?.cost?.eac} (${forecast?.cost?.eacBasis}) actual ${forecast?.cost?.actual} overrun ${forecast?.cost?.overrun}; levels schedule=${forecast?.summary?.scheduleLevel} cost=${forecast?.summary?.costLevel}; ${(forecast?.dataQualityItems || []).length} data-quality notes [${(forecast?.dataQualityItems || []).map((item) => item.kind).join(', ')}]`
  );
  ctx.note(`EV at ${ctx.today}: BAC ${ev?.totalBudget} PV ${ev?.pv} EV ${ev?.ev} AC ${ev?.ac} SPI ${ev?.spi} CPI ${ev?.cpi} EAC ${ev?.eac} (${ev?.eacBasis})`);
  ctx.note(
    `registers: ${closing.events?.summary?.count} change events ${JSON.stringify(closing.events?.summary?.byStatus)}; ${listOf(closing.orders, 'orders').length} change orders, approved total ${registerApproved}; ${closing.costs?.summary?.count} direct costs total ${closing.costs?.summary?.total} paid ${closing.costs?.summary?.paid}; ${listOf(closing.revisions).length} budget revisions, current budget ${closing.revisions?.summary?.currentBudget}; ${listOf(closing.claims).length} EOT claims; weather allowance used ${closing.weather?.summary?.contractualUsed}/${closing.weather?.summary?.allowance}`
  );
};

module.exports = { name: 'change-cost', needs: ['foundation'], depths: ['standard'], run };
