'use strict';

/**
 * Client billing: the contract with the client and the money it brings in.
 *
 *   prime contract (client, terms, an established value)
 *   -> approved allocations with approved progress (the certification cap)
 *   -> the advance the client pays up front
 *   -> IPC periods: items, adjustments, submit, certify, invoice, payments,
 *      retention release — left in every state the workflow has
 *   -> a client variation (change order with allocation links and evidence,
 *      approved) that raises what may be certified, sometimes a second one
 *      left undecided
 *   -> statement, receivables, cash flow (manual forecast entries)
 *
 * Certification is capped at approved progress on each allocation, so the
 * driver first makes sure a few allocations are approved and their activities
 * carry approved progress (percent-measured activities only; evidence is
 * attached where the activity asks for it), then shares the headroom out over
 * the periods it raises.
 *
 * The periods a first run leaves, oldest first, one per month and never one
 * after the current month: paid (one to three; the first also has retention
 * released, half the time with the released sum still owed), part-paid (with
 * a deduction), invoiced (with stored materials and a signed copy attached),
 * certified, in three projects in four one certified over the cap by the PM's
 * override, submitted, draft. Where the company has no finance officer
 * nobody may record a client payment or release retention (both are
 * finance's alone; the owner standing in is a PM), so the periods that would
 * be paid are left invoiced and a note says so.
 *
 * Runs. A run writes its plan (period labels and the state each is to reach)
 * into refs.clientBilling before it acts, and marks the run finished only as
 * its last step. A run that stopped part-way (the loader runs a failed driver
 * again) is resumed: every step reads what the API already holds and does
 * only what is missing, and every unique reference is derived from the record
 * it belongs to. A run after a finished one (--redo) plans only the months
 * after the last period up to the current one; when there are none it tops
 * up instead: a further payment on account, a remark, a cash-flow forecast.
 * The advance and the variation happen once per project. No invoice,
 * payment or release is ever dated after today.
 *
 * Contract terms are set here only where nobody set them (the structure
 * driver sets them with its own variety); otherwise they are read as they
 * stand. The cash-flow projection is never rebuilt here: the product rebuilds
 * it after every client payment.
 *
 * Who does what: the QS keeps the contract and raises and submits the
 * certificates, the PM and finance certify in turn, finance invoices, records
 * the client's payments and releases retention, the cost controller keeps
 * cash flow.
 *
 * Notes: CHECK lines are places where the product's own figures disagree
 * with each other (findings, not failures). 5XX lines are server errors on a
 * step that may be refused for a legitimate reason (allocation approval,
 * progress); a server error anywhere else fails the run.
 */

const listOf = (data, ...keys) => {
  if (Array.isArray(data)) return data;
  for (const key of keys) if (Array.isArray(data?.[key])) return data[key];
  return data?.items || [];
};
const r2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const MONTH = /^\d{4}-\d{2}$/;
const addMonths = (ym, n) => {
  const [year, month] = ym.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + n, 1)).toISOString().slice(0, 7);
};
const addDays = (date, n) => new Date(Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monthsFrom = (from, to) => {
  const out = [];
  for (let month = from; month <= to; month = addMonths(month, 1)) out.push(month);
  return out;
};

const ESTABLISHED = ['project_value', 'contract_entry'];
const OPEN_STATES = ['draft', 'submitted'];
const CERTIFIED_STATES = ['certified', 'paid'];
const BILLED = ['invoiced', 'part_paid', 'paid'];
const OVERRIDE_REFUSALS = ['IPC_PM_OVERRIDE_REASON_REQUIRED', 'IPC_PM_OVERRIDE_REQUIRED'];
/** What one cycle of periods ends in, oldest first (extra paid periods go in front, the override twin after "certified"). */
const CYCLE = ['paid', 'part_paid', 'invoiced', 'certified', 'submitted', 'draft'];
/** The shape of refs.clientBilling this file writes (the first version kept no plan). */
const STATE_VERSION = 2;

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
  // payment.record and retention.release are finance's alone (shared/permissions.json):
  // where the owner stands in for finance, nobody here may do either.
  const hasFinance = ctx.hasPersona('finance');
  const { today } = ctx;
  const thisMonth = today.slice(0, 7);
  const upToToday = (date) => (date > today ? today : date);
  const projectTag = ctx.project.canary;
  const routeOf = (label) => `${P}/ipc/${encodeURIComponent(label)}`;

  /**
   * A step that may be refused for a legitimate reason: a refusal becomes a
   * note. A server error is not a refusal: it is noted as 5XX so it stands out
   * from the refusals (the core records are never asked through here, so a
   * server error on one of them fails the run).
   */
  const attempt = (label, fn) =>
    ctx.attempt(label, async () => {
      try {
        return await fn();
      } catch (error) {
        if (Number(error?.status) >= 500) {
          ctx.note(`5XX ${label}: ${error.status} ${error.code} ${error.serverMessage}`.slice(0, 300));
          return null;
        }
        throw error;
      }
    });

  // ── what earlier runs left ──────────────────────────────────────────────
  const state = (ctx.refs.clientBilling = ctx.refs.clientBilling || { run: 0 });
  if (state.version !== STATE_VERSION) {
    // Written by the first version of this driver, which kept no plan to resume: its runs are taken as finished.
    state.completedRun = state.run || 0;
    state.version = STATE_VERSION;
  }
  state.allocationIds = state.allocationIds || [];
  state.periods = state.periods || {};
  state.changeOrders = state.changeOrders || [];
  state.plans = state.plans || {};
  const resuming = (state.run || 0) > (state.completedRun || 0);
  if (!resuming) state.run = (state.run || 0) + 1;
  const R = `R${state.run}`;
  // The canary of a record, with the run: unique across runs.
  const mark = (type) => `${ctx.canary(type)}-${R}`;
  const recordOnce = (type, id) => {
    if (id && !(ctx.records[type] || []).includes(id)) ctx.record(type, id);
    return id;
  };
  const totals = { certified: 0, retention: 0, net: 0, invoiced: 0, paid: 0, released: 0, advance: 0 };
  if (resuming) ctx.note(`run ${state.run} resumed: the last run stopped before it finished`);
  if (!hasFinance) {
    ctx.note('no finance officer: client payments and retention releases are finance-only (payment.record, retention.release) and the owner standing in is refused them, so the periods that would be paid are left invoiced');
  }

  // ── 1. the prime contract: a client, terms, an established value ─────────
  let contract = await qs.GET(`${P}/prime-contract`);
  recordOnce('prime_contract', contract.id);
  if (!ESTABLISHED.includes(contract.originalValueSource)) {
    // The value is the BOQ's total nobody confirmed: certifying and the advance wait for it.
    contract = await qs.PATCH(`${P}/prime-contract`, { confirmOriginalValue: true });
    ctx.note(`contract value: the unconfirmed ${contract.originalValue} (BOQ total) confirmed as the contract's`);
  }
  if (!ctx.refs.primeContract && !state.termsSet) {
    // Nobody set the terms (the structure driver did not run here): this driver sets them, once.
    const tag = mark('prime_contract');
    contract = await qs.PATCH(`${P}/prime-contract`, {
      title: `${ctx.project.name} client contract ${tag}`.slice(0, 200),
      notes: `Payment terms as the signed agreement; retention and advance per the particular conditions. ${tag}`,
      status: 'active',
      ...(ctx.companyRefs.directory?.client ? { clientCompanyId: ctx.companyRefs.directory.client } : {}),
      paymentTermsDays: rng.pick([30, 45, 60]),
      retentionRate: rng.pick([5, 7.5, 10]),
      retentionCapRate: rng.pick([null, 5, 10]),
      advanceRate: rng.pick([0, 5, 10, 10]),
      advanceRecoveryRate: rng.pick([10, 15, 20]),
      materialsOnSiteRate: rng.pick([70, 80, 100]),
      taxRate: rng.pick([0, 0, 5, 15]),
    });
    // The structure driver reads this to know the terms are set: run here later, it would otherwise
    // replace them under certificates already worked out with these.
    ctx.refs.primeContract = contract.id;
  }
  state.termsSet = true;
  state.contractId = contract.id;
  const retentionRate = Number(contract.retentionRate) || 0;

  // ── 2. this run's plan ───────────────────────────────────────────────────
  const certificates = async () => listOf(await qs.GET(`${P}/ipc`));
  const rowOf = async (label) => (await certificates()).find((row) => row.period === label) || null;
  const detailOf = async (label) => ((await rowOf(label)) ? qs.GET(routeOf(label)) : null);
  const claimedOn = (detail) => r2((detail?.items || []).reduce((sum, item) => sum + Number(item.currentCert || 0), 0));
  const planEntry = (label, shape) => ({
    label,
    shape,
    // Without a finance officer nothing can be paid: those periods stop at the invoice.
    target: !hasFinance && (shape === 'paid' || shape === 'part_paid') ? 'invoiced' : shape,
  });

  // Planned once per run, before anything is raised: a run resumed after it stopped follows the same plan
  // (and one that stopped before planning plans now).
  if (!state.plans[state.run]) {
    const taken = new Set((await certificates()).map((row) => row.period));
    const months = [...taken].filter((label) => MONTH.test(label)).sort();
    let entries;
    if (!months.length) {
      // A first cycle: monthly periods back from this month, the newest still a draft.
      let extras = ctx.count(0, 2);
      const drawn = ctx.count(0, 3) > 0;
      // Three projects in four get a certificate that ends up over the cap and needs the PM's override
      // (CERT_BILLING_OVERRIDE=1 or 0 decides it for every project of a run).
      const withOverride = ['0', '1'].includes(process.env.CERT_BILLING_OVERRIDE) ? process.env.CERT_BILLING_OVERRIDE === '1' : drawn;
      const cycle = [...CYCLE];
      if (withOverride) cycle.splice(cycle.indexOf('certified') + 1, 0, 'override');
      // No period before the project started, where that can be helped: extra paid periods go first.
      const start = String(ctx.project.startDate || '').slice(0, 7);
      const room = MONTH.test(start) && start <= thisMonth ? monthsFrom(start, thisMonth).length : Infinity;
      extras = Math.max(0, Math.min(extras, room - cycle.length));
      if (cycle.length > room && withOverride) cycle.splice(cycle.indexOf('override'), 1);
      if (cycle.length + extras > room) ctx.note(`the project started ${start}: ${cycle.length + extras - room} period(s) fall before its start month`);
      const shapes = [...Array(extras).fill('paid'), ...cycle];
      entries = shapes.map((shape, i) => planEntry(addMonths(thisMonth, i - (shapes.length - 1)), shape));
    } else {
      // A later run: the months after the last period, up to this one — the tail of a cycle.
      const fresh = monthsFrom(addMonths(months[months.length - 1], 1), thisMonth).filter((month) => !taken.has(month));
      const shapes = fresh.length > CYCLE.length ? [...Array(fresh.length - CYCLE.length).fill('paid'), ...CYCLE] : CYCLE.slice(CYCLE.length - fresh.length);
      entries = fresh.map((label, i) => planEntry(label, shapes[i]));
    }
    state.plans[state.run] = entries;
  }
  const plan = state.plans[state.run] || [];
  const claiming = plan.length > 0;
  ctx.note(`run ${state.run} plan: ${plan.length ? plan.map((entry) => `${entry.label}=${entry.target}`).join(' ') : 'no month without a period up to this one; a top-up run'}`);

  // ── 3. allocations to bill against: approved, with approved progress ─────
  const allocationRows = listOf(await qs.GET(`${P}/activity-boq-allocations`), 'allocations');
  const allocationById = new Map(allocationRows.map((row) => [row.id, row]));
  const activities = listOf(await planner.GET(`${P}/activities`), 'activities');
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  const methodOf = (activity) => activity?.progressMethodConfig?.method || activity?.progressMethod || 'percent';
  const approvedPct = (activity) => (activity?.approvedProgressUpdatedAt ? Number(activity.pctComplete) || 0 : 0);
  // Usable: a live allocation nobody rejected, on an activity whose progress can be claimed as a
  // percentage, or that already carries approved progress worth billing whatever its method.
  const usable = (entry) => {
    const row = allocationById.get(entry.id);
    const activity = row && activityById.get(row.activityId);
    if (!row || row.isActive === false || !['draft', 'submitted', 'approved'].includes(row.status) || !activity) return false;
    return methodOf(activity) === 'percent' || approvedPct(activity) >= 10;
  };
  const groups = Object.values(ctx.refs.allocations || {}).filter((group) => group.length);
  const known = (groups.length ? groups : allocationRows.map((row) => [{ id: row.id }]))
    .map((group) => group.filter(usable))
    .filter((group) => group.length);
  if (state.allocationsRun !== state.run) {
    if (!state.allocationIds.length) {
      // A bill row split over two activities first (a variation on one half is where the cap is interesting), then others.
      const split = known.find((group) => group.length > 1);
      const singles = rng.shuffle(known.filter((group) => group !== split)).flat();
      const want = Math.max(ctx.count(3, 6), split ? split.length + 1 : 1);
      state.allocationIds = [...(split || []), ...singles].slice(0, want).map((entry) => entry.id);
      if (split) state.splitAllocationIds = split.map((entry) => entry.id);
    } else if (claiming) {
      // A later run with periods to fill bills one more allocation, so there is something new to certify.
      const next = known.flat().find((entry) => !state.allocationIds.includes(entry.id));
      if (next) state.allocationIds.push(next.id);
    }
    state.allocationsRun = state.run;
  }
  const billable = [];
  for (const id of state.allocationIds) {
    let row = allocationById.get(id);
    if (!row || row.isActive === false) continue;
    if (row.status === 'draft') {
      row = (await attempt(`allocation ${id} submit`, () => planner.POST(`${P}/activity-boq-allocations/${id}/submit`))) || row;
    }
    if (row.status === 'submitted') {
      row = (await attempt(`allocation ${id} approve`, () => qs.POST(`${P}/activity-boq-allocations/${id}/approve`))) || row;
    }
    if (row.status === 'approved') billable.push(row);
  }
  if (!billable.length) throw new Error('client-billing: no allocation could be approved to bill against');

  // Approved progress: on a first run, wherever there is next to none; on a later run with periods
  // to fill, a little more. Percent-measured activities only: the others are measured by quantity,
  // milestones or inspection, which is the progress driver's to claim.
  if (claiming && state.progressRun !== state.run) {
    for (const activityId of new Set(billable.map((row) => row.activityId))) {
      const activity = activityById.get(activityId);
      const code = activity?.activityCode || activityId;
      const approved = approvedPct(activity);
      let target = null;
      if (approved < 10) target = rng.int(30, 70);
      else if (state.run > 1 && approved < 100) target = Math.min(100, Math.round(approved) + rng.int(5, 15));
      if (target === null) continue;
      if (methodOf(activity) !== 'percent') {
        ctx.note(`progress on ${code}: measured by ${methodOf(activity)}, so no percentage is claimed here; its approved ${approved}% stands`);
        continue;
      }
      const evidenceRequired = Boolean(activity?.progressMethodConfig?.evidenceRequired);
      await attempt(`progress on ${code}`, async () => {
        const claimed = await site.POST(`${P}/activities/${activityId}/progress`, {
          pctComplete: target,
          progressMethod: 'percent',
          status: 'submitted',
          source: 'manual',
          notes: `Measured on site for the client valuation. ${mark('progress_submission')}`,
          // The activity asks for evidence: the joint measurement sheet is named.
          ...(evidenceRequired ? { evidence: { measurementSheet: mark('progress_evidence'), method: "joint measurement with the client's QS" } } : {}),
        });
        const submissionId = claimed?.submission?.id;
        if (!submissionId) throw new Error(`client-billing: progress on ${code} answered without a submission id (${Object.keys(claimed || {}).join(',')})`);
        ctx.record('progress_submission', submissionId);
        // A refusal here (an ITP hold point open on the activity) leaves the claim pending.
        await planner.POST(`${P}/activities/${activityId}/progress-submissions/${submissionId}/approve`);
      });
    }
    state.progressRun = state.run;
  }

  // ── 4. the advance: part of what was agreed, paid up front, once ─────────
  const advanceAgreed = Number(contract.advanceAmount) || 0;
  if (advanceAgreed > 1 && !(Number(contract.advancePaidAmount) > 0)) {
    const amount = r2(advanceAgreed * rng.pick([0.4, 0.5, 0.6]));
    const before = listOf(await finance.GET(`${P}/prime-contract/advances`));
    const reference = `${projectTag}-ADV-${before.filter((row) => row.kind === 'payment').length + 1}`;
    const received = ctx.project.startDate ? addDays(ctx.project.startDate, rng.int(7, 30)) : ctx.daysAgo(rng.int(100, 160));
    contract = await finance.POST(`${P}/prime-contract/advances`, {
      amount,
      reference,
      occurredAt: upToToday(received),
      note: `Advance received against the advance payment guarantee. ${mark('prime_contract_advance')}`,
    });
    totals.advance = amount;
    const row = listOf(await finance.GET(`${P}/prime-contract/advances`)).find((entry) => entry.reference === reference);
    if (!row) throw new Error(`client-billing: the advance receipt ${reference} is not in the advance ledger`);
    recordOnce('prime_contract_advance', row.id);
  }

  // ── 5. the client variation: once per project ────────────────────────────
  const approvedVariation = () => state.changeOrders.find((order) => order.status === 'approved' && order.kind !== 'pending') || null;
  const raiseVariation = async () => {
    if (approvedVariation()) return;
    let order = state.changeOrders.find((entry) => entry.kind === 'variation');
    // One half of a split bill row where there is one; a resumed run keeps the allocation it chose.
    const target =
      (order && billable.find((row) => row.id === order.allocationId)) ||
      billable.find((row) => (state.splitAllocationIds || []).includes(row.id)) ||
      billable[0];
    const unitRate = Number(target.quantity) > 0 ? r2(Number(target.amount) / Number(target.quantity)) : 0;
    const body = (tag, quantity) => {
      const value = r2(quantity * unitRate);
      return {
        description: `Client variation: additional quantity instructed on site. ${tag}`,
        category: 'client_variation',
        activityId: target.activityId,
        budgetLineId: Object.values(ctx.refs.budgetLines || {})[0] || undefined,
        value,
        scheduleImpact: 0,
        scheduleImpactSummary: `No effect on completion; the added quantity is absorbed in the activity's duration. ${tag}`,
        costImpactSummary: `${quantity} more at the bill rate ${unitRate} = ${value}. ${tag}`,
        activityLinks: [{ activityId: target.activityId, relationType: 'impacted', scheduleImpactDays: 0, costImpact: value, notes: tag }],
        allocationLinks: [{ allocationId: target.id, quantity, amount: value, notes: tag }],
      };
    };
    if (!order) {
      const quantity = Math.max(1, Math.round(Number(target.quantity) * 0.05));
      if (!(unitRate > 0)) throw new Error(`client-billing: allocation ${target.id} has no rate to price a variation at`);
      const tag = mark('change_order');
      const created = await qs.POST(`${P}/change-orders`, body(tag, quantity));
      ctx.record('change_order', created.id);
      order = { kind: 'variation', id: created.id, ref: created.ref || null, allocationId: target.id, quantity, amount: r2(quantity * unitRate), status: 'draft', tag };
      state.changeOrders.push(order);
    }
    if (!order.documentId) {
      // The client's instruction, attached and cited: approval needs a supporting document.
      const fileTag = mark('attachment');
      const attached = await qs.upload('POST', `${P}/attachments`, {
        field: 'files',
        filename: `${fileTag}-client-instruction.pdf`,
        contentType: 'application/pdf',
        body: pdf(`Client instruction for variation ${order.ref || ''} ${fileTag}`),
        fields: { recordType: 'change_order', recordId: order.id, caption: `Client instruction ${fileTag}`, clientRequestId: `${projectTag}-CO-${order.id}` },
      });
      const file = listOf(attached, 'attachments')[0];
      if (!file?.id || !file.documentId) throw new Error('client-billing: the variation evidence upload answered without an attachment and a document id');
      recordOnce('attachment', file.id);
      recordOnce('project_document', file.documentId);
      await qs.PATCH(`${P}/change-orders/${order.id}`, { documentIds: [file.documentId] });
      order.documentId = file.documentId;
    }
    const current = listOf(await qs.GET(`${P}/change-orders`), 'orders').find((row) => row.id === order.id);
    if (!current) throw new Error(`client-billing: change order ${order.id} is not in the register`);
    if (current.status === 'draft') await qs.POST(`${P}/change-orders/${order.id}/submit`, { comment: `For the client's approval. ${order.tag || mark('change_order')}` });
    if (['draft', 'pending'].includes(current.status)) {
      await pm.POST(`${P}/change-orders/${order.id}/approve`, { comment: `Approved under the client's instruction. ${order.tag || mark('change_order')}` });
    } else if (current.status !== 'approved') {
      throw new Error(`client-billing: the variation ${order.id} is ${current.status}, not approvable`);
    }
    order.status = 'approved';
    // What the approval wrote: a budget revision and the change on the budget line.
    for (const row of listOf(await cost.GET(`${P}/budget-revisions`), 'rows')) if (row.linkedChangeOrder === order.id) recordOnce('budget_revision', row.id);
    for (const line of listOf(await cost.GET(`${P}/budget/lines`), 'lines')) {
      for (const change of line.changes || []) if (change.changeOrderId === order.id) recordOnce('budget_line_change', change.id);
    }
    // Half the time a second one is left undecided: a pending variation must not raise what may be certified.
    if (state.pendingVariation === undefined) state.pendingVariation = Boolean(ctx.count(0, 1));
    if (state.pendingVariation && !state.changeOrders.some((entry) => entry.kind === 'pending')) {
      const quantity = Math.max(1, Math.round(order.quantity / 2));
      const pending = await qs.POST(`${P}/change-orders`, body(`${mark('change_order')} pending`, quantity));
      ctx.record('change_order', pending.id);
      state.changeOrders.push({ kind: 'pending', id: pending.id, allocationId: order.allocationId, status: 'draft' });
    }
    const before = contract;
    contract = await qs.GET(`${P}/prime-contract`);
    ctx.note(`variation ${current.ref || order.id}: ${order.amount} approved; contract approved changes ${before.approvedChangesValue} -> ${contract.approvedChangesValue}, pending ${contract.pendingChangesValue}`);
  };

  // ── 6. the periods ───────────────────────────────────────────────────────
  // Oldest first, so the paid ones are the early months and the open ones the latest. What an open
  // period claims is held back from a later one, so two periods never claim the same headroom.
  const maxItems = ctx.count(2, 5);
  const firstPaid = plan.findIndex((entry) => entry.target === 'paid');

  const reservedBy = async (except) => {
    const reserved = new Map();
    for (const row of await certificates()) {
      if (!OPEN_STATES.includes(row.status) || except.includes(row.period)) continue;
      for (const item of (await qs.GET(routeOf(row.period))).items || []) {
        if (item.allocationId && Number(item.currentCert) > 0) reserved.set(item.allocationId, r2((reserved.get(item.allocationId) || 0) + Number(item.currentCert)));
      }
    }
    return reserved;
  };

  /** Opens a period (or takes up the draft a stopped run left): one item per approved allocation, with what approved progress earned and nobody certified. */
  const open = async (label, { except = [] } = {}) => {
    const reserved = await reservedBy([label, ...except]);
    const certificate = (await rowOf(label)) ? await qs.GET(routeOf(label)) : await qs.POST(`${P}/ipc`, { period: label });
    recordOnce('ipc_certificate', certificate.id);
    for (const item of certificate.items || []) recordOnce('ipc_item', item.id);
    state.periods[label] = { ...(state.periods[label] || {}), id: certificate.id, run: state.run };
    const candidates = (certificate.items || [])
      .map((item) => {
        // "uncertified": what approved progress has earned and no certified period has taken.
        // "headroom": the same, less what the other open periods already claim.
        const uncertified = r2(Number(item.certificationReview?.earnedAmount || 0) - Number(item.previousCert || 0));
        return { item, uncertified, headroom: r2(uncertified - (reserved.get(item.allocationId) || 0)) };
      })
      .filter((entry) => entry.item.allocationId && Number(entry.item.rate) > 0 && entry.headroom > Number(entry.item.rate) * 0.01)
      .sort((a, b) => String(a.item.allocationId).localeCompare(String(b.item.allocationId)));
    return { label, route: routeOf(label), certificate, candidates, tag: mark('ipc_certificate'), claims: new Map(), claimed: 0 };
  };

  /** Certifies a quantity on one item of an open period (the contract's retention rate, not the project default the item was given). */
  const claim = async (sheet, item, qty) => {
    const updated = await qs.PATCH(`${sheet.route}/items/${item.id}`, { qty, retentionRate });
    recordOnce('ipc_item', item.id);
    const amount = Number(updated.currentCert ?? r2(qty * Number(item.rate)));
    sheet.claims.set(item.allocationId, amount);
    sheet.claimed = r2(sheet.claimed + amount);
    return amount;
  };

  const tally = (certificate) => {
    totals.certified = r2(totals.certified + Number(certificate.totalCert || 0));
    totals.retention = r2(totals.retention + Number(certificate.totalRet || 0));
    totals.net = r2(totals.net + Number(certificate.netPayable || 0));
  };

  /** Certifies a submitted period, the PM and finance in turn; over the cap (progress moved under the claim) only the PM may, with a reason. */
  const certify = async (label, ordinal) => {
    const comment = `Certified against approved progress. ${mark('ipc_certificate')}`;
    const certifier = ordinal % 2 === 1 ? finance : pm;
    try {
      return await certifier.POST(`${routeOf(label)}/certify`, { comment });
    } catch (error) {
      if (!OVERRIDE_REFUSALS.includes(error.code)) throw error;
      ctx.note(`${label}: certify as ${certifier.email} -> ${error.status} ${error.code}; certified by the PM with an override reason`);
      return pm.POST(`${routeOf(label)}/certify`, { comment, overrideReason: `PM override: certified ahead of the progress record. ${mark('ipc_certificate')}` });
    }
  };

  /**
   * The override case, set up while the period it overlaps is still a draft:
   * a second period claims what is left on one allocation plus one unit, which
   * is within the cap only until the first is certified.
   */
  const setUpTwin = async (twin, base) => {
    const info = (state.periods[twin.label] = { ...(state.periods[twin.label] || {}), run: state.run, target: 'override' });
    if (info.skipped || (await rowOf(twin.label))) return;
    // On the allocation with the least left, so the open periods that follow still have something to claim.
    const pick = (base.items || [])
      .filter((item) => item.allocationId && Number(item.rate) > 0 && Number(item.currentCert) >= Number(item.rate))
      .map((item) => ({ item, uncertified: r2(Number(item.certificationReview?.earnedAmount || 0) - Number(item.previousCert || 0)) }))
      .sort((a, b) => a.uncertified - b.uncertified)[0];
    const rate = Number(pick?.item.rate);
    const qty = pick ? Math.floor((pick.uncertified - Number(pick.item.currentCert)) / rate) + 1 : 0;
    if (!pick || qty <= 0) {
      info.skipped = true;
      ctx.note(`${twin.label}: no claim of a whole unit in ${base.period} to build the override case on; the period is not raised`);
      return;
    }
    const sheet = await open(twin.label, { except: [base.period] });
    const item = (sheet.certificate.items || []).find((entry) => entry.allocationId === pick.item.allocationId);
    if (!item) throw new Error(`client-billing: ${twin.label} has no item for allocation ${pick.item.allocationId}`);
    await claim(sheet, item, qty);
    await qs.PATCH(`${sheet.route}/adjustments`, { deductionsNote: `Valuation ${twin.label} ${sheet.tag}` });
    Object.assign(info, { id: sheet.certificate.id, claimed: true, adjusted: true });
  };

  /** The twin, once the period it overlaps is certified: over the cap by less than one unit. Finance may not certify it; the PM may, with a reason. */
  const settleTwin = async (twin) => {
    const info = (state.periods[twin.label] = { ...(state.periods[twin.label] || {}), run: state.run, target: 'override' });
    if (info.skipped) return;
    const route = routeOf(twin.label);
    let row = await rowOf(twin.label);
    if (!row) {
      // A stopped run had already submitted the period it overlaps: too late to set the case up.
      info.skipped = true;
      ctx.note(`${twin.label}: the period it overlaps was submitted before the override case was set up; the period is not raised`);
      return;
    }
    const tag = mark('ipc_certificate');
    if (row.status === 'draft') {
      await qs.POST(`${route}/submit`);
      row = await rowOf(twin.label);
    }
    if (row.status !== 'submitted') return;
    // (Where the owner stands in for finance there is nobody else to refuse: the PM certifies straight away.)
    const bare = pm.email === finance.email
      ? { status: 400, body: { error: { code: 'IPC_PM_OVERRIDE_REASON_REQUIRED' } }, skipped: true }
      : await finance.send('POST', `${route}/certify`, { comment: `Certified. ${tag}` });
    if (bare.status >= 500) throw new Error(`client-billing: certifying ${twin.label} as finance answered ${bare.status}: ${String(bare.text).slice(0, 200)}`);
    if (bare.status === 200) {
      // Something else already held part of the headroom back, so the claim stayed within the cap.
      tally(bare.body.data);
      ctx.note(`${twin.label}: stayed within the cap, certified by finance with no override`);
      return;
    }
    const reasoned = bare.skipped
      ? { status: 403 }
      : await finance.send('POST', `${route}/certify`, { comment: `Certified. ${tag}`, overrideReason: `Finance tries the override. ${tag}` });
    if (reasoned.status >= 500) throw new Error(`client-billing: certifying ${twin.label} as finance with a reason answered ${reasoned.status}: ${String(reasoned.text).slice(0, 200)}`);
    if (bare.status !== 400 || bare.body?.error?.code !== 'IPC_PM_OVERRIDE_REASON_REQUIRED' || reasoned.status !== 403) {
      ctx.note(`CHECK ${twin.label}: an over-cap certificate certified by finance answered ${bare.status} ${bare.body?.error?.code || 'ok'} without a reason and ${reasoned.status} ${reasoned.body?.error?.code || 'ok'} with one (expected 400 IPC_PM_OVERRIDE_REASON_REQUIRED, then 403)`);
    }
    const overridden =
      reasoned.status === 200
        ? reasoned.body.data
        : await pm.POST(`${route}/certify`, {
            comment: `Certified ahead of the progress record. ${tag}`,
            overrideReason: `PM override: the last lift was measured after the progress cut-off. ${tag}`,
          });
    tally(overridden);
    ctx.note(`${twin.label}: certified by PM override, over-certification ${overridden.overCertificationAmount}`);
  };

  /** Invoice, then the client's payments, then (on the first paid period) retention back. */
  const bill = async (entry, index, detail) => {
    const { label, target } = entry;
    const info = state.periods[label];
    const route = routeOf(label);
    let invoice = (detail.invoices || []).find((row) => row.status !== 'void') || null;
    const invoiceDate = invoice ? String(invoice.invoiceDate).slice(0, 10) : upToToday(`${addMonths(label, 1)}-05`);
    if (!invoice) {
      invoice = await finance.POST(`${route}/invoice/issue`, {
        invoiceNumber: `${projectTag}-IPC_INVOICE-${label}`,
        invoiceDate,
        // Some invoices state their due date, the others fall back on the contract's payment terms.
        ...(index % 2 === 0 ? { dueDate: addDays(invoiceDate, Number(contract.paymentTermsDays) || 30) } : {}),
      });
      recordOnce('ipc_invoice', invoice.id);
      totals.invoiced = r2(totals.invoiced + Number(invoice.netAmount || 0));
    }
    if (!['part_paid', 'paid'].includes(target)) return;

    let balance = Number(invoice.balanceDue ?? detail.balanceDue ?? 0);
    let paidCount = (detail.payments || []).length;
    const pay = async (amount, when, why) => {
      if (!(amount > 0)) return null;
      paidCount += 1;
      const result = await finance.POST(`${route}/payments`, {
        amount: r2(amount),
        paymentReference: `${projectTag}-IPC_PAYMENT-${label}-${paidCount}`,
        paymentDate: upToToday(when),
        paymentMethod: rng.pick(['bank_transfer', 'cheque', 'wire']),
        notes: `${why} ${mark('ipc_payment')}`,
      });
      if (!result?.payment?.id) throw new Error(`client-billing: a payment on ${label} answered without a payment id`);
      recordOnce('ipc_payment', result.payment.id);
      totals.paid = r2(totals.paid + r2(amount));
      balance = Number(result.invoice?.balanceDue ?? r2(balance - amount));
      return result;
    };

    if (target === 'part_paid') {
      if (paidCount === 0 && balance > 0) await pay(r2(balance * rng.pick([0.4, 0.5, 0.7])), addDays(invoiceDate, 20), 'Payment on account.');
      return;
    }
    const releasedBefore = (detail.retentionReleases || []).length > 0;
    if (!releasedBefore) {
      info.instalments = info.instalments || ctx.count(1, 3);
      const instalments = Math.max(info.instalments, paidCount + 1);
      for (let n = paidCount + 1; n <= instalments && balance > 0; n += 1) {
        const amount = n === instalments ? balance : r2(balance / (instalments - n + 2));
        await pay(amount, addDays(invoiceDate, 12 * n), `Instalment ${n} of ${instalments}.`);
      }
    }
    // The first paid period also gives retention back; half the time the client has paid that too.
    if (index !== firstPaid) return;
    const settled = await qs.GET(route);
    const held = Number(settled.totalRet) || 0;
    let releasedNow = false;
    if (!releasedBefore && held > 0 && Number(settled.balanceDue) <= 0.01) {
      releasedNow = true;
      info.releaseAll = info.releaseAll ?? rng.chance(0.5);
      const release = await finance.POST(`${route}/retention-release`, {
        amount: info.releaseAll ? held : r2(held / 2),
        releaseReference: `${projectTag}-IPC_RETENTION-${label}-1`,
        releaseDate: upToToday(addDays(invoiceDate, 60)),
        reason: `Released on the taking-over certificate. ${mark('ipc_retention_release')}`,
      });
      if (!release?.release?.id) throw new Error(`client-billing: the retention release on ${label} answered without a release id`);
      recordOnce('ipc_retention_release', release.release.id);
      totals.released = r2(totals.released + Number(release.release.amount || 0));
      const after = release.certificate || {};
      if (after.status === 'paid' && after.paymentStatus !== 'paid') {
        ctx.note(`CHECK ${label}: after a retention release the certificate reads status=${after.status} with paymentStatus=${after.paymentStatus}, balanceDue=${after.balanceDue}`);
      }
      balance = Number(release.invoice?.balanceDue || 0);
    } else if (releasedBefore) {
      balance = Number(settled.balanceDue || 0);
    }
    if (releasedBefore || releasedNow) {
      info.repay = info.repay ?? rng.chance(0.5);
      if (info.repay && balance > 0) await pay(balance, addDays(invoiceDate, 75), 'Retention released and paid.');
    }
  };

  /** Moves one planned period to the state it is to reach, doing only what the API does not already hold. */
  const drive = async (entry, index) => {
    const { label, target, shape } = entry;
    if (target === 'override') return; // driven with the period it overlaps
    const info = (state.periods[label] = { ...(state.periods[label] || {}), run: state.run, target });
    // The variation lands once the early periods are settled, so a later certificate is measured against it.
    if (target === 'certified') await raiseVariation();
    const variation = approvedVariation();

    let detail = await detailOf(label);
    if (!detail || (detail.status === 'draft' && !info.claimed)) {
      const sheet = await open(label);
      if (index === 0 && state.run === 1) {
        const defaults = [...new Set((sheet.certificate.items || []).map((item) => Number(item.retentionRate)))];
        if (defaults.some((rate) => rate !== retentionRate)) {
          ctx.note(`CHECK retention: a new certificate's items carry ${defaults.join('/')}% (the project default) while the contract's retention rate is ${retentionRate}%`);
        }
      }
      // Which items this period bills: a different few each time, the variation's allocation first once it exists.
      const remaining = plan.slice(index).filter((later) => later.target !== 'override').length || 1;
      const ordered = sheet.candidates.map((_, i) => sheet.candidates[(i + index * maxItems) % sheet.candidates.length]);
      if (target === 'certified' && variation) ordered.sort((a, b) => Number(b.item.allocationId === variation.allocationId) - Number(a.item.allocationId === variation.allocationId));
      for (const candidate of ordered.slice(0, maxItems)) {
        const rate = Number(candidate.item.rate);
        const share = (candidate.headroom / (remaining + 0.5)) * (0.75 + rng.next() * 0.25);
        let qty = Math.floor(share / rate);
        if (qty < 1) qty = Math.floor((share / rate) * 100) / 100;
        if (qty > 0) await claim(sheet, candidate.item, qty);
      }
      if (sheet.claimed <= 0) ctx.note(`${label}: nothing left to certify (approved progress is fully certified), the period carries no claim`);
      info.claimed = true;
      detail = await qs.GET(routeOf(label));
    }
    info.id = detail.id;
    const route = routeOf(label);
    const tag = mark('ipc_certificate');

    // Adjustments: every certificate carries a note; one a deduction, one stored materials.
    if (OPEN_STATES.includes(detail.status) && !info.adjusted) {
      const claimed = claimedOn(detail);
      const adjustments = { deductionsNote: `Valuation ${label} ${tag}` };
      if (shape === 'part_paid' && claimed > 200) {
        adjustments.deductions = r2(Math.min(claimed * 0.02, 5000));
        adjustments.deductionsNote = `Contra charge for client-supplied testing. ${tag}`;
      }
      if (shape === 'invoiced' && claimed > 0) {
        const atCost = r2(Math.min(claimed * 0.1, 20000));
        adjustments.materialsAtCost = atCost;
        adjustments.materialsOnSite = r2(atCost * ((Number(contract.materialsOnSiteRate) || 100) / 100));
      }
      await qs.PATCH(`${route}/adjustments`, adjustments);
      info.adjusted = true;
    }

    const twin = plan[index + 1]?.target === 'override' ? plan[index + 1] : null;
    if (twin && detail.status === 'draft') await setUpTwin(twin, detail);

    if (detail.status === 'draft' && target !== 'draft') {
      await qs.POST(`${route}/submit`);
      detail.status = 'submitted';
    }
    if (detail.status === 'submitted' && !OPEN_STATES.includes(target)) {
      const ordinal = plan.slice(0, index).filter((earlier) => !OPEN_STATES.includes(earlier.target) && earlier.target !== 'override').length;
      tally(await certify(label, ordinal));
    }
    if (twin) await settleTwin(twin);

    detail = await qs.GET(route);
    if (BILLED.includes(target)) await bill(entry, index, detail);

    // A remark on every other certificate, and on the invoiced one its signed copy.
    if (index % 2 === 0 && !info.commented) {
      const comment = await qs.POST(`${P}/comments`, {
        recordType: 'ipc_certificate',
        recordId: detail.id,
        body: `Measured with the client's QS on site; quantities agreed. ${mark('comment')}`,
      });
      if (!comment?.id) throw new Error(`client-billing: the comment on ${label} answered without an id`);
      ctx.record('comment', comment.id);
      info.commented = true;
    }
    if (shape === 'invoiced' && !info.copied) {
      const fileTag = mark('attachment');
      const attached = await qs.upload('POST', `${P}/attachments`, {
        field: 'files',
        filename: `${fileTag}-certificate-${label}.pdf`,
        contentType: 'application/pdf',
        body: pdf(`Payment certificate ${label} signed copy ${fileTag}`),
        fields: { recordType: 'ipc_certificate', recordId: detail.id, caption: `Signed certificate ${label} ${fileTag}`, clientRequestId: `${projectTag}-IPC_COPY-${label}` },
      });
      const files = listOf(attached, 'attachments');
      if (!files.length) throw new Error(`client-billing: the signed copy of ${label} answered without an attachment`);
      for (const file of files) {
        recordOnce('attachment', file.id);
        if (file.documentId) recordOnce('project_document', file.documentId);
      }
      info.copied = true;
    }

    // After the variation: the certificate's review says how far each allocation's limit was raised.
    if (target === 'certified' && variation && !info.variationChecked) {
      const others = (detail.items || []).filter((item) => Number(item.certificationReview?.approvedVariationAmount) > 0 && item.allocationId !== variation.allocationId);
      if (others.length) {
        ctx.note(`CHECK variation: ${variation.amount} was linked to one allocation, yet the limit of ${others.length} other allocation(s) of the same BOQ row is raised by it too (${others.map((item) => `${item.boqItem?.code}: +${item.certificationReview.approvedVariationAmount}`).join(', ')})`);
      }
      info.variationChecked = true;
    }
  };

  for (const [index, entry] of plan.entries()) await drive(entry, index);
  // A project whose plan had no certified period this run (a later run) still gets its one variation.
  await raiseVariation();

  // ── 7. a run with no month to fill tops up instead ───────────────────────
  if (!claiming) {
    // Each step once per run, so a run resumed after it stopped does not pay or remark twice.
    const topUp = (state.topUp = state.topUp?.run === state.run ? state.topUp : { run: state.run });
    const mine = (await certificates()).filter((row) => state.periods[row.period]);
    if (hasFinance && !topUp.paid) {
      // The client pays a little more against the oldest certificate still part-paid.
      const owing = mine
        .filter((row) => row.status === 'certified' && row.paymentStatus === 'partially_paid' && Number(row.balanceDue) > 1)
        .sort((a, b) => String(a.period).localeCompare(String(b.period)))[0];
      if (owing) {
        const detail = await qs.GET(routeOf(owing.period));
        const amount = r2(Number(owing.balanceDue) * 0.3);
        const result = await finance.POST(`${routeOf(owing.period)}/payments`, {
          amount,
          paymentReference: `${projectTag}-IPC_PAYMENT-${owing.period}-${(detail.payments || []).length + 1}`,
          paymentDate: today,
          paymentMethod: rng.pick(['bank_transfer', 'cheque', 'wire']),
          notes: `Further payment on account. ${mark('ipc_payment')}`,
        });
        if (!result?.payment?.id) throw new Error(`client-billing: a payment on ${owing.period} answered without a payment id`);
        recordOnce('ipc_payment', result.payment.id);
        totals.paid = r2(totals.paid + amount);
      } else {
        ctx.note('top-up: no part-paid certificate left to pay on account');
      }
      topUp.paid = true;
    }
    const newest = mine.sort((a, b) => String(b.period).localeCompare(String(a.period)))[0];
    if (newest && !topUp.remarked) {
      const comment = await qs.POST(`${P}/comments`, {
        recordType: 'ipc_certificate',
        recordId: newest.id,
        body: `Followed up with the client's QS: the valuation figures stand. ${mark('comment')}`,
      });
      if (!comment?.id) throw new Error(`client-billing: the comment on ${newest.period} answered without an id`);
      ctx.record('comment', comment.id);
      topUp.remarked = true;
    }
  }

  // ── 8. every record of the area this driver made, recorded ───────────────
  // The certificates with their items, invoices, payments and releases (a stopped run's included),
  // and the advance ledger: the receipts and the recovery each certificate took.
  const finalList = await certificates();
  for (const row of finalList) {
    if (!state.periods[row.period]) continue;
    const detail = await qs.GET(routeOf(row.period));
    recordOnce('ipc_certificate', detail.id);
    for (const item of detail.items || []) recordOnce('ipc_item', item.id);
    for (const invoice of detail.invoices || []) recordOnce('ipc_invoice', invoice.id);
    for (const payment of detail.payments || []) recordOnce('ipc_payment', payment.id);
    for (const release of detail.retentionReleases || []) recordOnce('ipc_retention_release', release.id);
  }
  for (const row of listOf(await finance.GET(`${P}/prime-contract/advances`))) recordOnce('prime_contract_advance', row.id);

  // ── 9. what the client owes: statement, receivables, cash flow ───────────
  const statement = await qs.GET(`${P}/prime-contract/statement`);
  const receivables = await finance.GET(`${P}/prime-contract/receivables`);
  const lastCertified = finalList.filter((row) => state.periods[row.period] && CERTIFIED_STATES.includes(row.status)).map((row) => row.period).sort().pop();
  if (lastCertified) await qs.GET(`${P}/prime-contract/statement?period=${encodeURIComponent(lastCertified)}`);
  if (r2(statement.summary?.invoiced) !== r2(receivables.invoiced) || r2(statement.summary?.outstanding) !== r2(receivables.outstanding)) {
    ctx.note(`CHECK statement vs receivables: statement invoiced ${statement.summary?.invoiced} received ${statement.summary?.received} outstanding ${statement.summary?.outstanding}; receivables invoiced ${receivables.invoiced} received ${receivables.received} outstanding ${receivables.outstanding}`);
  }
  const flowBefore = await cost.GET(`${P}/cash-flow`);
  const systemInflow = r2((flowBefore.rows || []).filter((row) => row.source === 'system').reduce((sum, row) => sum + Number(row.inflow || 0), 0));
  if (systemInflow !== r2(receivables.received)) {
    ctx.note(`CHECK cash flow: the projection shows inflow ${systemInflow} while ${receivables.received} has been received`);
  }
  // Forecast receipts and spend for the months ahead (a forecast, so after this month), each run after
  // the forecasts of the runs before; counted as they are made, so a resumed run does not repeat them.
  const forecast = (state.forecast = state.forecast?.run === state.run ? state.forecast : { run: state.run, wanted: state.run === 1 ? ctx.count(1, 3) : 1, made: 0 });
  while (forecast.made < forecast.wanted) {
    const period = state.forecastMonth && state.forecastMonth >= thisMonth ? addMonths(state.forecastMonth, 1) : addMonths(thisMonth, 1);
    const row = await cost.POST(`${P}/cash-flow`, {
      period,
      inflow: rng.int(20, 400) * 1000,
      outflow: rng.int(10, 300) * 1000,
      note: `Forecast receipt and spend. ${mark('cash_flow_entry')}`,
    });
    ctx.record('cash_flow_entry', row.id);
    state.forecastMonth = period;
    forecast.made += 1;
  }
  if (!forecast.mistakeTakenBack) {
    // One entered by mistake and taken back, so the delete is exercised too (this run's own row only).
    const mistaken = await cost.POST(`${P}/cash-flow`, { period: addMonths(state.forecastMonth, 6), inflow: 1, outflow: 0, note: `Entered in error. ${mark('cash_flow_entry')}` });
    try {
      await cost.DELETE(`${P}/cash-flow/${mistaken.id}`);
    } catch (error) {
      ctx.record('cash_flow_entry', mistaken.id);
      throw error;
    }
    forecast.mistakeTakenBack = true;
  }
  const flow = await cost.GET(`${P}/cash-flow`);
  ctx.note(`cash flow: inflow ${flow.summary?.inflow} outflow ${flow.summary?.outflow} net ${flow.summary?.net}; ${(flow.rows || []).filter((row) => row.source === 'manual').length} manual entries`);

  // ── 10. the run did what it set out to do ────────────────────────────────
  const describe = (row) => {
    if (OPEN_STATES.includes(row.status)) return row.status;
    let text = row.invoiceStatus !== 'issued' ? 'certified' : !(Number(row.amountPaid) > 0) ? 'invoiced' : Number(row.amountPaid) >= Number(row.netPayable) - 0.01 ? 'paid' : 'part_paid';
    if (state.periods[row.period]?.target === 'override') text += '_override';
    if (Number(row.retentionReleased) > 0) text += Number(row.balanceDue) > 0.01 ? '_retention_released_owed' : '_retention_released';
    return text;
  };
  const reached = (row, target) => {
    if (OPEN_STATES.includes(target)) return row.status === target;
    if (!CERTIFIED_STATES.includes(row.status)) return false;
    if (target === 'certified' || target === 'override') return true;
    if (row.invoiceStatus !== 'issued') return false;
    if (target === 'invoiced') return true;
    if (target === 'part_paid') return Number(row.amountPaid) > 0;
    return Number(row.amountPaid) >= Number(row.netPayable) - 0.01;
  };
  for (const row of finalList) if (state.periods[row.period]) state.periods[row.period].state = describe(row);
  const mine = finalList.filter((row) => state.periods[row.period]);
  if (!mine.some((row) => CERTIFIED_STATES.includes(row.status) && Number(row.totalCert) > 0)) {
    throw new Error('client-billing: nothing is certified in this project — no allocation of it has approved progress to bill against');
  }
  for (const entry of plan) {
    if (state.periods[entry.label]?.skipped) continue;
    const row = finalList.find((candidate) => candidate.period === entry.label);
    if (!row) throw new Error(`client-billing: period ${entry.label} was planned (${entry.target}) and does not exist`);
    if (!reached(row, entry.target)) {
      throw new Error(`client-billing: period ${entry.label} should be ${entry.target} and is ${row.status}/${row.invoiceStatus}/${row.paymentStatus}`);
    }
  }
  const finalContract = await qs.GET(`${P}/prime-contract`);
  if (Number(finalContract.advanceAmount) > 1 && !(Number(finalContract.advancePaidAmount) > 0)) {
    throw new Error(`client-billing: an advance of ${finalContract.advanceAmount} is agreed and none has been received`);
  }
  if (!approvedVariation()) throw new Error('client-billing: the client variation was not approved');

  const states = plan.map((entry) => `${entry.label}=${state.periods[entry.label]?.skipped ? 'not raised' : state.periods[entry.label]?.state}`).join(' ');
  if (plan.length) ctx.note(`run ${state.run}: ${states}`);
  ctx.note(`run ${state.run} totals: certified ${totals.certified} (retention ${totals.retention}, net ${totals.net}), invoiced ${totals.invoiced}, paid ${totals.paid}, retention released ${totals.released}, advance received ${totals.advance}`);
  ctx.note(`project to date: receivables invoiced ${receivables.invoiced}, received ${receivables.received}, outstanding ${receivables.outstanding}, overdue ${receivables.overdue}; cumulative certified ${statement.summary?.cumulativeCertified}`);
  state.completedRun = state.run;
};

module.exports = { name: 'client-billing', needs: ['foundation'], depths: ['standard'], run };
