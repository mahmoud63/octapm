/**
 * CERT-2 "wrongly shaped identifiers" on the warehouse routes and on
 * procurement's door to the goods receipt.
 *
 * express-validator's isUUID() checks an array element by element, so
 * `itemId: ["<id>"]` passed the stock routes and reached Prisma, which
 * refused it with a 500 — the organisation's own id as much as another
 * company's or one that exists nowhere (74 such answers in the shape sweep).
 * Every identifier field below is now one string first: any other shape is a
 * 400 VALIDATION_ERROR naming the field, before the service is called, the
 * same answer whoever's id it wraps; the identifier itself, as one string,
 * passes the field's check.
 *
 * Also here: a delivered line's unitCost on procurement's door (no check, and
 * "abc" became NaN on the stock ledger), a transfer receipt's line that is not
 * an object ([null] was a 500), and a status filter sent twice (a 500).
 *
 * The routers are mounted with every service they import replaced by a stub,
 * so only the routes' own validation runs.
 */
const express = require("express");
const request = require("supertest");

jest.mock("../../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: "11111111-1111-4111-8111-111111111111", orgId: "org-1", name: "Tester", role: "pm", isCompanyAdmin: true };
    next();
  },
}));

const mockService = (constants = {}) =>
  new Proxy(
    { ...constants },
    {
      get(target, key) {
        if (key === "__esModule") return false;
        if (typeof key === "symbol") return undefined;
        if (!(key in target)) target[key] = jest.fn(async () => ({ id: "stubbed", items: [] }));
        return target[key];
      },
    },
  );
const mockActualConstants = (path) => {
  const actual = jest.requireActual(path);
  return mockService(Object.fromEntries(Object.entries(actual).filter(([, value]) => typeof value !== "function")));
};

jest.mock("../../services/inventory.service", () => mockActualConstants("../../services/inventory.service"));
jest.mock("../../services/goods-receipt.service", () => mockActualConstants("../../services/goods-receipt.service"));
jest.mock("../../services/inventory-analytics.service", () => mockService());
jest.mock("../../services/procurement.service", () => mockService());

const ID = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const R = "44444444-4444-4444-8444-444444444444";
const W = "55555555-5555-4555-8555-555555555555";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/inventory", require("../inventory"));
  app.use("/projects/:projectId/procurement", require("../procurement"));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ success: false, error: { code: err.code || "INTERNAL_ERROR", message: err.message, details: err.details } }));
  return app;
};

const movement = (extra = {}) => ({ itemId: ID, warehouseId: W, quantity: 1, notes: "Proof", ...extra });
const receipt = (extra = {}, line = {}) => ({ orderId: R, warehouseId: W, lines: [{ poLineId: ID, acceptedQty: 1, ...line }], ...extra });
const procReceipt = (extra = {}, line = {}) => ({ receiptNumber: "GRN-1", warehouseId: W, lines: [{ poLineId: ID, acceptedQty: 1, ...line }], ...extra });

// [name, method, url, body(value), the field's path in the refusal]
const cases = [];
for (const path of ["receive", "issue", "return", "adjust", "damage", "quarantine", "release"]) {
  for (const field of ["itemId", "warehouseId", "locationId"]) {
    cases.push([`POST stock/${path} ${field}`, "post", `/inventory/stock/${path}`, (v) => movement({ activityId: R, [field]: v }), field]);
  }
}
for (const field of ["projectId", "activityId", "costCodeId", "boqItemId", "commitmentId", "locationRefId", "poLineId", "receiptLineId"]) {
  cases.push([`POST stock/receive ${field}`, "post", "/inventory/stock/receive", (v) => movement({ [field]: v }), field]);
}
for (const field of ["projectId", "activityId", "costCodeId", "boqItemId", "locationRefId", "commitmentId"]) {
  cases.push([`POST stock/issue ${field}`, "post", "/inventory/stock/issue", (v) => movement({ costCodeId: R, [field]: v }), field]);
}
for (const path of ["return", "adjust", "damage", "quarantine", "release"]) {
  for (const field of ["projectId", "activityId", "costCodeId", "boqItemId", "commitmentId", "locationRefId"]) {
    cases.push([`POST stock/${path} ${field}`, "post", `/inventory/stock/${path}`, (v) => movement({ [field]: v }), field]);
  }
}
for (const field of ["itemId", "warehouseId", "locationId"]) {
  cases.push([`POST stock/reserve ${field}`, "post", "/inventory/stock/reserve", (v) => movement({ [field]: v }), field]);
}
cases.push(
  ["POST transfers fromWarehouseId", "post", "/inventory/transfers", (v) => ({ fromWarehouseId: v, toWarehouseId: W, lines: [{ itemId: ID, quantity: 1 }] }), "fromWarehouseId"],
  ["POST transfers toWarehouseId", "post", "/inventory/transfers", (v) => ({ fromWarehouseId: W, toWarehouseId: v, lines: [{ itemId: ID, quantity: 1 }] }), "toWarehouseId"],
  ["POST transfers lines[].itemId", "post", "/inventory/transfers", (v) => ({ fromWarehouseId: W, toWarehouseId: R, lines: [{ itemId: v, quantity: 1 }] }), "lines[0].itemId"],
  ["POST goods-receipt orderId", "post", "/inventory/goods-receipt", (v) => receipt({ orderId: v }), "orderId"],
  ["POST goods-receipt warehouseId", "post", "/inventory/goods-receipt", (v) => receipt({ warehouseId: v }), "warehouseId"],
  ["POST goods-receipt projectId", "post", "/inventory/goods-receipt", (v) => receipt({ projectId: v }), "projectId"],
  ["POST goods-receipt lines[].poLineId", "post", "/inventory/goods-receipt", (v) => receipt({}, { poLineId: v }), "lines[0].poLineId"],
  ["POST goods-receipt lines[].locationId", "post", "/inventory/goods-receipt", (v) => receipt({}, { locationId: v }), "lines[0].locationId"],
  ["POST goods-receipt lines[].inventoryItemId", "post", "/inventory/goods-receipt", (v) => receipt({}, { inventoryItemId: v }), "lines[0].inventoryItemId"],
  ["POST items projectId", "post", "/inventory/items", (v) => ({ sku: "S-1", name: "Cement", unit: "bag", projectId: v }), "projectId"],
  ["POST items preferredSupplierId", "post", "/inventory/items", (v) => ({ sku: "S-1", name: "Cement", unit: "bag", preferredSupplierId: v }), "preferredSupplierId"],
  ["PATCH items/:id projectId", "patch", `/inventory/items/${R}`, (v) => ({ projectId: v }), "projectId"],
  ["POST warehouses projectId", "post", "/inventory/warehouses", (v) => ({ code: "W-1", name: "Store", projectId: v }), "projectId"],
  ["POST warehouses managerId", "post", "/inventory/warehouses", (v) => ({ code: "W-1", name: "Store", managerId: v }), "managerId"],
  ["PATCH warehouses/:id managerId", "patch", `/inventory/warehouses/${W}`, (v) => ({ managerId: v }), "managerId"],
  ["POST warehouses/:id/locations parentId", "post", `/inventory/warehouses/${W}/locations`, (v) => ({ code: "A-1", name: "Aisle", parentId: v }), "parentId"],
  ["POST procurement receipts warehouseId", "post", `/projects/${P}/procurement/purchase-orders/${R}/receipts`, (v) => procReceipt({ warehouseId: v }), "warehouseId"],
  ["POST procurement receipts dailyReportId", "post", `/projects/${P}/procurement/purchase-orders/${R}/receipts`, (v) => procReceipt({ dailyReportId: v }), "dailyReportId"],
  ["POST procurement receipts lines[].poLineId", "post", `/projects/${P}/procurement/purchase-orders/${R}/receipts`, (v) => procReceipt({}, { poLineId: v }), "lines[0].poLineId"],
  ["POST procurement receipts lines[].dailyReportId", "post", `/projects/${P}/procurement/purchase-orders/${R}/receipts`, (v) => procReceipt({}, { dailyReportId: v }), "lines[0].dailyReportId"],
  ["POST procurement receipts lines[].locationId", "post", `/projects/${P}/procurement/purchase-orders/${R}/receipts`, (v) => procReceipt({}, { locationId: v }), "lines[0].locationId"],
  ["POST procurement receipts lines[].inventoryItemId", "post", `/projects/${P}/procurement/purchase-orders/${R}/receipts`, (v) => procReceipt({}, { inventoryItemId: v }), "lines[0].inventoryItemId"],
);

const fieldsNamed = (res) => (res.body?.error?.code === "VALIDATION_ERROR" ? (res.body.error.details || []).map((d) => d.field) : []);

describe("inventory and receipt identifier fields refuse any value that is not one string (CERT-2 shapes)", () => {
  let app;
  beforeAll(() => {
    app = buildApp();
  });

  test.each(cases)("%s", async (_name, method, url, body, field) => {
    for (const shaped of [[ID], [[ID]], { id: ID }, 12345, true, { not: "x" }]) {
      const res = await request(app)[method](url).send(body(shaped));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(fieldsNamed(res)).toContain(field);
    }
    // The identifier itself, as one string, passes this field's check.
    const plain = await request(app)[method](url).send(body(ID));
    expect(fieldsNamed(plain)).not.toContain(field);
  });

  test("the inventory door leaves a daily report of any shape to the service, which answers it as one that exists nowhere", async () => {
    const res = await request(app).post("/inventory/goods-receipt").send(receipt({ dailyReportId: [ID] }));
    expect(fieldsNamed(res)).not.toContain("dailyReportId");
  });

  test("the inventory door's receivedBy is text: an array or an object is a 400", async () => {
    for (const shaped of [["Sam"], { not: "x" }]) {
      const res = await request(app).post("/inventory/goods-receipt").send(receipt({ receivedBy: shaped }));
      expect(res.status).toBe(400);
      expect(fieldsNamed(res)).toContain("receivedBy");
    }
    const plain = await request(app).post("/inventory/goods-receipt").send(receipt({ receivedBy: "Sam (storeman)" }));
    expect(fieldsNamed(plain)).not.toContain("receivedBy");
  });

  test("procurement's door checks a delivered line's unitCost: a number of zero or more", async () => {
    const url = `/projects/${P}/procurement/purchase-orders/${R}/receipts`;
    for (const bad of ["abc", -1, "", { not: "x" }]) {
      const res = await request(app).post(url).send(procReceipt({}, { unitCost: bad }));
      expect(res.status).toBe(400);
      expect(fieldsNamed(res)).toContain("lines[0].unitCost");
    }
    for (const good of [0, 12.5, "7.25", null]) {
      const res = await request(app).post(url).send(procReceipt({}, { unitCost: good }));
      expect(fieldsNamed(res)).not.toContain("lines[0].unitCost");
    }
  });

  test("a transfer receipt's reported line is an object: [null] and [\"x\"] are a 400, not a 500 or a full receipt", async () => {
    for (const lines of [[null], ["x"], [12345]]) {
      const res = await request(app).post(`/inventory/transfers/${R}/receive`).send({ lines });
      expect(res.status).toBe(400);
      expect(fieldsNamed(res)).toContain("lines[0]");
    }
    const ok = await request(app).post(`/inventory/transfers/${R}/receive`).send({ lines: [{ id: ID, receivedQty: 1 }] });
    expect(ok.status).toBe(200);
  });

  test("a list's status, project or item filter sent twice is a 400, not a 500", async () => {
    for (const url of [
      "/inventory/transfers?status=draft&status=received",
      "/inventory/items?status=active&status=archived",
      `/inventory/items?projectId=${P}&projectId=${R}`,
      `/inventory/stock/transactions?itemId=${ID}&itemId=${R}`,
      `/inventory/stock/transactions?warehouseId=${W}&warehouseId=${R}`,
      `/inventory/stock/transactions?projectId=${P}&projectId=${R}`,
      `/inventory/stock/transactions?activityId=${R}&activityId=${ID}`,
      `/inventory/summary?projectId=${P}&projectId=${R}`,
    ]) {
      const res = await request(app).get(url);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect((await request(app).get("/inventory/transfers?status=draft")).status).toBe(200);
    expect((await request(app).get(`/inventory/stock/transactions?itemId=${ID}`)).status).toBe(200);
  });
});
