process.env.INTEGRATION_SECRET_KEY = "test-secret-key";
process.env.QBO_CLIENT_ID = "qbo-id";
process.env.QBO_CLIENT_SECRET = "qbo-secret";

const store = { connections: [], mappings: [], syncs: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;
const matches = (row, where = {}) =>
  Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
      if ("in" in expected) return expected.in.includes(row[key]);
      if ("not" in expected) return row[key] !== expected.not;
      if ("gte" in expected || "lte" in expected) return (!expected.gte || row[key] >= expected.gte) && (!expected.lte || row[key] <= expected.lte);
      return matches(row[key] || {}, expected);
    }
    return row[key] === expected;
  });
const table = (rows, prefix, include = (row) => row) => ({
  findMany: jest.fn(async ({ where } = {}) => rows.filter((row) => matches(row, where)).map(include)),
  findFirst: jest.fn(async ({ where } = {}) => {
    const row = rows.find((item) => matches(item, where));
    return row ? include(row) : null;
  }),
  findUnique: jest.fn(async ({ where }) => {
    const row = rows.find((item) => item.id === where.id);
    return row ? include(row) : null;
  }),
  create: jest.fn(async ({ data }) => {
    const row = { id: nextId(prefix), createdAt: new Date(), updatedAt: new Date(), attempts: 0, ...data };
    rows.push(row);
    return include(row);
  }),
  update: jest.fn(async ({ where, data }) => {
    const row = rows.find((item) => item.id === where.id);
    for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && "increment" in value ? (row[key] || 0) + value.increment : value;
    return include(row);
  }),
  upsert: jest.fn(async ({ where, update, create }) => {
    const key = Object.values(where)[0];
    const row = rows.find((item) => Object.entries(key).every(([k, v]) => item[k] === v));
    if (row) {
      Object.assign(row, update);
      return include(row);
    }
    const created = { id: nextId(prefix), createdAt: new Date(), updatedAt: new Date(), autoSyncPayApps: true, ...create };
    rows.push(created);
    return include(created);
  }),
  delete: jest.fn(async ({ where }) => rows.splice(rows.findIndex((item) => item.id === where.id), 1)[0]),
});

const PAY_APP = "33333333-3333-4333-8333-333333333333";
const payApp = {
  id: PAY_APP,
  projectId: "p1",
  ref: "SC-001-PA02",
  status: "approved",
  periodLabel: "Aug 2026",
  periodEnd: new Date("2026-08-31T00:00:00Z"),
  approvedAt: new Date("2026-09-03T10:00:00Z"),
  netThisPeriod: 9500,
  retentionThisPeriod: 500,
  backCharges: 0,
  paidAmount: 0,
  commitment: { id: "c1", ref: "SC-001", currency: "USD", vendorCompany: { id: "v1", name: "Delta Piling LLC", email: "ap@delta.example" } },
  lines: [
    { id: "l1", sovLineId: "sov-1", description: "Piles zone A", thisPeriodAmount: 6000, materialsOnSite: 0 },
    { id: "l2", sovLineId: "sov-2", description: "Pile caps", thisPeriodAmount: 3000, materialsOnSite: 1000 },
  ],
  project: { id: "p1", name: "Tower", currency: "USD" },
};
const mockPrisma = {
  accountingConnection: table(store.connections, "conn"),
  accountingCodeMapping: table(store.mappings, "map"),
  accountingSync: table(store.syncs, "sync", (row) => ({ ...row, project: { id: "p1", name: "Tower" } })),
  subPayApp: { findFirst: jest.fn(async () => payApp), findMany: jest.fn(async () => [payApp]) },
  commitmentSovLine: { findMany: jest.fn(async () => [{ id: "sov-1", costCodeId: "pcc-1", budgetLineId: null, description: "Piles" }, { id: "sov-2", costCodeId: null, budgetLineId: "bl-1", description: "Caps" }]) },
  budgetLine: { findMany: jest.fn(async () => [{ id: "bl-1", costCodeId: "pcc-2" }]) },
  projectCostCode: { findMany: jest.fn(async () => [{ id: "pcc-1", costCode: { id: "cc-1", code: "02-300", name: "Piling" } }, { id: "pcc-2", costCode: { id: "cc-2", code: "03-100", name: "Concrete" } }]) },
};
const mockAudit = { ENTITY_TYPES: { ACCOUNTING_CONNECTION: "accounting_connection" }, ACTIONS: { CREATED: "created", UPDATED: "updated" }, recordEvent: jest.fn(async () => ({})) };
const mockNotifications = { NOTIFICATION_CATEGORIES: { COMMERCIAL: "commercial" }, createNotifications: jest.fn(async () => ({ created: 1 })) };
const mockJobs = { JOB_TYPES: { ACCOUNTING_SYNC: "accounting.sync", ACCOUNTING_POLL: "accounting.poll" }, enqueueJob: jest.fn(async () => ({ id: "job-1" })) };
const mockPayApps = { recordPayment: jest.fn(async () => ({ status: "paid" })) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);
jest.mock("../notification.service", () => mockNotifications);
jest.mock("../../jobs/job.service", () => mockJobs);
jest.mock("../sub-pay-app.service", () => mockPayApps);

const secretBox = require("../../utils/secret-box");
const service = require("../accounting.service");

const actor = { id: "fin-1", role: "finance" };
const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

/** A fake QuickBooks: records what OctaPM sends and answers like the sandbox. */
const fakeQbo = () => {
  const calls = [];
  let paid = false;
  const fetchImpl = jest.fn(async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/oauth2/v1/tokens/bearer")) return jsonResponse({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
    if (url.includes("/companyinfo/")) return jsonResponse({ CompanyInfo: { CompanyName: "Delta Sandbox Co" } });
    if (url.includes("/query")) {
      const query = decodeURIComponent(new URL(url).searchParams.get("query"));
      if (query.includes("from Vendor")) return jsonResponse({ QueryResponse: { Vendor: [] } });
      if (query.includes("from Account")) return jsonResponse({ QueryResponse: { Account: [{ Id: "61", Name: "Subcontractors", AcctNum: "6100", AccountType: "Expense" }] } });
    }
    if (url.endsWith("/vendor?minorversion=70") || url.includes("/vendor?")) return jsonResponse({ Vendor: { Id: "V-9", DisplayName: JSON.parse(options.body).DisplayName } });
    if (url.includes("/bill?")) return jsonResponse({ Bill: { Id: "B-42", DocNumber: JSON.parse(options.body).DocNumber } });
    if (url.includes("/bill/B-42")) return jsonResponse({ Bill: { Id: "B-42", TotalAmt: 9500, Balance: paid ? 0 : 9500, MetaData: { LastUpdatedTime: "2026-09-20T09:00:00Z" } } });
    return jsonResponse({ Fault: { Error: [{ Message: "unexpected", Detail: url }] } }, 404);
  });
  return { fetchImpl, calls, markPaid: () => (paid = true) };
};

describe("accounting connectors", () => {
  beforeEach(() => {
    for (const rows of Object.values(store)) rows.length = 0;
    jest.clearAllMocks();
  });

  it("connects through OAuth with a signed state and stores encrypted tokens", async () => {
    const start = await service.startConnect({ orgId: "org-1", provider: "qbo", actor });
    expect(start.url).toMatch(/^https:\/\/appcenter\.intuit\.com\/connect\/oauth2\?/);
    const state = new URL(start.url).searchParams.get("state");
    expect(state.startsWith("org-1.qbo.")).toBe(true);
    await expect(service.completeConnect({ provider: "qbo", code: "abc", state: "org-1.qbo.wrong", realmId: "123" })).rejects.toMatchObject({ code: "ACCOUNTING_STATE_INVALID" });
    const qbo = fakeQbo();
    const done = await service.completeConnect({ provider: "qbo", code: "abc", state, realmId: "123", fetchImpl: qbo.fetchImpl });
    expect(done).toMatchObject({ orgId: "org-1", provider: "qbo", externalOrgName: "Delta Sandbox Co" });
    expect(store.connections[0]).toMatchObject({ status: "connected", externalOrgId: "123" });
    expect(store.connections[0].credentialsJson).toMatch(/^v1\./);
    expect(secretBox.decrypt(store.connections[0].credentialsJson)).toMatchObject({ accessToken: "at", refreshToken: "rt", realmId: "123" });
    const listed = await service.listConnections({ orgId: "org-1" });
    expect(listed.find((item) => item.provider === "qbo")).toMatchObject({ status: "connected", configured: true, encryptionReady: true, autoSyncPayApps: true });
    expect(listed.find((item) => item.provider === "xero")).toMatchObject({ status: "disconnected", configured: false });
  });

  it("builds bill lines by cost code through the mapping and reports missing codes", async () => {
    store.mappings.push({ id: "m1", orgId: "org-1", provider: "qbo", costCode: "02-300", externalAccountId: "61", externalAccountName: "Subcontractors" });
    const partial = await service.billLinesFor({ payApp, mappings: new Map(store.mappings.map((row) => [row.costCode, row])), provider: "qbo" });
    expect(partial.missing).toEqual(["03-100", "retention"]);
    store.mappings.push({ id: "m2", orgId: "org-1", provider: "qbo", costCode: "*", externalAccountId: "60", externalAccountName: "Construction costs" });
    const bill = await service.billLinesFor({ payApp, mappings: new Map(store.mappings.map((row) => [row.costCode, row])), provider: "qbo" });
    expect(bill.missing).toEqual([]);
    expect(bill.lines.map((line) => [line.costCode, line.amount, line.accountId])).toEqual([["02-300", 6000, "61"], ["03-100", 4000, "60"], ["retention", -500, "60"]]);
    expect(bill.total).toBe(9500);
  });

  it("posts an approved pay application as a bill, then records the payment when the bill is paid", async () => {
    const qbo = fakeQbo();
    store.connections.push({ id: "conn-1", orgId: "org-1", provider: "qbo", status: "connected", autoSyncPayApps: true, credentialsJson: secretBox.encrypt({ accessToken: "at", refreshToken: "rt", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), realmId: "123" }) });
    store.mappings.push({ id: "m1", orgId: "org-1", provider: "qbo", costCode: "*", externalAccountId: "60", externalAccountName: "Construction costs" });

    const queued = await service.maybeQueueOnApproval({ orgId: "org-1", projectId: "p1", payAppId: PAY_APP, actor });
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ provider: "qbo", status: "pending", amount: 9500, currency: "USD" });
    expect(mockJobs.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: "accounting.sync", maxAttempts: 5, payload: { syncId: queued[0].id } }));

    const result = await service.runSyncJob({ payload: { syncId: queued[0].id }, fetchImpl: qbo.fetchImpl });
    expect(result).toMatchObject({ synced: true, billId: "B-42", total: 9500 });
    expect(store.syncs[0]).toMatchObject({ status: "synced", externalId: "B-42", externalRef: "SC-001-PA02", externalVendorId: "V-9" });
    const billCall = qbo.calls.find((call) => call.url.includes("/bill?"));
    const sent = JSON.parse(billCall.options.body);
    expect(sent).toMatchObject({ VendorRef: { value: "V-9" }, DocNumber: "SC-001-PA02", TxnDate: "2026-09-03", CurrencyRef: { value: "USD" } });
    expect(sent.Line.map((line) => line.Amount)).toEqual([6000, 4000, -500]);
    expect(sent.Line[0].AccountBasedExpenseLineDetail).toEqual({ AccountRef: { value: "60" } });
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "accounting.synced", recipientRoles: ["finance"] }));
    // queuing again does not create a second bill
    const again = await service.queuePayAppSync({ orgId: "org-1", projectId: "p1", payAppId: PAY_APP, actor });
    expect(again[0].status).toBe("synced");
    expect(store.syncs).toHaveLength(1);

    // still open → nothing; paid → payment recorded on the application
    await expect(service.pollPayments({ orgId: "org-1", fetchImpl: qbo.fetchImpl })).resolves.toEqual({ checked: 1, paid: 0 });
    expect(mockPayApps.recordPayment).not.toHaveBeenCalled();
    qbo.markPaid();
    await expect(service.pollPayments({ orgId: "org-1", fetchImpl: qbo.fetchImpl })).resolves.toEqual({ checked: 1, paid: 1 });
    expect(mockPayApps.recordPayment).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", projectId: "p1", payAppId: PAY_APP, payload: expect.objectContaining({ amount: 9500, method: "QuickBooks Online", reference: "SC-001-PA02" }) }));
    expect(store.syncs[0]).toMatchObject({ status: "paid", paidAmount: 9500 });
  });

  it("fails for good when a cost code is unmapped and retries provider outages", async () => {
    store.connections.push({ id: "conn-1", orgId: "org-1", provider: "qbo", status: "connected", autoSyncPayApps: true, credentialsJson: secretBox.encrypt({ accessToken: "at", refreshToken: "rt", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), realmId: "123" }) });
    const [sync] = await service.queuePayAppSync({ orgId: "org-1", projectId: "p1", payAppId: PAY_APP, actor });
    await expect(service.runSyncJob({ payload: { syncId: sync.id }, fetchImpl: jest.fn() })).rejects.toMatchObject({ retryable: false, code: "ACCOUNTING_MAPPING_MISSING" });
    expect(store.syncs[0]).toMatchObject({ status: "failed", attempts: 1 });
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "accounting.sync_failed" }));

    store.mappings.push({ id: "m1", orgId: "org-1", provider: "qbo", costCode: "*", externalAccountId: "60" });
    const retried = await service.retrySync({ orgId: "org-1", syncId: sync.id, actor });
    expect(retried).toMatchObject({ status: "pending", attempts: 0 });
    const outage = jest.fn(async () => jsonResponse({ Fault: { Error: [{ Message: "Service Unavailable" }] } }, 503));
    await expect(service.runSyncJob({ payload: { syncId: sync.id }, fetchImpl: outage })).rejects.toMatchObject({ retryable: true });
    expect(store.syncs[0]).toMatchObject({ status: "pending", attempts: 1 });
  });

  it("exports approved costs by cost code as XLSX and CSV", async () => {
    store.mappings.push({ id: "m1", orgId: "org-1", provider: "xero", costCode: "02-300", externalAccountId: "300", externalAccountName: "Subcontractors" });
    const data = await service.exportRows({ orgId: "org-1", projectId: "p1", provider: "xero" });
    expect(data.rows.map((row) => [row.costCode, row.amount, row.externalAccount])).toEqual([["02-300", 6000, "300"], ["03-100", 4000, ""], ["retention", -500, ""]]);
    expect(data.summary.map((row) => [row.costCode, row.amount])).toEqual([["02-300", 6000], ["03-100", 4000], ["retention", -500]]);
    const csv = await service.renderExport({ orgId: "org-1", projectId: "p1", format: "csv" });
    expect(csv.fileName).toMatch(/^accounting-export-.*\.csv$/);
    expect(csv.buffer.toString("utf8")).toContain("Tower,Delta Piling LLC,SC-001,SC-001-PA02,Aug 2026,2026-09-03,approved,02-300,Piling");
    const xlsx = await service.renderExport({ orgId: "org-1", format: "xlsx" });
    expect(xlsx.buffer.subarray(0, 2).toString()).toBe("PK");
    expect(xlsx.rows).toBe(3);
  });
});
