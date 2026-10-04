/**
 * CERT-2 (bodies-4): what the stock movements refuse before anything moves.
 *
 *   - occurredAt / expiryDate that is not a date ("x", {"not":"x"}, []) went
 *     through new Date() to the write and failed with a 500.
 *   - A unit cost of 1e15 overflowed the item's Decimal(18,4) price columns
 *     (500); a quantity of 1e15 was stored; a movement's value is a
 *     Decimal(18,2).
 *   - A transfer receipt's line that names no line of the transfer — another
 *     transfer's, another company's, one that exists nowhere, ["<own id>"] —
 *     was matched to nothing, and the line it meant was booked in full with
 *     the reported quantities dropped. It is refused as a line the transfer
 *     does not have.
 *
 * Each refusal is a 400/404 before the transaction opens, or before any write
 * inside it.
 */

const mockPrisma = { $transaction: jest.fn() };
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../cost-ledger.service", () => ({ post: jest.fn() }));

const inventory = require("../inventory.service");

const USER = { id: "user-store", role: "warehouse" };
const base = { itemId: "item-1", warehouseId: "wh-1", quantity: 2, unitCost: 5 };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("a direct movement's dates and figures are refused before the transaction (CERT-2)", () => {
  test.each([
    ["occurredAt", "x"],
    ["occurredAt", { not: "x" }],
    ["occurredAt", []],
    ["expiryDate", "x"],
    ["expiryDate", []],
  ])("receive with %s %j: 400 INV_DATE_INVALID, nothing opened", async (field, value) => {
    await expect(inventory.receiveStock({ orgId: "org-1", user: USER, payload: { ...base, [field]: value } })).rejects.toMatchObject({ status: 400, code: "INV_DATE_INVALID" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test.each(["adjust", "damage", "quarantine", "release", "return"])("%s with occurredAt \"x\" or expiryDate \"x\": 400, nothing opened", async (type) => {
    const payload = { itemId: "item-1", warehouseId: "wh-1", quantity: 1, notes: "why", projectId: "project-1" };
    await expect(inventory.adjustStock({ orgId: "org-1", user: USER, payload: { ...payload, occurredAt: "x" }, type })).rejects.toMatchObject({ status: 400, code: "INV_DATE_INVALID" });
    await expect(inventory.adjustStock({ orgId: "org-1", user: USER, payload: { ...payload, expiryDate: "x" }, type })).rejects.toMatchObject({ status: 400, code: "INV_DATE_INVALID" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test("issue with occurredAt []: 400, nothing opened", async () => {
    await expect(inventory.issueStock({ orgId: "org-1", user: USER, payload: { ...base, activityId: "activity-1", occurredAt: [] } })).rejects.toMatchObject({ status: 400, code: "INV_DATE_INVALID" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test.each([
    ["unit cost 1e15", { unitCost: 1e15 }, "INV_NUMBER"],
    ["quantity 1e15", { quantity: 1e15 }, "INV_QUANTITY"],
    ["quantity 1e15 at no price", { quantity: 1e15, unitCost: 0 }, "INV_QUANTITY"],
    ["a value of 10^16", { quantity: 1000, unitCost: 99_999_999_999_999 }, "INV_VALUE_TOO_LARGE"],
  ])("receive with %s: 400 %s, nothing opened", async (_label, extra, code) => {
    await expect(inventory.receiveStock({ orgId: "org-1", user: USER, payload: { ...base, ...extra } })).rejects.toMatchObject({ status: 400, code });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test("adjust, issue and reserve refuse a quantity of 1e15 (either sign) before the transaction", async () => {
    await expect(inventory.adjustStock({ orgId: "org-1", user: USER, payload: { itemId: "item-1", warehouseId: "wh-1", quantity: -1e15, notes: "why" }, type: "adjust" })).rejects.toMatchObject({ status: 400, code: "INV_QUANTITY" });
    await expect(inventory.issueStock({ orgId: "org-1", user: USER, payload: { itemId: "item-1", warehouseId: "wh-1", quantity: 1e15, activityId: "activity-1" } })).rejects.toMatchObject({ status: 400, code: "INV_QUANTITY" });
    await expect(inventory.adjustReservation({ orgId: "org-1", user: USER, payload: { itemId: "item-1", warehouseId: "wh-1", quantity: 1e15 } })).rejects.toMatchObject({ status: 400, code: "INV_QUANTITY" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test("the item master's unit cost: 1e15 is refused before anything is read", async () => {
    mockPrisma.inventoryItem = { findFirst: jest.fn(), create: jest.fn() };
    await expect(inventory.createItem({ orgId: "org-1", user: USER, payload: { sku: "SKU-1", name: "Item", unit: "nr", unitCost: 1e15 } })).rejects.toMatchObject({ status: 400, code: "INV_NUMBER" });
    expect(mockPrisma.inventoryItem.create).not.toHaveBeenCalled();
  });
});

/** A fake transaction: records every write; reads answer what the movement needs to reach its writes. */
const fakeTx = ({ average = 0, transfer = null } = {}) => ({
  $queryRaw: jest.fn(async () => [{ averageCost: average }]),
  stockBalance: {
    findFirst: jest.fn(async () => ({ id: "bal-1", onHand: 100, reserved: 0, inTransit: 0, damaged: 0, quarantined: 0 })),
    findMany: jest.fn(async () => []),
    create: jest.fn(),
    update: jest.fn(),
  },
  inventoryItem: { update: jest.fn(), findFirst: jest.fn(async () => null) },
  stockTransaction: { create: jest.fn() },
  stockTransfer: { findFirst: jest.fn(async () => transfer), update: jest.fn() },
  stockTransferLine: { update: jest.fn() },
  warehouse: { findMany: jest.fn(async () => []) },
});
const writes = (tx) => [tx.stockBalance.create, tx.stockBalance.update, tx.inventoryItem.update, tx.stockTransaction.create, tx.stockTransfer.update, tx.stockTransferLine.update].reduce((n, fn) => n + fn.mock.calls.length, 0);
const item = { id: "item-1", unit: "nr", name: "Item", averageCost: 0 };

describe("postMovement — every caller's movement is checked before it is written (CERT-2)", () => {
  test.each([
    ["occurredAt \"x\"", { occurredAt: "x" }],
    ["occurredAt {\"not\":\"x\"}", { occurredAt: { not: "x" } }],
    ["expiryDate []", { expiryDate: [] }],
  ])("a receipt with %s: 400 INV_DATE_INVALID, nothing written", async (_label, context) => {
    const tx = fakeTx();
    await expect(inventory.postMovement(tx, { orgId: "org-1", item, warehouseId: "wh-1", type: "receipt", quantity: 1, unitCost: 5, user: USER, context })).rejects.toMatchObject({ status: 400, code: "INV_DATE_INVALID" });
    expect(writes(tx)).toBe(0);
  });

  test("a receipt at 1e15, a movement of 1e15 and an issue worth 10^16 at the item's average: 400, nothing written", async () => {
    const tx = fakeTx({ average: 1e14 });
    await expect(inventory.postMovement(tx, { orgId: "org-1", item, warehouseId: "wh-1", type: "receipt", quantity: 1, unitCost: 1e15, user: USER })).rejects.toMatchObject({ status: 400, code: "INV_NUMBER" });
    await expect(inventory.postMovement(tx, { orgId: "org-1", item, warehouseId: "wh-1", type: "adjust", quantity: 1e15, user: USER })).rejects.toMatchObject({ status: 400, code: "INV_QUANTITY" });
    await expect(inventory.postMovement(tx, { orgId: "org-1", item, warehouseId: "wh-1", type: "issue", quantity: 100, user: USER })).rejects.toMatchObject({ status: 400, code: "INV_VALUE_TOO_LARGE" });
    expect(writes(tx)).toBe(0);
  });

  test("a good date is stored as that date", async () => {
    const tx = fakeTx();
    tx.stockTransaction.create.mockImplementation(async ({ data }) => ({ id: "txn-1", ...data }));
    tx.project = { findFirst: jest.fn() };
    const row = await inventory.postMovement(tx, { orgId: "org-1", item, warehouseId: "wh-1", type: "receipt", quantity: 1, unitCost: 5, user: USER, context: { occurredAt: "2026-10-01T08:00:00.000Z", expiryDate: "2027-01-31" } });
    expect(row.occurredAt.toISOString()).toBe("2026-10-01T08:00:00.000Z");
    expect(row.expiryDate.toISOString()).toBe("2027-01-31T00:00:00.000Z");
  });
});

describe("a transfer receipt's line is one of the transfer's own (CERT-2)", () => {
  const transfer = { id: "tr-1", ref: "TR-1", orgId: "org-1", status: "in_transit", fromWarehouseId: "wh-1", toWarehouseId: "wh-2", lines: [{ id: "tl-1", itemId: "item-1", quantity: 4 }] };
  beforeEach(() => {
    mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockPrisma.__tx));
  });

  test.each([
    ["a line that exists nowhere (or another company's)", [{ id: "tl-elsewhere", receivedQty: 1 }]],
    ["[\"<own line id>\"]", [{ id: ["tl-1"], receivedQty: 1 }]],
    ["a line that names no line", [{ receivedQty: 1 }]],
    ["the own line and one that is not", [{ id: "tl-1", receivedQty: 1 }, { id: "tl-elsewhere", receivedQty: 1 }]],
  ])("%s: 404 TRANSFER_LINE_NOT_FOUND — not booked in full — nothing written", async (_label, lines) => {
    mockPrisma.__tx = fakeTx({ transfer });
    await expect(inventory.receiveTransfer({ orgId: "org-1", user: USER, transferId: "tr-1", payload: { lines } })).rejects.toMatchObject({ status: 404, code: "TRANSFER_LINE_NOT_FOUND" });
    expect(writes(mockPrisma.__tx)).toBe(0);
    expect(mockPrisma.__tx.inventoryItem.findFirst).not.toHaveBeenCalled();
  });

  test("the transfer's own line passes the check (it goes on to the item, which this fake does not have)", async () => {
    mockPrisma.__tx = fakeTx({ transfer });
    await expect(inventory.receiveTransfer({ orgId: "org-1", user: USER, transferId: "tr-1", payload: { lines: [{ id: "tl-1", receivedQty: 1 }] } })).rejects.toMatchObject({ status: 404, code: "ITEM_NOT_FOUND" });
    expect(mockPrisma.__tx.inventoryItem.findFirst).toHaveBeenCalled();
  });

  test("a transfer that is not in transit still answers its state first", async () => {
    mockPrisma.__tx = fakeTx({ transfer: { ...transfer, status: "received" } });
    await expect(inventory.receiveTransfer({ orgId: "org-1", user: USER, transferId: "tr-1", payload: { lines: [{ id: "tl-elsewhere" }] } })).rejects.toMatchObject({ status: 409, code: "TRANSFER_STATE" });
  });
});
