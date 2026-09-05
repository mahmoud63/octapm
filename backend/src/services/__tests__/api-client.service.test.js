const rows = [];
const owner = { id: "u-1", name: "Pat", email: "pat@example.com", role: "qs", status: "active", isCompanyAdmin: false, orgId: "org-1" };
const mockPrisma = {
  apiClient: {
    create: jest.fn(async ({ data }) => {
      const row = { id: `key-${rows.length + 1}`, status: "active", createdAt: new Date(), updatedAt: new Date(), lastUsedAt: null, revokedAt: null, ...data, user: owner };
      rows.push(row);
      return row;
    }),
    findMany: jest.fn(async ({ where }) => rows.filter((row) => row.orgId === where.orgId && (!where.status || row.status === where.status))),
    findFirst: jest.fn(async ({ where }) => rows.find((row) => row.id === where.id && row.orgId === where.orgId) || null),
    findUnique: jest.fn(async ({ where }) => rows.find((row) => row.keyHash === where.keyHash) || null),
    update: jest.fn(async ({ where, data }) => {
      const row = rows.find((item) => item.id === where.id);
      Object.assign(row, data);
      return { ...row, user: owner };
    }),
  },
  user: { findFirst: jest.fn(async ({ where }) => (where.id === owner.id ? owner : null)) },
  project: { findMany: jest.fn(async ({ where }) => where.id.in.filter((id) => id.startsWith("p")).map((id) => ({ id }))) },
};
const mockAudit = { ENTITY_TYPES: { API_CLIENT: "api_client" }, ACTIONS: { CREATED: "created", UPDATED: "updated", DELETED: "deleted" }, recordEvent: jest.fn(async () => ({})) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);

const service = require("../api-client.service");

describe("api clients", () => {
  beforeEach(() => {
    rows.length = 0;
    jest.clearAllMocks();
  });

  it("creates a key shown once, stores only its hash and validates scopes", async () => {
    await expect(service.createApiClient({ orgId: "org-1", actor: owner, payload: { name: "ERP", scopes: ["rfi:fly"] } })).rejects.toMatchObject({ code: "API_SCOPE_UNKNOWN" });
    await expect(service.createApiClient({ orgId: "org-1", actor: owner, payload: { name: "ERP", scopes: [] } })).rejects.toMatchObject({ code: "API_SCOPE_REQUIRED" });
    await expect(service.createApiClient({ orgId: "org-1", actor: owner, payload: { name: "ERP", scopes: ["rfi:read"], projectIds: ["p1", "zzz"] } })).rejects.toMatchObject({ code: "API_PROJECT_UNKNOWN" });
    const created = await service.createApiClient({ orgId: "org-1", actor: owner, payload: { name: "ERP sync", scopes: ["RFI:read", "sub_pay_app:write"], projectIds: ["p1"] } });
    expect(created.token).toMatch(/^octapm_[A-Za-z0-9_-]{32}$/);
    expect(created.keyPrefix).toBe(created.token.slice(0, 15));
    expect(created.scopes).toEqual(["rfi:read", "sub_pay_app:write"]);
    expect(rows[0].keyHash).toBe(service.hashKey(created.token));
    expect(rows[0].keyHash).not.toContain(created.token);
    const listed = await service.listApiClients({ orgId: "org-1" });
    expect(listed[0].token).toBeUndefined();
    expect(listed[0].owner).toMatchObject({ email: "pat@example.com", role: "qs" });
  });

  it("authenticates a key as its owner and refuses revoked, expired or unknown keys", async () => {
    const created = await service.createApiClient({ orgId: "org-1", actor: owner, payload: { name: "Reader", scopes: ["*:read"] } });
    const principal = await service.authenticateApiKey(created.token);
    expect(principal.user).toMatchObject({ id: "u-1", orgId: "org-1", role: "qs", isCompanyAdmin: false });
    expect(principal.apiClient).toMatchObject({ id: created.id, scopes: ["*:read"], projectIds: [] });
    await expect(service.authenticateApiKey("octapm_nope")).rejects.toMatchObject({ code: "API_KEY_INVALID" });
    await service.revokeApiClient({ orgId: "org-1", actor: owner, apiClientId: created.id });
    await expect(service.authenticateApiKey(created.token)).rejects.toMatchObject({ code: "API_KEY_INVALID" });
    const expiring = await service.createApiClient({ orgId: "org-1", actor: owner, payload: { name: "Old", scopes: ["*:read"], expiresAt: "2020-01-01T00:00:00Z" } });
    await expect(service.authenticateApiKey(expiring.token)).rejects.toMatchObject({ code: "API_KEY_EXPIRED" });
  });

  it("scopes: writes imply reads, wildcards cover every module, exports count as reads", () => {
    expect(service.scopeAllows({ scopes: ["rfi:read"] }, "rfi", "read")).toBe(true);
    expect(service.scopeAllows({ scopes: ["rfi:read"] }, "rfi", "export")).toBe(true);
    expect(service.scopeAllows({ scopes: ["rfi:read"] }, "rfi", "create")).toBe(false);
    expect(service.scopeAllows({ scopes: ["rfi:write"] }, "rfi", "read")).toBe(true);
    expect(service.scopeAllows({ scopes: ["rfi:write"] }, "submittal", "read")).toBe(false);
    expect(service.scopeAllows({ scopes: ["*:read"] }, "submittal", "read")).toBe(true);
    expect(service.scopeAllows({ scopes: ["*:read"] }, "submittal", "update")).toBe(false);
    expect(service.scopeAllows({ scopes: ["*:write"] }, "anything", "delete")).toBe(true);
    expect(service.describeScopes().some((item) => item.scope === "sub_pay_app:write")).toBe(true);
  });
});
