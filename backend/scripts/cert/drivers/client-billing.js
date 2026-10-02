'use strict';

/**
 * Client billing: the contract with the client and the money it brings in.
 *
 *   prime contract (client, terms, an established value)
 *   -> approved allocations with approved progress (the certification cap)
 *   -> the advance the client pays up front
 *   -> IPC periods: items, adjustments, submit, certify, invoice, payments,
 *      retention release — left in every state the workflow has
 *   -> a client variation (change order with allocation links) that raises
 *      what may be certified
 *   -> statement, receivables, cash flow (manual entries and the rebuild)
 *
 * Certification is capped at approved progress on each allocation, so the
 * driver first makes sure a few allocations are approved and their activities
 * carry approved progress, then shares the headroom out over the periods it
 * raises. A second run raises new periods (the months after the last one),
 * claims a little more progress and bills what that earned.
 *
 * The periods a run leaves, oldest first:
 *   paid (one to three; the first also has retention released, sometimes
 *   with the released sum still owed), part-paid (with a deduction),
 *   invoiced (with stored materials and a signed copy attached), certified,
 *   in about half the projects one certified over the cap by the PM's
 *   override, submitted, draft.
 *
 * Who does what: the QS keeps the contract and raises and submits the
 * certificates, the PM and finance certify in turn, finance invoices, records
 * the client's payments and releases retention, the cost controller keeps
 * cash flow. Recording a payment and releasing retention are finance-only:
 * where the owner stands in for finance they are refused and noted.
 *
 * Lines that start with CHECK in the notes are places where the product's own
 * figures disagree with each other; they are findings, not failures.
 */

const listOf = (data, ...keys) => {
  if (Array.isArray(data)) return data;
  for (const key of keys) if (Array.isArray(data?.[key])) return data[key];
  return data?.items || [];
};
const r2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const addMonths = (ym, n) => {
  const [year, month] = ym.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + n, 1)).toISOString().slice(0, 7);
};
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const ESTABLISHED = ['project_value', 'contract_entry'];
const OPEN_STATES = ['draft', 'submitted'];

/** A one-page PDF saying `text`: small, valid, and searchable for the canary. */
const pdf = (text) => {
  const safe = String(text).replace(/[()\\]/g, ' ');
  const stream = `BT /F1 11 Tf 40 780 Td (${safe}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
};

const run = async (ctx) => {
  const { P, rng } = ctx;
  const pm = ctx.who('pm');
  const planner = ctx.who('planner');
  const qs = ctx.who('qs');
  const cost = ctx.who('cost');
  const site = ctx.who('site');
  const finance = ctx.who('finance');

  // What a second run needs to know about the first. The run number goes into
  // every reference the product keeps unique per project (invoice numbers,
  // payment, release and advance references).
  const state = (ctx.refs.clientBilling = ctx.refs.clientBilling || { run: 0, allocationIds: [], periods: {}, changeOrders: [] });
  state.run += 1;
  const R = `R${state.run}`;
  // The canary of a record, with the run: unique across runs, and safe where the product wants a unique reference.
  const mark = (type) => `${ctx.canary(type)}-${R}`;
  const recordOnce = (type, id) => {
    if (id && !(ctx.records[type] || []).includes(id)) ctx.record(type, id);
    return id;
  };
  const totals = { certified: 0, retention: 0, net: 0, invoiced: 0, paid: 0, released: 0, advance: 0, variation: 0 };

  // ── 1. the prime contract: a client, terms, an established value ─────────
  let contract = await qs.GET(`${P}/prime-contract`);
  recordOnce('prime_contract', contract.id);
  if (!ESTABLISHED.includes(contract.originalValueSource)) {
    // The value is the BOQ's total nobody confirmed: certifying and the advance wait for it.
    contract = await qs.PATCH(`${P}/prime-contract`, { confirmOriginalValue: true });
  }
  const contractTag = mark('prime_contract');
  const terms = {
    title: `${ctx.project.name} client contract ${contractTag}`.slice(0, 200),
    notes: `Payment terms as the signed agreement; retention and advance per the particular conditions. ${contractTag}`,
    status: 'active',
  };
  if (ctx.companyRefs.directory?.client) terms.clientCompanyId = ctx.companyRefs.directory.client;
  if (!state.termsSet) {
    Object.assign(terms, {
      paymentTermsDays: rng.pick([30, 45, 60]),
      retentionRate: rng.pick([5, 7.5, 10]),
      retentionCapRate: rng.pick([5, 10]),
      advanceRate: rng.pick([5, 10]),
      advanceRecoveryRate: rng.pick([10, 15, 20]),
      materialsOnSiteRate: rng.pick([70, 80, 100]),
      taxRate: rng.pick([0, 0, 5, 15]),
    });
  }
  contract = await qs.PATCH(`${P}/prime-contract`, terms);
  state.termsSet = true;
  state.contractId = contract.id;
  const retentionRate = Number(contract.retentionRate) || 0;

  // ── 2. allocations to bill against: approved, with approved progress ─────
  const allocationRows = listOf(await qs.GET(`${P}/activity-boq-allocations`), 'allocations');
  const allocationById = new Map(allocationRows.map((row) => [row.id, row]));
  const activities = listOf(await planner.GET(`${P}/activities`), 'activities');
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  // Usable: a live allocation nobody rejected, on an activity whose progress this driver can claim as a
  // percentage (or that already has approved progress, whatever its method).
  const usable = (entry) => {
    const row = allocationById.get(entry.id);
    const activity = row && activityById.get(row.activityId);
    if (!row || row.isActive === false || !['draft', 'submitted', 'approved'].includes(row.status) || !activity) return false;
    return Boolean(activity.approvedProgressUpdatedAt) || !activity.progressMethod || activity.progressMethod === 'percent';
  };
  const groups = Object.values(ctx.refs.allocations || {}).filter((group) => group.length);
  const known = (groups.length ? groups : allocationRows.map((row) => [{ id: row.id }]))
    .map((group) => group.filter(usable))
    .filter((group) => group.length);
  if (!state.allocationIds.length) {
    // A bill row split over two activities first (a variation on one half is where the cap is interesting), then others.
    const split = known.find((group) => group.length > 1);
    const singles = rng.shuffle(known.filter((group) => group !== split)).flat();
    const want = Math.max(ctx.count(3, 6), split ? split.length + 1 : 1);
    state.allocationIds = [...(split || []), ...singles].slice(0, want).map((entry) => entry.id);
    if (split) state.splitAllocationIds = split.map((entry) => entry.id);
  } else {
    // A later run bills one more allocation, so there is always something new to certify.
    const next = known.flat().find((entry) => !state.allocationIds.includes(entry.id));
    if (next) state.allocationIds.push(next.id);
  }
  const billable = [];
  for (const id of state.allocationIds) {
    let row = allocationById.get(id);
    if (!row || row.isActive === false) continue;
    if (row.status === 'draft') {
      row = (await ctx.attempt(`allocation ${id} submit`, () => planner.POST(`${P}/activity-boq-allocations/${id}/submit`))) || row;
    }
    if (row.status === 'submitted') {
      row = (await ctx.attempt(`allocation ${id} approve`, () => qs.POST(`${P}/activity-boq-allocations/${id}/approve`))) || row;
    }
    if (row.status === 'approved') billable.push(row);
  }
  if (!billable.length) throw new Error('client-billing: no allocation could be approved to bill against');

  for (const activityId of new Set(billable.map((row) => row.activityId))) {
    const activity = activityById.get(activityId);
    const approved = activity?.approvedProgressUpdatedAt ? Number(activity.pctComplete) || 0 : 0;
    let target = null;
    if (approved < 10) target = rng.int(30, 70);
    else if (state.run > 1 && approved < 100) target = Math.min(100, Math.round(approved) + rng.int(5, 15));
    if (target === null) continue;
    await ctx.attempt(`progress on ${activity?.activityCode || activityId}`, async () => {
      const claimed = await site.POST(`${P}/activities/${activityId}/progress`, {
        pctComplete: target,
        progressMethod: 'percent',
        status: 'submitted',
        source: 'manual',
        notes: `Measured on site for the client valuation. ${mark('progress_submission')}`,
      });
      const submissionId = claimed?.submission?.id;
      if (!submissionId) {
        ctx.note(`progress on ${activity?.activityCode}: no submission came back (${Object.keys(claimed || {}).join(',')})`);
        return;
      }
      ctx.record('progress_submission', submissionId);
      await planner.POST(`${P}/activities/${activityId}/progress-submissions/${submissionId}/approve`);
    });
  }

  // ── 3. the advance: part of what was agreed, paid up front ───────────────
  const advanceRoom = r2((Number(contract.advanceAmount) || 0) - (Number(contract.advancePaidAmount) || 0));
  if (advanceRoom > 1) {
    const amount = r2(advanceRoom * (state.run === 1 ? rng.pick([0.4, 0.5, 0.6]) : 0.25));
    const reference = mark('adv').slice(0, 40);
    await ctx.attempt('advance receipt', async () => {
      await finance.POST(`${P}/prime-contract/advances`, {
        amount,
        reference,
        occurredAt: ctx.daysAgo(rng.int(100, 160)),
        note: `Advance received against the advance payment guarantee. ${mark('prime_contract_advance')}`,
      });
      totals.advance = amount;
    });
  }

  // ── 4. the periods ───────────────────────────────────────────────────────
  // Oldest first, so the paid ones are the early months and the open ones the
  // latest. What an open period claims is kept aside ("reserved") so a later
  // period does not claim the same headroom again.
  const existing = listOf(await qs.GET(`${P}/ipc`));
  const reserved = new Map();
  const reserve = (allocationId, amount) => reserved.set(allocationId, r2((reserved.get(allocationId) || 0) + amount));
  for (const row of existing.filter((entry) => OPEN_STATES.includes(entry.status))) {
    const detail = await qs.GET(`${P}/ipc/${encodeURIComponent(row.period)}`);
    for (const item of detail.items || []) if (item.allocationId) reserve(item.allocationId, Number(item.currentCert || 0));
  }
  // Three projects in four also get a certificate that ends up over the cap and needs the PM's override
  // (CERT_BILLING_OVERRIDE=1 or 0 decides it for every project of a run).
  const drawn = ctx.count(0, 3) > 0;
  const withOverride = ['0', '1'].includes(process.env.CERT_BILLING_OVERRIDE) ? process.env.CERT_BILLING_OVERRIDE === '1' : drawn;
  const plan = [...Array(ctx.count(0, 2)).fill('paid'), 'paid', 'part_paid', 'invoiced', 'certified', 'submitted', 'draft'];
  const months = existing.map((row) => row.period).filter((name) => /^\d{4}-\d{2}$/.test(name)).sort();
  let label = months.length ? addMonths(months[months.length - 1], 1) : addMonths(ctx.today.slice(0, 7), -(plan.length - 1 + (withOverride ? 1 : 0)));
  const taken = new Set(existing.map((row) => row.period));
  const nextLabel = () => {
    while (taken.has(label)) label = addMonths(label, 1);
    taken.add(label);
    return label;
  };
  const maxItems = ctx.count(2, 5);
  const firstPaid = plan.indexOf('paid');
  let certifiedCount = 0;
  let variation = null;

  /** Opens a period: one item per approved allocation, each with what approved progress has earned and nobody has certified. */
  const open = async () => {
    const period = nextLabel();
    const certificate = await qs.POST(`${P}/ipc`, { period });
    ctx.record('ipc_certificate', certificate.id);
    state.periods[period] = { id: certificate.id, state: 'draft', run: state.run };
    const candidates = (certificate.items || [])
      .map((item) => {
        // "uncertified": what approved progress has earned and no certified period has taken.
        // "headroom": the same, less what the open periods already claim.
        const uncertified = r2(Number(item.certificationReview?.earnedAmount || 0) - Number(item.previousCert || 0));
        return { item, uncertified, headroom: r2(uncertified - (reserved.get(item.allocationId) || 0)) };
      })
      .filter((entry) => entry.item.allocationId && Number(entry.item.rate) > 0 && entry.headroom > Number(entry.item.rate) * 0.01)
      .sort((a, b) => String(a.item.allocationId).localeCompare(String(b.item.allocationId)));
    return { period, route: `${P}/ipc/${period}`, certificate, candidates, tag: mark('ipc_certificate'), claims: new Map(), claimed: 0 };
  };

  /** Certifies a quantity on one item of an open period. */
  const claim = async (sheet, { item }, qty, { keep = false } = {}) => {
    const updated = await qs.PATCH(`${sheet.route}/items/${item.id}`, { qty, retentionRate });
    recordOnce('ipc_item', item.id);
    const amount = Number(updated.currentCert ?? r2(qty * Number(item.rate)));
    sheet.claims.set(item.allocationId, amount);
    sheet.claimed = r2(sheet.claimed + amount);
    state.everClaimed = true;
    if (keep) reserve(item.allocationId, amount);
    return amount;
  };

  const certify = async (sheet) => {
    const comment = `Certified against approved progress. ${sheet.tag}`;
    const certifier = certifiedCount % 2 === 1 ? finance : pm;
    certifiedCount += 1;
    let certificate;
    try {
      certificate = await certifier.POST(`${sheet.route}/certify`, { comment });
    } catch (error) {
      // Progress moved under the claim (another driver, another run): over the cap only the PM may certify, and must say why.
      if (!['IPC_PM_OVERRIDE_REASON_REQUIRED', 'IPC_PM_OVERRIDE_REQUIRED'].includes(error.code)) throw error;
      ctx.note(`${sheet.period}: certify as ${certifier.email} -> ${error.status} ${error.code}; certified by the PM with an override reason`);
      certificate = await pm.POST(`${sheet.route}/certify`, { comment, overrideReason: `PM override: certified ahead of the progress record. ${sheet.tag}` });
    }
    state.periods[sheet.period].state = 'certified';
    return certificate;
  };

  const tally = (certificate) => {
    totals.certified = r2(totals.certified + Number(certificate.totalCert || 0));
    totals.retention = r2(totals.retention + Number(certificate.totalRet || 0));
    totals.net = r2(totals.net + Number(certificate.netPayable || 0));
  };

  /** The client variation: a change order with allocation links, approved, so more may be certified. */
  const raiseVariation = async () => {
    const target = billable.find((row) => (state.splitAllocationIds || []).includes(row.id)) || billable[0];
    const unitRate = Number(target.quantity) > 0 ? r2(Number(target.amount) / Number(target.quantity)) : 0;
    const quantity = Math.max(1, Math.round(Number(target.quantity) * 0.05));
    const amount = r2(quantity * unitRate);
    if (amount <= 0) return;
    const budgetLineId = Object.values(ctx.refs.budgetLines || {})[0] || undefined;
    const body = (tag, value, linkQuantity) => ({
      description: `Client variation: additional quantity instructed on site. ${tag}`,
      category: 'client_variation',
      activityId: target.activityId,
      budgetLineId,
      value,
      scheduleImpact: 0,
      scheduleImpactSummary: `No effect on completion; the added quantity is absorbed in the activity's duration. ${tag}`,
      costImpactSummary: `${linkQuantity} more at the bill rate ${unitRate} = ${value}. ${tag}`,
      activityLinks: [{ activityId: target.activityId, relationType: 'impacted', scheduleImpactDays: 0, costImpact: value, notes: tag }],
      allocationLinks: [{ allocationId: target.id, quantity: linkQuantity, amount: value, notes: tag }],
    });
    const tag = mark('change_order');
    const change = await qs.POST(`${P}/change-orders`, body(tag, amount, quantity));
    ctx.record('change_order', change.id);
    const fileTag = mark('attachment');
    const attached = await qs.upload('POST', `${P}/attachments`, {
      field: 'files',
      filename: `${fileTag}-client-instruction.pdf`,
      contentType: 'application/pdf',
      body: pdf(`Client instruction for variation ${change.ref || ''} ${fileTag}`),
      fields: { recordType: 'change_order', recordId: change.id, caption: `Client instruction ${fileTag}` },
    });
    const file = listOf(attached, 'attachments')[0];
    if (file?.id) ctx.record('attachment', file.id);
    const documentId = file?.documentId || file?.document?.id;
    if (documentId) {
      ctx.record('project_document', documentId);
      await qs.PATCH(`${P}/change-orders/${change.id}`, { documentIds: [documentId] });
    }
    await qs.POST(`${P}/change-orders/${change.id}/submit`, { comment: `For the client's approval. ${tag}` });
    await pm.POST(`${P}/change-orders/${change.id}/approve`, { comment: `Approved under the client's instruction. ${tag}` });
    variation = { id: change.id, allocationId: target.id, quantity, amount, status: 'approved' };
    state.changeOrders.push(variation);
    totals.variation = amount;
    // One more left undecided: a pending variation must not raise what may be certified.
    if (ctx.count(0, 1)) {
      const pendingTag = `${mark('change_order')} pending`;
      const pending = await qs.POST(`${P}/change-orders`, body(pendingTag, r2(amount / 2), Math.max(1, Math.round(quantity / 2))));
      ctx.record('change_order', pending.id);
      state.changeOrders.push({ id: pending.id, allocationId: target.id, status: 'draft' });
    }
    const after = await qs.GET(`${P}/prime-contract`);
    ctx.note(`variation ${change.ref || change.id}: ${amount} approved; contract approved changes ${contract.approvedChangesValue} -> ${after.approvedChangesValue}, pending ${after.pendingChangesValue}`);
    contract = after;
  };

  for (const [index, target] of plan.entries()) {
    const remaining = plan.length - index;

    // The variation lands once the early periods are settled, so a later certificate is measured against it.
    if (target === 'certified') await ctx.attempt('client variation', raiseVariation);

    const sheet = await open();
    const { period, route } = sheet;
    let { certificate } = sheet;
    if (index === 0) {
      const defaults = [...new Set((certificate.items || []).map((item) => Number(item.retentionRate)))];
      if (defaults.some((rate) => rate !== retentionRate)) {
        ctx.note(`CHECK retention: a new certificate's items carry ${defaults.join('/')}% (the project default) while the contract's retention rate is ${retentionRate}%`);
      }
    }

    // Which items this period bills: a different few each time, the variation's allocation first once it exists.
    const ordered = sheet.candidates.length
      ? sheet.candidates.map((_, i) => sheet.candidates[(i + index * maxItems) % sheet.candidates.length])
      : [];
    if (target === 'certified' && variation) ordered.sort((a, b) => Number(b.item.allocationId === variation.allocationId) - Number(a.item.allocationId === variation.allocationId));
    for (const entry of ordered.slice(0, maxItems)) {
      const rate = Number(entry.item.rate);
      const share = (entry.headroom / (remaining + 0.5)) * (0.75 + rng.next() * 0.25);
      let qty = Math.floor(share / rate);
      if (qty < 1) qty = Math.floor((share / rate) * 100) / 100;
      if (qty > 0) await claim(sheet, entry, qty, { keep: OPEN_STATES.includes(target) });
    }
    if (sheet.claimed <= 0) ctx.note(`${period}: nothing left to certify (approved progress is fully certified), the period carries no claim`);

    // Adjustments: every certificate carries a note; one a deduction, one stored materials.
    const adjustments = { deductionsNote: `Valuation ${period} ${sheet.tag}` };
    if (target === 'part_paid' && sheet.claimed > 200) {
      adjustments.deductions = r2(Math.min(sheet.claimed * 0.02, 5000));
      adjustments.deductionsNote = `Contra charge for client-supplied testing. ${sheet.tag}`;
    }
    if (target === 'invoiced' && sheet.claimed > 0) {
      const atCost = r2(Math.min(sheet.claimed * 0.1, 20000));
      adjustments.materialsAtCost = atCost;
      adjustments.materialsOnSite = r2(atCost * ((Number(contract.materialsOnSiteRate) || 100) / 100));
    }
    await qs.PATCH(`${route}/adjustments`, adjustments);

    // The override case is set up while this period is still a draft: a second
    // period claims what is left on one allocation plus one unit, which is
    // within the cap only until this one is certified.
    let over = null;
    if (target === 'certified' && withOverride) {
      // On the allocation with the least left, so the open periods that follow still have something to claim.
      const base = ordered
        .slice(0, maxItems)
        .filter((entry) => sheet.claims.get(entry.item.allocationId) >= Number(entry.item.rate))
        .sort((a, b) => a.uncertified - b.uncertified)[0];
      if (!base) ctx.note(`${period}: no claim of a whole unit to build the override case on`);
      if (base) {
        over = await open();
        const twin = over.candidates.find((entry) => entry.item.allocationId === base.item.allocationId);
        const rate = Number(base.item.rate);
        const qty = twin ? Math.floor((twin.uncertified - sheet.claims.get(base.item.allocationId)) / rate) + 1 : 0;
        if (twin && qty > 0) {
          await claim(over, twin, qty);
          await qs.PATCH(`${over.route}/adjustments`, { deductionsNote: `Valuation ${over.period} ${over.tag}` });
        } else {
          ctx.note(`${over.period}: no room to set up the override case; the period stays a draft with no claim`);
          over = null;
        }
      }
    }

    if (target !== 'draft') {
      await qs.POST(`${route}/submit`);
      state.periods[period].state = 'submitted';
    }
    if (!OPEN_STATES.includes(target)) {
      certificate = await certify(sheet);
      tally(certificate);
    }

    if (over) {
      // Now over the cap by less than one unit: finance may not certify it, the PM may, with a reason.
      await qs.POST(`${over.route}/submit`);
      state.periods[over.period].state = 'submitted';
      // (Where the owner stands in for finance there is nobody else to refuse: the PM certifies straight away.)
      const bare = pm.email === finance.email
        ? { status: 400, body: { error: { code: 'IPC_PM_OVERRIDE_REASON_REQUIRED' } }, skipped: true }
        : await finance.send('POST', `${over.route}/certify`, { comment: `Certified. ${over.tag}` });
      if (bare.status === 200) {
        // Something else already held part of the headroom back, so the claim stayed within the cap.
        tally(bare.body.data);
        state.periods[over.period].state = 'certified';
        ctx.note(`${over.period}: stayed within the cap, certified by finance with no override`);
      } else {
        const reasoned = bare.skipped
          ? { status: 403 }
          : await finance.send('POST', `${over.route}/certify`, { comment: `Certified. ${over.tag}`, overrideReason: `Finance tries the override. ${over.tag}` });
        if (bare.status !== 400 || bare.body?.error?.code !== 'IPC_PM_OVERRIDE_REASON_REQUIRED' || reasoned.status !== 403) {
          ctx.note(`CHECK ${over.period}: an over-cap certificate certified by finance answered ${bare.status} ${bare.body?.error?.code || 'ok'} without a reason and ${reasoned.status} ${reasoned.body?.error?.code || 'ok'} with one (expected 400 IPC_PM_OVERRIDE_REASON_REQUIRED, then 403)`);
        }
        const overridden =
          reasoned.status === 200
            ? reasoned.body.data
            : await pm.POST(`${over.route}/certify`, {
                comment: `Certified ahead of the progress record. ${over.tag}`,
                overrideReason: `PM override: the last lift was measured after the progress cut-off. ${over.tag}`,
              });
        tally(overridden);
        state.periods[over.period].state = 'certified_override';
        ctx.note(`${over.period}: certified by PM override, over-certification ${overridden.overCertificationAmount}`);
      }
    }

    if (['invoiced', 'part_paid', 'paid'].includes(target)) {
      const invoiceDate = `${addMonths(period, 1)}-05`;
      const invoice = await finance.POST(`${route}/invoice/issue`, {
        invoiceNumber: mark('ipc_invoice'),
        invoiceDate,
        // Some invoices state their due date, the others fall back on the contract's payment terms.
        ...(index % 2 === 0 ? { dueDate: addDays(invoiceDate, Number(contract.paymentTermsDays) || 30) } : {}),
      });
      ctx.record('ipc_invoice', invoice.id);
      state.periods[period].state = 'invoiced';
      state.periods[period].invoiceId = invoice.id;
      totals.invoiced = r2(totals.invoiced + Number(invoice.netAmount || 0));
      let balance = Number(invoice.balanceDue || 0);

      const pay = async (amount, when, why) => {
        if (amount <= 0) return null;
        const tag = mark('ipc_payment');
        const result = await ctx.attempt(`${period} payment`, () =>
          finance.POST(`${route}/payments`, {
            amount,
            paymentReference: tag,
            paymentDate: when,
            paymentMethod: rng.pick(['bank_transfer', 'cheque', 'wire']),
            notes: `${why} ${tag}`,
          })
        );
        if (!result?.payment?.id) return null;
        ctx.record('ipc_payment', result.payment.id);
        totals.paid = r2(totals.paid + amount);
        balance = Number(result.invoice?.balanceDue ?? r2(balance - amount));
        return result;
      };

      if (target === 'part_paid' && balance > 0) {
        const result = await pay(r2(balance * rng.pick([0.4, 0.5, 0.7])), addDays(invoiceDate, 20), 'Payment on account.');
        if (result) state.periods[period].state = 'part_paid';
      }
      if (target === 'paid' && balance > 0) {
        const instalments = ctx.count(1, 3);
        let settled = null;
        for (let n = 1; n <= instalments && balance > 0; n += 1) {
          const amount = n === instalments ? balance : r2(balance / (instalments - n + 2));
          settled = await pay(amount, addDays(invoiceDate, 12 * n), `Instalment ${n} of ${instalments}.`);
          if (!settled) break;
        }
        if (settled) state.periods[period].state = settled.certificate?.status === 'paid' ? 'paid' : 'part_paid';
        // The first paid period also gives retention back; half the time the client has paid that too.
        if (index === firstPaid && Number(certificate.totalRet) > 0 && state.periods[period].state === 'paid') {
          const held = Number(certificate.totalRet);
          const tag = mark('ipc_retention_release');
          const release = await ctx.attempt(`${period} retention release`, () =>
            finance.POST(`${route}/retention-release`, {
              amount: rng.chance(0.5) ? held : r2(held / 2),
              releaseReference: tag,
              releaseDate: addDays(invoiceDate, 60),
              reason: `Released on the taking-over certificate. ${tag}`,
            })
          );
          if (release?.release?.id) {
            ctx.record('ipc_retention_release', release.release.id);
            totals.released = r2(totals.released + Number(release.release.amount || 0));
            const after = release.certificate || {};
            if (after.status === 'paid' && after.paymentStatus !== 'paid') {
              ctx.note(`CHECK ${period}: after a retention release the certificate reads status=${after.status} with paymentStatus=${after.paymentStatus}, balanceDue=${after.balanceDue}`);
            }
            balance = Number(release.invoice?.balanceDue || 0);
            const repaid = rng.chance(0.5) ? await pay(balance, addDays(invoiceDate, 75), 'Retention released and paid.') : null;
            state.periods[period].state = repaid ? 'paid_retention_released' : 'paid_retention_released_owed';
          }
        }
      }
    }

    // A remark on the certificate, and on one of them its signed copy.
    if (index % 2 === 0) {
      await ctx.attempt(`${period} comment`, async () => {
        const comment = await qs.POST(`${P}/comments`, {
          recordType: 'ipc_certificate',
          recordId: certificate.id,
          body: `Measured with the client's QS on site; quantities agreed. ${mark('comment')}`,
        });
        if (comment?.id) ctx.record('comment', comment.id);
      });
    }
    if (target === 'invoiced') {
      await ctx.attempt(`${period} certificate copy`, async () => {
        const fileTag = mark('attachment');
        const attached = await qs.upload('POST', `${P}/attachments`, {
          field: 'files',
          filename: `${fileTag}-certificate-${period}.pdf`,
          contentType: 'application/pdf',
          body: pdf(`Payment certificate ${period} signed copy ${fileTag}`),
          fields: { recordType: 'ipc_certificate', recordId: certificate.id, caption: `Signed certificate ${period} ${fileTag}` },
        });
        for (const file of listOf(attached, 'attachments')) {
          ctx.record('attachment', file.id);
          if (file.documentId) ctx.record('project_document', file.documentId);
        }
      });
    }

    // After the variation: the certificate's review says how far each allocation's limit was raised.
    if (target === 'certified' && variation) {
      const detail = await qs.GET(route);
      const others = (detail.items || []).filter((item) => Number(item.certificationReview?.approvedVariationAmount) > 0 && item.allocationId !== variation.allocationId);
      if (others.length) {
        ctx.note(`CHECK variation: ${variation.amount} was linked to one allocation, yet the limit of ${others.length} other allocation(s) of the same BOQ row is raised by it too (${others.map((item) => `${item.boqItem?.code}: +${item.certificationReview.approvedVariationAmount}`).join(', ')})`);
      }
    }
  }

  // Periods with no claim in them are not client billing: say so loudly rather than pass.
  if (!state.everClaimed) throw new Error('client-billing: nothing could be certified — no allocation of this project has approved progress to bill against');

  // The advance ledger: the receipt, and the recovery every certified period took out of it.
  await ctx.attempt('advance ledger', async () => {
    for (const row of listOf(await finance.GET(`${P}/prime-contract/advances`))) recordOnce('prime_contract_advance', row.id);
  });

  // ── 5. what the client owes: statement, receivables, cash flow ───────────
  const statement = await qs.GET(`${P}/prime-contract/statement`);
  const receivables = await finance.GET(`${P}/prime-contract/receivables`);
  const lastCertified = Object.entries(state.periods).filter(([, entry]) => !OPEN_STATES.includes(entry.state)).map(([period]) => period).sort().pop();
  if (lastCertified) await qs.GET(`${P}/prime-contract/statement?period=${lastCertified}`);
  if (r2(statement.summary?.invoiced) !== r2(receivables.invoiced) || r2(statement.summary?.outstanding) !== r2(receivables.outstanding)) {
    ctx.note(`CHECK statement vs receivables: statement invoiced ${statement.summary?.invoiced} received ${statement.summary?.received} outstanding ${statement.summary?.outstanding}; receivables invoiced ${receivables.invoiced} received ${receivables.received} outstanding ${receivables.outstanding}`);
  }

  const flowBefore = await cost.GET(`${P}/cash-flow`);
  const systemInflow = r2((flowBefore.rows || []).filter((row) => row.source === 'system').reduce((sum, row) => sum + Number(row.inflow || 0), 0));
  if (systemInflow !== r2(receivables.received)) {
    ctx.note(`CHECK cash flow: before a rebuild the projection shows inflow ${systemInflow} while ${receivables.received} has been received`);
  }
  const forecastFrom = addMonths(label, 1);
  for (let n = 0, entries = ctx.count(1, 3); n < entries; n += 1) {
    await ctx.attempt('cash-flow entry', async () => {
      const row = await cost.POST(`${P}/cash-flow`, {
        period: addMonths(forecastFrom, n),
        inflow: rng.int(20, 400) * 1000,
        outflow: rng.int(10, 300) * 1000,
        note: `Forecast receipt and spend. ${mark('cash_flow_entry')}`,
      });
      ctx.record('cash_flow_entry', row.id);
    });
  }
  // One entered by mistake and taken back, so the delete is exercised too.
  await ctx.attempt('cash-flow entry delete', async () => {
    const mistaken = await cost.POST(`${P}/cash-flow`, { period: addMonths(forecastFrom, 6), inflow: 1, outflow: 0, note: `Entered in error. ${mark('cash_flow_entry')}` });
    await cost.DELETE(`${P}/cash-flow/${mistaken.id}`);
  });
  const flow = await ctx.attempt('cash-flow rebuild', () => cost.POST(`${P}/cash-flow/rebuild`));
  if (flow) {
    const manual = (flow.rows || []).filter((row) => row.source === 'manual').length;
    ctx.note(`cash flow after rebuild: inflow ${flow.summary?.inflow} outflow ${flow.summary?.outflow} net ${flow.summary?.net}; ${manual} manual entries kept`);
  }

  const states = Object.entries(state.periods).filter(([, entry]) => entry.run === state.run).map(([period, entry]) => `${period}=${entry.state}`).join(' ');
  ctx.note(`run ${state.run}: ${states}`);
  ctx.note(`run ${state.run} totals: certified ${totals.certified} (retention ${totals.retention}, net ${totals.net}), invoiced ${totals.invoiced}, paid ${totals.paid}, retention released ${totals.released}, advance received ${totals.advance}, variation ${totals.variation}`);
  ctx.note(`project to date: receivables invoiced ${receivables.invoiced}, received ${receivables.received}, outstanding ${receivables.outstanding}, overdue ${receivables.overdue}; cumulative certified ${statement.summary?.cumulativeCertified}`);
};

module.exports = { name: 'client-billing', needs: ['foundation'], depths: ['standard'], run };
