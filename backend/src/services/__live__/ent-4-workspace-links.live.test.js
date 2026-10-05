/**
 * Links carry their workspace (enterprise wave ENT-4), driven through a real
 * API process against the real local database.
 *
 *   npm run test:live -- src/services/__live__/ent-4-workspace-links.live.test.js
 *
 * Two throwaway organisations, A and B, and one identity in both (created in
 * A, added directly to B). A owns a project.
 *
 * What must hold:
 *   - a notification stored for A opens under `/o/{A's slug}/projects/…`,
 *     whichever legacy path its caller built; an organisation without a slug
 *     is named by its id; a notification with no link keeps none;
 *   - GET /auth/workspaces/resolve answers A's workspace for A's project from
 *     a session bound to B (`active: false`), from one bound to A
 *     (`active: true`) and from the identity token (`active: null`);
 *   - a project of an organisation the identity does not belong to, and a
 *     project that does not exist, both answer 404 PROJECT_NOT_FOUND.
 */
const crypto = require("crypto");
const { prisma } = require("../../config/db");
const { dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");
const notificationService = require("../notification.service");

const PASSWORD = "Live-Passw0rd!9a";
const MOBILE = { "x-octapm-client": "mobile" };
const bearer = (token) => ({ ...MOBILE, authorization: `Bearer ${token}` });

liveDescribe("workspace links: notification paths and the legacy-link resolver", () => {
  let api;
  const orgs = {};
  const persona = { email: `live-persona-${crypto.randomUUID()}@octapm-live.test` };
  const tokens = {};
  let projectId;

  const register = async (label) => {
    const id = crypto.randomUUID();
    const res = await api.post(
      "/api/v1/auth/register",
      { orgName: `LiveTest ${id}`, name: `${label} Admin`, email: `live-${label}-${id}@octapm-live.test`, password: PASSWORD },
      MOBILE,
    );
    if (res.status !== 201) throw new Error(`register ${label}: ${res.status} ${res.text}`);
    const { user, tokens: issued } = res.body.data;
    // A brand-new organisation is on a trial with no allowance; this test is
    // about links, not billing, so the throwaway organisation gets a plan.
    // One row by its unique key (orgId is unique on Subscription): a missing
    // id throws instead of re-pricing every subscription in the database.
    if (typeof user?.orgId !== "string" || !user.orgId) throw new Error(`register ${label}: no organisation id in the response`);
    await prisma.subscription.update({
      where: { orgId: user.orgId },
      data: { plan: "business", status: "active", seats: 25, currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) },
    });
    // Sign-up makes a personal workspace, which seats nobody but its owner
    // (ENT-6); these are teams, so each is converted through the product's route.
    const converted = await api.post(`/api/v1/organisations/${user.orgId}/convert`, {}, bearer(issued.accessToken));
    if (converted.status !== 200) throw new Error(`convert ${label}: ${converted.status} ${converted.text}`);
    const org = await prisma.organisation.findUnique({ where: { id: user.orgId }, select: { slug: true } });
    return { label, orgId: user.orgId, slug: org.slug, admin: user, token: issued.accessToken };
  };

  const login = (email) => api.post("/api/v1/auth/login", { email, password: PASSWORD }, MOBILE);
  const enter = (token, orgId) => api.post(`/api/v1/auth/workspaces/${orgId}/session`, {}, bearer(token));
  const resolve = (token, id) => api.get(`/api/v1/auth/workspaces/resolve?projectId=${id}`, bearer(token));
  /** The accept link the local log transport printed for the newest invitation email. */
  const acceptLinkFor = (email) => {
    const output = api.proc.output();
    const start = output.lastIndexOf(`[email:local] -> ${email} |`);
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
    expect(orgs.a.slug).toEqual(expect.any(String));

    const created = await api.post("/api/v1/users", { name: "Persona", email: persona.email, password: PASSWORD, role: "qs" }, bearer(orgs.a.token));
    expect(created.status).toBe(201);
    persona.id = created.body.data.id;
    // B cannot attach the existing identity (owner decision L38): it is
    // invited, and joins by accepting with a session of its own.
    const direct = await api.post("/api/v1/users", { name: "Persona", email: persona.email, password: "Ignored-Passw0rd!", role: "pm" }, bearer(orgs.b.token));
    expect(direct.status).toBe(202);
    expect(direct.body.data).toMatchObject({ invited: true, email: persona.email, role: "pm", status: "pending" });
    const own = await login(persona.email);
    expect(own.status).toBe(200);
    const accepted = await api.post("/api/v1/auth/invitations/accept", { token: acceptLinkFor(persona.email) }, bearer(own.body.data.tokens.accessToken));
    expect(accepted.status).toBe(200);

    const project = await api.post(
      "/api/v1/projects",
      { name: "Links A", type: "building", startDate: "2026-01-05", endDate: "2026-12-18" },
      bearer(orgs.a.token),
    );
    expect(project.status).toBe(201);
    projectId = project.body.data.id;

    const choice = await login(persona.email);
    expect(choice.status).toBe(200);
    expect(choice.body.data.chooseWorkspace).toBe(true);
    tokens.identity = choice.body.data.identityToken;
    const inA = await enter(tokens.identity, orgs.a.orgId);
    expect(inA.status).toBe(200);
    tokens.a = inA.body.data.tokens.accessToken;
    const inB = await enter(tokens.identity, orgs.b.orgId);
    expect(inB.status).toBe(200);
    tokens.b = inB.body.data.tokens.accessToken;
  }, 120_000);

  afterAll(async () => {
    await api?.stop();
    for (const org of Object.values(orgs)) await dropLiveOrg(prisma, org.orgId);
    await prisma.$disconnect();
  });

  it("stores every notification link under its workspace", async () => {
    const legacy = `/projects/${projectId}/doc-control/rfi?recordId=rfi-1&source=rfi`;
    const result = await notificationService.createNotifications({
      orgId: orgs.a.orgId,
      projectId,
      recipientUserIds: [persona.id],
      type: "rfi",
      event: "rfi.assigned",
      title: "Link test",
      message: "A link built from the project alone",
      actionUrl: legacy,
      entityType: "rfi",
      entityId: "rfi-1",
      dedupeKeyBase: `live-link:${crypto.randomUUID()}`,
    });
    expect(result.created).toBe(1);
    const row = await prisma.notification.findFirst({
      where: { orgId: orgs.a.orgId, recipientUserId: persona.id, title: "Link test" },
      orderBy: { createdAt: "desc" },
    });
    expect(row.actionUrl).toBe(`/o/${orgs.a.slug}${legacy}`);

    // The API serves the stored link as it is: the client opens it directly.
    const listed = await api.get("/api/v1/notifications?limit=50", bearer(tokens.a));
    expect(listed.status).toBe(200);
    const served = listed.body.data.rows.find((item) => item.id === row.id);
    expect(served.actionUrl).toBe(`/o/${orgs.a.slug}${legacy}`);

    // No link stays no link; a path already inside a workspace is left alone.
    const none = await notificationService.createNotifications({
      orgId: orgs.a.orgId,
      projectId,
      recipientUserIds: [persona.id],
      type: "rfi",
      event: "rfi.assigned",
      title: "No link",
      message: "Nothing to open",
      dedupeKeyBase: `live-nolink:${crypto.randomUUID()}`,
    });
    expect(none.created).toBe(1);
    const noneRow = await prisma.notification.findFirst({ where: { orgId: orgs.a.orgId, recipientUserId: persona.id, title: "No link" } });
    expect(noneRow.actionUrl).toBeNull();
  });

  it("names an organisation without a slug by its id", async () => {
    // The seeded E2E organisation has no slug (prisma/seed.js sets none), and
    // any organisation may be in that state until it is given one.
    await prisma.organisation.update({ where: { id: orgs.b.orgId }, data: { slug: null } });
    const projectB = await api.post(
      "/api/v1/projects",
      { name: "Links B", type: "building", startDate: "2026-01-05", endDate: "2026-12-18" },
      bearer(orgs.b.token),
    );
    expect(projectB.status).toBe(201);
    // Recipients are still matched by the User row's own organisation (the
    // per-membership fan-out is ENT-5's), so B's administrator receives it.
    const sent = await notificationService.createNotifications({
      orgId: orgs.b.orgId,
      projectId: projectB.body.data.id,
      recipientUserIds: [orgs.b.admin.id],
      type: "rfi",
      event: "rfi.assigned",
      title: "Slugless",
      message: "Named by id",
      actionUrl: `/projects/${projectB.body.data.id}/doc-control/rfi`,
      dedupeKeyBase: `live-slugless:${crypto.randomUUID()}`,
    });
    expect(sent.created).toBe(1);
    const row = await prisma.notification.findFirst({ where: { orgId: orgs.b.orgId, recipientUserId: orgs.b.admin.id, title: "Slugless" } });
    expect(row.actionUrl).toBe(`/o/${orgs.b.orgId}/projects/${projectB.body.data.id}/doc-control/rfi`);

    const resolved = await resolve(tokens.b, projectB.body.data.id);
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.workspace).toMatchObject({ orgId: orgs.b.orgId, slug: null, segment: orgs.b.orgId });
    expect(resolved.body.data.active).toBe(true);
  });

  it("resolves a legacy link to the workspace that owns the project, from any of the identity's tokens", async () => {
    const fromB = await resolve(tokens.b, projectId);
    expect(fromB.status).toBe(200);
    expect(fromB.body.data).toMatchObject({
      project: { id: projectId, name: "Links A" },
      workspace: { orgId: orgs.a.orgId, slug: orgs.a.slug, segment: orgs.a.slug, role: "qs", kind: "company" },
      active: false,
    });
    expect(fromB.body.data.workspace.membershipId).toEqual(expect.any(String));

    const fromA = await resolve(tokens.a, projectId);
    expect(fromA.status).toBe(200);
    expect(fromA.body.data.active).toBe(true);

    const fromIdentity = await resolve(tokens.identity, projectId);
    expect(fromIdentity.status).toBe(200);
    expect(fromIdentity.body.data.workspace.orgId).toBe(orgs.a.orgId);
    expect(fromIdentity.body.data.active).toBeNull();
  });

  it("answers 404 for a project outside the identity's workspaces, the same as for one that does not exist", async () => {
    const outsider = await resolve(orgs.c.token, projectId);
    expect(outsider.status).toBe(404);
    expect(outsider.body.error.code).toBe("PROJECT_NOT_FOUND");

    const missing = await resolve(tokens.a, crypto.randomUUID());
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("PROJECT_NOT_FOUND");
    expect(missing.body.error.message).toBe(outsider.body.error.message);

    const malformed = await api.get("/api/v1/auth/workspaces/resolve?projectId=not-a-uuid", bearer(tokens.a));
    expect(malformed.status).toBe(400);

    const anonymous = await api.get(`/api/v1/auth/workspaces/resolve?projectId=${projectId}`, MOBILE);
    expect(anonymous.status).toBe(401);
  });
});
