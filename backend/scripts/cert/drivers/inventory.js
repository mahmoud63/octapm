'use strict';

/**
 * Inventory and the warehouse: where material is held, what arrives, what is
 * issued to an activity (the moment stock becomes project cost), what comes
 * back, and what moves between stores.
 *
 * One run of this driver, for one project:
 *
 *   warehouses      a site store and a laydown yard (the project's), a central
 *                   store (the company's, made once), and a temporary store
 *                   that is renamed and archived
 *   locations       zone > aisle > rack > shelf > bins in the site store, a
 *                   quarantine cage, one zone in each other store
 *   items           two to five project items, one company item (made once),
 *                   one item that is archived
 *   material plan   activity materials for some items, one cancelled
 *   purchase orders three of the driver's own: A (acknowledged, delivered in
 *                   two receipts, left partial), B (delivered in full through
 *                   the procurement door, left received), C (issued, nothing
 *                   delivered) — plus one receipt against an order the
 *                   procurement driver left, when there is one to receive
 *   receipts        goods receipts against those orders, a delivery note
 *                   attached to the first, two direct receipts (one with
 *                   damage on delivery)
 *   movements       adjust up and down, damage, quarantine, release, reserve
 *                   and part-release, issues to an activity and a cost code by
 *                   the site engineer, the quality engineer and the storeman,
 *                   returns of less than was issued
 *   transfers       received in full, received short and damaged, in transit,
 *                   draft
 *   three-way match a draft supplier invoice against order B at another price
 *
 * Everything that posts cost names an activity and a cost code. Quantities
 * are small: a run adds a few hundred of actual material cost to the project.
 *
 * The driver also checks the product's arithmetic as it goes and writes a
 * note (never a failure) when a figure is not what the movements say it
 * should be: the price an issue leaves at, the weighted average and the stock
 * of every item it moved, and the cost ledger's material-issue total.
 *
 * It can be run again: stores, locations, items and plan rows are found by
 * their code, and everything else (orders, receipts, movements, transfers) is
 * made afresh with numbers of its own.
 */

const CATALOGUE = [
  // suffix, name, stock unit, plan unit, category, cost code, unit cost range
  ['CEM', 'Cement OPC 42.5N (50kg bag)', 'bag', 'BAG', 'cement', '02-100', [6, 12]],
  ['REB', 'Rebar T16 B500B (12m bar)', 'pcs', 'PCS', 'steel', '02-200', [9, 16]],
  ['BLK', 'Concrete block 200mm', 'pcs', 'PCS', 'masonry', '02-100', [1, 3]],
  ['SND', 'Washed sand', 'm3', 'M3', 'aggregate', '02-100', [15, 30]],
  ['MSH', 'Welded mesh A193', 'sheet', 'SHEET', 'steel', '02-200', [20, 45]],
];

const listOf = (data) => (Array.isArray(data) ? data : data?.items || []);
const round = (value, dp = 4) => Math.round((Number(value) || 0) * 10 ** dp) / 10 ** dp;
const money = (value) => round(value, 2);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every id in whatever shape another driver left its purchase orders in. */
const idsIn = (value, out = []) => {
  if (!value) return out;
  if (typeof value === 'string') {
    if (UUID.test(value)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) idsIn(entry, out);
  } else if (typeof value === 'object') {
    if (typeof value.id === 'string' && UUID.test(value.id)) out.push(value.id);
    else for (const entry of Object.values(value)) idsIn(entry, out);
  }
  return out;
};

/**
 * Books half of what is outstanding on the first line of the first order, of
 * those named, that a delivery can still arrive against. Returns the order
 * and the stocked items the product made for it (a line with no stocked item
 * gets one on its first receipt), or null when no order was open.
 */
const receiveOpenOrder = async ({ ctx, wh, candidates, receiveAtStore, locationId, startedAt }) => {
  for (const orderId of [...new Set(candidates)].slice(0, 8)) {
    const order = await ctx.attempt('procurement order lookup', () => wh.GET(`/inventory/purchase-orders/${orderId}`));
    if (!order || !['issued', 'acknowledged', 'partial'].includes(order.status)) continue;
    const line = (order.lines || []).find((candidate) => Number(candidate.outstandingQty) > 0);
    if (!line) continue;
    const outstanding = Number(line.outstandingQty);
    const acceptedQty = outstanding >= 2 ? Math.floor(outstanding / 2) : outstanding;
    return ctx.attempt('receipt against a procurement order', async () => {
      const result = await receiveAtStore(order, [{ poLineId: line.id, acceptedQty, rejectedQty: 0, locationId, notes: ctx.canary('delivery_receipt_line') }], `Part delivery of ${order.ref}`);
      const itemsMade = [];
      for (const row of result.lines || []) {
        const item = await wh.GET(`/inventory/items/${row.itemId}`);
        if (item.createdAt >= startedAt) itemsMade.push(item);
      }
      return { orderId, receiptId: result.receiptId, itemsMade };
    });
  }
  return null;
};

/** A one-page PDF that says `text`. */
const pdf = (text) => {
  const stream = `BT /F1 9 Tf 12 100 Td (${String(text).replace(/[()\\]/g, ' ')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
};

const run = async (ctx) => {
  const { P, rng, company } = ctx;
  const pid = ctx.project.id;
  const key = ctx.project.key;
  const pm = ctx.who('pm');
  const wh = ctx.who('warehouse');
  const buyer = ctx.who('procurement');
  const planner = ctx.who('planner');
  const site = ctx.who('site');
  const quality = ctx.who('quality');
  const cost = ctx.who('cost');

  const startedAt = new Date(Date.now() - 5000).toISOString();
  const stamp = Date.now().toString(36);

  const inv = (ctx.refs.inventory = ctx.refs.inventory || {});
  inv.run = (inv.run || 0) + 1;
  const tag = `${key}-R${inv.run}`;
  const companyInv = (ctx.companyRefs.inventory = ctx.companyRefs.inventory || {});

  const activities = Object.entries(ctx.refs.activities || {}).sort(([a], [b]) => a.localeCompare(b));
  if (!activities.length) throw new Error('inventory: the project has no activities to issue material to');
  const activityAt = (index) => activities[index % activities.length][1];
  const costCodes = ctx.companyRefs.costCodes || {};
  const budgetLines = ctx.refs.budgetLines || {};
  const boqItemId = Object.values(ctx.refs.boq || {})[0] || null;
  for (const code of ['02-100', '02-200']) {
    if (!costCodes[code]) throw new Error(`inventory: the company has no cost code ${code}`);
  }

  const project = await pm.GET(P);
  const currency = project?.currency || 'USD';

  /** Records an id once per run and never one an earlier run already recorded. */
  const recorded = new Set();
  const recordOnce = (type, id, options) => {
    if (!id || recorded.has(`${type}:${id}`)) return;
    recorded.add(`${type}:${id}`);
    if (!options && (ctx.records[type] || []).includes(id)) return;
    ctx.record(type, id, options);
  };
  const recordMovements = (rows, options) => {
    for (const row of rows || []) recordOnce('stock_transaction', row.id, options);
  };

  // ── warehouses ───────────────────────────────────────────────────────────
  const visible = listOf(await wh.GET(`/inventory/warehouses?projectId=${pid}`));
  const ensureWarehouse = async (code, build, options) => {
    const existing = visible.find((row) => row.code === code);
    if (existing) return existing;
    const created = await wh.POST('/inventory/warehouses', { code, ...build() });
    ctx.record('warehouse', created.id, options);
    return created;
  };

  const siteStore = await ensureWarehouse(`WH-${key}-SITE`, () => {
    const c = ctx.canary('warehouse');
    return { name: `Site store — ${c}`, kind: 'site', projectId: pid, managerId: ctx.userId('warehouse'), address: `Gate 2, site compound — ${c}`, notes: `The project's main store. ${c}` };
  });
  const laydown = await ensureWarehouse(`WH-${key}-LAY`, () => {
    const c = ctx.canary('warehouse');
    return { name: `Laydown yard — ${c}`, kind: 'project', projectId: pid, managerId: ctx.userId('site'), address: `North boundary — ${c}`, notes: `Bulk materials before they go to the work face. ${c}` };
  });
  const central = await ensureWarehouse(
    `WH-${company.code}-CEN`,
    () => ({ name: `${company.canary} Central store`, kind: 'central', managerId: ctx.userId('warehouse'), address: `${company.canary} 4 Depot Road`, notes: `${company.canary} serves every project of the company.` }),
    { scope: 'company' }
  );
  companyInv.centralWarehouseId = central.id;

  // A temporary store that is set up, renamed and closed again.
  const temporary = await ctx.attempt('temporary warehouse', async () => {
    const c = ctx.canary('warehouse');
    const created = await wh.POST('/inventory/warehouses', { code: `WH-${key}-T${stamp}`, name: `Temporary container — ${c}`, kind: 'temporary', projectId: pid, notes: `Hired container. ${c}` });
    ctx.record('warehouse', created.id);
    await wh.PATCH(`/inventory/warehouses/${created.id}`, { name: `Plant yard container — ${c}`, kind: 'equipment_yard', managerId: ctx.userId('site'), address: `Returned to hirer — ${c}`, notes: `Off hire. ${c}` });
    return wh.PATCH(`/inventory/warehouses/${created.id}`, { status: 'archived' });
  });

  // ── locations ────────────────────────────────────────────────────────────
  const ensureLocations = async (warehouseId, specs, options) => {
    const existing = new Map(listOf(await wh.GET(`/inventory/warehouses/${warehouseId}/locations`)).map((row) => [row.code, row]));
    const out = {};
    for (const [code, name, kind, parentCode] of specs) {
      let row = existing.get(code);
      if (!row) {
        row = await wh.POST(`/inventory/warehouses/${warehouseId}/locations`, {
          code,
          name: `${name} — ${ctx.canary('warehouse_location')}`,
          kind,
          parentId: parentCode ? out[parentCode].id : null,
          sortOrder: Object.keys(out).length,
        });
        ctx.record('warehouse_location', row.id, options);
      }
      out[code] = row;
    }
    return out;
  };

  const binCount = ctx.count(1, 3);
  const binCodes = Array.from({ length: binCount }, (_, index) => `Z-A-01-R1-S1-B0${index + 1}`);
  const siteLocations = await ensureLocations(siteStore.id, [
    ['Z-A', 'Zone A, bagged and palletised', 'zone'],
    ['Z-A-01', 'Aisle 01', 'aisle', 'Z-A'],
    ['Z-A-01-R1', 'Rack 1', 'rack', 'Z-A-01'],
    ['Z-A-01-R1-S1', 'Shelf 1', 'shelf', 'Z-A-01-R1'],
    ...binCodes.map((code, index) => [code, `Bin 0${index + 1}`, 'bin', 'Z-A-01-R1-S1']),
    ['Z-Q', 'Quarantine cage', 'zone'],
  ]);
  const bins = binCodes.map((code) => siteLocations[code]);
  const binFor = (index) => bins[index % bins.length];
  const laydownLocations = await ensureLocations(laydown.id, [['L-1', 'Hardstanding 1', 'zone']]);
  const centralLocations = await ensureLocations(central.id, [['C-1', 'Bay 1', 'zone']], { scope: 'company' });

  // ── the supplier the orders are with ─────────────────────────────────────
  const suppliers = listOf(await buyer.GET(`${P}/procurement/suppliers`));
  const vendorId = ctx.companyRefs.directory?.supplier || null;
  let supplier = (vendorId && suppliers.find((row) => row.companyId === vendorId)) || suppliers.find((row) => row.status === 'approved') || null;
  if (!supplier) {
    const c = ctx.canary('procurement_supplier');
    supplier = await buyer.POST(`${P}/procurement/suppliers`, {
      ...(vendorId ? { companyId: vendorId } : { name: `${c} Materials supplier` }),
      code: `SUP-${key}`,
      contactName: `Sales desk ${c}`,
      tradeCategories: ['cement', 'steel'],
      status: 'approved',
      notes: `Supplies the site store. ${c}`,
    });
    ctx.record('procurement_supplier', supplier.id);
  }

  // ── the item master ──────────────────────────────────────────────────────
  const known = new Map();
  for (const search of [key, `${company.code}-GEN`]) {
    for (const status of ['active', 'archived']) {
      const rows = listOf(await wh.GET(`/inventory/items?projectId=${pid}&status=${status}&search=${encodeURIComponent(search)}`));
      for (const row of rows) known.set(row.sku, row);
    }
  }
  const ensureItem = async (sku, build, options) => {
    if (known.has(sku)) return known.get(sku);
    const created = await wh.POST('/inventory/items', { sku, ...build() });
    ctx.record('inventory_item', created.id, options);
    known.set(sku, created);
    return created;
  };

  const itemCount = Math.min(CATALOGUE.length, ctx.count(2, 5));
  const items = [];
  for (let i = 0; i < itemCount; i += 1) {
    const [suffix, name, unit, planUnit, category, costCode, [low, high]] = CATALOGUE[i];
    const price = rng.int(low * 100, high * 100) / 100;
    const sku = `${key}-${suffix}`;
    const row = await ensureItem(sku, () => {
      const c = ctx.canary('inventory_item');
      return {
        name: `${name} — ${c}`,
        unit,
        category,
        projectId: pid,
        barcode: `BC-${sku}`,
        description: `${name}, held for project ${key}. ${c}`,
        specification: `As the project specification. ${c}`,
        manufacturer: `${c} Works`,
        model: `M-${suffix}`,
        notes: `Stocked item. ${c}`,
        preferredSupplierId: supplier.id,
        unitCost: price,
        reorderLevel: 10,
        minStock: 5,
        maxStock: 5000,
        leadTimeDays: 7,
        isBatched: suffix === 'CEM',
      };
    });
    items.push({ id: row.id, sku, name, unit, planUnit, costCode, price, activityId: activityAt(i * 2) });
  }

  const companyItemSku = `${company.code}-GEN-GLV`;
  const companyItemRow = await ensureItem(
    companyItemSku,
    () => ({
      name: `Work gloves (box of 12) — ${company.canary}`,
      unit: 'box',
      category: 'consumable',
      barcode: `BC-${companyItemSku}`,
      description: `${company.canary} company stock, usable on every project.`,
      notes: `${company.canary} company item.`,
      unitCost: 4.5,
      reorderLevel: 5,
    }),
    { scope: 'company' }
  );
  const companyItem = { id: companyItemRow.id, sku: companyItemSku, name: 'Work gloves (box of 12)', unit: 'box', costCode: '02-100' };
  companyInv.itemId = companyItem.id;

  // One line that is no longer stocked.
  await ctx.attempt('archived item', async () => {
    const sku = `${key}-OBS`;
    const row = await ensureItem(sku, () => {
      const c = ctx.canary('inventory_item');
      return { name: `Curing compound (superseded) — ${c}`, unit: 'l', category: 'chemical', projectId: pid, description: `No longer specified. ${c}`, notes: c };
    });
    if (row.status !== 'archived') await wh.PATCH(`/inventory/items/${row.id}`, { status: 'archived', notes: `Superseded by the revised specification. ${ctx.canary('inventory_item')}` });
  });
  await wh.PATCH(`/inventory/items/${items[0].id}`, { reorderLevel: 15, minStock: 8, leadTimeDays: 10 });

  // ── the driver's own model of the stock, to check the product against ────
  const sim = new Map();
  const simOf = async (itemId) => {
    if (!sim.has(itemId)) {
      const row = await wh.GET(`/inventory/items/${itemId}`);
      sim.set(itemId, { stock: round(row.onHand + row.inTransit + row.quarantined), avg: Number(row.averageCost) });
    }
    return sim.get(itemId);
  };
  const simReceipt = async (itemId, quantity, unitCost) => {
    const state = await simOf(itemId);
    const total = state.stock + quantity;
    state.avg = round(total > 0 ? (state.stock * state.avg + quantity * unitCost) / total : unitCost);
    state.stock = round(total);
  };
  const simMove = async (itemId, delta) => {
    const state = await simOf(itemId);
    state.stock = round(state.stock + delta);
  };
  for (const item of [...items, companyItem]) await simOf(item.id);

  const ledgerBefore = await ctx.attempt('cost reconciliation (before)', () => cost.GET(`${P}/cost/reconciliation`));

  // ── the material plan: what each activity needs ──────────────────────────
  const planCount = Math.min(itemCount, ctx.count(1, 3));
  const plan = [];
  for (let i = 0; i < planCount; i += 1) {
    const item = items[i];
    const route = `${P}/activities/${item.activityId}/materials`;
    let row = listOf(await planner.GET(route)).find((candidate) => candidate.code === item.sku);
    if (!row) {
      const c = ctx.canary('activity_material');
      row = await planner.POST(route, {
        name: `${item.name} — ${c}`,
        code: item.sku,
        spec: `As specified. ${c}`,
        unit: item.planUnit,
        qty: rng.int(80, 400),
        requiredTiming: i % 2 ? 'activity_finish' : 'activity_start',
        leadWeeks: rng.int(1, 4),
        bufferDays: 7,
        supplierId: supplier.id,
        notes: `Needed for the activity. ${c}`,
      });
      ctx.record('activity_material', row.id);
    } else {
      rng.int(80, 400);
      rng.int(1, 4);
    }
    plan[i] = { id: row.id, activityId: item.activityId };
  }
  await planner.PATCH(`${P}/activities/${plan[0].activityId}/materials/${plan[0].id}`, { leadWeeks: 3, notes: `Lead time confirmed with the supplier. ${ctx.canary('activity_material')}` });
  const cancelledPlanRow = await ctx.attempt('cancelled plan row', async () => {
    const route = `${P}/activities/${items[0].activityId}/materials`;
    const code = `${items[0].sku}-ALT`;
    const existing = listOf(await planner.GET(route)).find((candidate) => candidate.code === code);
    if (existing) return existing.id;
    const c = ctx.canary('activity_material');
    const row = await planner.POST(route, { name: `Alternative to ${items[0].name} — ${c}`, code, unit: items[0].planUnit, qty: 25, notes: c });
    ctx.record('activity_material', row.id);
    await planner.PATCH(`${route}/${row.id}`, { status: 'cancelled', notes: `Not approved by the engineer. ${c}` });
    return row.id;
  });

  // ── purchase orders of the driver's own ──────────────────────────────────
  const orderLine = (item, index, orderedQty, unitCost) => {
    const c = ctx.canary('procurement_po_line');
    return {
      lineNumber: index + 1,
      activityId: item.activityId,
      costCodeId: costCodes[item.costCode],
      ...(budgetLines[item.costCode] ? { budgetLineId: budgetLines[item.costCode] } : {}),
      ...(index === 0 && boqItemId ? { boqItemId } : {}),
      ...(plan[items.indexOf(item)] ? { activityMaterialId: plan[items.indexOf(item)].id } : {}),
      itemCode: item.sku,
      description: `${item.name} — ${c}`,
      spec: `As specified. ${c}`,
      unit: item.unit,
      orderedQty,
      unitCost,
      notes: c,
    };
  };
  const createOrder = async (label, lines) => {
    const c = ctx.canary('procurement_order');
    const order = await buyer.POST(`${P}/procurement/purchase-orders`, {
      supplierId: supplier.id,
      status: 'draft',
      currency,
      orderDate: ctx.today,
      requiredBy: ctx.daysAhead(21),
      promisedDate: ctx.daysAhead(14),
      item: `${label} — ${c}`,
      buyer: `Buyer ${c}`,
      notes: `Raised for the site store. ${c}`,
      lines,
    });
    ctx.record('procurement_order', order.id);
    for (const line of order.lines || []) ctx.record('procurement_po_line', line.id);
    return order;
  };
  const release = async (order, { acknowledge = false } = {}) => {
    await buyer.POST(`${P}/purchase-orders/${order.id}/submit`, {});
    await pm.POST(`${P}/purchase-orders/${order.id}/approve`, {});
    await buyer.POST(`${P}/purchase-orders/${order.id}/issue`, {});
    if (acknowledge) await buyer.POST(`${P}/purchase-orders/${order.id}/acknowledge`, { acknowledgedRef: `ACK-${ctx.canary('procurement_order')}` });
  };
  const lineOf = (order, index) => (order.lines || []).find((line) => line.lineNumber === index + 1);

  const orderedA = items.map(() => rng.int(40, 120));
  const orderedB = rng.int(20, 60);
  const priceB = money(items[0].price * 1.25);
  const orderA = await createOrder('Site materials', items.map((item, index) => orderLine(item, index, orderedA[index], item.price)));
  const orderB = await createOrder('Top-up at the new price', [orderLine(items[0], 0, orderedB, priceB)]);
  const orderC = await createOrder('Call-off awaiting delivery', [orderLine(items[1], 0, rng.int(10, 30), items[1].price)]);
  await release(orderA, { acknowledge: true });
  await release(orderB);
  await release(orderC);

  // ── deliveries ───────────────────────────────────────────────────────────
  const receipts = [];
  const receiveAtStore = async (order, rows, text) => {
    const c = ctx.canary('delivery_receipt');
    const result = await wh.POST('/inventory/goods-receipt', {
      orderId: order.id,
      projectId: pid,
      warehouseId: siteStore.id,
      deliveryNote: `DN ${c}`,
      notes: `${text}. ${c}`,
      lines: rows,
    });
    ctx.record('delivery_receipt', result.receiptId);
    receipts.push({ id: result.receiptId, number: result.receiptNumber, canary: c });
    return result;
  };

  // Order A, first lorry: half of every line, a couple rejected on the second.
  const firstDrop = items.map((item, index) => ({ item, line: lineOf(orderA, index), acceptedQty: Math.floor(orderedA[index] / 2), rejectedQty: index === 1 ? 2 : 0 }));
  await receiveAtStore(
    orderA,
    firstDrop.map(({ item, line, acceptedQty, rejectedQty }, index) => ({
      poLineId: line.id,
      acceptedQty,
      rejectedQty,
      locationId: binFor(index).id,
      inventoryItemId: item.id,
      batchNo: `B-${tag}-${index + 1}`,
      ...(index === 0 ? { expiryDate: ctx.daysAhead(120) } : {}),
      notes: ctx.canary('delivery_receipt_line'),
    })),
    'First delivery, half of the order'
  );
  for (const { item, acceptedQty } of firstDrop) await simReceipt(item.id, acceptedQty, item.price);

  // Order A, second lorry: the rest of the first line, invoiced a little dearer.
  const restOfFirst = orderedA[0] - firstDrop[0].acceptedQty;
  const dearer = money(items[0].price * 1.1);
  await receiveAtStore(
    orderA,
    [{ poLineId: lineOf(orderA, 0).id, acceptedQty: restOfFirst, rejectedQty: 0, unitCost: dearer, locationId: binFor(0).id, inventoryItemId: items[0].id, batchNo: `B-${tag}-1b`, notes: ctx.canary('delivery_receipt_line') }],
    'Balance of line 1'
  );
  await simReceipt(items[0].id, restOfFirst, dearer);

  // Order B, in full, booked from the procurement screen rather than the store's.
  const dropB = await (async () => {
    const c = ctx.canary('delivery_receipt');
    const result = await wh.POST(`${P}/procurement/purchase-orders/${orderB.id}/receipts`, {
      receiptNumber: `DN-${tag}-${stamp}`,
      warehouseId: siteStore.id,
      receivedBy: `Storeman ${c}`,
      deliveryNote: `DN ${c}`,
      notes: `Delivered in full. ${c}`,
      lines: [{ poLineId: lineOf(orderB, 0).id, acceptedQty: orderedB, rejectedQty: 0, notes: ctx.canary('delivery_receipt_line') }],
    });
    ctx.record('delivery_receipt', result.receiptId);
    receipts.push({ id: result.receiptId, number: result.receiptNumber, canary: c });
    return result;
  })();
  if (dropB.lines?.[0]?.itemId !== items[0].id) ctx.note(`FINDING? the procurement-door receipt of ${items[0].sku} was put on item ${dropB.lines?.[0]?.itemId}, not ${items[0].id}`);
  await simReceipt(dropB.lines?.[0]?.itemId || items[0].id, orderedB, priceB);

  // The delivery note itself, attached to the first receipt.
  await ctx.attempt('delivery note attachment', async () => {
    const c = ctx.canary('attachment');
    const result = await wh.upload('POST', `${P}/attachments`, {
      field: 'files',
      filename: `${c}-delivery-note.pdf`,
      contentType: 'application/pdf',
      body: pdf(`Delivery note ${receipts[0].number} ${c}`),
      fields: { recordType: 'delivery_receipt', recordId: receipts[0].id, caption: `Signed delivery note ${c}` },
    });
    for (const row of listOf(result)) {
      ctx.record('attachment', row.id);
      if (row.documentId) ctx.record('project_document', row.documentId);
    }
  });

  // A delivery against an order the procurement driver left open, when there is one.
  // Opportunistic: whatever goes wrong here is a note, never the end of the run.
  try {
    const own = new Set([orderA.id, orderB.id, orderC.id, ...idsIn(inv.purchaseOrders)]);
    const received = await receiveOpenOrder({ ctx, wh, candidates: idsIn(ctx.refs.purchaseOrders).filter((id) => !own.has(id)), receiveAtStore, locationId: binFor(0).id, startedAt });
    if (received) {
      inv.receivedProcurementOrder = received.orderId;
      for (const item of received.itemsMade) recordOnce('inventory_item', item.id, item.projectId ? undefined : { scope: 'company' });
    }
  } catch (error) {
    ctx.note(`receipt against a procurement order: ${String(error.message || error).slice(0, 240)}`);
  }

  // Direct receipts: no order behind them.
  const centralDrop = await wh.POST('/inventory/stock/receive', {
    itemId: companyItem.id,
    warehouseId: central.id,
    locationId: centralLocations['C-1'].id,
    quantity: 24,
    unitCost: 4.5,
    reference: `CASH-${tag}`,
    notes: `Bought over the counter. ${ctx.canary('stock_transaction')}`,
  });
  recordMovements([centralDrop], { scope: 'company' });
  await simReceipt(companyItem.id, 24, 4.5);

  const cheaper = money(items[1].price * 0.9);
  const looseDrop = await wh.POST('/inventory/stock/receive', {
    itemId: items[1].id,
    warehouseId: siteStore.id,
    locationId: binFor(1).id,
    quantity: 10,
    unitCost: cheaper,
    damagedQty: 1,
    projectId: pid,
    batchNo: `B-${tag}-LOOSE`,
    expiryDate: ctx.daysAhead(365),
    reference: `FREE-ISSUE-${tag}`,
    notes: `Free-issue from the client, one damaged on arrival. ${ctx.canary('stock_transaction')}`,
  });
  recordMovements([looseDrop]);
  await simReceipt(items[1].id, 10, cheaper);
  await simMove(items[1].id, -1);

  // ── housekeeping movements, each in a named bin ──────────────────────────
  const movement = async (who, kind, item, quantity, locationId, text) => {
    const result = await who.POST(`/inventory/stock/${kind}`, {
      itemId: item.id,
      warehouseId: siteStore.id,
      locationId,
      quantity,
      projectId: pid,
      reference: `${kind.toUpperCase()}-${tag}`,
      notes: `${text}. ${ctx.canary('stock_transaction')}`,
    });
    recordMovements(result.movements);
    return result;
  };
  await movement(wh, 'adjust', items[1], 2, binFor(1).id, 'Found behind the rack at the weekly tidy');
  await simMove(items[1].id, 2);
  await movement(wh, 'adjust', items[1], -1, binFor(1).id, 'Short against the bin card');
  await simMove(items[1].id, -1);
  await movement(wh, 'damage', items[0], 1, binFor(0).id, 'Split bag, written off');
  await simMove(items[0].id, -1);
  await movement(wh, 'quarantine', items[0], 3, binFor(0).id, 'Held for the test certificate');
  await movement(wh, 'release', items[0], 1, binFor(0).id, 'Certificate received for part of the batch');

  // A claim on stock: reserved, then partly given back. On hand does not move.
  await site.POST('/inventory/stock/reserve', { itemId: items[0].id, warehouseId: siteStore.id, quantity: 4, reference: `RES-${tag}`, notes: `Held for the pour. ${ctx.canary('stock_reservation')}` });
  await wh.POST('/inventory/stock/reserve', { itemId: items[0].id, warehouseId: siteStore.id, quantity: -1, reference: `RES-${tag}`, notes: `One released. ${ctx.canary('stock_reservation')}` });

  // ── issues to the work: the moment stock becomes project cost ────────────
  let issuedValue = 0;
  let returnedValue = 0;
  const issues = [];
  const issue = async (who, item, warehouseId, quantity, activityId, extra = {}) => {
    const before = await wh.GET(`/inventory/items/${item.id}`);
    const c = ctx.canary('stock_transaction');
    const result = await who.POST('/inventory/stock/issue', {
      itemId: item.id,
      warehouseId,
      quantity,
      projectId: pid,
      activityId,
      costCodeId: costCodes[item.costCode],
      reference: `ISS-${tag}-${issues.length + 1}`,
      notes: `Issued to the work face. ${c}`,
      ...extra,
    });
    recordMovements(result.movements);
    if (!result.costPosted) ctx.note(`FINDING? issue of ${item.sku} to an activity posted no project cost`);
    const took = round((result.movements || []).reduce((sum, row) => sum + Math.abs(row.quantity), 0));
    if (took !== round(quantity)) ctx.note(`FINDING? issue of ${quantity} ${item.sku} moved ${took}`);
    for (const row of result.movements || []) {
      const expected = money(Math.abs(row.quantity) * Number(before.averageCost));
      if (round(row.unitCost) !== round(before.averageCost) || money(row.value) !== expected) {
        ctx.note(`FINDING? issue of ${item.sku} left at ${row.unitCost} (value ${row.value}); the weighted average was ${before.averageCost} (value ${expected})`);
      }
      issuedValue += Number(row.value);
    }
    await simMove(item.id, -quantity);
    issues.push({ item, quantity, activityId });
    return result;
  };

  const issueCount = ctx.count(2, 5);
  for (let j = 0; j < issueCount; j += 1) {
    const item = items[j % itemCount];
    const quantity = rng.int(1, 5);
    const who = j === 1 ? quality : j % 2 === 0 ? site : wh;
    await issue(who, item, siteStore.id, quantity, activityAt(j), {
      ...(j === 0 && boqItemId ? { boqItemId } : {}),
      ...(j === 2 ? { occurredAt: new Date(Date.now() - 2 * 3_600_000).toISOString() } : {}),
    });
  }
  // Company stock from the central store, consumed on this project.
  await issue(wh, companyItem, central.id, rng.int(1, 2), activityAt(1));

  // ── returns: never more than went out ────────────────────────────────────
  const giveBack = async (who, issued, quantity, locationId) => {
    const result = await who.POST('/inventory/stock/return', {
      itemId: issued.item.id,
      warehouseId: siteStore.id,
      locationId,
      quantity,
      projectId: pid,
      activityId: issued.activityId,
      costCodeId: costCodes[issued.item.costCode],
      reference: `RET-${tag}`,
      notes: `Unused, back to the store. ${ctx.canary('stock_transaction')}`,
    });
    recordMovements(result.movements);
    for (const row of result.movements || []) returnedValue += Number(row.value);
    await simMove(issued.item.id, quantity);
  };
  await giveBack(site, issues[0], 1, binFor(0).id);
  if (issues[2] && issues[2].quantity >= 2) await giveBack(wh, issues[2], issues[2].quantity - 1, null);

  // ── transfers between stores, left in every state ────────────────────────
  inv.transfers = {};
  const transfer = async (label, fromWarehouseId, toWarehouseId, lines, text, options) => {
    const c = ctx.canary('stock_transfer');
    const created = await wh.POST('/inventory/transfers', {
      fromWarehouseId,
      toWarehouseId,
      reason: `${text}. ${c}`,
      notes: c,
      lines: lines.map(([item, quantity]) => ({ itemId: item.id, quantity, notes: ctx.canary('stock_transfer_line') })),
    });
    ctx.record('stock_transfer', created.id, options);
    for (const line of created.lines || []) ctx.record('stock_transfer_line', line.id, options);
    inv.transfers[label] = created.id;
    return created;
  };
  const dispatch = (row) => wh.POST(`/inventory/transfers/${row.id}/dispatch`, {});

  const moved = await transfer('received', siteStore.id, laydown.id, [[items[0], rng.int(2, 5)], [items[1], rng.int(1, 3)]], 'To the laydown yard for the pour');
  await dispatch(moved);
  await wh.POST(`/inventory/transfers/${moved.id}/receive`, {});

  const short = await transfer('receivedShort', siteStore.id, laydown.id, [[items[0], 4]], 'Second run to the yard');
  await dispatch(short);
  await wh.POST(`/inventory/transfers/${short.id}/receive`, { lines: [{ id: short.lines[0].id, receivedQty: 2, damagedQty: 1 }] });
  await simMove(items[0].id, -2); // one damaged on the road, one never arrived

  const onTheRoad = await transfer('inTransit', central.id, siteStore.id, [[companyItem, 3]], 'Consumables for the site store', { scope: 'company' });
  await dispatch(onTheRoad);

  await transfer('draft', laydown.id, siteStore.id, [[items[0], 1]], 'Left over, to come back to the store');

  // ── the invoice side of the three-way match ──────────────────────────────
  inv.purchaseOrders = { ...(inv.purchaseOrders || {}), [`A${inv.run}`]: orderA.id, [`B${inv.run}`]: orderB.id, [`C${inv.run}`]: orderC.id };
  await ctx.attempt('supplier invoice for the three-way match', async () => {
    const c = ctx.canary('direct_cost');
    const invoiced = money(priceB * 1.04);
    const invoice = await cost.POST(`${P}/direct-costs`, {
      type: 'invoice',
      description: `Supplier invoice against ${orderB.ref} — ${c}`,
      ...(vendorId ? { vendorCompanyId: vendorId } : { vendorName: supplier.name }),
      invoiceNumber: `INV-${tag}-${stamp}`,
      purchaseOrderId: orderB.id,
      costDate: ctx.today,
      dueDate: ctx.daysAhead(30),
      notes: `Left in draft: priced above the order. ${c}`,
      lines: [
        {
          description: `${items[0].name} — ${c}`,
          poLineId: lineOf(orderB, 0).id,
          costCodeId: costCodes[items[0].costCode],
          ...(budgetLines[items[0].costCode] ? { budgetLineId: budgetLines[items[0].costCode] } : {}),
          activityId: items[0].activityId,
          costType: 'material',
          quantity: orderedB,
          unit: items[0].unit,
          unitCost: invoiced,
          amount: money(orderedB * invoiced),
          notes: c,
        },
      ],
    });
    ctx.record('direct_cost', invoice.id);
    for (const line of invoice.lines || []) if (line.id) ctx.record('direct_cost_line', line.id);
    inv.invoiceId = invoice.id;
    await wh.GET(`/inventory/match/invoice/${invoice.id}`);
  });
  await ctx.attempt('three-way match of the orders', async () => {
    await wh.GET(`/inventory/match/order/${orderA.id}`);
    await wh.GET(`/inventory/match/order/${orderB.id}`);
  });

  // ── consumption against the plan ─────────────────────────────────────────
  // Recorded when the product allows it. It has not so far: nothing in the
  // product ever raises a plan row's issued quantity, so every usage is
  // refused as exceeding it. Only an answer other than that refusal is noted.
  {
    const usage = await site.send('POST', `${P}/activities/${plan[0].activityId}/materials/${plan[0].id}/usage`, {
      usedQty: 1,
      wasteQty: 0,
      usageDate: ctx.today,
      installedLocation: `Grid A-D ${ctx.canary('activity_material_usage')}`,
      notes: ctx.canary('activity_material_usage'),
    });
    const usageId = usage.body?.data?.usage?.id || usage.body?.data?.id;
    if (usage.status === 201 && usageId) ctx.record('activity_material_usage', usageId);
    else if (!(usage.status === 409 && usage.body?.error?.code === 'MATERIAL_USAGE_EXCEEDS_ISSUED_QTY')) {
      ctx.note(`material usage: ${usage.status} ${usage.body?.error?.code || ''} ${usage.body?.error?.message || ''}`.slice(0, 300));
    }
  }

  // Lead-time alerts the plan rows and order lines of this driver raised.
  await ctx.attempt('lead-time alerts', async () => {
    const planIds = new Set([...plan.map((row) => row.id), cancelledPlanRow].filter(Boolean));
    const lineIds = new Set([orderA, orderB, orderC].flatMap((order) => (order.lines || []).map((line) => line.id)));
    const alerts = listOf(await buyer.GET(`${P}/procurement/lead-time-alerts`)).filter((alert) => planIds.has(alert.activityMaterialId) || lineIds.has(alert.poLineId));
    for (const alert of alerts) recordOnce('procurement_lead_time_alert', alert.id);
    const open = alerts.filter((alert) => alert.status === 'open');
    if (open[0]) await buyer.PATCH(`${P}/procurement/lead-time-alerts/${open[0].id}/acknowledge`, { note: `Chased with the supplier. ${ctx.canary('procurement_lead_time_alert')}` });
    if (open[1]) await buyer.PATCH(`${P}/procurement/lead-time-alerts/${open[1].id}/resolve`, { note: `Delivered. ${ctx.canary('procurement_lead_time_alert')}` });
  });

  // Receipt lines have no route of their own; the plan rows show theirs.
  await ctx.attempt('receipt lines of the plan rows', async () => {
    const mine = new Set(receipts.map((row) => row.id));
    for (const row of plan) {
      const material = listOf(await planner.GET(`${P}/activities/${row.activityId}/materials`)).find((candidate) => candidate.id === row.id);
      for (const line of material?.receiptLines || []) {
        if (mine.has(line.receiptId ?? line.receipt?.id)) recordOnce('delivery_receipt_line', line.id);
      }
    }
  });

  // ── every movement of this run, from the ledger itself ───────────────────
  for (const [warehouse, companyOwned] of [[siteStore, false], [laydown, false], [central, true]]) {
    const rows = listOf(await wh.GET(`/inventory/stock/transactions?warehouseId=${warehouse.id}&limit=500`));
    for (const row of rows) {
      if (row.occurredAt < startedAt) continue;
      recordOnce('stock_transaction', row.id, companyOwned && row.projectId !== pid ? { scope: 'company' } : undefined);
    }
  }

  // ── what the store screens read, and the arithmetic behind them ──────────
  await ctx.attempt('inventory reads', async () => {
    await wh.GET(`/inventory/summary?projectId=${pid}`);
    await wh.GET(`/inventory/analytics?projectId=${pid}`);
    await wh.GET(`/inventory/purchase-orders?projectId=${pid}&scope=receivable`);
    await wh.GET('/inventory/transfers?status=in_transit');
    await wh.GET(`/inventory/stock/transactions?projectId=${pid}&type=issue&limit=50`);
    const scanned = await site.GET(`/inventory/items/scan/${encodeURIComponent(`BC-${items[0].sku}`)}`);
    if (scanned.item?.id !== items[0].id) ctx.note(`FINDING? scanning BC-${items[0].sku} found ${scanned.item?.id}, not ${items[0].id}`);
  });

  for (const item of [...items, companyItem]) {
    const now = await wh.GET(`/inventory/items/${item.id}`);
    const expected = sim.get(item.id);
    const stock = round(now.onHand + now.inTransit + now.quarantined);
    if (Math.abs(stock - expected.stock) > 0.0001) ctx.note(`FINDING? ${item.sku}: the product holds ${stock} (on hand + in transit + quarantined); the movements of this run make it ${expected.stock}`);
    if (Math.abs(Number(now.averageCost) - expected.avg) > 0.0001) ctx.note(`FINDING? ${item.sku}: weighted average ${now.averageCost}; the receipts of this run make it ${expected.avg}`);
  }

  if (ledgerBefore) {
    const ledgerAfter = await ctx.attempt('cost reconciliation (after)', () => cost.GET(`${P}/cost/reconciliation`));
    if (ledgerAfter) {
      const posted = money((ledgerAfter.ledger?.bySource?.material_issue || 0) - (ledgerBefore.ledger?.bySource?.material_issue || 0));
      const expected = money(issuedValue - returnedValue);
      if (Math.abs(posted - expected) > 0.005) ctx.note(`FINDING? the cost ledger took ${posted} of material issues in this run; the stock movements were worth ${expected}`);
      if (ledgerBefore.balanced && !ledgerAfter.balanced) ctx.note('FINDING? the cost reconciliation was balanced before this run and is not after it');
      inv.materialCostPosted = money((inv.materialCostPosted || 0) + expected);
    }
  }

  // ── what later drivers and the attacks need by name ──────────────────────
  inv.warehouses = { site: siteStore.id, laydown: laydown.id, central: central.id, ...(temporary?.id ? { archived: temporary.id } : {}) };
  inv.locations = { zone: siteLocations['Z-A'].id, quarantine: siteLocations['Z-Q'].id, bins: bins.map((bin) => bin.id), laydown: laydownLocations['L-1'].id, central: centralLocations['C-1'].id };
  inv.items = Object.fromEntries(items.map((item) => [item.sku, item.id]));
  inv.companyItem = companyItem.id;
  inv.supplierId = supplier.id;
  inv.materials = plan.map((row) => row.id);
  inv.receipts = receipts.map((row) => row.id);
};

module.exports = { name: 'inventory', needs: ['foundation'], depths: ['standard'], run, helpers: { idsIn, pdf, receiveOpenOrder } };
