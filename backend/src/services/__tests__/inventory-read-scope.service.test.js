/**
 * CERT-2: what the inventory reads serve when a row of this organisation names
 * another company's record.
 *
 * Before the write guards existed, a receipt could be put away in another
 * company's bin: the stock balance and the movement are this organisation's
 * rows, but their location is the other company's, and the item's scan served
 * that bin's id, name and code back. The reads must serve nothing of the other
 * company: a stock position is shown, counted and drawn on only when it is the
 * organisation's own row, in its own warehouse, in its own bin or none; a
 * movement or a transfer is shown with any foreign reference blanked.
 *
 * The fake database below answers `where` the way Prisma does for the shapes
 * these reads send (equality, null, `in`, `not`, OR, AND and to-one relation
 * filters), so a read that does not ask for the scope gets the foreign row.
 */

const ORG = "org-1";
const OTHER = "org-2";
const USER = { id: "user-store", role: "warehouse" };

const db = {
  items: [],
  warehouses: [],
  locations: [],
  balances: [],
  transactions: [],
  transfers: [],
};

const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);

/** Prisma's `where` for the shapes used here; a value Prisma would refuse throws. */
const matches = (row, where = {}) =>
  Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === "OR") return value.some((clause) => matches(row, clause));
    if (key === "AND") return value.every((clause) => matches(row, clause));
    if (value === null) return row[key] == null;
    if (isPlain(value)) {
      if ("in" in value) return value.in.includes(row[key]);
      if ("not" in value) return row[key] !== value.not;
      // a to-one relation filter
      const related = relationOf(row, key);
      return Boolean(related) && matches(related, value);
    }
    if (Array.isArray(value)) throw new Error(`Invalid value for ${key}`);
    return row[key] === value;
  });

const relationOf = (row, key) => {
  if (key === "warehouse") return db.warehouses.find((w) => w.id === row.warehouseId) ?? null;
  if (key === "location") return db.locations.find((l) => l.id === row.locationId) ?? null;
  if (key === "item") return db.items.find((i) => i.id === row.itemId) ?? null;
  if (key === "project") return row.project ?? null;
  return row[key] ?? null;
};

/** Includes as Prisma resolves them: every relation is loaded from its table, whatever organisation it is. */
const withRelations = (balance) => ({
  ...balance,
  warehouse: relationOf(balance, "warehouse"),
  location: relationOf(balance, "location"),
  item: relationOf(balance, "item"),
});

const itemWithBalances = (item, include) => {
  if (!item) return null;
  const spec = include?.balances;
  const balances = db.balances.filter((b) => b.itemId === item.id && (!spec?.where || matches(b, spec.where))).map(withRelations);
  return { ...item, balances, preferredSupplier: item.preferredSupplier ?? null };
};

const mockPrisma = {
  $transaction: (fn) => fn(mockPrisma),
  $queryRaw: jest.fn(async () => []),
  inventoryItem: {
    findFirst: jest.fn(async ({ where, include }) => itemWithBalances(db.items.find((row) => matches(row, where)), include)),
    findMany: jest.fn(async ({ where, include }) => db.items.filter((row) => matches(row, where)).map((row) => itemWithBalances(row, include))),
  },
  warehouse: {
    findFirst: jest.fn(async ({ where }) => db.warehouses.find((row) => matches(row, where)) ?? null),
    findMany: jest.fn(async ({ where, include }) =>
      db.warehouses.filter((row) => matches(row, where)).map((warehouse) => ({
        ...warehouse,
        balances: db.balances.filter((b) => b.warehouseId === warehouse.id && (!include?.balances?.where || matches(b, include.balances.where))).map(withRelations),
      })),
    ),
  },
  warehouseLocation: { findFirst: jest.fn(async ({ where }) => db.locations.find((row) => matches(row, where)) ?? null) },
  stockBalance: {
    findMany: jest.fn(async ({ where, orderBy }) => {
      const rows = db.balances.filter((row) => matches(row, where));
      return orderBy?.[0]?.onHand === "desc" ? [...rows].sort((a, b) => b.onHand - a.onHand) : rows;
    }),
    findFirst: jest.fn(async ({ where }) => db.balances.find((b) => b.itemId === where.itemId && b.warehouseId === where.warehouseId && (b.locationId ?? null) === (where.locationId ?? null)) ?? null),
    create: jest.fn(async ({ data }) => {
      const row = { id: `bal-${db.balances.length + 1}`, onHand: 0, reserved: 0, inTransit: 0, damaged: 0, quarantined: 0, locationId: null, ...data };
      db.balances.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }) => Object.assign(db.balances.find((b) => b.id === where.id), data)),
  },
  stockTransaction: {
    create: jest.fn(async ({ data }) => {
      const row = { id: `txn-${db.transactions.length + 1}`, ...data };
      db.transactions.push(row);
      return row;
    }),
    findMany: jest.fn(async ({ where }) =>
      db.transactions.filter((row) => matches(row, where)).map((row) => ({ ...row, item: relationOf(row, "item"), warehouse: relationOf(row, "warehouse"), location: relationOf(row, "location") })),
    ),
  },
  stockTransfer: {
    findMany: jest.fn(async ({ where, include }) =>
      db.transfers.filter((row) => matches(row, where)).map((transfer) => ({
        ...transfer,
        fromWarehouse: db.warehouses.find((w) => w.id === transfer.fromWarehouseId) ?? null,
        toWarehouse: db.warehouses.find((w) => w.id === transfer.toWarehouseId) ?? null,
        lines: transfer.lines.filter((line) => !include?.lines?.where || matches(line, include.lines.where)).map((line) => ({ ...line, item: relationOf(line, "item") })),
      })),
    ),
  },
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../cost-ledger.service", () => ({ post: jest.fn(async () => null) }));

const service = require("../inventory.service");

const seed = () => {
  db.items = [
    { id: "item-1", orgId: ORG, sku: "CEM", name: "Cement", unit: "bag", averageCost: 10, reorderLevel: 0, minStock: 0, maxStock: null, status: "active", projectId: null, preferredSupplierId: null },
  ];
  db.warehouses = [
    { id: "wh-1", orgId: ORG, code: "SITE", name: "Site store", kind: "site", projectId: null, status: "active" },
    { id: "wh-theirs", orgId: OTHER, code: "THEIRS", name: "Their store CANARY-OTHER", kind: "site", projectId: null, status: "active" },
  ];
  db.locations = [
    { id: "bin-own", orgId: ORG, warehouseId: "wh-1", code: "B-OWN", name: "Own bin", kind: "bin", path: "bin-own" },
    { id: "bin-theirs", orgId: OTHER, warehouseId: "wh-theirs", code: "B-THEIRS", name: "Their bin CANARY-OTHER", kind: "bin", path: "bin-theirs" },
  ];
  // Three positions of this organisation's item in its own store: at the
  // warehouse root, in its own bin, and — the residue — in the other company's bin.
  db.balances = [
    { id: "bal-root", orgId: ORG, itemId: "item-1", warehouseId: "wh-1", locationId: null, onHand: 5, reserved: 0, inTransit: 0, damaged: 0, quarantined: 0 },
    { id: "bal-own-bin", orgId: ORG, itemId: "item-1", warehouseId: "wh-1", locationId: "bin-own", onHand: 3, reserved: 0, inTransit: 0, damaged: 0, quarantined: 0 },
    { id: "bal-their-bin", orgId: ORG, itemId: "item-1", warehouseId: "wh-1", locationId: "bin-theirs", onHand: 10, reserved: 0, inTransit: 0, damaged: 0, quarantined: 0 },
  ];
  db.transactions = [];
  db.transfers = [];
};

const FOREIGN = /bin-theirs|B-THEIRS|CANARY-OTHER|wh-theirs|item-theirs/;

beforeEach(() => {
  jest.clearAllMocks();
  seed();
});

describe("CERT-2 — inventory reads serve nothing a stored foreign reference points at", () => {
  it("the scan shows only the organisation's own positions: the one in another company's bin is neither listed nor counted", async () => {
    const answer = await service.findByCode({ orgId: ORG, code: "CEM" });
    expect(answer.stock.map((row) => row.locationId)).toEqual([null, "bin-own"]);
    expect(answer.item.onHand).toBe(8);
    expect(JSON.stringify(answer)).not.toMatch(FOREIGN);
  });

  it("the item and the item list count the same own positions", async () => {
    const one = await service.getItem({ orgId: ORG, itemId: "item-1" });
    expect(one.onHand).toBe(8);
    const { items } = await service.listItems({ orgId: ORG });
    expect(items[0].onHand).toBe(8);
    expect(JSON.stringify({ one, items })).not.toMatch(FOREIGN);
  });

  it("a position in another company's warehouse, or a balance row of another company, is not counted either", async () => {
    db.balances.push(
      { id: "bal-their-store", orgId: ORG, itemId: "item-1", warehouseId: "wh-theirs", locationId: null, onHand: 100, reserved: 0, inTransit: 0, damaged: 0, quarantined: 0 },
      { id: "bal-their-row", orgId: OTHER, itemId: "item-1", warehouseId: "wh-1", locationId: null, onHand: 1000, reserved: 0, inTransit: 0, damaged: 0, quarantined: 0 },
    );
    const answer = await service.findByCode({ orgId: ORG, code: "CEM" });
    expect(answer.item.onHand).toBe(8);
    expect(answer.stock.map((row) => row.warehouseId)).toEqual(["wh-1", "wh-1"]);
    expect(JSON.stringify(answer)).not.toMatch(FOREIGN);
  });

  it("a preferred supplier that is not the organisation's is not named", async () => {
    db.items[0] = { ...db.items[0], preferredSupplierId: "sup-theirs", preferredSupplier: { name: "Their supplier CANARY-OTHER", project: { orgId: OTHER } } };
    const theirs = await service.getItem({ orgId: ORG, itemId: "item-1" });
    expect(theirs).toMatchObject({ preferredSupplierId: null, preferredSupplier: null });
    db.items[0] = { ...db.items[0], preferredSupplierId: "sup-own", preferredSupplier: { name: "Own supplier", project: { orgId: ORG } } };
    const own = await service.getItem({ orgId: ORG, itemId: "item-1" });
    expect(own).toMatchObject({ preferredSupplierId: "sup-own", preferredSupplier: "Own supplier" });
  });

  it("the ledger keeps the organisation's movement but blanks the bin, warehouse or item that is not its own", async () => {
    db.items.push({ id: "item-theirs", orgId: OTHER, sku: "THEIRS", name: "Their item CANARY-OTHER", unit: "nr" });
    db.transactions = [
      { id: "txn-own", orgId: ORG, itemId: "item-1", warehouseId: "wh-1", locationId: "bin-own", type: "receipt", quantity: 3, occurredAt: new Date("2026-10-01") },
      { id: "txn-their-bin", orgId: ORG, itemId: "item-1", warehouseId: "wh-1", locationId: "bin-theirs", type: "receipt", quantity: 1, occurredAt: new Date("2026-10-02") },
      { id: "txn-their-store", orgId: ORG, itemId: "item-theirs", warehouseId: "wh-theirs", locationId: null, type: "receipt", quantity: 1, occurredAt: new Date("2026-10-03") },
    ];
    const { items } = await service.listTransactions({ orgId: ORG });
    const byId = Object.fromEntries(items.map((row) => [row.id, row]));
    expect(byId["txn-own"]).toMatchObject({ itemId: "item-1", warehouseId: "wh-1", warehouse: "Site store", locationId: "bin-own", location: "B-OWN" });
    expect(byId["txn-their-bin"]).toMatchObject({ itemId: "item-1", warehouseId: "wh-1", locationId: null, location: null });
    expect(byId["txn-their-store"]).toMatchObject({ itemId: null, warehouseId: null, warehouse: null, locationId: null });
    expect(JSON.stringify(items)).not.toMatch(FOREIGN);
  });

  it("a transfer keeps its own lines and blanks a warehouse or line item that is not the organisation's", async () => {
    db.items.push({ id: "item-theirs", orgId: OTHER, sku: "THEIRS", name: "Their item CANARY-OTHER", unit: "nr" });
    db.transfers = [{
      id: "trf-1", orgId: ORG, ref: "TRF-1", status: "draft", fromWarehouseId: "wh-1", toWarehouseId: "wh-theirs",
      lines: [
        { id: "line-own", orgId: ORG, itemId: "item-1", quantity: 2 },
        { id: "line-their-item", orgId: ORG, itemId: "item-theirs", quantity: 1 },
        { id: "line-their-row", orgId: OTHER, itemId: "item-1", quantity: 9 },
      ],
    }];
    const { items: [transfer] } = await service.listTransfers({ orgId: ORG });
    expect(transfer).toMatchObject({ fromWarehouseId: "wh-1", fromWarehouse: "Site store", toWarehouseId: null, toWarehouse: null });
    expect(transfer.lines.map((line) => [line.id, line.itemId, line.sku])).toEqual([["line-own", "item-1", "CEM"], ["line-their-item", null, null]]);
    expect(JSON.stringify(transfer)).not.toMatch(FOREIGN);
  });

  it("the summary values only the organisation's own positions of its own items", async () => {
    db.items.push({ id: "item-theirs", orgId: OTHER, sku: "THEIRS", name: "Their item", unit: "nr", averageCost: 1000, status: "active" });
    db.balances.push({ id: "bal-their-item", orgId: ORG, itemId: "item-theirs", warehouseId: "wh-1", locationId: null, onHand: 7, reserved: 0, inTransit: 0, damaged: 0, quarantined: 0 });
    const summary = await service.getSummary({ orgId: ORG });
    expect(summary.totalValue).toBe(80); // 8 own on hand at 10.00
    expect(summary.byWarehouse).toEqual([expect.objectContaining({ id: "wh-1", value: 80, lines: 2 })]);
  });

  it("a warehouse's location count is of the organisation's own locations", async () => {
    mockPrisma.warehouse.findMany.mockImplementationOnce(async () => []);
    await service.listWarehouses({ orgId: ORG });
    expect(mockPrisma.warehouse.findMany.mock.calls.at(-1)[0].include._count).toEqual({ select: { locations: { where: { orgId: ORG } } } });
  });
});

describe("CERT-2 — a draw or a reservation touches only the organisation's own positions", () => {
  it("a warehouse-wide write-off draws from its own positions and never names another company's bin", async () => {
    const { movements } = await service.adjustStock({ orgId: ORG, user: USER, type: "damage", payload: { itemId: "item-1", warehouseId: "wh-1", quantity: 8 } });
    expect(movements.map((row) => row.locationId).sort()).toEqual(["bin-own", null].sort());
    expect(db.transactions.some((row) => row.locationId === "bin-theirs")).toBe(false);
    expect(db.balances.find((b) => b.id === "bal-their-bin").onHand).toBe(10);
  });

  it("what sits in another company's bin is not there to draw: asking for more than the own positions hold is refused and nothing moves", async () => {
    await expect(
      service.adjustStock({ orgId: ORG, user: USER, type: "damage", payload: { itemId: "item-1", warehouseId: "wh-1", quantity: 9 } }),
    ).rejects.toMatchObject({ status: 409, code: "INV_INSUFFICIENT_STOCK" });
    expect(db.transactions).toHaveLength(0);
    expect(JSON.stringify(db.balances.map((b) => b.onHand))).toBe(JSON.stringify([5, 3, 10]));
  });

  it("a warehouse-wide reservation is held against, and reported from, the own positions only", async () => {
    await expect(
      service.adjustReservation({ orgId: ORG, user: USER, payload: { itemId: "item-1", warehouseId: "wh-1", quantity: 9 } }),
    ).rejects.toMatchObject({ status: 409, code: "INV_RESERVATION_OVER_STOCK" });
    const held = await service.adjustReservation({ orgId: ORG, user: USER, payload: { itemId: "item-1", warehouseId: "wh-1", quantity: 8 } });
    expect(held).toMatchObject({ onHand: 8, reserved: 8, available: 0 });
    expect(db.balances.find((b) => b.id === "bal-their-bin").reserved).toBe(0);
  });
});
