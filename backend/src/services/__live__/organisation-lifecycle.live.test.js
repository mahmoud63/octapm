/**
 * A workspace's life (enterprise wave ENT-6): born personal at sign-up, a
 * company made beside it, the personal one converted — driven through a real
 * API process against the real local database.
 *
 *   npm run test:live -- src/services/__live__/organisation-lifecycle.live.test.js
 *
 * The identity registers through the product's own sign-up (the public
 * registration policy is open outside production, config/registration.js,
 * and the spawned API runs NODE_ENV=development). What must hold:
 *
 *   - sign-up makes a PERSONAL workspace on the individual plan, with the
 *     registrant as owner and administrator, a handle, the twelve system
 *     permission templates, the default units and the project defaults
 *     (currency, time zone) the registrant named;
 *   - a project created in it without a currency or zone takes the
 *     workspace's defaults;
 *   - POST /organisations makes a second, COMPANY workspace, provisioned
 *     the same way, and the identity now holds two memberships; an API key
 *     cannot create or convert a workspace;
 *   - a failure after the organisation row rolls the whole creation back:
 *     no organisation is left without its owner;
 *   - a personal workspace refuses a second member — direct add, workspace,
 *     project or company-directory invitation, SSO auto-provisioning — with
 *     409 PERSONAL_WORKSPACE_CONVERT_REQUIRED, leaves no identity or
 *     invitation behind when it does, and still seats a guest (party member);
 *     an active guest is not sent a member invitation either;
 *   - two seats taken at once in an empty personal workspace are serialised:
 *     one wins, the other is refused;
 *   - conversion is the owner's (403 OWNER_REQUIRED for a member), of the
 *     session's own workspace (404 otherwise), and a company is 409
 *     WORKSPACE_ALREADY_COMPANY;
 *   - converting flips kind and plan, keeps the slug and the owner, and
 *     changes no row of any table: every orgId-carrying model, and every
 *     projectId-only one under the workspace's project, counts the same rows
 *     before and after — and the project holds a BOQ item, an activity, an
 *     attachment, an approved direct cost and its ledger entry, so the count
 *     has something to protect; afterwards a second member is seated where
 *     it was refused before;
 *   - billing mail (the trial reminders and the cancellation email) goes to
 *     the owner membership's user, not the earliest PM.
 */
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../../config/db");
const { createLiveUser, dropLiveOrg, liveDescribe, sleep } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");
const { DEFAULT_TEMPLATES } = require("../permission-template.service");
const { DEFAULT_UNITS } = require("../uom.service");
const membershipService = require("../membership.service");

const PASSWORD = "Live-Passw0rd!9a";
const MOBILE = { "x-octapm-client": "mobile" };
const bearer = (token) => ({ ...MOBILE, authorization: `Bearer ${token}` });
const lowerFirst = (name) => name.charAt(0).toLowerCase() + name.slice(1);
const scalar = (model, name) => model.fields.some((field) => field.name === name && field.kind === "scalar");

/** Every Prisma model that carries a tenant column, by its client key. */
const ORG_MODELS = Prisma.dmmf.datamodel.models
  .filter((model) => scalar(model, "orgId"))
  .map((model) => lowerFirst(model.name))
  .filter((key) => typeof prisma[key]?.count === "function");

/** Every model that hangs off a project without a tenant column of its own (BOQ, schedule, IPC …). */
const PROJECT_MODELS = Prisma.dmmf.datamodel.models
  .filter((model) => scalar(model, "projectId") && !scalar(model, "orgId"))
  .map((model) => lowerFirst(model.name))
  .filter((key) => typeof prisma[key]?.count === "function");

/** Rows per orgId-carrying model under one workspace, and per project-only model under its projects — the conversion invariant. */
const countRows = async (orgId) => {
  const counts = {};
  for (const key of ORG_MODELS) counts[key] = await prisma[key].count({ where: { orgId } });
  const projectIds = (await prisma.project.findMany({ where: { orgId }, select: { id: true } })).map((row) => row.id);
  for (const key of PROJECT_MODELS) counts[`project:${key}`] = await prisma[key].count({ where: { projectId: { in: projectIds } } });
  counts["project:budgetLine"] = await prisma.budgetLine.count({ where: { project: { orgId } } });
  return counts;
};

/** The counts once nothing the last writes set off (jobs, outbound events) is still landing. */
const settledCounts = async (orgId) => {
  let previous = await countRows(orgId);
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await sleep(700);
    const next = await countRows(orgId);
    if (JSON.stringify(next) === JSON.stringify(previous)) return next;
    previous = next;
  }
  return previous;
};

/** The name every throwaway organisation carries; nothing else is written to directly. */
const LIVE_ORG_NAME = /^LiveTest [0-9a-f-]{36}$/;

/** An id the test is about to write by: a non-empty string, or the write never happens. */
const requireId = (value, label) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`refusing a write: ${label} is ${JSON.stringify(value)}, not an id (did an earlier case fail?)`);
  }
  return value;
};

/** Proves, immediately before a direct write, that `orgId` names a throwaway LiveTest organisation. */
const requireLiveOrg = async (orgId) => {
  requireId(orgId, "orgId");
  const org = await prisma.organisation.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
  if (!org) throw new Error(`refusing a write: no organisation ${orgId}`);
  if (!LIVE_ORG_NAME.test(org.name)) throw new Error(`refusing a write to "${org.name}": not a LiveTest organisation`);
  return org;
};

/**
 * A plan for a throwaway workspace: a brand-new one is on a trial with no
 * allowance (402 on its first write). One row, by its unique key — orgId is
 * unique on Subscription — so a missing id throws instead of widening.
 */
const activate = async (orgId) => {
  await requireLiveOrg(orgId);
  return prisma.subscription.update({
    where: { orgId },
    data: { plan: "business", status: "active", seats: 25, currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) },
  });
};

/**
 * Role and updatedAt of every membership a one-row write must not touch:
 * the rest of `orgId`'s rows, and every row of every organisation that is
 * not a throwaway one (other suites' LiveTest organisations change
 * concurrently and are left out).
 */
const bystanderMemberships = (orgId, userId) =>
  prisma.organizationMembership.findMany({
    where: {
      OR: [{ orgId, userId: { not: userId } }, { org: { NOT: { name: { startsWith: "LiveTest " } } } }],
    },
    select: { id: true, orgId: true, userId: true, role: true, updatedAt: true },
    orderBy: { id: "asc" },
  });

/** A stand-in OpenID provider: discovery, keys and a token endpoint answering whatever claims the test sets. */
const fakeIdentityProvider = (issuer, clientId) => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "live-key", use: "sig", alg: "RS256" };
  const discovery = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/keys`,
  };
  const reply = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });
  const idp = { claims: null };
  idp.fetchImpl = async (url) => {
    if (url === `${issuer}/.well-known/openid-configuration`) return reply(discovery);
    if (url === `${issuer}/keys`) return reply({ keys: [jwk] });
    if (url === `${issuer}/token`) {
      const idToken = jwt.sign({ iss: issuer, aud: clientId, ...idp.claims }, privateKey, { algorithm: "RS256", keyid: "live-key", expiresIn: "5m" });
      return reply({ id_token: idToken, access_token: "at" });
    }
    return reply({}, false, 404);
  };
  return idp;
};

liveDescribe("workspaces: personal at sign-up, a company beside it, conversion", () => {
  let api;
  const tag = crypto.randomUUID();
  const owner = { email: `live-owner-${tag}@octapm-live.test`, name: "Live Owner" };
  const colleague = { email: `live-colleague-${tag}@octapm-live.test`, name: "Live Colleague" };
  const guest = { email: `live-guest-${tag}@octapm-live.test`, name: "Live Guest" };
  const personal = {};
  const company = {};
  const extraOrgIds = [];
  let projectId = null;

  const login = (email) => api.post("/api/v1/auth/login", { email, password: PASSWORD }, MOBILE);
  const enter = (token, orgId) => api.post(`/api/v1/auth/workspaces/${orgId}/session`, {}, bearer(token));
  const me = (token) => api.get("/api/v1/auth/me", bearer(token));
  const convert = (token, orgId, body = {}) => api.post(`/api/v1/organisations/${orgId}/convert`, body, bearer(token));

  /** The accept link the local log transport printed for an invitation email. */
  const acceptLinkFor = (email) => {
    const output = api.proc.output();
    const marker = `[email:local] -> ${email} |`;
    const start = output.lastIndexOf(marker);
    if (start === -1) throw new Error(`no invitation email for ${email} in the API output`);
    const match = /https?:\/\/\S+\/accept-invite\?token=([A-Za-z0-9_-]+)/.exec(output.slice(start));
    if (!match) throw new Error(`no accept link for ${email} in the API output`);
    return match[1];
  };

  beforeAll(async () => {
    api = await startApi({ EMAIL_PROVIDER: "log" });
  }, 120_000);

  afterAll(async () => {
    await api?.stop();
    for (const orgId of extraOrgIds) await dropLiveOrg(prisma, orgId);
    // The company first: the identity's home is the personal workspace, and
    // its membership in the company hangs off both.
    await dropLiveOrg(prisma, company.orgId);
    await dropLiveOrg(prisma, personal.orgId);
    await prisma.$disconnect();
  });

  it("the test's own writes refuse an id that is missing or not a throwaway organisation", async () => {
    // Each refusal happens before any write; the unique-key form underneath
    // would throw on a missing id as well, so this case writes nothing.
    await expect(activate(undefined)).rejects.toThrow(/refusing a write: orgId is undefined/);
    await expect(activate("")).rejects.toThrow(/refusing a write: orgId is ""/);
    await expect(activate(crypto.randomUUID())).rejects.toThrow(/refusing a write: no organisation/);
    expect(LIVE_ORG_NAME.test(`LiveTest ${crypto.randomUUID()}`)).toBe(true);
    for (const name of ["OctaPM Demo Contracting", "PMcopilots UAT Fixtures", "OctaPM E2E", `LiveTest ${crypto.randomUUID()} x`, "LiveTest "]) {
      expect({ name, live: LIVE_ORG_NAME.test(name) }).toEqual({ name, live: false });
    }
  });

  it("sign-up makes a personal workspace: owner, individual plan, handle, templates, units and project defaults", async () => {
    const badZone = await api.post(
      "/api/v1/auth/register",
      { orgName: `LiveTest ${tag}`, name: owner.name, email: owner.email, password: PASSWORD, timezone: "Mars/Olympus_Mons" },
      MOBILE,
    );
    expect(badZone.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { email: owner.email } })).toBeNull();

    const res = await api.post(
      "/api/v1/auth/register",
      { orgName: `LiveTest ${tag}`, name: owner.name, email: owner.email, password: PASSWORD, currency: "aed", timezone: "Asia/Dubai" },
      MOBILE,
    );
    expect(res.status).toBe(201);
    // Recorded first, so a failing assertion below still leaves the workspace to afterAll.
    personal.orgId = res.body.data.organisation.id;
    personal.token = res.body.data.tokens.accessToken;
    owner.id = res.body.data.user.id;
    expect(res.body.data.organisation).toMatchObject({
      kind: "personal",
      plan: "individual",
      status: "active",
      defaultCurrency: "AED",
      defaultTimezone: "Asia/Dubai",
    });

    const org = await prisma.organisation.findUnique({ where: { id: personal.orgId } });
    expect(org).toMatchObject({ kind: "personal", plan: "individual", createdByUserId: owner.id, defaultCurrency: "AED", defaultTimezone: "Asia/Dubai" });
    expect(org.slug).toEqual(expect.any(String));
    personal.slug = org.slug;

    const membership = await prisma.organizationMembership.findFirst({ where: { orgId: personal.orgId, userId: owner.id } });
    expect(membership).toMatchObject({ role: "pm", kind: "member", isAdmin: true, isOwner: true, status: "active" });

    const templates = await prisma.permissionTemplate.findMany({ where: { orgId: personal.orgId }, select: { name: true } });
    expect(templates.map((row) => row.name).sort()).toEqual(DEFAULT_TEMPLATES.map((template) => template.name).sort());
    expect(templates).toHaveLength(12);

    const units = await prisma.unitOfMeasure.findMany({ where: { orgId: personal.orgId }, select: { code: true } });
    expect(units.map((row) => row.code).sort()).toEqual(DEFAULT_UNITS.map((unit) => unit.code).sort());

    const profile = await me(personal.token);
    expect(profile.body.data.memberships).toEqual([
      expect.objectContaining({ orgId: personal.orgId, kind: "personal", isOwner: true, isAdmin: true, role: "pm", slug: org.slug }),
    ]);

    const audit = await prisma.authAuditEvent.findFirst({ where: { orgId: personal.orgId, action: "workspace.created" } });
    expect(audit?.metadataJson).toMatchObject({ kind: "personal", plan: "individual" });
  });

  it("a project created in the personal workspace takes its currency and time zone unless it names its own", async () => {
    await activate(personal.orgId);
    const created = await api.post(
      "/api/v1/projects",
      { name: "Personal Project", type: "building", startDate: "2026-01-05", endDate: "2026-12-18" },
      bearer(personal.token),
    );
    expect(created.status).toBe(201);
    projectId = created.body.data.id;
    expect(await prisma.project.count({ where: { orgId: personal.orgId } })).toBe(1);
    expect(await prisma.project.findUnique({ where: { id: projectId }, select: { currency: true, timezone: true } })).toEqual({
      currency: "AED",
      timezone: "Asia/Dubai",
    });

    // A project that names its currency keeps it. (Made in a throwaway
    // workspace so the personal one holds exactly the project above.)
    const other = await prisma.organisation.create({ data: { name: `LiveTest ${crypto.randomUUID()}`, defaultCurrency: "EUR" } });
    extraOrgIds.push(other.id);
    const projectService = require("../project.service");
    const named = await projectService.createProject({ orgId: other.id, payload: { name: "Named", currency: "GBP" } });
    const defaulted = await projectService.createProject({ orgId: other.id, payload: { name: "Defaulted" } });
    expect(await prisma.project.findUnique({ where: { id: named.id }, select: { currency: true, timezone: true } })).toEqual({ currency: "GBP", timezone: null });
    expect(await prisma.project.findUnique({ where: { id: defaulted.id }, select: { currency: true, timezone: true } })).toEqual({ currency: "EUR", timezone: null });
  });

  it("POST /organisations makes a company workspace beside it, and the identity holds two seats", async () => {
    const badCurrency = await api.post("/api/v1/organisations", { name: `LiveTest ${crypto.randomUUID()}`, currency: "XQZ" }, bearer(personal.token));
    if (badCurrency.body?.data?.organisation?.id) extraOrgIds.push(badCurrency.body.data.organisation.id);
    expect(badCurrency.status).toBe(400);

    const res = await api.post(
      "/api/v1/organisations",
      { name: `LiveTest ${crypto.randomUUID()}`, currency: "eur", timezone: "Europe/Paris" },
      bearer(personal.token),
    );
    expect(res.status).toBe(201);
    company.orgId = res.body.data.organisation.id;
    expect(res.body.data.organisation).toMatchObject({
      kind: "company",
      plan: "standard",
      status: "active",
      defaultCurrency: "EUR",
      defaultTimezone: "Europe/Paris",
    });
    expect(res.body.data.workspace).toMatchObject({ orgId: res.body.data.organisation.id, kind: "company", role: "pm", isOwner: true, isAdmin: true, status: "active" });
    expect(res.body.data.memberships.map((entry) => entry.orgId).sort()).toEqual([personal.orgId, res.body.data.organisation.id].sort());
    company.slug = res.body.data.organisation.slug;
    expect(company.slug).toEqual(expect.any(String));
    expect(company.slug).not.toBe(personal.slug);

    // Provisioned like the first: subscription, templates, units, owner, defaults.
    expect(await prisma.subscription.count({ where: { orgId: company.orgId } })).toBe(1);
    expect(await prisma.permissionTemplate.count({ where: { orgId: company.orgId } })).toBe(12);
    expect(await prisma.unitOfMeasure.count({ where: { orgId: company.orgId } })).toBe(DEFAULT_UNITS.length);
    const org = await prisma.organisation.findUnique({ where: { id: company.orgId } });
    expect(org).toMatchObject({ kind: "company", createdByUserId: owner.id, defaultCurrency: "EUR", defaultTimezone: "Europe/Paris" });
    // The identity's home is untouched.
    expect((await prisma.user.findUnique({ where: { id: owner.id } })).orgId).toBe(personal.orgId);

    // Named nothing, a workspace gets the column defaults: USD and no zone.
    const plain = await api.post("/api/v1/organisations", { name: `LiveTest ${crypto.randomUUID()}` }, bearer(personal.token));
    if (plain.body?.data?.organisation?.id) extraOrgIds.push(plain.body.data.organisation.id);
    expect(plain.status).toBe(201);
    expect(plain.body.data.organisation).toMatchObject({ defaultCurrency: "USD", defaultTimezone: null });

    // A session can be issued for the new seat, and the personal one still works.
    const session = await enter(personal.token, company.orgId);
    expect(session.status).toBe(200);
    expect(session.body.data.workspace).toMatchObject({ orgId: company.orgId, kind: "company", isOwner: true });
    company.token = session.body.data.tokens.accessToken;
    expect((await me(personal.token)).status).toBe(200);

    const unauthenticated = await api.post("/api/v1/organisations", { name: "LiveTest nobody" }, MOBILE);
    expect(unauthenticated.status).toBe(401);
    const unnamed = await api.post("/api/v1/organisations", { name: "x" }, bearer(personal.token));
    expect(unnamed.status).toBe(400);
  });

  it("an API key is not a person: it can neither create nor convert a workspace", async () => {
    const apiClientService = require("../api-client.service");
    const key = await apiClientService.createApiClient({
      orgId: company.orgId,
      actor: { id: owner.id, role: "pm" },
      payload: { name: "Live key", scopes: ["*:read", "*:write"] },
    });
    expect(key.token).toEqual(expect.stringMatching(/^octapm_/));
    const keyName = `LiveTest ${crypto.randomUUID()}`;
    const created = await api.post("/api/v1/organisations", { name: keyName }, bearer(key.token));
    if (created.body?.data?.organisation?.id) extraOrgIds.push(created.body.data.organisation.id);
    expect(created.status).toBe(403);
    expect(created.body.error.code).toBe("API_KEY_FORBIDDEN");
    expect(await prisma.organisation.count({ where: { name: keyName } })).toBe(0);

    const converted = await convert(key.token, company.orgId);
    expect(converted.status).toBe(403);
    expect(converted.body.error.code).toBe("API_KEY_FORBIDDEN");
  });

  it("a failure after the organisation row rolls the whole creation back", async () => {
    const organisationService = require("../organisation.service");
    const uomService = require("../uom.service");
    const name = `LiveTest ${crypto.randomUUID()}`;
    const seatsBefore = await prisma.organizationMembership.count({ where: { userId: owner.id } });
    // The last step of provisioning, after the row, the owner seat, the
    // subscription and the templates are written.
    const injected = jest.spyOn(uomService, "seedDefaultUnits").mockRejectedValue(new Error("injected failure"));
    try {
      await expect(organisationService.createWorkspace({ userId: owner.id, name })).rejects.toThrow("injected failure");
    } finally {
      injected.mockRestore();
      // Whatever a broken build left, it is a LiveTest organisation to drop.
      const left = await prisma.organisation.findMany({ where: { name }, select: { id: true } });
      extraOrgIds.push(...left.map((row) => row.id));
    }
    expect(await prisma.organisation.count({ where: { name } })).toBe(0);
    expect(await prisma.organizationMembership.count({ where: { userId: owner.id } })).toBe(seatsBefore);
    expect(await prisma.authAuditEvent.count({ where: { userId: owner.id, action: "workspace.created", metadataJson: { path: ["name"], equals: name } } })).toBe(0);
  });

  it("a personal workspace refuses a second member on every path that would seat one, and still seats a guest", async () => {
    const direct = await api.post("/api/v1/users", { name: colleague.name, email: colleague.email, password: PASSWORD, role: "qs" }, bearer(personal.token));
    expect(direct.status).toBe(409);
    expect(direct.body.error.code).toBe("PERSONAL_WORKSPACE_CONVERT_REQUIRED");
    // Refused before the account exists: no orphan identity is left behind.
    expect(await prisma.user.findUnique({ where: { email: colleague.email } })).toBeNull();

    const invited = await api.post("/api/v1/users/invitations", { email: colleague.email, role: "qs" }, bearer(personal.token));
    expect(invited.status).toBe(409);
    expect(invited.body.error.code).toBe("PERSONAL_WORKSPACE_CONVERT_REQUIRED");
    const projectInvite = await api.post("/api/v1/users/invitations", { email: colleague.email, role: "site_engineer", projectId }, bearer(personal.token));
    expect(projectInvite.status).toBe(409);
    expect(projectInvite.body.error.code).toBe("PERSONAL_WORKSPACE_CONVERT_REQUIRED");

    // The party whose company the directory invitation names, and whose seat the guest takes below.
    const party = await api.post(`/api/v1/projects/${projectId}/parties`, { role: "subcontractor", companyName: `Live Guest Co ${tag}` }, bearer(personal.token));
    expect(party.status).toBe(201);
    const partyCompanyId = party.body.data.companyId;
    expect(partyCompanyId).toEqual(expect.any(String));
    // A company-directory invitation (a companyId, no party) seats a member
    // at acceptance, so it is refused before it is minted as well.
    const directoryInvite = await api.post("/api/v1/users/invitations", { email: colleague.email, role: "site_engineer", companyId: partyCompanyId }, bearer(personal.token));
    expect(directoryInvite.status).toBe(409);
    expect(directoryInvite.body.error.code).toBe("PERSONAL_WORKSPACE_CONVERT_REQUIRED");
    expect(await prisma.invitationToken.count({ where: { orgId: personal.orgId } })).toBe(0);

    // An identity that already exists elsewhere is refused the same way.
    await activate(company.orgId);
    const seated = await api.post("/api/v1/users", { name: colleague.name, email: colleague.email, password: PASSWORD, role: "qs" }, bearer(company.token));
    expect(seated.status).toBe(201);
    colleague.id = seated.body.data.id;
    const existing = await api.post("/api/v1/users", { name: colleague.name, email: colleague.email, role: "qs" }, bearer(personal.token));
    expect(existing.status).toBe(409);
    expect(existing.body.error.code).toBe("PERSONAL_WORKSPACE_CONVERT_REQUIRED");

    // A guest is not a member: a party invitation is minted and accepted, and
    // the party member is seated in the personal workspace as a guest.
    const born = await api.post("/api/v1/users", { name: guest.name, email: guest.email, password: PASSWORD, role: "site_engineer" }, bearer(company.token));
    expect(born.status).toBe(201);
    guest.id = born.body.data.id;
    const partyInvite = await api.post(
      "/api/v1/users/invitations",
      { email: guest.email, role: "site_engineer", projectId, projectPartyId: party.body.data.id },
      bearer(personal.token),
    );
    expect(partyInvite.status).toBe(201);
    const accepted = await api.post("/api/v1/auth/invitations/accept", { token: acceptLinkFor(guest.email), name: guest.name, password: PASSWORD }, MOBILE);
    expect(accepted.status).toBe(200);
    const guestRow = await prisma.organizationMembership.findFirst({ where: { orgId: personal.orgId, userId: guest.id } });
    expect(guestRow).toMatchObject({ kind: "guest", role: "external_party", status: "active" });
    expect(await prisma.organizationMembership.count({ where: { orgId: personal.orgId, kind: "member" } })).toBe(1);

    // An active guest is not a seated member: a project invitation would make
    // them one at acceptance, so it is refused before it is minted.
    const invitationsBefore = await prisma.invitationToken.count({ where: { orgId: personal.orgId } });
    const guestProjectInvite = await api.post("/api/v1/users/invitations", { email: guest.email, role: "site_engineer", projectId }, bearer(personal.token));
    expect(guestProjectInvite.status).toBe(409);
    expect(guestProjectInvite.body.error.code).toBe("PERSONAL_WORKSPACE_CONVERT_REQUIRED");
    expect(await prisma.invitationToken.count({ where: { orgId: personal.orgId } })).toBe(invitationsBefore);
  });

  it("SSO auto-provisioning into a personal workspace is refused and leaves no identity behind", async () => {
    const ssoService = require("../sso.service");
    const issuer = `https://idp-${tag}.octapm-live.test`;
    const clientId = `octapm-${tag}`;
    const idp = fakeIdentityProvider(issuer, clientId);
    await ssoService.updateSettings({
      orgId: personal.orgId,
      payload: { issuer, clientId, clientSecret: "live-secret", enabled: true, defaultRole: "site_engineer" },
      actor: { id: owner.id, role: "pm" },
    });
    expect((await prisma.organisation.findUnique({ where: { id: personal.orgId } })).ssoAutoProvision).toBe(true);

    const email = `live-sso-${tag}@octapm-live.test`;
    const started = await ssoService.start({ orgId: personal.orgId, fetchImpl: idp.fetchImpl });
    const authorization = new URL(started.authorizationUrl);
    idp.claims = { sub: `sso-${tag}`, email, email_verified: true, name: "Live SSO Person", nonce: authorization.searchParams.get("nonce") };
    const result = await ssoService.callback({ code: "live-code", state: authorization.searchParams.get("state") }, {}, { fetchImpl: idp.fetchImpl });
    expect(result.error).toBe("PERSONAL_WORKSPACE_CONVERT_REQUIRED");
    // The identity and its seat were one transaction: no active User homed in
    // the workspace with no membership, for the legacy fallback to let in.
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    expect(await prisma.organizationMembership.count({ where: { orgId: personal.orgId, kind: "member" } })).toBe(1);

    await prisma.organisation.update({ where: { id: personal.orgId }, data: { ssoEnabled: false } });
  });

  it("two seats taken at once in an empty personal workspace are serialised: one wins, the other is refused", async () => {
    // An empty personal workspace — its owner's row not yet written, as a
    // workspace mid-provisioning or mid-backfill is — and two people.
    const racing = await prisma.organisation.create({ data: { name: `LiveTest ${crypto.randomUUID()}`, kind: "personal" } });
    extraOrgIds.push(racing.id);
    const first = await createLiveUser(prisma, { orgId: company.orgId, name: "Live First", email: `live-first-${tag}@octapm-live.test`, role: "qs" });
    const second = await createLiveUser(prisma, { orgId: company.orgId, name: "Live Second", email: `live-second-${tag}@octapm-live.test`, role: "qs" });

    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let firstSeated;
    const seatedFirst = new Promise((resolve) => {
      firstSeated = resolve;
    });
    // The first seat is written and its transaction held open; the second is
    // attempted meanwhile. Unserialised, the second counts zero committed
    // members and takes a seat too.
    const winner = prisma.$transaction(
      async (tx) => {
        await membershipService.ensureMembership({ tx, orgId: racing.id, userId: first.id, role: "qs" });
        firstSeated();
        await gate;
      },
      { timeout: 20_000 },
    );
    await seatedFirst;
    const loser = prisma
      .$transaction((tx) => membershipService.ensureMembership({ tx, orgId: racing.id, userId: second.id, role: "qs" }), { timeout: 20_000, maxWait: 20_000 })
      .then(
        () => null,
        (error) => error,
      );
    await sleep(1_000);
    release();
    await winner;
    const refusal = await loser;
    expect(refusal?.code).toBe("PERSONAL_WORKSPACE_CONVERT_REQUIRED");
    const seats = await prisma.organizationMembership.findMany({ where: { orgId: racing.id, kind: "member" }, select: { userId: true } });
    expect(seats).toEqual([{ userId: first.id }]);
  });

  it("conversion is the owner's, of the session's workspace, and a company has nothing to convert", async () => {
    const colleagueLogin = await login(colleague.email);
    expect(colleagueLogin.status).toBe(200);
    const colleagueToken = colleagueLogin.body.data.tokens.accessToken;
    const asMember = await convert(colleagueToken, company.orgId);
    expect(asMember.status).toBe(403);
    expect(asMember.body.error.code).toBe("OWNER_REQUIRED");

    const alreadyCompany = await convert(company.token, company.orgId);
    expect(alreadyCompany.status).toBe(409);
    expect(alreadyCompany.body.error.code).toBe("WORKSPACE_ALREADY_COMPANY");

    // The token is bound to the company; the personal workspace is not this session's.
    const otherWorkspace = await convert(company.token, personal.orgId);
    expect(otherWorkspace.status).toBe(404);
    expect(otherWorkspace.body.error.code).toBe("WORKSPACE_NOT_FOUND");

    expect((await prisma.organisation.findUnique({ where: { id: personal.orgId } })).kind).toBe("personal");
  });

  it("the personal project is given work to keep: a BOQ item, an activity, an attachment and a posted cost", async () => {
    const post = (route, body) => api.post(`/api/v1/projects/${projectId}${route}`, body, bearer(personal.token));
    const boq = await post("/boq/items", { code: "1.1", description: "Concrete in foundations", quantity: 120, unit: "M3", rate: 150 });
    expect(boq.status).toBe(201);
    const activity = await post("/activities", { name: "Pour foundations", wbsCode: "1", startDate: "2026-02-02", endDate: "2026-02-20", engineerIds: [owner.id] });
    expect(`${activity.status} ${JSON.stringify(activity.body?.error ?? null)}`).toBe("201 null");
    const activityId = activity.body.data.id;

    const form = new FormData();
    form.append("recordType", "activity");
    form.append("recordId", activityId);
    form.append("files", new Blob(["pour record"], { type: "text/plain" }), "pour-record.txt");
    const uploaded = await fetch(`${api.base}/api/v1/projects/${projectId}/attachments`, { method: "POST", headers: bearer(personal.token), body: form });
    expect({ status: uploaded.status, body: uploaded.status === 201 ? null : await uploaded.text() }).toMatchObject({ status: 201 });

    // Every line of a direct cost is coded before it is submitted; the code is workspace reference data.
    const costCode = await prisma.costCode.create({ data: { orgId: personal.orgId, code: "03-30", name: "Cast-in-place concrete", category: "material" } });
    await prisma.projectCostCode.create({ data: { orgId: personal.orgId, projectId, costCodeId: costCode.id } });
    const cost = await post("/direct-costs", {
      description: "Concrete delivery",
      costDate: "2026-02-03",
      type: "invoice",
      lines: [{ description: "C30 concrete", amount: 1800, activityId, costCodeId: costCode.id, costType: "material" }],
    });
    expect(`${cost.status} ${JSON.stringify(cost.body?.error ?? null)}`).toBe("201 null");
    const costId = cost.body.data.id;
    const submitted = await post(`/direct-costs/${costId}/submit`, {});
    expect(`${submitted.status} ${JSON.stringify(submitted.body?.error ?? null)}`).toBe("200 null");
    const approved = await post(`/direct-costs/${costId}/approve`, {});
    expect(`${approved.status} ${JSON.stringify(approved.body?.error ?? null)}`).toBe("200 null");

    expect(await prisma.boqItem.count({ where: { projectId } })).toBeGreaterThan(0);
    expect(await prisma.activity.count({ where: { projectId } })).toBeGreaterThan(0);
    expect(await prisma.attachment.count({ where: { orgId: personal.orgId } })).toBeGreaterThan(0);
    expect(await prisma.costLedgerEntry.count({ where: { orgId: personal.orgId } })).toBeGreaterThan(0);
  });

  it("converting the personal workspace flips kind and plan, keeps slug and owner, and moves no row", async () => {
    const before = await settledCounts(personal.orgId);
    expect(before.project).toBe(1);
    expect(before.organizationMembership).toBe(2);
    // Something to protect in every family §15 names.
    for (const key of ["project:boqItem", "project:activity", "attachment", "directCost", "costLedgerEntry", "authAuditEvent"]) {
      expect({ key, count: before[key] }).toEqual({ key, count: expect.any(Number) });
      expect(before[key]).toBeGreaterThan(0);
    }
    const ledgerBefore = await prisma.costLedgerEntry.findMany({ where: { orgId: personal.orgId }, select: { id: true, amount: true }, orderBy: { id: "asc" } });
    const projectBefore = await prisma.project.findUnique({ where: { id: projectId }, select: { orgId: true, updatedAt: true } });

    const res = await convert(personal.token, personal.orgId, { name: `LiveTest ${tag}` });
    expect(res.status).toBe(200);
    expect(res.body.data.organisation).toMatchObject({ id: personal.orgId, kind: "company", plan: "standard", slug: personal.slug });
    expect(res.body.data.workspace).toMatchObject({ orgId: personal.orgId, kind: "company", isOwner: true, isAdmin: true, role: "pm" });
    // The personal workspace, the company and the defaults-less workspace made beside it.
    expect(res.body.data.memberships).toHaveLength(3);

    const org = await prisma.organisation.findUnique({ where: { id: personal.orgId } });
    expect(org).toMatchObject({ kind: "company", plan: "standard", slug: personal.slug, createdByUserId: owner.id });
    const ownerRow = await prisma.organizationMembership.findFirst({ where: { orgId: personal.orgId, userId: owner.id } });
    expect(ownerRow).toMatchObject({ isOwner: true, isAdmin: true, role: "pm", status: "active" });

    const after = await settledCounts(personal.orgId);
    // The audit line of the conversion is the one row the conversion adds.
    expect(after.authAuditEvent).toBe(before.authAuditEvent + 1);
    const { authAuditEvent: _a, ...beforeRest } = before;
    const { authAuditEvent: _b, ...afterRest } = after;
    expect(afterRest).toEqual(beforeRest);
    expect(await prisma.costLedgerEntry.findMany({ where: { orgId: personal.orgId }, select: { id: true, amount: true }, orderBy: { id: "asc" } })).toEqual(ledgerBefore);
    expect(await prisma.project.findUnique({ where: { id: projectId }, select: { orgId: true, updatedAt: true } })).toEqual(projectBefore);
    // The subscription row is not re-priced by a conversion.
    expect(await prisma.subscription.findUnique({ where: { orgId: personal.orgId } })).toMatchObject({ plan: "business", status: "active" });

    const audit = await prisma.authAuditEvent.findFirst({ where: { orgId: personal.orgId, action: "workspace.converted" } });
    expect(audit?.metadataJson).toMatchObject({ from: "personal", to: "company", plan: { from: "individual", to: "standard" } });

    // The session is still the same membership; the profile now says company.
    const profile = await me(personal.token);
    expect(profile.status).toBe(200);
    expect(profile.body.data.memberships.find((entry) => entry.orgId === personal.orgId)).toMatchObject({ kind: "company", isOwner: true });
  });

  it("after conversion a second member is seated where it was refused before", async () => {
    const existing = await api.post("/api/v1/users", { name: colleague.name, email: colleague.email, role: "qs" }, bearer(personal.token));
    expect(existing.status).toBe(201);
    expect(existing.body.data).toMatchObject({ id: colleague.id, existingIdentity: true });

    const invited = await api.post("/api/v1/users/invitations", { email: `live-third-${tag}@octapm-live.test`, role: "site_engineer" }, bearer(personal.token));
    expect(invited.status).toBe(201);
    expect(await prisma.organizationMembership.count({ where: { orgId: personal.orgId, kind: "member" } })).toBe(2);

    const again = await convert(personal.token, personal.orgId);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("WORKSPACE_ALREADY_COMPANY");
  });

  it("billing mail goes to the owner membership's user, not the earliest PM", async () => {
    // The colleague becomes a PM in the (converted) workspace and the owner's
    // legacy User.role stops being pm — the old pick ("earliest pm") would now
    // name the colleague; the owner rule names the owner.
    //
    // Exactly one row changes, named by its unique key: a missing id throws
    // here instead of rewriting every membership in the database.
    const orgId = requireId(personal.orgId, "personal.orgId");
    const userId = requireId(colleague.id, "colleague.id");
    await requireLiveOrg(orgId);
    const key = { orgId_userId: { orgId, userId } };
    const target = await prisma.organizationMembership.findUnique({ where: key });
    expect(target).toMatchObject({ orgId, userId, kind: "member" });
    const bystandersBefore = await bystanderMemberships(orgId, userId);
    expect(bystandersBefore.some((row) => row.orgId === orgId)).toBe(true);
    expect(bystandersBefore.some((row) => row.orgId !== orgId)).toBe(true);

    await prisma.organizationMembership.update({ where: key, data: { role: "pm" } });

    expect((await prisma.organizationMembership.findUnique({ where: key })).role).toBe("pm");
    const bystandersAfter = new Map((await bystanderMemberships(orgId, userId)).map((row) => [row.id, row]));
    const changed = bystandersBefore.filter((row) => {
      const now = bystandersAfter.get(row.id);
      return !now || now.role !== row.role || now.updatedAt.getTime() !== row.updatedAt.getTime();
    });
    expect(changed).toEqual([]);

    await prisma.user.update({ where: { id: requireId(owner.id, "owner.id") }, data: { role: "finance" } });
    const recipient = await membershipService.findBillingRecipient({ orgId: personal.orgId });
    expect(recipient).toMatchObject({ id: owner.id, email: owner.email });

    // The cancellation email's address (subscription.service orgEmail).
    const subscriptionService = require("../subscription.service");
    expect(await subscriptionService.orgEmail(personal.orgId)).toBe(owner.email);

    // The scheduler's reminder for a trial ending in a day goes to that address.
    jest.resetModules();
    const sent = [];
    jest.doMock("../email.service", () => ({
      sendEmail: jest.fn(async (message) => {
        sent.push(message);
        return { delivered: true };
      }),
      templates: { trialEndingIn2Days: () => ({ subject: "2 days" }), trialEndsTomorrow: () => ({ subject: "tomorrow" }) },
    }));
    const { runBillingChecks } = require("../../jobs/billing-scheduler");
    const now = new Date();
    await prisma.subscription.update({
      where: { orgId: personal.orgId },
      data: { status: "trialing", trialEndsAt: new Date(now.getTime() + 12 * 60 * 60 * 1000), reminderDay5SentAt: null, reminderDay7SentAt: null },
    });
    await runBillingChecks(now, { orgIds: [personal.orgId] });
    jest.dontMock("../email.service");
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((message) => message.to === owner.email)).toBe(true);
  });
});
