'use strict';

/**
 * L35 — a supplier invoice approved before the goods receipt double-counts
 * stocked material.
 *
 * The rules: a goods receipt is an inventory asset, not actual cost; a
 * supplier invoice for stock is not actual cost; a material issue is actual
 * cost at the weighted average. So one purchase of 10 @ 100.00, received into
 * the store and issued to an activity, is 1,000.00 of actual cost — whatever
 * order the paperwork arrives in.
 *
 * The lead: the invoice line is capitalised only when the PO line already
 * carries an inventory item, and only a goods receipt sets that. An invoice
 * approved first posts 1,000.00 to the cost ledger; the receipt then creates
 * 1,000.00 of stock; the issue posts 1,000.00 again.
 *
 * A new project in company 041, two identical purchases of 10 @ 100.00:
 *   CONTROL  receipt -> invoice -> issue      paper 1,000.00
 *   CASE     invoice -> receipt -> issue      paper 1,000.00 (lead: 2,000.00)
 *
 * Exit code 0 = both purchases cost 1,000.00; 2 = the invoice-first purchase
 * is counted twice.
 */

const { call, must, who, personOf, newProject, projectCostCodes, section, say, dayOffset, eq, listOf, verdict, run } = require('./_finance-lib');

const LEAD = 'L35';
const COMPANY = '041';
const money = (value) => (value === null || value === undefined ? String(value) : Number(value).toFixed(2));

run(LEAD, async () => {
  const pm = who(COMPANY, 'pm');
  const cost = who(COMPANY, 'cost');
  const finance = who(COMPANY, 'finance');
  const procurement = who(COMPANY, 'procurement');
  const store = who(COMPANY, 'warehouse');
  const tag = `L35-${Date.now().toString(36).toUpperCase()}`;

  section('0. a project of its own: a material budget line, two activities, a supplier, a store');
  const { id: projectId, P } = await newProject(COMPANY, 'L35 invoice before receipt', { team: ['cost', 'finance', 'procurement', 'warehouse', 'site'] });
  const codes = await projectCostCodes(COMPANY, P);
  const costCodeId = codes['02-100'] || Object.values(codes)[0];
  const line = await must(pm, 'POST', `${P}/budget/lines`, { costCodeId, costType: 'material', description: 'L35 material', originalBudget: 50000, status: 'active' }, { show: (d) => ({ id: d.id, costType: d.costType }) });
  const activity = {};
  for (const key of ['CONTROL', 'CASE']) {
    const row = await must(pm, 'POST', `${P}/activities`, { name: `L35 ${key} activity`, activityCode: `L35-${key}`, duration: 10, startDate: dayOffset(-30), endDate: dayOffset(-10), engineerIds: [personOf(COMPANY, 'site').id] }, { show: (d) => ({ id: d.id, activityCode: d.activityCode }) });
    activity[key] = row.id;
  }
  const supplier = await must(procurement, 'POST', `${P}/procurement/suppliers`, { name: `${tag} Supply`, code: tag, status: 'approved' }, { show: (d) => ({ id: d.id, name: d.name }) });
  const warehouse = await must(store, 'POST', '/inventory/warehouses', { code: tag, name: `${tag} store`, kind: 'site', projectId }, { show: (d) => ({ id: d.id, code: d.code }) });

  // ── helpers ──────────────────────────────────────────────────────────────
  const ledger = async (label) => {
    const data = await must(cost, 'GET', `${P}/cost/reconciliation`, undefined, {
      show: (d) => ({ ledgerTotal: d.ledger?.total, entries: d.ledger?.entries, bySource: d.ledger?.bySource, budgetRecorded: d.budget?.recordedTotal, activityRecorded: d.activity?.recordedTotal, balanced: d.balanced }),
    });
    return { label, total: Number(data.ledger?.total || 0), bySource: data.ledger?.bySource || {}, balanced: data.balanced };
  };
  const activityCost = async (key) => {
    const data = await must(cost, 'GET', `${P}/cost/reconciliation/explain?activityId=${activity[key]}&limit=500`, undefined, { quiet: true });
    const entries = listOf(data, 'entries');
    say(`   ledger of the ${key} activity: ${entries.map((e) => `${e.sourceType} ${money(e.amount)}`).join(' | ') || '(none)'}`);
    return Math.round(entries.reduce((sum, e) => sum + Number(e.amount), 0) * 100) / 100;
  };

  const order = async (key) => {
    const sku = `${tag}-${key}`;
    const item = await must(store, 'POST', '/inventory/items', { sku, name: `${sku} cement`, unit: 'bag', category: 'material', projectId }, { quiet: true });
    const created = await must(
      procurement,
      'POST',
      `${P}/procurement/purchase-orders`,
      { ref: `PO-${sku}`, supplierId: supplier.id, status: 'draft', currency: 'EUR', orderDate: dayOffset(-12), requiredBy: dayOffset(-5), lines: [{ lineNumber: 1, activityId: activity[key], costCodeId, itemCode: sku, description: `${sku} cement`, unit: 'bag', orderedQty: 10, unitCost: 100 }] },
      { show: (d) => ({ id: d.id, ref: d.ref, status: d.status }) }
    );
    await must(procurement, 'POST', `${P}/purchase-orders/${created.id}/submit`, {}, { quiet: true });
    await must(pm, 'POST', `${P}/purchase-orders/${created.id}/approve`, {}, { quiet: true });
    await must(procurement, 'POST', `${P}/purchase-orders/${created.id}/issue`, {}, { quiet: true });
    const read = await must(store, 'GET', `/inventory/purchase-orders/${created.id}`, undefined, { quiet: true });
    const poLine = (read.lines || [])[0];
    say(`   ${key}: order ${created.ref} issued — 10 bags @ 100.00 = 1,000.00; PO line ${poLine.id}, inventoryItemId on the line: ${poLine.inventoryItemId ?? null}`);
    return { key, orderId: created.id, poLineId: poLine.id, itemId: item.id, sku };
  };

  const invoice = async (o, suffix = "") => {
    const created = await must(
      cost,
      'POST',
      `${P}/direct-costs`,
      {
        type: 'invoice',
        description: `Supplier invoice for ${o.sku}`,
        vendorName: `${tag} Supply`,
        invoiceNumber: `INV-${o.sku}${suffix}`,
        costDate: dayOffset(-4),
        purchaseOrderId: o.orderId,
        lines: [{ description: `${o.sku} cement, 10 bags`, poLineId: o.poLineId, costCodeId, budgetLineId: line.id, activityId: activity[o.key], costType: 'material', quantity: 10, unit: 'bag', unitCost: 100, amount: 1000 }],
      },
      { show: (d) => ({ id: d.id, ref: d.ref, status: d.status, total: d.total }) }
    );
    await must(cost, 'POST', `${P}/direct-costs/${created.id}/submit`, {}, { quiet: true });
    const approved = await must(finance, 'POST', `${P}/direct-costs/${created.id}/approve`, {}, { show: (d) => ({ status: d.status, lines: (d.lines || []).map((l) => ({ amount: l.amount, postedAmount: l.postedAmount })), notes: d.notes }) });
    return { id: created.id, posted: Number(approved.lines?.[0]?.postedAmount || 0) };
  };

  const receive = async (o) => {
    await must(store, 'POST', '/inventory/goods-receipt', { orderId: o.orderId, warehouseId: warehouse.id, deliveryNote: `DN-${o.sku}`, lines: [{ poLineId: o.poLineId, acceptedQty: 10, rejectedQty: 0, inventoryItemId: o.itemId }] }, { show: (d) => ({ receiptNumber: d.receiptNumber, status: d.status }) });
    const item = await must(store, 'GET', `/inventory/items/${o.itemId}`, undefined, { show: (d) => ({ onHand: d.onHand, averageCost: d.averageCost, stockValue: d.stockValue }) });
    return item;
  };

  const issue = async (o) => {
    const done = await must(store, 'POST', '/inventory/stock/issue', { itemId: o.itemId, warehouseId: warehouse.id, quantity: 10, projectId, activityId: activity[o.key], costCodeId, reference: `ISSUE-${o.sku}` }, { show: (d) => ({ costPosted: d.costPosted, movements: (d.movements || []).map((m) => ({ type: m.type, quantity: m.quantity, unitCost: m.unitCost, value: m.value })) }) });
    return done;
  };

  // ── control ──────────────────────────────────────────────────────────────
  section('1. CONTROL — receipt, then invoice, then issue');
  const control = await order('CONTROL');
  await receive(control);
  const afterControlReceipt = await ledger('after the control receipt');
  const { posted: controlPosted } = await invoice(control);
  say(`   the invoice line posted ${money(controlPosted)} to project cost (expected 0.00: it bought stock)`);
  await issue(control);
  const controlCost = await activityCost('CONTROL');
  const afterControl = await ledger('after the control purchase');

  // ── the case ─────────────────────────────────────────────────────────────
  section('2. THE CASE — invoice, then receipt, then issue');
  const theCase = await order('CASE');
  const { id: caseInvoiceId, posted: casePosted } = await invoice(theCase);
  say(`   the invoice line posted ${money(casePosted)} to project cost (the goods are not received yet)`);
  const afterInvoice = await ledger('after the invoice');
  const stocked = await receive(theCase);
  const afterReceipt = await ledger('after the receipt');
  say(`   the receipt put ${money(stocked.stockValue ?? Number(stocked.onHand) * Number(stocked.averageCost))} of stock on the shelf; the ledger moved by ${money(afterReceipt.total - afterInvoice.total)} (expected: the invoice's ${money(casePosted)} comes off, or the invoice had posted nothing)`);
  await issue(theCase);
  const caseCost = await activityCost('CASE');
  const end = await ledger('at the end');
  const read = await must(cost, 'GET', `${P}/budget/lines`, undefined, { show: (d) => ({ actual: d.summary?.totals?.actual, committed: d.summary?.totals?.committed }) });
  await call(store, "GET", `/inventory/match/order/${theCase.orderId}`, undefined, { show: (d) => ({ verdict: d.verdict, totals: d.totals }) });

  // ── result ───────────────────────────────────────────────────────────────
  section('result');
  say('   one purchase of 10 @ 100.00, received and wholly issued, is 1,000.00 of actual cost.');
  say(`   CONTROL (receipt -> invoice -> issue): activity cost ${money(controlCost)}; ledger after it ${money(afterControl.total)} (before any invoice: ${money(afterControlReceipt.total)})`);
  say(`   CASE    (invoice -> receipt -> issue): activity cost ${money(caseCost)}; ledger moved from ${money(afterControl.total)} to ${money(end.total)} = ${money(end.total - afterControl.total)}`);
  say(`   project: paper 2,000.00 for the two purchases; ledger ${money(end.total)} ${JSON.stringify(end.bySource)}; budget line actual ${money(read.summary?.totals?.actual)}; reconciliation balanced: ${end.balanced}`);

  const controlRight = eq(controlCost, 1000) && eq(afterControl.total, 1000);
  const caseRight = eq(caseCost, 1000) && eq(end.total - afterControl.total, 1000);

  // The way back the product offers, while the invoice is unpaid: void it and enter it again.
  let wayBack = '';
  if (controlRight && !caseRight) {
    section('3. the way back while the invoice is unpaid: void it, enter it again');
    const voided = await call(finance, 'POST', `${P}/direct-costs/${caseInvoiceId}/void`, { reason: 'L35: approved before the goods were received; counted twice' }, { show: (d) => ({ status: d.status }) });
    const afterVoid = await ledger('after the void');
    const again = voided.ok ? await invoice(theCase, '-R') : null;
    const afterAgain = await ledger('after the invoice was entered again');
    wayBack = voided.ok && again && eq(again.posted, 0) && eq(afterAgain.total, 2000)
      ? ' Voiding the unpaid invoice and entering it again after the receipt puts the ledger right (2,000.00); nothing tells the user to.'
      : ` Voiding and re-entering the invoice left the ledger at ${money(afterAgain.total)} (void ${voided.status}, ledger after the void ${money(afterVoid.total)}).`;
    say(`  ${wayBack}`);
  }
  if (!controlRight) {
    return verdict(LEAD, 'PARTLY_CONFIRMED', `the control itself is wrong: receipt -> invoice -> issue cost ${money(controlCost)} (ledger ${money(afterControl.total)}) where 1,000.00 is right; the invoice-first purchase cost ${money(caseCost)}.`);
  }
  if (caseRight) {
    return verdict(LEAD, 'NOT_REPRODUCED', 'the invoice-first purchase cost 1,000.00, the same as the receipt-first one.');
  }
  return verdict(
    LEAD,
    'CONFIRMED',
    `the same purchase of 10 @ 100.00 costs 1,000.00 when the receipt comes first and ${money(end.total - afterControl.total)} when the invoice is approved first (invoice ${money(casePosted)} + issue 1,000.00); the ledger shows ${money(end.total)} for 2,000.00 of material and the reconciliation says balanced: ${end.balanced}.${wayBack}`
  );
});
