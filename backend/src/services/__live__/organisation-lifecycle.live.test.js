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
 *     permission templates and the default units;
 *   - a project can be created in it;
 *   - POST /organisations makes a second, COMPANY workspace, provisioned
 *     the same way, and the identity now holds two memberships;
 *   - a personal workspace refuses a second member — direct add, workspace
 *     invitation, project invitation — with 409 PERSONAL_WORKSPACE_CONVERT_REQUIRED,
 *     and still seats a guest (party member);
 *   - conversion is the owner's (403 OWNER_REQUIRED for a member), of the
 *     session's own workspace (404 otherwise), and a company is 409
 *     WORKSPACE_ALREADY_COMPANY;
 *   - converting flips kind and plan, keeps the slug and the owner, and
 *     changes no row of any table: every orgId-carrying model counts the
 *     same rows under the personal workspace before and after, the ledger
 *     and budget rows included; afterwards a second member is seated where
 *     it was refused before;
 *   - billing mail goes to the owner membership's user, not the earliest PM.
 */
const crypto = require("crypto");
const { Prisma } = require("@prisma/client");
const { prisma } = require("../../config/db");
const { dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");
const { DEFAULT_TEMPLATES } = require("../permission-template.service");
const { DEFAULT_UNITS } = require("../uom.service");
const membershipService = require("../membership.service");

const PASSWORD = "Live-Passw0rd!9a";
const MOBILE = { "x-octapm-client": "mobile" };
const bearer = (token) => ({ ...MOBILE, authorization: `Bearer ${token}` });

/** Every Prisma model that carries a tenant column, by its client key. */
const ORG_MODELS = Prisma.dmmf.datamodel.models
  .filter((model) => model.fields.some((field) => field.name === "orgId" && field.kind === "scalar"))
  .map((model) => model.name.charAt(0).toLowerCase() + model.name.slice(1))
  .filter((key) => typeof prisma[key]?.count === "function");

/** Rows per orgId-carrying model under one workspace — the conversion invariant. */
const countRowsByOrg = async (orgId) => {
  const counts = {};
  for (const key of ORG_MODELS) counts[key] = await prisma[key].count({ where: { orgId } });
  return counts;
};

/** A plan for a throwaway workspace: a brand-new one is on a trial with no allowance (402 on its first write). */
const activate = (orgId) =>
  prisma.subscription.updateMany({
    where: { orgId },
    data: { plan: "business", status: "active", seats: 25, currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) },
  });

liveDescribe("workspaces: personal at sign-up, a company beside it, conversion", () => {
  let api;
  const tag = crypto.randomUUID();
  const owner = { email: `live-owner-${tag}@octapm-live.test`, name: "Live Owner" };
  const colleague = { email: `live-colleague-${tag}@octapm-live.test`, name: "Live Colleague" };
  const guest = { email: `live-guest-${tag}@octapm-live.test`, name: "Live Guest" };
  const personal = {};
  const company = {};
  let projectId = null;
  let before = null;

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
    // The company first: the identity's home is the personal workspace, and
    // its membership in the company hangs off both.
    await dropLiveOrg(prisma, company.orgId);
    await dropLiveOrg(prisma, personal.orgId);
    await prisma.$disconnect();
  });

  it("sign-up makes a personal workspace: owner, individual plan, handle, templates and units", async () => {
    const res = await api.post(
      "/api/v1/auth/register",
      { orgName: `LiveTest ${tag}`, name: owner.name, email: owner.email, password: PASSWORD },
      MOBILE,
    );
    expect(res.status).toBe(201);
    expect(res.body.data.organisation).toMatchObject({ kind: "personal", plan: "individual", status: "active" });
    personal.orgId = res.body.data.organisation.id;
    personal.token = res.body.data.tokens.accessToken;
    owner.id = res.body.data.user.id;

    const org = await prisma.organisation.findUnique({ where: { id: personal.orgId } });
    expect(org).toMatchObject({ kind: "personal", plan: "individual", createdByUserId: owner.id });
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

  it("a project can be created in the personal workspace", async () => {
    await activate(personal.orgId);
    const created = await api.post(
      "/api/v1/projects",
      { name: "Personal Project", type: "building", startDate: "2026-01-05", endDate: "2026-12-18" },
      bearer(personal.token),
    );
    expect(created.status).toBe(201);
    projectId = created.body.data.id;
    expect(await prisma.project.count({ where: { orgId: personal.orgId } })).toBe(1);
  });

  it("POST /organisations makes a company workspace beside it, and the identity holds two seats", async () => {
    const res = await api.post("/api/v1/organisations", { name: `LiveTest ${crypto.randomUUID()}` }, bearer(personal.token));
    expect(res.status).toBe(201);
    expect(res.body.data.organisation).toMatchObject({ kind: "company", plan: "standard", status: "active" });
    expect(res.body.data.workspace).toMatchObject({ orgId: res.body.data.organisation.id, kind: "company", role: "pm", isOwner: true, isAdmin: true, status: "active" });
    expect(res.body.data.memberships.map((entry) => entry.orgId).sort()).toEqual([personal.orgId, res.body.data.organisation.id].sort());
    company.orgId = res.body.data.organisation.id;
    company.slug = res.body.data.organisation.slug;
    expect(company.slug).toEqual(expect.any(String));
    expect(company.slug).not.toBe(personal.slug);

    // Provisioned like the first: subscription, templates, units, owner.
    expect(await prisma.subscription.count({ where: { orgId: company.orgId } })).toBe(1);
    expect(await prisma.permissionTemplate.count({ where: { orgId: company.orgId } })).toBe(12);
    expect(await prisma.unitOfMeasure.count({ where: { orgId: company.orgId } })).toBe(DEFAULT_UNITS.length);
    const org = await prisma.organisation.findUnique({ where: { id: company.orgId } });
    expect(org).toMatchObject({ kind: "company", createdByUserId: owner.id });
    // The identity's home is untouched.
    expect((await prisma.user.findUnique({ where: { id: owner.id } })).orgId).toBe(personal.orgId);

    // A session can be issued for the new seat, and the personal one still works.
    const session = await enter(personal.token, company.orgId);
    expect(session.status).toBe(200);
    expect(session.body.data.workspace).toMatchObject({ orgId: company.orgId, kind: "company", isOwner: true });
    company.token = session.body.data.tokens.accessToken;
    expect((await me(personal.token)).status).toBe(200);

    // A key is not a person: it cannot make workspaces (the route refuses before any write).
    const unauthenticated = await api.post("/api/v1/organisations", { name: "LiveTest nobody" }, MOBILE);
    expect(unauthenticated.status).toBe(401);
    const unnamed = await api.post("/api/v1/organisations", { name: "x" }, bearer(personal.token));
    expect(unnamed.status).toBe(400);
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
    const party = await api.post(`/api/v1/projects/${projectId}/parties`, { role: "subcontractor", companyName: `Live Guest Co ${tag}` }, bearer(personal.token));
    expect(party.status).toBe(201);
    const partyInvite = await api.post(
      "/api/v1/users/invitations",
      { email: guest.email, role: "site_engineer", projectId, projectPartyId: party.body.data.id },
      bearer(personal.token),
    );
    expect(partyInvite.status).toBe(201);
    const accepted = await api.post("/api/v1/auth/invitations/accept", { token: acceptLinkFor(guest.email), name: guest.name, password: PASSWORD }, MOBILE);
    expect(accepted.status).toBe(200);
    const guestRow = await prisma.organizationMembership.findFirst({ where: { orgId: personal.orgId, userId: born.body.data.id } });
    expect(guestRow).toMatchObject({ kind: "guest", role: "external_party", status: "active" });
    expect(await prisma.organizationMembership.count({ where: { orgId: personal.orgId, kind: "member" } })).toBe(1);
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

  it("converting the personal workspace flips kind and plan, keeps slug and owner, and moves no row", async () => {
    before = await countRowsByOrg(personal.orgId);
    expect(before.project).toBe(1);
    expect(before.organizationMembership).toBe(2);
    const ledgerBefore = await prisma.costLedgerEntry.count({ where: { orgId: personal.orgId } });
    const budgetBefore = await prisma.budgetLine.count({ where: { project: { orgId: personal.orgId } } });
    const projectBefore = await prisma.project.findUnique({ where: { id: projectId }, select: { orgId: true, updatedAt: true } });

    const res = await convert(personal.token, personal.orgId, { name: `LiveTest ${tag}` });
    expect(res.status).toBe(200);
    expect(res.body.data.organisation).toMatchObject({ id: personal.orgId, kind: "company", plan: "standard", slug: personal.slug });
    expect(res.body.data.workspace).toMatchObject({ orgId: personal.orgId, kind: "company", isOwner: true, isAdmin: true, role: "pm" });
    expect(res.body.data.memberships).toHaveLength(2);

    const org = await prisma.organisation.findUnique({ where: { id: personal.orgId } });
    expect(org).toMatchObject({ kind: "company", plan: "standard", slug: personal.slug, createdByUserId: owner.id });
    const ownerRow = await prisma.organizationMembership.findFirst({ where: { orgId: personal.orgId, userId: owner.id } });
    expect(ownerRow).toMatchObject({ isOwner: true, isAdmin: true, role: "pm", status: "active" });

    const after = await countRowsByOrg(personal.orgId);
    // The audit line of the conversion is the one row the conversion adds.
    expect(after.authAuditEvent).toBe(before.authAuditEvent + 1);
    const { authAuditEvent: _a, ...beforeRest } = before;
    const { authAuditEvent: _b, ...afterRest } = after;
    expect(afterRest).toEqual(beforeRest);
    expect(await prisma.costLedgerEntry.count({ where: { orgId: personal.orgId } })).toBe(ledgerBefore);
    expect(await prisma.budgetLine.count({ where: { project: { orgId: personal.orgId } } })).toBe(budgetBefore);
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
    await prisma.organizationMembership.updateMany({ where: { orgId: personal.orgId, userId: colleague.id }, data: { role: "pm" } });
    await prisma.user.update({ where: { id: owner.id }, data: { role: "finance" } });
    const recipient = await membershipService.findBillingRecipient({ orgId: personal.orgId });
    expect(recipient).toMatchObject({ id: owner.id, email: owner.email });

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
