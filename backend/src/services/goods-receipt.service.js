const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { nextRef } = require("../utils/reference-number");
const inventory = require("./inventory.service");
const procurement = require("./procurement.service");

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
 * The stocked items a delivery needs, settled before the transaction opens.
 *
 * Two lorries at the gate at once, both carrying something the warehouse has
 * never held: each delivery looks the item up, finds nothing, and inserts. The
 * second insert breaks the unique index — and a failed statement inside a
 * Postgres transaction poisons the whole transaction, so catching it there is
 * no help: the storeman gets a raw 500 and loses the delivery they just booked.
 *
 * Creating the items first, each in its own small transaction, keeps that race
 * out of the receipt. A collision here costs one re-read and nothing else
 * (OCTA-PROC-RECEIPT-085).
 */
const resolveItemsForReceipt = async ({ orgId, user, order, lines }) => {
  const byLine = new Map();
  for (const reported of lines) {
    const line = order.lines.find((candidate) => candidate.id === reported.poLineId);
    if (!line) continue;
    try {
      byLine.set(
        line.id,
        await resolveInventoryItem(prisma, {
          orgId,
          user,
          line,
          requestedItemId: reported.inventoryItemId,
        }),
      );
    } catch (error) {
      // Somebody else created it a moment ago. Take theirs.
      if (error?.code !== "P2002") throw error;
      const sku = trimOrNull(line.itemCode) || `PO-${line.id.slice(0, 8)}`;
      const raced = await prisma.inventoryItem.findFirst({ where: { orgId, sku } });
      if (!raced) throw error;
      byLine.set(line.id, raced);
    }
  }
  return byLine;
};

/**
 * Posts a delivery: the receipt record, the stock, and the order's progress.
 *
 * Over-receipt is refused. A line that has already had everything delivered
 * should not quietly take more — that is either the wrong PO or the wrong
 * line, and both are worth stopping for.
 */
/**
 * The order states a delivery can arrive against.
 *
 * `issued` and `acknowledged` are an order the supplier has. `partial` and
 * `received` are one they are still delivering. `planned`, `draft`,
 * `pending_approval` and `approved` are not: nobody has told the supplier to
 * send anything, so a lorry turning up against one means the order is wrong,
 * not the delivery.
 */


/**
 * The next delivery-note number for a project.
 *
 * This used to read `MAX(receiptNumber) + 1` and say so: "the unique index on
 * (projectId, receiptNumber) remains the real guarantee — this only stops it
 * firing in ordinary use." Two people receiving at the same moment read the
 * same maximum, both compute the same number, and the second loses on that
 * index with an HTTP 500. Phase 20.5 removed that pattern from 34 registers
 * but missed this one and the purchase-order ref, because both are written in
 * raw SQL rather than the `count + 1` / `_max: { number }` shapes the audit
 * grepped for (Phase 20.6).
 *
 * The counter behind `nextRef` is advanced by a single atomic statement, so
 * the number is unique before the index is ever consulted. Seeding, and which
 * references count towards it, are unchanged: only `GRN-` followed by digits
 * seeds the sequence, because delivery notes arrive with the supplier's own
 * numbering and plenty of them begin "GRN-" without being GRN-00001 — sorted
 * as text, "GRN-x5xm3-A" came top, parsed to nothing, and the next number came
 * out as GRN-00001, which was already taken.
 */
const nextReceiptNumber = async (tx, projectId) =>
  nextRef(tx, {
    table: "DeliveryReceipt",
    column: "receiptNumber",
    scopeColumn: "projectId",
    scopeId: projectId,
    prefix: "GRN",
    pad: 5,
  });

const RECEIVABLE_STATUSES = new Set(["issued", "acknowledged", "partial", "received"]);

const receiveAgainstOrder = async ({ orgId, user, payload }) => {
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (!lines.length) {
    throw new HttpError(400, "RECEIPT_EMPTY", "Say what was delivered");
  }

  // Read the order once up front so the items can be settled before the
  // transaction that puts the stock away.
  // A caller that came in through a project's own route says which project it
  // is, and the order has to be on it. Without this the inventory door's
  // organisation-wide lookup let a delivery be booked from one project's route
  // against another project's order, putting the stock and the cost on the
  // wrong job (OCTA-PROC-RECEIPT-086).
  const orderScope = {
    id: payload.orderId,
    project: { orgId },
    ...(payload.projectId ? { projectId: payload.projectId } : {}),
  };
  const advance = await prisma.procurementOrder.findFirst({
    where: orderScope,
    include: { lines: true },
  });
  const itemsByLine = advance
    ? await resolveItemsForReceipt({ orgId, user, order: advance, lines })
    : new Map();

  return prisma.$transaction(async (tx) => {
    const order = await tx.procurementOrder.findFirst({
      where: orderScope,
      include: { lines: true, project: true },
    });
    if (!order) throw new HttpError(404, "PO_NOT_FOUND", "Purchase order not found");

    // Nothing can be delivered against an order the supplier was never sent
    // (OCTA-PROC-RECEIPT-070). Accepting one turns the whole approval workflow
    // into a formality: a planned order nobody approved becomes stock, and then
    // an invoice matches against it.
    if (!RECEIVABLE_STATUSES.has(order.status)) {
      const error = new HttpError(
        409,
        "PO_NOT_ISSUED",
        `${order.ref} is ${order.status} — nothing can be delivered against an order that has not been issued to the supplier.`,
      );
      error.details = {
        ref: order.ref,
        status: order.status,
        remedy: "POST /projects/{projectId}/purchase-orders/{orderId}/submit, then /approve, then /issue",
      };
      throw error;
    }

    // Two lorries at the gate, same order.
    //
    // Everything below reads a line's received quantity, adds what has just
    // arrived, and writes the total back. Two deliveries running at once both
    // read the same starting figure and both write their own total, so one of
    // them is silently lost: two receipts of 60 against an order of 100 left
    // two receipt records totalling 120 and a line saying 60 — the books
    // disagreeing with themselves, with both storemen told it worked. The
    // over-receipt guard reads the same stale figure, so it cannot catch it
    // either.
    //
    // Taking a row lock on the lines being received makes the second delivery
    // wait for the first, so it reads a true starting figure
    // (OCTA-PROC-RECEIPT-085).
    // The same order line reported twice on one receipt was checked twice
    // against the same starting figure: two rows of 60 on a line of 100 both
    // passed, stock took 120 and the line recorded 60 (Phase 21D, CX21-002).
    const seenLineIds = new Set();
    for (const row of lines) {
      if (!row.poLineId) continue;
      if (seenLineIds.has(row.poLineId)) {
        throw new HttpError(400, "RECEIPT_DUPLICATE_LINE", "An order line is reported twice on this receipt; report one quantity per order line");
      }
      seenLineIds.add(row.poLineId);
    }
    const receivingLineIds = [...seenLineIds];
    if (receivingLineIds.length) {
      // The lock and the true figures in one query: rows come back as they are
      // at the moment they are locked, so there is no second read to go stale
      // between the two.
      const locked = await tx.$queryRaw`SELECT * FROM "ProcurementPoLine" WHERE id = ANY(${receivingLineIds}::text[]) FOR UPDATE`;
      const byId = new Map((locked || []).map((row) => [row.id, row]));
      order.lines = order.lines.map((row) => ({ ...row, ...(byId.get(row.id) || {}) }));
    }
    // Every stocked item on the order is held for the transaction, in id
    // order, before any line moves stock — so a multi-line delivery and a
    // multi-line transfer cannot wait on each other's items (Phase 21D).
    await inventory.lockItems(tx, [
      ...order.lines.map((row) => row.inventoryItemId),
      ...[...itemsByLine.values()].map((item) => item?.id),
    ]);

    const warehouse = await tx.warehouse.findFirst({
      where: { id: payload.warehouseId, orgId },
    });
    if (!warehouse) {
      throw new HttpError(404, "WAREHOUSE_NOT_FOUND", "Warehouse not found");
    }

    // A delivery note posted twice — the second scan, the retried tap on a
    // phone — is caught by the unique index. Left to Prisma it surfaced as a
    // 500 with a raw `P2002`, which tells a storeman nothing and looks like the
    // system broke rather than like they already did this (OCTA-PROC-RECEIPT-070).
    const receiptNumber =
      trimOrNull(payload.receiptNumber) || null;
    if (receiptNumber) {
      const already = await tx.deliveryReceipt.findFirst({
        where: { projectId: order.projectId, receiptNumber },
        select: { id: true, orderId: true, receivedAt: true },
      });
      if (already) {
        const error = new HttpError(
          409,
          "RECEIPT_ALREADY_POSTED",
          `Delivery note ${receiptNumber} has already been posted on this project.`,
        );
        error.details = { receiptNumber, receiptId: already.id, orderId: already.orderId };
        throw error;
      }
    }

    const receipt = await tx.deliveryReceipt.create({
      data: {
        projectId: order.projectId,
        orderId: order.id,
        packageId: order.packageId,
        supplierId: order.supplierId,
        dailyReportId: payload.dailyReportId || null,
        receiptNumber: receiptNumber || (await nextReceiptNumber(tx, order.projectId)),
        receivedAt: payload.receivedAt ? new Date(payload.receivedAt) : new Date(),
        receivedBy: trimOrNull(payload.receivedBy) || user.id,
        warehouseLocation: warehouse.name,
        deliveryNote: trimOrNull(payload.deliveryNote),
        notes: trimOrNull(payload.notes),
        status: "posted",
        createdBy: user.id,
      },
    });

    const posted = [];
    // One entry per line received, for the result the screen shows back.
    const outcomes = [];
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

      const item =
        itemsByLine.get(line.id) ||
        (await resolveInventoryItem(tx, {
          orgId,
          user,
          line,
          requestedItemId: reported.inventoryItemId,
        }));

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

      const nextStatus =
        num(line.receivedQty) + acceptedQty >= ordered - QTY_EPSILON ? "received" : "partial";
      const updatedLine = await tx.procurementPoLine.update({
        where: { id: line.id },
        data: {
          receivedQty: round(num(line.receivedQty) + acceptedQty),
          rejectedQty: round(num(line.rejectedQty) + rejectedQty),
          inventoryItemId: item.id,
          status: nextStatus,
        },
      });

      // The requirement this was ordered against. Without it the planner's
      // material list still reads nought received after the lorry has been and
      // gone — which is what happened while this was the only writer that did
      // not do it (OCTA-PROC-RECEIPT-081).
      if (line.activityMaterialId) {
        await tx.activityMaterial.update({
          where: { id: line.activityMaterialId },
          data: {
            receivedQty: { increment: acceptedQty },
            status: nextStatus === "received" ? "received" : "partial",
            updatedBy: user.id,
          },
        });
      }

      // What this line now looks like, so the storeman can be told what
      // happened rather than just that something did (OCTA-UX-RECEIPT-100).
      outcomes.push({
        poLineId: line.id,
        description: line.description ?? item?.name ?? null,
        unit: line.unit ?? null,
        itemId: item.id,
        itemSku: item.sku ?? null,
        orderedQty: ordered,
        acceptedQty,
        rejectedQty,
        receivedQty: num(updatedLine.receivedQty),
        remainingQty: round(Math.max(0, ordered - num(updatedLine.receivedQty))),
        locationId: trimOrNull(reported.locationId),
        status: nextStatus,
      });

      // And the lead-time alert, which is about whether this material arrives
      // in time for the activity — a question a delivery obviously changes.
      await procurement.syncLeadTimeAlert({
        tx,
        projectId: order.projectId,
        project: order.project,
        line: { ...line, ...updatedLine },
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

    const orderStatus = allIn ? "received" : anyIn ? "partial" : order.status;

    // On-hand after the delivery, for the items this receipt touched. A
    // storeman's next question is always "so how much have I got now".
    const stock = await tx.stockBalance.findMany({
      where: {
        warehouseId: warehouse.id,
        itemId: { in: [...new Set(outcomes.map((row) => row.itemId))] },
      },
      select: { itemId: true, onHand: true },
    });
    // Summed across locations: the storeman asked how much is in this shed,
    // not how much is on each rack in it.
    const onHandByItem = new Map();
    for (const row of stock) {
      onHandByItem.set(row.itemId, num(onHandByItem.get(row.itemId)) + num(row.onHand));
    }

    return {
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber,
      movements: posted.length,
      warehouse: { id: warehouse.id, name: warehouse.name ?? null },
      order: {
        id: order.id,
        ref: order.ref,
        status: orderStatus,
        fullyReceived: allIn,
      },
      lines: outcomes.map((row) => ({
        ...row,
        onHand: round(num(onHandByItem.get(row.itemId))),
      })),
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
  // Exported so the concurrency property can be tested directly rather than
  // inferred from a delivery posting (Phase 20.6).
  nextReceiptNumber,
  listOrders,
  matchInvoice,
  matchLine,
  matchOrder,
  receiveAgainstOrder,
};
