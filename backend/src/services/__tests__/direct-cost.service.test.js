const { referenceCounterMock } = require("./helpers/reference-counter-mock");
const { createCostLedgerMock } = require("./helpers/cost-ledger-mock");

const store = { costs: [], lines: [], payments: [], budgetLines: [], costRecords: [], notifications: [], poLines: [] };
const mockLedger = createCostLedgerMock();
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;
const DATE_KEYS = new Set(["createdAt", "updatedAt", "costDate", "dueDate", "receivedDate", "submittedAt", "approvedAt", "postedAt", "voidedAt", "paidAt", "actualThroughDate"]);
const clone = (row) => (row ? JSON.parse(JSON.stringify(row), (key, value) => (DATE_KEYS.has(key) && value ? new Date(value) : value)) : row);

const matches = (row, where = {}) =>
  Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return condition.some((clause) => matches(row, clause));
    const value = row[key];
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    if (condition === null || typeof condition !== "object") return value === condition;
    if ("in" in condition) return condition.in.includes(value);
    if ("not" in condition) return value !== condition.not;
    if ("equals" in condition) return String(value || "").toLowerCase() === String(condition.equals).toLowerCase();
    if ("contains" in condition) return String(value || "").toLowerCase().includes(String(condition.contains).toLowerCase());
    if ("gte" in condition || "lte" in condition) return (!condition.gte || value >= condition.gte) && (!condition.lte || value <= condition.lte);
    return true;
  });
const applyData = (row, data) => {
  const next = { ...row };
  for (const [key, value] of Object.entries(data)) next[key] = value && typeof value === "object" && !(value instanceof Date) && ("increment" in value || "decrement" in value) ? Number(next[key] || 0) + Number(value.increment || 0) - Number(value.decrement || 0) : value;
  next.updatedAt = new Date();
  return next;
};
const table = (name, { hydrate = (row) => row } = {}) => ({
  findMany: jest.fn(async ({ where = {} } = {}) => store[name].filter((row) => matches(row, where)).map((row) => hydrate(clone(row)))),
  findFirst: jest.fn(async ({ where = {} } = {}) => {
    const row = store[name].find((item) => matches(item, where));
    return row ? hydrate(clone(row)) : null;
  }),
  aggregate: jest.fn(async ({ where = {} } = {}) => ({ _max: { number: Math.max(0, ...store[name].filter((row) => matches(row, where)).map((row) => row.number || 0)) } })),
  create: jest.fn(async ({ data }) => {
    const row = { id: nextId(name), createdAt: new Date(), updatedAt: new Date(), ...data };
    store[name].push(row);
    return hydrate(clone(row));
  }),
  createMany: jest.fn(async ({ data }) => {
    for (const item of data) store[name].push({ id: nextId(name), createdAt: new Date(), updatedAt: new Date(), ...item });
    return { count: data.length };
  }),
  update: jest.fn(async ({ where, data }) => {
    const index = store[name].findIndex((row) => row.id === where.id);
    if (index < 0) throw new Error(`${name} ${where.id} not found`);
    store[name][index] = applyData(store[name][index], data);
    return hydrate(clone(store[name][index]));
  }),
  delete: jest.fn(async ({ where }) => {
    store[name] = store[name].filter((row) => row.id !== where.id);
    return {};
  }),
  deleteMany: jest.fn(async ({ where = {} } = {}) => {
    const before = store[name].length;
    store[name] = store[name].filter((row) => !matches(row, where));
    return { count: before - store[name].length };
  }),
});

const PROJECT = { id: "p1", orgId: "org-1", name: "Tower", currency: "AED" };
const COMPANIES = [{ id: "co-1", orgId: "org-1", name: "Gulf Ready Mix" }];
const ACTIVITIES = [{ id: "act-1", projectId: "p1", name: "Pour slab L1", activityCode: "A100", wbsCode: "1.2" }];
const COST_CODES = [{ costCodeId: "cc-conc", code: "03-300", name: "Concrete" }, { costCodeId: "cc-site", code: "01-500", name: "Site overheads" }];

const hydrateLine = (row) => ({ ...row, costCode: COST_CODES.find((code) => code.costCodeId === row.costCodeId) ? { id: row.costCodeId, ...COST_CODES.find((code) => code.costCodeId === row.costCodeId) } : null, budgetLine: store.budgetLines.find((line) => line.id === row.budgetLineId) || null, activity: ACTIVITIES.find((activity) => activity.id === row.activityId) || null });
const hydrateCost = (row) => ({ ...row, vendorCompany: COMPANIES.find((company) => company.id === row.vendorCompanyId) || null, lines: store.lines.filter((line) => line.directCostId === row.id).sort((a, b) => a.sortOrder - b.sortOrder).map((line) => hydrateLine(clone(line))), payments: store.payments.filter((payment) => payment.directCostId === row.id).map(clone), _count: { lines: store.lines.filter((line) => line.directCostId === row.id).length, payments: store.payments.filter((payment) => payment.directCostId === row.id).length } });

const mockPrisma = {
  ...referenceCounterMock(),
  project: { findFirst: jest.fn(async ({ where }) => (where.id === "p1" ? PROJECT : null)) },
  company: { findFirst: jest.fn(async ({ where }) => COMPANIES.find((company) => company.id === where.id) || null) },
  activity: { findMany: jest.fn(async ({ where }) => ACTIVITIES.filter((activity) => where.id.in.includes(activity.id)).map((activity) => ({ id: activity.id }))) },
  projectCostCode: { findMany: jest.fn(async ({ where }) => COST_CODES.filter((code) => where.costCodeId.in.includes(code.costCodeId)).map((code) => ({ costCodeId: code.costCodeId }))) },
  directCost: table("costs", { hydrate: hydrateCost }),
  directCostLine: table("lines", { hydrate: hydrateLine }),
  directCostPayment: table("payments"),
  budgetLine: table("budgetLines"),
  costRecord: table("costRecords"),
  // Approving now posts through the cost ledger (OCTA-FIN-LEDGER-059).
  costLedgerEntry: mockLedger.tables.costLedgerEntry,
  // Read to decide whether a line bought stock rather than project cost: a
  // line traceable to a PO line that stocks an item is capitalised, because
  // the cost lands when the material is issued.
  procurementPoLine: {
    findFirst: jest.fn(async ({ where }) => store.poLines.find((row) => row.id === where.id) || null),
    // The project-membership check (Phase 21D, CX21-001): a fixture line is on
    // the project unless it says otherwise, and on the invoice's order when the
    // invoice names one.
    findMany: jest.fn(async ({ where }) =>
      store.poLines
        .filter((row) => where.id.in.includes(row.id))
        .filter((row) => (row.projectId ?? "p1") === where.order.projectId)
        .filter((row) => where.orderId === undefined || row.orderId === where.orderId)
        .map((row) => ({ id: row.id })),
    ),
  },
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
};
const mockAudit = { ACTIONS: { CREATED: "created", UPDATED: "updated", STATUS_CHANGED: "status_changed", APPROVED: "approved", REJECTED: "rejected", DELETED: "deleted" }, recordEvent: jest.fn(async () => null) };
const mockNotifications = { NOTIFICATION_CATEGORIES: { COMMERCIAL: "commercial" }, createNotifications: jest.fn(async (payload) => store.notifications.push(payload)) };
const mockCashFlow = { rebuildCashFlow: jest.fn(async () => ({})) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);
jest.mock("../notification.service", () => mockNotifications);
jest.mock("../cash-flow.service", () => mockCashFlow);

const service = require("../direct-cost.service");

const scope = { orgId: "org-1", projectId: "p1" };
const actor = { id: "u-fin", name: "Fin", role: "finance" };
const reset = () => {
  for (const key of Object.keys(store)) store[key] = [];
  store.budgetLines = [
    { id: "bl-mat", projectId: "p1", costCodeId: "cc-conc", costType: "material", status: "active", actual: 1000 },
    { id: "bl-lab", projectId: "p1", costCodeId: "cc-conc", costType: "labour", status: "active", actual: 200 },
    { id: "bl-site", projectId: "p1", costCodeId: "cc-site", costType: "overhead", status: "active", actual: 0 },
  ];
  store.costRecords = [{ id: "cr-1", projectId: "p1", activityId: "act-1", actual: 5000, actualThroughDate: new Date("2026-09-01T00:00:00Z") }];
  store.poLines = [
    // A stocked PO line: an invoice against this is capitalised, not expensed.
    { id: "pol-stock", inventoryItemId: "item-1", receivedQty: 60 },
    // Direct to site, never stocked: expensed as it always was.
    { id: "pol-direct", inventoryItemId: null, receivedQty: 0 },
  ];
  mockLedger.reset();
  jest.clearAllMocks();
};
const invoice = (overrides = {}) =>
  service.createDirectCost({ ...scope, actor, payload: { type: "invoice", vendorCompanyId: "co-1", invoiceNumber: "INV-778", description: "Ready-mix concrete, L1 slab", costDate: "2026-09-08", dueDate: "2026-10-08", tax: 250, lines: [{ description: "C40 concrete 60 m3", costCodeId: "cc-conc", activityId: "act-1", quantity: 60, unit: "m3", unitCost: 75 }, { description: "Pump hire", costCodeId: "cc-site", costType: "overhead", amount: 500 }], ...overrides } });

describe("direct costs", () => {
  beforeEach(reset);

  it("records an invoice with numbered ref, lines, totals and the vendor name from the company", async () => {
    const cost = await invoice();
    expect(cost).toMatchObject({ ref: "DC-001", status: "draft", type: "invoice", vendorName: "Gulf Ready Mix", subtotal: 5000, tax: 250, total: 5250, paidTotal: 0, balance: 5250, overdue: false, lineCount: 2 });
    expect(cost.lines.map((line) => [line.description, line.amount, line.costCode?.code, line.activity?.name])).toEqual([
      ["C40 concrete 60 m3", 4500, "03-300", "Pour slab L1"],
      ["Pump hire", 500, "01-500", undefined],
    ]);
    await expect(invoice()).rejects.toMatchObject({ code: "DIRECT_COST_DUPLICATE_INVOICE", status: 409 });
    await expect(invoice({ invoiceNumber: "INV-779", lines: [{ description: "x", costCodeId: "cc-nope" }] })).rejects.toMatchObject({ code: "DIRECT_COST_LINE_COST_CODE" });
    await expect(invoice({ invoiceNumber: "INV-780", costDate: "" })).rejects.toMatchObject({ code: "DIRECT_COST_DATE_REQUIRED" });
    const list = await service.listDirectCosts({ ...scope, query: {} });
    expect(list.summary).toMatchObject({ count: 1, total: 5250, paid: 0, unpaid: 0, byType: expect.objectContaining({ invoice: { count: 1, total: 5250 } }) });
  });

  it("capitalises a line that bought stock, so buying and consuming are not both charged", async () => {
    // Inventory is an asset. The economic cost of stocked material lands when
    // it is issued to an activity, at weighted average — so expensing the
    // invoice as well would charge the same money twice.
    const draft = await invoice({
      lines: [
        { description: "Cement into store", costCodeId: "cc-conc", activityId: "act-1", poLineId: "pol-stock", amount: 4000 },
        { description: "Pump hire to site", costCodeId: "cc-site", costType: "overhead", poLineId: "pol-direct", amount: 500 },
      ],
      tax: 0,
    });
    await service.submitDirectCost({ ...scope, actor, directCostId: draft.id });
    const approved = await service.approveDirectCost({ ...scope, actor, directCostId: draft.id });

    const posted = Object.fromEntries(approved.lines.map((line) => [line.description, line.postedAmount]));
    expect(posted["Cement into store"]).toBe(0);
    expect(posted["Pump hire to site"]).toBe(500);

    // Only the direct-to-site line reaches the ledger.
    expect(mockLedger.total({ sourceType: "direct_cost" })).toBe(500);
    expect(approved.notes).toContain("capitalised to inventory");
  });

  it("submits only coded lines, approves and posts to the right budget lines and the activity, then voids with an exact reversal", async () => {
    const draft = await invoice({ lines: [{ description: "Uncoded", amount: 10 }] });
    await expect(service.submitDirectCost({ ...scope, actor, directCostId: draft.id })).rejects.toMatchObject({ code: "DIRECT_COST_LINE_COST_CODE_REQUIRED" });
    await expect(service.approveDirectCost({ ...scope, actor, directCostId: draft.id })).rejects.toMatchObject({ code: "DIRECT_COST_NOT_PENDING" });
    const fixed = await service.updateDirectCost({ ...scope, actor, directCostId: draft.id, payload: { lines: [{ description: "C40 concrete 60 m3", costCodeId: "cc-conc", activityId: "act-1", quantity: 60, unitCost: 75 }, { description: "Pump hire", budgetLineId: "bl-site", amount: 500 }, { description: "Steel fixing labour", costCodeId: "cc-conc", costType: "labour", amount: 300 }] } });
    expect(fixed.total).toBe(5550);
    const pending = await service.submitDirectCost({ ...scope, actor, directCostId: draft.id });
    expect(pending.status).toBe("pending");
    expect(store.notifications[0]).toMatchObject({ event: "direct_cost.submitted", recipientRoles: ["pm", "finance"] });
    await expect(service.updateDirectCost({ ...scope, actor, directCostId: draft.id, payload: { description: "still editable while pending" } })).resolves.toMatchObject({ description: "still editable while pending" });

    const approved = await service.approveDirectCost({ ...scope, actor, directCostId: draft.id });
    expect(approved.status).toBe("approved");
    expect(approved.lines.map((line) => [line.budgetLineId, line.costType, line.postedAmount])).toEqual([
      ["bl-mat", "material", 4500],
      ["bl-site", "overhead", 500],
      ["bl-lab", "labour", 300],
    ]);
    expect(store.budgetLines.map((line) => [line.id, line.actual])).toEqual([
      ["bl-mat", 5500],
      ["bl-lab", 500],
      ["bl-site", 500],
    ]);
    expect(store.costRecords[0]).toMatchObject({ actual: 9500, actualThroughDate: new Date("2026-09-08T00:00:00Z") });
    expect(store.notifications.at(-1)).toMatchObject({ event: "direct_cost.approved", recipientUserIds: ["u-fin"] });
    await expect(service.updateDirectCost({ ...scope, actor, directCostId: draft.id, payload: { description: "no" } })).rejects.toMatchObject({ code: "DIRECT_COST_LOCKED" });

    await expect(service.voidDirectCost({ ...scope, actor, directCostId: draft.id, payload: {} })).rejects.toMatchObject({ code: "DIRECT_COST_REASON_REQUIRED" });
    const voided = await service.voidDirectCost({ ...scope, actor, directCostId: draft.id, payload: { reason: "Duplicate of DC-002" } });
    expect(voided).toMatchObject({ status: "void", voidReason: "Duplicate of DC-002" });
    expect(store.budgetLines.map((line) => line.actual)).toEqual([1000, 200, 0]);
    expect(store.costRecords[0].actual).toBe(5000);
    expect(voided.lines.every((line) => line.postedAmount === 0)).toBe(true);
  });

  it("returns a pending cost with a reason and refuses void once paid", async () => {
    const cost = await invoice();
    await service.submitDirectCost({ ...scope, actor, directCostId: cost.id });
    const returned = await service.rejectDirectCost({ ...scope, actor, directCostId: cost.id, payload: { reason: "Quantity does not match the delivery note" } });
    expect(returned).toMatchObject({ status: "draft", rejectedReason: "Quantity does not match the delivery note", submittedAt: null });
    await service.submitDirectCost({ ...scope, actor, directCostId: cost.id });
    await service.approveDirectCost({ ...scope, actor, directCostId: cost.id });
    await service.recordPayment({ ...scope, actor, directCostId: cost.id, payload: { amount: 1000, paidAt: "2026-09-20", method: "transfer", reference: "TT-1" } });
    await expect(service.voidDirectCost({ ...scope, actor, directCostId: cost.id, payload: { reason: "x" } })).rejects.toMatchObject({ code: "DIRECT_COST_HAS_PAYMENTS" });
  });

  it("records payments up to the balance, marks paid in full and rebuilds the cash flow", async () => {
    const cost = await invoice();
    await expect(service.recordPayment({ ...scope, actor, directCostId: cost.id, payload: { amount: 100 } })).rejects.toMatchObject({ code: "DIRECT_COST_NOT_APPROVED" });
    await service.submitDirectCost({ ...scope, actor, directCostId: cost.id });
    await service.approveDirectCost({ ...scope, actor, directCostId: cost.id });
    await expect(service.recordPayment({ ...scope, actor, directCostId: cost.id, payload: { amount: 6000 } })).rejects.toMatchObject({ code: "DIRECT_COST_PAYMENT_EXCEEDS" });
    const partial = await service.recordPayment({ ...scope, actor, directCostId: cost.id, payload: { amount: 3000, paidAt: "2026-09-20T00:00:00Z", method: "transfer" } });
    expect(partial).toMatchObject({ status: "approved", paidTotal: 3000, balance: 2250, paymentCount: 1 });
    expect(mockCashFlow.rebuildCashFlow).toHaveBeenCalledWith({ orgId: "org-1", projectId: "p1" });
    const paid = await service.recordPayment({ ...scope, actor, directCostId: cost.id, payload: { amount: 2250 } });
    expect(paid).toMatchObject({ status: "paid", paidTotal: 5250, balance: 0 });
    expect(paid.payments).toHaveLength(2);
    const list = await service.listDirectCosts({ ...scope, query: { status: "paid" } });
    expect(list.summary).toMatchObject({ count: 1, paid: 5250, unpaid: 0 });
  });

  it("flags overdue balances, deletes drafts only and filters the register", async () => {
    const old = await invoice({ invoiceNumber: "INV-100", costDate: "2026-06-01", dueDate: "2026-06-30" });
    await service.submitDirectCost({ ...scope, actor, directCostId: old.id });
    await service.approveDirectCost({ ...scope, actor, directCostId: old.id });
    const fresh = await invoice({ invoiceNumber: "INV-101", type: "expense", vendorCompanyId: null, vendorName: "Petty cash", lines: [{ description: "Site consumables", costCodeId: "cc-site", amount: 120 }] });
    const list = await service.listDirectCosts({ ...scope, query: {} });
    expect(list.items.find((row) => row.id === old.id).overdue).toBe(true);
    expect(list.summary.overdue).toBe(5250);
    expect((await service.listDirectCosts({ ...scope, query: { type: "expense" } })).items.map((row) => row.ref)).toEqual([fresh.ref]);
    expect((await service.listDirectCosts({ ...scope, query: { q: "petty" } })).items).toHaveLength(1);
    await expect(service.deleteDirectCost({ ...scope, actor, directCostId: old.id })).rejects.toMatchObject({ code: "DIRECT_COST_LOCKED" });
    expect((await service.deleteDirectCost({ ...scope, actor, directCostId: fresh.id })).deleted).toBe(true);
    await expect(service.getDirectCost({ ...scope, directCostId: fresh.id })).rejects.toMatchObject({ status: 404 });
  });
});

describe("Phase 21D — integrity (Codex round 1)", () => {
  beforeEach(() => {
    reset();
    store.poLines = [
      { id: "pol-stock", orderId: "po-1", projectId: "p1", inventoryItemId: "item-1", receivedQty: 100 },
      { id: "pol-elsewhere", orderId: "po-9", projectId: "p9", inventoryItemId: "item-9", receivedQty: 100 },
    ];
  });

  it("CX21-001: refuses a line that bills a purchase-order line from another project", async () => {
    await expect(
      service.createDirectCost({ ...scope, actor, payload: { type: "invoice", vendorCompanyId: "co-1", invoiceNumber: "INV-X-1", description: "Cement", costDate: "2026-09-01", lines: [
        { description: "Cement billed against another project's order line", costCodeId: "cc-conc", activityId: "act-1", poLineId: "pol-elsewhere", amount: 4000 },
      ] } }),
    ).rejects.toMatchObject({ code: "DIRECT_COST_LINE_PO_LINE" });
    expect(store.costs).toHaveLength(0);
  });

  it("CX21-001: refuses a line whose PO line is on a different order than the invoice names", async () => {
    mockPrisma.procurementOrder = { findFirst: jest.fn(async () => ({ id: "po-2" })) };
    await expect(
      service.createDirectCost({ ...scope, actor, payload: { type: "invoice", vendorCompanyId: "co-1", invoiceNumber: "INV-X-2", description: "Cement", costDate: "2026-09-01", purchaseOrderId: "po-2", lines: [
        { description: "Cement", costCodeId: "cc-conc", activityId: "act-1", poLineId: "pol-stock", amount: 4000 },
      ] } }),
    ).rejects.toMatchObject({ code: "DIRECT_COST_LINE_PO_LINE" });
  });

  it("CX21-005: a payment is checked against the payment rows, not a figure read before the transaction", async () => {
    const cost = await invoice();
    await service.submitDirectCost({ ...scope, actor, directCostId: cost.id });
    await service.approveDirectCost({ ...scope, actor, directCostId: cost.id });
    // Another payment landed between the balance check and the transaction: its
    // row exists, the invoice's paidTotal has not caught up yet.
    const total = Number(store.costs[0].total);
    store.payments.push({ id: "pay-race", orgId: "org-1", projectId: "p1", directCostId: cost.id, amount: total - 10, paidAt: new Date() });
    const lock = jest.spyOn(mockPrisma, "$queryRaw");
    await expect(service.recordPayment({ ...scope, actor, directCostId: cost.id, payload: { amount: 60 } })).rejects.toMatchObject({ code: "DIRECT_COST_PAYMENT_EXCEEDS" });
    const paid = await service.recordPayment({ ...scope, actor, directCostId: cost.id, payload: { amount: 10 } });
    expect(Number(paid.paidTotal)).toBe(total);
    expect(lock.mock.calls.map((call) => call[0].join("?")).some((sql) => sql.includes('FROM "DirectCost" WHERE id = ? FOR UPDATE'))).toBe(true);
    lock.mockRestore();
  });
});

jest.mock("../purchase-order.service", () => ({ recomputeInvoiced: jest.fn(async () => null) }));

describe("Phase 21D — integrity (Codex round 2)", () => {
  beforeEach(() => {
    reset();
    store.poLines = [
      { id: "pol-stock", orderId: "po-1", projectId: "p1", inventoryItemId: "item-1", receivedQty: 100 },
      { id: "pol-b", orderId: "po-2", projectId: "p1", inventoryItemId: null, receivedQty: 0 },
    ];
    mockPrisma.procurementOrder = { findFirst: jest.fn(async ({ where }) => ({ id: where.id })) };
  });

  const stockedInvoice = (over = {}) =>
    service.createDirectCost({ ...scope, actor, payload: { type: "invoice", vendorCompanyId: "co-1", invoiceNumber: "INV-104", description: "Cement", costDate: "2026-09-01", lines: [
      { description: "Cement, stocked", costCodeId: "cc-conc", activityId: "act-1", poLineId: "pol-stock", amount: 4000 },
    ], ...over } });

  it("CX21-104: moving an invoice to another order without replacing its lines is refused when the lines bill the old order", async () => {
    const cost = await stockedInvoice();
    await expect(service.updateDirectCost({ ...scope, actor, directCostId: cost.id, payload: { purchaseOrderId: "po-2" } })).rejects.toMatchObject({ code: "DIRECT_COST_LINE_PO_LINE" });
    // Naming the order the lines already belong to is fine.
    const moved = await service.updateDirectCost({ ...scope, actor, directCostId: cost.id, payload: { purchaseOrderId: "po-1" } });
    expect(moved.purchaseOrderId).toBe("po-1");
  });

  it("CX21-103: a payment finds the void that landed after its status check, under the lock", async () => {
    const cost = await stockedInvoice({ invoiceNumber: "INV-103a" });
    await service.submitDirectCost({ ...scope, actor, directCostId: cost.id });
    await service.approveDirectCost({ ...scope, actor, directCostId: cost.id });
    const lock = jest.spyOn(mockPrisma, "$queryRaw").mockImplementation(async (strings) => {
      if (strings.join("?").includes('FROM "DirectCost"')) store.costs.find((row) => row.id === cost.id).status = "void";
      return [];
    });
    await expect(service.recordPayment({ ...scope, actor, directCostId: cost.id, payload: { amount: 100 } })).rejects.toMatchObject({ code: "DIRECT_COST_NOT_APPROVED" });
    expect(store.payments.filter((row) => row.directCostId === cost.id)).toHaveLength(0);
    lock.mockRestore();
  });

  it("CX21-103: a void finds the payment that landed after its check, under the lock", async () => {
    const cost = await stockedInvoice({ invoiceNumber: "INV-103b" });
    await service.submitDirectCost({ ...scope, actor, directCostId: cost.id });
    await service.approveDirectCost({ ...scope, actor, directCostId: cost.id });
    const lock = jest.spyOn(mockPrisma, "$queryRaw").mockImplementation(async (strings) => {
      if (strings.join("?").includes('FROM "DirectCost"')) store.payments.push({ id: "pay-late", orgId: "org-1", projectId: "p1", directCostId: cost.id, amount: 100, paidAt: new Date() });
      return [];
    });
    await expect(service.voidDirectCost({ ...scope, actor, directCostId: cost.id, payload: { reason: "duplicate" } })).rejects.toMatchObject({ code: "DIRECT_COST_HAS_PAYMENTS" });
    expect(store.costs.find((row) => row.id === cost.id).status).toBe("approved");
    lock.mockRestore();
  });
});
