const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { ballInCourt } = require("./ball-in-court.service");
const { addMoney, toMoneyNumber } = require("../utils/money");
const auditService = require("./audit.service");
const approvalWorkflowService = require("./approval-workflow.service");

/**
 * The purchase order lifecycle (OCTA-COM-PO-053).
 *
 * A purchase order is a commitment of the "purchase order" kind: request →
 * approval → issue → the supplier acknowledging it → delivery → goods receipt
 * → invoice → payment → close. What this service owns is the commercial half
 * of that; the warehouse half already lives in goods-receipt.service and the
 * billing half in direct-cost.service.
 *
 * A PO has three states, not one, because an order that is fully delivered and
 * half invoiced cannot pick a single word:
 *
 *   status          where it is commercially   draft … acknowledged … closed
 *   warehouseStatus how much has turned up     not_received / partial / received
 *   invoiceStatus   how much has been billed   not_invoiced / partially / fully
 *
 * `lifecycleStatus` derives one name from all three, for a badge and for
 * anyone who wants a single value. It is computed, never stored, so the three
 * facts cannot drift from the word describing them.
 */

const STATUS = Object.freeze({
  PLANNED: "planned",
  DRAFT: "draft",
  PENDING: "pending_approval",
  APPROVED: "approved",
  ISSUED: "issued",
  ACKNOWLEDGED: "acknowledged",
  // Goods receipt moves an order through these two, and always has. They were
  // missing from the vocabulary, so the register's own status filter refused
  // them — a buyer could not ask which orders were part-delivered or
  // delivered, which is most of an order's life after it is issued
  // (OCTA-PROC-STATUS-095).
  PARTIAL: "partial",
  RECEIVED: "received",
  CLOSED: "closed",
  CANCELLED: "cancelled",
});
const STATUSES = Object.freeze(Object.values(STATUS));

const INVOICE_STATUS = Object.freeze({
  NONE: "not_invoiced",
  PARTIAL: "partially_invoiced",
  FULL: "fully_invoiced",
});

/** Once an order is out with a supplier its lines are no longer ours to edit. */
const EDITABLE_STATUSES = Object.freeze([STATUS.PLANNED, STATUS.DRAFT, STATUS.PENDING]);
/** Statuses from which the order is live enough to receive against. */
const LIVE_STATUSES = Object.freeze([STATUS.ISSUED, STATUS.ACKNOWLEDGED]);

const MONEY_EPSILON = 0.01;

const trimOrNull = (value) => {
  const text = String(value ?? "").trim();
  return text ? text : null;
};

const num = (value) => toMoneyNumber(value, 0);
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * The eleven names from the brief, derived from the three stored states.
 *
 * Order matters: cancelled and closed end the story; what has been billed is
 * later news than what has been delivered, so it wins; and an order that is
 * out but untouched reads by its commercial state.
 */
const lifecycleStatus = (order) => {
  if (order.status === STATUS.CANCELLED) return "cancelled";
  if (order.status === STATUS.CLOSED) return "closed";

  if (order.invoiceStatus === INVOICE_STATUS.FULL) return "fully_invoiced";
  if (order.invoiceStatus === INVOICE_STATUS.PARTIAL) return "partially_invoiced";

  if (order.warehouseStatus === "received") return "delivered";
  if (order.warehouseStatus === "partial") return "partially_delivered";

  if (order.status === STATUS.ACKNOWLEDGED) return "acknowledged";
  if (order.status === STATUS.ISSUED) return "issued";
  if (order.status === STATUS.APPROVED) return "approved";
  if (order.status === STATUS.PENDING) return "pending_approval";
  return "draft";
};

const LIFECYCLE_LABEL = Object.freeze({
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  issued: "Issued",
  acknowledged: "Acknowledged",
  partially_delivered: "Partially delivered",
  delivered: "Delivered",
  partially_invoiced: "Partially invoiced",
  fully_invoiced: "Fully invoiced",
  closed: "Closed",
  cancelled: "Cancelled",
});

// ─── the transitions ───────────────────────────────────────────────────────

/**
 * What may follow what.
 *
 * `planned` is the pre-existing status for an order the buyer has pencilled in
 * from the procurement plan; it behaves as a draft.
 */
const ALLOWED = Object.freeze({
  [STATUS.PLANNED]: [STATUS.DRAFT, STATUS.PENDING, STATUS.CANCELLED],
  [STATUS.DRAFT]: [STATUS.PENDING, STATUS.CANCELLED],
  [STATUS.PENDING]: [STATUS.APPROVED, STATUS.DRAFT, STATUS.CANCELLED],
  [STATUS.APPROVED]: [STATUS.ISSUED, STATUS.DRAFT, STATUS.CANCELLED],
  [STATUS.ISSUED]: [STATUS.ACKNOWLEDGED, STATUS.CLOSED, STATUS.CANCELLED],
  [STATUS.ACKNOWLEDGED]: [STATUS.CLOSED, STATUS.CANCELLED],
  [STATUS.CLOSED]: [],
  [STATUS.CANCELLED]: [],
});

const assertTransition = (from, to) => {
  const allowed = ALLOWED[from] ?? [];
  if (!allowed.includes(to)) {
    throw new HttpError(
      409,
      "PO_TRANSITION_INVALID",
      `A ${LIFECYCLE_LABEL[from] ?? from} order cannot become ${LIFECYCLE_LABEL[to] ?? to}`
    );
  }
};

const orderInclude = {
  supplierRef: { select: { id: true, name: true, email: true, phone: true } },
  deliveryLocation: { select: { id: true, name: true, code: true } },
  project: { select: { id: true, name: true, currency: true } },
  lines: {
    orderBy: [{ lineNumber: "asc" }],
    include: {
      activity: { select: { id: true, name: true, activityCode: true } },
      inventoryItem: { select: { id: true, sku: true, name: true } },
    },
  },
  deliveryReceipts: {
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      receiptNumber: true,
      deliveryNote: true,
      status: true,
      createdAt: true,
    },
  },
  supplierInvoices: {
    where: { status: { not: "void" } },
    orderBy: [{ costDate: "asc" }],
    select: {
      id: true,
      ref: true,
      invoiceNumber: true,
      status: true,
      total: true,
      paidTotal: true,
      costDate: true,
    },
  },
};

const serializeLine = (line) => ({
  id: line.id,
  lineNumber: line.lineNumber,
  itemCode: line.itemCode,
  description: line.description,
  spec: line.spec,
  unit: line.unit,
  orderedQty: Number(line.orderedQty) || 0,
  receivedQty: Number(line.receivedQty) || 0,
  rejectedQty: Number(line.rejectedQty) || 0,
  issuedQty: Number(line.issuedQty) || 0,
  outstandingQty: round2(
    Math.max(0, (Number(line.orderedQty) || 0) - (Number(line.receivedQty) || 0))
  ),
  unitCost: num(line.unitCost),
  amount: round2((Number(line.orderedQty) || 0) * num(line.unitCost)),
  activityId: line.activityId,
  activity: line.activity
    ? { id: line.activity.id, name: line.activity.name, code: line.activity.activityCode }
    : null,
  // The buyer's cost coding (OCTA-FIN-POLINE-060), carried onto the stock
  // ledger at receipt and inherited by the issue that finally spends it.
  costCodeId: line.costCodeId ?? null,
  budgetLineId: line.budgetLineId ?? null,
  boqItemId: line.boqItemId ?? null,
  inventoryItemId: line.inventoryItemId,
  inventoryItem: line.inventoryItem,
  requiredDate: line.requiredDate?.toISOString() ?? null,
  promisedDate: line.promisedDate?.toISOString() ?? null,
  status: line.status,
  notes: line.notes,
});

/**
 * The state ball-in-court should read from.
 *
 * An order's `status` is its commercial life — issued, closed — while
 * `warehouseStatus` is what has physically turned up. Once an order is out
 * with the supplier the useful question becomes a delivery question, so the
 * fulfilment state takes over.
 */
const waitingState = (order) => {
  if (order.status === STATUS.ISSUED || order.status === STATUS.ACKNOWLEDGED) {
    if (order.warehouseStatus === "partial") return "partial";
    if (order.warehouseStatus === "received" || order.warehouseStatus === "issued") {
      return "received";
    }
  }
  return order.status;
};

const serializeOrder = (order, viewer = null) => ({
  id: order.id,
  projectId: order.projectId,
  project: order.project?.name ?? null,
  ref: order.ref,
  item: order.item,
  status: order.status,
  warehouseStatus: order.warehouseStatus,
  invoiceStatus: order.invoiceStatus,
  lifecycleStatus: lifecycleStatus(order),
  lifecycleLabel: LIFECYCLE_LABEL[lifecycleStatus(order)],
  // Whose move it is, derived from the state and the permission policy rather
  // than stored — a stored answer goes stale the moment somebody acts by
  // another route (OCTA-UX-BALLINCOURT-087).
  ballInCourt: ballInCourt(
    "purchase_order",
    { status: waitingState(order) },
    viewer,
    order.status === STATUS.ISSUED && order.warehouseStatus === "not_received"
      ? { name: order.supplierRef?.name ?? order.supplier ?? null }
      : null,
  ),
  supplierId: order.supplierId,
  supplier: order.supplierRef?.name ?? order.supplier ?? null,
  supplierEmail: order.supplierRef?.email ?? null,
  commitmentId: order.commitmentId,
  currency: order.currency,
  subtotal: num(order.subtotal),
  taxRate: Number(order.taxRate) || 0,
  taxAmount: num(order.taxAmount),
  value: num(order.value),
  invoicedAmount: num(order.invoicedAmount),
  uninvoiced: round2(num(order.value) - num(order.invoicedAmount)),
  deliveryLocationId: order.deliveryLocationId,
  deliveryLocation: order.deliveryLocation
    ? { id: order.deliveryLocation.id, name: order.deliveryLocation.name, code: order.deliveryLocation.code }
    : null,
  deliveryAddress: order.deliveryAddress,
  deliveryTerms: order.deliveryTerms,
  paymentTerms: order.paymentTerms,
  orderDate: order.orderDate?.toISOString() ?? null,
  requiredBy: order.requiredBy?.toISOString() ?? null,
  promisedDate: order.promisedDate?.toISOString() ?? null,
  deliveryDate: order.deliveryDate?.toISOString() ?? null,
  submittedAt: order.submittedAt?.toISOString() ?? null,
  approvedAt: order.approvedAt?.toISOString() ?? null,
  rejectedAt: order.rejectedAt?.toISOString() ?? null,
  rejectedReason: order.rejectedReason,
  acknowledgedAt: order.acknowledgedAt?.toISOString() ?? null,
  acknowledgedRef: order.acknowledgedRef,
  cancelledAt: order.cancelledAt?.toISOString() ?? null,
  cancelReason: order.cancelReason,
  closedAt: order.closedAt?.toISOString() ?? null,
  buyer: order.buyer,
  notes: order.notes,
  lines: (order.lines ?? []).map(serializeLine),
  receipts: (order.deliveryReceipts ?? []).map((receipt) => ({
    id: receipt.id,
    receiptNumber: receipt.receiptNumber,
    deliveryNote: receipt.deliveryNote,
    status: receipt.status,
    receivedAt: receipt.createdAt?.toISOString() ?? null,
  })),
  invoices: (order.supplierInvoices ?? []).map((invoice) => ({
    id: invoice.id,
    ref: invoice.ref,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    total: num(invoice.total),
    paidTotal: num(invoice.paidTotal),
    costDate: invoice.costDate?.toISOString() ?? null,
  })),
});

// ─── reading ───────────────────────────────────────────────────────────────

const loadOrder = async ({ orgId, projectId, orderId, tx = prisma }) => {
  const order = await tx.procurementOrder.findFirst({
    where: { id: orderId, projectId, project: { orgId } },
    include: orderInclude,
  });
  if (!order) throw new HttpError(404, "PO_NOT_FOUND", "Purchase order not found");
  return order;
};

const getOrder = async ({ orgId, projectId, orderId, viewer = null }) =>
  serializeOrder(await loadOrder({ orgId, projectId, orderId }), viewer);

const listOrders = async ({ orgId, projectId, status = null, supplierId = null, viewer = null }) => {
  const orders = await prisma.procurementOrder.findMany({
    where: {
      projectId,
      project: { orgId },
      ...(status ? { status } : {}),
      ...(supplierId ? { supplierId } : {}),
    },
    include: orderInclude,
    orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
    take: 500,
  });

  const items = orders.map((order) => serializeOrder(order, viewer));
  const sum = (predicate, key) =>
    round2(items.filter(predicate).reduce((total, item) => addMoney(total, item[key]), 0));

  return {
    items,
    summary: {
      total: items.length,
      byLifecycle: Object.keys(LIFECYCLE_LABEL).reduce(
        (acc, key) => ({ ...acc, [key]: items.filter((item) => item.lifecycleStatus === key).length }),
        {}
      ),
      committed: sum(
        (item) => ![STATUS.CANCELLED, STATUS.PLANNED].includes(item.status),
        "value"
      ),
      invoiced: sum(() => true, "invoicedAmount"),
      awaitingApproval: items.filter((item) => item.status === STATUS.PENDING).length,
      awaitingAcknowledgement: items.filter((item) => item.status === STATUS.ISSUED).length,
    },
  };
};

// ─── the money on an order ─────────────────────────────────────────────────

/**
 * Re-adds the order from its lines and its tax rate.
 *
 * The value is never typed: it is what the lines come to, plus tax. A total
 * somebody can edit independently of the lines is a total that will disagree
 * with them.
 */
const recomputeTotals = async (tx, orderId) => {
  const order = await tx.procurementOrder.findUnique({
    where: { id: orderId },
    select: { id: true, taxRate: true },
  });
  if (!order) return null;

  const lines = await tx.procurementPoLine.findMany({
    where: { orderId },
    select: { orderedQty: true, unitCost: true },
  });
  const subtotal = round2(
    lines.reduce((total, line) => total + (Number(line.orderedQty) || 0) * num(line.unitCost), 0)
  );
  const taxAmount = round2(subtotal * ((Number(order.taxRate) || 0) / 100));

  return tx.procurementOrder.update({
    where: { id: orderId },
    data: { subtotal, taxAmount, value: addMoney(subtotal, taxAmount) },
  });
};

/**
 * Re-reads what has been invoiced against the order.
 *
 * Called whenever a supplier invoice against a PO is written. Voided invoices
 * are not a claim on anything, so they are left out.
 */
const recomputeInvoiced = async (tx, orderId) => {
  const order = await tx.procurementOrder.findUnique({
    where: { id: orderId },
    select: { id: true, value: true },
  });
  if (!order) return null;

  const billed = await tx.directCost.aggregate({
    where: { purchaseOrderId: orderId, status: { not: "void" } },
    _sum: { total: true },
  });
  const invoicedAmount = num(billed._sum?.total);
  const value = num(order.value);

  let invoiceStatus = INVOICE_STATUS.NONE;
  if (invoicedAmount > MONEY_EPSILON) {
    invoiceStatus =
      invoicedAmount >= value - MONEY_EPSILON ? INVOICE_STATUS.FULL : INVOICE_STATUS.PARTIAL;
  }

  return tx.procurementOrder.update({
    where: { id: orderId },
    data: { invoicedAmount, invoiceStatus },
  });
};

// ─── the transitions ───────────────────────────────────────────────────────

const record = async ({ tx, orgId, projectId, order, from, to, actor, reason = null, summary = {} }) => {
  await auditService.recordEvent({
    tx,
    orgId,
    projectId,
    entityType: auditService.ENTITY_TYPES.PROCUREMENT_ORDER,
    entityId: order.id,
    action: auditService.ACTIONS.STATUS_CHANGED,
    actorId: actor?.id ?? null,
    actorRole: actor?.role ?? null,
    oldStatus: from,
    newStatus: to,
    reason,
    summary: { transition: `po.${to}`, ref: order.ref, ...summary },
  });
  // Not swallowed: the transition table governs which moves are legal, and a
  // refusal here is a defect worth surfacing rather than hiding.
  await approvalWorkflowService.recordTransition({
    tx,
    orgId,
    projectId,
    recordType: approvalWorkflowService.RECORD_TYPES.PROCUREMENT_ORDER,
    recordId: order.id,
    fromStatus: from,
    toStatus: to,
    actorId: actor?.id ?? null,
    actorRole: actor?.role ?? null,
    reason,
    comment: reason,
    metadata: { ref: order.ref, ...summary },
  });
};

const transition = async ({ orgId, projectId, orderId, to, actor, reason = null, data = {} }) => {
  const existing = await loadOrder({ orgId, projectId, orderId });
  assertTransition(existing.status, to);

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const patch = { status: to, updatedBy: actor?.id ?? null, ...data };

    if (to === STATUS.PENDING) {
      if (!existing.lines.length) {
        throw new HttpError(400, "PO_NO_LINES", "An order needs at least one line before approval");
      }
      // The buyer has to say who it is with and when it is needed before
      // anybody is asked to approve it.
      if (!existing.supplierId && !trimOrNull(existing.supplier)) {
        throw new HttpError(400, "PO_SUPPLIER_REQUIRED", "Say who the order is with");
      }
      if (!existing.requiredBy) {
        throw new HttpError(400, "PO_REQUIRED_DATE", "Say when it is needed on site");
      }
      patch.submittedAt = now;
      patch.submittedBy = actor?.id ?? null;
      patch.rejectedAt = null;
      patch.rejectedBy = null;
      patch.rejectedReason = null;
    }
    if (to === STATUS.APPROVED) {
      patch.approvedAt = now;
      patch.approvedBy = actor?.id ?? null;
    }
    if (to === STATUS.DRAFT && existing.status === STATUS.PENDING) {
      // Sent back: record why, so the buyer knows what to change.
      patch.rejectedAt = now;
      patch.rejectedBy = actor?.id ?? null;
      patch.rejectedReason = trimOrNull(reason);
      patch.submittedAt = null;
    }
    if (to === STATUS.ISSUED) {
      patch.orderDate = existing.orderDate ?? now;
    }
    if (to === STATUS.ACKNOWLEDGED) {
      patch.acknowledgedAt = now;
      patch.acknowledgedBy = actor?.id ?? null;
    }
    if (to === STATUS.CANCELLED) {
      if (existing.warehouseStatus !== "not_received") {
        throw new HttpError(
          409,
          "PO_CANCEL_AFTER_DELIVERY",
          "Part of this order has already been delivered; close it instead of cancelling"
        );
      }
      patch.cancelledAt = now;
      patch.cancelledBy = actor?.id ?? null;
      patch.cancelReason = trimOrNull(reason);
    }
    if (to === STATUS.CLOSED) {
      patch.closedAt = now;
      patch.closedBy = actor?.id ?? null;
    }

    await tx.procurementOrder.update({ where: { id: orderId }, data: patch });
    await record({
      tx,
      orgId,
      projectId,
      order: existing,
      from: existing.status,
      to,
      actor,
      reason,
      summary: { value: num(existing.value) },
    });

    return loadOrder({ orgId, projectId, orderId, tx });
  }).then(serializeOrder);
};

const submitOrder = (args) => transition({ ...args, to: STATUS.PENDING });
const approveOrder = (args) => transition({ ...args, to: STATUS.APPROVED });
// async so a missing reason rejects rather than throwing synchronously: every
// transition here should fail the same way, through the promise.
const rejectOrder = async (args) => {
  if (!trimOrNull(args.reason)) {
    throw new HttpError(400, "PO_REJECT_REASON_REQUIRED", "Say what needs to change");
  }
  return transition({ ...args, to: STATUS.DRAFT });
};
const issueOrder = (args) => transition({ ...args, to: STATUS.ISSUED });
const acknowledgeOrder = (args) =>
  transition({
    ...args,
    to: STATUS.ACKNOWLEDGED,
    data: { acknowledgedRef: trimOrNull(args.acknowledgedRef) },
  });
const cancelOrder = async (args) => {
  if (!trimOrNull(args.reason)) {
    throw new HttpError(400, "PO_CANCEL_REASON_REQUIRED", "Say why the order is being cancelled");
  }
  return transition({ ...args, to: STATUS.CANCELLED });
};

/**
 * Closing an order.
 *
 * Refused while something is still owed unless the buyer says why: an order
 * closed with deliveries outstanding is either short-closed on purpose or
 * closed by mistake, and the two need telling apart.
 */
const closeOrder = async ({ orgId, projectId, orderId, actor, reason = null, force = false }) => {
  const existing = await loadOrder({ orgId, projectId, orderId });
  const outstanding = existing.lines.filter(
    (line) => (Number(line.receivedQty) || 0) < (Number(line.orderedQty) || 0) - 0.001
  );
  if (outstanding.length && !force) {
    const error = new HttpError(
      409,
      "PO_CLOSE_OUTSTANDING",
      `${outstanding.length} line${outstanding.length === 1 ? "" : "s"} have not been fully delivered`
    );
    error.details = { lines: outstanding.map((line) => line.lineNumber) };
    throw error;
  }
  if (outstanding.length && !trimOrNull(reason)) {
    throw new HttpError(
      400,
      "PO_CLOSE_REASON_REQUIRED",
      "Say why the order is being closed short"
    );
  }
  return transition({ orgId, projectId, orderId, to: STATUS.CLOSED, actor, reason });
};

// ─── editing the header ────────────────────────────────────────────────────

const HEADER_FIELDS = [
  "item",
  "supplier",
  "buyer",
  "notes",
  "deliveryAddress",
  "deliveryTerms",
  "paymentTerms",
];

const updateOrder = async ({ orgId, projectId, orderId, actor, payload = {} }) => {
  const existing = await loadOrder({ orgId, projectId, orderId });
  if (!EDITABLE_STATUSES.includes(existing.status)) {
    throw new HttpError(
      409,
      "PO_LOCKED",
      `A ${LIFECYCLE_LABEL[lifecycleStatus(existing)]} order cannot be edited`
    );
  }

  const data = { updatedBy: actor?.id ?? null };
  for (const field of HEADER_FIELDS) {
    if (payload[field] !== undefined) data[field] = trimOrNull(payload[field]);
  }
  for (const field of ["requiredBy", "promisedDate", "orderDate"]) {
    if (payload[field] !== undefined) data[field] = payload[field] ? new Date(payload[field]) : null;
  }
  if (payload.supplierId !== undefined) {
    const supplierId = trimOrNull(payload.supplierId);
    if (supplierId) {
      const supplier = await prisma.procurementSupplier.findFirst({
        where: { id: supplierId, projectId },
        select: { id: true, name: true },
      });
      if (!supplier) throw new HttpError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");
      data.supplier = supplier.name;
    }
    data.supplierId = supplierId;
  }
  if (payload.deliveryLocationId !== undefined) {
    const locationId = trimOrNull(payload.deliveryLocationId);
    if (locationId) {
      const location = await prisma.location.findFirst({
        where: { id: locationId, projectId },
        select: { id: true },
      });
      if (!location) throw new HttpError(404, "LOCATION_NOT_FOUND", "Delivery location not found");
    }
    data.deliveryLocationId = locationId;
  }
  if (payload.taxRate !== undefined) {
    const rate = Number(payload.taxRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new HttpError(400, "PO_TAX_INVALID", "Tax must be between 0 and 100 percent");
    }
    data.taxRate = rate;
  }

  return prisma.$transaction(async (tx) => {
    // The editable check ran before the transaction; an approval that landed
    // since must stop the edit, or the terms would change after approval
    // (Phase 21D, CX21-417).
    const [fresh] = await tx.$queryRaw`SELECT status FROM "ProcurementOrder" WHERE id = ${orderId} FOR UPDATE`;
    if (fresh && !EDITABLE_STATUSES.includes(fresh.status)) throw new HttpError(409, "PO_LOCKED", `A ${fresh.status} order cannot be edited`);
    await tx.procurementOrder.update({ where: { id: orderId }, data });
    // The value follows the lines and the tax rate; it is never typed.
    await recomputeTotals(tx, orderId);
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.PROCUREMENT_ORDER,
      entityId: orderId,
      action: auditService.ACTIONS.UPDATED,
      actorId: actor?.id ?? null,
      summary: { ref: existing.ref, fields: Object.keys(data) },
    });
    return loadOrder({ orgId, projectId, orderId, tx });
  }).then(serializeOrder);
};

module.exports = {
  waitingState,
  EDITABLE_STATUSES,
  INVOICE_STATUS,
  LIFECYCLE_LABEL,
  LIVE_STATUSES,
  STATUS,
  STATUSES,
  acknowledgeOrder,
  approveOrder,
  assertTransition,
  cancelOrder,
  closeOrder,
  getOrder,
  issueOrder,
  lifecycleStatus,
  listOrders,
  recomputeInvoiced,
  recomputeTotals,
  rejectOrder,
  serializeOrder,
  submitOrder,
  updateOrder,
};
