/**
 * Goods receipt and the three-way match.
 *
 * The match rules are the point: the worked example from the brief is
 * "ordered 1,000, received 950, invoiced 1,000 → flag it", and that is the
 * first test here.
 */

const mockPrisma = {
  procurementOrder: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  procurementPoLine: { findMany: jest.fn(), update: jest.fn() },
  // findFirst backs both the duplicate-delivery-note check and the next
  // receipt number, which reads the highest already issued rather than
  // counting rows.
  deliveryReceipt: { create: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
  deliveryReceiptLine: { create: jest.fn() },
  directCost: { findFirst: jest.fn() },
  inventoryItem: { findFirst: jest.fn(), create: jest.fn() },
  warehouse: { findFirst: jest.fn() },
  // The requirement the material was ordered against, moved by the same
  // transaction that puts the stock away.
  activityMaterial: { update: jest.fn() },
  // Read at the end so the receipt can report how much is now in the shed.
  stockBalance: { findMany: jest.fn(async () => []) },
  // The receipt locks the lines it is about to change, so two lorries at the
  // gate cannot both read the same starting figure. The lock returns nothing;
  // what matters is that it is taken.
  $queryRaw: jest.fn(async () => []),
  $transaction: (fn) => fn(mockPrisma),
};

const mockInventory = { postMovement: jest.fn(async () => ({ id: "txn-1" })) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../inventory.service", () => mockInventory);
// The lead-time alert is procurement's own calculation; that it is asked for is
// what matters here, and it has its own tests.
jest.mock("../procurement.service", () => ({ syncLeadTimeAlert: jest.fn() }));

const service = require("../goods-receipt.service");
const procurement = require("../procurement.service");

const ORG = "org-1";
const USER = { id: "user-store", role: "warehouse" };

const poLine = (over = {}) => ({
  id: "line-1",
  orderId: "order-1",
  projectId: "project-1",
  lineNumber: 1,
  itemCode: "CEM-42.5N",
  description: "Cement OPC 42.5N",
  spec: null,
  unit: "bag",
  orderedQty: 1000,
  receivedQty: 0,
  rejectedQty: 0,
  unitCost: 6.4,
  activityId: "activity-1",
  activityMaterialId: null,
  inventoryItemId: "item-1",
  status: "ordered",
  ...over,
});

const invoiceLine = (over = {}) => ({
  id: "inv-line-1",
  poLineId: "line-1",
  quantity: 1000,
  amount: 6400,
  ...over,
});

describe("three-way match", () => {
  beforeEach(() => jest.clearAllMocks());

  it("flags an invoice for more than was accepted", () => {
    // The brief's example: 1,000 ordered, 950 received, 1,000 invoiced.
    const result = service.matchLine(
      poLine({ receivedQty: 950 }),
      [invoiceLine({ quantity: 1000, amount: 6400 })]
    );

    expect(result.orderedQty).toBe(1000);
    expect(result.receivedQty).toBe(950);
    expect(result.invoicedQty).toBe(1000);

    const codes = result.flags.map((flag) => flag.code);
    expect(codes).toContain("invoiced_more_than_received");
    expect(result.flags.find((flag) => flag.code === "invoiced_more_than_received").severity).toBe(
      "blocking"
    );
  });

  it("passes a delivery and invoice that agree", () => {
    const result = service.matchLine(
      poLine({ receivedQty: 1000 }),
      [invoiceLine({ quantity: 1000, amount: 6400 })]
    );
    expect(result.flags).toEqual([]);
  });

  it("catches a price that is not the price ordered", () => {
    // Same quantity, but billed at 7.20 against 6.40 agreed.
    const result = service.matchLine(
      poLine({ receivedQty: 1000 }),
      [invoiceLine({ quantity: 1000, amount: 7200 })]
    );

    const variance = result.flags.find((flag) => flag.code === "price_variance");
    expect(variance).toBeTruthy();
    expect(variance.severity).toBe("blocking");
    expect(result.invoicedUnitCost).toBe(7.2);
    expect(result.orderedUnitCost).toBe(6.4);
  });

  it("lets a rounding difference through without crying wolf", () => {
    // A third of a penny out over a thousand units is arithmetic, not a dispute.
    const result = service.matchLine(
      poLine({ receivedQty: 1000 }),
      [invoiceLine({ quantity: 1000, amount: 6400.02 })]
    );
    expect(result.flags.map((flag) => flag.code)).not.toContain("price_variance");
  });

  it("does not let rejected goods justify an invoice", () => {
    // 1,000 turned up, 50 were rejected and went back, 950 accepted. An
    // invoice for the full 1,000 is not covered by the delivery.
    const result = service.matchLine(
      poLine({ receivedQty: 950, rejectedQty: 50 }),
      [invoiceLine({ quantity: 1000, amount: 6400 })]
    );

    const codes = result.flags.map((flag) => flag.code);
    expect(codes).toContain("invoiced_more_than_received");
    expect(codes).toContain("rejected_on_delivery");
  });

  it("notes a short delivery without blocking on it", () => {
    const result = service.matchLine(
      poLine({ receivedQty: 600 }),
      [invoiceLine({ quantity: 600, amount: 3840 })]
    );

    const short = result.flags.find((flag) => flag.code === "short_delivered");
    expect(short.severity).toBe("info");
    expect(result.flags.every((flag) => flag.severity !== "blocking")).toBe(true);
  });

  it("flags stock that arrived over the order", () => {
    const result = service.matchLine(poLine({ receivedQty: 1100 }), []);
    expect(result.flags.map((flag) => flag.code)).toContain("received_more_than_ordered");
  });

  it("reads an invoice with no purchase order as unmatched, not as clean", async () => {
    mockPrisma.directCost.findFirst.mockResolvedValue({
      id: "dc-1",
      ref: "DC-0001",
      invoiceNumber: "INV-77",
      total: 1200,
      purchaseOrderId: null,
      purchaseOrder: null,
      lines: [],
    });

    const result = await service.matchInvoice({ orgId: ORG, directCostId: "dc-1" });
    expect(result.verdict).toBe("unmatched");
    expect(result.flags[0].code).toBe("no_purchase_order");
  });

  it("ignores a voided invoice when matching an order", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue({
      id: "order-1",
      ref: "PO-0001",
      // A delivery only arrives against an order the supplier has
      // (OCTA-PROC-RECEIPT-070).
      status: "issued",
      projectId: "project-1",
      supplier: "Riverstone",
      supplierRef: { name: "Riverstone Cement" },
      lines: [poLine({ receivedQty: 1000 })],
      supplierInvoices: [
        {
          id: "dc-void",
          ref: "DC-0001",
          status: "void",
          total: 99999,
          costDate: null,
          lines: [invoiceLine({ quantity: 5000, amount: 99999 })],
        },
      ],
    });

    const result = await service.matchOrder({ orgId: ORG, orderId: "order-1" });
    // A voided invoice is not a claim on anything, so nothing is over-invoiced.
    expect(result.lines[0].invoicedQty).toBe(0);
    expect(result.verdict).toBe("matched");
  });
});

describe("goods receipt", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.warehouse.findFirst.mockResolvedValue({ id: "wh-1", orgId: ORG, name: "Main" });
    mockPrisma.deliveryReceipt.count.mockResolvedValue(0);
    mockPrisma.deliveryReceipt.create.mockResolvedValue({
      id: "grn-1",
      receiptNumber: "GRN-00001",
    });
    mockPrisma.deliveryReceiptLine.create.mockResolvedValue({ id: "grn-line-1" });
    mockPrisma.inventoryItem.findFirst.mockResolvedValue({
      id: "item-1",
      orgId: ORG,
      sku: "CEM-42.5N",
      unit: "bag",
      averageCost: 6,
    });
    mockPrisma.procurementPoLine.update.mockResolvedValue({});
    mockPrisma.procurementOrder.update.mockResolvedValue({});
    mockPrisma.procurementPoLine.findMany.mockResolvedValue([
      poLine({ receivedQty: 950 }),
    ]);
  });

  /**
   * What the other writer did and this one did not.
   *
   * While Procurement had a receipt writer of its own, it was the only path
   * that moved the material requirement and refreshed the lead-time alert — so
   * a delivery booked through the warehouse, which is the path the product's
   * own screen uses, left the planner's material list reading nought received
   * after the lorry had been and gone (OCTA-PROC-RECEIPT-081).
   */
  it("moves the requirement the material was ordered against", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue({
      id: "order-1",
      ref: "PO-0001",
      status: "issued",
      projectId: "project-1",
      packageId: null,
      supplierId: null,
      project: { id: "project-1" },
      lines: [poLine({ activityMaterialId: "material-7" })],
    });

    await service.receiveAgainstOrder({
      orgId: ORG,
      user: USER,
      payload: {
        orderId: "order-1",
        warehouseId: "wh-1",
        lines: [{ poLineId: "line-1", acceptedQty: 400 }],
      },
    });

    expect(mockPrisma.activityMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "material-7" },
        data: expect.objectContaining({ receivedQty: { increment: 400 }, status: "partial" }),
      })
    );
    expect(procurement.syncLeadTimeAlert).toHaveBeenCalled();
  });

  it("leaves the material alone when the line was not ordered against one", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue({
      id: "order-1",
      ref: "PO-0001",
      status: "issued",
      projectId: "project-1",
      packageId: null,
      supplierId: null,
      project: { id: "project-1" },
      lines: [poLine({ activityMaterialId: null })],
    });

    await service.receiveAgainstOrder({
      orgId: ORG,
      user: USER,
      payload: {
        orderId: "order-1",
        warehouseId: "wh-1",
        lines: [{ poLineId: "line-1", acceptedQty: 400 }],
      },
    });

    expect(mockPrisma.activityMaterial.update).not.toHaveBeenCalled();
  });

  it("posts the stock, the receipt line and the order's progress together", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue({
      id: "order-1",
      ref: "PO-0001",
      // A delivery only arrives against an order the supplier has
      // (OCTA-PROC-RECEIPT-070).
      status: "issued",
      projectId: "project-1",
      packageId: null,
      supplierId: null,
      status: "issued",
      lines: [poLine()],
    });

    const result = await service.receiveAgainstOrder({
      orgId: ORG,
      user: USER,
      payload: {
        orderId: "order-1",
        warehouseId: "wh-1",
        deliveryNote: "DN-556",
        lines: [{ poLineId: "line-1", acceptedQty: 950, rejectedQty: 50 }],
      },
    });

    expect(result.receiptNumber).toBe("GRN-00001");
    expect(mockPrisma.deliveryReceiptLine.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ acceptedQty: 950, rejectedQty: 50 }),
      })
    );

    // Only what was accepted becomes stock; the rejected 50 went back on the lorry.
    expect(mockInventory.postMovement).toHaveBeenCalledTimes(1);
    expect(mockInventory.postMovement.mock.calls[0][1]).toMatchObject({
      type: "receipt",
      quantity: 950,
    });

    expect(mockPrisma.procurementPoLine.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ receivedQty: 950, rejectedQty: 50, status: "partial" }),
      })
    );
  });

  /**
   * A `planned` order used to accept a delivery, which walked around the whole
   * approval workflow from the warehouse end: stock appeared against an order
   * nobody had authorised, and an invoice then matched against it
   * (OCTA-PROC-RECEIPT-070).
   */
  it.each(["planned", "draft", "pending_approval", "approved"])(
    "refuses a delivery against a %s order",
    async (status) => {
      mockPrisma.procurementOrder.findFirst.mockResolvedValue({
        id: "order-1",
        ref: "PO-0001",
        status,
        projectId: "project-1",
        lines: [poLine({})],
      });
      await expect(
        service.receiveAgainstOrder({
          orgId: ORG,
          user: USER,
          payload: {
            orderId: "order-1",
            warehouseId: "wh-1",
            lines: [{ poLineId: "pol-1", acceptedQty: 1 }],
          },
        }),
      ).rejects.toMatchObject({ status: 409, code: "PO_NOT_ISSUED" });
    },
  );

  it("refuses to take more than was ordered", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue({
      id: "order-1",
      ref: "PO-0001",
      // A delivery only arrives against an order the supplier has
      // (OCTA-PROC-RECEIPT-070).
      status: "issued",
      projectId: "project-1",
      lines: [poLine({ receivedQty: 900 })],
    });

    await expect(
      service.receiveAgainstOrder({
        orgId: ORG,
        user: USER,
        payload: {
          orderId: "order-1",
          warehouseId: "wh-1",
          lines: [{ poLineId: "line-1", acceptedQty: 200 }],
        },
      })
    ).rejects.toThrow(
      expect.objectContaining({ status: 409, code: "RECEIPT_OVER_ORDER" })
    );

    expect(mockInventory.postMovement).not.toHaveBeenCalled();
  });

  it("creates the stocked item on a first delivery rather than stopping", async () => {
    mockPrisma.inventoryItem.findFirst.mockResolvedValue(null);
    mockPrisma.inventoryItem.create.mockResolvedValue({
      id: "item-new",
      sku: "CEM-42.5N",
      unit: "bag",
      averageCost: 0,
    });
    mockPrisma.procurementOrder.findFirst.mockResolvedValue({
      id: "order-1",
      ref: "PO-0001",
      // A delivery only arrives against an order the supplier has
      // (OCTA-PROC-RECEIPT-070).
      status: "issued",
      projectId: "project-1",
      lines: [poLine({ inventoryItemId: null })],
    });

    await service.receiveAgainstOrder({
      orgId: ORG,
      user: USER,
      payload: {
        orderId: "order-1",
        warehouseId: "wh-1",
        lines: [{ poLineId: "line-1", acceptedQty: 10 }],
      },
    });

    expect(mockPrisma.inventoryItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sku: "CEM-42.5N", orgId: ORG }),
      })
    );
    // And the mapping is remembered, so the next delivery does not repeat it.
    expect(mockPrisma.procurementPoLine.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ inventoryItemId: "item-new" }),
      })
    );
  });

  it("receives at the ordered price when the delivery does not state one", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue({
      id: "order-1",
      ref: "PO-0001",
      // A delivery only arrives against an order the supplier has
      // (OCTA-PROC-RECEIPT-070).
      status: "issued",
      projectId: "project-1",
      lines: [poLine()],
    });

    await service.receiveAgainstOrder({
      orgId: ORG,
      user: USER,
      payload: {
        orderId: "order-1",
        warehouseId: "wh-1",
        lines: [{ poLineId: "line-1", acceptedQty: 100 }],
      },
    });

    expect(mockInventory.postMovement.mock.calls[0][1].unitCost).toBe(6.4);
  });
});
