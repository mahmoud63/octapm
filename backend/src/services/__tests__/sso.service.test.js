const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const store = { orgs: [], users: [], tickets: [], audit: [], sessions: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;

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
    // The callback looks a subject up within one organisation (ssoSubject plus an OR of orgId / membership clauses); other callers narrow by orgId.
    findFirst: jest.fn(async ({ where }) =>
      store.users.find(
        (user) =>
          (where.orgId === undefined || user.orgId === where.orgId) &&
          (where.ssoSubject === undefined || user.ssoSubject === where.ssoSubject) &&
          (where.OR ? where.OR.some((clause) => (clause.orgId && user.orgId === clause.orgId) || (clause.ssoSubject && user.ssoSubject === clause.ssoSubject) || (clause.email && user.email === clause.email)) : true),
      ) || null),
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
  ssoTicket: {
    create: jest.fn(async ({ data }) => {
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
  refreshSession: { create: jest.fn(async ({ data }) => store.sessions.push(data)) },
  authAuditEvent: { create: jest.fn(async ({ data }) => store.audit.push(data)) },
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
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
    store.orgs = [{ id: "org-1", name: "Constech", status: "active", ssoEnabled: false, ssoProvider: null, ssoIssuer: null, ssoClientId: null, ssoClientSecretEnc: null, ssoDomainsJson: [], ssoAutoProvision: true, ssoDefaultRole: "site_engineer", ssoRequired: false, mfaRequired: false, ssoUpdatedAt: null }];
    store.users = [{ id: "u-1", orgId: "org-1", name: "Pat", email: "pat@constech.test", passwordHash: "x", role: "pm", isCompanyAdmin: true, status: "active", ssoSubject: null }];
    store.tickets = [];
    store.audit = [];
    store.sessions = [];
    lastTokenRequest = null;
    idTokenClaims = null;
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

  it("verifies the ID token, provisions the user, hands out a one-time ticket and issues the session", async () => {
    await configure();
    const started = await ssoService.start({ email: "new.hire@constech.test", redirectTo: "/projects", fetchImpl });
    const state = stateOf(started.authorizationUrl);
    idTokenClaims = { iss: ISSUER, aud: CLIENT_ID, sub: "idp-sub-77", email: "New.Hire@constech.test", email_verified: true, name: "New Hire", nonce: nonceOf(started.authorizationUrl) };
    const result = await ssoService.callback({ code: "good-code", state }, { ipAddress: "10.0.0.9" }, { fetchImpl });
    expect(result.error).toBeNull();
    expect(lastTokenRequest).toMatchObject({ grant_type: "authorization_code", code: "good-code", client_id: CLIENT_ID, client_secret: "s3cr3t", redirect_uri: "https://api.example.test/api/v1/auth/sso/callback" });
    expect(lastTokenRequest.code_verifier).toBeTruthy();
    const target = new URL(result.redirectUrl);
    expect(target.origin + target.pathname).toBe("https://app.example.test/sso/complete");
    expect(target.searchParams.get("redirect")).toBe("/projects");
    const created = store.users.find((user) => user.email === "new.hire@constech.test");
    expect(created).toMatchObject({ orgId: "org-1", role: "site_engineer", status: "active", ssoSubject: "idp-sub-77", ssoProvider: "oidc" });
    expect(store.audit.map((row) => row.action)).toContain("sso.user_provisioned");

    const ticket = target.searchParams.get("ticket");
    const session = await ssoService.complete({ ticket }, { ipAddress: "10.0.0.9" });
    expect(session.user).toMatchObject({ id: created.id, email: "new.hire@constech.test", ssoLinked: true });
    expect(session.tokens.accessToken).toMatch(/^eyJ/);
    expect(store.sessions).toHaveLength(1);
    expect(store.audit.at(-1)).toMatchObject({ action: "sso.login", userId: created.id });
    await expect(ssoService.complete({ ticket })).rejects.toMatchObject({ code: "SSO_TICKET_INVALID" });
    await expect(ssoService.complete({ ticket: "nope-nope-nope-nope-nope" })).rejects.toMatchObject({ code: "SSO_TICKET_INVALID" });
  });

  it("links an existing user by email, and refuses unknown users when provisioning is off", async () => {
    await configure();
    const first = await ssoService.start({ email: "pat@constech.test", fetchImpl });
    idTokenClaims = { iss: ISSUER, aud: CLIENT_ID, sub: "idp-pat", email: "pat@constech.test", nonce: nonceOf(first.authorizationUrl) };
    const linked = await ssoService.callback({ code: "good-code", state: stateOf(first.authorizationUrl) }, {}, { fetchImpl });
    expect(linked.error).toBeNull();
    expect(store.users[0]).toMatchObject({ ssoSubject: "idp-pat", ssoProvider: "oidc" });

    await ssoService.updateSettings({ orgId: "org-1", payload: { autoProvision: false }, actor: null });
    const second = await ssoService.start({ email: "stranger@constech.test", fetchImpl });
    idTokenClaims = { iss: ISSUER, aud: CLIENT_ID, sub: "idp-stranger", email: "stranger@constech.test", nonce: nonceOf(second.authorizationUrl) };
    const refused = await ssoService.callback({ code: "good-code", state: stateOf(second.authorizationUrl) }, {}, { fetchImpl });
    expect(refused.error).toBe("SSO_USER_NOT_FOUND");
    expect(refused.redirectUrl).toBe("https://app.example.test/sign-in?ssoError=SSO_USER_NOT_FOUND");
    expect(store.audit.at(-1)).toMatchObject({ action: "sso.login_failed" });
  });

  // Certification finding L10: a company's SSO may sign in only people who belong to it.
  it("refuses an identity that lives in another company and has no membership here, and leaves it untouched", async () => {
    await configure();
    store.orgs.push({ id: "org-2", name: "Other Co", status: "active", ssoEnabled: false, ssoDomainsJson: [] });
    store.users.push({ id: "u-2", orgId: "org-2", name: "Visitor", email: "visitor@constech.test", passwordHash: "x", role: "qs", isCompanyAdmin: false, status: "active", ssoSubject: null });
    const started = await ssoService.start({ email: "visitor@constech.test", fetchImpl });
    idTokenClaims = { iss: ISSUER, aud: CLIENT_ID, sub: "idp-visitor", email: "visitor@constech.test", email_verified: true, nonce: nonceOf(started.authorizationUrl) };
    const refused = await ssoService.callback({ code: "good-code", state: stateOf(started.authorizationUrl) }, {}, { fetchImpl });
    expect(refused.error).toBe("SSO_USER_NOT_FOUND");
    expect(store.tickets).toHaveLength(0);
    expect(store.users.find((user) => user.id === "u-2")).toMatchObject({ orgId: "org-2", ssoSubject: null });
  });

  it("binds the session it issues to this company: the token says so, and a switch to another workspace is refused", async () => {
    await configure();
    const started = await ssoService.start({ email: "pat@constech.test", fetchImpl });
    idTokenClaims = { iss: ISSUER, aud: CLIENT_ID, sub: "idp-pat", email: "pat@constech.test", nonce: nonceOf(started.authorizationUrl) };
    const result = await ssoService.callback({ code: "good-code", state: stateOf(started.authorizationUrl) }, {}, { fetchImpl });
    const session = await ssoService.complete({ ticket: new URL(result.redirectUrl).searchParams.get("ticket") });
    expect(jwt.decode(session.tokens.accessToken)).toMatchObject({ sso: "org-1", orgId: "org-1" });
    const authService = require("../auth.service");
    await expect(authService.issueWorkspaceSession({ userId: "u-1", orgId: "org-2", ssoOrgId: "org-1" })).rejects.toMatchObject({ status: 403, code: "SSO_SESSION_BOUND" });
  });

  it("scopes a subject match to this organisation's IdP: another organisation's equal subject is no conflict, this one's is", async () => {
    await configure();
    // Another organisation's IdP linked the same subject string to another
    // identity; it comes first in the store, where an unordered global
    // lookup would find it and refuse Pat.
    store.users.unshift({ id: "u-elsewhere", orgId: "org-2", name: "Elsewhere", email: "elsewhere@other.test", passwordHash: "x", role: "pm", isCompanyAdmin: false, status: "active", ssoSubject: "idp-shared" });
    const first = await ssoService.start({ email: "pat@constech.test", fetchImpl });
    idTokenClaims = { iss: ISSUER, aud: CLIENT_ID, sub: "idp-shared", email: "pat@constech.test", nonce: nonceOf(first.authorizationUrl) };
    const linked = await ssoService.callback({ code: "good-code", state: stateOf(first.authorizationUrl) }, {}, { fetchImpl });
    expect(linked.error).toBeNull();
    expect(store.users.find((user) => user.id === "u-1")).toMatchObject({ email: "pat@constech.test", ssoSubject: "idp-shared" });

    // This organisation's own link presenting a different email is the conflict.
    const second = await ssoService.start({ email: "renamed@constech.test", fetchImpl });
    idTokenClaims = { iss: ISSUER, aud: CLIENT_ID, sub: "idp-shared", email: "renamed@constech.test", nonce: nonceOf(second.authorizationUrl) };
    const refused = await ssoService.callback({ code: "good-code", state: stateOf(second.authorizationUrl) }, {}, { fetchImpl });
    expect(refused.error).toBe("SSO_IDENTITY_CONFLICT");
    expect(store.users.find((user) => user.email === "renamed@constech.test")).toBeUndefined();
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
