/**
 * The purchase order lifecycle.
 *
 * The point of the design is that a PO has three states, not one: where it is
 * commercially, how much has turned up, and how much has been billed. The
 * single name in the UI is derived from all three, so these tests are mostly
 * about that derivation and about which moves are legal.
 */

const mockPrisma = {
  procurementOrder: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  procurementPoLine: { findMany: jest.fn() },
  procurementSupplier: { findFirst: jest.fn() },
  directCost: { aggregate: jest.fn() },
  location: { findFirst: jest.fn() },
  $transaction: (fn) => fn(mockPrisma),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => ({
  ENTITY_TYPES: { PROCUREMENT_ORDER: "procurement_order" },
  ACTIONS: { STATUS_CHANGED: "status_changed", UPDATED: "updated" },
  recordEvent: jest.fn(async () => null),
}));
jest.mock("../approval-workflow.service", () => ({
  RECORD_TYPES: { PROCUREMENT_ORDER: "procurement_order" },
  recordTransition: jest.fn(async () => null),
}));

const service = require("../purchase-order.service");

const order = (over = {}) => ({
  id: "order-1",
  projectId: "project-1",
  ref: "PO-0001",
  item: "Rebar",
  status: "draft",
  warehouseStatus: "not_received",
  invoiceStatus: "not_invoiced",
  supplierId: "supplier-1",
  supplier: "Delta Steel",
  currency: "USD",
  subtotal: 100000,
  taxRate: 0,
  taxAmount: 0,
  value: 100000,
  invoicedAmount: 0,
  requiredBy: new Date("2026-10-01"),
  lines: [
    { id: "line-1", lineNumber: 1, orderedQty: 100, receivedQty: 0, unitCost: 1000, description: "Rebar" },
  ],
  deliveryReceipts: [],
  supplierInvoices: [],
  ...over,
});

describe("the single lifecycle name", () => {
  const name = (over) => service.lifecycleStatus(order(over));

  it("reads the commercial state while nothing has moved", () => {
    expect(name({ status: "draft" })).toBe("draft");
    expect(name({ status: "pending_approval" })).toBe("pending_approval");
    expect(name({ status: "approved" })).toBe("approved");
    expect(name({ status: "issued" })).toBe("issued");
    expect(name({ status: "acknowledged" })).toBe("acknowledged");
  });

  it("switches to delivery once something has turned up", () => {
    expect(name({ status: "acknowledged", warehouseStatus: "partial" })).toBe(
      "partially_delivered",
    );
    expect(name({ status: "acknowledged", warehouseStatus: "received" })).toBe("delivered");
  });

  it("switches to billing once something has been invoiced, which is later news", () => {
    expect(
      name({ status: "issued", warehouseStatus: "received", invoiceStatus: "partially_invoiced" }),
    ).toBe("partially_invoiced");
    expect(
      name({ status: "issued", warehouseStatus: "received", invoiceStatus: "fully_invoiced" }),
    ).toBe("fully_invoiced");
  });

  it("lets closed and cancelled end the story whatever else happened", () => {
    expect(
      name({ status: "closed", warehouseStatus: "partial", invoiceStatus: "fully_invoiced" }),
    ).toBe("closed");
    expect(name({ status: "cancelled" })).toBe("cancelled");
  });
});

describe("legal moves", () => {
  it("walks request → approval → issue → acknowledgement", () => {
    expect(() => service.assertTransition("draft", "pending_approval")).not.toThrow();
    expect(() => service.assertTransition("pending_approval", "approved")).not.toThrow();
    expect(() => service.assertTransition("approved", "issued")).not.toThrow();
    expect(() => service.assertTransition("issued", "acknowledged")).not.toThrow();
  });

  it("refuses to skip approval", () => {
    expect(() => service.assertTransition("draft", "issued")).toThrow(
      expect.objectContaining({ code: "PO_TRANSITION_INVALID" }),
    );
  });

  it("refuses to reopen a closed or cancelled order", () => {
    expect(() => service.assertTransition("closed", "issued")).toThrow(
      expect.objectContaining({ code: "PO_TRANSITION_INVALID" }),
    );
    expect(() => service.assertTransition("cancelled", "draft")).toThrow(
      expect.objectContaining({ code: "PO_TRANSITION_INVALID" }),
    );
  });

  it("lets an order be sent back from approval to draft", () => {
    expect(() => service.assertTransition("pending_approval", "draft")).not.toThrow();
  });
});

describe("transitions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.procurementOrder.findFirst.mockResolvedValue(order());
    mockPrisma.procurementOrder.update.mockResolvedValue({});
  });

  it("will not send an order for approval with no lines", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue(order({ lines: [] }));
    await expect(
      service.submitOrder({ orgId: "org-1", projectId: "project-1", orderId: "order-1", actor: {} }),
    ).rejects.toThrow(expect.objectContaining({ code: "PO_NO_LINES" }));
  });

  it("will not send an order for approval with no required-on-site date", async () => {
    // Approving an order nobody has dated is approving a delivery that could
    // arrive any time, which is what the lead-time alerts exist to prevent.
    mockPrisma.procurementOrder.findFirst.mockResolvedValue(order({ requiredBy: null }));
    await expect(
      service.submitOrder({ orgId: "org-1", projectId: "project-1", orderId: "order-1", actor: {} }),
    ).rejects.toThrow(expect.objectContaining({ code: "PO_REQUIRED_DATE" }));
  });

  it("insists on a reason when sending an order back", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue(order({ status: "pending_approval" }));
    await expect(
      service.rejectOrder({ orgId: "org-1", projectId: "project-1", orderId: "order-1", actor: {} }),
    ).rejects.toThrow(expect.objectContaining({ code: "PO_REJECT_REASON_REQUIRED" }));
  });

  it("refuses to cancel an order that has already been part delivered", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue(
      order({ status: "issued", warehouseStatus: "partial" }),
    );
    await expect(
      service.cancelOrder({
        orgId: "org-1",
        projectId: "project-1",
        orderId: "order-1",
        actor: {},
        reason: "No longer needed",
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "PO_CANCEL_AFTER_DELIVERY" }));
  });

  it("refuses to close an order with deliveries outstanding", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue(
      order({ status: "issued", lines: [{ id: "l1", lineNumber: 1, orderedQty: 100, receivedQty: 40 }] }),
    );
    await expect(
      service.closeOrder({ orgId: "org-1", projectId: "project-1", orderId: "order-1", actor: {} }),
    ).rejects.toThrow(expect.objectContaining({ code: "PO_CLOSE_OUTSTANDING" }));
  });

  it("closes short only when forced and told why", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue(
      order({ status: "issued", lines: [{ id: "l1", lineNumber: 1, orderedQty: 100, receivedQty: 40 }] }),
    );
    await expect(
      service.closeOrder({
        orgId: "org-1",
        projectId: "project-1",
        orderId: "order-1",
        actor: {},
        force: true,
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "PO_CLOSE_REASON_REQUIRED" }));
  });

  it("refuses to edit an order that is already with the supplier", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue(order({ status: "issued" }));
    await expect(
      service.updateOrder({
        orgId: "org-1",
        projectId: "project-1",
        orderId: "order-1",
        actor: {},
        payload: { item: "Something else" },
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "PO_LOCKED" }));
  });
});

describe("the money on an order", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.procurementOrder.update.mockImplementation(async ({ data }) => data);
  });

  it("adds the order up from its lines and its tax rate", async () => {
    mockPrisma.procurementOrder.findUnique.mockResolvedValue({ id: "order-1", taxRate: 5 });
    mockPrisma.procurementPoLine.findMany.mockResolvedValue([
      { orderedQty: 100, unitCost: 1000 },
      { orderedQty: 50, unitCost: 200 },
    ]);

    const result = await service.recomputeTotals(mockPrisma, "order-1");
    expect(result.subtotal).toBe(110000);
    expect(result.taxAmount).toBe(5500);
    expect(result.value).toBe(115500);
  });

  it("reads what has been billed, ignoring voided invoices", async () => {
    mockPrisma.procurementOrder.findUnique.mockResolvedValue({ id: "order-1", value: 100000 });
    mockPrisma.directCost.aggregate.mockResolvedValue({ _sum: { total: 40000 } });

    const result = await service.recomputeInvoiced(mockPrisma, "order-1");
    expect(result.invoicedAmount).toBe(40000);
    expect(result.invoiceStatus).toBe("partially_invoiced");
    expect(mockPrisma.directCost.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { purchaseOrderId: "order-1", status: { not: "void" } },
      }),
    );
  });

  it("calls an order fully invoiced once the whole value is billed", async () => {
    mockPrisma.procurementOrder.findUnique.mockResolvedValue({ id: "order-1", value: 100000 });
    mockPrisma.directCost.aggregate.mockResolvedValue({ _sum: { total: 100000 } });

    const result = await service.recomputeInvoiced(mockPrisma, "order-1");
    expect(result.invoiceStatus).toBe("fully_invoiced");
  });

  it("is not invoiced when nothing has been billed", async () => {
    mockPrisma.procurementOrder.findUnique.mockResolvedValue({ id: "order-1", value: 100000 });
    mockPrisma.directCost.aggregate.mockResolvedValue({ _sum: { total: null } });

    const result = await service.recomputeInvoiced(mockPrisma, "order-1");
    expect(result.invoicedAmount).toBe(0);
    expect(result.invoiceStatus).toBe("not_invoiced");
  });
});
