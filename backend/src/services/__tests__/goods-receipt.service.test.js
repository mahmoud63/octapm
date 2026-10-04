/**
 * Goods receipt and the three-way match.
 *
 * The match rules are the point: the worked example from the brief is
 * "ordered 1,000, received 950, invoiced 1,000 → flag it", and that is the
 * first test here.
 */

const { referenceCounterMock } = require("./helpers/reference-counter-mock");

const mockPrisma = {
  // The receipt number is drawn from the atomic counter, which is two raw
  // queries this fake has no tables for (Phase 20.6). The helper also answers
  // the `FOR UPDATE` lock this service takes over the lines it is about to
  // change: anything that is not the counter statement comes back empty,
  // which is what a lock returns.
  ...referenceCounterMock(),
  procurementOrder: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  procurementPoLine: { findMany: jest.fn(), update: jest.fn() },
  // findFirst backs the duplicate-delivery-note check.
  deliveryReceipt: { create: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
  deliveryReceiptLine: { create: jest.fn() },
  directCost: { findFirst: jest.fn() },
  inventoryItem: { findFirst: jest.fn(), create: jest.fn() },
  warehouse: { findFirst: jest.fn() },
  // The bins a delivery is put away in, looked up in the receiving warehouse (CERT-2).
  warehouseLocation: { findMany: jest.fn(async () => []) },
  // The requirement the material was ordered against, moved by the same
  // transaction that puts the stock away.
  activityMaterial: { update: jest.fn() },
  // Read at the end so the receipt can report how much is now in the shed.
  stockBalance: { findMany: jest.fn(async () => []) },
  // The daily report a delivery may be booked against (CERT-2).
  dailyReport: { findFirst: jest.fn() },
  $transaction: (fn) => fn(mockPrisma),
};

const mockInventory = { postMovement: jest.fn(async () => ({ id: "txn-1" })), lockItems: jest.fn(async () => undefined) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../inventory.service", () => mockInventory);
// The lead-time alert is procurement's own calculation; that it is asked for is
// what matters here, and it has its own tests.
jest.mock("../procurement.service", () => ({ syncLeadTimeAlert: jest.fn() }));
// the delivery is published to the project as it is posted (Phase 22B)
const mockAudit = { recordEvent: jest.fn(async () => ({})), ENTITY_TYPES: { DELIVERY_RECEIPT: "delivery_receipt" }, ACTIONS: { CREATED: "created" } };
jest.mock("../audit.service", () => mockAudit);

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
    // the delivery reaches everyone watching the project (Phase 22B)
    expect(mockAudit.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1", entityType: "delivery_receipt", action: "created", newStatus: "partial" })
    );
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

describe("Phase 21D — integrity (Codex round 1)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("CX21-002: refuses a receipt that reports the same order line twice", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue({
      id: "order-1", ref: "PO-0001", status: "issued", projectId: "project-1", packageId: null, supplierId: null,
      project: { id: "project-1" }, lines: [poLine({ orderedQty: 100 })],
    });
    mockPrisma.warehouse.findFirst.mockResolvedValue({ id: "wh-1", orgId: ORG, name: "Main" });
    mockPrisma.deliveryReceipt.count.mockResolvedValue(0);
    await expect(
      service.receiveAgainstOrder({ orgId: ORG, user: USER, payload: { orderId: "order-1", warehouseId: "wh-1", lines: [
        { poLineId: "line-1", acceptedQty: 60 },
        { poLineId: "line-1", acceptedQty: 60 },
      ] } }),
    ).rejects.toMatchObject({ code: "RECEIPT_DUPLICATE_LINE" });
    expect(mockInventory.postMovement).not.toHaveBeenCalled();
    expect(mockPrisma.procurementPoLine.update).not.toHaveBeenCalled();
  });
});

describe("Phase 21D — integrity (Codex round 3)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("holds every stocked item on the order before any line moves stock", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue({
      id: "order-1", ref: "PO-0001", status: "issued", projectId: "project-1", packageId: null, supplierId: null,
      project: { id: "project-1" }, lines: [poLine({ orderedQty: 100 }), poLine({ id: "line-2", inventoryItemId: "item-0", orderedQty: 5 })],
    });
    mockPrisma.warehouse.findFirst.mockResolvedValue({ id: "wh-1", orgId: ORG, name: "Main" });
    mockPrisma.deliveryReceipt.count.mockResolvedValue(0);
    mockPrisma.deliveryReceipt.create.mockResolvedValue({ id: "grn-1", receiptNumber: "GRN-00001" });
    mockPrisma.deliveryReceiptLine.create.mockResolvedValue({ id: "grn-line-1" });
    mockPrisma.inventoryItem.findFirst.mockResolvedValue({ id: "item-1", orgId: ORG, sku: "CEM-42.5N", unit: "bag", averageCost: 6 });
    mockPrisma.procurementPoLine.update.mockResolvedValue({});
    mockPrisma.procurementOrder.update.mockResolvedValue({});
    mockPrisma.procurementPoLine.findMany.mockResolvedValue([]);
    await service.receiveAgainstOrder({ orgId: ORG, user: USER, payload: { orderId: "order-1", warehouseId: "wh-1", lines: [{ poLineId: "line-1", acceptedQty: 10 }] } });
    expect(mockInventory.lockItems).toHaveBeenCalledTimes(1);
    const [, ids] = mockInventory.lockItems.mock.calls[0];
    // lockItems de-duplicates; the list handed to it may name an item twice (mapped on the order and resolved for the line)
    expect([...new Set(ids.filter(Boolean))].sort()).toEqual(["item-0", "item-1"]);
    expect(mockInventory.lockItems.mock.invocationCallOrder[0]).toBeLessThan(mockInventory.postMovement.mock.invocationCallOrder[0]);
  });
});

describe("Phase 21D — integrity (Codex round 4)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("CX21-301: the prelock covers the item a line resolves to, not only the one the order names", async () => {
    // The order line names no item; the storeman picks item-7 on the delivery.
    mockPrisma.procurementOrder.findFirst.mockResolvedValue({
      id: "order-1", ref: "PO-0001", status: "issued", projectId: "project-1", packageId: null, supplierId: null,
      project: { id: "project-1" }, lines: [poLine({ inventoryItemId: null, orderedQty: 100 })],
    });
    mockPrisma.warehouse.findFirst.mockResolvedValue({ id: "wh-1", orgId: ORG, name: "Main" });
    mockPrisma.deliveryReceipt.count.mockResolvedValue(0);
    mockPrisma.deliveryReceipt.create.mockResolvedValue({ id: "grn-1", receiptNumber: "GRN-00001" });
    mockPrisma.deliveryReceiptLine.create.mockResolvedValue({ id: "grn-line-1" });
    mockPrisma.inventoryItem.findFirst.mockResolvedValue({ id: "item-7", orgId: ORG, sku: "PICKED", unit: "bag", averageCost: 6 });
    mockPrisma.procurementPoLine.update.mockResolvedValue({});
    mockPrisma.procurementOrder.update.mockResolvedValue({});
    mockPrisma.procurementPoLine.findMany.mockResolvedValue([]);
    await service.receiveAgainstOrder({ orgId: ORG, user: USER, payload: { orderId: "order-1", warehouseId: "wh-1", lines: [{ poLineId: "line-1", acceptedQty: 10, inventoryItemId: "item-7" }] } });
    const [, ids] = mockInventory.lockItems.mock.calls[0];
    expect(ids).toContain("item-7");
    expect(mockInventory.lockItems.mock.invocationCallOrder[0]).toBeLessThan(mockInventory.postMovement.mock.invocationCallOrder[0]);
  });
});

describe("Phase 21D — integrity (release challenge, third pass)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.warehouse.findFirst.mockResolvedValue({ id: "wh-1", orgId: ORG, name: "Main" });
    mockPrisma.deliveryReceipt.count.mockResolvedValue(0);
    mockPrisma.deliveryReceipt.findFirst.mockResolvedValue(null);
  });
  afterEach(() => jest.restoreAllMocks());
  const issuedOrder = (over = {}) => ({ id: "order-1", ref: "PO-0001", status: "issued", projectId: "project-1", packageId: null, supplierId: null, currency: "USD", project: { id: "project-1" }, lines: [poLine()], ...over });

  it("CX21-434: a delivery that started on an issued order refuses once the order was cancelled under the lock, and moves no stock", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue(issuedOrder());
    mockPrisma.inventoryItem.findFirst.mockResolvedValue({ id: "item-1", orgId: ORG, sku: "CEM-42.5N" });
    mockInventory.postMovement.mockClear();
    mockPrisma.procurementOrder.update.mockClear();
    jest.spyOn(mockPrisma, "$queryRaw").mockImplementation(async (strings) => (Array.isArray(strings) && strings.join("?").includes('FROM "ProcurementOrder"') ? [{ status: "cancelled" }] : []));
    await expect(
      service.receiveAgainstOrder({ orgId: ORG, user: USER, payload: { orderId: "order-1", warehouseId: "wh-1", lines: [{ poLineId: "line-1", acceptedQty: 10 }] } }),
    ).rejects.toMatchObject({ code: "PO_NOT_ISSUED", status: 409 });
    expect(mockInventory.postMovement).not.toHaveBeenCalled();
    expect(mockPrisma.procurementOrder.update).not.toHaveBeenCalled();
  });

  it("CX21-421: a key refused on the order's project creates nothing before it is refused", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue(issuedOrder({ lines: [poLine({ inventoryItemId: null })] }));
    mockPrisma.inventoryItem.findFirst.mockResolvedValue(null);
    mockPrisma.inventoryItem.create.mockClear();
    await expect(
      service.receiveAgainstOrder({ orgId: ORG, user: USER, payload: { orderId: "order-1", warehouseId: "wh-1", lines: [{ poLineId: "line-1", acceptedQty: 10 }] }, allowedProjectIds: ["project-2"] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN_PROJECT", status: 403 });
    expect(mockPrisma.inventoryItem.create).not.toHaveBeenCalled();
  });
});

describe("CERT-2 — a line's bin is one of the receiving warehouse's own", () => {
  const issuedOrder = () => ({ id: "order-1", ref: "PO-0001", status: "issued", projectId: "project-1", packageId: null, supplierId: null, project: { id: "project-1" }, lines: [poLine({ orderedQty: 100 })] });
  // org-1's warehouse wh-1 holds bin-1 and bin-2; bin-9 is org-1's but in another warehouse.
  const BINS = [
    { id: "bin-1", warehouseId: "wh-1", orgId: ORG },
    { id: "bin-2", warehouseId: "wh-1", orgId: ORG },
    { id: "bin-9", warehouseId: "wh-2", orgId: ORG },
    { id: "bin-of-org-2", warehouseId: "wh-of-org-2", orgId: "org-2" },
  ];
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.procurementOrder.findFirst.mockResolvedValue(issuedOrder());
    mockPrisma.warehouse.findFirst.mockResolvedValue({ id: "wh-1", orgId: ORG, name: "Main", projectId: null });
    mockPrisma.deliveryReceipt.findFirst.mockResolvedValue(null);
    mockPrisma.deliveryReceipt.create.mockResolvedValue({ id: "grn-1", receiptNumber: "GRN-00001" });
    mockPrisma.deliveryReceiptLine.create.mockResolvedValue({ id: "grn-line-1" });
    mockPrisma.inventoryItem.findFirst.mockResolvedValue({ id: "item-1", orgId: ORG, sku: "CEM-42.5N", unit: "bag", averageCost: 6, projectId: null });
    mockPrisma.procurementPoLine.update.mockResolvedValue({});
    mockPrisma.procurementPoLine.findMany.mockResolvedValue([]);
    mockPrisma.procurementOrder.update.mockResolvedValue({});
    mockPrisma.warehouseLocation.findMany.mockImplementation(async ({ where }) =>
      BINS.filter((bin) => where.id.in.includes(bin.id) && bin.warehouseId === where.warehouseId && bin.orgId === where.orgId).map((bin) => ({ id: bin.id })),
    );
  });
  afterEach(() => mockPrisma.warehouseLocation.findMany.mockImplementation(async () => []));
  const receive = (lines) => service.receiveAgainstOrder({ orgId: ORG, user: USER, payload: { orderId: "order-1", warehouseId: "wh-1", lines } });

  it("refuses another organisation's location exactly as one that exists nowhere, before anything is written", async () => {
    const answers = [];
    for (const locationId of ["bin-of-org-2", "bin-that-exists-nowhere"]) {
      const error = await receive([{ poLineId: "line-1", acceptedQty: 10, locationId }]).catch((caught) => caught);
      expect(error).toMatchObject({ status: 404, code: "LOCATION_NOT_FOUND", message: "That location is not in this warehouse" });
      answers.push(JSON.stringify({ status: error.status, code: error.code, message: error.message, details: error.details ?? null }));
    }
    expect(answers[0]).toBe(answers[1]);
    // The lookup is the receiving warehouse's, in the caller's organisation.
    expect(mockPrisma.warehouseLocation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["bin-of-org-2"] }, warehouseId: "wh-1", orgId: ORG } }));
    expect(mockPrisma.deliveryReceipt.create).not.toHaveBeenCalled();
    expect(mockPrisma.deliveryReceiptLine.create).not.toHaveBeenCalled();
    expect(mockInventory.postMovement).not.toHaveBeenCalled();
    expect(mockPrisma.procurementPoLine.update).not.toHaveBeenCalled();
  });

  it("refuses a bin of the same organisation's other warehouse, and a delivery where any one line names a bin not in this warehouse", async () => {
    await expect(receive([{ poLineId: "line-1", acceptedQty: 10, locationId: "bin-9" }])).rejects.toMatchObject({ status: 404, code: "LOCATION_NOT_FOUND" });
    mockPrisma.procurementOrder.findFirst.mockResolvedValue({ ...issuedOrder(), lines: [poLine({ orderedQty: 100 }), poLine({ id: "line-2", lineNumber: 2, orderedQty: 100 })] });
    await expect(receive([{ poLineId: "line-1", acceptedQty: 10, locationId: "bin-1" }, { poLineId: "line-2", acceptedQty: 10, locationId: "bin-of-org-2" }])).rejects.toMatchObject({ status: 404, code: "LOCATION_NOT_FOUND" });
    expect(mockInventory.postMovement).not.toHaveBeenCalled();
    expect(mockPrisma.deliveryReceipt.create).not.toHaveBeenCalled();
  });

  it("puts the stock away in the warehouse's own bin, and does not look a bin up when none is named", async () => {
    await receive([{ poLineId: "line-1", acceptedQty: 10, locationId: "bin-2" }]);
    expect(mockInventory.postMovement).toHaveBeenCalledTimes(1);
    expect(mockInventory.postMovement.mock.calls[0][1]).toMatchObject({ warehouseId: "wh-1", locationId: "bin-2", quantity: 10, type: "receipt" });
    mockPrisma.warehouseLocation.findMany.mockClear();
    mockInventory.postMovement.mockClear();
    await receive([{ poLineId: "line-1", acceptedQty: 5 }]);
    expect(mockPrisma.warehouseLocation.findMany).not.toHaveBeenCalled();
    expect(mockInventory.postMovement.mock.calls[0][1]).toMatchObject({ warehouseId: "wh-1", locationId: null, quantity: 5 });
  });
});

describe("Phase 21D — integrity (release challenge, sixth pass)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.deliveryReceipt.count.mockResolvedValue(0);
    mockPrisma.deliveryReceipt.findFirst.mockResolvedValue(null);
  });
  const issuedOrder = (over = {}) => ({ id: "order-1", ref: "PO-0001", status: "issued", projectId: "project-1", packageId: null, supplierId: null, currency: "USD", project: { id: "project-1" }, lines: [poLine()], ...over });

  it("CX21-461: a key allowed on the order's project may not receive it into another project's warehouse, nor onto another project's item", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue(issuedOrder());
    mockPrisma.warehouse.findFirst.mockResolvedValue({ id: "wh-2", orgId: ORG, name: "Project 2 store", projectId: "project-2" });
    mockPrisma.inventoryItem.findFirst.mockResolvedValue({ id: "item-1", orgId: ORG, sku: "CEM-42.5N", projectId: null });
    mockInventory.postMovement.mockClear();
    await expect(
      service.receiveAgainstOrder({ orgId: ORG, user: USER, payload: { orderId: "order-1", warehouseId: "wh-2", lines: [{ poLineId: "line-1", acceptedQty: 10 }] }, allowedProjectIds: ["project-1"] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN_PROJECT", status: 403 });
    mockPrisma.warehouse.findFirst.mockResolvedValue({ id: "wh-1", orgId: ORG, name: "Main", projectId: null });
    mockPrisma.inventoryItem.findFirst.mockResolvedValue({ id: "item-2", orgId: ORG, sku: "P2-ONLY", projectId: "project-2" });
    await expect(
      service.receiveAgainstOrder({ orgId: ORG, user: USER, payload: { orderId: "order-1", warehouseId: "wh-1", lines: [{ poLineId: "line-1", acceptedQty: 10, inventoryItemId: "item-2" }] }, allowedProjectIds: ["project-1"] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN_PROJECT", status: 403 });
    expect(mockInventory.postMovement).not.toHaveBeenCalled();
  });
});

/**
 * CERT-2 (own-state pairs): what a delivery may name. A line that is not on
 * the order was refused, but only after the row lock had taken every id the
 * request named — another company's purchase-order line included; and the
 * receipt's daily report was stored unchecked (another company's) or failed on
 * the foreign key (one that exists nowhere, a 500).
 */
describe("CERT-2 — what a delivery may name", () => {
  const REPORTS = [{ id: "dr-1", projectId: "project-1" }, { id: "dr-x", projectId: "project-x" }];
  const lockedLineIds = (spy) => spy.mock.calls.filter(([strings]) => Array.isArray(strings) && strings.join("?").includes('FROM "ProcurementPoLine"')).flatMap(([, ids]) => ids);
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.procurementOrder.findFirst.mockResolvedValue({ id: "order-1", ref: "PO-0001", status: "issued", projectId: "project-1", packageId: null, supplierId: null, currency: "USD", project: { id: "project-1" }, lines: [poLine({ orderedQty: 100 })] });
    mockPrisma.warehouse.findFirst.mockResolvedValue({ id: "wh-1", orgId: ORG, name: "Main" });
    mockPrisma.deliveryReceipt.findFirst.mockResolvedValue(null);
    mockPrisma.deliveryReceipt.create.mockResolvedValue({ id: "grn-1", receiptNumber: "GRN-00001" });
    mockPrisma.deliveryReceiptLine.create.mockResolvedValue({ id: "grn-line-1" });
    mockPrisma.inventoryItem.findFirst.mockResolvedValue({ id: "item-1", orgId: ORG, sku: "CEM-42.5N", unit: "bag", averageCost: 6 });
    mockPrisma.procurementPoLine.update.mockResolvedValue({});
    mockPrisma.procurementPoLine.findMany.mockResolvedValue([poLine({ orderedQty: 100, receivedQty: 1 })]);
    mockPrisma.procurementOrder.update.mockResolvedValue({});
    mockPrisma.stockBalance.findMany.mockResolvedValue([]);
    mockPrisma.dailyReport.findFirst.mockImplementation(async ({ where }) => REPORTS.find((row) => row.id === where.id && row.projectId === where.projectId) || null);
    mockInventory.postMovement.mockResolvedValue({ id: "txn-1" });
    mockInventory.lockItems.mockResolvedValue(undefined);
    mockAudit.recordEvent.mockResolvedValue({});
  });
  afterEach(() => jest.restoreAllMocks());

  it("a line that is not on the order — another company's, or one that exists nowhere — is refused before any row is locked; the order's own line is locked and received", async () => {
    const locks = jest.spyOn(mockPrisma, "$queryRaw");
    for (const poLineId of ["their-line", "00000000-0000-4000-8000-000000000000"]) {
      await expect(
        service.receiveAgainstOrder({ orgId: ORG, user: USER, payload: { orderId: "order-1", warehouseId: "wh-1", lines: [{ poLineId: "line-1", acceptedQty: 1 }, { poLineId, acceptedQty: 1 }] } }),
      ).rejects.toMatchObject({ status: 404, code: "PO_LINE_NOT_FOUND" });
    }
    expect(lockedLineIds(locks)).toEqual([]);
    expect(mockPrisma.deliveryReceipt.create).not.toHaveBeenCalled();
    expect(mockInventory.postMovement).not.toHaveBeenCalled();

    await service.receiveAgainstOrder({ orgId: ORG, user: USER, payload: { orderId: "order-1", warehouseId: "wh-1", lines: [{ poLineId: "line-1", acceptedQty: 1 }] } });
    expect(lockedLineIds(locks)).toEqual(["line-1"]);
    expect(mockInventory.postMovement).toHaveBeenCalledTimes(1);
  });

  it("the daily report a delivery is booked against is the order's project's: another company's, or one that exists nowhere, is refused and nothing written", async () => {
    for (const dailyReportId of ["dr-x", "00000000-0000-4000-8000-000000000000"]) {
      await expect(
        service.receiveAgainstOrder({ orgId: ORG, user: USER, payload: { orderId: "order-1", warehouseId: "wh-1", dailyReportId, lines: [{ poLineId: "line-1", acceptedQty: 1 }] } }),
      ).rejects.toMatchObject({ status: 404, code: "DAILY_REPORT_NOT_FOUND" });
    }
    expect(mockPrisma.deliveryReceipt.create).not.toHaveBeenCalled();
    expect(mockInventory.postMovement).not.toHaveBeenCalled();

    await service.receiveAgainstOrder({ orgId: ORG, user: USER, payload: { orderId: "order-1", warehouseId: "wh-1", dailyReportId: "dr-1", lines: [{ poLineId: "line-1", acceptedQty: 1 }] } });
    expect(mockPrisma.deliveryReceipt.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ dailyReportId: "dr-1" }) }));
  });
});

/**
 * CERT-2: the daily report a delivery names is an identifier, or nothing.
 * The value went into the lookup as sent: an array or a number failed there
 * with a 500, and a Prisma filter such as {"not":"x"} passed the lookup — it
 * matched any report of the project — and failed at the write with a 500. The
 * fake below answers the lookup as Prisma does: a string is compared, a filter
 * object is applied, any other shape is a validation error.
 */
describe("CERT-2 — the daily report a delivery names is an identifier", () => {
  const REPORTS = [{ id: "dr-1", projectId: "project-1" }, { id: "dr-2", projectId: "project-1" }, { id: "dr-x", projectId: "project-x" }];
  const prismaLookup = async ({ where }) => {
    const { id, projectId } = where;
    const idMatches = (row) => {
      if (typeof id === "string") return row.id === id;
      if (id && typeof id === "object" && !Array.isArray(id) && Object.keys(id).every((key) => ["not", "in", "equals"].includes(key))) {
        return ("not" in id ? row.id !== id.not : true) && ("in" in id ? id.in.includes(row.id) : true) && ("equals" in id ? row.id === id.equals : true);
      }
      throw Object.assign(new Error("PrismaClientValidationError: Argument `id`: Invalid value provided."), { name: "PrismaClientValidationError" });
    };
    return REPORTS.find((row) => idMatches(row) && row.projectId === projectId) || null;
  };
  const order = (lineOver = {}) => ({ id: "order-1", ref: "PO-0001", status: "issued", projectId: "project-1", packageId: null, supplierId: null, currency: "USD", project: { id: "project-1" }, lines: [poLine({ orderedQty: 100, ...lineOver })] });
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.procurementOrder.findFirst.mockResolvedValue(order());
    mockPrisma.warehouse.findFirst.mockResolvedValue({ id: "wh-1", orgId: ORG, name: "Main" });
    mockPrisma.deliveryReceipt.findFirst.mockResolvedValue(null);
    mockPrisma.deliveryReceipt.create.mockResolvedValue({ id: "grn-1", receiptNumber: "GRN-00001" });
    mockPrisma.deliveryReceiptLine.create.mockResolvedValue({ id: "grn-line-1" });
    mockPrisma.inventoryItem.findFirst.mockResolvedValue({ id: "item-1", orgId: ORG, sku: "CEM-42.5N", unit: "bag", averageCost: 6 });
    mockPrisma.inventoryItem.create.mockResolvedValue({ id: "item-new", orgId: ORG, sku: "CEM-42.5N", unit: "bag", averageCost: 0 });
    mockPrisma.procurementPoLine.update.mockResolvedValue({});
    mockPrisma.procurementPoLine.findMany.mockResolvedValue([poLine({ orderedQty: 100, receivedQty: 1 })]);
    mockPrisma.procurementOrder.update.mockResolvedValue({});
    mockPrisma.stockBalance.findMany.mockResolvedValue([]);
    mockPrisma.dailyReport.findFirst.mockImplementation(prismaLookup);
    mockInventory.postMovement.mockResolvedValue({ id: "txn-1" });
    mockInventory.lockItems.mockResolvedValue(undefined);
    mockAudit.recordEvent.mockResolvedValue({});
  });
  const receive = (dailyReportId) =>
    service.receiveAgainstOrder({ orgId: ORG, user: USER, payload: { orderId: "order-1", warehouseId: "wh-1", lines: [{ poLineId: "line-1", acceptedQty: 1 }], ...(dailyReportId === undefined ? {} : { dailyReportId }) } });
  const answer = (error) => JSON.stringify({ status: error?.status, code: error?.code, message: error?.message, details: error?.details ?? null });

  it("a value that is not a string — [another company's], [the project's own], {id}, a number, a Prisma filter, true — is refused exactly as a report that exists nowhere, and nothing is written", async () => {
    const nowhere = answer(await receive("00000000-0000-4000-8000-000000000000").catch((caught) => caught));
    expect(JSON.parse(nowhere)).toMatchObject({ status: 404, code: "DAILY_REPORT_NOT_FOUND", message: "Daily report not found" });
    for (const value of [["dr-x"], ["dr-1"], { id: "dr-x" }, 12345, { not: "x" }, { in: ["dr-1"] }, true]) {
      const error = await receive(value).catch((caught) => caught);
      expect(answer(error)).toBe(nowhere);
    }
    // Never handed to the database as anything but a string.
    for (const [args] of mockPrisma.dailyReport.findFirst.mock.calls) expect(typeof args.where.id).toBe("string");
    expect(mockPrisma.deliveryReceipt.create).not.toHaveBeenCalled();
    expect(mockInventory.postMovement).not.toHaveBeenCalled();
    expect(mockPrisma.procurementPoLine.update).not.toHaveBeenCalled();
  });

  it("the trimmed identifier is the one looked up and the one stored; null, an empty string and no value book no report", async () => {
    await receive("  dr-2  ");
    expect(mockPrisma.dailyReport.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "dr-2", projectId: "project-1" } }));
    expect(mockPrisma.deliveryReceipt.create.mock.calls.at(-1)[0].data.dailyReportId).toBe("dr-2");
    for (const value of [null, "", "   ", undefined]) {
      mockPrisma.dailyReport.findFirst.mockClear();
      await receive(value);
      expect(mockPrisma.dailyReport.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.deliveryReceipt.create.mock.calls.at(-1)[0].data.dailyReportId).toBeNull();
    }
  });

  it("a refused report on a first delivery leaves no stocked item behind: it is checked before the line's item is settled", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue(order({ inventoryItemId: null, itemCode: "NEW-1" }));
    mockPrisma.inventoryItem.findFirst.mockResolvedValue(null);
    for (const value of ["dr-x", [ "dr-x" ], { not: "x" }]) {
      await expect(receive(value)).rejects.toMatchObject({ status: 404, code: "DAILY_REPORT_NOT_FOUND" });
    }
    expect(mockPrisma.inventoryItem.create).not.toHaveBeenCalled();
    // and the project's own report settles the item and books the delivery
    await receive("dr-1");
    expect(mockPrisma.inventoryItem.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.deliveryReceipt.create.mock.calls.at(-1)[0].data.dailyReportId).toBe("dr-1");
  });

  it("when the order read before the receipt did not find the order, the report is checked inside the receipt against the order found there", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValueOnce(null);
    await expect(receive("dr-x")).rejects.toMatchObject({ status: 404, code: "DAILY_REPORT_NOT_FOUND" });
    expect(mockPrisma.deliveryReceipt.create).not.toHaveBeenCalled();
    mockPrisma.procurementOrder.findFirst.mockResolvedValueOnce(null);
    await expect(receive({ not: "x" })).rejects.toMatchObject({ status: 404, code: "DAILY_REPORT_NOT_FOUND" });
    expect(mockPrisma.deliveryReceipt.create).not.toHaveBeenCalled();
    mockPrisma.procurementOrder.findFirst.mockResolvedValueOnce(null);
    await receive("dr-1");
    expect(mockPrisma.deliveryReceipt.create.mock.calls.at(-1)[0].data.dailyReportId).toBe("dr-1");
  });
});

/**
 * CERT-2: every identifier a delivery names is a string or refused as one that
 * exists nowhere. Sent as an array or a number they failed in the lookup with a
 * 500; a Prisma filter for the line's item ({"not":"x"}) matched any item of the
 * organisation and the delivery was booked to it; an order or a warehouse left
 * out matched any; a date that is not one failed at the write with a 500. The
 * fakes answer the lookups as Prisma does: a string is compared, a filter
 * object applied, any other shape is a validation error, undefined is ignored.
 */
describe("CERT-2 — every identifier a delivery names is an identifier", () => {
  const prismaId = (filter, id) => {
    if (filter === undefined) return true;
    if (typeof filter === "string") return id === filter;
    if (filter && typeof filter === "object" && !Array.isArray(filter) && "not" in filter) return id !== filter.not;
    throw Object.assign(new Error("PrismaClientValidationError: Argument `id`: Invalid value provided."), { name: "PrismaClientValidationError" });
  };
  const ORDERS = [{ id: "order-1", projectId: "project-1" }];
  const WAREHOUSES = [{ id: "wh-0", orgId: ORG, name: "Other store" }, { id: "wh-1", orgId: ORG, name: "Main" }];
  const ITEMS = [{ id: "item-0", orgId: ORG, sku: "OTHER", unit: "nr", averageCost: 1 }, { id: "item-1", orgId: ORG, sku: "CEM-42.5N", unit: "bag", averageCost: 6 }];
  const order = () => ({ id: "order-1", ref: "PO-0001", status: "issued", projectId: "project-1", packageId: null, supplierId: null, currency: "USD", project: { id: "project-1" }, lines: [poLine({ orderedQty: 100, inventoryItemId: "item-1" })] });
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.procurementOrder.findFirst.mockImplementation(async ({ where }) => (ORDERS.some((row) => prismaId(where.id, row.id) && (where.projectId === undefined || prismaId(where.projectId, row.projectId))) ? order() : null));
    mockPrisma.warehouse.findFirst.mockImplementation(async ({ where }) => WAREHOUSES.find((row) => prismaId(where.id, row.id) && row.orgId === where.orgId) || null);
    mockPrisma.inventoryItem.findFirst.mockImplementation(async ({ where }) => ITEMS.find((row) => prismaId(where.id, row.id) && row.orgId === where.orgId && (where.sku === undefined || row.sku === where.sku)) || null);
    mockPrisma.deliveryReceipt.findFirst.mockResolvedValue(null);
    mockPrisma.deliveryReceipt.create.mockResolvedValue({ id: "grn-1", receiptNumber: "GRN-00001" });
    mockPrisma.deliveryReceiptLine.create.mockResolvedValue({ id: "grn-line-1" });
    mockPrisma.procurementPoLine.update.mockResolvedValue({});
    mockPrisma.procurementPoLine.findMany.mockResolvedValue([poLine({ orderedQty: 100, receivedQty: 1 })]);
    mockPrisma.procurementOrder.update.mockResolvedValue({});
    mockPrisma.stockBalance.findMany.mockResolvedValue([]);
    mockPrisma.warehouseLocation.findMany.mockImplementation(async ({ where }) => (where.id.in.every((id) => typeof id === "string") ? where.id.in.filter((id) => id === "bin-1").map((id) => ({ id })) : Promise.reject(new Error("PrismaClientValidationError"))));
    mockInventory.postMovement.mockResolvedValue({ id: "txn-1" });
    mockInventory.lockItems.mockResolvedValue(undefined);
    mockAudit.recordEvent.mockResolvedValue({});
  });
  afterEach(() => mockPrisma.warehouseLocation.findMany.mockImplementation(async () => []));
  const base = { orderId: "order-1", projectId: "project-1", warehouseId: "wh-1" };
  const receive = (over = {}, lineOver = {}) => service.receiveAgainstOrder({ orgId: ORG, user: USER, payload: { ...base, ...over, lines: [{ poLineId: "line-1", acceptedQty: 1, ...lineOver }] } });
  const answer = async (promise) => {
    const error = await promise.then(() => null, (caught) => caught);
    return JSON.stringify({ status: error?.status ?? (error ? 500 : 201), code: error?.code ?? null, message: error?.message ?? null });
  };
  const SHAPES = [["nowhere-id"], { id: "nowhere-id" }, 12345, { not: "x" }, true];
  const nothingWritten = () => {
    expect(mockPrisma.deliveryReceipt.create).not.toHaveBeenCalled();
    expect(mockInventory.postMovement).not.toHaveBeenCalled();
    expect(mockPrisma.procurementPoLine.update).not.toHaveBeenCalled();
  };

  it("the order and its project: any other shape — or no order at all — is refused exactly as an order that exists nowhere", async () => {
    const nowhere = await answer(receive({ orderId: "nowhere-id" }));
    expect(JSON.parse(nowhere)).toMatchObject({ status: 404, code: "PO_NOT_FOUND" });
    for (const value of [...SHAPES, ["order-1"], undefined]) expect(await answer(receive({ orderId: value }))).toBe(nowhere);
    for (const value of [...SHAPES, ["project-1"]]) expect(await answer(receive({ projectId: value }))).toBe(nowhere);
    expect(await answer(receive({ projectId: "nowhere-id" }))).toBe(nowhere);
    nothingWritten();
    for (const [args] of mockPrisma.procurementOrder.findFirst.mock.calls) expect(typeof args.where.id).toBe("string");
  });

  it("the warehouse: any other shape — or none — is refused exactly as a warehouse that exists nowhere", async () => {
    const nowhere = await answer(receive({ warehouseId: "nowhere-id" }));
    expect(JSON.parse(nowhere)).toMatchObject({ status: 404, code: "WAREHOUSE_NOT_FOUND" });
    for (const value of [...SHAPES, ["wh-1"], undefined]) expect(await answer(receive({ warehouseId: value }))).toBe(nowhere);
    nothingWritten();
  });

  it("a line's item: a Prisma filter is not an item — the delivery is not booked to whatever item it matches; every other shape is refused as an item that exists nowhere", async () => {
    const nowhere = await answer(receive({}, { inventoryItemId: "nowhere-id" }));
    expect(JSON.parse(nowhere)).toMatchObject({ status: 404, code: "ITEM_NOT_FOUND" });
    for (const value of [...SHAPES, ["item-1"]]) expect(await answer(receive({}, { inventoryItemId: value }))).toBe(nowhere);
    nothingWritten();
    for (const [args] of mockPrisma.inventoryItem.findFirst.mock.calls) expect(typeof args.where.id === "string" || args.where.id === undefined).toBe(true);
  });

  it("a line's bin: only a string names one — [the warehouse's own bin] is refused as a bin that is not there", async () => {
    const nowhere = await answer(receive({}, { locationId: "nowhere-id" }));
    expect(JSON.parse(nowhere)).toMatchObject({ status: 404, code: "LOCATION_NOT_FOUND" });
    for (const value of [...SHAPES, ["bin-1"]]) expect(await answer(receive({}, { locationId: value }))).toBe(nowhere);
    nothingWritten();
  });

  it("the date received: a date or nothing; anything else is a 400 before anything is read", async () => {
    for (const value of ["not a date", { not: "x" }, ["2026-10-01"], 12345, true]) {
      await expect(receive({ receivedAt: value })).rejects.toMatchObject({ status: 400, code: "RECEIPT_DATE_INVALID" });
    }
    expect(mockPrisma.procurementOrder.findFirst).not.toHaveBeenCalled();
    nothingWritten();
    await receive({ receivedAt: "2026-10-01T08:00:00.000Z" });
    expect(mockPrisma.deliveryReceipt.create.mock.calls.at(-1)[0].data.receivedAt.toISOString()).toBe("2026-10-01T08:00:00.000Z");
    await receive({ receivedAt: new Date("2026-10-02T08:00:00.000Z") });
    expect(mockPrisma.deliveryReceipt.create.mock.calls.at(-1)[0].data.receivedAt.toISOString()).toBe("2026-10-02T08:00:00.000Z");
  });

  it("the own identifiers, trimmed, are the ones looked up and the ones stored", async () => {
    await receive({ orderId: " order-1 ", projectId: " project-1 ", warehouseId: " wh-1 " }, { inventoryItemId: " item-1 ", locationId: " bin-1 " });
    expect(mockPrisma.procurementOrder.findFirst.mock.calls.at(-1)[0].where).toMatchObject({ id: "order-1", projectId: "project-1" });
    expect(mockPrisma.warehouse.findFirst.mock.calls.at(-1)[0].where).toMatchObject({ id: "wh-1" });
    expect(mockInventory.postMovement.mock.calls.at(-1)[1]).toMatchObject({ warehouseId: "wh-1", locationId: "bin-1", item: expect.objectContaining({ id: "item-1" }) });
  });
});
