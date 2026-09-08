const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const inventory = require("./inventory.service");

/**
 * Goods receipt against a purchase order, and the three-way match that follows
 * (OCTA-INV-STOCK-050).
 *
 * Receiving is the join between procurement and the store: the order says what
 * was asked for, the receipt says what turned up, and the stock ledger says
 * where it went. All three are written in one database transaction, because a
 * delivery that updates the PO but not the shelf — or the other way round — is
 * worse than one that was never recorded.
 *
 * The match then compares ordered, received and invoiced. It reports; it does
 * not block. Deciding what to do about a short delivery is the QS's job, and a
 * system that silently refuses the invoice just moves the argument off-screen.
 */

/** Rounding noise, not a discrepancy. */
const QTY_EPSILON = 0.001;
/** A unit price within this fraction of the ordered price is not a variance. */
const PRICE_TOLERANCE = 0.005;

const round = (value, dp = 4) => {
  const factor = 10 ** dp;
  return Math.round((Number(value) || 0) * factor) / factor;
};

const money = (value) => round(value, 2);
const num = (value) => Number(value ?? 0);

const trimOrNull = (value) => {
  const text = String(value ?? "").trim();
  return text ? text : null;
};

// ─── finding the order ─────────────────────────────────────────────────────

const orderInclude = {
  supplierRef: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
  lines: {
    orderBy: [{ lineNumber: "asc" }],
    include: {
      inventoryItem: { select: { id: true, sku: true, name: true, unit: true } },
      activity: { select: { id: true, name: true } },
    },
  },
};

const serializeOrderLine = (line) => {
  const ordered = num(line.orderedQty);
  const received = num(line.receivedQty);
  return {
    id: line.id,
    lineNumber: line.lineNumber,
    itemCode: line.itemCode,
    description: line.description,
    spec: line.spec,
    unit: line.unit,
    orderedQty: round(ordered),
    receivedQty: round(received),
    rejectedQty: round(num(line.rejectedQty)),
    outstandingQty: round(Math.max(0, ordered - received)),
    unitCost: money(line.unitCost),
    activityId: line.activityId,
    activity: line.activity?.name ?? null,
    inventoryItemId: line.inventoryItemId,
    inventoryItem: line.inventoryItem
      ? {
          id: line.inventoryItem.id,
          sku: line.inventoryItem.sku,
          name: line.inventoryItem.name,
          unit: line.inventoryItem.unit,
        }
      : null,
    status: line.status,
  };
};

const serializeOrder = (order) => ({
  id: order.id,
  ref: order.ref,
  status: order.status,
  warehouseStatus: order.warehouseStatus,
  projectId: order.projectId,
  project: order.project?.name ?? null,
  supplierId: order.supplierId,
  supplier: order.supplierRef?.name ?? order.supplier ?? null,
  value: money(order.value),
  currency: order.currency,
  orderDate: order.orderDate?.toISOString() ?? null,
  promisedDate: order.promisedDate?.toISOString() ?? null,
  lines: (order.lines ?? []).map(serializeOrderLine),
});

/**
 * Finds a purchase order by its reference — what someone scans or types off a
 * delivery note — or by id.
 */
const findPurchaseOrder = async ({ orgId, ref }) => {
  const value = String(ref ?? "").trim();
  if (!value) throw new HttpError(400, "PO_REF_REQUIRED", "Give a purchase order reference");

  // Orders are project-scoped; the org is reached through the project.
  const order = await prisma.procurementOrder.findFirst({
    where: {
      project: { orgId },
      OR: [{ ref: value }, { id: value }],
    },
    include: orderInclude,
  });
  if (!order) {
    throw new HttpError(404, "PO_NOT_FOUND", `No purchase order matches "${value}"`);
  }
  return serializeOrder(order);
};

/**
 * Purchase orders worth looking at.
 *
 * Two callers want two different lists. Goods receipt wants what is still
 * expecting a delivery ("receivable"); the three-way match wants those too *and*
 * the ones already received, because a fully delivered order with a wrong
 * invoice is precisely what the match exists to catch. Neither wants an order
 * that was cancelled or closed.
 */
const ORDER_SCOPES = ["receivable", "all"];

const listOrders = async ({ orgId, projectId = null, scope = "all" }) => {
  const status =
    scope === "receivable"
      ? { in: ["draft", "issued", "partial"] }
      : { notIn: ["cancelled", "closed"] };

  const orders = await prisma.procurementOrder.findMany({
    where: {
      project: { orgId },
      ...(projectId ? { projectId } : {}),
      status,
    },
    include: orderInclude,
    orderBy: [{ promisedDate: "asc" }, { ref: "asc" }],
    take: 100,
  });
  return { items: orders.map(serializeOrder) };
};

// ─── receiving ─────────────────────────────────────────────────────────────

/**
 * Finds or creates the stocked item a PO line becomes.
 *
 * A first delivery against a line usually has no inventory item yet — the
 * buyer ordered "Cement OPC 42.5N", not SKU CEM-42.5N. Rather than making the
 * storeman stop and set one up, this matches on the code and creates one if it
 * has to, then remembers the mapping on the line for next time.
 */
const resolveInventoryItem = async (tx, { orgId, user, line, requestedItemId }) => {
  if (requestedItemId) {
    const item = await tx.inventoryItem.findFirst({
      where: { id: requestedItemId, orgId },
    });
    if (!item) throw new HttpError(404, "ITEM_NOT_FOUND", "Item not found");
    return item;
  }
  if (line.inventoryItemId) {
    const item = await tx.inventoryItem.findFirst({
      where: { id: line.inventoryItemId, orgId },
    });
    if (item) return item;
  }

  const sku = trimOrNull(line.itemCode) || `PO-${line.id.slice(0, 8)}`;
  const existing = await tx.inventoryItem.findFirst({ where: { orgId, sku } });
  if (existing) return existing;

  return tx.inventoryItem.create({
    data: {
      orgId,
      sku,
      qrCode: sku,
      name: line.description,
      unit: line.unit,
      specification: line.spec ?? null,
      unitCost: line.unitCost,
      notes: "Created on first goods receipt",
      createdBy: user.id,
      updatedBy: user.id,
    },
  });
};

/**
 * Posts a delivery: the receipt record, the stock, and the order's progress.
 *
 * Over-receipt is refused. A line that has already had everything delivered
 * should not quietly take more — that is either the wrong PO or the wrong
 * line, and both are worth stopping for.
 */
const receiveAgainstOrder = async ({ orgId, user, payload }) => {
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (!lines.length) {
    throw new HttpError(400, "RECEIPT_EMPTY", "Say what was delivered");
  }

  return prisma.$transaction(async (tx) => {
    const order = await tx.procurementOrder.findFirst({
      where: { id: payload.orderId, project: { orgId } },
      include: { lines: true },
    });
    if (!order) throw new HttpError(404, "PO_NOT_FOUND", "Purchase order not found");

    const warehouse = await tx.warehouse.findFirst({
      where: { id: payload.warehouseId, orgId },
    });
    if (!warehouse) {
      throw new HttpError(404, "WAREHOUSE_NOT_FOUND", "Warehouse not found");
    }

    const receiptCount = await tx.deliveryReceipt.count({ where: { projectId: order.projectId } });
    const receipt = await tx.deliveryReceipt.create({
      data: {
        projectId: order.projectId,
        orderId: order.id,
        packageId: order.packageId,
        supplierId: order.supplierId,
        receiptNumber:
          trimOrNull(payload.receiptNumber) || `GRN-${String(receiptCount + 1).padStart(5, "0")}`,
        receivedBy: user.id,
        warehouseLocation: warehouse.name,
        deliveryNote: trimOrNull(payload.deliveryNote),
        notes: trimOrNull(payload.notes),
        status: "posted",
        createdBy: user.id,
      },
    });

    const posted = [];
    for (const reported of lines) {
      const line = order.lines.find((candidate) => candidate.id === reported.poLineId);
      if (!line) {
        throw new HttpError(404, "PO_LINE_NOT_FOUND", "That line is not on this order");
      }

      const acceptedQty = Math.max(0, Number(reported.acceptedQty) || 0);
      const rejectedQty = Math.max(0, Number(reported.rejectedQty) || 0);
      if (acceptedQty + rejectedQty <= 0) continue;

      const alreadyIn = num(line.receivedQty) + num(line.rejectedQty);
      const ordered = num(line.orderedQty);
      if (alreadyIn + acceptedQty + rejectedQty > ordered + QTY_EPSILON) {
        throw new HttpError(
          409,
          "RECEIPT_OVER_ORDER",
          `Line ${line.lineNumber} was ordered ${round(ordered)} ${line.unit}; ` +
            `${round(alreadyIn)} already in and ${round(acceptedQty + rejectedQty)} more reported`
        );
      }

      const item = await resolveInventoryItem(tx, {
        orgId,
        user,
        line,
        requestedItemId: reported.inventoryItemId,
      });

      const receiptLine = await tx.deliveryReceiptLine.create({
        data: {
          projectId: order.projectId,
          receiptId: receipt.id,
          orderId: order.id,
          poLineId: line.id,
          activityId: line.activityId,
          activityMaterialId: line.activityMaterialId,
          acceptedQty,
          rejectedQty,
          notes: trimOrNull(reported.notes),
        },
      });

      // The stock, at the price actually invoiced on this delivery when one is
      // given, otherwise at the ordered price.
      if (acceptedQty > 0) {
        posted.push(
          await inventory.postMovement(tx, {
            orgId,
            item,
            warehouseId: warehouse.id,
            locationId: trimOrNull(reported.locationId),
            type: "receipt",
            quantity: acceptedQty,
            unitCost:
              reported.unitCost === undefined || reported.unitCost === null
                ? num(line.unitCost)
                : Number(reported.unitCost),
            user,
            context: {
              projectId: order.projectId,
              activityId: line.activityId,
              // The buyer's coding, carried onto the stock ledger
              // (OCTA-FIN-POLINE-060) so an issue can inherit what the
              // material was bought against instead of asking again.
              costCodeId: line.costCodeId ?? null,
              boqItemId: line.boqItemId ?? null,
              poLineId: line.id,
              receiptLineId: receiptLine.id,
              batchNo: reported.batchNo,
              serialNo: reported.serialNo,
              expiryDate: reported.expiryDate,
              reference: receipt.receiptNumber,
              notes: trimOrNull(reported.notes),
            },
          })
        );
      }

      // What was rejected never becomes stock: it goes back on the lorry. It is
      // recorded on the receipt line so the match can see it.

      await tx.procurementPoLine.update({
        where: { id: line.id },
        data: {
          receivedQty: round(num(line.receivedQty) + acceptedQty),
          rejectedQty: round(num(line.rejectedQty) + rejectedQty),
          inventoryItemId: item.id,
          status:
            num(line.receivedQty) + acceptedQty >= ordered - QTY_EPSILON
              ? "received"
              : "partial",
        },
      });
    }

    // The order's own progress, from its lines rather than a separate counter.
    const refreshed = await tx.procurementPoLine.findMany({ where: { orderId: order.id } });
    const allIn = refreshed.every(
      (line) => num(line.receivedQty) >= num(line.orderedQty) - QTY_EPSILON
    );
    const anyIn = refreshed.some((line) => num(line.receivedQty) > 0);
    await tx.procurementOrder.update({
      where: { id: order.id },
      data: {
        warehouseStatus: allIn ? "received" : anyIn ? "partial" : "not_received",
        status: allIn ? "received" : anyIn ? "partial" : order.status,
        receivedAt: allIn ? new Date() : order.receivedAt,
      },
    });

    return {
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber,
      movements: posted.length,
    };
  });
};

// ─── three-way match ───────────────────────────────────────────────────────

/**
 * Compares one ordered line against what arrived and what was billed.
 *
 * Quantities come from the PO line and the invoice lines pointing at it;
 * "received" is the accepted quantity, because rejected goods went back on the
 * lorry and should never make an invoice look justified.
 */
const matchLine = (line, invoiceLines) => {
  const ordered = num(line.orderedQty);
  const received = num(line.receivedQty);
  const rejected = num(line.rejectedQty);
  const orderedPrice = num(line.unitCost);

  const invoicedQty = round(
    invoiceLines.reduce((sum, invoiceLine) => sum + num(invoiceLine.quantity), 0)
  );
  const invoicedValue = money(
    invoiceLines.reduce((sum, invoiceLine) => sum + num(invoiceLine.amount), 0)
  );
  const invoicedPrice = invoicedQty > 0 ? round(invoicedValue / invoicedQty) : 0;

  const flags = [];
  if (invoicedQty > received + QTY_EPSILON) {
    flags.push({
      code: "invoiced_more_than_received",
      severity: "blocking",
      message: `Invoiced ${round(invoicedQty)} ${line.unit} but only ${round(received)} were accepted`,
    });
  }
  if (received > ordered + QTY_EPSILON) {
    flags.push({
      code: "received_more_than_ordered",
      severity: "warning",
      message: `Received ${round(received)} ${line.unit} against ${round(ordered)} ordered`,
    });
  }
  if (
    invoicedQty > QTY_EPSILON &&
    orderedPrice > 0 &&
    Math.abs(invoicedPrice - orderedPrice) / orderedPrice > PRICE_TOLERANCE
  ) {
    flags.push({
      code: "price_variance",
      severity: "blocking",
      message: `Invoiced at ${invoicedPrice} against ${orderedPrice} ordered`,
    });
  }
  if (rejected > QTY_EPSILON) {
    flags.push({
      code: "rejected_on_delivery",
      severity: "warning",
      message: `${round(rejected)} ${line.unit} were rejected on delivery`,
    });
  }
  if (received + QTY_EPSILON < ordered && invoicedQty > QTY_EPSILON) {
    flags.push({
      code: "short_delivered",
      severity: "info",
      message: `${round(ordered - received)} ${line.unit} of the order are still outstanding`,
    });
  }

  return {
    poLineId: line.id,
    lineNumber: line.lineNumber,
    description: line.description,
    unit: line.unit,
    orderedQty: round(ordered),
    receivedQty: round(received),
    rejectedQty: round(rejected),
    invoicedQty,
    orderedValue: money(ordered * orderedPrice),
    receivedValue: money(received * orderedPrice),
    invoicedValue,
    orderedUnitCost: orderedPrice,
    invoicedUnitCost: invoicedPrice,
    flags,
  };
};

const verdictFor = (lines) => {
  const flags = lines.flatMap((line) => line.flags);
  if (flags.some((flag) => flag.severity === "blocking")) return "review";
  if (flags.some((flag) => flag.severity === "warning")) return "check";
  return "matched";
};

/** The match for one purchase order, across every invoice raised against it. */
const matchOrder = async ({ orgId, orderId }) => {
  const order = await prisma.procurementOrder.findFirst({
    where: { id: orderId, project: { orgId } },
    include: {
      ...orderInclude,
      supplierInvoices: {
        include: { lines: true },
        orderBy: [{ costDate: "asc" }],
      },
    },
  });
  if (!order) throw new HttpError(404, "PO_NOT_FOUND", "Purchase order not found");

  const invoiceLinesByPoLine = new Map();
  for (const invoice of order.supplierInvoices) {
    // A voided invoice is not a claim on anything.
    if (invoice.status === "void") continue;
    for (const line of invoice.lines) {
      if (!line.poLineId) continue;
      const bucket = invoiceLinesByPoLine.get(line.poLineId) ?? [];
      bucket.push(line);
      invoiceLinesByPoLine.set(line.poLineId, bucket);
    }
  }

  const lines = order.lines.map((line) =>
    matchLine(line, invoiceLinesByPoLine.get(line.id) ?? [])
  );

  return {
    orderId: order.id,
    ref: order.ref,
    supplier: order.supplierRef?.name ?? order.supplier ?? null,
    projectId: order.projectId,
    verdict: verdictFor(lines),
    totals: {
      ordered: money(lines.reduce((sum, line) => sum + line.orderedValue, 0)),
      received: money(lines.reduce((sum, line) => sum + line.receivedValue, 0)),
      invoiced: money(lines.reduce((sum, line) => sum + line.invoicedValue, 0)),
    },
    invoices: order.supplierInvoices.map((invoice) => ({
      id: invoice.id,
      ref: invoice.ref,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      total: money(invoice.total),
      costDate: invoice.costDate?.toISOString() ?? null,
    })),
    lines,
  };
};

/**
 * The match from one invoice's side.
 *
 * An invoice line with no purchase order line behind it is reported rather than
 * ignored: an unmatched charge is exactly the thing this is meant to catch.
 */
const matchInvoice = async ({ orgId, directCostId }) => {
  const invoice = await prisma.directCost.findFirst({
    where: { id: directCostId, orgId },
    include: {
      lines: { include: { poLine: true } },
      purchaseOrder: { include: { lines: true, supplierRef: { select: { name: true } } } },
    },
  });
  if (!invoice) throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found");

  if (!invoice.purchaseOrderId || !invoice.purchaseOrder) {
    return {
      invoiceId: invoice.id,
      ref: invoice.ref,
      invoiceNumber: invoice.invoiceNumber,
      total: money(invoice.total),
      verdict: "unmatched",
      flags: [
        {
          code: "no_purchase_order",
          severity: "warning",
          message: "This invoice is not against a purchase order, so it cannot be matched",
        },
      ],
      lines: [],
    };
  }

  const byPoLine = new Map();
  for (const line of invoice.lines) {
    if (!line.poLineId) continue;
    const bucket = byPoLine.get(line.poLineId) ?? [];
    bucket.push(line);
    byPoLine.set(line.poLineId, bucket);
  }

  const lines = invoice.purchaseOrder.lines
    .filter((line) => byPoLine.has(line.id))
    .map((line) => matchLine(line, byPoLine.get(line.id)));

  const unlinked = invoice.lines.filter((line) => !line.poLineId);
  const flags = unlinked.length
    ? [
        {
          code: "lines_without_order",
          severity: "warning",
          message: `${unlinked.length} invoice line${unlinked.length === 1 ? "" : "s"} are not against an ordered line`,
        },
      ]
    : [];

  const verdict = flags.length ? "check" : verdictFor(lines);

  return {
    invoiceId: invoice.id,
    ref: invoice.ref,
    invoiceNumber: invoice.invoiceNumber,
    total: money(invoice.total),
    orderId: invoice.purchaseOrderId,
    orderRef: invoice.purchaseOrder.ref,
    supplier: invoice.purchaseOrder.supplierRef?.name ?? null,
    verdict,
    flags,
    totals: {
      ordered: money(lines.reduce((sum, line) => sum + line.orderedValue, 0)),
      received: money(lines.reduce((sum, line) => sum + line.receivedValue, 0)),
      invoiced: money(lines.reduce((sum, line) => sum + line.invoicedValue, 0)),
    },
    lines,
  };
};

module.exports = {
  ORDER_SCOPES,
  PRICE_TOLERANCE,
  QTY_EPSILON,
  findPurchaseOrder,
  listOrders,
  matchInvoice,
  matchLine,
  matchOrder,
  receiveAgainstOrder,
};
