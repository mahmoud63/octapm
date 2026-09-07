/**
 * The stock ledger.
 *
 * These exercise the arithmetic that a material variance claim is argued from:
 * that a balance always matches the movements that produced it, that weighted
 * average cost moves only on receipt, and that stock cannot be issued that is
 * not there.
 *
 * Prisma is faked with an in-memory store rather than mocked call-by-call,
 * because the thing worth testing is the resulting balance, not which query
 * was sent.
 */

const store = {
  items: new Map(),
  warehouses: new Map(),
  locations: new Map(),
  balances: [],
  transactions: [],
  transfers: new Map(),
  transferLines: [],
  ledger: [],
  costRecords: [],
};

let nextId = 1;
const id = (prefix) => `${prefix}-${nextId++}`;
// structuredClone, not a JSON round trip: Prisma hands back Date objects and a
// fake that flattens them to strings would test the wrong thing.
const clone = (value) => (value == null ? value : structuredClone(value));

const matches = (row, where = {}) =>
  Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (value && typeof value === "object" && "not" in value) return row[key] !== value.not;
    return row[key] === value;
  });

const mockPrisma = {
  $transaction: (fn) => fn(mockPrisma),

  inventoryItem: {
    findFirst: jest.fn(async ({ where }) => {
      for (const item of store.items.values()) if (matches(item, where)) return clone(item);
      return null;
    }),
    update: jest.fn(async ({ where, data }) => {
      const item = store.items.get(where.id);
      Object.assign(item, data);
      return clone(item);
    }),
  },

  warehouse: {
    findFirst: jest.fn(async ({ where }) => {
      for (const w of store.warehouses.values()) if (matches(w, where)) return clone(w);
      return null;
    }),
  },

  warehouseLocation: {
    findFirst: jest.fn(async ({ where }) => {
      for (const l of store.locations.values()) if (matches(l, where)) return clone(l);
      return null;
    }),
  },

  stockBalance: {
    findMany: jest.fn(async ({ where, orderBy }) => {
      let rows = store.balances.filter(
        (b) => b.itemId === where.itemId && b.warehouseId === where.warehouseId
      );
      if (orderBy?.[0]?.onHand === "desc") {
        rows = [...rows].sort((a, b) => b.onHand - a.onHand);
      }
      return rows.map(clone);
    }),
    findFirst: jest.fn(async ({ where }) => {
      const found = store.balances.find(
        (b) =>
          b.itemId === where.itemId &&
          b.warehouseId === where.warehouseId &&
          (b.locationId ?? null) === (where.locationId ?? null)
      );
      return found ? clone(found) : null;
    }),
    create: jest.fn(async ({ data }) => {
      const row = {
        id: id("bal"),
        onHand: 0,
        reserved: 0,
        inTransit: 0,
        damaged: 0,
        quarantined: 0,
        locationId: null,
        ...data,
      };
      store.balances.push(row);
      return clone(row);
    }),
    update: jest.fn(async ({ where, data }) => {
      const row = store.balances.find((b) => b.id === where.id);
      Object.assign(row, data);
      return clone(row);
    }),
  },

  stockTransaction: {
    create: jest.fn(async ({ data }) => {
      const row = { id: id("txn"), ...data };
      store.transactions.push(row);
      return clone(row);
    }),
  },

  // An issue posts consumption to the cost ledger (OCTA-FIN-LEDGER-059).
  costLedgerEntry: {
    findFirst: jest.fn(async ({ where }) =>
      clone(store.ledger.find((row) => row.orgId === where.orgId && row.sourceKey === where.sourceKey) || null)
    ),
    findMany: jest.fn(async ({ where = {} } = {}) =>
      store.ledger
        .filter((row) => Object.entries(where).every(([k, v]) => (v && typeof v === "object" ? true : row[k] === v)))
        .map(clone)
    ),
    create: jest.fn(async ({ data }) => {
      if (store.ledger.some((row) => row.orgId === data.orgId && row.sourceKey === data.sourceKey)) {
        const error = new Error("Unique constraint failed");
        error.code = "P2002";
        throw error;
      }
      const row = { id: id("cle"), ...data };
      store.ledger.push(row);
      return clone(row);
    }),
  },
  budgetLine: {
    findFirst: jest.fn(async () => null),
    update: jest.fn(async () => ({})),
  },
  costRecord: {
    findFirst: jest.fn(async ({ where }) =>
      clone(store.costRecords.find((row) => row.projectId === where.projectId && row.activityId === where.activityId) || null)
    ),
    update: jest.fn(async ({ where, data }) => {
      const row = store.costRecords.find((r) => r.id === where.id);
      if (data.actual?.increment !== undefined) row.actual = (row.actual || 0) + data.actual.increment;
      if (data.actualThroughDate) row.actualThroughDate = data.actualThroughDate;
      return clone(row);
    }),
    create: jest.fn(async ({ data }) => {
      const row = { id: id("cr"), ...data };
      store.costRecords.push(row);
      return clone(row);
    }),
  },
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

const service = require("../inventory.service");

const ORG = "org-1";
const USER = { id: "user-store", role: "warehouse", name: "Jonas Weber" };

const seedItem = (over = {}) => {
  const item = {
    id: id("item"),
    orgId: ORG,
    sku: "CEM-42.5N",
    name: "Cement OPC 42.5N",
    unit: "bag",
    averageCost: 0,
    unitCost: 0,
    lastPurchasePrice: null,
    reorderLevel: 0,
    minStock: 0,
    maxStock: null,
    status: "active",
    ...over,
  };
  store.items.set(item.id, item);
  return item;
};

const seedWarehouse = (over = {}) => {
  const warehouse = { id: id("wh"), orgId: ORG, code: "MAIN", name: "Main store", ...over };
  store.warehouses.set(warehouse.id, warehouse);
  return warehouse;
};

const balanceOf = (itemId, warehouseId) =>
  store.balances.find((b) => b.itemId === itemId && b.warehouseId === warehouseId);

describe("inventory stock ledger", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.items.clear();
    store.warehouses.clear();
    store.locations.clear();
    store.balances.length = 0;
    store.transactions.length = 0;
    store.ledger.length = 0;
    store.costRecords.length = 0;
    nextId = 1;
  });

  it("a receipt raises the balance and records what it did", async () => {
    const item = seedItem();
    const warehouse = seedWarehouse();

    const txn = await service.receiveStock({
      orgId: ORG,
      user: USER,
      payload: { itemId: item.id, warehouseId: warehouse.id, quantity: 500, unitCost: 6.4 },
    });

    expect(balanceOf(item.id, warehouse.id).onHand).toBe(500);
    expect(txn.type).toBe("receipt");
    expect(txn.quantity).toBe(500);
    expect(txn.balanceAfter).toBe(500);
    expect(txn.value).toBe(3200);
  });

  it("blends the weighted average across two receipts at different prices", async () => {
    const item = seedItem();
    const warehouse = seedWarehouse();

    await service.receiveStock({
      orgId: ORG,
      user: USER,
      payload: { itemId: item.id, warehouseId: warehouse.id, quantity: 100, unitCost: 10 },
    });
    await service.receiveStock({
      orgId: ORG,
      user: USER,
      payload: { itemId: item.id, warehouseId: warehouse.id, quantity: 100, unitCost: 20 },
    });

    // 100 at 10 plus 100 at 20 is 200 at 15, and the buyer still sees 20 paid last.
    expect(Number(store.items.get(item.id).averageCost)).toBe(15);
    expect(Number(store.items.get(item.id).lastPurchasePrice)).toBe(20);
    expect(balanceOf(item.id, warehouse.id).onHand).toBe(200);
  });

  it("an issue leaves at the average, and does not move it", async () => {
    const item = seedItem();
    const warehouse = seedWarehouse();
    await service.receiveStock({
      orgId: ORG,
      user: USER,
      payload: { itemId: item.id, warehouseId: warehouse.id, quantity: 100, unitCost: 10 },
    });
    await service.receiveStock({
      orgId: ORG,
      user: USER,
      payload: { itemId: item.id, warehouseId: warehouse.id, quantity: 100, unitCost: 20 },
    });

    const { movements } = await service.issueStock({
      orgId: ORG,
      user: USER,
      payload: {
        itemId: item.id,
        warehouseId: warehouse.id,
        quantity: 40,
        activityId: "activity-1",
        projectId: "project-1",
      },
    });

    expect(movements).toHaveLength(1);
    expect(movements[0].quantity).toBe(-40);
    expect(movements[0].value).toBe(600); // 40 at the blended 15
    expect(movements[0].activityId).toBe("activity-1");
    expect(balanceOf(item.id, warehouse.id).onHand).toBe(160);
    expect(Number(store.items.get(item.id).averageCost)).toBe(15);
  });

  it("issuing from a warehouse draws across bins, fullest first", async () => {
    const item = seedItem();
    const warehouse = seedWarehouse();

    // Two bins in the same store, as a real shelf layout produces.
    await service.receiveStock({
      orgId: ORG,
      user: USER,
      payload: { itemId: item.id, warehouseId: warehouse.id, locationId: null, quantity: 40, unitCost: 5 },
    });
    store.locations.set("bin-a", { id: "bin-a", orgId: ORG, warehouseId: warehouse.id });
    await service.receiveStock({
      orgId: ORG,
      user: USER,
      payload: { itemId: item.id, warehouseId: warehouse.id, locationId: "bin-a", quantity: 100, unitCost: 5 },
    });

    // 120 asked for, 100 in the fullest bin and 40 loose: both are touched,
    // and the ledger says how much came from where.
    const { movements } = await service.issueStock({
      orgId: ORG,
      user: USER,
      payload: {
        itemId: item.id,
        warehouseId: warehouse.id,
        quantity: 120,
        costCodeId: "cc-1",
      },
    });

    expect(movements).toHaveLength(2);
    expect(movements[0].locationId).toBe("bin-a");
    expect(movements[0].quantity).toBe(-100);
    expect(movements[1].quantity).toBe(-20);
    expect(
      store.balances
        .filter((b) => b.itemId === item.id)
        .reduce((sum, b) => sum + b.onHand, 0)
    ).toBe(20);
  });

  it("counts the whole warehouse before refusing an issue", async () => {
    const item = seedItem();
    const warehouse = seedWarehouse();
    store.locations.set("bin-a", { id: "bin-a", orgId: ORG, warehouseId: warehouse.id });
    await service.receiveStock({
      orgId: ORG,
      user: USER,
      payload: { itemId: item.id, warehouseId: warehouse.id, locationId: "bin-a", quantity: 30, unitCost: 1 },
    });

    // The stock is in a bin, not at the warehouse root: an issue that named no
    // bin used to look only at the root and refuse with "only 0 on hand".
    await expect(
      service.issueStock({
        orgId: ORG,
        user: USER,
        payload: { itemId: item.id, warehouseId: warehouse.id, quantity: 50, costCodeId: "cc-1" },
      })
    ).rejects.toThrow(
      expect.objectContaining({ status: 409, code: "INV_INSUFFICIENT_STOCK" })
    );

    const { movements } = await service.issueStock({
      orgId: ORG,
      user: USER,
      payload: { itemId: item.id, warehouseId: warehouse.id, quantity: 30, costCodeId: "cc-1" },
    });
    expect(movements[0].locationId).toBe("bin-a");
  });

  it("refuses to issue stock that is not there", async () => {
    const item = seedItem();
    const warehouse = seedWarehouse();
    await service.receiveStock({
      orgId: ORG,
      user: USER,
      payload: { itemId: item.id, warehouseId: warehouse.id, quantity: 10, unitCost: 5 },
    });

    await expect(
      service.issueStock({
        orgId: ORG,
        user: USER,
        payload: {
          itemId: item.id,
          warehouseId: warehouse.id,
          quantity: 25,
          activityId: "activity-1",
        },
      })
    ).rejects.toThrow(
      expect.objectContaining({ status: 409, code: "INV_INSUFFICIENT_STOCK" })
    );

    // Nothing moved, and nothing was written.
    expect(balanceOf(item.id, warehouse.id).onHand).toBe(10);
    expect(store.transactions.filter((t) => t.type === "issue")).toHaveLength(0);
  });

  it("will not issue without somewhere for the cost to land", async () => {
    const item = seedItem();
    const warehouse = seedWarehouse();

    await expect(
      service.issueStock({
        orgId: ORG,
        user: USER,
        payload: { itemId: item.id, warehouseId: warehouse.id, quantity: 1 },
      })
    ).rejects.toThrow(
      expect.objectContaining({ status: 400, code: "INV_NO_COST_TARGET" })
    );
  });

  it("receives damaged goods and writes them off in the same breath", async () => {
    const item = seedItem();
    const warehouse = seedWarehouse();

    await service.receiveStock({
      orgId: ORG,
      user: USER,
      payload: {
        itemId: item.id,
        warehouseId: warehouse.id,
        quantity: 100,
        unitCost: 4,
        damagedQty: 6,
      },
    });

    const balance = balanceOf(item.id, warehouse.id);
    // 100 arrived, 6 of them broken: 94 usable and 6 on the damage account, so
    // the delivery note and the ledger agree on what turned up.
    expect(balance.onHand).toBe(94);
    expect(balance.damaged).toBe(6);
  });

  it("quarantines stock and releases it back", async () => {
    const item = seedItem();
    const warehouse = seedWarehouse();
    await service.receiveStock({
      orgId: ORG,
      user: USER,
      payload: { itemId: item.id, warehouseId: warehouse.id, quantity: 50, unitCost: 2 },
    });

    await service.adjustStock({
      orgId: ORG,
      user: USER,
      type: "quarantine",
      payload: { itemId: item.id, warehouseId: warehouse.id, quantity: 20 },
    });
    expect(balanceOf(item.id, warehouse.id)).toMatchObject({ onHand: 30, quarantined: 20 });

    await service.adjustStock({
      orgId: ORG,
      user: USER,
      type: "release",
      payload: { itemId: item.id, warehouseId: warehouse.id, quantity: 20 },
    });
    expect(balanceOf(item.id, warehouse.id)).toMatchObject({ onHand: 50, quarantined: 0 });
  });

  it("insists an adjustment says why", async () => {
    const item = seedItem();
    const warehouse = seedWarehouse();

    await expect(
      service.adjustStock({
        orgId: ORG,
        user: USER,
        type: "adjust",
        payload: { itemId: item.id, warehouseId: warehouse.id, quantity: -5 },
      })
    ).rejects.toThrow(
      expect.objectContaining({ status: 400, code: "INV_ADJUST_REASON" })
    );
  });

  it("every balance can be proved from its movements", async () => {
    const item = seedItem();
    const warehouse = seedWarehouse();

    await service.receiveStock({
      orgId: ORG,
      user: USER,
      payload: { itemId: item.id, warehouseId: warehouse.id, quantity: 200, unitCost: 3 },
    });
    await service.issueStock({
      orgId: ORG,
      user: USER,
      payload: {
        itemId: item.id,
        warehouseId: warehouse.id,
        quantity: 30,
        costCodeId: "cc-1",
      },
    });
    await service.adjustStock({
      orgId: ORG,
      user: USER,
      type: "return",
      payload: { itemId: item.id, warehouseId: warehouse.id, quantity: 5 },
    });
    await service.adjustStock({
      orgId: ORG,
      user: USER,
      type: "adjust",
      payload: {
        itemId: item.id,
        warehouseId: warehouse.id,
        quantity: -2,
        notes: "Broken bag found during a walk round",
      },
    });

    const ledgerTotal = store.transactions
      .filter((t) => t.itemId === item.id)
      .reduce((sum, t) => sum + t.quantity, 0);

    expect(balanceOf(item.id, warehouse.id).onHand).toBe(173);
    expect(ledgerTotal).toBe(173);
  });

  it("keeps another organisation's item out of reach", async () => {
    const item = seedItem({ orgId: "org-other" });
    const warehouse = seedWarehouse();

    await expect(
      service.receiveStock({
        orgId: ORG,
        user: USER,
        payload: { itemId: item.id, warehouseId: warehouse.id, quantity: 1, unitCost: 1 },
      })
    ).rejects.toThrow(expect.objectContaining({ status: 404, code: "ITEM_NOT_FOUND" }));
  });
});
