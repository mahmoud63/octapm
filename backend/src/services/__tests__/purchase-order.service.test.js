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
  project: { findFirst: jest.fn(async () => ({ id: "project-1", startDate: null })) },
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  $queryRaw: jest.fn(async () => []), // row locks (Phase 21D): nothing to lock in a fake
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
jest.mock("../procurement.service", () => ({ syncLeadTimeAlert: jest.fn(async () => null), syncLeadTimeAlerts: jest.fn(async () => []) }));

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
    // Written as exact decimals (round 6).
    expect(Number(result.subtotal)).toBe(110000);
    expect(Number(result.taxAmount)).toBe(5500);
    expect(Number(result.value)).toBe(115500);
  });

  it("reads what has been billed, ignoring voided invoices", async () => {
    mockPrisma.procurementOrder.findUnique.mockResolvedValue({ id: "order-1", value: 100000 });
    mockPrisma.directCost.aggregate.mockResolvedValue({ _sum: { total: 40000 } });

    const result = await service.recomputeInvoiced(mockPrisma, "order-1");
    expect(Number(result.invoicedAmount)).toBe(40000);
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
    expect(Number(result.invoicedAmount)).toBe(0);
    expect(result.invoiceStatus).toBe("not_invoiced");
  });
});

describe("Phase 21D — integrity (release challenge)", () => {
  afterEach(() => mockPrisma.$queryRaw.mockImplementation(async () => []));

  it("CX21-417: an edit that started on a pending order refuses once the order was approved under the lock", async () => {
    // editable when the caller looked (draft); approved by the time the lock is held
    mockPrisma.procurementOrder.findFirst.mockResolvedValue({ id: "po-9", orgId: "org-1", projectId: "p1", status: "draft", currency: "USD", taxRate: 0, lines: [], supplierId: null });
    mockPrisma.procurementOrder.update.mockClear();
    mockPrisma.$queryRaw.mockImplementation(async (strings) => (Array.isArray(strings) && strings.join("?").includes('FROM "ProcurementOrder"') ? [{ status: "approved" }] : []));
    await expect(service.updateOrder({ orgId: "org-1", projectId: "p1", orderId: "po-9", actor: { id: "proc" }, payload: { taxRate: 100 } })).rejects.toMatchObject({ code: "PO_LOCKED" });
    expect(mockPrisma.procurementOrder.update).not.toHaveBeenCalled();
  });
});

describe("Phase 21D — integrity (release challenge, second pass)", () => {
  afterEach(() => mockPrisma.$queryRaw.mockImplementation(async () => []));

  it("CX21-426: a rejection that started on a pending order refuses once the order was approved and issued under the lock", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue(order({ status: "pending_approval" }));
    mockPrisma.procurementOrder.update.mockClear();
    mockPrisma.$queryRaw.mockImplementation(async (strings) => (Array.isArray(strings) && strings.join("?").includes('FROM "ProcurementOrder"') ? [{ status: "issued" }] : []));
    await expect(service.rejectOrder({ orgId: "org-1", projectId: "project-1", orderId: "order-1", actor: { id: "pm" }, reason: "wrong supplier" })).rejects.toMatchObject({ code: "PO_STATE_CHANGED" });
    expect(mockPrisma.procurementOrder.update).not.toHaveBeenCalled();
  });
});

/**
 * CERT-2 (alerts-money-5): an order is worth no more than its value column
 * holds, a Decimal(18,2), after an edit as at creation. A tax rate of 100 on
 * an order worth 9e15 failed at the write with a 500 (numeric field
 * overflow); and invoices that each fit could together pass what the order's
 * invoiced amount holds.
 */
describe("CERT-2 — what an order is worth fits its columns when it is edited", () => {
  const big = () => order({ lines: [{ id: "line-1", lineNumber: 1, orderedQty: 90_000_000_000, receivedQty: 0, unitCost: 100000, description: "Bulk" }], subtotal: 9e15, value: 9e15 });
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$queryRaw.mockImplementation(async () => []);
    mockPrisma.procurementOrder.update.mockImplementation(async ({ data }) => data);
  });

  it("a tax rate that takes the order past 10^16 is a 400 PO_VALUE_TOO_LARGE before anything is written", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue(big());
    await expect(service.updateOrder({ orgId: "org-1", projectId: "project-1", orderId: "order-1", actor: { id: "proc" }, payload: { taxRate: 100 } })).rejects.toMatchObject({ status: 400, code: "PO_VALUE_TOO_LARGE" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.procurementOrder.update).not.toHaveBeenCalled();
  });

  it("a tax rate the order's value can hold is accepted and stored", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue(big());
    mockPrisma.procurementOrder.findUnique.mockResolvedValue({ id: "order-1", taxRate: 10 });
    mockPrisma.procurementPoLine.findMany.mockResolvedValue([{ orderedQty: 90_000_000_000, unitCost: 100000 }]);
    await service.updateOrder({ orgId: "org-1", projectId: "project-1", orderId: "order-1", actor: { id: "proc" }, payload: { taxRate: 10 } });
    expect(mockPrisma.procurementOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ taxRate: 10 }) }));
    const totals = mockPrisma.procurementOrder.update.mock.calls.map(([args]) => args.data).find((data) => "subtotal" in data);
    expect([totals.subtotal, totals.taxAmount, totals.value].map(String)).toEqual(["9000000000000000", "900000000000000", "9900000000000000"]);
  });

  it("recomputing the totals refuses, before its write, figures the value column cannot hold", async () => {
    mockPrisma.procurementOrder.findUnique.mockResolvedValue({ id: "order-1", taxRate: 100 });
    mockPrisma.procurementPoLine.findMany.mockResolvedValue([{ orderedQty: 90_000_000_000, unitCost: 100000 }]);
    await expect(service.recomputeTotals(mockPrisma, "order-1")).rejects.toMatchObject({ status: 400, code: "PO_VALUE_TOO_LARGE" });
    expect(mockPrisma.procurementOrder.update).not.toHaveBeenCalled();
  });

  it("round 6: the totals are worked, checked and written as exact decimals — 5e15 + 4,999,999,999,999,999 fits, and is what is stored", async () => {
    mockPrisma.procurementOrder.findUnique.mockResolvedValue({ id: "order-1", taxRate: 0 });
    mockPrisma.procurementPoLine.findMany.mockResolvedValue([{ orderedQty: 1, unitCost: "5000000000000000" }, { orderedQty: "1", unitCost: "4999999999999999" }]);
    const result = await service.recomputeTotals(mockPrisma, "order-1");
    expect([result.subtotal, result.taxAmount, result.value].map((value) => value.toFixed(2))).toEqual(["9999999999999999.00", "0.00", "9999999999999999.00"]);
    // In floating point the same lines came to 10^16 and were refused.
    expect(5e15 + 4999999999999999).toBe(1e16);
    // A half cent of tax rounds up, as it is stored.
    expect(service.totalsOf([{ orderedQty: "0.5", unitCost: "0.01" }], 0).subtotal.toFixed(2)).toBe("0.01");
  });

  it("round 6: what is invoiced is checked and written as the same exact decimal", async () => {
    mockPrisma.procurementOrder.findUnique.mockResolvedValue({ id: "order-1", value: "9999999999999999.99" });
    mockPrisma.directCost.aggregate.mockResolvedValue({ _sum: { total: "9999999999999999.99" } });
    const result = await service.recomputeInvoiced(mockPrisma, "order-1");
    expect(result.invoicedAmount.toFixed(2)).toBe("9999999999999999.99");
    expect(result.invoiceStatus).toBe("fully_invoiced");
  });

  it("invoices that together pass what the order's invoiced amount holds are a 400 PO_INVOICED_TOO_LARGE, not written", async () => {
    mockPrisma.procurementOrder.findUnique.mockResolvedValue({ id: "order-1", value: 9e15 });
    mockPrisma.directCost.aggregate.mockResolvedValue({ _sum: { total: "18000000000000000.00" } });
    await expect(service.recomputeInvoiced(mockPrisma, "order-1")).rejects.toMatchObject({ status: 400, code: "PO_INVOICED_TOO_LARGE" });
    expect(mockPrisma.procurementOrder.update).not.toHaveBeenCalled();
  });
});

/**
 * CERT-2 (alerts-money-5): a cancelled or closed order delivers nothing more,
 * so the lead-time alerts its lines weigh on are worked again without them.
 */
describe("CERT-2 — cancelling or closing an order works its lines' lead-time alerts again", () => {
  const procurement = require("../procurement.service");
  const lines = [
    { id: "line-1", lineNumber: 1, orderedQty: 10, receivedQty: 0, unitCost: 5, packageId: "pkg-1" },
    { id: "line-2", lineNumber: 2, orderedQty: 10, receivedQty: 10, unitCost: 5, packageId: null },
  ];
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$queryRaw.mockImplementation(async () => [{ status: "issued" }]);
    mockPrisma.procurementOrder.update.mockResolvedValue({});
  });
  afterEach(() => mockPrisma.$queryRaw.mockImplementation(async () => []));

  it("cancel: the scopes of all the order's lines are worked once, inside the transaction, after the order is cancelled (round 6: not once per line)", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue(order({ status: "issued", lines }));
    await service.cancelOrder({ orgId: "org-1", projectId: "project-1", orderId: "order-1", actor: { id: "pm" }, reason: "Supplier failed" });
    expect(procurement.syncLeadTimeAlerts).toHaveBeenCalledTimes(1);
    expect(procurement.syncLeadTimeAlert).not.toHaveBeenCalled();
    expect(procurement.syncLeadTimeAlerts).toHaveBeenCalledWith(expect.objectContaining({ tx: mockPrisma, projectId: "project-1", lines: [expect.objectContaining({ id: "line-1", packageId: "pkg-1" }), expect.objectContaining({ id: "line-2" })] }));
    expect(mockPrisma.procurementOrder.update.mock.invocationCallOrder[0]).toBeLessThan(procurement.syncLeadTimeAlerts.mock.invocationCallOrder[0]);
  });

  it("close: likewise; issue and acknowledge leave the alerts alone", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue(order({ status: "issued", lines: lines.map((line) => ({ ...line, receivedQty: 10 })) }));
    await service.closeOrder({ orgId: "org-1", projectId: "project-1", orderId: "order-1", actor: { id: "pm" } });
    expect(procurement.syncLeadTimeAlerts).toHaveBeenCalledTimes(1);
    procurement.syncLeadTimeAlerts.mockClear();
    await service.acknowledgeOrder({ orgId: "org-1", projectId: "project-1", orderId: "order-1", actor: { id: "pm" } });
    expect(procurement.syncLeadTimeAlerts).not.toHaveBeenCalled();
    expect(procurement.syncLeadTimeAlert).not.toHaveBeenCalled();
  });
});
