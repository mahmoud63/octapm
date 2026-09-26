/**
 * One identity in several workspaces (enterprise wave ENT-2, the §51 persona),
 * driven through a real API process against the real local database.
 *
 *   npm run test:live -- src/services/__live__/auth-workspaces.live.test.js
 *
 * Three throwaway organisations are registered through the product's own
 * sign-up: A, B and C. The persona is created in A as a QS (POST /users), is
 * invited into B as a PM and accepts (POST /users/invitations → the accept
 * link the log transport prints → POST /auth/invitations/accept), and is
 * added directly to C (POST /users with an email that already exists). A
 * fourth person, created in C, joins A only as a party member (guest).
 *
 * What must hold:
 *   - sign-up and a one-workspace login answer exactly today's shape, and the
 *     token names the membership (mid/adm/own/kind);
 *   - a login with several workspaces returns a choice; a session is issued
 *     per workspace; A's project is 404 from B's session and the reverse; the
 *     role differs per workspace (a PM in B creates a project, a QS in A may
 *     not); switching does not revoke the other workspace's refresh family;
 *   - a token minted before this wave (no `mid`) still authenticates;
 *   - nobody changes their own role or standing (403); only an owner grants
 *     ownership (403); the last owner cannot be suspended (409);
 *   - a suspended membership refuses the token and the refresh, and leaves
 *     the identity's other workspace alone; a guest is refused by the
 *     org-level routers and reaches their party's project.
 */
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { prisma } = require("../../config/db");
const { dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const PASSWORD = "Live-Passw0rd!9a";
const MOBILE = { "x-octapm-client": "mobile" };
const TODAYS_USER_KEYS = [
  "id",
  "orgId",
  "name",
  "email",
  "phone",
  "role",
  "isCompanyAdmin",
  "status",
  "lastLogin",
  "mfaEnabled",
  "ssoLinked",
  "createdAt",
  "updatedAt",
  "mfaEnrollmentRequired",
];

const decode = (token) => jwt.decode(token);
const bearer = (token) => ({ ...MOBILE, authorization: `Bearer ${token}` });

liveDescribe("workspaces: one identity, several organisations", () => {
  let api;
  const orgs = {};
  const persona = { email: `live-persona-${crypto.randomUUID()}@octapm-live.test` };
  const guest = { email: `live-guest-${crypto.randomUUID()}@octapm-live.test` };
  const sessions = {};

  const register = async (label) => {
    const id = crypto.randomUUID();
    const res = await api.post(
      "/api/v1/auth/register",
      { orgName: `LiveTest ${id}`, name: `${label} Admin`, email: `live-${label}-${id}@octapm-live.test`, password: PASSWORD },
      MOBILE,
    );
    if (res.status !== 201) throw new Error(`register ${label}: ${res.status} ${res.text}`);
    const { user, tokens } = res.body.data;
    // A brand-new organisation is on a trial with no allowance and its
    // writes stop at the subscription gate (402); this test is about
    // memberships, not billing, so the throwaway organisation gets a plan.
    await prisma.subscription.updateMany({
      where: { orgId: user.orgId },
      data: { plan: "business", status: "active", seats: 25, currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) },
    });
    return { label, orgId: user.orgId, admin: user, token: tokens.accessToken, refreshToken: tokens.refreshToken, email: user.email };
  };

  const login = (email) => api.post("/api/v1/auth/login", { email, password: PASSWORD }, MOBILE);
  const enter = (token, orgId) => api.post(`/api/v1/auth/workspaces/${orgId}/session`, {}, bearer(token));
  const me = (token) => api.get("/api/v1/auth/me", bearer(token));

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
    orgs.a = await register("a");
    orgs.b = await register("b");
    orgs.c = await register("c");
  }, 120_000);

  afterAll(async () => {
    await api?.stop();
    for (const org of Object.values(orgs)) await dropLiveOrg(prisma, org.orgId);
    await prisma.$disconnect();
  });

  it("sign-up and a one-workspace login keep today's shape, and the token names the membership", async () => {
    const res = await login(orgs.a.email);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data.user).sort()).toEqual([...TODAYS_USER_KEYS].sort());
    expect(res.body.data).not.toHaveProperty("chooseWorkspace");
    expect(res.body.data.user).toMatchObject({ orgId: orgs.a.orgId, role: "pm", isCompanyAdmin: true });

    const claims = decode(res.body.data.tokens.accessToken);
    expect(claims).toMatchObject({ sub: orgs.a.admin.id, orgId: orgs.a.orgId, adm: true, own: true, kind: "member", type: "access" });
    expect(claims.mid).toEqual(expect.any(String));
    expect(decode(res.body.data.tokens.refreshToken).mid).toBe(claims.mid);

    const profile = await me(res.body.data.tokens.accessToken);
    expect(profile.status).toBe(200);
    expect(profile.body.data.active).toEqual({ orgId: orgs.a.orgId, membershipId: claims.mid });
    expect(profile.body.data.memberships).toEqual([
      expect.objectContaining({ orgId: orgs.a.orgId, membershipId: claims.mid, role: "pm", isAdmin: true, isOwner: true, status: "active", kind: "company" }),
    ]);
    expect(profile.body.data.memberships[0].slug).toEqual(expect.any(String));

    const session = await prisma.refreshSession.findFirst({ where: { userId: orgs.a.admin.id }, orderBy: { createdAt: "desc" } });
    expect(session.membershipId).toBe(claims.mid);
  });

  it("an identity joins a second workspace by invitation and a third by direct add", async () => {
    // The persona is born in A as a QS.
    const created = await api.post("/api/v1/users", { name: "Persona", email: persona.email, password: PASSWORD, role: "qs" }, bearer(orgs.a.token));
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ role: "qs", isCompanyAdmin: false, status: "active" });
    expect(created.body.data.existingIdentity).toBeUndefined();
    persona.id = created.body.data.id;

    // B invites the same email as a PM; the preview and the acceptance welcome
    // the existing identity and bind the session to B.
    const invited = await api.post("/api/v1/users/invitations", { email: persona.email, role: "pm" }, bearer(orgs.b.token));
    expect(invited.status).toBe(201);
    const token = acceptLinkFor(persona.email);
    const preview = await api.get(`/api/v1/auth/invitations/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({ existingUser: true, requiresPassword: false, role: "pm" });
    const accepted = await api.post("/api/v1/auth/invitations/accept", { token, name: "Persona" }, MOBILE);
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.user).toMatchObject({ id: persona.id, orgId: orgs.b.orgId, role: "pm", name: "Persona" });
    expect(decode(accepted.body.data.tokens.accessToken)).toMatchObject({ orgId: orgs.b.orgId, role: "pm", adm: false, own: false });

    // The identity's own columns are untouched: A is still home, still a QS.
    const row = await prisma.user.findUnique({ where: { id: persona.id } });
    expect(row).toMatchObject({ orgId: orgs.a.orgId, role: "qs" });

    // A second invitation to B for someone already active there is refused;
    // C adds the identity directly and says so.
    const again = await api.post("/api/v1/users/invitations", { email: persona.email, role: "pm" }, bearer(orgs.b.token));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_MEMBER");
    const direct = await api.post("/api/v1/users", { name: "Someone Else", email: persona.email, password: "Ignored-Passw0rd!", role: "site_engineer" }, bearer(orgs.c.token));
    expect(direct.status).toBe(201);
    expect(direct.body.data).toMatchObject({ id: persona.id, existingIdentity: true, role: "site_engineer", name: "Persona" });
    const twice = await api.post("/api/v1/users", { name: "Persona", email: persona.email, role: "qs" }, bearer(orgs.c.token));
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe("EMAIL_EXISTS");

    // C's user list shows the persona with C's role; A's with A's.
    const listC = await api.get("/api/v1/users?search=persona", bearer(orgs.c.token));
    expect(listC.body.data.items.find((item) => item.id === persona.id)).toMatchObject({ role: "site_engineer" });
    const listA = await api.get("/api/v1/users?search=persona", bearer(orgs.a.token));
    expect(listA.body.data.items.find((item) => item.id === persona.id)).toMatchObject({ role: "qs" });
  }, 60_000);

  it("a login with several workspaces returns a choice; sessions are per workspace and roles differ", async () => {
    const res = await login(persona.email);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ chooseWorkspace: true, identityToken: expect.any(String) });
    expect(res.body.data.tokens).toBeUndefined();
    const listed = Object.fromEntries(res.body.data.memberships.map((m) => [m.orgId, m]));
    expect(listed[orgs.a.orgId]).toMatchObject({ role: "qs", status: "active" });
    expect(listed[orgs.b.orgId]).toMatchObject({ role: "pm", status: "active" });
    expect(listed[orgs.c.orgId]).toMatchObject({ role: "site_engineer", status: "active" });

    // The identity token reaches the profile and nothing else.
    const identity = res.body.data.identityToken;
    expect(decode(identity)).toMatchObject({ type: "identity", sub: persona.id });
    const profile = await me(identity);
    expect(profile.status).toBe(200);
    expect(profile.body.data.active).toBeNull();
    expect(profile.body.data.memberships).toHaveLength(3);
    const refused = await api.get("/api/v1/users", bearer(identity));
    expect(refused.status).toBe(401);
    expect(refused.body.error.code).toBe("WORKSPACE_REQUIRED");
    const elsewhere = await enter(identity, crypto.randomUUID());
    expect(elsewhere.status).toBe(404);
    expect(elsewhere.body.error.code).toBe("WORKSPACE_NOT_FOUND");

    // Into A: a QS.
    const inA = await enter(identity, orgs.a.orgId);
    expect(inA.status).toBe(200);
    expect(inA.body.data.user).toMatchObject({ id: persona.id, orgId: orgs.a.orgId, role: "qs", isCompanyAdmin: false });
    expect(inA.body.data.workspace).toMatchObject({ orgId: orgs.a.orgId, role: "qs" });
    expect(inA.body.data.memberships).toHaveLength(3);
    sessions.a = inA.body.data.tokens;
    expect(decode(sessions.a.accessToken)).toMatchObject({ orgId: orgs.a.orgId, mid: listed[orgs.a.orgId].membershipId, role: "qs" });

    // A's project exists; B's is 404 from A's session; a QS may not create one.
    const projectA = await api.post("/api/v1/projects", { name: "Live A" }, bearer(orgs.a.token));
    expect(projectA.status).toBe(201);
    orgs.a.projectId = projectA.body.data.id;
    const projectB = await api.post("/api/v1/projects", { name: "Live B" }, bearer(orgs.b.token));
    expect(projectB.status).toBe(201);
    orgs.b.projectId = projectB.body.data.id;
    const crossA = await api.get(`/api/v1/projects/${orgs.b.projectId}`, bearer(sessions.a.accessToken));
    expect(crossA.status).toBe(404);
    const asQs = await api.post("/api/v1/projects", { name: "QS cannot" }, bearer(sessions.a.accessToken));
    expect(asQs.status).toBe(403);

    // Switch to B with A's access token: a PM, who sees B's project, not A's,
    // and may create — B's trial allows one project, so the refusal must be
    // the plan's, not the role's.
    const inB = await enter(sessions.a.accessToken, orgs.b.orgId);
    expect(inB.status).toBe(200);
    expect(inB.body.data.user).toMatchObject({ id: persona.id, orgId: orgs.b.orgId, role: "pm" });
    sessions.b = inB.body.data.tokens;
    const ownB = await api.get(`/api/v1/projects/${orgs.b.projectId}`, bearer(sessions.b.accessToken));
    expect(ownB.status).toBe(200);
    const crossB = await api.get(`/api/v1/projects/${orgs.a.projectId}`, bearer(sessions.b.accessToken));
    expect(crossB.status).toBe(404);
    const asPm = await api.post("/api/v1/projects", { name: "PM may" }, bearer(sessions.b.accessToken));
    expect(asPm.status).not.toBe(403);
    expect([201, 402]).toContain(asPm.status);

    // The switch revoked nothing: A's refresh token still rotates, into A.
    const refreshedA = await api.post("/api/v1/auth/refresh", { refreshToken: sessions.a.refreshToken }, MOBILE);
    expect(refreshedA.status).toBe(200);
    expect(refreshedA.body.data.user).toMatchObject({ orgId: orgs.a.orgId, role: "qs" });
    expect(decode(refreshedA.body.data.tokens.accessToken).mid).toBe(listed[orgs.a.orgId].membershipId);
    sessions.a = refreshedA.body.data.tokens;
    const audit = await prisma.authAuditEvent.findMany({ where: { orgId: orgs.b.orgId, userId: persona.id, action: "workspace.switched" } });
    expect(audit.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("a token minted before this wave (no mid) still authenticates against the membership", async () => {
    const legacy = jwt.sign(
      { sub: persona.id, orgId: orgs.a.orgId, role: "qs", email: persona.email, name: "Persona", isCompanyAdmin: false, type: "access" },
      process.env.JWT_SECRET,
      { expiresIn: "5m" },
    );
    expect(decode(legacy).mid).toBeUndefined();
    const profile = await me(legacy);
    expect(profile.status).toBe(200);
    expect(profile.body.data).toMatchObject({ id: persona.id, orgId: orgs.a.orgId, role: "qs" });
    expect(profile.body.data.active).toMatchObject({ orgId: orgs.a.orgId, membershipId: expect.any(String) });
    const project = await api.get(`/api/v1/projects/${orgs.b.projectId}`, bearer(legacy));
    expect(project.status).toBe(404);
  });

  it("nobody changes their own standing; only an owner grants ownership; the last owner stays", async () => {
    // The persona, a PM in B, may not make themselves an administrator.
    const selfElevation = await api.request("PATCH", `/api/v1/users/${persona.id}`, { body: { isCompanyAdmin: true }, headers: bearer(sessions.b.accessToken) });
    expect(selfElevation.status).toBe(403);
    expect(selfElevation.body.error.code).toBe("SELF_ELEVATION_FORBIDDEN");
    const stillPlain = await me(sessions.b.accessToken);
    expect(stillPlain.body.data.isCompanyAdmin).toBe(false);

    // B's owner makes them an administrator; the standing is read per request,
    // so even the token minted before the change carries it now.
    const granted = await api.request("PATCH", `/api/v1/users/${persona.id}`, { body: { isCompanyAdmin: true }, headers: bearer(orgs.b.token) });
    expect(granted.status).toBe(200);
    expect(granted.body.data).toMatchObject({ isCompanyAdmin: true, isOwner: false, role: "pm" });
    expect((await me(sessions.b.accessToken)).body.data.isCompanyAdmin).toBe(true);
    // ...and only in B: the identity's own columns and A's view are unchanged.
    expect(await prisma.user.findUnique({ where: { id: persona.id }, select: { isCompanyAdmin: true } })).toEqual({ isCompanyAdmin: false });
    expect((await me(sessions.a.accessToken)).body.data.isCompanyAdmin).toBe(false);

    // An administrator who is not an owner may not touch ownership, and may
    // not suspend the only owner.
    const ownership = await api.request("PATCH", `/api/v1/users/${orgs.b.admin.id}`, { body: { isOwner: false }, headers: bearer(sessions.b.accessToken) });
    expect(ownership.status).toBe(403);
    expect(ownership.body.error.code).toBe("OWNER_REQUIRED");
    const lastOwner = await api.request("PATCH", `/api/v1/users/${orgs.b.admin.id}/deactivate`, { headers: bearer(sessions.b.accessToken) });
    expect(lastOwner.status).toBe(409);
    expect(lastOwner.body.error.code).toBe("LAST_OWNER");
    const ownerStanding = await me(orgs.b.token);
    expect(ownerStanding.status).toBe(200);
    expect(ownerStanding.body.data.memberships.find((m) => m.orgId === orgs.b.orgId)).toMatchObject({ isOwner: true, status: "active" });

    // The audit trail names the grant.
    const events = await prisma.authAuditEvent.findMany({ where: { orgId: orgs.b.orgId, userId: persona.id, entityType: "membership" }, select: { action: true } });
    expect(events.map((event) => event.action)).toEqual(expect.arrayContaining(["membership.invitation_accepted", "membership.admin_granted"]));
  }, 60_000);

  it("a suspended membership refuses the token and the refresh, and leaves the other workspace alone", async () => {
    const suspended = await api.request("PATCH", `/api/v1/users/${persona.id}/deactivate`, { headers: bearer(orgs.b.token) });
    expect(suspended.status).toBe(200);
    expect(suspended.body.data.status).toBe("inactive");

    const refusedB = await me(sessions.b.accessToken);
    expect(refusedB.status).toBe(401);
    expect(refusedB.body.error.code).toBe("USER_INACTIVE");
    const refreshB = await api.post("/api/v1/auth/refresh", { refreshToken: sessions.b.refreshToken }, MOBILE);
    expect(refreshB.status).toBe(401);

    // The identity is still active and still a QS in A.
    expect((await me(sessions.a.accessToken)).status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: persona.id }, select: { status: true } })).toEqual({ status: "active" });
    const choice = await login(persona.email);
    expect(choice.body.data.chooseWorkspace).toBe(true);
    expect(choice.body.data.memberships.find((m) => m.orgId === orgs.b.orgId)).toMatchObject({ status: "suspended" });
    const intoB = await enter(choice.body.data.identityToken, orgs.b.orgId);
    expect(intoB.status).toBe(403);
    expect(intoB.body.error.code).toBe("USER_INACTIVE");

    // Reactivated, B is theirs again.
    const reactivated = await api.request("PATCH", `/api/v1/users/${persona.id}/activate`, { headers: bearer(orgs.b.token) });
    expect(reactivated.status).toBe(200);
    const backIn = await enter(choice.body.data.identityToken, orgs.b.orgId);
    expect(backIn.status).toBe(200);
    expect(backIn.body.data.user).toMatchObject({ orgId: orgs.b.orgId, role: "pm", isCompanyAdmin: true });
  }, 60_000);

  it("a party member from another workspace is a guest: their project, not the company", async () => {
    const born = await api.post("/api/v1/users", { name: "Guest", email: guest.email, password: PASSWORD, role: "site_engineer" }, bearer(orgs.c.token));
    expect(born.status).toBe(201);
    guest.id = born.body.data.id;

    const party = await api.post(`/api/v1/projects/${orgs.a.projectId}/parties`, { role: "subcontractor", companyName: "Live Guest Co" }, bearer(orgs.a.token));
    if (party.status !== 201) throw new Error(`party: ${party.status} ${party.text}`);
    const invited = await api.post(
      "/api/v1/users/invitations",
      { email: guest.email, role: "site_engineer", projectId: orgs.a.projectId, projectPartyId: party.body.data.id },
      bearer(orgs.a.token),
    );
    expect(invited.status).toBe(201);
    const accepted = await api.post("/api/v1/auth/invitations/accept", { token: acceptLinkFor(guest.email), name: "Guest" }, MOBILE);
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.user).toMatchObject({ id: guest.id, orgId: orgs.a.orgId, role: "external_party" });
    const claims = decode(accepted.body.data.tokens.accessToken);
    expect(claims).toMatchObject({ orgId: orgs.a.orgId, kind: "guest", adm: false, own: false });

    const token = accepted.body.data.tokens.accessToken;
    const companyWide = await api.get("/api/v1/users", bearer(token));
    expect(companyWide.status).toBe(403);
    expect(companyWide.body.error.code).toBe("GUEST_FORBIDDEN");
    const theirProject = await api.get(`/api/v1/projects/${orgs.a.projectId}`, bearer(token));
    expect(theirProject.status).toBe(200);
    const profile = await me(token);
    expect(profile.body.data.memberships.find((m) => m.orgId === orgs.a.orgId)).toMatchObject({ role: "external_party", kind: "company" });
    const membership = await prisma.organizationMembership.findFirst({ where: { orgId: orgs.a.orgId, userId: guest.id } });
    expect(membership).toMatchObject({ kind: "guest", role: "external_party", isAdmin: false, isOwner: false, status: "active" });
  }, 60_000);
});
