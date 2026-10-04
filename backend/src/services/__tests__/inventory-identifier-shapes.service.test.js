/**
 * CERT-2: what the stock movements do with an identifier that is not one
 * string, with the references a direct movement names, with a price that is
 * not a number, and which positions the item's average blends against.
 *
 *   - An item, warehouse or bin sent as ["<id>"] reached the lookup and
 *     failed with a 500 — the organisation's own id as much as another
 *     company's — and {"not":"x"} matched any record. Any other shape is now
 *     found nowhere: the same answer as an id nobody holds, nothing written.
 *   - A direct movement's project, activity, cost code, BOQ row, commitment,
 *     work location, purchase-order line and delivery line are each one
 *     string and the organisation's own (the last three were stored as
 *     given); a transfer's or a count's provenance is never the caller's (a
 *     receipt naming another company's transfer was stored with it).
 *   - A unit cost of "abc" became NaN and reset the item's average to 0.
 *   - The average blended against a balance this organisation holds in
 *     another company's bin.
 *
 * The fake database answers `where` the way Prisma does for the shapes these
 * services send, and throws — as Prisma does — on an array, a symbol or an
 * unknown filter where an identifier belongs, so a value that reaches a
 * lookup unnormalised fails the test the way it failed the product.
 */

const ORG = "org-1";
const OTHER = "org-2";
const USER = { id: "user-store", role: "warehouse" };
const NOWHERE = "00000000-0000-4000-8000-000000000000";

const db = {};
const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
const RELATIONS = new Set(["warehouse", "location", "item", "project", "order"]);

const matches = (row, where = {}) =>
  Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === "OR") return value.some((clause) => matches(row, clause));
    if (key === "AND") return value.every((clause) => matches(row, clause));
    if (value === null) return row[key] == null;
    if (typeof value === "symbol" || Array.isArray(value) || typeof value === "boolean") throw new Error(`Invalid value for ${key}`);
    if (isPlain(value)) {
      if ("in" in value) return value.in.includes(row[key]);
      if ("not" in value) return row[key] !== value.not;
      if (!RELATIONS.has(key)) throw new Error(`Unknown filter on ${key}`);
      const related = relationOf(row, key);
      return Boolean(related) && matches(related, value);
    }
    return row[key] === value;
  });

const relationOf = (row, key) => {
  if (key === "warehouse") return db.warehouses.find((w) => w.id === row.warehouseId) ?? null;
  if (key === "location") return db.locations.find((l) => l.id === row.locationId) ?? null;
  if (key === "item") return db.items.find((i) => i.id === row.itemId) ?? null;
  if (key === "project") return db.projects.find((p) => p.id === row.projectId) ?? null;
  if (key === "order") return null;
  return null;
};

const table = (name) => ({
  findFirst: jest.fn(async ({ where }) => db[name].find((row) => matches(row, where)) ?? null),
  findMany: jest.fn(async ({ where }) => db[name].filter((row) => matches(row, where))),
});

const mockPrisma = {
  // A refused movement is rolled back, as the database rolls it back.
  $transaction: async (fn) => {
    const snapshot = structuredClone(db);
    try {
      return await fn(mockPrisma);
    } catch (error) {
      Object.assign(db, snapshot);
      throw error;
    }
  },
  $queryRaw: jest.fn(async () => []),
  inventoryItem: {
    ...table("items"),
    update: jest.fn(async ({ where, data }) => Object.assign(db.items.find((i) => i.id === where.id), data)),
  },
  warehouse: table("warehouses"),
  warehouseLocation: table("locations"),
  project: table("projects"),
  activity: table("activities"),
  costCode: table("costCodes"),
  boqItem: table("boqItems"),
  commitment: table("commitments"),
  location: table("workLocations"),
  procurementPoLine: table("poLines"),
  deliveryReceiptLine: table("receiptLines"),
  stockTransfer: {
    ...table("transfers"),
    create: jest.fn(async ({ data }) => {
      const row = { id: `trf-${db.transfers.length + 1}`, ...data, lines: data.lines.create };
      db.transfers.push(row);
      return { ...row, fromWarehouse: null, toWarehouse: null };
    }),
  },
  stockBalance: {
    findMany: jest.fn(async ({ where, orderBy }) => {
      const rows = db.balances.filter((row) => matches(row, where));
      return orderBy?.[0]?.onHand === "desc" ? [...rows].sort((a, b) => b.onHand - a.onHand) : rows;
    }),
    findFirst: jest.fn(async ({ where }) => db.balances.find((row) => matches(row, where)) ?? null),
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
    findFirst: jest.fn(async () => null),
  },
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../cost-ledger.service", () => ({ post: jest.fn(async () => null) }));

const service = require("../inventory.service");

const seed = () => {
  db.projects = [{ id: "project-1", orgId: ORG }, { id: "project-theirs", orgId: OTHER }];
  db.items = [
    { id: "item-1", orgId: ORG, sku: "CEM", name: "Cement", unit: "bag", averageCost: 10, unitCost: 10, lastPurchasePrice: 10, projectId: null },
    { id: "item-2", orgId: ORG, sku: "SND", name: "Sand", unit: "t", averageCost: 4, projectId: null },
    { id: "item-theirs", orgId: OTHER, sku: "THEIRS", name: "Their item", unit: "nr", averageCost: 1, projectId: null },
  ];
  db.warehouses = [
    { id: "wh-1", orgId: ORG, code: "SITE", name: "Site store", projectId: null },
    { id: "wh-2", orgId: ORG, code: "YARD", name: "Yard", projectId: null },
    { id: "wh-theirs", orgId: OTHER, code: "THEIRS", name: "Their store", projectId: null },
  ];
  db.locations = [
    { id: "bin-own", orgId: ORG, warehouseId: "wh-1", code: "B-OWN" },
    { id: "bin-theirs", orgId: OTHER, warehouseId: "wh-theirs", code: "B-THEIRS" },
  ];
  db.activities = [{ id: "act-1", projectId: "project-1", project: { orgId: ORG } }, { id: "act-theirs", projectId: "project-theirs" }];
  db.costCodes = [{ id: "cc-1", orgId: ORG }, { id: "cc-theirs", orgId: OTHER }];
  db.boqItems = [{ id: "boq-1", projectId: "project-1" }, { id: "boq-theirs", projectId: "project-theirs" }];
  db.commitments = [{ id: "com-1", orgId: ORG, projectId: "project-1" }, { id: "com-theirs", orgId: OTHER, projectId: "project-theirs" }];
  db.workLocations = [{ id: "loc-1", orgId: ORG, projectId: "project-1" }, { id: "loc-theirs", orgId: OTHER, projectId: "project-theirs" }];
  db.poLines = [{ id: "pol-1", projectId: "project-1" }, { id: "pol-theirs", projectId: "project-theirs" }];
  db.receiptLines = [{ id: "grl-1", projectId: "project-1" }, { id: "grl-theirs", projectId: "project-theirs" }];
  // The organisation's item in its own store: at the root, in its own bin,
  // and — residue from before the bin guard — in the other company's bin.
  db.balances = [
    { id: "bal-root", orgId: ORG, itemId: "item-1", warehouseId: "wh-1", locationId: null, onHand: 5, reserved: 0, inTransit: 0, damaged: 0, quarantined: 0 },
    { id: "bal-own-bin", orgId: ORG, itemId: "item-1", warehouseId: "wh-1", locationId: "bin-own", onHand: 3, reserved: 0, inTransit: 0, damaged: 0, quarantined: 0 },
    { id: "bal-their-bin", orgId: ORG, itemId: "item-1", warehouseId: "wh-1", locationId: "bin-theirs", onHand: 10, reserved: 0, inTransit: 0, damaged: 0, quarantined: 0 },
  ];
  db.transactions = [];
  db.transfers = [];
  // The ids the activity lookup resolves: the org filter is a relation filter on the project.
  db.activities = db.activities.map((row) => ({ ...row }));
};

const state = () => JSON.stringify({ balances: db.balances, transactions: db.transactions, items: db.items, transfers: db.transfers });
const answerOf = async (promise) => {
  try {
    await promise;
    return { ok: true };
  } catch (error) {
    if (!error.status) throw error; // a raw error (a 500) fails the test as it failed the product
    return { status: error.status, code: error.code, message: error.message };
  }
};
const SHAPES = (id) => [[id], [[id]], { id }, 12345, true, { not: "x" }];

beforeEach(() => {
  jest.clearAllMocks();
  seed();
});

describe("CERT-2 — an item, a warehouse or a bin of any other shape is found nowhere", () => {
  const doors = {
    receive: (payload) => service.receiveStock({ orgId: ORG, user: USER, payload: { quantity: 1, unitCost: 10, ...payload } }),
    issue: (payload) => service.issueStock({ orgId: ORG, user: USER, payload: { quantity: 1, costCodeId: "cc-1", ...payload } }),
    return: (payload) => service.adjustStock({ orgId: ORG, user: USER, type: "return", payload: { quantity: 1, projectId: "project-1", ...payload } }),
    adjust: (payload) => service.adjustStock({ orgId: ORG, user: USER, type: "adjust", payload: { quantity: 1, notes: "Count", ...payload } }),
    damage: (payload) => service.adjustStock({ orgId: ORG, user: USER, type: "damage", payload: { quantity: 1, ...payload } }),
    reserve: (payload) => service.adjustReservation({ orgId: ORG, user: USER, payload: { quantity: 1, ...payload } }),
  };
  const fields = [
    ["itemId", "item-1", "item-theirs"],
    ["warehouseId", "wh-1", "wh-theirs"],
    ["locationId", "bin-own", "bin-theirs"],
  ];

  for (const [door, send] of Object.entries(doors)) {
    for (const [field, own, theirs] of fields) {
      it(`${door}: ${field} wrapped or shaped — own, another company's or nowhere — answers as an id nobody holds, nothing written`, async () => {
        const base = { itemId: "item-1", warehouseId: "wh-1" };
        const nowhere = await answerOf(send({ ...base, [field]: NOWHERE }));
        expect(nowhere.status).toBe(404);
        const foreign = await answerOf(send({ ...base, [field]: theirs }));
        expect(foreign).toEqual(nowhere);
        const before = state();
        for (const id of [own, theirs, NOWHERE]) {
          for (const shaped of SHAPES(id)) {
            expect(await answerOf(send({ ...base, [field]: shaped }))).toEqual(nowhere);
          }
        }
        expect(state()).toBe(before);
        // The own id, as one string, is accepted.
        expect(await answerOf(send({ ...base, [field]: own }))).toEqual({ ok: true });
      });
    }
  }

  it("an item or a warehouse left out is found nowhere, not any record of the organisation", async () => {
    expect(await answerOf(doors.receive({ warehouseId: "wh-1" }))).toMatchObject({ status: 404, code: "ITEM_NOT_FOUND" });
    expect(await answerOf(doors.receive({ itemId: "item-1" }))).toMatchObject({ status: 404, code: "WAREHOUSE_NOT_FOUND" });
    expect(db.transactions).toHaveLength(0);
  });

  it("a transfer's warehouses and line items: any other shape answers as one nobody holds, and nothing is created", async () => {
    const send = (payload) => service.createTransfer({ orgId: ORG, user: USER, payload: { ref: "TRF-T", fromWarehouseId: "wh-1", toWarehouseId: "wh-2", lines: [{ itemId: "item-1", quantity: 1 }], ...payload } });
    const nowhereWh = await answerOf(send({ fromWarehouseId: NOWHERE }));
    expect(nowhereWh).toMatchObject({ status: 404, code: "WAREHOUSE_NOT_FOUND" });
    const nowhereItem = await answerOf(send({ lines: [{ itemId: NOWHERE, quantity: 1 }] }));
    expect(nowhereItem).toMatchObject({ status: 404, code: "ITEM_NOT_FOUND" });
    for (const id of ["wh-1", "wh-theirs", NOWHERE]) {
      for (const shaped of SHAPES(id)) {
        expect(await answerOf(send({ fromWarehouseId: shaped }))).toEqual(nowhereWh);
        expect(await answerOf(send({ toWarehouseId: shaped }))).toEqual(nowhereWh);
      }
    }
    for (const id of ["item-1", "item-theirs", NOWHERE]) {
      for (const shaped of SHAPES(id)) {
        // ["item-1"] used to be read as "item-1" and the line created with it.
        expect(await answerOf(send({ lines: [{ itemId: shaped, quantity: 1 }] }))).toEqual(nowhereItem);
      }
    }
    expect(db.transfers).toHaveLength(0);
    expect(await answerOf(send({}))).toEqual({ ok: true });
    expect(db.transfers[0].lines.map((line) => line.itemId)).toEqual(["item-1"]);
  });

  it("a transfer receipt's reported line that is not an object reports nothing: no 500", async () => {
    mockPrisma.stockTransfer.findFirst.mockResolvedValueOnce(null);
    expect(await answerOf(service.receiveTransfer({ orgId: ORG, user: USER, transferId: NOWHERE, payload: { lines: [null, "x", 12345] } }))).toMatchObject({ status: 404, code: "TRANSFER_NOT_FOUND" });
  });
});

describe("CERT-2 — what a direct movement names is one string and the organisation's own", () => {
  const references = [
    // [field, own, another company's, the code an id nobody holds gets]
    ["projectId", "project-1", "project-theirs", "PROJECT_NOT_FOUND"],
    ["activityId", "act-1", "act-theirs", "ACTIVITY_NOT_FOUND"],
    ["costCodeId", "cc-1", "cc-theirs", "COST_CODE_NOT_FOUND"],
    ["boqItemId", "boq-1", "boq-theirs", "BOQ_ITEM_NOT_FOUND"],
    ["commitmentId", "com-1", "com-theirs", "COMMITMENT_NOT_FOUND"],
    ["locationRefId", "loc-1", "loc-theirs", "LOCATION_NOT_FOUND"],
    ["poLineId", "pol-1", "pol-theirs", "PO_LINE_NOT_FOUND"],
    ["receiptLineId", "grl-1", "grl-theirs", "RECEIPT_LINE_NOT_FOUND"],
  ];
  const receive = (payload) => service.receiveStock({ orgId: ORG, user: USER, payload: { itemId: "item-1", warehouseId: "wh-1", quantity: 1, unitCost: 10, projectId: "project-1", ...payload } });

  for (const [field, own, theirs, code] of references) {
    it(`${field}: another company's, one nobody holds and any other shape get the same 404 ${code}; nothing written; the own one is stored`, async () => {
      const nowhere = await answerOf(receive({ [field]: NOWHERE }));
      expect(nowhere).toMatchObject({ status: 404, code });
      expect(await answerOf(receive({ [field]: theirs }))).toEqual(nowhere);
      for (const id of [own, theirs, NOWHERE]) {
        for (const shaped of SHAPES(id)) {
          const answer = await answerOf(receive({ [field]: shaped }));
          // A project of another shape beside a named activity is a mismatch, as a nowhere project is.
          expect(answer).toEqual(nowhere);
        }
      }
      expect(db.transactions).toHaveLength(0);
      expect(await answerOf(receive({ [field]: own }))).toEqual({ ok: true });
      expect(db.transactions.at(-1)[field]).toBe(own);
    });
  }

  it("an issue's activity or project of any other shape is refused as one nobody holds, nothing drawn", async () => {
    const issue = (payload) => service.issueStock({ orgId: ORG, user: USER, payload: { itemId: "item-1", warehouseId: "wh-1", quantity: 1, ...payload } });
    const nowhereActivity = await answerOf(issue({ activityId: NOWHERE }));
    expect(nowhereActivity).toMatchObject({ status: 404, code: "ACTIVITY_NOT_FOUND" });
    const nowhereProject = await answerOf(issue({ costCodeId: "cc-1", projectId: NOWHERE }));
    expect(nowhereProject).toMatchObject({ status: 404, code: "PROJECT_NOT_FOUND" });
    for (const id of ["act-1", "act-theirs", NOWHERE]) for (const shaped of SHAPES(id)) expect(await answerOf(issue({ activityId: shaped }))).toEqual(nowhereActivity);
    for (const id of ["project-1", "project-theirs", NOWHERE]) for (const shaped of SHAPES(id)) expect(await answerOf(issue({ costCodeId: "cc-1", projectId: shaped }))).toEqual(nowhereProject);
    expect(db.transactions).toHaveLength(0);
  });

  it("a direct movement never carries a transfer's or a count's provenance: own, another company's or nowhere, nothing of it is stored", async () => {
    for (const transferId of ["trf-own", "trf-theirs", NOWHERE]) {
      expect(await answerOf(receive({ transferId, countId: transferId, reversesId: transferId }))).toEqual({ ok: true });
    }
    expect(db.transactions).toHaveLength(3);
    expect(db.transactions.every((row) => row.transferId === null && row.countId === null && row.reversesId === undefined)).toBe(true);
    await service.adjustStock({ orgId: ORG, user: USER, type: "adjust", payload: { itemId: "item-1", warehouseId: "wh-1", quantity: 1, notes: "Count", transferId: "trf-theirs", countId: "cnt-theirs" } });
    expect(db.transactions.at(-1)).toMatchObject({ transferId: null, countId: null });
  });
});

describe("CERT-2 — a delivered price is a number of zero or more", () => {
  for (const unitCost of ["abc", Number.NaN, -1, "", [5], { not: "x" }]) {
    it(`postMovement refuses unit cost ${JSON.stringify(unitCost)} before anything moves; the item's prices are untouched`, async () => {
      const before = state();
      const item = db.items.find((row) => row.id === "item-1");
      expect(await answerOf(mockPrisma.$transaction((tx) => service.postMovement(tx, { orgId: ORG, item, warehouseId: "wh-1", type: "receipt", quantity: 1, unitCost, user: USER, context: {} }))))
        .toEqual({ status: 400, code: "INV_NUMBER", message: "Unit cost must be zero or more" });
      expect(state()).toBe(before);
      // Refused before the first write, not merely rolled back.
      expect(mockPrisma.stockBalance.create).not.toHaveBeenCalled();
      expect(mockPrisma.stockBalance.update).not.toHaveBeenCalled();
      expect(mockPrisma.inventoryItem.update).not.toHaveBeenCalled();
      expect(item).toMatchObject({ averageCost: 10, unitCost: 10, lastPurchasePrice: 10 });
    });
  }

  it("a price of zero or more is booked", async () => {
    const item = db.items.find((row) => row.id === "item-1");
    await mockPrisma.$transaction((tx) => service.postMovement(tx, { orgId: ORG, item, warehouseId: "wh-2", type: "receipt", quantity: 1, unitCost: "0", user: USER, context: {} }));
    expect(db.items.find((row) => row.id === "item-1").lastPurchasePrice).toBe(0);
  });
});

describe("CERT-2 — the item's average blends against its own positions only", () => {
  it("a balance the organisation holds in another company's bin is not counted: 8 own at 10.00 and 8 received at 20.00 average 15.00", async () => {
    await service.receiveStock({ orgId: ORG, user: USER, payload: { itemId: "item-1", warehouseId: "wh-2", quantity: 8, unitCost: 20 } });
    // With the 10 in the other company's bin counted it came to 13.0769.
    expect(db.items.find((row) => row.id === "item-1").averageCost).toBe(15);
    expect(db.balances.find((row) => row.id === "bal-their-bin")).toMatchObject({ onHand: 10, reserved: 0 });
  });

  it("nor is a position in another company's warehouse, nor a balance row of another company", async () => {
    db.balances.push(
      { id: "bal-their-store", orgId: ORG, itemId: "item-1", warehouseId: "wh-theirs", locationId: null, onHand: 100, reserved: 0, inTransit: 0, damaged: 0, quarantined: 0 },
      { id: "bal-their-row", orgId: OTHER, itemId: "item-1", warehouseId: "wh-1", locationId: null, onHand: 1000, reserved: 0, inTransit: 0, damaged: 0, quarantined: 0 },
    );
    await service.receiveStock({ orgId: ORG, user: USER, payload: { itemId: "item-1", warehouseId: "wh-2", quantity: 8, unitCost: 20 } });
    expect(db.items.find((row) => row.id === "item-1").averageCost).toBe(15);
  });
});
