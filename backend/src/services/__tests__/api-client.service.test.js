const rows = [];
const mockTrace = [];
const mockOwnerEpoch = { value: 0 };
// auth.service's holdCredentialEpoch, recorded: the live proof (d-id-1-keys-proof.js K5) holds the real row.
const mockHold = jest.fn(async (tx, userId, epoch) => {
  mockTrace.push(`hold ${userId} ${epoch}`);
});
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
  user: {
    findFirst: jest.fn(async ({ where }) => (where.id === owner.id ? owner : null)),
    // The epoch a caller without one is held at (Q-KEY fallback).
    findUnique: jest.fn(async ({ where }) => (where.id === owner.id ? { credentialEpoch: mockOwnerEpoch.value } : null)),
  },
  // The hold and the key write share one transaction (Q-KEY).
  $transaction: jest.fn(async (fn) => {
    mockTrace.push("begin");
    const result = await fn(mockPrisma);
    mockTrace.push("commit");
    return result;
  }),
  project: { findMany: jest.fn(async ({ where }) => where.id.in.filter((id) => id.startsWith("p")).map((id) => ({ id }))) },
};
const mockAudit = { ENTITY_TYPES: { API_CLIENT: "api_client" }, ACTIONS: { CREATED: "created", UPDATED: "updated", DELETED: "deleted" }, recordEvent: jest.fn(async () => ({})) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);
jest.mock("../auth.service", () => ({ holdCredentialEpoch: (...args) => mockHold(...args) }));

const service = require("../api-client.service");

describe("api clients", () => {
  beforeEach(() => {
    rows.length = 0;
    mockTrace.length = 0;
    mockOwnerEpoch.value = 0;
    jest.clearAllMocks();
  });

  // Owner decision Q-KEY: a new key, or a change to what one may reach, is
  // written in the transaction that holds the caller's credential epoch, so a
  // session a credential event has ended cannot mint access; a revocation
  // never waits on it.
  describe("the actor's credential epoch (Q-KEY)", () => {
    const actor = { ...owner, credentialEpoch: 3 };

    it("creates a key inside a transaction that first holds the session's epoch", async () => {
      mockPrisma.apiClient.create.mockImplementationOnce(async (args) => {
        mockTrace.push("create");
        const row = { id: "key-1", status: "active", createdAt: new Date(), updatedAt: new Date(), lastUsedAt: null, revokedAt: null, ...args.data, user: owner };
        rows.push(row);
        return row;
      });
      await service.createApiClient({ orgId: "org-1", actor, payload: { name: "ERP", scopes: ["*:read"] } });
      expect(mockTrace).toEqual(["begin", "hold u-1 3", "create", "commit"]);
      expect(rows[0].createdBy).toBe("u-1");
    });

    it("writes no key when the hold refuses (401 SESSION_REVOKED)", async () => {
      mockHold.mockRejectedValueOnce(Object.assign(new Error("This session has ended; sign in again"), { status: 401, code: "SESSION_REVOKED" }));
      await expect(service.createApiClient({ orgId: "org-1", actor, payload: { name: "ERP", scopes: ["*:read"] } })).rejects.toMatchObject({ status: 401, code: "SESSION_REVOKED" });
      expect(mockPrisma.apiClient.create).not.toHaveBeenCalled();
      expect(mockAudit.recordEvent).not.toHaveBeenCalled();
      expect(rows).toHaveLength(0);
    });

    it("holds a caller that carries no epoch at the epoch the row has now", async () => {
      mockOwnerEpoch.value = 7;
      await service.createApiClient({ orgId: "org-1", actor: owner, payload: { name: "ERP", scopes: ["*:read"] } });
      expect(mockHold).toHaveBeenCalledWith(mockPrisma, "u-1", 7);
    });

    it("refuses 401 SESSION_REVOKED, and writes nothing, when no epoch can be found for the caller", async () => {
      await expect(service.createApiClient({ orgId: "org-1", actor: { ...owner, id: "u-gone" }, payload: { name: "ERP", scopes: ["*:read"], userId: "u-1" } })).rejects.toMatchObject({ status: 401, code: "SESSION_REVOKED" });
      expect(mockHold).not.toHaveBeenCalled();
      expect(rows).toHaveLength(0);
    });

    it("holds the epoch for a change to scopes, projects or expiry, and never for a rename or a revocation", async () => {
      const created = await service.createApiClient({ orgId: "org-1", actor, payload: { name: "Reader", scopes: ["rfi:read"] } });
      mockHold.mockClear();
      await service.updateApiClient({ orgId: "org-1", actor, apiClientId: created.id, payload: { scopes: ["*:write"] } });
      expect(mockHold).toHaveBeenCalledTimes(1);
      expect(mockHold).toHaveBeenCalledWith(mockPrisma, "u-1", 3);
      mockHold.mockClear();
      await service.updateApiClient({ orgId: "org-1", actor, apiClientId: created.id, payload: { name: "Renamed" } });
      await service.revokeApiClient({ orgId: "org-1", actor, apiClientId: created.id });
      expect(mockHold).not.toHaveBeenCalled();
      expect(rows[0]).toMatchObject({ name: "Renamed", scopes: ["*:write"], status: "revoked" });
    });

    it("leaves the key unchanged when the hold refuses a widening", async () => {
      const created = await service.createApiClient({ orgId: "org-1", actor, payload: { name: "Reader", scopes: ["rfi:read"] } });
      mockHold.mockRejectedValueOnce(Object.assign(new Error("ended"), { status: 401, code: "SESSION_REVOKED" }));
      await expect(service.updateApiClient({ orgId: "org-1", actor, apiClientId: created.id, payload: { scopes: ["*:write"] } })).rejects.toMatchObject({ code: "SESSION_REVOKED" });
      expect(mockPrisma.apiClient.update).not.toHaveBeenCalled();
      expect(rows[0].scopes).toEqual(["rfi:read"]);
    });

    it.each([
      ["its projects (all projects)", { projectIds: [] }],
      ["its projects (another project)", { projectIds: ["p2"] }],
      ["its expiry (none)", { expiresAt: null }],
      ["its expiry (later)", { expiresAt: "2099-01-01T00:00:00Z" }],
    ])("holds the epoch for a change to %s", async (_label, payload) => {
      const created = await service.createApiClient({ orgId: "org-1", actor, payload: { name: "Reader", scopes: ["rfi:read"], projectIds: ["p1"], expiresAt: "2030-01-01T00:00:00Z" } });
      mockHold.mockClear();
      await service.updateApiClient({ orgId: "org-1", actor, apiClientId: created.id, payload });
      expect(mockHold).toHaveBeenCalledWith(mockPrisma, "u-1", 3);
    });

    // Codex Q-KEY review H2: a reach field resent unchanged must not be written
    // back, or it restores what a concurrent narrowing just removed, unheld.
    it("leaves reach fields resent unchanged out of the write, and holds nothing for them", async () => {
      const created = await service.createApiClient({ orgId: "org-1", actor, payload: { name: "Reader", scopes: ["rfi:read"], projectIds: ["p1"], expiresAt: "2030-01-01T00:00:00Z" } });
      mockHold.mockClear();
      mockPrisma.apiClient.update.mockClear();
      await service.updateApiClient({ orgId: "org-1", actor, apiClientId: created.id, payload: { name: "Renamed", scopes: ["rfi:read"], projectIds: ["p1"], expiresAt: "2030-01-01T00:00:00Z" } });
      expect(mockHold).not.toHaveBeenCalled();
      const written = mockPrisma.apiClient.update.mock.calls[0][0].data;
      expect(written).toMatchObject({ name: "Renamed" });
      expect(written).not.toHaveProperty("scopes");
      expect(written).not.toHaveProperty("projectIds");
      expect(written).not.toHaveProperty("expiresAt");
    });
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

  // Codex D-ID-1 diff review r2 #6: a key is access. While the emergency
  // membership switch is off (owner decision D-ID-1 Q10) no key is created, and
  // what a key may reach — its scopes, its projects, how long it lives — is not
  // changed; renaming, describing and revoking a key still work.
  describe("the emergency membership switch (AUTH_MEMBERSHIP_WRITE=false)", () => {
    let previous;
    const switchOff = () => {
      process.env.AUTH_MEMBERSHIP_WRITE = "false";
    };
    beforeEach(() => {
      previous = process.env.AUTH_MEMBERSHIP_WRITE;
      delete process.env.AUTH_MEMBERSHIP_WRITE;
    });
    afterEach(() => {
      if (previous === undefined) delete process.env.AUTH_MEMBERSHIP_WRITE;
      else process.env.AUTH_MEMBERSHIP_WRITE = previous;
    });

    it.each([
      ["a write-everything key", { name: "Writer", scopes: ["*:write"] }],
      ["a read-only key limited to a project", { name: "Reader", scopes: ["rfi:read"], projectIds: ["p1"] }],
    ])("refuses to create %s (503 MEMBERSHIP_WRITES_SUSPENDED) before anything is read or written", async (_label, payload) => {
      switchOff();
      await expect(service.createApiClient({ orgId: "org-1", actor: owner, payload })).rejects.toMatchObject({ status: 503, code: "MEMBERSHIP_WRITES_SUSPENDED" });
      expect(mockPrisma.apiClient.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.project.findMany).not.toHaveBeenCalled();
      expect(mockAudit.recordEvent).not.toHaveBeenCalled();
      expect(rows).toHaveLength(0);
    });

    it.each([
      ["broader scopes", { scopes: ["*:write"] }],
      ["no project restriction (projectIds: [])", { projectIds: [] }],
      ["other projects", { projectIds: ["p2"] }],
      ["no expiry (expiresAt: null)", { expiresAt: null }],
      ["a later expiry", { expiresAt: "2099-01-01T00:00:00Z" }],
      ["broader scopes beside a rename", { name: "Renamed", scopes: ["*:write"] }],
    ])("refuses to change a key to %s (503), and the key is unchanged", async (_label, payload) => {
      const created = await service.createApiClient({ orgId: "org-1", actor: owner, payload: { name: "Reader", scopes: ["rfi:read"], projectIds: ["p1"], expiresAt: "2030-01-01T00:00:00Z" } });
      const before = { ...rows[0] };
      jest.clearAllMocks();
      switchOff();
      await expect(service.updateApiClient({ orgId: "org-1", actor: owner, apiClientId: created.id, payload })).rejects.toMatchObject({ status: 503, code: "MEMBERSHIP_WRITES_SUSPENDED" });
      // The guard compares the new values with the key's (review fix: a form that
      // resends them unchanged must pass), so the project ids may be resolved
      // first — a read; nothing is written.
      expect(mockPrisma.apiClient.update).not.toHaveBeenCalled();
      expect(rows[0]).toEqual(before);
    });

    it("lets a rename through with the switch off when the form resends the same scopes, projects and expiry", async () => {
      const created = await service.createApiClient({ orgId: "org-1", actor: owner, payload: { name: "Reader", scopes: ["rfi:read"], projectIds: ["p1"], expiresAt: "2030-01-01T00:00:00Z" } });
      switchOff();
      const renamed = await service.updateApiClient({ orgId: "org-1", actor: owner, apiClientId: created.id, payload: { name: "Renamed", scopes: ["rfi:read"], projectIds: ["p1"], expiresAt: "2030-01-01T00:00:00Z" } });
      expect(renamed).toMatchObject({ name: "Renamed", scopes: ["rfi:read"], projectIds: ["p1"] });
    });

    it("still renames, describes and revokes a key while the switch is off", async () => {
      const created = await service.createApiClient({ orgId: "org-1", actor: owner, payload: { name: "Reader", scopes: ["rfi:read"], projectIds: ["p1"] } });
      switchOff();
      const renamed = await service.updateApiClient({ orgId: "org-1", actor: owner, apiClientId: created.id, payload: { name: "ERP reader", description: "Nightly sync" } });
      expect(renamed).toMatchObject({ name: "ERP reader", description: "Nightly sync", scopes: ["rfi:read"], projectIds: ["p1"], status: "active" });
      const revoked = await service.revokeApiClient({ orgId: "org-1", actor: owner, apiClientId: created.id });
      expect(revoked).toMatchObject({ status: "revoked", revokedAt: expect.any(String) });
      await expect(service.authenticateApiKey(created.token)).rejects.toMatchObject({ code: "API_KEY_INVALID" });
    });

    it("lets the same changes through with the switch on", async () => {
      const created = await service.createApiClient({ orgId: "org-1", actor: owner, payload: { name: "Reader", scopes: ["rfi:read"], projectIds: ["p1"] } });
      const widened = await service.updateApiClient({ orgId: "org-1", actor: owner, apiClientId: created.id, payload: { scopes: ["*:write"], projectIds: [], expiresAt: null } });
      expect(widened).toMatchObject({ scopes: ["*:write"], projectIds: [], expiresAt: null });
    });
  });
});
