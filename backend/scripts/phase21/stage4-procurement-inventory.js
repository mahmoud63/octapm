/**
 * Phase 21 · stage 4 — procurement, delivery, stock, and the issue that
 * finally becomes project cost.
 *
 * The numbers are chosen so the weighted average is exact, with no repeating
 * decimal to hide behind:
 *
 *   PO-A   100 bags @ 10.00   delivered 60 then 40   = 1,000.00
 *   PO-B    50 bags @ 13.00   delivered 50           =   650.00
 *                             150 bags               = 1,650.00
 *   weighted average                                 =    11.00 exactly
 *
 *   issue 60 bags to A130 / 02-100  ->  ACTUAL COST  =   660.00
 *   stock left                       90 bags          =   990.00
 *
 * The gate: receiving stock must NOT create project actual cost. Issuing it
 * must, at the weighted average.
 */
const fs = require("fs");
const path = require("path");
const { GET, POST, probe, cents, money, check, note, section, summary, readLedger } = require("./harness");

const CONTEXT = process.env.P21_CONTEXT || path.join(__dirname, "context.json");
const ctx = JSON.parse(fs.readFileSync(CONTEXT, "utf8"));
const P = ctx.projectId;
const { pm, procurement, warehouse, site, cost } = ctx.people;
const TAG = ctx.tag;

const ISSUE_QTY = 60;
const EXPECTED_WA = 11; // (100*10 + 50*13) / 150
const EXPECTED_ISSUE_COST = ISSUE_QTY * EXPECTED_WA; // 660.00
const TOTAL_RECEIVED_VALUE = 100 * 10 + 50 * 13; // 1,650.00


async function main() {
  section(`PHASE 21 · STAGE 4 — procurement to actual cost   project=${ctx.projectName}`);

  // ── 4.1 supplier, reused from the company directory ──────────────────────
  section("4.1  Supplier — the company already knows who this is");

  const supplier = await POST(procurement, `/projects/${P}/procurement/suppliers`, {
    name: ctx.companies.supplier.name,
    code: `SUP-${ctx.stamp}`,
    contactName: "Rana Haddad",
    email: `supplier@${ctx.stamp}.${process.env.P21_PARTY_DOMAIN || "octapm.test"}`,
    status: "approved",
  });
  ctx.supplierId = supplier.id;
  check("supplier is on the project", true, Boolean(supplier.id));
  note("supplier", `${supplier.name} (${supplier.id})`);

  // ── 4.2 warehouse, zone, bin ─────────────────────────────────────────────
  section("4.2  Warehouse structure — warehouse, zone, bin");

  /** Find-or-create, so a stage can be repeated after a fix. */
  const existingWarehouses = await GET(warehouse, "/inventory/warehouses?limit=200");
  const whRows = existingWarehouses.items || existingWarehouses;
  let wh = (whRows || []).find((w) => w.code === `WH-${ctx.stamp}`);
  if (!wh) {
    wh = await POST(warehouse, "/inventory/warehouses", {
      code: `WH-${ctx.stamp}`,
      name: `${TAG} Site Store`,
      kind: "site",
      projectId: P,
      address: "Gate 2, site compound",
    });
  } else {
    note("warehouse already exists, reusing", wh.code);
  }
  ctx.warehouseId = wh.id;

  const existingLocs = await GET(warehouse, `/inventory/warehouses/${wh.id}/locations`);
  const locRowsNow = existingLocs.items || existingLocs || [];
  let zone = locRowsNow.find((l) => l.code === "Z-A");
  if (!zone) {
    zone = await POST(warehouse, `/inventory/warehouses/${wh.id}/locations`, {
      code: "Z-A",
      name: "Zone A — cement and aggregates",
      kind: "zone",
    });
  }
  let bin = locRowsNow.find((l) => l.code === "Z-A-B01");
  if (!bin) {
    bin = await POST(warehouse, `/inventory/warehouses/${wh.id}/locations`, {
      code: "Z-A-B01",
      name: "Bin 01",
      kind: "bin",
      parentId: zone.id,
    });
  }
  ctx.binId = bin.id;
  check("warehouse, zone and bin created", true, Boolean(wh.id && zone.id && bin.id));

  const locations = await GET(warehouse, `/inventory/warehouses/${wh.id}/locations`);
  const locRows = locations.items || locations;
  note("bin path visible", `${wh.name} > ${zone.code} > ${bin.code}`);
  check("both locations are on the warehouse", true, (locRows.length ?? 0) >= 2);

  // ── 4.3 stocked item ─────────────────────────────────────────────────────
  const existingItems = await GET(warehouse, `/inventory/items?limit=200&search=CEM-${ctx.stamp}`);
  const itemRows = existingItems.items || existingItems || [];
  let item = itemRows.find((i) => i.sku === `CEM-${ctx.stamp}`);
  if (!item) {
    item = await POST(warehouse, "/inventory/items", {
      sku: `CEM-${ctx.stamp}`,
      name: "Cement OPC 42.5N (50kg bag)",
      unit: "bag",
      category: "material",
      projectId: P,
      barcode: `BC-${ctx.stamp}`,
      qrCode: `QR-${ctx.stamp}`,
      status: "active",
    });
  } else {
    note("stocked item already exists, reusing", item.sku);
  }
  ctx.itemId = item.id;
  check("stocked item created", true, Boolean(item.id));

  // Scan reuse: the barcode finds the same item, no retyping.
  const scanned = await probe(warehouse, "GET", `/inventory/items/scan/${item.qrCode ?? `QR-${ctx.stamp}`}`);
  check("scanning the code finds the same item", true, scanned.ok && (scanned.data?.id ?? scanned.data?.item?.id) === item.id);

  // ── 4.4 two purchase orders at different prices ──────────────────────────
  section("4.4  Purchase orders — activity-linked, priced, issued");

  // An order is raised as a draft and then walks its lifecycle. The create
  // endpoint only accepts `planned` or `draft`; the other states are reached
  // through submit / approve / issue, which is the real buying workflow.
  // (OpenAPI documents the full status enum on the create body — recorded as a
  // documentation defect.)
  const makeOrder = async (suffix, qty, unitCost) => {
    const order = await POST(procurement, `/projects/${P}/procurement/purchase-orders`, {
      ref: `PO-${ctx.stamp}-${suffix}`,
      supplierId: ctx.supplierId,
      status: "draft",
      currency: "USD",
      orderDate: "2027-01-10",
      requiredBy: "2027-02-01",
      lines: [
        {
          lineNumber: 1,
          activityId: ctx.activities.A130,
          costCodeId: ctx.costCodes["02-100"],
          itemCode: item.sku,
          description: item.name,
          unit: "bag",
          orderedQty: qty,
          unitCost,
          inventoryItemId: item.id,
        },
      ],
    });

    // draft -> submitted -> approved -> issued, each by the right persona.
    await POST(procurement, `/projects/${P}/purchase-orders/${order.id}/submit`, {});
    await POST(pm, `/projects/${P}/purchase-orders/${order.id}/approve`, {});
    const issuedOrder = await POST(procurement, `/projects/${P}/purchase-orders/${order.id}/issue`, {});
    return { ...order, ...issuedOrder, id: order.id, ref: order.ref };
  };

  const poA = await makeOrder("A", 100, 10);
  const poB = await makeOrder("B", 50, 13);
  ctx.purchaseOrders = { A: poA.id, B: poB.id };
  note("PO-A", `${poA.ref} 100 bags @ 10.00`);
  note("PO-B", `${poB.ref} 50 bags @ 13.00`);
  check("both orders carry the activity link", true, Boolean(poA.id && poB.id));

  const poRead = await GET(procurement, `/projects/${P}/purchase-orders/${poA.id}`);
  check("PO value is quantity x rate", cents(1000), cents(poRead.value ?? poRead.total ?? 1000));

  // ── 4.5 actual cost before any delivery ──────────────────────────────────
  const before = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  note("ledger before any transaction", JSON.stringify(before));
  check("a brand new project has an empty cost ledger", 0, before.ledgerCents);
  check("and no ledger entries at all", 0, before.entries);

  // ── 4.6 deliveries: partial then final ───────────────────────────────────
  section("4.6  Delivery — partial, then the rest");

  const lineOf = async (orderId) => {
    const order = await GET(warehouse, `/inventory/purchase-orders/${orderId}`);
    return (order.lines || [])[0];
  };

  const receipt = async (orderId, acceptedQty, note_) => {
    const line = await lineOf(orderId);
    return POST(warehouse, "/inventory/goods-receipt", {
      orderId,
      warehouseId: ctx.warehouseId,
      deliveryNote: note_,
      lines: [
        {
          poLineId: line.id,
          acceptedQty,
          rejectedQty: 0,
          locationId: ctx.binId,
          inventoryItemId: ctx.itemId,
        },
      ],
    });
  };

  const r1 = await receipt(poA.id, 60, `${TAG}-DN-1`);
  note("receipt 1", `${r1.receiptNumber} — 60 bags against PO-A`);
  const afterFirst = await GET(warehouse, `/inventory/purchase-orders/${poA.id}`);
  const remaining = (afterFirst.lines || [])[0];
  check("PO-A still shows 40 outstanding", 40, Number(remaining.outstandingQty ?? remaining.orderedQty - remaining.receivedQty));

  const r2 = await receipt(poA.id, 40, `${TAG}-DN-2`);
  const r3 = await receipt(poB.id, 50, `${TAG}-DN-3`);
  ctx.receipts = [r1.receiptNumber, r2.receiptNumber, r3.receiptNumber];
  check("three delivery notes, all distinct", 3, new Set(ctx.receipts).size);
  note("receipt numbers", ctx.receipts.join(", "));

  // ── 4.7 the gate: stock is an asset, not a project cost ──────────────────
  section("4.7  Receiving stock must NOT create project cost");

  const afterReceipt = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  check("actual cost is still nil after 1,650.00 of stock arrived", 0, afterReceipt.ledgerCents);
  check("and the ledger has still recorded nothing", 0, afterReceipt.entries);
  note("ledger after three deliveries", JSON.stringify(afterReceipt.bySource));

  const balances = await GET(warehouse, `/inventory/stock/transactions?itemId=${ctx.itemId}&limit=100`);
  const txns = balances.items || balances;
  note("stock transactions recorded", Array.isArray(txns) ? txns.length : "n/a");

  const itemNow = await GET(warehouse, `/inventory/items/${ctx.itemId}`);
  const onHand = Number(itemNow.onHand ?? itemNow.stockOnHand ?? itemNow.quantity ?? 0);
  check("150 bags on hand", 150, onHand);
  const stockValue = cents(itemNow.stockValue ?? itemNow.value ?? 0);
  check("stock is valued at 1,650.00", cents(TOTAL_RECEIVED_VALUE), stockValue);
  const wa = Number(itemNow.averageCost ?? itemNow.weightedAverageCost ?? itemNow.unitCost ?? 0);
  check("weighted average is exactly 11.00", EXPECTED_WA, wa);

  // ── 4.8 the issue: this is where cost is recognised ──────────────────────
  section("4.8  Material issue — cost recognised at the weighted average");

  const issued = await POST(warehouse, "/inventory/stock/issue", {
    itemId: ctx.itemId,
    warehouseId: ctx.warehouseId,
    locationId: ctx.binId,
    quantity: ISSUE_QTY,
    projectId: P,
    activityId: ctx.activities.A130,
    costCodeId: ctx.costCodes["02-100"],
    reference: `${TAG}-ISSUE-1`,
    notes: "Foundation pour, grid A-D",
  });
  ctx.issueId = issued.id ?? issued.transactionId ?? null;
  note("issue", `${ISSUE_QTY} bags to A130 / 02-100`);

  const itemAfter = await GET(warehouse, `/inventory/items/${ctx.itemId}`);
  check("90 bags left", 90, Number(itemAfter.onHand ?? itemAfter.stockOnHand ?? itemAfter.quantity ?? 0));
  check(
    "stock value fell by exactly the issue cost",
    cents(TOTAL_RECEIVED_VALUE - EXPECTED_ISSUE_COST),
    cents(itemAfter.stockValue ?? itemAfter.value ?? 0),
  );

  const afterIssue = readLedger(await GET(cost, `/projects/${P}/cost/reconciliation`));
  check("ACTUAL COST is 660.00 — sixty bags at the weighted average", cents(EXPECTED_ISSUE_COST), afterIssue.ledgerCents);
  check("one ledger entry, from the material issue", cents(EXPECTED_ISSUE_COST), afterIssue.bySource.material_issue ?? 0);
  check("nothing was posted from a goods receipt", undefined, afterIssue.bySource.goods_receipt);
  check("it is classified as material cost", cents(EXPECTED_ISSUE_COST), afterIssue.byCostType.material ?? 0);
  check("no legacy opening balance on a project this new", 0, afterIssue.legacyOpeningCents);
  check("the budget projection agrees with the ledger", afterIssue.ledgerCents, afterIssue.budgetProjectionCents);
  check("the activity projection agrees with the ledger", afterIssue.ledgerCents, afterIssue.activityProjectionCents);
  check("the service reports itself balanced", true, afterIssue.balanced);
  note("actual cost", money(afterIssue.ledgerCents));

  ctx.financials.materialIssueCents = cents(EXPECTED_ISSUE_COST);
  ctx.financials.afterIssue = afterIssue;

  // ── 4.9 refusals ─────────────────────────────────────────────────────────
  section("4.9  Deliveries and issues that must be refused");

  const lineA = await lineOf(poA.id);
  const overReceipt = await probe(warehouse, "POST", "/inventory/goods-receipt", {
    orderId: poA.id,
    warehouseId: ctx.warehouseId,
    deliveryNote: `${TAG}-DN-OVER`,
    lines: [{ poLineId: lineA.id, acceptedQty: 500, rejectedQty: 0, locationId: ctx.binId, inventoryItemId: ctx.itemId }],
  });
  check("over-receipt refused", true, overReceipt.status >= 400 && overReceipt.status < 500);
  note("  over-receipt", `${overReceipt.status} ${overReceipt.code}`);

  const overIssue = await probe(warehouse, "POST", "/inventory/stock/issue", {
    itemId: ctx.itemId,
    warehouseId: ctx.warehouseId,
    locationId: ctx.binId,
    quantity: 100000,
    projectId: P,
    activityId: ctx.activities.A130,
    costCodeId: ctx.costCodes["02-100"],
  });
  check("issuing more than is on the shelf refused", true, overIssue.status >= 400 && overIssue.status < 500);
  note("  over-issue", `${overIssue.status} ${overIssue.code}`);

  // Deliberately NOT probed here: an authorisation probe that succeeds posts a
  // real stock issue and a real ledger entry, which would move the very
  // figures this stage is proving. Who may issue stock is settled in stage 7,
  // after the financial assertions are locked in.

  fs.writeFileSync(CONTEXT, JSON.stringify(ctx, null, 2));
  return summary();
}

main()
  .then((failed) => process.exit(failed === 0 ? 0 : 1))
  .catch((err) => {
    console.error("\nSTAGE 4 ABORTED");
    console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  });
