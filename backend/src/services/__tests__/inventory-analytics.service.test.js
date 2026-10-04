/**
 * Inventory analytics.
 *
 * The sections are pure functions over rows, so they are tested directly. What
 * matters is that each one answers a question a storeman would actually ask,
 * and does not quietly turn a real problem into a clean number.
 */

jest.mock("../../config/db", () => ({ prisma: {} }));

const service = require("../inventory-analytics.service");

const item = (over = {}) => ({
  id: "item-1",
  sku: "CEM-42.5N",
  name: "Cement OPC 42.5N",
  unit: "bag",
  category: "Materials",
  onHand: 100,
  reserved: 0,
  damaged: 0,
  quarantined: 0,
  averageCost: 6.4,
  value: 640,
  reorderLevel: 0,
  minStock: 0,
  maxStock: null,
  leadTimeDays: 0,
  ...over,
});

describe("shortages", () => {
  it("reports how short each item is, worst first", () => {
    const { lowStock } = service.shortages([
      item({ id: "a", sku: "A", onHand: 90, reorderLevel: 100 }),
      item({ id: "b", sku: "B", onHand: 10, reorderLevel: 100 }),
      item({ id: "c", sku: "C", onHand: 500, reorderLevel: 100 }),
    ]);

    expect(lowStock.map((row) => row.sku)).toEqual(["B", "A"]);
    expect(lowStock[0].shortfall).toBe(90);
  });

  it("separates out of stock from merely low", () => {
    const { lowStock, outOfStock } = service.shortages([
      item({ id: "a", sku: "A", onHand: 0, reorderLevel: 50 }),
      item({ id: "b", sku: "B", onHand: 5, reorderLevel: 50 }),
    ]);

    expect(outOfStock.map((row) => row.sku)).toEqual(["A"]);
    expect(lowStock.map((row) => row.sku)).toEqual(["B"]);
  });

  it("does not call an item low when nobody set a reorder level", () => {
    // Zero is "not configured", not "reorder at zero" — otherwise every item
    // with stock would sit permanently on the alert list.
    const { lowStock } = service.shortages([item({ onHand: 1, reorderLevel: 0 })]);
    expect(lowStock).toEqual([]);
  });

  it("puts the longest lead time at the top of what has run out", () => {
    const { outOfStock } = service.shortages([
      item({ id: "a", sku: "QUICK", onHand: 0, leadTimeDays: 2 }),
      item({ id: "b", sku: "SLOW", onHand: 0, leadTimeDays: 60 }),
    ]);
    expect(outOfStock[0].sku).toBe("SLOW");
  });
});

describe("overstock", () => {
  it("values the excess, not the whole holding", () => {
    const [row] = service.overstock([
      item({ onHand: 500, maxStock: 200, averageCost: 6.4 }),
    ]);
    expect(row.excess).toBe(300);
    expect(row.excessValue).toBe(1920);
  });

  it("ignores items with no agreed maximum", () => {
    expect(service.overstock([item({ onHand: 10_000, maxStock: null })])).toEqual([]);
  });
});

describe("slowMoving", () => {
  const now = new Date("2026-09-07T00:00:00.000Z");

  it("dates the stall from the last movement", () => {
    const [row] = service.slowMoving(
      [item({ onHand: 40 })],
      new Map([["item-1", new Date("2026-06-09T00:00:00.000Z")]]),
      now,
    );
    expect(row.daysIdle).toBe(90);
  });

  it("leaves out anything that moved recently", () => {
    const rows = service.slowMoving(
      [item({ onHand: 40 })],
      new Map([["item-1", new Date("2026-09-01T00:00:00.000Z")]]),
      now,
    );
    expect(rows).toEqual([]);
  });

  it("puts stock that has never moved at all first", () => {
    const rows = service.slowMoving(
      [
        item({ id: "moved", sku: "MOVED", onHand: 5 }),
        item({ id: "never", sku: "NEVER", onHand: 5 }),
      ],
      new Map([["moved", new Date("2026-01-01T00:00:00.000Z")]]),
      now,
    );
    expect(rows[0].sku).toBe("NEVER");
    expect(rows[0].daysIdle).toBeNull();
  });

  it("does not chase items with nothing on the shelf", () => {
    expect(service.slowMoving([item({ onHand: 0 })], new Map(), now)).toEqual([]);
  });
});

describe("variance", () => {
  const ordered = (over = {}) => ({
    inventoryItemId: "item-1",
    _sum: { orderedQty: 1000, receivedQty: 950, rejectedQty: 50 },
    ...over,
  });

  it("puts ordered, received and used side by side", () => {
    const [row] = service.buildVariance(
      [item({ onHand: 200 })],
      [ordered()],
      new Map([["item-1", 750]]),
    );

    expect(row.ordered).toBe(1000);
    expect(row.received).toBe(950);
    expect(row.rejected).toBe(50);
    expect(row.issued).toBe(750);
    expect(row.outstanding).toBe(0);
  });

  it("flags more going out to site than the order brought in", () => {
    // Stock came from somewhere this order does not explain: another PO, an
    // adjustment, or a mistake. Either way it is worth seeing.
    const [row] = service.buildVariance(
      [item()],
      [ordered({ _sum: { orderedQty: 500, receivedQty: 500, rejectedQty: 0 } })],
      new Map([["item-1", 620]]),
    );
    expect(row.issuedOverReceived).toBe(120);
  });

  it("counts what is still owed on a part-delivered order", () => {
    const [row] = service.buildVariance(
      [item()],
      [ordered({ _sum: { orderedQty: 1000, receivedQty: 400, rejectedQty: 0 } })],
      new Map(),
    );
    expect(row.outstanding).toBe(600);
  });

  it("keeps an item that was issued but never ordered", () => {
    const rows = service.buildVariance([item()], [], new Map([["item-1", 30]]));
    expect(rows).toHaveLength(1);
    expect(rows[0].ordered).toBe(0);
    expect(rows[0].issued).toBe(30);
  });
});

describe("price trend", () => {
  const receipt = (unitCost, day) => ({
    itemId: "item-1",
    unitCost,
    quantity: 100,
    occurredAt: new Date(`2026-0${day}-01T00:00:00.000Z`),
  });

  it("compares the first delivery with the latest", () => {
    const [row] = service.priceTrend(
      [item()],
      [receipt(6, 1), receipt(6.5, 2), receipt(7.5, 3)],
    );

    expect(row.first).toBe(6);
    expect(row.last).toBe(7.5);
    expect(row.change).toBe(1.5);
    expect(row.changePct).toBe(25);
    expect(row.rising).toBe(true);
  });

  it("says nothing about an item delivered once", () => {
    // One delivery is a price, not a trend.
    expect(service.priceTrend([item()], [receipt(6, 1)])).toEqual([]);
  });

  it("does not call a rounding difference a rise", () => {
    const [row] = service.priceTrend([item()], [receipt(6.4, 1), receipt(6.41, 2)]);
    expect(row.rising).toBe(false);
  });
});

describe("damaged report", () => {
  it("values what is damaged and what is held back separately", () => {
    const [row] = service.damagedReport([
      item({ damaged: 10, quarantined: 5, averageCost: 6.4 }),
    ]);
    expect(row.damagedValue).toBe(64);
    expect(row.quarantinedValue).toBe(32);
  });

  it("leaves out sound stock", () => {
    expect(service.damagedReport([item()])).toEqual([]);
  });
});

describe("Phase 21D — integrity (release challenge, third pass)", () => {
  it("CX21-430: a key's project list narrows every project-scoped figure", async () => {
    const { prisma } = require("../../config/db");
    const empty = () => jest.fn(async () => []);
    Object.assign(prisma, {
      inventoryItem: { findMany: empty() },
      warehouse: { findMany: empty() },
      stockTransaction: { groupBy: empty(), findMany: empty() },
      procurementPoLine: { groupBy: empty() },
      activityMaterial: { findMany: empty() },
      activity: { findMany: empty() },
      project: { findMany: empty() },
    });
    await service.getAnalytics({ orgId: "org-1", projectIds: ["p1"] });
    expect(prisma.stockTransaction.groupBy).toHaveBeenCalled();
    for (const call of prisma.stockTransaction.groupBy.mock.calls) expect(call[0].where).toMatchObject({ projectId: { in: ["p1"] } });
    expect(prisma.inventoryItem.findMany.mock.calls[0][0].where).toMatchObject({ OR: [{ projectId: null }, { projectId: { in: ["p1"] } }] });
    expect(prisma.activityMaterial.findMany.mock.calls[0][0].where).toMatchObject({ projectId: { in: ["p1"] } });
    // and the warehouse values count only items of those projects, or of none (CX21-441)
    expect(prisma.warehouse.findMany.mock.calls[0][0].include.balances.where).toEqual({ item: { OR: [{ projectId: null }, { projectId: { in: ["p1"] } }] } });
    // and only warehouses of those projects, or the company's (CX21-462); the items' balances likewise (CX21-471)
    expect(prisma.warehouse.findMany.mock.calls[0][0].where).toMatchObject({ OR: [{ projectId: null }, { projectId: { in: ["p1"] } }] });
    expect(prisma.inventoryItem.findMany.mock.calls[0][0].include.balances.where).toEqual({ warehouse: { OR: [{ projectId: null }, { projectId: { in: ["p1"] } }] } });
  });
});

/**
 * CERT-2: a row of this organisation that names another company's record —
 * a balance put away in another company's bin, a movement naming another
 * company's activity — is not a figure or a name of anything this
 * organisation holds. Every relation is loaded as Prisma loads it: from its
 * table, whichever organisation it belongs to.
 */
describe("CERT-2 — analytics count only the organisation's own positions and name only its own records", () => {
  const ORG = "org-1";
  const OTHER = "org-2";
  const own = { orgId: ORG };
  const theirs = { orgId: OTHER };
  const position = (over) => ({ orgId: ORG, onHand: 0, reserved: 0, damaged: 0, quarantined: 0, inTransit: 0, locationId: null, warehouse: own, location: null, ...over });

  it("values the shelf and each warehouse from the own positions only, and names an activity or a project only when it is the organisation's", async () => {
    const { prisma } = require("../../config/db");
    const empty = () => jest.fn(async () => []);
    Object.assign(prisma, {
      inventoryItem: {
        findMany: jest.fn(async () => [
          {
            id: "item-1", sku: "CEM", name: "Cement", unit: "bag", category: "cement", averageCost: 10, reorderLevel: 0, minStock: 0, maxStock: null, leadTimeDays: 0,
            balances: [
              position({ onHand: 5 }),
              position({ onHand: 3, locationId: "bin-own", location: own }),
              position({ onHand: 10, locationId: "bin-theirs", location: theirs }),
              position({ onHand: 100, warehouse: theirs }),
              position({ onHand: 1000, orgId: OTHER }),
            ],
          },
        ]),
      },
      warehouse: {
        findMany: jest.fn(async () => [
          {
            id: "wh-1", name: "Site store", kind: "site",
            balances: [
              position({ onHand: 5, item: { averageCost: 10, orgId: ORG } }),
              position({ onHand: 3, locationId: "bin-own", location: own, item: { averageCost: 10, orgId: ORG } }),
              position({ onHand: 10, locationId: "bin-theirs", location: theirs, item: { averageCost: 10, orgId: ORG } }),
              position({ onHand: 7, item: { averageCost: 1000, orgId: OTHER } }),
              position({ onHand: 1000, orgId: OTHER, item: { averageCost: 10, orgId: ORG } }),
            ],
          },
        ]),
      },
      stockTransaction: {
        groupBy: jest.fn(async ({ by }) => (by.includes("activityId") ? [
          { projectId: "p-own", activityId: "act-own", _sum: { quantity: -2, value: 20 } },
          { projectId: "p-own", activityId: "act-theirs", _sum: { quantity: -1, value: 10 } },
        ] : [])),
        findMany: empty(),
      },
      procurementPoLine: { groupBy: empty() },
      activityMaterial: { findMany: empty() },
      activity: { findMany: jest.fn(async ({ where }) => [{ id: "act-own", activityCode: "A-1", name: "Own activity", orgId: ORG }, { id: "act-theirs", activityCode: "T-1", name: "Their activity CANARY-OTHER", orgId: OTHER }].filter((row) => where.id.in.includes(row.id) && (!where.project || where.project.orgId === row.orgId))) },
      project: { findMany: jest.fn(async ({ where }) => [{ id: "p-own", name: "Own project", orgId: ORG }].filter((row) => where.id.in.includes(row.id) && (where.orgId === undefined || where.orgId === row.orgId))) },
    });
    const result = await service.getAnalytics({ orgId: ORG });
    expect(result.headline.totalValue).toBe(80); // 8 own on hand at 10.00
    expect(result.byWarehouse).toEqual([expect.objectContaining({ id: "wh-1", value: 80, lines: 2 })]);
    const usage = Object.fromEntries(result.usageByActivity.map((row) => [row.value, row]));
    expect(usage[20]).toMatchObject({ activityId: "act-own", activity: "Own activity", projectId: "p-own", project: "Own project" });
    expect(usage[10]).toMatchObject({ activityId: null, activityRef: null, activity: null });
    expect(JSON.stringify(result)).not.toMatch(/act-theirs|CANARY-OTHER/);
    expect(prisma.activity.findMany.mock.calls[0][0].where).toMatchObject({ project: { orgId: ORG } });
    expect(prisma.project.findMany.mock.calls[0][0].where).toMatchObject({ orgId: ORG });
  });
});
