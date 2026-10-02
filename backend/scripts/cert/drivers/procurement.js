'use strict';

/**
 * Procurement: who the project buys from, what it asks them to price, what it
 * orders, and what it is billed for.
 *
 *   company (once)   vendors in the directory and their prequalification, left
 *                    approved / conditionally approved / rejected / reopened /
 *                    under review / draft; one central receiving store when the
 *                    company has no warehouse a delivery could go to
 *   project          suppliers (from the directory and by name, in every status)
 *                    procurement packages (every status) and long-lead items
 *                    five enquiries (bid packages): awarded (with the commitment
 *                    and the order raised from it), open, draft, closed with a
 *                    soft award, cancelled — priced by bidders through the
 *                    public token routes, with questions, addenda, a withdrawal
 *                    and a decline
 *                    purchase orders in every state the register has: planned,
 *                    draft, pending approval, approved, sent back, issued,
 *                    acknowledged, cancelled, closed short, part delivered,
 *                    delivered
 *                    deliveries against two of them (receipt, receipt lines and
 *                    the stock movements they post), into the project's or the
 *                    company's warehouse
 *                    supplier invoices against order lines (the three-way
 *                    match): paid, part paid, pending with a price variance,
 *                    draft and undelivered, returned, void
 *                    the lead-time alerts this run's packages and orders raise,
 *                    left open / acknowledged / resolved
 *
 * Every line that carries money names an activity. Every record carries one
 * canary in each text it holds. A second run makes a second set: codes the
 * driver invents carry the run number kept in `ctx.refs.procurement.runs`.
 * A second run is additive for money (orders, stock, actual cost, payments).
 *
 * The core records are not wrapped in an attempt: if one is refused the run
 * fails. Only three side steps may be refused and become a note (an attachment
 * upload, the bidder's priced form, the levelling workbook); a 5xx there is
 * noted as `PRODUCT DEFECT …` and kept in `ctx.refs.procurement.defects`. The
 * one product defect the run works around (an order raised from an award that
 * collides on the lead-time alert) is noted the same way.
 *
 * Left for later drivers: `ctx.refs.purchaseOrders` (id, ref, status, lines
 * with id / description / qty / rate, and the status of any invoice this
 * driver raised against the order), `ctx.refs.suppliers` (ids),
 * `ctx.refs.supplierRows` and `ctx.refs.procurement` (packages, enquiries,
 * commitments, invoices, orders by scenario, the warehouse deliveries went to,
 * and `matchInputs`: what was ordered, received and invoiced, from which the
 * three-way match verdicts must be derived — `matches` holds what the API
 * answered, which is an observation, never an expectation).
 */

const { raw, multipart, ApiError } = require('../lib/api');

const listOf = (data) => (Array.isArray(data) ? data : data?.items || []);
const round2 = (value) => Math.round(Number(value) * 100) / 100;
const isoAt = (days) => new Date(Date.now() + days * 86_400_000).toISOString();

/** What each bill row is bought as, by its position in foundation's bill. */
const MATERIALS = [
  ['Hardcore fill', '02-100'], ['Ready-mix concrete C35', '02-100'], ['High tensile rebar T16', '02-200'], ['Hollow concrete blocks 200mm', '02-100'],
  ['Plaster premix', '02-100'], ['Formwork plywood 18mm', '02-100'], ['Ready-mix concrete C40', '02-100'], ['Emulsion paint', '02-100'],
  ['Ceramic floor tiles 600x600', '02-100'], ['Waterproofing membrane 4mm', '02-100'],
];

/** Directory vendors beside foundation's supplier, and where each one's assessment is left. */
const VENDORS = [
  { key: 'rebar', label: 'Rebar Mills', trades: ['reinforcement'], outcome: 'conditionally_approved' },
  { key: 'readymix', label: 'Readymix and Aggregates', trades: ['concrete'], outcome: 'rejected' },
  { key: 'ceramics', label: 'Ceramics Trading', trades: ['finishes'], outcome: 'reopened' },
  { key: 'membranes', label: 'Waterproofing Systems', trades: ['waterproofing'], outcome: 'under_review' },
  { key: 'fixings', label: 'Fixings Direct', trades: ['general'], outcome: 'draft' },
];
const SCORE = { approved: 5, reopened: 4, conditionally_approved: 3, rejected: 1, under_review: 4 };

/** A one-page PDF that says `text`. */
const pdf = (text) => {
  const safe = String(text).replace(/[()\\]/g, ' ');
  const stream = `BT /F1 12 Tf 40 780 Td (${safe}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
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
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** The bidder's side: the public token routes, no login. A refusal is an ApiError like any other. */
const portal = async (method, token, suffix = '', json = undefined, form = undefined) => {
  const res = await raw(method, `/public/bids/${token}${suffix}`, form ? { form } : { json });
  if (res.status < 200 || res.status >= 300) throw new ApiError(method, `/public/bids/<token>${suffix}`, res.status, res.body);
  return res.body?.data;
};

const run = async (ctx) => {
  const { P, rng, company } = ctx;
  const pm = ctx.who('pm');
  const buyer = ctx.who('procurement');
  const planner = ctx.who('planner');
  const qs = ctx.who('qs');
  const cost = ctx.who('cost');
  const finance = ctx.who('finance');
  const storeman = ctx.who('warehouse');

  // ── bookkeeping ──────────────────────────────────────────────────────────
  const mine = (ctx.refs.procurement = ctx.refs.procurement || {});
  mine.runs = (mine.runs || 0) + 1;
  const RUN = mine.runs;
  const shared = (ctx.companyRefs.procurement = ctx.companyRefs.procurement || {});
  shared.vendors = shared.vendors || {};
  shared.prequal = shared.prequal || {};
  shared.recorded = shared.recorded || {};

  /** One canary per record, used in every text that record holds; later runs say which run wrote it. */
  const tag = (type) => `${ctx.canary(type)}${RUN > 1 ? `-R${RUN}` : ''}`;
  const companyTag = (type, key) => `${company.canary}-${String(type).toUpperCase()}-${String(key).toUpperCase()}`;
  // An id is one record of one type: a package id never stands among its lines.
  if (ctx.records.bid_package_line && ctx.records.bid_package) {
    const packageIds = new Set(ctx.records.bid_package);
    ctx.records.bid_package_line = ctx.records.bid_package_line.filter((id) => !packageIds.has(id));
  }
  /**
   * Records an id once, however often a re-run meets the same row again. A
   * record that came back without an id is a failure: it is how a response
   * shape the driver misread goes unnoticed.
   */
  const seen = new Set(Object.values(ctx.records).flat());
  const record = (type, id) => {
    if (!id) throw new Error(`procurement: a ${type} came back without an id`);
    if (seen.has(id)) return id;
    seen.add(id);
    return ctx.record(type, id);
  };
  const recordCompany = (type, id) => {
    if (!id) throw new Error(`procurement: a ${type} (company) came back without an id`);
    if (shared.recorded[id]) return id;
    shared.recorded[id] = type;
    return ctx.record(type, id, { scope: 'company' });
  };

  /** A product defect met on the way: a note with a fixed prefix, and a row the matrix report can count. */
  const defects = [];
  const productDefect = (label, error, extra = {}) => {
    const entry = { run: RUN, label, method: error.method, route: error.route, status: error.status, code: error.code, message: String(error.serverMessage || '').slice(0, 400), ...extra };
    defects.push(entry);
    ctx.note(`PRODUCT DEFECT ${label}: ${error.method} ${error.route} -> ${error.status} ${error.code} ${String(error.serverMessage || '').replace(/\s+/g, ' ').slice(0, 300)}`);
  };
  /**
   * A side step that may be refused (an upload over a rate or storage limit, an
   * export): a refusal becomes a note. A 5xx is never a plain refusal: it is
   * noted as a product defect. Core records never go through here.
   */
  const optional = async (label, fn) => {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.status >= 500) productDefect(label, error);
      else ctx.note(`${label}: ${error.status} ${error.code} ${error.serverMessage}`.slice(0, 300));
      return null;
    }
  };

  const mailbox = (name) => `${name}.r${RUN}.${ctx.project.key}@bidders.c${company.code}.octapm-cert.test`.toLowerCase();
  const attach = async (who, label, { recordType, recordId, filename, contentType, body, caption }) =>
    optional(label, async () => {
      const attached = await who.upload('POST', `${P}/attachments`, { field: 'files', filename, contentType, body, fields: { recordType, recordId, caption } });
      const rows = listOf(attached?.attachments || attached);
      if (!rows.length) throw new Error(`procurement: ${label} answered without the attachment it made`);
      for (const row of rows) {
        record('attachment', row.id);
        if (row.documentId) record('project_document', row.documentId);
      }
      return rows;
    });

  // ── what foundation left ─────────────────────────────────────────────────
  const activityIds = Object.values(ctx.refs.activities || {});
  if (!activityIds.length) throw new Error('procurement: the project has no activities');
  const bill = Object.keys(ctx.refs.boqRows || {})
    .filter((code) => ctx.refs.boq?.[code])
    .map((code) => {
      const index = (Number(code.replace(/\D/g, '')) || 1) - 1;
      const [name, wanted] = MATERIALS[index % MATERIALS.length];
      const allocation = (ctx.refs.allocations?.[code] || [])[0];
      const costCode = ctx.companyRefs.costCodes?.[wanted] ? wanted : Object.keys(ctx.companyRefs.costCodes || {})[0];
      return {
        code,
        name,
        boqItemId: ctx.refs.boq[code],
        unit: ctx.refs.boqRows[code].unit || 'nr',
        quantity: Number(ctx.refs.boqRows[code].quantity) || 1,
        rate: Number(ctx.refs.boqRows[code].rate) || 1,
        activityId: (allocation && ctx.refs.activities[allocation.activityCode]) || activityIds[index % activityIds.length],
        costCodeId: ctx.companyRefs.costCodes?.[costCode] || null,
        budgetLineId: ctx.refs.budgetLines?.[costCode] || null,
      };
    });
  if (!bill.length) throw new Error('procurement: the project has no bill rows');
  let billCursor = rng.int(0, bill.length - 1);
  const nextRow = () => bill[(billCursor++) % bill.length];

  // ═════════════════════════════════════════════════════════════════════════
  // 1. once per company: directory vendors and their prequalification
  // ═════════════════════════════════════════════════════════════════════════
  const directorySupplier = ctx.companyRefs.directory?.supplier || null;

  const assess = async (companyId, outcome, key) => {
    let assessment = await pm.GET(`/company/vendors/${companyId}/prequalification`);
    recordCompany('vendor_prequalification', assessment.id);
    for (const criterion of assessment.criteria || []) recordCompany('prequal_criterion', criterion.id);
    if (shared.prequal[companyId]) return assessment;
    const canary = companyTag('vendor_prequalification', key);
    if (outcome !== 'draft' && !['approved', 'conditionally_approved', 'rejected'].includes(assessment.status)) {
      for (const [index, criterion] of (assessment.criteria || []).entries()) {
        if (outcome === 'under_review' && index >= 4) break; // half an assessment: under review, not ready to decide
        await pm.PATCH(`/company/vendors/${companyId}/prequalification/criteria/${criterion.key}`, {
          score: Math.max(0, Math.min(5, SCORE[outcome] - (index % 3 === 2 ? 1 : 0))),
          note: `${companyTag('prequal_criterion', `${key}-${criterion.key}`)} ${criterion.label} assessed`,
          reference: `${company.canary}-PQ-${key}-${criterion.key}`.slice(0, 200),
          ...(criterion.tracksExpiry ? { expiresAt: ctx.daysAhead(400) } : {}),
        });
      }
      if (outcome !== 'under_review') {
        const decision = outcome === 'reopened' ? 'approved' : outcome;
        assessment = await pm.POST(`/company/vendors/${companyId}/prequalification/decision`, {
          status: decision,
          ...(decision === 'rejected' ? {} : { validUntil: ctx.daysAhead(540) }),
          decisionNote: `${canary} ${decision.replace(/_/g, ' ')}`,
          ...(decision === 'conditionally_approved' ? { conditions: `${canary} one award at a time, bank guarantee before mobilisation`, singleAwardLimit: 25000 } : {}),
        });
      }
    }
    if (outcome === 'reopened' && assessment.status === 'approved') {
      await pm.POST(`/company/vendors/${companyId}/prequalification/reopen`, { reason: `${canary} annual renewal: insurance certificate replaced` });
    }
    shared.prequal[companyId] = outcome;
    return assessment;
  };

  // Not an attempt: the PM persona is a company administrator in every company
  // (spec.js), so a refusal here is a failure of the run, not a business answer.
  // One vendor at a time, so a failure names the vendor it stopped at.
  if (directorySupplier) await assess(directorySupplier, 'approved', 'directory');
  for (const [index, vendor] of VENDORS.entries()) {
    if (!shared.vendors[vendor.key]) {
      const canary = companyTag('company', vendor.key);
      const created = await pm.POST('/company/vendors', {
        name: `${company.canary} ${vendor.label}`,
        legalName: `${company.canary} ${vendor.label} LLC`,
        email: `${vendor.key}@parties.c${company.code}.octapm-cert.test`,
        phone: '+1 555 0142',
        address: `${canary} 14 Trade Park`,
        contactName: `${canary} sales desk`,
        trades: vendor.trades,
        paymentTerms: `30 days from invoice ${canary}`,
        notes: `${canary} added by procurement`,
        leadTimeReliability: 70 + index * 5,
      });
      shared.vendors[vendor.key] = created.id;
      recordCompany('company', created.id);
    }
    await assess(shared.vendors[vendor.key], vendor.outcome, vendor.key);
  }
  /** Read after the PM's assessment above, so the read never creates an assessment nobody recorded. */
  const qualified = async (companyId) => {
    if (!companyId) return false;
    const state = await buyer.GET(`/company/vendors/${companyId}/prequalification`);
    recordCompany('vendor_prequalification', state.id);
    return Boolean(state.qualified);
  };
  const directoryQualified = await qualified(directorySupplier);

  // ═════════════════════════════════════════════════════════════════════════
  // 2. project suppliers
  // ═════════════════════════════════════════════════════════════════════════
  const suppliers = [];
  const addSupplier = async (payload) => {
    const row = await buyer.POST(`${P}/procurement/suppliers`, payload);
    record('procurement_supplier', row.id);
    if (!suppliers.some((s) => s.id === row.id)) suppliers.push(row);
    return row;
  };
  if (directorySupplier) {
    const canary = tag('procurement_supplier');
    await addSupplier({ companyId: directorySupplier, code: 'SUP-DIR', contactName: `${canary} account manager`, status: 'approved', leadTimeReliability: 88, notes: `${canary} framework supplier from the company directory` });
  }
  if (shared.vendors.rebar) {
    await addSupplier({ companyId: shared.vendors.rebar, code: 'SUP-RBR', status: 'approved', tradeCategories: ['reinforcement'], notes: `${tag('procurement_supplier')} conditionally approved vendor` });
  }
  const NAMED = [['Site Consumables', 'approved'], ['Timber Yard', 'pending'], ['Plant Spares', 'on_hold'], ['Cash Trader', 'blocked']];
  for (const [label, status] of NAMED.slice(0, 2 + ctx.count(0, 2))) {
    const canary = tag('procurement_supplier');
    await addSupplier({
      name: `${canary} ${label}`,
      code: `SUP-R${RUN}-${label.slice(0, 3).toUpperCase()}`,
      contactName: `${canary} ${label} desk`,
      email: `${label.replace(/\W/g, '').toLowerCase()}.r${RUN}@suppliers.c${company.code}.octapm-cert.test`,
      phone: '+1 555 0177',
      address: `${canary} 9 Depot Road`,
      tradeCategories: ['general'],
      status,
      leadTimeReliability: rng.int(40, 95),
      notes: `${canary} ${status} supplier, entered by name`,
    });
  }
  const orderable = suppliers.filter((s) => ['approved', 'pending'].includes(s.status));
  const mainSupplier = suppliers.find((s) => s.companyId && s.companyId === directorySupplier) || orderable[0];
  const supplierCompany = mainSupplier.companyId || directorySupplier || null;

  // ═════════════════════════════════════════════════════════════════════════
  // 3. procurement packages and long-lead items
  // ═════════════════════════════════════════════════════════════════════════
  const packages = {};
  const addPackage = async (key, status, who, extra = {}) => {
    const row = nextRow();
    const canary = tag('procurement_package');
    const number = `PP-R${RUN}-${String(Object.keys(packages).length + 1).padStart(2, '0')}`;
    const created = await who.POST(`${P}/procurement/packages`, {
      packageNumber: number,
      title: `${row.name} supply — ${canary}`,
      description: `${canary} ${row.name} for bill row ${row.code}`,
      activityId: row.activityId,
      status,
      buyer: `${canary} ${buyer.email}`,
      plannedAwardDate: ctx.daysAhead(rng.int(5, 30)),
      requiredOnSiteDate: ctx.daysAhead(rng.int(60, 120)),
      requiredTiming: rng.pick(['activity_start', 'activity_finish']),
      leadWeeks: rng.int(1, 4),
      bufferDays: rng.int(3, 14),
      notes: `${canary} ${status}`,
      ...extra,
    });
    record('procurement_package', created.id);
    packages[key] = { id: created.id, number, row, status };
    return packages[key];
  };
  await addPackage('award', 'tendering', buyer);
  await addPackage('open', 'tendering', buyer);
  await addPackage('planning', 'planning', planner);
  // Needed on site sooner than its lead time allows: this is the one the lead-time alert is for.
  await addPackage('late', 'planning', buyer, { requiredOnSiteDate: ctx.daysAhead(6), leadWeeks: 10, bufferDays: 14, needOffsetDays: 0 });
  const MORE = [['awarded', 'awarded'], ['delivery', 'in_delivery'], ['closed', 'closed'], ['cancelled', 'cancelled']];
  for (const [key, status] of MORE.slice(0, ctx.count(2, 4))) await addPackage(key, status, buyer, { supplierId: mainSupplier.id });

  const longLead = [];
  // A hand-kept item whose warehouse status is partial is stored as delivered
  // (long-lead.service.js normalizeRowForWrite), so "part received" is sent as
  // delivered + partial, which is what the register will hold.
  const LONG = [
    ['Tower crane hire', 'not_ordered', 'not_received'], ['Generator set 500 kVA', 'ordered', 'not_received'],
    ['Lift installation', 'delivered', 'partial'], ['Curtain wall panels', 'delivered', 'received'],
  ];
  for (const [index, [label, status, warehouseStatus]] of LONG.slice(0, ctx.count(2, 4)).entries()) {
    const canary = tag('long_lead_item');
    const item = await planner.POST(`${P}/long-lead`, {
      item: `${label} — ${canary}`,
      activityId: rng.pick(activityIds),
      leadWeeks: rng.int(6, 20),
      requiredTiming: 'activity_start',
      needOffsetDays: rng.int(0, 5),
      bufferDays: rng.int(7, 21),
      criticality: index === 0 ? 'high' : rng.pick(['medium', 'low']),
      risk: `${canary} single source`,
      status,
      warehouseStatus,
      supplier: `${canary} ${label} vendor`,
      ...(status === 'not_ordered' ? {} : { expectedDeliveryDate: ctx.daysAhead(rng.int(20, 90)) }),
      ...(status === 'delivered' ? { deliveredAt: ctx.daysAgo(2) } : {}),
    });
    record('long_lead_item', item.id);
    longLead.push(item.id);
  }
  {
    // One bought under a package: its dates and statuses then come from the package, and typing them is refused.
    const canary = tag('long_lead_item');
    const linked = await buyer.POST(`${P}/long-lead`, {
      item: `${packages.late.row.name} bulk order — ${canary}`,
      activityId: packages.late.row.activityId,
      procurementPackageId: packages.late.id,
      leadWeeks: 10,
      criticality: 'critical',
      risk: `${canary} order date already passed`,
    });
    record('long_lead_item', linked.id);
    longLead.push(linked.id);
    await planner.PATCH(`${P}/long-lead/${longLead[0]}`, { bufferDays: 10, criticality: 'critical' });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 4. enquiries: bid packages, bidders, quotes through the public portal
  // ═════════════════════════════════════════════════════════════════════════
  const enquiries = [];
  const commitments = [];

  const addLines = async (bidPackageId, rows, { deliveryLine = true } = {}) => {
    await buyer.POST(`${P}/bids/${bidPackageId}/lines/from-boq`, { boqItemIds: rows.map((row) => row.boqItemId) });
    const free = rows[0];
    if (deliveryLine) {
      // Answers with the whole package; the line is recorded from the read below.
      await buyer.POST(`${P}/bids/${bidPackageId}/lines`, {
        description: `Delivery, offloading and stacking — ${tag('bid_package_line')}`,
        section: 'Delivery',
        code: `DEL-${RUN}`,
        unit: 'lot',
        qty: 1,
        estimateRate: rng.int(300, 1500),
        activityId: free.activityId,
        costCodeId: free.costCodeId,
        budgetLineId: free.budgetLineId,
      });
    }
    let detail = await buyer.GET(`${P}/bids/${bidPackageId}`);
    // A bill row split over several activities comes across uncoded; the buyer says where its cost belongs.
    for (const line of detail.lines || []) {
      record('bid_package_line', line.id);
      if (line.activityId) continue;
      const row = rows.find((candidate) => candidate.boqItemId === line.boqItemId) || free;
      await buyer.PATCH(`${P}/bids/${bidPackageId}/lines/${line.id}`, { activityId: row.activityId, costCodeId: row.costCodeId, budgetLineId: row.budgetLineId });
    }
    detail = await buyer.GET(`${P}/bids/${bidPackageId}`);
    return detail.lines || [];
  };

  const invite = async (bidPackageId, bidders, { who = buyer } = {}) => {
    const needsOverride = bidders.some((bidder) => bidder.vendorCompanyId && !bidder.qualified);
    const created = await who.POST(`${P}/bids/${bidPackageId}/invitations`, {
      invitations: bidders.map(({ vendorCompanyId, companyName, contactName, contactEmail }) => ({
        ...(vendorCompanyId ? { vendorCompanyId } : { companyName }),
        contactName,
        contactEmail,
      })),
      ...(needsOverride ? { prequalOverrideReason: `${tag('bid_package')} invited to price before the assessment is complete` } : {}),
    });
    const rows = listOf(created);
    for (const [index, row] of rows.entries()) {
      record('bid_invitation', row.id);
      bidders[index].invitationId = row.id;
    }
    return rows;
  };
  /** A bidder's personal link. Every e-mail to a bidder replaces the link, so it is asked for when it is needed. */
  const tokenFor = async (bidPackageId, bidder) => {
    const resent = await buyer.POST(`${P}/bids/${bidPackageId}/invitations/${bidder.invitationId}/resend`, {});
    const token = String(resent.portalUrl || '').split('/bid/')[1];
    if (!token) throw new Error(`procurement: no portal link for ${bidder.contactEmail}`);
    return token;
  };
  const price = async (bidPackageId, bidder, lines, { factor, submit = true, exclude = false } = {}) => {
    const token = await tokenFor(bidPackageId, bidder);
    const canary = tag('bid');
    const saved = await portal('PUT', token, '/bid', {
      lines: lines.map((line, index) => ({
        packageLineId: line.id,
        rate: round2((Number(line.estimateRate) || 100) * factor),
        included: !(exclude && lines.length > 1 && index === lines.length - 1),
        note: `${tag('bid_line')} ${bidder.contactName}`,
      })),
      leadTimeDays: rng.int(7, 45),
      validityDays: rng.pick([15, 30, 60]),
      inclusions: `${canary} delivered to site, offloaded`,
      exclusions: exclude ? `${canary} excludes offloading` : null,
      notes: `${canary} quotation from ${bidder.contactName}`,
    });
    record('bid', saved.id);
    for (const line of saved.lines || []) record('bid_line', line.id);
    bidder.bidId = saved.id;
    bidder.canary = canary;
    if (submit) await portal('POST', token, '/bid/submit', { submittedBy: `${bidder.contactName} ${canary}` });
    return { token, bid: saved };
  };
  const adHoc = (label) => {
    const canary = tag('bid_invitation');
    return { companyName: `${canary} ${label}`, contactName: `${label} estimator ${canary}`, contactEmail: mailbox(label.replace(/\W/g, '')) };
  };
  const dueSoon = () => isoAt(rng.int(7, 21));

  // ── A. the awarded enquiry: priced, levelled, awarded, turned into an order ──
  {
    const pkg = packages.award;
    const canary = tag('bid_package');
    const enquiry = await buyer.POST(`${P}/procurement/packages/${pkg.id}/quotes`, {
      title: `${pkg.number} ${pkg.row.name} — ${canary}`,
      description: `${canary} price the supply of ${pkg.row.name}, delivered`,
      instructions: `${canary} quote per unit, state lead time from order`,
      dueAt: dueSoon(),
    });
    record('bid_package', enquiry.id);
    const rows = [pkg.row, ...Array.from({ length: ctx.count(0, 2) }, nextRow)].filter((row, index, all) => all.findIndex((r) => r.boqItemId === row.boqItemId) === index);
    const lines = await addLines(enquiry.id, rows, { deliveryLine: rng.chance(0.5) });

    const addendumCanary = tag('bid_addendum');
    const addendum = await buyer.POST(`${P}/bids/${enquiry.id}/addenda`, { title: `Delivery window — ${addendumCanary}`, body: `${addendumCanary} deliveries accepted 07:00 to 15:00 only` });
    record('bid_addendum', addendum.id);
    {
      const fileCanary = tag('attachment');
      await attach(buyer, 'tender document on the enquiry', { recordType: 'bid_package', recordId: enquiry.id, filename: `${fileCanary}-enquiry.pdf`, contentType: 'application/pdf', body: pdf(`${fileCanary} enquiry ${pkg.number} specification`), caption: `${fileCanary} specification` });
    }

    const bidders = [
      ...(directorySupplier ? [{ vendorCompanyId: directorySupplier, qualified: directoryQualified, contactName: `Directory supplier sales ${tag('bid_invitation')}`, contactEmail: mailbox('directory') }] : []),
      adHoc('Emirates Rebar Trading'),
      adHoc('Northern Steel Mills'),
    ];
    await invite(enquiry.id, bidders);
    await buyer.POST(`${P}/bids/${enquiry.id}/publish`, {});

    // A bidder asks, the buyer answers everyone.
    const asker = bidders[bidders.length - 1];
    const questionCanary = tag('bid_question');
    const question = await portal('POST', await tokenFor(enquiry.id, asker), '/questions', { question: `${questionCanary} Is partial delivery acceptable?`, askedBy: asker.contactName });
    record('bid_question', question.id);
    await buyer.POST(`${P}/bids/${enquiry.id}/questions/${question.id}/answer`, { answer: `${questionCanary} Yes, in two drops, both before the required date.`, shared: true });

    const factors = rng.shuffle([0.92, 1.04, 0.98]);
    for (const [index, bidder] of bidders.entries()) {
      const priced = await price(enquiry.id, bidder, lines, { factor: factors[index], submit: false, exclude: index === bidders.length - 1 });
      if (index === 0) {
        // The bidder's own file. The product makes the document and an attachment
        // on the bid (recordType "bid"); the attachment is read back to record it.
        const uploaded = await optional('priced form uploaded by a bidder', () => {
          const fileCanary = tag('project_document');
          return portal('POST', priced.token, '/upload', undefined, multipart({ field: 'file', filename: `${fileCanary}-priced-form.pdf`, contentType: 'application/pdf', body: pdf(`${fileCanary} priced form from ${bidder.contactName}`) }));
        });
        if (uploaded) {
          record('project_document', uploaded.documentId);
          const onBid = listOf(await buyer.GET(`${P}/attachments?recordType=bid&recordId=${uploaded.id}`));
          const made = onBid.filter((row) => row.documentId === uploaded.documentId);
          if (!made.length) ctx.note(`priced form: the bidder's upload made document ${uploaded.documentId} but no attachment on bid ${uploaded.id} (bid.service portalUpload swallows the attachment's failure)`);
          for (const row of made) record('attachment', row.id);
        }
        await portal('GET', priced.token);
      }
      await portal('POST', priced.token, '/bid/submit', { submittedBy: `${bidder.contactName} ${bidder.canary}` });
    }

    await buyer.GET(`${P}/bids/${enquiry.id}/leveling`);
    await optional('leveling workbook', () => buyer.download(`${P}/bids/${enquiry.id}/leveling.xlsx`));
    const bids = listOf(await buyer.GET(`${P}/bids/${enquiry.id}/bids`));
    // Half the projects award the vetted directory supplier, the other half an ad-hoc bidder on a written override.
    const winner = directorySupplier && rng.chance(0.5) ? bidders[0] : bidders[directorySupplier ? 1 : 0];
    const winning = bids.find((bid) => bid.id === winner.bidId) || bids[0];
    await pm.POST(`${P}/bids/${enquiry.id}/award`, { bidId: winning.id });
    await pm.POST(`${P}/bids/${enquiry.id}/award/revoke`, {});
    await pm.POST(`${P}/bids/${enquiry.id}/award`, { bidId: winning.id });
    const commitmentCanary = tag('commitment');
    const confirmBody = { title: `${pkg.number} supply agreement — ${commitmentCanary}`, retentionRate: 0, startDate: ctx.today, endDate: ctx.daysAhead(120) };
    let confirmed = await pm.send('POST', `${P}/bids/${enquiry.id}/award/confirm`, confirmBody);
    if (confirmed.status === 409 && confirmed.body?.error?.code === 'PREQUAL_AWARD_BLOCKED') {
      confirmed = await pm.send('POST', `${P}/bids/${enquiry.id}/award/confirm`, { ...confirmBody, prequalOverrideReason: `${canary} fastest delivery; awarded on override pending prequalification` });
    }
    if (confirmed.status !== 201) throw new ApiError('POST', `${P}/bids/${enquiry.id}/award/confirm`, confirmed.status, confirmed.body);
    // Confirming the award makes the commitment (bid.service confirmAward). It is a core record: no commitment, no run.
    const commitmentId = confirmed.body.data?.commitment?.id;
    if (!commitmentId) throw new Error(`procurement: confirming the award of ${enquiry.id} answered 201 without a commitment`);
    record('commitment', commitmentId);
    commitments.push(commitmentId);
    const commitment = await buyer.GET(`${P}/commitments/${commitmentId}`);
    const sov = commitment.lines || commitment.sovLines || [];
    if (!sov.length) throw new Error(`procurement: the awarded commitment ${commitmentId} has no schedule of values`);
    for (const line of sov) record('commitment_sov_line', line.id);
    const vendorCompanyId = commitment.vendorCompanyId || commitment.vendor?.id || null;
    if (vendorCompanyId && vendorCompanyId !== directorySupplier && !Object.values(shared.vendors).includes(vendorCompanyId)) recordCompany('company', vendorCompanyId);
    enquiries.push({ id: enquiry.id, ref: enquiry.ref, status: 'awarded', procurementPackageId: pkg.id, commitmentId, awardedBidId: winning.id, vendorCompanyId });
    packages.award.lines = lines;
    packages.award.winning = winning;
  }

  // ── B. an enquiry still open: one quote in, one being written, one withdrawn, one declined ──
  {
    const pkg = packages.open;
    const canary = tag('bid_package');
    const enquiry = await buyer.POST(`${P}/procurement/packages/${pkg.id}/quotes`, {
      title: `${pkg.number} ${pkg.row.name} — ${canary}`,
      description: `${canary} second enquiry, still out with suppliers`,
      dueAt: dueSoon(),
    });
    record('bid_package', enquiry.id);
    const lines = await addLines(enquiry.id, [pkg.row]);
    const bidders = [adHoc('Coastal Building Supplies'), adHoc('Metro Trade Centre'), adHoc('Delta Merchants'), adHoc('Summit Materials')];
    if (shared.vendors.rebar) bidders.push({ vendorCompanyId: shared.vendors.rebar, qualified: await qualified(shared.vendors.rebar), contactName: `Rebar Mills sales ${tag('bid_invitation')}`, contactEmail: mailbox('rebarmills') });
    await invite(enquiry.id, bidders);
    await buyer.POST(`${P}/bids/${enquiry.id}/publish`, {});
    const addendumCanary = tag('bid_addendum');
    const addendum = await buyer.POST(`${P}/bids/${enquiry.id}/addenda`, { title: `Revised quantity — ${addendumCanary}`, body: `${addendumCanary} quantities are approximate, plus or minus ten percent` });
    record('bid_addendum', addendum.id);
    await price(enquiry.id, bidders[0], lines, { factor: 1.01 });
    await price(enquiry.id, bidders[1], lines, { factor: 0.95, submit: false });
    const withdrawn = await price(enquiry.id, bidders[2], lines, { factor: 1.1 });
    await portal('POST', withdrawn.token, '/bid/withdraw');
    await portal('POST', await tokenFor(enquiry.id, bidders[3]), '/decline', { reason: `${tag('bid_invitation')} order book full this quarter` });
    const question = await portal('POST', await tokenFor(enquiry.id, bidders[1]), '/questions', { question: `${tag('bid_question')} Can the validity period be reduced to 15 days?`, askedBy: bidders[1].contactName });
    record('bid_question', question.id); // left unanswered
    enquiries.push({ id: enquiry.id, ref: enquiry.ref, status: 'open', procurementPackageId: pkg.id });
  }

  // ── C. a draft raised by the QS as a subcontract tender, not sent out ──
  {
    const canary = tag('bid_package');
    const enquiry = await qs.POST(`${P}/bids`, {
      title: `Blockwork subcontract tender — ${canary}`,
      description: `${canary} labour and material, still being written`,
      instructions: `${canary} price each line; rates fixed for the contract period`,
      dueAt: isoAt(30),
      questionsDueAt: isoAt(20),
      commitmentType: 'subcontract',
    });
    record('bid_package', enquiry.id);
    const row = nextRow();
    // Adding a line answers with the whole package.
    await qs.POST(`${P}/bids/${enquiry.id}/lines`, { description: `${row.name} fix only — ${tag('bid_package_line')}`, unit: row.unit, qty: Math.max(1, Math.round(row.quantity / 4)), estimateRate: round2(row.rate * 0.4), activityId: row.activityId, costCodeId: row.costCodeId, budgetLineId: row.budgetLineId, boqItemId: row.boqItemId });
    const withSpare = await qs.POST(`${P}/bids/${enquiry.id}/lines`, { description: `Provisional item, to be removed — ${tag('bid_package_line')}`, unit: 'sum', qty: 1, estimateRate: 100, activityId: row.activityId });
    const [kept, spare] = withSpare.lines || [];
    if (!kept || !spare) throw new Error('procurement: the draft tender did not come back with its two lines');
    record('bid_package_line', kept.id);
    await qs.DELETE(`${P}/bids/${enquiry.id}/lines/${spare.id}`);
    await qs.PATCH(`${P}/bids/${enquiry.id}`, { description: `${canary} labour and material, revised scope` });
    const bidders = [adHoc('Hilltop Masonry'), adHoc('Riverbend Builders')];
    await invite(enquiry.id, bidders, { who: qs });
    await qs.DELETE(`${P}/bids/${enquiry.id}/invitations/${bidders[1].invitationId}`);
    // A deleted invitation is gone: it does not stay in the inventory as a dangling id.
    const recorded = ctx.records.bid_invitation || [];
    const at = recorded.indexOf(bidders[1].invitationId);
    if (at >= 0) recorded.splice(at, 1);
    mine.deletedInvitations = [...(mine.deletedInvitations || []), bidders[1].invitationId];
    enquiries.push({ id: enquiry.id, ref: enquiry.ref, status: 'draft', procurementPackageId: null });
  }

  // ── D. closed, reopened, closed again by a soft award nobody has confirmed ──
  {
    const row = nextRow();
    const canary = tag('bid_package');
    const enquiry = await buyer.POST(`${P}/bids`, { title: `${row.name} spot purchase — ${canary}`, description: `${canary} closed with a preferred quote awaiting the PM`, dueAt: dueSoon(), commitmentType: 'purchase_order' });
    record('bid_package', enquiry.id);
    const lines = await addLines(enquiry.id, [row]);
    const bidders = [adHoc('Harbour Supplies'), adHoc('Ridge Trading')];
    await invite(enquiry.id, bidders);
    await buyer.POST(`${P}/bids/${enquiry.id}/publish`, {});
    await price(enquiry.id, bidders[0], lines, { factor: 0.97 });
    await buyer.POST(`${P}/bids/${enquiry.id}/close`, {});
    await buyer.POST(`${P}/bids/${enquiry.id}/reopen`, { dueAt: dueSoon() });
    await price(enquiry.id, bidders[1], lines, { factor: 1.03 });
    await pm.POST(`${P}/bids/${enquiry.id}/award`, { bidId: bidders[0].bidId });
    enquiries.push({ id: enquiry.id, ref: enquiry.ref, status: 'closed', procurementPackageId: null, softAwardBidId: bidders[0].bidId });
  }

  // ── E. cancelled before it went out ──
  {
    const row = nextRow();
    const canary = tag('bid_package');
    const enquiry = await buyer.POST(`${P}/bids`, { title: `${row.name} enquiry, withdrawn — ${canary}`, description: `${canary} scope moved into the main supply package`, dueAt: dueSoon(), commitmentType: 'purchase_order' });
    record('bid_package', enquiry.id);
    await addLines(enquiry.id, [row], { deliveryLine: false });
    const cancelled = await buyer.send('DELETE', `${P}/bids/${enquiry.id}`, { reason: `${canary} duplicated by another package` });
    if (cancelled.status !== 200) throw new ApiError('DELETE', `${P}/bids/${enquiry.id}`, cancelled.status, cancelled.body);
    enquiries.push({ id: enquiry.id, ref: enquiry.ref, status: 'cancelled', procurementPackageId: null });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 5. purchase orders, in every state the register has
  // ═════════════════════════════════════════════════════════════════════════
  const currency = ctx.project.currency || company.currency || 'USD';
  const orders = {};
  const noteOrder = (key, order) => {
    record('procurement_order', order.id);
    for (const line of order.lines || []) record('procurement_po_line', line.id);
    orders[key] = {
      id: order.id,
      ref: order.ref,
      lines: (order.lines || []).map((line) => ({ id: line.id, description: line.description, unit: line.unit, qty: Number(line.orderedQty), rate: Number(line.unitCost), activityId: line.activityId, costCodeId: line.costCodeId, budgetLineId: line.budgetLineId })),
    };
    return orders[key];
  };
  const raise = async (key, { status = 'draft', supplier = mainSupplier, lineCount = ctx.count(1, 3), extra = {}, lines = null } = {}) => {
    const canary = tag('procurement_order');
    const built =
      lines ||
      Array.from({ length: lineCount }, () => {
        const row = nextRow();
        const lineCanary = tag('procurement_po_line');
        return {
          activityId: row.activityId,
          costCodeId: row.costCodeId,
          budgetLineId: row.budgetLineId,
          boqItemId: row.boqItemId,
          itemCode: `${ctx.project.key}-${row.code}`,
          description: `${row.name} — ${lineCanary}`,
          spec: `${lineCanary} to project specification`,
          unit: row.unit,
          orderedQty: Math.max(4, Math.round(row.quantity * (rng.int(4, 15) / 100))),
          unitCost: round2(row.rate * (rng.int(55, 80) / 100)),
          leadWeeks: rng.int(1, 4),
          notes: `${lineCanary} for bill row ${row.code}`,
        };
      });
    const order = await buyer.POST(`${P}/procurement/purchase-orders`, {
      item: `${built[0].description.split(' — ')[0]} order — ${canary}`,
      ...(supplier ? { supplierId: supplier.id } : {}),
      status,
      // The project's currency, which is also the currency of the enquiries and the awarded commitment.
      currency,
      requiredBy: ctx.daysAhead(rng.int(30, 70)),
      promisedDate: ctx.daysAhead(rng.int(15, 45)),
      leadWeeks: rng.int(1, 4),
      buyer: `${canary} ${buyer.email}`,
      notes: `${canary} ${key}`,
      lines: built,
      ...extra,
    });
    const noted = noteOrder(key, order);
    noted.canary = canary;
    return noted;
  };
  const step = (order, action, body = {}, who = buyer) => who.POST(`${P}/purchase-orders/${order.id}/${action}`, body);
  const toIssued = async (order) => {
    await step(order, 'submit');
    await step(order, 'approve', {}, pm);
    await step(order, 'issue');
  };

  await raise('planned', { status: 'planned' });
  const draft = await raise('draft', { extra: { ref: `HT-R${RUN}-${ctx.project.key}` } });
  await buyer.PATCH(`${P}/purchase-orders/${draft.id}`, { paymentTerms: `${draft.canary} 45 days from delivery`, deliveryTerms: `DAP site ${draft.canary}`, deliveryAddress: `${draft.canary} Gate 2, site compound`, taxRate: 5, notes: `${draft.canary} draft, header edited` });
  await step(await raise('pending'), 'submit');
  const approved = await raise('approved');
  await step(approved, 'submit');
  await step(approved, 'approve', {}, pm);
  const sentBack = await raise('sent_back', { supplier: orderable[orderable.length - 1] });
  await step(sentBack, 'submit');
  await step(sentBack, 'reject', { reason: `${sentBack.canary} quantities exceed the bill; reduce and resubmit` }, pm);
  await toIssued(await raise('issued'));
  const acknowledged = await raise('acknowledged');
  await toIssued(acknowledged);
  await step(acknowledged, 'acknowledge', { acknowledgedRef: `${acknowledged.canary}-ACK` });
  const cancelled = await raise('cancelled', { lineCount: 1 });
  await toIssued(cancelled);
  await step(cancelled, 'cancel', { reason: `${cancelled.canary} supplier could not meet the date` });
  const closedShort = await raise('closed', { lineCount: 1 });
  await toIssued(closedShort);
  await step(closedShort, 'close', { force: true, reason: `${closedShort.canary} closed short: balance no longer required` });
  // Extra orders in a random early state, so projects differ (one draw, not one per turn of the loop).
  const extras = ctx.count(0, 3);
  for (let index = 0; index < extras; index += 1) {
    const extra = await raise(`extra_${index + 1}`, { supplier: rng.pick(orderable) });
    const target = rng.pick(['draft', 'pending', 'issued']);
    if (target === 'pending') await step(extra, 'submit');
    if (target === 'issued') await toIssued(extra);
  }

  // The order for what was awarded, raised from the award (POST …/packages/:id/order).
  //
  // PRODUCT DEFECT: that route puts the package id on every order line, and the
  // lead-time alert is unique on (projectId, packageId) (schema.prisma model
  // ProcurementLeadTimeAlert). When a second line is at risk, or the package
  // already carries its own alert, syncLeadTimeAlert (procurement.service.js
  // 442-500) creates a second alert for the same package and the whole order is
  // refused as 409 CONFLICT with Prisma's raw message. Only that refusal (and the
  // business answers that cannot be right after a confirmed award) is worked
  // around, by writing the order out under the same package with a promised
  // date that puts no line at risk; it is noted as a product defect each time.
  // Any other refusal, and every 5xx, fails the run.
  {
    const pkg = packages.award;
    const canary = tag('procurement_order');
    const route = `${P}/procurement/packages/${pkg.id}/order`;
    const answer = await buyer.send('POST', route, { requiredBy: ctx.daysAhead(40), leadWeeks: 2, notes: `${canary} raised from the award of ${pkg.number}` });
    let fromAward;
    if (answer.status === 201) {
      fromAward = noteOrder('from_award', answer.body?.data || {});
      fromAward.canary = canary;
      fromAward.raisedFromAward = true;
      mine.orderFromAward = [...(mine.orderFromAward || []), { run: RUN, outcome: 'raised', orderId: fromAward.id }];
    } else {
      const error = new ApiError('POST', route, answer.status, answer.body);
      const workedAround = answer.status === 409 && ['CONFLICT', 'PROCUREMENT_NO_AWARD', 'PROCUREMENT_AWARD_INCOMPLETE', 'PROCUREMENT_AWARD_NOT_SCHEDULE_LINKED'].includes(error.code);
      if (!workedAround) throw error;
      productDefect('order raised from the award', error, { packageId: pkg.id, awardedLines: (pkg.lines || []).length });
      mine.orderFromAward = [...(mine.orderFromAward || []), { run: RUN, outcome: 'refused', status: answer.status, code: error.code }];
      const rates = new Map((pkg.winning?.lines || []).map((line) => [line.packageLineId, line]));
      const lines = (pkg.lines || [])
        .filter((line) => rates.get(line.id)?.included !== false)
        .map((line) => ({ activityId: line.activityId || pkg.row.activityId, costCodeId: line.costCodeId || pkg.row.costCodeId, budgetLineId: line.budgetLineId || pkg.row.budgetLineId, boqItemId: line.boqItemId || undefined, description: `${line.description.split(' — ')[0]} — ${tag('procurement_po_line')}`, unit: line.unit || 'nr', orderedQty: Math.max(1, Number(line.qty) || 1), unitCost: Number(rates.get(line.id)?.rate ?? line.estimateRate ?? 0) }));
      fromAward = await raise('from_award', { supplier: null, lines, extra: { supplier: pkg.winning?.companyName || mainSupplier.name, packageId: pkg.id, requiredBy: ctx.daysAhead(40), promisedDate: ctx.daysAhead(30), notes: `${canary} written out by the buyer: the order could not be raised from the award` } });
    }
    await toIssued(fromAward);
    await raise('against_commitment', { lineCount: 1, extra: { commitmentId: commitments[0] } });
  }

  // The orders the three-way match is run on: one delivered in full, one in part with a rejection, the rest not delivered.
  const delivered = await raise('delivered', { lineCount: 2 });
  await toIssued(delivered);
  await step(delivered, 'acknowledge', { acknowledgedRef: `${delivered.canary}-ACK` });
  const partDelivered = await raise('part_delivered', { lineCount: 1 });
  await toIssued(partDelivered);
  const undelivered = await raise('invoiced_undelivered', { lineCount: 1 });
  await toIssued(undelivered);
  const forReturn = await raise('invoice_returned', { lineCount: 1 });
  await toIssued(forReturn);
  {
    const fileCanary = tag('attachment');
    await attach(buyer, 'purchase order document', { recordType: 'procurement_order', recordId: delivered.id, filename: `${fileCanary}-order.pdf`, contentType: 'application/pdf', body: pdf(`${fileCanary} purchase order ${delivered.ref}`), caption: `${fileCanary} signed order` });
  }

  // ── deliveries, through the procurement door ─────────────────────────────
  // Goods need a warehouse. One the project or the company already has is used;
  // otherwise the company gets one central receiving store, made once. None of
  // this is an attempt: without the deliveries the invoices below would be
  // approved against orders nothing arrived on, and post as project cost
  // instead of stock — a different financial picture, so the run fails instead.
  const existingStores = listOf(await storeman.GET(`/inventory/warehouses?projectId=${ctx.project.id}`));
  const ownStores = existingStores.filter((w) => w.projectId === ctx.project.id);
  const centralStores = existingStores.filter((w) => !w.projectId);
  let warehouseId =
    (shared.warehouseId && existingStores.some((w) => w.id === shared.warehouseId) && shared.warehouseId) ||
    ownStores[0]?.id ||
    centralStores.find((w) => w.code === `RCV-${company.code}`)?.id ||
    centralStores[0]?.id ||
    null;
  if (!warehouseId) {
    const created = await storeman.POST('/inventory/warehouses', {
      code: `RCV-${company.code}`,
      name: `${company.canary} receiving store`,
      kind: 'central',
      address: `${companyTag('warehouse', 'rcv')} central yard, bay 1`,
      notes: `${companyTag('warehouse', 'rcv')} made by procurement to take deliveries`,
    });
    warehouseId = created.id;
    shared.warehouseId = created.id;
    recordCompany('warehouse', created.id);
  }
  if (!warehouseId) throw new Error('procurement: no warehouse to receive the deliveries into');

  /** What each order line had delivered, for the match inputs. */
  const receivedByLine = {};
  const receipts = [];
  const receive = async (order, portion) => {
    const canary = tag('delivery_receipt');
    const lines = order.lines.map((line) => ({
      poLineId: line.id,
      acceptedQty: Math.max(1, Math.floor(line.qty * portion.accepted)),
      rejectedQty: Math.floor(line.qty * (portion.rejected || 0)),
      notes: `${tag('delivery_receipt_line')} counted on arrival`,
    }));
    const receipt = await storeman.POST(`${P}/procurement/purchase-orders/${order.id}/receipts`, {
      receiptNumber: canary,
      warehouseId,
      receivedAt: new Date().toISOString(),
      receivedBy: `${canary} gate clerk`,
      deliveryNote: `${canary}-DN`,
      notes: `${canary} checked against the order`,
      lines,
    });
    record('delivery_receipt', receipt.receiptId);
    // The answer names the order line and the stocked item, not the receipt line:
    // receipt lines are recorded from the register read at the end.
    if ((receipt.lines || []).length !== lines.length) throw new Error(`procurement: the delivery against ${order.ref} answered ${(receipt.lines || []).length} lines for ${lines.length} sent`);
    for (const line of receipt.lines) recordCompany('inventory_item', line.itemId);
    for (const line of lines) receivedByLine[line.poLineId] = { acceptedQty: line.acceptedQty, rejectedQty: line.rejectedQty };
    receipts.push({ id: receipt.receiptId, number: receipt.receiptNumber, orderId: order.id, movements: Number(receipt.movements) || 0 });
    return receipt;
  };
  await receive(delivered, { accepted: 1 });
  await receive(partDelivered, { accepted: 0.5, rejected: 0.1 });

  // The stock movements the deliveries posted: one per accepted line, referenced by the receipt number.
  {
    const numbers = new Set(receipts.map((receipt) => receipt.number));
    const movements = listOf(await storeman.GET(`/inventory/stock/transactions?projectId=${ctx.project.id}&warehouseId=${warehouseId}&type=receipt&limit=500`)).filter((row) => numbers.has(row.reference));
    for (const row of movements) record('stock_transaction', row.id);
    const expected = receipts.reduce((sum, receipt) => sum + receipt.movements, 0);
    if (movements.length !== expected) ctx.note(`stock movements: the deliveries reported ${expected} movements, the stock ledger lists ${movements.length} with their receipt numbers`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 6. supplier invoices against order lines — the three-way match
  // ═════════════════════════════════════════════════════════════════════════
  const invoices = [];
  const invoiceFor = async (key, order, { qty = 1, price: priceFactor = 1 } = {}) => {
    const canary = tag('direct_cost');
    const sent = order.lines.map((line) => {
      const quantity = Math.max(1, Math.floor(line.qty * qty));
      const unitCost = round2(line.rate * priceFactor);
      const lineCanary = tag('direct_cost_line');
      return { description: `${line.description.split(' — ')[0]} — ${lineCanary}`, poLineId: line.id, activityId: line.activityId, costCodeId: line.costCodeId, budgetLineId: line.budgetLineId, costType: 'material', quantity, unit: line.unit, unitCost, amount: round2(quantity * unitCost), notes: `${lineCanary} as invoiced` };
    });
    const invoice = await cost.POST(`${P}/direct-costs`, {
      type: 'invoice',
      description: `Supplier invoice against ${order.ref} — ${canary}`,
      costDate: ctx.daysAgo(rng.int(0, 10)),
      dueDate: ctx.daysAhead(30),
      receivedDate: ctx.today,
      ...(supplierCompany ? { vendorCompanyId: supplierCompany } : { vendorName: mainSupplier.name }),
      invoiceNumber: `INV-R${RUN}-${ctx.project.key}-${key}`.slice(0, 80),
      purchaseOrderId: order.id,
      tax: 0,
      paymentTerms: `30 days ${canary}`,
      notes: `${canary} ${key}`,
      lines: sent,
    });
    record('direct_cost', invoice.id);
    if ((invoice.lines || []).length !== sent.length) throw new Error(`procurement: invoice ${key} answered ${(invoice.lines || []).length} lines for ${sent.length} sent`);
    for (const line of invoice.lines) record('direct_cost_line', line.id);
    const entry = {
      id: invoice.id,
      ref: invoice.ref,
      key,
      canary,
      purchaseOrderId: order.id,
      total: Number(invoice.total),
      status: invoice.status || 'draft',
      lines: sent.map((line) => ({ poLineId: line.poLineId, quantity: line.quantity, unitCost: line.unitCost })),
    };
    invoices.push(entry);
    return entry;
  };
  const move = async (invoice, action, body = {}, who = cost) => {
    const result = await who.POST(`${P}/direct-costs/${invoice.id}/${action}`, body);
    invoice.status = result?.status || invoice.status;
    return result;
  };
  const pay = async (invoice, share) => {
    const canary = tag('direct_cost_payment');
    const before = new Set(((await finance.GET(`${P}/direct-costs/${invoice.id}`)).payments || []).map((payment) => payment.id));
    const paid = await finance.POST(`${P}/direct-costs/${invoice.id}/payments`, { amount: round2(invoice.total * share), paidAt: new Date().toISOString(), method: 'bank transfer', reference: `${canary}-TT`, note: `${canary} ${share === 1 ? 'settled in full' : 'part payment'}` });
    const after = paid?.payments ? paid : await finance.GET(`${P}/direct-costs/${invoice.id}`);
    invoice.status = after?.status || invoice.status;
    for (const payment of after?.payments || []) if (!before.has(payment.id)) record('direct_cost_payment', payment.id);
  };

  // Delivered in full, invoiced exactly: approved and paid.
  const exact = await invoiceFor('EXACT', delivered);
  await move(exact, 'submit');
  await move(exact, 'approve', {}, finance);
  await pay(exact, 1);
  // Part delivered, invoiced in full at a higher price: quantity and price both flagged; waits for approval.
  const variance = await invoiceFor('VARIANCE', partDelivered, { price: 1.12 });
  await move(variance, 'submit');
  // Nothing delivered, invoiced anyway: left in draft.
  await invoiceFor('UNDELIVERED', undelivered, { qty: 0.5 });
  // Sent back by the PM with a reason.
  const returned = await invoiceFor('RETURNED', forReturn);
  await move(returned, 'submit');
  await move(returned, 'reject', { reason: `${returned.canary} no delivery note attached; resubmit with proof of delivery` }, pm);
  // Approved, then voided as a duplicate; and one approved and part paid.
  const voided = await invoiceFor('VOID', orders.acknowledged, { qty: 0.3 });
  await move(voided, 'submit');
  await move(voided, 'approve', {}, pm);
  await move(voided, 'void', { reason: `${voided.canary} duplicate of an invoice already booked` }, finance);
  const partPaid = await invoiceFor('PARTPAID', orders.issued, { qty: 0.4 });
  await move(partPaid, 'submit');
  await move(partPaid, 'approve', {}, pm);
  await pay(partPaid, 0.5);
  {
    const fileCanary = tag('attachment');
    await attach(cost, 'invoice scan', { recordType: 'direct_cost', recordId: exact.id, filename: `${fileCanary}-invoice.png`, contentType: 'image/png', body: PNG, caption: `${fileCanary} supplier invoice scan` });
  }

  // The match, read from both sides. What the API answered is kept as an
  // observation; what a test must derive its expectation from is kept beside
  // it: the quantities and prices the driver sent.
  const matches = [];
  for (const [key, order] of [['delivered', delivered], ['part_delivered', partDelivered], ['invoiced_undelivered', undelivered]]) {
    const match = await cost.GET(`/inventory/match/order/${order.id}`);
    matches.push({ run: RUN, key, orderId: order.id, verdict: match.verdict, flags: [...new Set((match.lines || []).flatMap((line) => (line.flags || []).map((flag) => flag.code)))] });
  }
  const fromInvoice = await cost.GET(`/inventory/match/invoice/${variance.id}`);
  matches.push({ run: RUN, key: 'invoice_variance', invoiceId: variance.id, verdict: fromInvoice.verdict });
  const matchInputs = [['delivered', delivered, exact], ['part_delivered', partDelivered, variance], ['invoiced_undelivered', undelivered, invoices.find((i) => i.key === 'UNDELIVERED')]].map(([key, order, invoice]) => ({
    run: RUN,
    key,
    orderId: order.id,
    invoiceId: invoice.id,
    invoiceStatus: invoice.status,
    lines: order.lines.map((line) => {
      const billed = invoice.lines.find((row) => row.poLineId === line.id);
      return {
        poLineId: line.id,
        orderedQty: line.qty,
        orderRate: line.rate,
        acceptedQty: receivedByLine[line.id]?.acceptedQty || 0,
        rejectedQty: receivedByLine[line.id]?.rejectedQty || 0,
        invoicedQty: billed?.quantity || 0,
        invoiceRate: billed?.unitCost ?? null,
      };
    }),
  }));

  // ── lead-time alerts raised by this run's packages and orders ────────────
  // Only those: on a re-run other drivers' orders may have raised alerts of their own.
  const runPackageIds = new Set(Object.values(packages).map((pkg) => pkg.id));
  const runOrderIds = new Set(Object.values(orders).map((order) => order.id));
  const alerts = listOf(await buyer.GET(`${P}/procurement/lead-time-alerts`)).filter((alert) => runPackageIds.has(alert.packageId) || runOrderIds.has(alert.orderId));
  for (const alert of alerts) record('procurement_lead_time_alert', alert.id);
  const openAlerts = alerts.filter((alert) => alert.status === 'open');
  if (!alerts.length) ctx.note(`lead-time alerts: none raised by this run, though package ${packages.late.number} is needed on site in 6 days on a 10-week lead`);
  if (openAlerts[0]) await buyer.PATCH(`${P}/procurement/lead-time-alerts/${openAlerts[0].id}/acknowledge`, { note: `${tag('procurement_lead_time_alert')} expediting with the supplier` });
  if (openAlerts[1]) await buyer.PATCH(`${P}/procurement/lead-time-alerts/${openAlerts[1].id}/resolve`, { note: `${tag('procurement_lead_time_alert')} alternative source confirmed` });
  if (openAlerts[2]) await buyer.PATCH(`${P}/procurement/lead-time-alerts/${openAlerts[2].id}`, { status: 'acknowledged' });

  // ═════════════════════════════════════════════════════════════════════════
  // what later drivers are told: read back from the register, so it is true
  // ═════════════════════════════════════════════════════════════════════════
  const register = listOf(await buyer.GET(`${P}/procurement/purchase-orders`));
  // Receipt lines are not in the delivery's answer; they are on the register.
  // Every receipt already recorded on this project gets its lines recorded too
  // (which also fills in the lines of receipts an earlier version of this
  // driver made without them).
  for (const order of register) {
    for (const receipt of order.deliveryReceipts || []) {
      if (!seen.has(receipt.id)) continue;
      for (const line of receipt.lines || []) record('delivery_receipt_line', line.id);
    }
  }
  for (const receipt of receipts) {
    const onRegister = register.flatMap((order) => order.deliveryReceipts || []).find((row) => row.id === receipt.id);
    if (!onRegister?.lines?.length) throw new Error(`procurement: delivery ${receipt.number} is not on the register with its lines`);
  }
  // Which orders this driver has invoiced, and how far: a later driver that
  // receives against an order already billed and approved books the same goods twice.
  const invoiceStatus = {};
  for (const invoice of [...(mine.invoices || []), ...invoices]) invoiceStatus[invoice.purchaseOrderId] = invoice.status;
  ctx.refs.purchaseOrders = register.map((order) => ({
    id: order.id,
    ref: order.ref,
    status: order.status,
    supplierId: order.supplierId || null,
    packageId: order.packageId || null,
    invoiceStatus: invoiceStatus[order.id] || null,
    lines: (order.lines || []).map((line) => ({
      id: line.id,
      description: line.description,
      unit: line.unit,
      qty: Number(line.orderedQty),
      rate: Number(line.unitCost),
      receivedQty: Number(line.receivedQty || 0),
      activityId: line.activityId,
      costCodeId: line.costCodeId || null,
      budgetLineId: line.budgetLineId || null,
    })),
  }));
  const allSuppliers = listOf(await buyer.GET(`${P}/procurement/suppliers`));
  ctx.refs.suppliers = allSuppliers.map((supplier) => supplier.id);
  ctx.refs.supplierRows = allSuppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, status: supplier.status, companyId: supplier.companyId || null }));
  mine.packages = { ...(mine.packages || {}), ...Object.fromEntries(Object.values(packages).map((pkg) => [pkg.number, pkg.id])) };
  mine.enquiries = [...(mine.enquiries || []), ...enquiries];
  mine.commitments = [...(mine.commitments || []), ...commitments];
  mine.invoices = [...(mine.invoices || []), ...invoices.map(({ id, ref, key, purchaseOrderId, status }) => ({ run: RUN, id, ref, key, purchaseOrderId, status }))];
  mine.longLead = [...(mine.longLead || []), ...longLead];
  mine.orders = { ...(mine.orders || {}), ...Object.fromEntries(Object.entries(orders).map(([key, order]) => [`r${RUN}:${key}`, order.id])) };
  mine.receipts = [...(mine.receipts || []), ...receipts.map(({ id, number, orderId }) => ({ run: RUN, id, number, orderId }))];
  mine.alerts = [...(mine.alerts || []), { run: RUN, ids: alerts.map((alert) => alert.id), acknowledged: [openAlerts[0], openAlerts[2]].filter(Boolean).map((a) => a.id), resolved: openAlerts[1] ? [openAlerts[1].id] : [] }];
  // Observations, not expectations (see the header): derive expected verdicts from matchInputs.
  mine.matches = [...(mine.matches || []).map((m) => ({ run: m.run || 1, ...m })), ...matches];
  mine.matchInputs = [...(mine.matchInputs || []), ...matchInputs];
  mine.defects = [...(mine.defects || []), ...defects];
  mine.warehouseId = warehouseId;
};

module.exports = { name: 'procurement', needs: ['foundation'], depths: ['standard'], run };
