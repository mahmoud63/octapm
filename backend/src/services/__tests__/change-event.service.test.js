const { referenceCounterMock } = require("./helpers/reference-counter-mock");
const store = { events: [], lines: [], rfqs: [], notifications: [], emails: [], changeOrders: [], commitmentChangeOrders: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;
/**
 * Dates that stay in the future.
 *
 * An RFQ stops accepting quotes a day after it was due, which is right — and
 * meant a hard-coded due date turned this test red the morning it passed,
 * years after it was written, with nothing having changed. These follow the
 * clock instead.
 */
const inDays = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const DATE_KEYS = new Set(["createdAt", "updatedAt", "expiresAt", "dueDate", "sentAt", "viewedAt", "lastAccessAt", "quotedAt", "quoteValidUntil", "acceptedAt", "rejectedAt", "convertedAt", "closedAt"]);
const clone = (row) => (row ? JSON.parse(JSON.stringify(row), (key, value) => (DATE_KEYS.has(key) && value ? new Date(value) : value)) : row);

const matches = (row, where = {}) =>
  Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return condition.some((clause) => matches(row, clause));
    const value = row[key];
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    if (condition === null || typeof condition !== "object") return value === condition;
    if ("in" in condition) return condition.in.includes(value);
    if ("notIn" in condition) return !condition.notIn.includes(value);
    if ("contains" in condition) return String(value || "").toLowerCase().includes(String(condition.contains).toLowerCase());
    return true;
  });
const applyData = (row, data) => {
  const next = { ...row };
  for (const [key, value] of Object.entries(data)) next[key] = value && typeof value === "object" && !(value instanceof Date) && "increment" in value ? Number(next[key] || 0) + value.increment : value;
  next.updatedAt = new Date();
  return next;
};
const table = (name, { hydrate = (row) => row } = {}) => ({
  findMany: jest.fn(async ({ where = {} } = {}) => store[name].filter((row) => matches(row, where)).map((row) => hydrate(clone(row)))),
  findFirst: jest.fn(async ({ where = {} } = {}) => {
    const row = store[name].find((item) => matches(item, where));
    return row ? hydrate(clone(row)) : null;
  }),
  findUnique: jest.fn(async ({ where = {} } = {}) => {
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
  updateMany: jest.fn(async ({ where, data }) => {
    let count = 0;
    store[name] = store[name].map((row) => (matches(row, where) ? ((count += 1), applyData(row, data)) : row));
    return { count };
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
const ACTIVITIES = [{ id: "act-1", projectId: "p1", name: "Pour slab L1", activityCode: "A100", wbsCode: "1.2" }, { id: "act-2", projectId: "p1", name: "MEP rough-in", activityCode: "A200", wbsCode: "1.3" }];
const COMMITMENTS = [{ id: "cmt-1", projectId: "p1", ref: "SC-001", title: "Electrical works", vendorCompanyId: "co-2", vendorCompany: { id: "co-2", name: "Sparks LLC", email: "quotes@sparks.example", contactName: "Sam Spark" }, projectParty: null }];

const hydrateLine = (row) => ({ ...row, costCode: row.costCodeId ? { id: row.costCodeId, code: "26-100", name: "Electrical" } : null, activity: ACTIVITIES.find((activity) => activity.id === row.activityId) || null, commitment: row.commitmentId ? { id: row.commitmentId, ref: "SC-001", title: "Electrical works", vendorCompany: { name: "Sparks LLC" } } : null });
const hydrateRfq = (row) => ({ ...row, commitment: row.commitmentId ? { id: row.commitmentId, ref: "SC-001", title: "Electrical works" } : null, commitmentChangeOrder: row.commitmentChangeOrderId ? store.commitmentChangeOrders.find((co) => co.id === row.commitmentChangeOrderId) || null : null });
const hydrateEvent = (row) => ({ ...row, project: PROJECT, activity: ACTIVITIES.find((activity) => activity.id === row.activityId) || null, location: null, changeOrder: row.changeOrderId ? store.changeOrders.find((co) => co.id === row.changeOrderId) || null : null, lines: store.lines.filter((line) => line.changeEventId === row.id).sort((a, b) => a.sortOrder - b.sortOrder).map((line) => hydrateLine(clone(line))), rfqs: store.rfqs.filter((rfq) => rfq.changeEventId === row.id).sort((a, b) => a.number - b.number).map((rfq) => hydrateRfq(clone(rfq))), _count: { lines: store.lines.filter((line) => line.changeEventId === row.id).length } });
const hydratePortalRfq = (row) => ({ ...hydrateRfq(row), changeEvent: hydrateEvent(clone(store.events.find((event) => event.id === row.changeEventId))) });

const mockPrisma = {
  ...referenceCounterMock(),
  project: { findFirst: jest.fn(async ({ where }) => (where.id === "p1" ? PROJECT : null)) },
  activity: { findMany: jest.fn(async ({ where }) => ACTIVITIES.filter((activity) => where.id.in.includes(activity.id)).map((activity) => ({ id: activity.id }))) },
  location: { findFirst: jest.fn(async () => null) },
  projectCostCode: { findMany: jest.fn(async ({ where }) => where.costCodeId.in.filter((id) => id === "cc-1").map((id) => ({ costCodeId: id }))) },
  commitment: { findMany: jest.fn(async ({ where, include }) => COMMITMENTS.filter((row) => where.id.in.includes(row.id)).map((row) => (include ? row : { id: row.id }))) },
  changeEvent: table("events", { hydrate: hydrateEvent }),
  changeEventLine: table("lines", { hydrate: hydrateLine }),
  rfq: table("rfqs", { hydrate: (row) => (store.events.some((event) => event.id === row.changeEventId) ? hydratePortalRfq(row) : hydrateRfq(row)) }),
  commitmentChangeOrder: table("commitmentChangeOrders"),
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
};
const mockAudit = { ACTIONS: { CREATED: "created", UPDATED: "updated", STATUS_CHANGED: "status_changed", APPROVED: "approved", REJECTED: "rejected", DELETED: "deleted" }, recordEvent: jest.fn(async () => null) };
const mockNotifications = { NOTIFICATION_CATEGORIES: { COMMERCIAL: "commercial" }, createNotifications: jest.fn(async (payload) => store.notifications.push(payload)) };
const mockEmail = { sendEmail: jest.fn(async (payload) => store.emails.push(payload)) };
const mockChangeOrders = { createChangeOrder: jest.fn(async ({ payload }) => { const row = { id: nextId("co"), ref: `VO-${String(store.changeOrders.length + 1).padStart(2, "0")}`, status: "draft", value: payload.value, description: payload.description, payload }; store.changeOrders.push(row); return row; }) };
const mockCommitments = { createChangeOrder: jest.fn(async ({ commitmentId, payload }) => { const row = { id: nextId("cco"), ref: `SC-001-CO${String(store.commitmentChangeOrders.length + 1).padStart(2, "0")}`, status: "draft", value: payload.value, commitmentId, primeChangeOrderId: payload.primeChangeOrderId || null, lines: payload.lines }; store.commitmentChangeOrders.push(row); return row; }) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);
jest.mock("../notification.service", () => mockNotifications);
jest.mock("../email.service", () => mockEmail);
jest.mock("../change-order.service", () => mockChangeOrders);
jest.mock("../commitment.service", () => mockCommitments);

const service = require("../change-event.service");

const scope = { orgId: "org-1", projectId: "p1" };
const actor = { id: "u-pm", name: "Pat PM", role: "pm" };
const reset = () => {
  for (const key of Object.keys(store)) store[key] = [];
  jest.clearAllMocks();
  process.env.WEB_APP_URL = "https://app.example";
};
const tokenOf = (email) => /rfq\/([A-Za-z0-9_-]+)/.exec(email.body)[1];

const createEvent = () =>
  service.createChangeEvent({ ...scope, actor, payload: { title: "Extra distribution board L1", type: "owner_change", origin: "rfi", sourceRecordType: "rfi", sourceRecordId: "rfi-1", activityId: "act-2", scheduleImpactDays: 3, lines: [{ description: "Supply and install DB-L1-02", costCodeId: "cc-1", activityId: "act-2", commitmentId: "cmt-1", quantity: 1, unit: "no", unitCost: 12000 }, { description: "Core through slab", activityId: "act-1", quantity: 4, unit: "no", unitCost: 350 }] } });

describe("change events and RFQs", () => {
  beforeEach(reset);

  it("creates a change event with numbered ref, lines and ROM totals", async () => {
    const event = await createEvent();
    expect(event).toMatchObject({ ref: "CE-001", status: "open", type: "owner_change", origin: "rfi", sourcePath: "/projects/p1/doc-control/rfi?recordId=rfi-1&source=rfi", totals: { rom: 13400, quoted: null, estimate: 13400 }, lineCount: 2 });
    expect(event.lines.map((line) => [line.description, line.romAmount, line.activity?.name])).toEqual([
      ["Supply and install DB-L1-02", 12000, "MEP rough-in"],
      ["Core through slab", 1400, "Pour slab L1"],
    ]);
    await expect(service.createChangeEvent({ ...scope, actor, payload: { title: "x", lines: [{ description: "y", costCodeId: "cc-9" }] } })).rejects.toMatchObject({ code: "CHANGE_EVENT_COST_CODE_INVALID" });
    const list = await service.listChangeEvents({ ...scope, query: {} });
    expect(list.summary).toMatchObject({ count: 1, romTotal: 13400, quotedTotal: 0, byStatus: expect.objectContaining({ open: 1 }) });
  });

  it("updates lines by id, keeping accepted quotes, and refuses edits once locked", async () => {
    const event = await createEvent();
    const [first] = event.lines;
    const updated = await service.updateChangeEvent({ ...scope, actor, changeEventId: event.id, payload: { romAmount: 500, lines: [{ id: first.id, description: "Supply and install DB-L1-02 (revised)", quantity: 1, unitCost: 12500, activityId: "act-2" }, { description: "Testing and commissioning", quantity: 1, unitCost: 800 }] } });
    expect(updated.lines.map((line) => [line.id === first.id, line.description, line.romAmount])).toEqual([
      [true, "Supply and install DB-L1-02 (revised)", 12500],
      [false, "Testing and commissioning", 800],
    ]);
    expect(updated.totals.estimate).toBe(13300);
    store.events[0].status = "converted";
    await expect(service.updateChangeEvent({ ...scope, actor, changeEventId: event.id, payload: { title: "no" } })).rejects.toMatchObject({ code: "CHANGE_EVENT_LOCKED" });
  });

  it("sends RFQs with personal links, the vendor quotes through the portal, and the team is notified", async () => {
    const event = await createEvent();
    const sent = await service.sendRfqs({ ...scope, actor, changeEventId: event.id, payload: { recipients: [{ commitmentId: "cmt-1" }, { companyName: "Volt Bros", contactName: "Vera", contactEmail: "Vera@volt.example" }], dueDate: inDays(7), instructions: "Price supply and install; exclude builder's work." } });
    expect(sent.sent).toBe(2);
    expect(sent.rfqs.map((rfq) => [rfq.ref, rfq.companyName, rfq.commitmentId, rfq.status])).toEqual([
      ["CE-001-RFQ01", "Sparks LLC", "cmt-1", "sent"],
      ["CE-001-RFQ02", "Volt Bros", null, "sent"],
    ]);
    expect(sent.rfqs[0].portalUrl).toMatch(/^https:\/\/app\.example\/rfq\//);
    expect(sent.changeEvent.status).toBe("pricing");
    expect(store.emails.map((email) => email.to)).toEqual(["quotes@sparks.example", "vera@volt.example"]);
    expect(store.emails[0].body).toContain("exclude builder's work");
    await expect(service.sendRfqs({ ...scope, actor, changeEventId: event.id, payload: { recipients: [{ commitmentId: "cmt-1" }] } })).rejects.toMatchObject({ code: "RFQ_ALREADY_SENT" });
    await expect(service.sendRfqs({ ...scope, actor, changeEventId: event.id, payload: { recipients: [{ companyName: "No mail" }] } })).rejects.toMatchObject({ code: "RFQ_EMAIL_REQUIRED" });

    const token = tokenOf(store.emails[0]);
    const view = await service.portalView(token);
    expect(view.rfq).toMatchObject({ ref: "CE-001-RFQ01", companyName: "Sparks LLC", status: "viewed", acceptingQuotes: true });
    expect(view.changeEvent.lines.map((line) => line.description)).toEqual(["Supply and install DB-L1-02", "Core through slab"]);
    expect(view.changeEvent.currency).toBe("AED");
    expect(view.rfq.contactEmail).toBeUndefined();

    const [lineA, lineB] = view.changeEvent.lines;
    const quoted = await service.portalSubmitQuote(token, { lines: [{ lineId: lineA.id, amount: "11,250", note: "DB per spec" }, { lineId: lineB.id, amount: 1200 }], notes: "Valid 30 days", validUntil: inDays(37), leadTimeDays: 21, quotedBy: "Sam Spark" });
    expect(quoted.rfq.status).toBe("quoted");
    expect(quoted.quote).toMatchObject({ total: 12450, leadTimeDays: 21, quotedBy: "Sam Spark" });
    expect(store.notifications[0]).toMatchObject({ event: "rfq.quoted", recipientRoles: ["pm", "qs"], entityType: "change_event", entityId: event.id });
    expect(store.emails.at(-1)).toMatchObject({ to: "quotes@sparks.example" });
    await expect(service.portalView("not-a-real-token-at-all-really")).rejects.toMatchObject({ code: "RFQ_LINK_INVALID" });
    await expect(service.portalSubmitQuote(token, { lines: [] })).rejects.toMatchObject({ code: "RFQ_QUOTE_EMPTY" });

    const declined = await service.portalDecline(tokenOf(store.emails[1]), { reason: "Fully booked" });
    expect(declined.rfq).toMatchObject({ status: "declined", declinedReason: "Fully booked" });
    expect(store.notifications.at(-1)).toMatchObject({ event: "rfq.declined" });
  });

  it("accepts a quote onto the lines, drafts a commitment change order, converts to a prime change order and links it", async () => {
    const event = await createEvent();
    await service.sendRfqs({ ...scope, actor, changeEventId: event.id, payload: { recipients: [{ commitmentId: "cmt-1" }] } });
    const token = tokenOf(store.emails[0]);
    const view = await service.portalView(token);
    const [lineA, lineB] = view.changeEvent.lines;
    await service.portalSubmitQuote(token, { lines: [{ lineId: lineA.id, amount: 11250 }, { lineId: lineB.id, amount: 1200 }] });
    const rfqId = store.rfqs[0].id;
    await expect(service.acceptQuote({ ...scope, actor, rfqId: "nope" })).rejects.toMatchObject({ status: 404 });
    const accepted = await service.acceptQuote({ ...scope, actor, rfqId, payload: { createCommitmentChangeOrder: true } });
    expect(accepted.changeEvent.status).toBe("priced");
    expect(accepted.changeEvent.lines.map((line) => [line.quotedAmount, line.amount])).toEqual([
      [11250, 11250],
      [1200, 1200],
    ]);
    expect(accepted.changeEvent.totals).toEqual({ rom: 13400, quoted: 12450, estimate: 12450 });
    expect(accepted.commitmentChangeOrder).toMatchObject({ ref: "SC-001-CO01", value: 12450 });
    expect(mockCommitments.createChangeOrder).toHaveBeenCalledWith(expect.objectContaining({ commitmentId: "cmt-1", payload: expect.objectContaining({ title: "CE-001 Extra distribution board L1", value: 12450, lines: [expect.objectContaining({ description: "Supply and install DB-L1-02", costCodeId: "cc-1", activityId: "act-2", amount: 11250 }), expect.objectContaining({ description: "Core through slab", activityId: "act-1", amount: 1200 })] }) }));
    await expect(service.acceptQuote({ ...scope, actor, rfqId })).rejects.toMatchObject({ code: "RFQ_NOT_QUOTED" });

    const converted = await service.convertToChangeOrder({ ...scope, actor, changeEventId: event.id, payload: {} });
    expect(converted.changeOrder).toMatchObject({ ref: "VO-01", value: 12450, path: expect.stringContaining("/commercial/change-orders?recordId=") });
    expect(mockChangeOrders.createChangeOrder).toHaveBeenCalledWith(expect.objectContaining({ userId: "u-pm", userRole: "pm", payload: expect.objectContaining({ category: "owner_change", value: 12450, scheduleImpact: 3, activityId: "act-2", affectedActivityIds: ["act-2", "act-1"], raisedBy: "Pat PM" }) }));
    expect(converted.changeEvent).toMatchObject({ status: "converted", changeOrderId: converted.changeOrder.id });
    expect(converted.commitmentChangeOrders).toEqual([{ id: store.commitmentChangeOrders[0].id, ref: "SC-001-CO01", linked: true }]);
    expect(store.commitmentChangeOrders[0].primeChangeOrderId).toBe(converted.changeOrder.id);
    await expect(service.convertToChangeOrder({ ...scope, actor, changeEventId: event.id, payload: {} })).rejects.toMatchObject({ code: "CHANGE_EVENT_CONVERTED" });
    await expect(service.voidChangeEvent({ ...scope, actor, changeEventId: event.id, payload: { reason: "x" } })).rejects.toMatchObject({ code: "CHANGE_EVENT_CONVERTED" });
  });

  it("converts an unquoted event at ROM and creates commitment change orders for accepted quotes without one", async () => {
    const event = await createEvent();
    await service.sendRfqs({ ...scope, actor, changeEventId: event.id, payload: { recipients: [{ commitmentId: "cmt-1" }] } });
    const token = tokenOf(store.emails[0]);
    const view = await service.portalView(token);
    await service.portalSubmitQuote(token, { lines: [{ lineId: view.changeEvent.lines[0].id, amount: 11000 }] });
    await service.acceptQuote({ ...scope, actor, rfqId: store.rfqs[0].id, payload: {} });
    const converted = await service.convertToChangeOrder({ ...scope, actor, changeEventId: event.id, payload: { value: 13000 } });
    expect(converted.changeOrder.value).toBe(13000);
    expect(converted.commitmentChangeOrders).toEqual([{ id: store.commitmentChangeOrders[0].id, ref: "SC-001-CO01", linked: false }]);
    expect(store.commitmentChangeOrders[0]).toMatchObject({ primeChangeOrderId: converted.changeOrder.id, value: 11000 });
    expect(store.rfqs[0].commitmentChangeOrderId).toBe(store.commitmentChangeOrders[0].id);
  });

  it("reminds, cancels, rejects, closes and voids", async () => {
    const event = await createEvent();
    await service.sendRfqs({ ...scope, actor, changeEventId: event.id, payload: { recipients: [{ commitmentId: "cmt-1" }, { companyName: "Volt Bros", contactEmail: "vera@volt.example" }] } });
    const [rfq1, rfq2] = store.rfqs;
    const firstToken = tokenOf(store.emails[0]);
    const reminded = await service.remindRfq({ ...scope, actor, rfqId: rfq1.id });
    expect(reminded.remindersSent).toBe(1);
    expect(store.emails.at(-1).subject).toMatch(/^Reminder:/);
    await expect(service.portalView(firstToken)).rejects.toMatchObject({ code: "RFQ_LINK_INVALID" });
    const newToken = tokenOf(store.emails.at(-1));
    const view = await service.portalView(newToken);
    await service.portalSubmitQuote(newToken, { lines: [{ lineId: view.changeEvent.lines[0].id, amount: 9000 }] });
    const rejected = await service.rejectQuote({ ...scope, actor, rfqId: rfq1.id, payload: { reason: "Too high" } });
    expect(rejected).toMatchObject({ status: "rejected", rejectedReason: "Too high" });
    await expect(service.portalSubmitQuote(newToken, { lines: [{ lineId: view.changeEvent.lines[0].id, amount: 1 }] })).rejects.toMatchObject({ code: "RFQ_CLOSED" });
    const cancelled = await service.cancelRfq({ ...scope, actor, rfqId: rfq2.id });
    expect(cancelled.status).toBe("cancelled");
    await expect(service.portalView(tokenOf(store.emails[1]))).rejects.toMatchObject({ code: "RFQ_CANCELLED" });
    await expect(service.deleteChangeEvent({ ...scope, actor, changeEventId: event.id })).rejects.toMatchObject({ code: "CHANGE_EVENT_LOCKED" });
    const closed = await service.closeChangeEvent({ ...scope, actor, changeEventId: event.id, payload: { reason: "Owner withdrew the request" } });
    expect(closed.status).toBe("closed");
    expect(closed.notes).toContain("Closed: Owner withdrew the request");
    await expect(service.voidChangeEvent({ ...scope, actor, changeEventId: event.id, payload: {} })).rejects.toMatchObject({ code: "CHANGE_EVENT_REASON_REQUIRED" });
    const voided = await service.voidChangeEvent({ ...scope, actor, changeEventId: event.id, payload: { reason: "duplicate of CE-002" } });
    expect(voided).toMatchObject({ status: "void", voidReason: "duplicate of CE-002" });
    const fresh = await createEvent();
    expect((await service.deleteChangeEvent({ ...scope, actor, changeEventId: fresh.id })).deleted).toBe(true);
  });

  it("expires links", async () => {
    const event = await createEvent();
    await service.sendRfqs({ ...scope, actor, changeEventId: event.id, payload: { recipients: [{ commitmentId: "cmt-1" }] } });
    store.rfqs[0].expiresAt = new Date(Date.now() - 1000);
    await expect(service.portalView(tokenOf(store.emails[0]))).rejects.toMatchObject({ code: "RFQ_LINK_EXPIRED", status: 410 });
  });
});
