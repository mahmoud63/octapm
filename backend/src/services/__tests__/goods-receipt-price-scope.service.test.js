/**
 * CERT-2: a delivered line's price, and the stock a delivery's answer counts.
 *
 *   - Procurement's door to the goods receipt had no check on a line's
 *     unitCost: "abc" became NaN on the stock ledger, which rounded to 0 and
 *     reset the item's average, last price and unit cost. Every line's price
 *     is now a number of zero or more, checked before anything is read or
 *     created for the delivery (a first delivery creates its stocked item
 *     before the receipt's transaction opens).
 *   - The answer's "how much have I got now" summed every balance of the item
 *     in the warehouse, including one this organisation holds in another
 *     company's bin (residue from before the bin guard). It counts the
 *     organisation's own positions only.
 */

const { referenceCounterMock } = require("./helpers/reference-counter-mock");

const ORG = "org-1";
const OTHER = "org-2";
const USER = { id: "user-store", role: "warehouse" };

const LOCATIONS = { "bin-own": { orgId: ORG }, "bin-theirs": { orgId: OTHER } };
const BALANCES = [
  { orgId: ORG, itemId: "item-1", warehouseId: "wh-1", locationId: null, onHand: 5 },
  { orgId: ORG, itemId: "item-1", warehouseId: "wh-1", locationId: "bin-own", onHand: 3 },
  { orgId: ORG, itemId: "item-1", warehouseId: "wh-1", locationId: "bin-theirs", onHand: 10 },
  { orgId: OTHER, itemId: "item-1", warehouseId: "wh-1", locationId: null, onHand: 1000 },
];
/** Prisma's `where` for the shapes the receipt's stock read sends. */
const matchesBalance = (row, where) =>
  Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((clause) => matchesBalance(row, clause));
    if (key === "location") return Boolean(LOCATIONS[row.locationId]) && Object.entries(value).every(([k, v]) => LOCATIONS[row.locationId][k] === v);
    if (value === null) return row[key] == null;
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
    return row[key] === value;
  });

const mockPrisma = {
  ...referenceCounterMock(),
  procurementOrder: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  procurementPoLine: { findMany: jest.fn(), update: jest.fn() },
  deliveryReceipt: { create: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
  deliveryReceiptLine: { create: jest.fn() },
  inventoryItem: { findFirst: jest.fn(), create: jest.fn() },
  warehouse: { findFirst: jest.fn() },
  warehouseLocation: { findMany: jest.fn(async () => []) },
  activityMaterial: { update: jest.fn() },
  stockBalance: { findMany: jest.fn(async ({ where }) => BALANCES.filter((row) => matchesBalance(row, where))) },
  dailyReport: { findFirst: jest.fn() },
  $transaction: (fn) => fn(mockPrisma),
};
const mockInventory = { postMovement: jest.fn(async () => ({ id: "txn-1" })), lockItems: jest.fn(async () => undefined) };
const mockAudit = { recordEvent: jest.fn(async () => ({})), ENTITY_TYPES: { DELIVERY_RECEIPT: "delivery_receipt" }, ACTIONS: { CREATED: "created" } };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../inventory.service", () => mockInventory);
jest.mock("../procurement.service", () => ({ syncLeadTimeAlert: jest.fn(), syncLeadTimeAlerts: jest.fn(async () => []) }));
jest.mock("../audit.service", () => mockAudit);

const service = require("../goods-receipt.service");

const poLine = (over = {}) => ({
  id: "line-1", orderId: "order-1", projectId: "project-1", lineNumber: 1, itemCode: "CEM-42.5N", description: "Cement OPC 42.5N",
  spec: null, unit: "bag", orderedQty: 100, receivedQty: 0, rejectedQty: 0, unitCost: 6.4, activityId: "activity-1",
  activityMaterialId: null, inventoryItemId: null, status: "ordered", ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.procurementOrder.findFirst.mockResolvedValue({ id: "order-1", ref: "PO-0001", status: "issued", projectId: "project-1", packageId: null, supplierId: null, currency: "USD", project: { id: "project-1" }, lines: [poLine()] });
  mockPrisma.warehouse.findFirst.mockResolvedValue({ id: "wh-1", orgId: ORG, name: "Main" });
  mockPrisma.deliveryReceipt.findFirst.mockResolvedValue(null);
  mockPrisma.deliveryReceipt.create.mockResolvedValue({ id: "grn-1", receiptNumber: "GRN-00001" });
  mockPrisma.deliveryReceiptLine.create.mockResolvedValue({ id: "grn-line-1" });
  // A first delivery: the line names no stocked item yet, so settling the items would create one.
  mockPrisma.inventoryItem.findFirst.mockResolvedValue(null);
  mockPrisma.inventoryItem.create.mockResolvedValue({ id: "item-1", orgId: ORG, sku: "CEM-42.5N", unit: "bag" });
  mockPrisma.procurementPoLine.update.mockResolvedValue({ receivedQty: 1 });
  mockPrisma.procurementPoLine.findMany.mockResolvedValue([poLine({ receivedQty: 1 })]);
  mockPrisma.procurementOrder.update.mockResolvedValue({});
});

const receive = (line = {}) =>
  service.receiveAgainstOrder({ orgId: ORG, user: USER, payload: { orderId: "order-1", warehouseId: "wh-1", lines: [{ poLineId: "line-1", acceptedQty: 1, ...line }] } });

describe("CERT-2 — a delivered line's price is a number of zero or more", () => {
  for (const unitCost of ["abc", -1, "", [5], { not: "x" }, true]) {
    it(`unitCost ${JSON.stringify(unitCost)} is refused before anything is read or created for the delivery`, async () => {
      await expect(receive({ unitCost })).rejects.toMatchObject({ status: 400, code: "INV_NUMBER", message: "Unit cost must be zero or more" });
      expect(mockPrisma.procurementOrder.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.inventoryItem.create).not.toHaveBeenCalled();
      expect(mockPrisma.deliveryReceipt.create).not.toHaveBeenCalled();
      expect(mockInventory.postMovement).not.toHaveBeenCalled();
    });
  }

  it("a number, or a numeric string, is the price booked; none is the ordered price", async () => {
    await receive({ unitCost: "7.25" });
    expect(mockInventory.postMovement.mock.calls.at(-1)[1].unitCost).toBe(7.25);
    await receive({ unitCost: 0 });
    expect(mockInventory.postMovement.mock.calls.at(-1)[1].unitCost).toBe(0);
    await receive({ unitCost: null });
    expect(mockInventory.postMovement.mock.calls.at(-1)[1].unitCost).toBe(6.4);
    await receive({});
    expect(mockInventory.postMovement.mock.calls.at(-1)[1].unitCost).toBe(6.4);
  });
});

/**
 * CERT-2 (bodies-4): what the stock ledger can hold, checked before anything
 * is read or created for the delivery — a first delivery's stocked item is
 * created before the receipt's transaction opens, so a line refused later
 * would leave it behind. A price of 1e15 overflowed the item's Decimal(18,4)
 * price columns and an expiry date "x" reached new Date(): both were a 500.
 */
describe("CERT-2 — a delivered line's figures and expiry date fit the stock ledger", () => {
  const nothingDone = () => {
    expect(mockPrisma.inventoryItem.create).not.toHaveBeenCalled();
    expect(mockPrisma.deliveryReceipt.create).not.toHaveBeenCalled();
    expect(mockInventory.postMovement).not.toHaveBeenCalled();
  };

  it.each([
    ["unitCost 1e15", { unitCost: 1e15 }, "INV_NUMBER"],
    ["acceptedQty 1e15", { acceptedQty: 1e15 }, "INV_QUANTITY"],
    ["rejectedQty 1e15", { rejectedQty: 1e15 }, "INV_QUANTITY"],
    ["expiryDate \"x\"", { expiryDate: "x" }, "INV_DATE_INVALID"],
    ["expiryDate []", { expiryDate: [] }, "INV_DATE_INVALID"],
    ["expiryDate {\"not\":\"x\"}", { expiryDate: { not: "x" } }, "INV_DATE_INVALID"],
  ])("%s is a 400 before the order is read", async (_label, line, code) => {
    await expect(receive(line)).rejects.toMatchObject({ status: 400, code });
    expect(mockPrisma.procurementOrder.findFirst).not.toHaveBeenCalled();
    nothingDone();
  });

  it("a line at the ordered price beyond what the item's price holds is a 400 before a first delivery's item is created", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue({ id: "order-1", ref: "PO-0001", status: "issued", projectId: "project-1", packageId: null, supplierId: null, currency: "USD", project: { id: "project-1" }, lines: [poLine({ unitCost: 5e14 })] });
    await expect(receive({})).rejects.toMatchObject({ status: 400, code: "INV_NUMBER" });
    nothingDone();
  });

  it("a line worth 10^16 or more is a 400 before a first delivery's item is created", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue({ id: "order-1", ref: "PO-0001", status: "issued", projectId: "project-1", packageId: null, supplierId: null, currency: "USD", project: { id: "project-1" }, lines: [poLine({ orderedQty: 5000 })] });
    await expect(receive({ acceptedQty: 1000, unitCost: 99_999_999_999_999 })).rejects.toMatchObject({ status: 400, code: "INV_VALUE_TOO_LARGE" });
    nothingDone();
  });

  it("a first delivery on a line ordered beyond the item's price columns, at a price that fits, creates its item at that price (the ordered one overflowed with a 500)", async () => {
    mockPrisma.procurementOrder.findFirst.mockResolvedValue({ id: "order-1", ref: "PO-0001", status: "issued", projectId: "project-1", packageId: null, supplierId: null, currency: "USD", project: { id: "project-1" }, lines: [poLine({ unitCost: 5e14 })] });
    await receive({ unitCost: 7 });
    expect(mockPrisma.inventoryItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ unitCost: 7 }) });
    expect(mockInventory.postMovement.mock.calls.at(-1)[1].unitCost).toBe(7);
  });

  it("an expiry date that is a date reaches the stock movement as given", async () => {
    await receive({ expiryDate: "2027-01-31" });
    expect(mockInventory.postMovement.mock.calls.at(-1)[1].context.expiryDate).toBe("2027-01-31");
  });
});

describe("CERT-2 — the delivery's answer counts the organisation's own positions only", () => {
  it("on hand after the delivery is 8 (root 5 + own bin 3), not 18 with the balance in another company's bin, nor 1,018 with another company's row", async () => {
    const answer = await receive({});
    expect(answer.lines[0]).toMatchObject({ itemId: "item-1", onHand: 8 });
    expect(mockPrisma.stockBalance.findMany.mock.calls.at(-1)[0].where).toMatchObject({ orgId: ORG, OR: [{ locationId: null }, { location: { orgId: ORG } }] });
  });
});
