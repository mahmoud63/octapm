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
 *                    supplier invoices against order lines (the three-way
 *                    match): paid, part paid, pending with a price variance,
 *                    draft and undelivered, returned, void
 *
 * Every line that carries money names an activity. Every record carries one
 * canary in each text it holds. A second run makes a second set: codes the
 * driver invents carry the run number kept in `ctx.refs.procurement.runs`.
 *
 * Left for later drivers: `ctx.refs.purchaseOrders` (id, ref, status, lines
 * with id / description / qty / rate), `ctx.refs.suppliers` (ids),
 * `ctx.refs.supplierRows` and `ctx.refs.procurement` (packages, enquiries,
 * commitments, invoices, orders by scenario, the warehouse deliveries went to).
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
  /** Records an id once, however often a re-run meets the same row again. */
  const seen = new Set(Object.values(ctx.records).flat());
  const record = (type, id) => {
    if (!id || seen.has(id)) return id;
    seen.add(id);
    return ctx.record(type, id);
  };
  const recordCompany = (type, id) => {
    if (!id || shared.recorded[id]) return id;
    shared.recorded[id] = type;
    return ctx.record(type, id, { scope: 'company' });
  };
  const mailbox = (name) => `${name}.r${RUN}.${ctx.project.key}@bidders.c${company.code}.octapm-cert.test`.toLowerCase();
  const attach = async (who, label, { recordType, recordId, filename, contentType, body, caption }) =>
    ctx.attempt(label, async () => {
      const attached = await who.upload('POST', `${P}/attachments`, { field: 'files', filename, contentType, body, fields: { recordType, recordId, caption } });
      for (const row of listOf(attached?.attachments || attached)) {
        record('attachment', row.id);
        if (row.documentId) record('project_document', row.documentId);
      }
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

  await ctx.attempt('directory vendors and prequalification', async () => {
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
          paymentTerms: '30 days from invoice',
          notes: `${canary} added by procurement`,
          leadTimeReliability: 70 + index * 5,
        });
        shared.vendors[vendor.key] = created.id;
        recordCompany('company', created.id);
      }
      await assess(shared.vendors[vendor.key], vendor.outcome, vendor.key);
    }
  });
  const qualified = async (companyId) => {
    if (!companyId) return false;
    const state = await ctx.attempt('read prequalification', () => buyer.GET(`/company/vendors/${companyId}/prequalification`));
    return Boolean(state?.qualified);
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
  const LONG = [
    ['Tower crane hire', 'not_ordered', 'not_received'], ['Generator set 500 kVA', 'ordered', 'not_received'],
    ['Lift installation', 'ordered', 'partial'], ['Curtain wall panels', 'delivered', 'received'],
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
      ...(directorySupplier ? [{ vendorCompanyId: directorySupplier, qualified: directoryQualified, contactName: 'Directory supplier sales', contactEmail: mailbox('directory') }] : []),
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
        await ctx.attempt('priced form uploaded by a bidder', async () => {
          const fileCanary = tag('project_document');
          const uploaded = await portal('POST', priced.token, '/upload', undefined, multipart({ field: 'file', filename: `${fileCanary}-priced-form.pdf`, contentType: 'application/pdf', body: pdf(`${fileCanary} priced form from ${bidder.contactName}`) }));
          if (uploaded?.documentId) record('project_document', uploaded.documentId);
        });
        await portal('GET', priced.token);
      }
      await portal('POST', priced.token, '/bid/submit', { submittedBy: `${bidder.contactName} ${bidder.canary}` });
    }

    await buyer.GET(`${P}/bids/${enquiry.id}/leveling`);
    await ctx.attempt('leveling workbook', () => buyer.download(`${P}/bids/${enquiry.id}/leveling.xlsx`));
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
    const commitmentId = confirmed.body.data?.commitment?.id;
    let vendorCompanyId = null;
    if (commitmentId) {
      record('commitment', commitmentId);
      commitments.push(commitmentId);
      const commitment = await ctx.attempt('read the awarded commitment', () => buyer.GET(`${P}/commitments/${commitmentId}`));
      for (const line of commitment?.lines || commitment?.sovLines || []) record('commitment_sov_line', line.id);
      vendorCompanyId = commitment?.vendorCompanyId || commitment?.vendor?.id || null;
      if (vendorCompanyId && vendorCompanyId !== directorySupplier && !Object.values(shared.vendors).includes(vendorCompanyId)) recordCompany('company', vendorCompanyId);
    }
    enquiries.push({ id: enquiry.id, ref: enquiry.ref, status: 'awarded', procurementPackageId: pkg.id, commitmentId: commitmentId || null, awardedBidId: winning.id, vendorCompanyId });
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
    if (shared.vendors.rebar) bidders.push({ vendorCompanyId: shared.vendors.rebar, qualified: await qualified(shared.vendors.rebar), contactName: 'Rebar Mills sales', contactEmail: mailbox('rebarmills') });
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
      currency: company.currency || 'USD',
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
  await buyer.PATCH(`${P}/purchase-orders/${draft.id}`, { paymentTerms: `${draft.canary} 45 days from delivery`, deliveryTerms: 'DAP site', deliveryAddress: `${draft.canary} Gate 2, site compound`, taxRate: 5, notes: `${draft.canary} draft, header edited` });
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
  // Extra orders in a random early state, so projects differ.
  for (let index = 0; index < ctx.count(0, 3); index += 1) {
    const extra = await raise(`extra_${index + 1}`, { supplier: rng.pick(orderable) });
    const target = rng.pick(['draft', 'pending', 'issued']);
    if (target === 'pending') await step(extra, 'submit');
    if (target === 'issued') await toIssued(extra);
  }

  // The order for what was awarded: raised from the award where the product allows it,
  // otherwise written out by the buyer under the same package.
  {
    const pkg = packages.award;
    const canary = tag('procurement_order');
    const raised = await ctx.attempt('order raised from the award', () => buyer.POST(`${P}/procurement/packages/${pkg.id}/order`, { requiredBy: ctx.daysAhead(40), leadWeeks: 2, notes: `${canary} raised from the award of ${pkg.number}` }));
    let fromAward = raised ? noteOrder('from_award', raised) : null;
    if (!fromAward) {
      const rates = new Map((pkg.winning?.lines || []).map((line) => [line.packageLineId, line]));
      const lines = (pkg.lines || [])
        .filter((line) => rates.get(line.id)?.included !== false)
        .map((line) => ({ activityId: line.activityId || pkg.row.activityId, costCodeId: line.costCodeId || pkg.row.costCodeId, budgetLineId: line.budgetLineId || pkg.row.budgetLineId, boqItemId: line.boqItemId || undefined, description: `${line.description.split(' — ')[0]} — ${tag('procurement_po_line')}`, unit: line.unit || 'nr', orderedQty: Math.max(1, Number(line.qty) || 1), unitCost: Number(rates.get(line.id)?.rate ?? line.estimateRate ?? 0) }));
      // A promised date inside the required date: an order under a package may not put two lines at risk (see the driver's report).
      fromAward = await raise('from_award', { supplier: null, lines, extra: { supplier: pkg.winning?.companyName || mainSupplier.name, packageId: pkg.id, requiredBy: ctx.daysAhead(40), promisedDate: ctx.daysAhead(30), notes: `${canary} written out by the buyer: the order could not be raised from the award` } });
    }
    await toIssued(fromAward);
    if (commitments[0]) await raise('against_commitment', { lineCount: 1, extra: { commitmentId: commitments[0] } });
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
  // otherwise the company gets one central receiving store, made once.
  let warehouseId = null;
  await ctx.attempt('a warehouse to receive into', async () => {
    const existing = listOf(await storeman.GET(`/inventory/warehouses?projectId=${ctx.project.id}`));
    const own = existing.filter((w) => w.projectId === ctx.project.id);
    const central = existing.filter((w) => !w.projectId);
    warehouseId = (shared.warehouseId && existing.some((w) => w.id === shared.warehouseId) && shared.warehouseId) || own[0]?.id || central[0]?.id || null;
    if (warehouseId) return;
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
  });
  const receive = async (order, portion) => {
    if (!warehouseId) return null;
    return ctx.attempt(`delivery against ${order.ref}`, async () => {
      const canary = tag('delivery_receipt');
      const receipt = await storeman.POST(`${P}/procurement/purchase-orders/${order.id}/receipts`, {
        receiptNumber: canary,
        warehouseId,
        receivedAt: new Date().toISOString(),
        receivedBy: `${canary} gate clerk`,
        deliveryNote: `${canary}-DN`,
        notes: `${canary} checked against the order`,
        lines: order.lines.map((line) => ({
          poLineId: line.id,
          acceptedQty: Math.max(1, Math.floor(line.qty * portion.accepted)),
          rejectedQty: Math.floor(line.qty * (portion.rejected || 0)),
          notes: `${tag('delivery_receipt_line')} counted on arrival`,
        })),
      });
      record('delivery_receipt', receipt.receiptId);
      for (const line of receipt.lines || []) {
        if (line.receiptLineId) record('delivery_receipt_line', line.receiptLineId);
        if (line.itemId) recordCompany('inventory_item', line.itemId);
      }
      return receipt;
    });
  };
  await receive(delivered, { accepted: 1 });
  await receive(partDelivered, { accepted: 0.5, rejected: 0.1 });

  // ═════════════════════════════════════════════════════════════════════════
  // 6. supplier invoices against order lines — the three-way match
  // ═════════════════════════════════════════════════════════════════════════
  const invoices = [];
  const invoiceFor = async (key, order, { qty = 1, price: priceFactor = 1 } = {}) => {
    const canary = tag('direct_cost');
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
      paymentTerms: '30 days',
      notes: `${canary} ${key}`,
      lines: order.lines.map((line) => {
        const quantity = Math.max(1, Math.floor(line.qty * qty));
        const unitCost = round2(line.rate * priceFactor);
        const lineCanary = tag('direct_cost_line');
        return { description: `${line.description.split(' — ')[0]} — ${lineCanary}`, poLineId: line.id, activityId: line.activityId, costCodeId: line.costCodeId, budgetLineId: line.budgetLineId, costType: 'material', quantity, unit: line.unit, unitCost, amount: round2(quantity * unitCost), notes: `${lineCanary} as invoiced` };
      }),
    });
    record('direct_cost', invoice.id);
    for (const line of invoice.lines || []) record('direct_cost_line', line.id);
    const entry = { id: invoice.id, ref: invoice.ref, key, canary, purchaseOrderId: order.id, total: Number(invoice.total), status: invoice.status || 'draft' };
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

  // The match, read from both sides; the verdicts are kept for whoever tests them.
  const matches = [];
  await ctx.attempt('three-way match', async () => {
    for (const [key, order] of [['delivered', delivered], ['part_delivered', partDelivered], ['invoiced_undelivered', undelivered]]) {
      const match = await cost.GET(`/inventory/match/order/${order.id}`);
      matches.push({ key, orderId: order.id, verdict: match.verdict, flags: [...new Set((match.lines || []).flatMap((line) => (line.flags || []).map((flag) => flag.code)))] });
    }
    const fromInvoice = await cost.GET(`/inventory/match/invoice/${variance.id}`);
    matches.push({ key: 'invoice_variance', invoiceId: variance.id, verdict: fromInvoice.verdict });
  });

  // ── lead-time alerts raised by the late package and the orders ───────────
  await ctx.attempt('lead-time alerts', async () => {
    const alerts = listOf(await buyer.GET(`${P}/procurement/lead-time-alerts`)).filter((alert) => alert.status === 'open' && !seen.has(alert.id));
    for (const alert of alerts) record('procurement_lead_time_alert', alert.id);
    if (alerts[0]) await buyer.PATCH(`${P}/procurement/lead-time-alerts/${alerts[0].id}/acknowledge`, { note: `${tag('procurement_lead_time_alert')} expediting with the supplier` });
    if (alerts[1]) await buyer.PATCH(`${P}/procurement/lead-time-alerts/${alerts[1].id}/resolve`, { note: `${tag('procurement_lead_time_alert')} alternative source confirmed` });
    if (alerts[2]) await buyer.PATCH(`${P}/procurement/lead-time-alerts/${alerts[2].id}`, { status: 'acknowledged' });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // what later drivers are told: read back from the register, so it is true
  // ═════════════════════════════════════════════════════════════════════════
  const register = listOf(await buyer.GET(`${P}/procurement/purchase-orders`));
  ctx.refs.purchaseOrders = register.map((order) => ({
    id: order.id,
    ref: order.ref,
    status: order.status,
    supplierId: order.supplierId || null,
    packageId: order.packageId || null,
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
  mine.invoices = [...(mine.invoices || []), ...invoices.map(({ id, ref, key, purchaseOrderId, status }) => ({ id, ref, key, purchaseOrderId, status }))];
  mine.longLead = [...(mine.longLead || []), ...longLead];
  mine.orders = { ...(mine.orders || {}), ...Object.fromEntries(Object.entries(orders).map(([key, order]) => [`r${RUN}:${key}`, order.id])) };
  mine.matches = matches;
  mine.warehouseId = warehouseId;
};

module.exports = { name: 'procurement', needs: ['foundation'], depths: ['standard'], run };
