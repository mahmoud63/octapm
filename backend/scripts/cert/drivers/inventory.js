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
 *                   that is renamed and archived (a new one every run)
 *   locations       zone > aisle > rack > shelf > bins in the site store, a
 *                   quarantine cage, one zone in each other store
 *   items           two to five project items, one company item (made once),
 *                   one serial-tracked tool (received one unit at a time with
 *                   its serial number, one unit issued by serial), one item
 *                   that is archived, and one the product makes itself on the
 *                   first delivery of an order line that names no stocked item
 *                   (a company item: the product makes it so)
 *   material plan   activity materials for some items, one cancelled
 *   purchase orders four of the driver's own, and only its own:
 *                     A acknowledged, delivered in two receipts, left partial
 *                     B delivered in full through the procurement door
 *                     C issued, nothing delivered
 *                     D one line with no stocked item, delivered in full
 *   receipts        goods receipts against A, B and D, every receipt line read
 *                   back from the order register, a delivery note attached to
 *                   the first receipt, two direct receipts (one with damage on
 *                   delivery)
 *   movements       adjust up and down, damage, quarantine, release, issues to
 *                   an activity and a cost code by the site engineer, the
 *                   quality engineer and the storeman, returns of less than
 *                   was issued, each to the store it was issued from
 *   reservations    reserved, then partly given back. A reservation is only a
 *                   number on the stock balance: the product keeps no record
 *                   of it (no id, and the reference and notes it is sent are
 *                   dropped), so nothing is recorded and no canary is spent
 *   transfers       received in full, received short and damaged, in transit,
 *                   draft
 *   three-way match a draft supplier invoice against order B at another price
 *   material usage  tried against a plan row. The product refuses every one
 *                   (nothing ever raises a plan row's issued quantity); the
 *                   refusal is a FINDING note on every run
 *   lead-time alerts those this run's plan rows and order lines raised; one
 *                   acknowledged and one resolved when there are open ones
 *
 * Everything that posts cost names an activity and a cost code. Quantities are
 * small: a run receives a few hundred units into its own stores and adds a few
 * hundred of actual material cost to the project. The driver never receives
 * against, or otherwise changes, a record another driver made.
 *
 * The driver checks the product's arithmetic as it goes and writes a note
 * (never a failure) when a figure is not what the movements say it should be:
 * the price an issue leaves at, the weighted average and the stock of every
 * item it moved, and the cost ledger's material-issue total. Product defects
 * are findings, not failures: they are noted and the run goes on.
 *
 * Failures. Every record of the area is made outside any `attempt`: when one
 * is refused, the run fails. A side step that may be refused for a reason of
 * its own (the upload rate limit) is `optional`: the refusals it expects are
 * notes, a 5xx is a FINDING note, and anything else still fails the run. The
 * stock movements the product writes itself (goods receipts, transfers,
 * damage on delivery) are read back from the stock ledger at the end of every
 * run, whether the run ended well or not.
 *
 * It can be run again: stores, locations, items and plan rows are found by
 * their code, and everything else (orders, receipts, movements, transfers,
 * the invoice) is made afresh with numbers of its own. Each run adds another
 * set of orders, stock and material cost.
 */

const CATALOGUE = [
  // suffix, name, stock unit, plan unit, category, cost code, unit cost range
  ['CEM', 'Cement OPC 42.5N (50kg bag)', 'bag', 'BAG', 'cement', '02-100', [6, 12]],
  ['REB', 'Rebar T16 B500B (12m bar)', 'pcs', 'PCS', 'steel', '02-200', [9, 16]],
  ['BLK', 'Concrete block 200mm', 'pcs', 'PCS', 'masonry', '02-100', [1, 3]],
  ['SND', 'Washed sand', 'm3', 'M3', 'aggregate', '02-100', [15, 30]],
  ['MSH', 'Welded mesh A193', 'sheet', 'SHEET', 'steel', '02-200', [20, 45]],
];

/** The order line no stocked item stands behind: the product makes the item on its first delivery. */
const NEW_LINE = { suffix: 'TIE', name: 'Tie wire 1.6mm annealed', unit: 'kg', costCode: '02-200', price: [2, 4] };

const listOf = (data) => (Array.isArray(data) ? data : data?.items || []);
const round = (value, dp = 4) => Math.round((Number(value) || 0) * 10 ** dp) / 10 ** dp;
const money = (value) => round(value, 2);
const isApiError = (error) => error?.name === 'ApiError' && typeof error.status === 'number';
const short = (error) => String(error?.message || error).slice(0, 300);

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

  // What this run stands on; nothing is counted as a run until it holds.
  const activities = Object.entries(ctx.refs.activities || {}).sort(([a], [b]) => a.localeCompare(b));
  if (!activities.length) throw new Error('inventory: the project has no activities to issue material to');
  const costCodes = ctx.companyRefs.costCodes || {};
  for (const code of ['02-100', '02-200']) {
    if (!costCodes[code]) throw new Error(`inventory: the company has no cost code ${code}`);
  }

  const startedAt = new Date(Date.now() - 5000).toISOString();
  const stamp = Date.now().toString(36);
  const inv = (ctx.refs.inventory = ctx.refs.inventory || {});
  inv.run = (inv.run || 0) + 1;
  const tag = `${key}-R${inv.run}`;
  const companyInv = (ctx.companyRefs.inventory = ctx.companyRefs.inventory || {});
  const activityAt = (index) => activities[index % activities.length][1];
  const budgetLines = ctx.refs.budgetLines || {};
  const boqItemId = Object.values(ctx.refs.boq || {})[0] || null;

  /**
   * A side step that may be refused for a reason of its own. The refusals it
   * names (by status or code) are notes; a 5xx is a product finding and a
   * note; any other refusal fails the run.
   */
  const optional = async (label, fn, expected = []) => {
    try {
      return await fn();
    } catch (error) {
      if (!isApiError(error)) throw error;
      if (error.status >= 500) {
        ctx.note(`FINDING 5xx: ${label}: ${short(error)}`);
        return null;
      }
      if (expected.some((want) => want === error.status || want === error.code)) {
        ctx.note(`${label}: ${error.status} ${error.code} ${error.serverMessage}`.slice(0, 300));
        return null;
      }
      throw error;
    }
  };

  /** Records an id once per run and never one an earlier run already recorded (project scope). */
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

  // The movements the product writes on its own (receipt lines, transfers,
  // damage on delivery) come back only from the stock ledger. They are known
  // by their reference: the receipt number or transfer ref they carry, which
  // this run wrote down as it went. Not by time: the central store is shared
  // by every project of the company, and a time window caught the last
  // movements of the project before this one.
  const stores = [];
  const runRefs = new Set();
  const sweep = async () => {
    for (const [warehouse, companyOwned] of stores) {
      const rows = listOf(await wh.GET(`/inventory/stock/transactions?warehouseId=${warehouse.id}&limit=500`));
      for (const row of rows) {
        if (!row.reference || !runRefs.has(row.reference)) continue;
        recordOnce('stock_transaction', row.id, companyOwned && row.projectId !== pid ? { scope: 'company' } : undefined);
      }
    }
  };

  let failure = null;
  try {
    const project = await pm.GET(P);
    const currency = project?.currency || 'USD';

    // ── warehouses ─────────────────────────────────────────────────────────
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
    stores.push([siteStore, false], [laydown, false], [central, true]);
    companyInv.centralWarehouseId = central.id;

    // A temporary store that is set up, renamed and closed again.
    const temporary = await (async () => {
      const c = ctx.canary('warehouse');
      const created = await wh.POST('/inventory/warehouses', { code: `WH-${key}-T${stamp}`, name: `Temporary container — ${c}`, kind: 'temporary', projectId: pid, notes: `Hired container. ${c}` });
      ctx.record('warehouse', created.id);
      await wh.PATCH(`/inventory/warehouses/${created.id}`, { name: `Plant yard container — ${c}`, kind: 'equipment_yard', managerId: ctx.userId('site'), address: `Returned to hirer — ${c}`, notes: `Off hire. ${c}` });
      const closed = await wh.PATCH(`/inventory/warehouses/${created.id}`, { status: 'archived' });
      if (closed.status !== 'archived') ctx.note(`FINDING? warehouse ${created.id} was archived and reads ${closed.status}`);
      return closed;
    })();
    inv.warehouses = { site: siteStore.id, laydown: laydown.id, central: central.id, archived: temporary.id };

    // ── locations ──────────────────────────────────────────────────────────
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
    inv.locations = { zone: siteLocations['Z-A'].id, quarantine: siteLocations['Z-Q'].id, bins: bins.map((bin) => bin.id), laydown: laydownLocations['L-1'].id, central: centralLocations['C-1'].id };

    // ── the supplier the orders are with ───────────────────────────────────
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
    inv.supplierId = supplier.id;

    // ── the item master ────────────────────────────────────────────────────
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
    inv.items = Object.fromEntries(items.map((item) => [item.sku, item.id]));

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
    inv.companyItem = companyItem.id;

    // A tool tracked by serial number: received and issued one unit at a time.
    const serialSku = `${key}-MTR`;
    const serialRow = await ensureItem(serialSku, () => {
      const c = ctx.canary('inventory_item');
      return {
        name: `Digital moisture meter — ${c}`,
        unit: 'pcs',
        category: 'tool',
        projectId: pid,
        barcode: `BC-${serialSku}`,
        manufacturer: `${c} Instruments`,
        model: 'MM-2',
        description: `Serial-tracked test instrument. ${c}`,
        notes: c,
        unitCost: 85,
        isSerialised: true,
      };
    });
    if (!serialRow.isSerialised) ctx.note(`FINDING? item ${serialSku} was made serial-tracked and reads isSerialised ${serialRow.isSerialised}`);
    const serialItem = { id: serialRow.id, sku: serialSku, name: 'Digital moisture meter', unit: 'pcs', costCode: '02-100' };
    inv.serialItem = serialItem.id;

    // One line that is no longer stocked.
    {
      const sku = `${key}-OBS`;
      const row = await ensureItem(sku, () => {
        const c = ctx.canary('inventory_item');
        return { name: `Curing compound (superseded) — ${c}`, unit: 'l', category: 'chemical', projectId: pid, description: `No longer specified. ${c}`, notes: c };
      });
      if (row.status !== 'archived') {
        const archived = await wh.PATCH(`/inventory/items/${row.id}`, { status: 'archived', notes: `Superseded by the revised specification. ${ctx.canary('inventory_item')}` });
        if (archived.status !== 'archived') ctx.note(`FINDING? item ${sku} was archived and reads ${archived.status}`);
      }
      inv.archivedItem = row.id;
    }
    await wh.PATCH(`/inventory/items/${items[0].id}`, { reorderLevel: 15, minStock: 8, leadTimeDays: 10 });

    // ── the driver's own model of the stock, to check the product against ──
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
    for (const item of [...items, companyItem, serialItem]) await simOf(item.id);
    const newSku = `${key}-${NEW_LINE.suffix}`;
    if (known.has(newSku)) await simOf(known.get(newSku).id);

    const ledgerBefore = await optional('cost reconciliation (before)', () => cost.GET(`${P}/cost/reconciliation`));

    // ── the material plan: what each activity needs ────────────────────────
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
    const cancelledPlanRow = await (async () => {
      const route = `${P}/activities/${items[0].activityId}/materials`;
      const code = `${items[0].sku}-ALT`;
      const existing = listOf(await planner.GET(route)).find((candidate) => candidate.code === code);
      if (existing) return existing.id;
      const c = ctx.canary('activity_material');
      const row = await planner.POST(route, { name: `Alternative to ${items[0].name} — ${c}`, code, unit: items[0].planUnit, qty: 25, notes: c });
      ctx.record('activity_material', row.id);
      const cancelled = await planner.PATCH(`${route}/${row.id}`, { status: 'cancelled', notes: `Not approved by the engineer. ${c}` });
      if (cancelled.status !== 'cancelled') ctx.note(`FINDING? plan row ${row.id} was cancelled and reads ${cancelled.status}`);
      return row.id;
    })();
    inv.materials = plan.map((row) => row.id);
    inv.cancelledMaterial = cancelledPlanRow;

    // ── purchase orders of the driver's own ────────────────────────────────
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
    const orderedD = rng.int(10, 30);
    const priceD = rng.int(NEW_LINE.price[0] * 100, NEW_LINE.price[1] * 100) / 100;
    const orderA = await createOrder('Site materials', items.map((item, index) => orderLine(item, index, orderedA[index], item.price)));
    const orderB = await createOrder('Top-up at the new price', [orderLine(items[0], 0, orderedB, priceB)]);
    const orderC = await createOrder('Call-off awaiting delivery', [orderLine(items[1], 0, rng.int(10, 30), items[1].price)]);
    const orderD = await createOrder('A line the store has never held', [
      (() => {
        const c = ctx.canary('procurement_po_line');
        return {
          lineNumber: 1,
          activityId: activityAt(3),
          costCodeId: costCodes[NEW_LINE.costCode],
          ...(budgetLines[NEW_LINE.costCode] ? { budgetLineId: budgetLines[NEW_LINE.costCode] } : {}),
          itemCode: newSku,
          description: `${NEW_LINE.name} — ${c}`,
          spec: `BS EN 10218. ${c}`,
          unit: NEW_LINE.unit,
          orderedQty: orderedD,
          unitCost: priceD,
          notes: c,
        };
      })(),
    ]);
    await release(orderA, { acknowledge: true });
    await release(orderB);
    await release(orderC);
    await release(orderD);
    inv.purchaseOrders = { ...(inv.purchaseOrders || {}), [`A${inv.run}`]: orderA.id, [`B${inv.run}`]: orderB.id, [`C${inv.run}`]: orderC.id, [`D${inv.run}`]: orderD.id };

    // ── deliveries ─────────────────────────────────────────────────────────
    const receipts = [];
    let receiptLinesSent = 0;
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
      runRefs.add(result.receiptNumber);
      receiptLinesSent += rows.length;
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

    // Order B, in full, booked from the procurement screen rather than the
    // store's. The route also accepts "issue to the activity on arrival"; the
    // plan row is read afterwards to see whether the product did anything with it.
    const dropB = await (async () => {
      const c = ctx.canary('delivery_receipt');
      const result = await wh.POST(`${P}/procurement/purchase-orders/${orderB.id}/receipts`, {
        receiptNumber: `DN-${tag}-${stamp}`,
        warehouseId: siteStore.id,
        receivedBy: `Storeman ${c}`,
        deliveryNote: `DN ${c}`,
        issueToActivity: true,
        notes: `Delivered in full. ${c}`,
        lines: [{ poLineId: lineOf(orderB, 0).id, acceptedQty: orderedB, rejectedQty: 0, issuedQty: 1, notes: ctx.canary('delivery_receipt_line') }],
      });
      ctx.record('delivery_receipt', result.receiptId);
      receipts.push({ id: result.receiptId, number: result.receiptNumber, canary: c });
      runRefs.add(result.receiptNumber);
      receiptLinesSent += 1;
      return result;
    })();
    if (dropB.lines?.[0]?.itemId !== items[0].id) ctx.note(`FINDING? the procurement-door receipt of ${items[0].sku} was put on item ${dropB.lines?.[0]?.itemId}, not ${items[0].id}`);
    if (dropB.order?.status !== 'received') ctx.note(`FINDING? order ${orderB.ref} was delivered in full and reads ${dropB.order?.status}`);
    await simReceipt(dropB.lines?.[0]?.itemId || items[0].id, orderedB, priceB);

    // Order D: no stocked item stands behind its line, so the product makes one
    // on this first delivery (or finds the one an earlier run's delivery made).
    const dropD = await receiveAtStore(
      orderD,
      [{ poLineId: lineOf(orderD, 0).id, acceptedQty: orderedD, rejectedQty: 0, locationId: binFor(2).id, batchNo: `B-${tag}-D`, notes: ctx.canary('delivery_receipt_line') }],
      'First delivery of a line the store has never held'
    );
    const newItemId = dropD.lines?.[0]?.itemId || null;
    if (!newItemId) throw new Error(`inventory: the delivery against ${orderD.ref} named no stocked item`);
    if (dropD.lines[0].itemSku !== newSku) ctx.note(`FINDING? the first delivery of ${newSku} was put on item ${dropD.lines[0].itemSku}`);
    if (!sim.has(newItemId)) sim.set(newItemId, { stock: 0, avg: 0 });
    await simReceipt(newItemId, orderedD, priceD);
    {
      const made = await wh.GET(`/inventory/items/${newItemId}`);
      if (made.createdAt >= startedAt) recordOnce('inventory_item', made.id, made.projectId ? undefined : { scope: 'company' });
      inv.productMadeItem = made.id;
    }

    // The delivery note itself, attached to the first receipt. The upload
    // route has a rate limit of its own; reaching it is a note.
    await optional(
      'delivery note attachment',
      async () => {
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
      },
      [429]
    );

    // Direct receipts: no order behind them.
    const centralCanary = ctx.canary('stock_transaction');
    const centralDrop = await wh.POST('/inventory/stock/receive', {
      itemId: companyItem.id,
      warehouseId: central.id,
      locationId: centralLocations['C-1'].id,
      quantity: 24,
      unitCost: 4.5,
      reference: `CASH ${centralCanary}`,
      notes: `Bought over the counter. ${centralCanary}`,
    });
    recordMovements([centralDrop], { scope: 'company' });
    await simReceipt(companyItem.id, 24, 4.5);

    const cheaper = money(items[1].price * 0.9);
    const looseCanary = ctx.canary('stock_transaction');
    // The damage-on-delivery row the product writes carries this reference too.
    const looseRef = `FREE-ISSUE-${stamp} ${looseCanary}`;
    runRefs.add(looseRef);
    const looseDrop = await wh.POST('/inventory/stock/receive', {
      itemId: items[1].id,
      warehouseId: siteStore.id,
      locationId: binFor(1).id,
      quantity: 10,
      unitCost: cheaper,
      damagedQty: 1,
      damageNotes: `One damaged on arrival. ${ctx.canary('stock_transaction')}`,
      projectId: pid,
      batchNo: `B-${tag}-L ${looseCanary}`.slice(0, 80),
      expiryDate: ctx.daysAhead(365),
      reference: looseRef,
      notes: `Free-issue from the client, one damaged on arrival. ${looseCanary}`,
    });
    recordMovements([looseDrop]);
    await simReceipt(items[1].id, 10, cheaper);
    await simMove(items[1].id, -1);

    // The serial-tracked tool: two units in, one at a time, each with its number.
    const serials = [`SN-${tag}-${stamp}-1`, `SN-${tag}-${stamp}-2`];
    for (const serialNo of serials) {
      const c = ctx.canary('stock_transaction');
      const row = await wh.POST('/inventory/stock/receive', {
        itemId: serialItem.id,
        warehouseId: siteStore.id,
        locationId: binFor(0).id,
        quantity: 1,
        unitCost: 85,
        serialNo,
        projectId: pid,
        reference: `CAL-CERT ${c}`,
        notes: `Delivered with its calibration certificate. ${c}`,
      });
      recordMovements([row]);
      if (row.serialNo !== serialNo) ctx.note(`FINDING? the receipt of ${serialSku} serial ${serialNo} reads serial ${row.serialNo}`);
      await simReceipt(serialItem.id, 1, 85);
    }

    // ── housekeeping movements, each in a named bin ────────────────────────
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

    // A claim on stock: reserved, then partly given back. On hand does not
    // move and the product keeps nothing but the number.
    const reserved = await site.POST('/inventory/stock/reserve', { itemId: items[0].id, warehouseId: siteStore.id, quantity: 4, reference: `RES-${tag}`, notes: 'Held for the pour' });
    const released = await wh.POST('/inventory/stock/reserve', { itemId: items[0].id, warehouseId: siteStore.id, quantity: -1, reference: `RES-${tag}`, notes: 'One released' });
    if (round(released.reserved - reserved.reserved) !== -1) ctx.note(`FINDING? releasing 1 of the reservation moved it from ${reserved.reserved} to ${released.reserved}`);

    // ── issues to the work: the moment stock becomes project cost ──────────
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
      issues.push({ item, quantity, activityId, warehouseId });
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
    // One meter, by its serial number, from the bin it is kept in.
    await issue(site, serialItem, siteStore.id, 1, activityAt(2), { locationId: binFor(0).id, serialNo: serials[0] });

    // ── returns: never more than went out, to the store it came from ───────
    const homeBin = (warehouseId) => (warehouseId === siteStore.id ? binFor(0).id : warehouseId === central.id ? centralLocations['C-1'].id : null);
    const giveBack = async (who, issued, quantity, locationId) => {
      const result = await who.POST('/inventory/stock/return', {
        itemId: issued.item.id,
        warehouseId: issued.warehouseId,
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
    await giveBack(site, issues[0], 1, homeBin(issues[0].warehouseId));
    if (issues[2] && issues[2].quantity >= 2) {
      // To the store's root when it is the site store (no bin named), to its bay when central.
      await giveBack(wh, issues[2], issues[2].quantity - 1, issues[2].warehouseId === central.id ? homeBin(central.id) : null);
    }

    // ── transfers between stores, left in every state ──────────────────────
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
      runRefs.add(created.ref);
      return created;
    };
    const dispatch = async (row) => {
      const sent = await wh.POST(`/inventory/transfers/${row.id}/dispatch`, {});
      if (sent.status !== 'in_transit') ctx.note(`FINDING? transfer ${row.ref} was dispatched and reads ${sent.status}`);
      return sent;
    };

    const moved = await transfer('received', siteStore.id, laydown.id, [[items[0], rng.int(2, 5)], [items[1], rng.int(1, 3)]], 'To the laydown yard for the pour');
    await dispatch(moved);
    await wh.POST(`/inventory/transfers/${moved.id}/receive`, {});

    const shortRun = await transfer('receivedShort', siteStore.id, laydown.id, [[items[0], 4]], 'Second run to the yard');
    await dispatch(shortRun);
    const landed = await wh.POST(`/inventory/transfers/${shortRun.id}/receive`, { lines: [{ id: shortRun.lines[0].id, receivedQty: 2, damagedQty: 1 }] });
    if (landed.lines?.[0]?.receivedQty !== 2 || landed.lines?.[0]?.damagedQty !== 1) ctx.note(`FINDING? transfer ${shortRun.ref} received 2 and 1 damaged; it reads ${JSON.stringify(landed.lines?.[0])}`);
    await simMove(items[0].id, -2); // one damaged on the road, one never arrived

    const onTheRoad = await transfer('inTransit', central.id, siteStore.id, [[companyItem, 3]], 'Consumables for the site store', { scope: 'company' });
    await dispatch(onTheRoad);

    await transfer('draft', laydown.id, siteStore.id, [[items[0], 1]], 'Left over, to come back to the store');

    // ── every receipt line of this run, from the order register ────────────
    // The goods-receipt answer names no receipt line; the order register
    // carries each receipt with its lines.
    {
      const mine = new Set(receipts.map((row) => row.id));
      const register = listOf(await buyer.GET(`${P}/procurement/purchase-orders`));
      let found = 0;
      for (const order of register) {
        for (const receipt of order.deliveryReceipts || []) {
          if (!mine.has(receipt.id)) continue;
          for (const line of receipt.lines || []) {
            recordOnce('delivery_receipt_line', line.id);
            found += 1;
          }
        }
      }
      if (found !== receiptLinesSent) ctx.note(`FINDING? this run posted ${receiptLinesSent} receipt lines; the order register shows ${found}`);
    }

    // ── what the plan row made of "issue to the activity on arrival" ──────
    {
      const row = listOf(await planner.GET(`${P}/activities/${plan[0].activityId}/materials`)).find((candidate) => candidate.id === plan[0].id);
      const issuedQty = Number(row?.issuedQty || 0);
      if (!issuedQty) {
        ctx.note(
          `FINDING: the procurement-door receipt of ${orderB.ref} was sent issueToActivity=true and issuedQty=1 (both accepted by the route); the plan row ${plan[0].id} still reads issuedQty ${row?.issuedQty ?? '(absent)'} and received ${row?.receivedQty ?? '(absent)'}`
        );
      }
    }

    // ── the invoice side of the three-way match ────────────────────────────
    {
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
    }
    await optional('three-way match reads', async () => {
      const byInvoice = await wh.GET(`/inventory/match/invoice/${inv.invoiceId}`);
      if (!byInvoice) ctx.note('FINDING? the three-way match of the invoice answered nothing');
      await wh.GET(`/inventory/match/order/${orderA.id}`);
      await wh.GET(`/inventory/match/order/${orderB.id}`);
      await wh.GET(`/inventory/match/order/${orderD.id}`);
    });

    // ── consumption against the plan ───────────────────────────────────────
    // Nothing in the product raises a plan row's issued quantity (not a stock
    // issue to the activity, not the procurement receipt's issue-on-arrival,
    // not the plan row's own PATCH), so every usage is refused as exceeding it.
    // The refusal is a finding, noted on every run.
    {
      const c = ctx.canary('activity_material_usage');
      const usage = await site.send('POST', `${P}/activities/${plan[0].activityId}/materials/${plan[0].id}/usage`, {
        usedQty: 1,
        wasteQty: 0,
        usageDate: ctx.today,
        installedLocation: `Grid A-D ${c}`,
        notes: c,
      });
      const usageId = usage.body?.data?.usage?.id || usage.body?.data?.id;
      if (usage.status === 201 && usageId) ctx.record('activity_material_usage', usageId);
      else if (usage.status === 409 && usage.body?.error?.code === 'MATERIAL_USAGE_EXCEEDS_ISSUED_QTY') {
        ctx.note(`FINDING: material usage on plan row ${plan[0].id} refused 409 MATERIAL_USAGE_EXCEEDS_ISSUED_QTY after stock was issued to its activity; no route raises a plan row's issuedQty`);
      } else if (usage.status >= 500) {
        ctx.note(`FINDING 5xx: material usage: ${usage.status} ${usage.body?.error?.code || ''} ${usage.body?.error?.message || ''}`.slice(0, 300));
      } else {
        throw new Error(`inventory: material usage answered ${usage.status} ${usage.body?.error?.code || ''} ${usage.body?.error?.message || ''}`.slice(0, 300));
      }
    }

    // ── lead-time alerts this run's plan rows and order lines raised ───────
    {
      const planIds = new Set([...plan.map((row) => row.id), cancelledPlanRow].filter(Boolean));
      const lineIds = new Set([orderA, orderB, orderC, orderD].flatMap((order) => (order.lines || []).map((line) => line.id)));
      const listed = await optional('lead-time alerts', () => buyer.GET(`${P}/procurement/lead-time-alerts`));
      const alerts = listOf(listed).filter((alert) => planIds.has(alert.activityMaterialId) || lineIds.has(alert.poLineId));
      for (const alert of alerts) recordOnce('procurement_lead_time_alert', alert.id);
      const open = alerts.filter((alert) => alert.status === 'open');
      if (open[0]) await buyer.PATCH(`${P}/procurement/lead-time-alerts/${open[0].id}/acknowledge`, { note: `Chased with the supplier. ${ctx.canary('procurement_lead_time_alert')}` });
      if (open[1]) await wh.PATCH(`${P}/procurement/lead-time-alerts/${open[1].id}/resolve`, { note: `Delivered. ${ctx.canary('procurement_lead_time_alert')}` });
      inv.leadTimeAlerts = alerts.map((alert) => alert.id);
    }

    // ── what the store screens read ────────────────────────────────────────
    await optional('inventory reads', async () => {
      await wh.GET(`/inventory/summary?projectId=${pid}`);
      await wh.GET(`/inventory/analytics?projectId=${pid}`);
      await wh.GET(`/inventory/purchase-orders?projectId=${pid}&scope=receivable`);
      const byRef = await wh.GET(`/inventory/purchase-orders/${encodeURIComponent(orderA.ref)}`);
      if (byRef?.id !== orderA.id) ctx.note(`FINDING? looking up ${orderA.ref} by its reference found ${byRef?.id}, not ${orderA.id}`);
      await wh.GET('/inventory/transfers?status=in_transit');
      await wh.GET(`/inventory/items?projectId=${pid}&lowStock=true`);
      await wh.GET(`/inventory/stock/transactions?projectId=${pid}&type=issue&limit=50`);
      await wh.GET(`/inventory/stock/transactions?itemId=${items[0].id}&limit=50`);
      const scanned = await site.GET(`/inventory/items/scan/${encodeURIComponent(`BC-${items[0].sku}`)}`);
      if (scanned.item?.id !== items[0].id) ctx.note(`FINDING? scanning BC-${items[0].sku} found ${scanned.item?.id}, not ${items[0].id}`);
    });

    // ── the arithmetic behind them ─────────────────────────────────────────
    for (const itemId of sim.keys()) {
      const now = await wh.GET(`/inventory/items/${itemId}`);
      const expected = sim.get(itemId);
      const stock = round(now.onHand + now.inTransit + now.quarantined);
      if (Math.abs(stock - expected.stock) > 0.0001) ctx.note(`FINDING? ${now.sku}: the product holds ${stock} (on hand + in transit + quarantined); the movements of this run make it ${expected.stock}`);
      if (Math.abs(Number(now.averageCost) - expected.avg) > 0.0001) ctx.note(`FINDING? ${now.sku}: weighted average ${now.averageCost}; the receipts of this run make it ${expected.avg}`);
    }

    if (ledgerBefore) {
      const ledgerAfter = await optional('cost reconciliation (after)', () => cost.GET(`${P}/cost/reconciliation`));
      if (ledgerAfter) {
        const before = money(ledgerBefore.ledger?.bySource?.material_issue || 0);
        const after = money(ledgerAfter.ledger?.bySource?.material_issue || 0);
        const posted = money(after - before);
        const expected = money(issuedValue - returnedValue);
        if (Math.abs(posted - expected) > 0.005) ctx.note(`FINDING? the cost ledger took ${posted} of material issues in this run; the stock movements were worth ${expected}`);
        if (ledgerBefore.balanced && !ledgerAfter.balanced) ctx.note('FINDING? the cost reconciliation was balanced before this run and is not after it');
        // What the ledger itself holds, never the driver's expectation.
        inv.materialIssueLedger = { total: after, lastRun: posted, lastRunStockValue: expected, balanced: Boolean(ledgerAfter.balanced) };
        delete inv.materialCostPosted;
      }
    }

    inv.receipts = receipts.map((row) => row.id);
  } catch (error) {
    failure = error;
  }

  // The sweep runs however the run ended. One that fails after a good run
  // fails the run (its movements would go unrecorded); after a failed run it
  // is a note beside the failure, which is what the run reports.
  try {
    await sweep();
  } catch (error) {
    if (!failure) throw error;
    ctx.note(`stock ledger sweep after the failure: ${short(error)}`);
  }
  if (failure) throw failure;
};

module.exports = { name: 'inventory', needs: ['foundation'], depths: ['standard'], run, helpers: { pdf } };
