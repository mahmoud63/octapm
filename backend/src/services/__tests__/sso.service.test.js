const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const store = { orgs: [], users: [], memberships: [], tickets: [], audit: [], sessions: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;

// A small `where` matcher for the membership double: equality on plain
// values, plus the `{ not }` / `{ in }` shapes the service and its helpers use.
const matches = (row, where = {}) =>
  Object.entries(where).every(([key, wanted]) => {
    if (wanted && typeof wanted === "object" && !Array.isArray(wanted)) {
      if ("not" in wanted) return row[key] !== wanted.not;
      if ("in" in wanted) return wanted.in.includes(row[key]);
      return true;
    }
    return row[key] === wanted;
  });
const withRelations = (membership) =>
  membership
    ? {
        ...membership,
        org: store.orgs.find((org) => org.id === membership.orgId) || null,
        user: store.users.find((user) => user.id === membership.userId) || null,
      }
    : null;

// The nullable unique index on (orgId, ssoSubject).
const assertSubjectFree = (next) => {
  if (next.ssoSubject && store.memberships.some((row) => row.id !== next.id && row.orgId === next.orgId && row.ssoSubject === next.ssoSubject)) {
    throw Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: ["orgId", "ssoSubject"] } });
  }
};

// What happened, in order, and whether inside a transaction.
const trace = [];
let txDepth = 0;

// The epoch hold (auth.service holdCredentialEpoch): a raw
// `SELECT "id" FROM "User" WHERE "id" = $1 AND "credentialEpoch" = $2 AND "status" = 'active' FOR NO KEY UPDATE`
// (FOR SHARE until D-ID-1 R1), evaluated against the store by the columns the
// statement names.
const evaluateUserHold = (strings, values) => {
  const sql = strings.join("?");
  if (!/FROM "User"/.test(sql)) throw new Error(`unexpected raw query: ${sql}`);
  const conditions = [];
  strings.slice(0, -1).forEach((segment, index) => {
    const column = segment.match(/"(\w+)"\s*=\s*$/);
    if (column) conditions.push([column[1], values[index]]);
  });
  for (const literal of sql.matchAll(/"(\w+)"\s*=\s*'([^']*)'/g)) conditions.push([literal[1], literal[2]]);
  return store.users
    .filter((user) => conditions.every(([column, value]) => (column === "credentialEpoch" ? user[column] ?? 0 : user[column]) === value))
    .map((user) => ({ id: user.id }));
};

const mockPrisma = {
  organisation: {
    findUnique: jest.fn(async ({ where }) => store.orgs.find((org) => org.id === where.id) || null),
    findFirst: jest.fn(async ({ where }) => store.orgs.find((org) => org.id === where.id && (where.ssoEnabled === undefined || org.ssoEnabled === where.ssoEnabled)) || null),
    findMany: jest.fn(async ({ where }) => store.orgs.filter((org) => (where.ssoEnabled === undefined || org.ssoEnabled === where.ssoEnabled) && (where.status === undefined || org.status === where.status))),
    update: jest.fn(async ({ where, data }) => {
      const index = store.orgs.findIndex((org) => org.id === where.id);
      store.orgs[index] = { ...store.orgs[index], ...data };
      return { ...store.orgs[index] };
    }),
  },
  user: {
    findUnique: jest.fn(async ({ where, select }) => {
      const row = store.users.find((user) => user.email === where.email || user.id === where.id);
      if (!row) return null;
      return select?.org ? { ...row, org: store.orgs.find((org) => org.id === row.orgId) } : { ...row };
    }),
    findFirst: jest.fn(async ({ where }) => store.users.find((user) => matches(user, { id: where.id, orgId: where.orgId })) || null),
    findMany: jest.fn(async ({ where }) => store.users.filter((user) => user.orgId === where.orgId).map((user) => ({ ...user }))),
    create: jest.fn(async ({ data }) => {
      const row = { id: nextId("user"), ...data };
      store.users.push(row);
      return { ...row };
    }),
    update: jest.fn(async ({ where, data }) => {
      const index = store.users.findIndex((user) => user.id === where.id);
      store.users[index] = { ...store.users[index], ...data };
      return { ...store.users[index] };
    }),
  },
  // The SSO link lives on the membership (owner decision D-ID-1 Q2), unique per (orgId, ssoSubject).
  organizationMembership: {
    findFirst: jest.fn(async ({ where }) => withRelations(store.memberships.find((row) => matches(row, where)))),
    findMany: jest.fn(async ({ where }) => store.memberships.filter((row) => matches(row, where)).map(withRelations)),
    count: jest.fn(async ({ where }) => store.memberships.filter((row) => matches(row, where)).length),
    create: jest.fn(async ({ data }) => {
      const row = { id: nextId("membership"), ssoSubject: null, ssoLinkedAt: null, ...data };
      store.memberships.push(row);
      return withRelations(row);
    }),
    update: jest.fn(async ({ where, data }) => {
      const index = store.memberships.findIndex((row) => row.id === where.id);
      const next = { ...store.memberships[index], ...data };
      assertSubjectFree(next);
      store.memberships[index] = next;
      return withRelations(next);
    }),
    // The first link is a conditional write (Codex D-ID-1 diff review #11):
    // `{ id, ssoSubject: null }` matches only a row still unlinked.
    updateMany: jest.fn(async ({ where, data }) => {
      let count = 0;
      for (const [index, row] of store.memberships.entries()) {
        if (!matches(row, where)) continue;
        const next = { ...row, ...data };
        assertSubjectFree(next);
        store.memberships[index] = next;
        count += 1;
      }
      return { count };
    }),
    findUnique: jest.fn(async ({ where }) => {
      const row = store.memberships.find((membership) => membership.id === where.id);
      return row ? { ...row } : null;
    }),
  },
  ssoTicket: {
    create: jest.fn(async ({ data }) => {
      trace.push({ kind: "ticket", inTransaction: txDepth > 0 });
      const row = { id: nextId("ticket"), usedAt: null, ...data };
      store.tickets.push(row);
      return row;
    }),
    findUnique: jest.fn(async ({ where }) => {
      const row = store.tickets.find((ticket) => ticket.tokenHash === where.tokenHash);
      return row ? { ...row, user: store.users.find((user) => user.id === row.userId) } : null;
    }),
    update: jest.fn(async ({ where, data }) => {
      const index = store.tickets.findIndex((ticket) => ticket.id === where.id);
      store.tickets[index] = { ...store.tickets[index], ...data };
      return store.tickets[index];
    }),
    updateMany: jest.fn(async ({ where, data }) => {
      const index = store.tickets.findIndex((ticket) => ticket.id === where.id && (where.usedAt !== null || !ticket.usedAt) && (!where.expiresAt || ticket.expiresAt >= where.expiresAt.gte));
      if (index < 0) return { count: 0 };
      store.tickets[index] = { ...store.tickets[index], ...data };
      return { count: 1 };
    }),
  },
  refreshSession: {
    create: jest.fn(async ({ data }) => {
      trace.push({ kind: "session", inTransaction: txDepth > 0 });
      return store.sessions.push(data);
    }),
  },
  authAuditEvent: { create: jest.fn(async ({ data }) => store.audit.push(data)) },
  $queryRaw: jest.fn(async (strings, ...values) => {
    trace.push({ kind: "query", sql: strings.join("?"), values, inTransaction: txDepth > 0 });
    return evaluateUserHold(strings, values);
  }),
  $transaction: jest.fn(async (fn) => {
    txDepth += 1;
    try {
      return await fn(mockPrisma);
    } finally {
      txDepth -= 1;
    }
  }),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

const ssoService = require("../sso.service");

const ISSUER = "https://login.example.test/tenant";
const CLIENT_ID = "octapm-client";
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "key-1", use: "sig", alg: "RS256" };
const discovery = { issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/keys`, scopes_supported: ["openid", "email", "profile"], code_challenge_methods_supported: ["S256"] };
const json = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });
let lastTokenRequest = null;
let idTokenClaims = null;
const fetchImpl = jest.fn(async (url, options = {}) => {
  if (url === `${ISSUER}/.well-known/openid-configuration`) return json(discovery);
  if (url === `${ISSUER}/keys`) return json({ keys: [jwk] });
  if (url === `${ISSUER}/token`) {
    lastTokenRequest = Object.fromEntries(new URLSearchParams(options.body));
    if (lastTokenRequest.code !== "good-code") return json({ error: "invalid_grant" }, false, 400);
    return json({ id_token: jwt.sign(idTokenClaims, privateKey, { algorithm: "RS256", keyid: "key-1", expiresIn: "5m" }), access_token: "at" });
  }
  return json({}, false, 404);
});

const stateOf = (authorizationUrl) => new URL(authorizationUrl).searchParams.get("state");
const nonceOf = (authorizationUrl) => new URL(authorizationUrl).searchParams.get("nonce");

/** One full round trip through the provider for `email`, answering with `sub`. */
const signInThroughProvider = async ({ email, sub, redirectTo = undefined, extraClaims = {} }) => {
  const started = await ssoService.start({ email, redirectTo, fetchImpl });
  idTokenClaims = { iss: ISSUER, aud: CLIENT_ID, sub, email, nonce: nonceOf(started.authorizationUrl), ...extraClaims };
  return ssoService.callback({ code: "good-code", state: stateOf(started.authorizationUrl) }, { ipAddress: "10.0.0.9" }, { fetchImpl });
};

describe("single sign-on", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "test-jwt-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    process.env.MFA_SECRET_KEY = "test-mfa-key";
    process.env.WEB_APP_URL = "https://app.example.test";
    process.env.API_BASE_URL = "https://api.example.test/api/v1";
    delete process.env.INTEGRATION_SECRET_KEY;
  });
  beforeEach(() => {
    // ssoAutoProvision is true on the stored row on purpose: the retired
    // setting must not make SSO create anybody, whatever an old row says.
    store.orgs = [{ id: "org-1", name: "Constech", kind: "company", status: "active", ssoEnabled: false, ssoProvider: null, ssoIssuer: null, ssoClientId: null, ssoClientSecretEnc: null, ssoDomainsJson: [], ssoAutoProvision: true, ssoDefaultRole: "site_engineer", ssoRequired: false, mfaRequired: false, ssoUpdatedAt: null }];
    store.users = [{ id: "u-1", orgId: "org-1", name: "Pat", email: "pat@constech.test", passwordHash: "x", role: "pm", isCompanyAdmin: true, status: "active", ssoSubject: null, credentialEpoch: 0 }];
    store.memberships = [{ id: "m-1", orgId: "org-1", userId: "u-1", role: "pm", kind: "member", isAdmin: true, isOwner: true, status: "active", ssoSubject: null, ssoLinkedAt: null }];
    store.tickets = [];
    store.audit = [];
    store.sessions = [];
    lastTokenRequest = null;
    idTokenClaims = null;
    trace.length = 0;
    txDepth = 0;
    ssoService.clearDiscoveryCache();
    jest.clearAllMocks();
  });

  const configure = () => ssoService.updateSettings({ orgId: "org-1", payload: { issuer: `${ISSUER}/`, clientId: CLIENT_ID, clientSecret: "s3cr3t", domains: "constech.test, Sub.Constech.TEST", enabled: true, defaultRole: "site_engineer" }, actor: { id: "u-1", role: "pm" } });

  it("validates and stores the settings with the secret encrypted", async () => {
    await expect(ssoService.updateSettings({ orgId: "org-1", payload: { enabled: true }, actor: null })).rejects.toMatchObject({ code: "SSO_INCOMPLETE" });
    await expect(ssoService.updateSettings({ orgId: "org-1", payload: { issuer: "http://insecure.example" }, actor: null })).rejects.toMatchObject({ code: "SSO_ISSUER_INVALID" });
    const settings = await configure();
    expect(settings).toMatchObject({ enabled: true, issuer: ISSUER, clientId: CLIENT_ID, clientSecretSet: true, domains: ["constech.test", "sub.constech.test"], redirectUri: "https://api.example.test/api/v1/auth/sso/callback" });
    expect(store.orgs[0].ssoClientSecretEnc).toMatch(/^v1\./);
    expect(store.orgs[0].ssoClientSecretEnc).not.toContain("s3cr3t");
    await expect(ssoService.updateSettings({ orgId: "org-1", payload: { required: true, domains: [] }, actor: null })).rejects.toMatchObject({ code: "SSO_DOMAINS_REQUIRED" });
    expect(store.audit.at(-1)).toMatchObject({ action: "sso.settings_updated", entityType: "organisation" });
  });

  // Owner decision D-ID-1 Q1: auto-provisioning is retired.
  it("retires auto-provisioning: it always reads false, turning it on is refused, turning it off is stored", async () => {
    expect((await ssoService.settingsFor({ orgId: "org-1" })).autoProvision).toBe(false);
    await expect(ssoService.updateSettings({ orgId: "org-1", payload: { autoProvision: true }, actor: null })).rejects.toMatchObject({ status: 400, code: "SSO_AUTO_PROVISION_RETIRED" });
    expect(mockPrisma.organisation.update).not.toHaveBeenCalled();
    const settings = await ssoService.updateSettings({ orgId: "org-1", payload: { autoProvision: false }, actor: null });
    expect(settings.autoProvision).toBe(false);
    expect(store.orgs[0].ssoAutoProvision).toBe(false);
  });

  it("routes emails by domain and builds a PKCE authorization URL", async () => {
    expect(await ssoService.lookup({ email: "someone@constech.test" })).toEqual({ sso: false, required: false, orgName: null });
    await configure();
    expect(await ssoService.lookup({ email: "someone@constech.test" })).toEqual({ sso: true, required: false, orgName: "Constech" });
    expect(await ssoService.lookup({ email: "x@other.test" })).toEqual({ sso: false, required: false, orgName: null });
    await expect(ssoService.start({ email: "x@other.test", fetchImpl })).rejects.toMatchObject({ code: "SSO_NOT_CONFIGURED" });
    const started = await ssoService.start({ email: "new.hire@constech.test", redirectTo: "/projects", fetchImpl });
    const url = new URL(started.authorizationUrl);
    expect(url.origin + url.pathname).toBe(`${ISSUER}/authorize`);
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("login_hint")).toBe("new.hire@constech.test");
    const state = ssoService.verifyState(stateOf(started.authorizationUrl));
    expect(state).toMatchObject({ orgId: "org-1", redirectTo: "/projects" });
    expect(crypto.createHash("sha256").update(state.verifier).digest("base64url")).toBe(url.searchParams.get("code_challenge"));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await ssoService.start({ email: "again@constech.test", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("verifies the ID token, links the subject on this workspace's membership, hands out a one-time ticket and issues the session", async () => {
    await configure();
    const result = await signInThroughProvider({ email: "Pat@constech.test", sub: "idp-pat", redirectTo: "/projects", extraClaims: { email_verified: true } });
    expect(result.error).toBeNull();
    expect(lastTokenRequest).toMatchObject({ grant_type: "authorization_code", code: "good-code", client_id: CLIENT_ID, client_secret: "s3cr3t", redirect_uri: "https://api.example.test/api/v1/auth/sso/callback" });
    expect(lastTokenRequest.code_verifier).toBeTruthy();
    const target = new URL(result.redirectUrl);
    expect(target.origin + target.pathname).toBe("https://app.example.test/sso/complete");
    expect(target.searchParams.get("redirect")).toBe("/projects");
    // The link is the workspace's (D-ID-1 Q2); the identity row is not touched.
    expect(store.memberships[0]).toMatchObject({ id: "m-1", ssoSubject: "idp-pat", ssoLinkedAt: expect.any(Date) });
    expect(store.users[0].ssoSubject).toBeNull();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(store.tickets[0]).toMatchObject({ orgId: "org-1", userId: "u-1", membershipId: "m-1" });

    const ticket = target.searchParams.get("ticket");
    const session = await ssoService.complete({ ticket }, { ipAddress: "10.0.0.9" });
    expect(session.user).toMatchObject({ id: "u-1", email: "pat@constech.test" });
    expect(session.tokens.accessToken).toMatch(/^eyJ/);
    expect(jwt.decode(session.tokens.accessToken)).toMatchObject({ sub: "u-1", orgId: "org-1", sso: "org-1", cep: 0 });
    expect(store.sessions).toHaveLength(1);
    expect(store.audit.at(-1)).toMatchObject({ action: "sso.login", userId: "u-1" });
    await expect(ssoService.complete({ ticket })).rejects.toMatchObject({ code: "SSO_TICKET_INVALID" });
    await expect(ssoService.complete({ ticket: "nope-nope-nope-nope-nope" })).rejects.toMatchObject({ code: "SSO_TICKET_INVALID" });

    const overview = await ssoService.securityOverview({ orgId: "org-1" });
    expect(overview.summary).toEqual({ users: 1, mfaEnabled: 0, ssoLinked: 1 });
    expect(overview.users[0]).toMatchObject({ id: "u-1", ssoLinked: true, ssoLinkedAt: expect.any(String) });
  });

  // Owner decision D-ID-1 Q1: SSO signs people in, it never makes them.
  it("never creates an account or a membership: an unknown e-mail gets SSO_USER_NOT_FOUND even with the old setting on", async () => {
    await configure();
    store.orgs[0].ssoAutoProvision = true;
    const refused = await signInThroughProvider({ email: "new.hire@constech.test", sub: "idp-new", extraClaims: { email_verified: true, name: "New Hire" } });
    expect(refused.error).toBe("SSO_USER_NOT_FOUND");
    expect(refused.redirectUrl).toBe("https://app.example.test/sign-in?ssoError=SSO_USER_NOT_FOUND");
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(mockPrisma.organizationMembership.create).not.toHaveBeenCalled();
    expect(store.users.find((user) => user.email === "new.hire@constech.test")).toBeUndefined();
    expect(store.tickets).toHaveLength(0);
    expect(store.audit.map((row) => row.action)).not.toContain("sso.user_provisioned");
    expect(store.audit.at(-1)).toMatchObject({ action: "sso.login_failed" });
  });

  // Certification finding L10 / D-ID-1: a company's SSO may sign in only people already part of it.
  it("refuses, with the same answer, an identity of another company and a member who left or is only invited, and leaves them untouched", async () => {
    await configure();
    store.orgs.push({ id: "org-2", name: "Other Co", kind: "company", status: "active", ssoEnabled: false, ssoDomainsJson: [] });
    store.users.push(
      { id: "u-2", orgId: "org-2", name: "Visitor", email: "visitor@constech.test", passwordHash: "x", role: "qs", isCompanyAdmin: false, status: "active", ssoSubject: null },
      { id: "u-3", orgId: "org-2", name: "Former", email: "former@constech.test", passwordHash: "x", role: "qs", isCompanyAdmin: false, status: "active", ssoSubject: null },
      { id: "u-4", orgId: "org-2", name: "Invited", email: "invited@constech.test", passwordHash: "x", role: "qs", isCompanyAdmin: false, status: "active", ssoSubject: null },
    );
    store.memberships.push(
      { id: "m-3", orgId: "org-1", userId: "u-3", role: "qs", kind: "member", isAdmin: false, isOwner: false, status: "left", ssoSubject: null },
      { id: "m-4", orgId: "org-1", userId: "u-4", role: "qs", kind: "member", isAdmin: false, isOwner: false, status: "invited", ssoSubject: null },
    );
    for (const [email, sub] of [["visitor@constech.test", "idp-visitor"], ["former@constech.test", "idp-former"], ["invited@constech.test", "idp-invited"]]) {
      const refused = await signInThroughProvider({ email, sub, extraClaims: { email_verified: true } });
      expect(refused.error).toBe("SSO_USER_NOT_FOUND");
    }
    expect(store.tickets).toHaveLength(0);
    expect(mockPrisma.organizationMembership.update).not.toHaveBeenCalled();
    // The link is written by updateMany now; nothing was linked either way.
    expect(mockPrisma.organizationMembership.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.organizationMembership.create).not.toHaveBeenCalled();
    expect(store.users.find((user) => user.id === "u-2")).toMatchObject({ orgId: "org-2", ssoSubject: null });
  });

  it("refuses a member suspended here", async () => {
    await configure();
    store.memberships[0].status = "suspended";
    const refused = await signInThroughProvider({ email: "pat@constech.test", sub: "idp-pat" });
    expect(refused.error).toBe("USER_INACTIVE");
    expect(store.tickets).toHaveLength(0);
    expect(store.memberships[0].ssoSubject).toBeNull();
  });

  it("writes a person homed here before memberships their row from their own User columns, then links it", async () => {
    await configure();
    store.memberships = [];
    const result = await signInThroughProvider({ email: "pat@constech.test", sub: "idp-pat" });
    expect(result.error).toBeNull();
    expect(store.memberships).toEqual([expect.objectContaining({ orgId: "org-1", userId: "u-1", role: "pm", status: "active", ssoSubject: "idp-pat" })]);
    expect(store.audit.map((row) => row.action)).toContain("membership.created");
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  // Codex D-ID-1 diff review r3 (adjudicated LOW): the callback wrote a legacy
  // home member's row without the (org, e-mail) lock a deactivation takes, so
  // the two could run side by side and the suspension abort on the unique
  // constraint, leaving access active. The row is now written under that lock,
  // and a row the lock-holder left not active refuses the sign-in.
  describe("a person homed here before memberships, under the (org, e-mail) lock (D-ID-1 round 4)", () => {
    const LOCK_SQL = /pg_advisory_xact_lock\(hashtext\(\?\), hashtext\(\?\)\)/;
    const realCreate = mockPrisma.organizationMembership.create.getMockImplementation();

    beforeEach(() => {
      mockPrisma.$executeRaw = jest.fn(async (strings, ...values) => {
        trace.push({ kind: "lock", sql: strings.join("?"), values, inTransaction: txDepth > 0 });
        return 1;
      });
      mockPrisma.organizationMembership.create.mockImplementation(async (args) => {
        trace.push({ kind: "create", inTransaction: txDepth > 0 });
        return realCreate(args);
      });
    });
    afterEach(() => {
      delete mockPrisma.$executeRaw;
      mockPrisma.organizationMembership.create.mockImplementation(realCreate);
    });

    it("takes the lock inside a transaction before it writes the row from the User columns", async () => {
      await configure();
      store.memberships = [];
      trace.length = 0;
      const result = await signInThroughProvider({ email: "pat@constech.test", sub: "idp-pat" });
      expect(result.error).toBeNull();
      expect(trace.map((entry) => entry.kind)).toEqual(["lock", "create", "query", "ticket"]);
      expect(trace[0]).toMatchObject({ values: ["org-1", "pat@constech.test"], inTransaction: true });
      expect(trace[0].sql).toMatch(LOCK_SQL);
      expect(trace[1].inTransaction).toBe(true);
      expect(store.memberships).toEqual([expect.objectContaining({ orgId: "org-1", userId: "u-1", status: "active", ssoSubject: "idp-pat" })]);
    });

    it("refuses USER_INACTIVE, and writes, links and issues nothing, when a deactivation wrote the row suspended while the callback waited for the lock", async () => {
      await configure();
      store.memberships = [];
      mockPrisma.$executeRaw.mockImplementationOnce(async (strings, ...values) => {
        trace.push({ kind: "lock", sql: strings.join("?"), values, inTransaction: txDepth > 0 });
        // The deactivation held the lock: it wrote the legacy member's row,
        // suspended, and committed.
        store.memberships.push({ id: "m-suspended", orgId: "org-1", userId: "u-1", role: "pm", kind: "member", isAdmin: true, isOwner: false, status: "suspended", ssoSubject: null, ssoLinkedAt: null });
        return 1;
      });
      const refused = await signInThroughProvider({ email: "pat@constech.test", sub: "idp-pat" });
      expect(refused.error).toBe("USER_INACTIVE");
      expect(refused.redirectUrl).toBe("https://app.example.test/sign-in?ssoError=USER_INACTIVE");
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(mockPrisma.organizationMembership.create).not.toHaveBeenCalled();
      expect(mockPrisma.organizationMembership.updateMany).not.toHaveBeenCalled();
      expect(store.memberships).toEqual([expect.objectContaining({ id: "m-suspended", status: "suspended", ssoSubject: null })]);
      expect(store.tickets).toHaveLength(0);
      expect(mockPrisma.ssoTicket.create).not.toHaveBeenCalled();
      expect(store.audit.map((row) => row.action)).not.toContain("membership.created");
      expect(store.audit.at(-1)).toMatchObject({ action: "sso.login_failed", metadataJson: expect.objectContaining({ code: "USER_INACTIVE" }) });
    });
  });

  it("binds the session it issues to this company: the token says so, and a switch to another workspace is refused", async () => {
    await configure();
    const result = await signInThroughProvider({ email: "pat@constech.test", sub: "idp-pat" });
    const session = await ssoService.complete({ ticket: new URL(result.redirectUrl).searchParams.get("ticket") });
    expect(jwt.decode(session.tokens.accessToken)).toMatchObject({ sso: "org-1", orgId: "org-1" });
    const authService = require("../auth.service");
    await expect(authService.issueWorkspaceSession({ userId: "u-1", orgId: "org-2", ssoOrgId: "org-1" })).rejects.toMatchObject({ status: 403, code: "SSO_SESSION_BOUND" });
  });

  it("scopes a subject to this workspace: another workspace's equal subject is no conflict; this one's, or a different stored one, is", async () => {
    await configure();
    // Another organisation's provider linked the same subject string to
    // another identity's membership there; it is not this workspace's link.
    store.orgs.push({ id: "org-2", name: "Other Co", kind: "company", status: "active", ssoEnabled: false, ssoDomainsJson: [] });
    store.users.push({ id: "u-elsewhere", orgId: "org-2", name: "Elsewhere", email: "elsewhere@other.test", passwordHash: "x", role: "pm", isCompanyAdmin: false, status: "active", ssoSubject: null });
    store.memberships.unshift({ id: "m-elsewhere", orgId: "org-2", userId: "u-elsewhere", role: "pm", kind: "member", isAdmin: false, isOwner: false, status: "active", ssoSubject: "idp-shared" });
    const linked = await signInThroughProvider({ email: "pat@constech.test", sub: "idp-shared" });
    expect(linked.error).toBeNull();
    expect(store.memberships.find((row) => row.id === "m-1")).toMatchObject({ ssoSubject: "idp-shared" });
    expect(store.memberships.find((row) => row.id === "m-elsewhere")).toMatchObject({ ssoSubject: "idp-shared" });

    // This workspace's own link presented with another member's e-mail is the conflict.
    store.users.push({ id: "u-5", orgId: "org-1", name: "Sam", email: "sam@constech.test", passwordHash: "x", role: "qs", isCompanyAdmin: false, status: "active", ssoSubject: null });
    store.memberships.push({ id: "m-5", orgId: "org-1", userId: "u-5", role: "qs", kind: "member", isAdmin: false, isOwner: false, status: "active", ssoSubject: null });
    const conflict = await signInThroughProvider({ email: "sam@constech.test", sub: "idp-shared" });
    expect(conflict.error).toBe("SSO_IDENTITY_CONFLICT");
    expect(store.memberships.find((row) => row.id === "m-5").ssoSubject).toBeNull();

    // A membership already linked here to a different subject is the conflict too.
    const relinked = await signInThroughProvider({ email: "pat@constech.test", sub: "idp-other" });
    expect(relinked.error).toBe("SSO_IDENTITY_CONFLICT");
    expect(store.memberships.find((row) => row.id === "m-1").ssoSubject).toBe("idp-shared");
  });

  it("answers SSO_IDENTITY_CONFLICT when a concurrent sign-in linked the same subject here first (unique violation)", async () => {
    await configure();
    store.users.push({ id: "u-5", orgId: "org-1", name: "Sam", email: "sam@constech.test", passwordHash: "x", role: "qs", isCompanyAdmin: false, status: "active", ssoSubject: null });
    store.memberships.push({ id: "m-5", orgId: "org-1", userId: "u-5", role: "qs", kind: "member", isAdmin: false, isOwner: false, status: "active", ssoSubject: null });
    // The read sees no link; the write then collides with one made meanwhile.
    mockPrisma.organizationMembership.findFirst.mockImplementationOnce(async ({ where }) => withRelations(store.memberships.find((row) => matches(row, where))));
    mockPrisma.organizationMembership.findFirst.mockImplementationOnce(async () => {
      store.memberships.find((row) => row.id === "m-1").ssoSubject = "idp-race";
      return null;
    });
    const refused = await signInThroughProvider({ email: "sam@constech.test", sub: "idp-race" });
    expect(refused.error).toBe("SSO_IDENTITY_CONFLICT");
    expect(store.tickets).toHaveLength(0);
  });

  // Codex D-ID-1 diff review #11: two first sign-ins for one membership with two
  // different subjects. The second read the membership unlinked; the first
  // linked it before the second's write. The second's conditional write finds
  // nothing to link, and the stored subject is not its own.
  it("answers SSO_IDENTITY_CONFLICT, and keeps the first link, when another subject linked this membership after it was read", async () => {
    await configure();
    // Call 1 reads the membership (unlinked); call 2 is the linkedHere lookup,
    // during which the concurrent callback commits its own link.
    mockPrisma.organizationMembership.findFirst.mockImplementationOnce(async ({ where }) => withRelations(store.memberships.find((row) => matches(row, where))));
    mockPrisma.organizationMembership.findFirst.mockImplementationOnce(async () => {
      store.memberships.find((row) => row.id === "m-1").ssoSubject = "idp-first";
      return null;
    });
    const second = await signInThroughProvider({ email: "pat@constech.test", sub: "idp-second" });
    expect(second.error).toBe("SSO_IDENTITY_CONFLICT");
    expect(store.memberships.find((row) => row.id === "m-1").ssoSubject).toBe("idp-first");
    expect(mockPrisma.organizationMembership.updateMany).toHaveBeenCalledWith({
      where: { id: "m-1", ssoSubject: null },
      data: { ssoSubject: "idp-second", ssoLinkedAt: expect.any(Date) },
    });
    expect(mockPrisma.organizationMembership.update).not.toHaveBeenCalled();
    expect(store.tickets).toHaveLength(0);
  });

  it("goes on when the same subject linked this membership after it was read (the second callback finds its own link)", async () => {
    await configure();
    mockPrisma.organizationMembership.findFirst.mockImplementationOnce(async ({ where }) => withRelations(store.memberships.find((row) => matches(row, where))));
    mockPrisma.organizationMembership.findFirst.mockImplementationOnce(async () => {
      store.memberships.find((row) => row.id === "m-1").ssoSubject = "idp-pat";
      return null;
    });
    const result = await signInThroughProvider({ email: "pat@constech.test", sub: "idp-pat" });
    expect(result.error).toBeNull();
    expect(store.memberships.find((row) => row.id === "m-1").ssoSubject).toBe("idp-pat");
    expect(store.tickets).toEqual([expect.objectContaining({ userId: "u-1", membershipId: "m-1" })]);
  });

  // Codex D-ID-1 diff review #1/#3: complete() mints the session in a
  // transaction that first holds the identity at the epoch the ticket's row
  // read, before any session is written.
  it("holds the ticket's identity at its epoch inside the issuing transaction, before the session is written", async () => {
    await configure();
    store.users[0].credentialEpoch = 3;
    const result = await signInThroughProvider({ email: "pat@constech.test", sub: "idp-pat" });
    trace.length = 0;
    const session = await ssoService.complete({ ticket: new URL(result.redirectUrl).searchParams.get("ticket") });
    const holds = trace.filter((entry) => entry.kind === "query");
    expect(holds).toEqual([expect.objectContaining({ values: ["u-1", 3], inTransaction: true })]);
    expect(holds[0].sql).toMatch(/FROM "User" WHERE "id" = \? AND "credentialEpoch" = \? AND "status" = 'active' FOR NO KEY UPDATE$/);
    expect(trace.map((entry) => entry.kind)).toEqual(["query", "session"]);
    expect(trace[1].inTransaction).toBe(true);
    expect(jwt.decode(session.tokens.accessToken)).toMatchObject({ sub: "u-1", sso: "org-1", cep: 3 });
  });

  it("answers SESSION_REVOKED, and writes no session, when a reset commits between the ticket's read and the issuance", async () => {
    await configure();
    const result = await signInThroughProvider({ email: "pat@constech.test", sub: "idp-pat" });
    // The reset commits while complete() waits for the User row: the hold reads
    // the row as the reset left it.
    mockPrisma.$queryRaw.mockImplementationOnce(async (strings, ...values) => {
      store.users[0].credentialEpoch = 1;
      return evaluateUserHold(strings, values);
    });
    await expect(ssoService.complete({ ticket: new URL(result.redirectUrl).searchParams.get("ticket") })).rejects.toMatchObject({ status: 401, code: "SESSION_REVOKED" });
    expect(store.sessions).toHaveLength(0);
    expect(mockPrisma.refreshSession.create).not.toHaveBeenCalled();
    expect(store.audit.map((row) => row.action)).not.toContain("sso.login");
  });

  // Codex D-ID-1 diff review r2 #3: the callback reads the identity, and a reset
  // could commit (and sweep the person's tickets) before the ticket was
  // inserted — an unversioned ticket that escaped the sweep. The ticket is now
  // written in a transaction that first holds the identity at the epoch the
  // callback read.
  it("writes the callback's ticket inside a transaction that first holds the identity at the epoch the callback read", async () => {
    await configure();
    store.users[0].credentialEpoch = 3;
    trace.length = 0;
    const result = await signInThroughProvider({ email: "pat@constech.test", sub: "idp-pat" });
    expect(result.error).toBeNull();
    expect(trace.map((entry) => entry.kind)).toEqual(["query", "ticket"]);
    expect(trace[0]).toMatchObject({ values: ["u-1", 3], inTransaction: true });
    expect(trace[0].sql).toMatch(/FROM "User" WHERE "id" = \? AND "credentialEpoch" = \? AND "status" = 'active' FOR NO KEY UPDATE$/);
    expect(trace[1].inTransaction).toBe(true);
    expect(store.tickets).toEqual([expect.objectContaining({ userId: "u-1", membershipId: "m-1" })]);
  });

  it("answers SESSION_REVOKED, and writes no ticket, when a reset commits between the callback's identity read and the ticket", async () => {
    await configure();
    // The reset commits while the callback waits for the User row.
    mockPrisma.$queryRaw.mockImplementationOnce(async (strings, ...values) => {
      store.users[0].credentialEpoch = 1;
      trace.push({ kind: "query", sql: strings.join("?"), values, inTransaction: txDepth > 0 });
      return evaluateUserHold(strings, values);
    });
    const refused = await signInThroughProvider({ email: "pat@constech.test", sub: "idp-pat" });
    expect(refused.error).toBe("SESSION_REVOKED");
    expect(refused.redirectUrl).toBe("https://app.example.test/sign-in?ssoError=SESSION_REVOKED");
    expect(store.tickets).toHaveLength(0);
    expect(mockPrisma.ssoTicket.create).not.toHaveBeenCalled();
    expect(trace.filter((entry) => entry.kind === "query").map((entry) => entry.values)).toEqual([["u-1", 0]]);
    expect(store.audit.at(-1)).toMatchObject({ action: "sso.login_failed", metadataJson: expect.objectContaining({ code: "SESSION_REVOKED" }) });
  });

  it("rejects a bad nonce, a wrong audience, a refused code and a tampered state", async () => {
    await configure();
    const started = await ssoService.start({ email: "pat@constech.test", fetchImpl });
    const state = stateOf(started.authorizationUrl);
    idTokenClaims = { iss: ISSUER, aud: CLIENT_ID, sub: "idp-pat", email: "pat@constech.test", nonce: "someone-elses-nonce" };
    expect((await ssoService.callback({ code: "good-code", state }, {}, { fetchImpl })).error).toBe("SSO_TOKEN_INVALID");
    idTokenClaims = { iss: ISSUER, aud: "other-client", sub: "idp-pat", email: "pat@constech.test", nonce: nonceOf(started.authorizationUrl) };
    expect((await ssoService.callback({ code: "good-code", state }, {}, { fetchImpl })).error).toBe("SSO_TOKEN_INVALID");
    expect((await ssoService.callback({ code: "bad-code", state }, {}, { fetchImpl })).error).toBe("SSO_TOKEN_EXCHANGE_FAILED");
    expect((await ssoService.callback({ code: "good-code", state: `${state}x` }, {}, { fetchImpl })).error).toBe("SSO_STATE_INVALID");
    expect((await ssoService.callback({ error: "access_denied", errorDescription: "User cancelled" }, {}, { fetchImpl })).redirectUrl).toContain("ssoError=User%20cancelled");
    const test = await ssoService.testConnection({ orgId: "org-1", fetchImpl });
    expect(test).toMatchObject({ ok: true, tokenEndpoint: `${ISSUER}/token`, codeChallengeMethods: ["S256"] });
    const overview = await ssoService.securityOverview({ orgId: "org-1" });
    expect(overview.summary).toEqual({ users: 1, mfaEnabled: 0, ssoLinked: 0 });
    expect(overview.sso.enabled).toBe(true);
  });
});
