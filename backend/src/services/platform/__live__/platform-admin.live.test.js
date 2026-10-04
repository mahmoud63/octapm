/**
 * Platform Superadmin V1 — live proof against a real API process and database.
 *
 *   npm run test:live -- src/services/platform/__live__/platform-admin.live.test.js
 *
 * Proves: the gate refuses anonymous callers, company owners/admins, PMs, site
 * engineers, multi-company people and API keys on every platform route; an
 * operator is let through only with an active PlatformUserAccess row and MFA;
 * revocation takes effect on the next request; every request (and every
 * refusal) lands in PlatformAuditEvent; figures equal an independent recount;
 * paging and filters hold; planted customer content (RFI text, a contract
 * value, audit summaries, document names) never appears in any answer; usage
 * and error events are recorded with catalogue words only.
 */
const crypto = require("crypto");
const { prisma } = require("../../../config/db");
const { createLiveMembership, createLiveOrg, createLiveUser, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../../__live__/helpers");
const { startApi } = require("../../__live__/auth-live-kit");

const CANARY = `CANARY-${crypto.randomUUID()}`;
const CANARY_AMOUNT = "98765432.17";
const STARTED_AT = new Date();
const ORPHAN_ENTITY = crypto.randomUUID();
const ROUTES = [
  "/api/v1/platform-admin/session",
  "/api/v1/platform-admin/overview",
  "/api/v1/platform-admin/companies",
  "/api/v1/platform-admin/users",
  "/api/v1/platform-admin/projects",
  "/api/v1/platform-admin/subscriptions",
  "/api/v1/platform-admin/analytics",
  "/api/v1/platform-admin/health",
  "/api/v1/platform-admin/errors",
  "/api/v1/platform-admin/audit",
];
const FORBIDDEN_KEYS = ["passwordHash", "tokenHash", "mfaSecretEnc", "mfaPendingSecretEnc", "mfaBackupCodesJson", "stripeCustomerId", "stripeSubscriptionId", "contractValue", "summaryJson", "payloadJson", "errorMessage", "question", "response"];
const bearer = (token) => ({ authorization: `Bearer ${token}` });

liveDescribe("Platform Superadmin V1", () => {
  let api;
  let orgA; // owner/admin = orgA.user
  let orgB;
  let orgOps; // the platform operator's home workspace
  let operator;
  let pmA;
  let siteA;
  let multi;
  let projectA;
  let projectB;

  beforeAll(async () => {
    orgA = await createLiveOrg(prisma);
    orgB = await createLiveOrg(prisma);
    orgOps = await createLiveOrg(prisma, { role: "site_engineer", isCompanyAdmin: false });
    pmA = await createLiveUser(prisma, { orgId: orgA.org.id, name: "PM A", email: `pm-${crypto.randomUUID()}@octapm-live.test`, role: "pm" });
    siteA = await createLiveUser(prisma, { orgId: orgA.org.id, name: "Site A", email: `site-${crypto.randomUUID()}@octapm-live.test`, role: "site_engineer" });
    // A person in two companies (home A, also a member of B).
    multi = await createLiveUser(prisma, { orgId: orgA.org.id, name: "Multi Person", email: `multi-${crypto.randomUUID()}@octapm-live.test`, role: "qs" });
    multi.membershipB = await prisma.organizationMembership.create({
      data: { orgId: orgB.org.id, userId: multi.id, role: "qs", kind: "member", status: "active", joinedAt: new Date() },
    });
    operator = orgOps.user;
    await prisma.user.update({ where: { id: operator.id }, data: { mfaEnabled: true } });
    await prisma.platformUserAccess.create({
      data: { userId: operator.id, reason: "live test operator", grantedBy: "platform-admin.live.test" },
    });

    // Customer content that must never surface.
    projectA = await prisma.project.create({ data: { orgId: orgA.org.id, name: "Riverside Tower A", contractValue: CANARY_AMOUNT } });
    projectB = await prisma.project.create({ data: { orgId: orgB.org.id, name: "Harbour Works B" } });
    await prisma.projectAssignment.create({ data: { projectId: projectA.id, userId: pmA.id, role: "pm", orgId: orgA.org.id } });
    await prisma.rfi.create({ data: { projectId: projectA.id, ref: "RFI-001", subject: `${CANARY} subject`, question: `${CANARY} question`, status: "open" } });
    await prisma.auditEvent.create({
      data: {
        orgId: orgA.org.id, projectId: projectA.id, entityType: "rfi", entityId: crypto.randomUUID(), action: "created",
        actorId: pmA.id, reason: `${CANARY} reason`, summaryJson: { text: CANARY }, newSummaryJson: { q: CANARY }, metadataJson: { m: CANARY },
      },
    });
    await prisma.projectDocument.create({
      data: {
        orgId: orgA.org.id, projectId: projectA.id, documentType: "drawing", title: `${CANARY} title`, originalName: `${CANARY}.pdf`,
        fileName: `${CANARY}.pdf`, mimeType: "application/pdf", sizeBytes: 4096, sha256: "0".repeat(64), storageProvider: "local",
        objectKey: `live/${CANARY}`, storageKey: `live/${CANARY}`,
      },
    });

    // Audit rows of an organisation that no longer exists (AuditEvent has no FK):
    // they must not count as a company using a module.
    for (let i = 0; i < 3; i += 1) {
      await prisma.auditEvent.create({
        data: { orgId: crypto.randomUUID(), entityType: "rfi", entityId: ORPHAN_ENTITY, action: "created", actorId: crypto.randomUUID() },
      });
    }

    api = await startApi({ PLATFORM_TELEMETRY_ENABLED: "true", PLATFORM_ADMIN_REQUIRE_MFA: "true" });
  }, 180_000);

  afterAll(async () => {
    await api?.stop();
    const orgIds = [orgA, orgB, orgOps].filter(Boolean).map((o) => o.org.id);
    const userIds = [operator?.id].filter(Boolean);
    await prisma.platformAuditEvent.deleteMany({ where: { OR: [{ actorUserId: { in: [...userIds, ...[orgA, orgB].filter(Boolean).map((o) => o.user.id), pmA?.id, siteA?.id, multi?.id].filter(Boolean) } }, { targetOrgId: { in: orgIds } }] } });
    await prisma.productEvent.deleteMany({ where: { orgId: { in: orgIds } } });
    await prisma.auditEvent.deleteMany({ where: { entityId: ORPHAN_ENTITY } });
    await prisma.platformErrorEvent.deleteMany({ where: { orgId: { in: orgIds } } });
    // The gate's refusals carry no company (the gate never resolves one): remove
    // this run's, by window and route, so they do not count as platform errors.
    await prisma.platformErrorEvent.deleteMany({
      where: {
        orgId: null,
        occurredAt: { gte: STARTED_AT },
        OR: [{ routePattern: { startsWith: "/platform-admin" } }, { routePattern: "/telemetry/events" }],
      },
    });
    if (multi?.membershipB) await prisma.organizationMembership.delete({ where: { id: multi.membershipB.id } }).catch(() => null);
    for (const id of orgIds) await dropLiveOrg(prisma, id);
    await prisma.$disconnect();
  });

  const asOperator = (route) => api.get(route, bearer(mintAccessToken(operator)));

  describe("the gate fails closed", () => {
    it("refuses anonymous callers on every route", async () => {
      for (const route of [...ROUTES, `/api/v1/platform-admin/companies/${orgA.org.id}`]) {
        const res = await api.get(route);
        expect([route, res.status]).toEqual([route, 401]);
      }
    });

    it("refuses a company owner/admin, a PM, a site engineer and a multi-company person — by direct URL, on every route", async () => {
      const people = [
        ["owner+admin of A", orgA.user],
        ["owner+admin of B", orgB.user],
        ["PM of A", pmA],
        ["site engineer of A", siteA],
        ["multi-company person", multi],
      ];
      for (const [label, user] of people) {
        for (const route of [...ROUTES, `/api/v1/platform-admin/companies/${orgA.org.id}`, `/api/v1/platform-admin/companies/${orgB.org.id}`]) {
          const res = await api.get(route, bearer(mintAccessToken(user)));
          expect([label, route, res.status, res.body?.error?.code]).toEqual([label, route, 403, "PLATFORM_ACCESS_REQUIRED"]);
        }
      }
      // The multi-company person with a token bound to their second workspace.
      const tokenB = mintAccessToken({ ...multi, orgId: orgB.org.id, membershipId: multi.membershipB.id });
      const res = await api.get("/api/v1/platform-admin/companies", bearer(tokenB));
      expect(res.status).toBe(403);
    });

    it("refuses an API key and a forged/garbled token", async () => {
      expect((await api.get("/api/v1/platform-admin/overview", bearer("octapm_abcdefghijklmnopqrstuvwxyz"))).body.error.code).toBe("PLATFORM_ACCESS_REQUIRED");
      expect((await api.get("/api/v1/platform-admin/overview", bearer("not.a.jwt"))).status).toBe(401);
    });

    it("records each refusal of a signed-in person in the platform audit trail", async () => {
      const denied = await prisma.platformAuditEvent.count({ where: { actorUserId: pmA.id, action: "platform.access_denied.no_access" } });
      expect(denied).toBeGreaterThan(0);
    });

    it("refuses an operator whose account has no MFA, and lets them in once it does", async () => {
      await prisma.user.update({ where: { id: operator.id }, data: { mfaEnabled: false } });
      const refused = await asOperator("/api/v1/platform-admin/session");
      expect([refused.status, refused.body.error.code]).toEqual([403, "PLATFORM_MFA_REQUIRED"]);
      await prisma.user.update({ where: { id: operator.id }, data: { mfaEnabled: true } });
      const allowed = await asOperator("/api/v1/platform-admin/session");
      expect(allowed.status).toBe(200);
      expect(allowed.body.data.operator).toMatchObject({ userId: operator.id, role: "platform_superadmin" });
    });

    it("stops honouring an operator on the next request after revocation, and again after re-grant", async () => {
      await prisma.platformUserAccess.update({ where: { userId: operator.id }, data: { status: "revoked", revokedAt: new Date(), revokedBy: "live test" } });
      expect((await asOperator("/api/v1/platform-admin/overview")).status).toBe(403);
      await prisma.platformUserAccess.update({ where: { userId: operator.id }, data: { status: "active", revokedAt: null, revokedBy: null } });
      expect((await asOperator("/api/v1/platform-admin/overview")).status).toBe(200);
    });

    it("refuses a deactivated operator account", async () => {
      await prisma.user.update({ where: { id: operator.id }, data: { status: "inactive" } });
      expect((await asOperator("/api/v1/platform-admin/overview")).status).toBe(401);
      await prisma.user.update({ where: { id: operator.id }, data: { status: "active" } });
    });

    it("leaves ordinary tenant routes as they were: the operator gets no access to another company's project", async () => {
      const res = await api.get(`/api/v1/projects/${projectA.id}`, bearer(mintAccessToken(operator)));
      expect([403, 404]).toContain(res.status);
    });
  });

  describe("read models", () => {
    it("overview counts equal an independent recount", async () => {
      const res = await asOperator("/api/v1/platform-admin/overview");
      expect(res.status).toBe(200);
      const d = res.body.data;
      expect(d.organisations.total).toBe(await prisma.organisation.count());
      expect(d.users.total).toBe(await prisma.user.count());
      expect(d.projects.total).toBe(await prisma.project.count());
      const subs = await prisma.subscription.groupBy({ by: ["plan"], _count: true });
      for (const s of subs) expect(d.subscriptions.byPlan[s.plan]).toBe(s._count);
      expect(d.invitations.pending).toBe(await prisma.invitationToken.count({ where: { status: "pending", expiresAt: { gt: new Date() }, revokedAt: null } }));
      expect(d.release.version).toBeTruthy();
    });

    it("companies: rows, counts, search, filters and pages", async () => {
      const res = await asOperator(`/api/v1/platform-admin/companies?q=${encodeURIComponent(orgA.org.name)}`);
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      const row = res.body.data.items[0];
      expect(row).toMatchObject({ id: orgA.org.id, plan: "business", subscriptionStatus: "active", activeMembers: 4, activeProjects: 1, totalProjects: 1 });
      expect(row.storageBytes).toBe(4096);
      // Last activity is the same whether it is looked up for the page or computed for the sort.
      expect(row.lastActivityAt).toBeTruthy();
      const sorted = await asOperator(`/api/v1/platform-admin/companies?q=${encodeURIComponent(orgA.org.name)}&sort=-activity`);
      expect(sorted.body.data.items[0].lastActivityAt).toBe(row.lastActivityAt);
      const active = await asOperator(`/api/v1/platform-admin/companies?q=${encodeURIComponent(orgA.org.name)}&activity=active`);
      expect(active.body.data.items.map((c) => c.id)).toEqual([orgA.org.id]);

      const page1 = await asOperator("/api/v1/platform-admin/companies?q=LiveTest&pageSize=1&page=1&sort=name");
      const page2 = await asOperator("/api/v1/platform-admin/companies?q=LiveTest&pageSize=1&page=2&sort=name");
      expect(page1.body.data.page.total).toBeGreaterThanOrEqual(3);
      expect(page1.body.data.items[0].id).not.toBe(page2.body.data.items[0].id);
      const recount = await prisma.organisation.count({ where: { name: { contains: "LiveTest", mode: "insensitive" } } });
      expect(page1.body.data.page.total).toBe(recount);

      const big = await asOperator("/api/v1/platform-admin/companies?pageSize=101");
      expect(big.status).toBe(400);
      const injected = await asOperator("/api/v1/platform-admin/companies?sort=name;drop%20table");
      expect(injected.status).toBe(400);
    });

    it("company detail shows metadata, members and projects — and no customer content", async () => {
      const res = await asOperator(`/api/v1/platform-admin/companies/${orgA.org.id}`);
      expect(res.status).toBe(200);
      const d = res.body.data;
      expect(d.company.id).toBe(orgA.org.id);
      expect(d.members.items.map((m) => m.userId).sort()).toEqual([orgA.user.id, pmA.id, siteA.id, multi.id].sort());
      expect(d.projects.items).toEqual([expect.objectContaining({ id: projectA.id, name: "Riverside Tower A", members: 1 })]);
      expect(d.usage.recordActivity).toEqual(expect.arrayContaining([expect.objectContaining({ module: "rfi", action: "created", events: 1 })]));
      expect((await asOperator(`/api/v1/platform-admin/companies/${crypto.randomUUID()}`)).body.error.code).toBe("PLATFORM_COMPANY_NOT_FOUND");
    });

    it("users: a multi-company person shows both memberships, never credentials", async () => {
      const res = await asOperator(`/api/v1/platform-admin/users?q=${encodeURIComponent(multi.email)}`);
      expect(res.status).toBe(200);
      const [row] = res.body.data.items;
      expect(row).toMatchObject({ id: multi.id, activeMemberships: 2, memberships: 2, platformOperator: false });
      expect(row.companies.map((c) => c.id).sort()).toEqual([orgA.org.id, orgB.org.id].sort());
      const multiOnly = await asOperator(`/api/v1/platform-admin/users?multiCompany=true&orgId=${orgB.org.id}`);
      expect(multiOnly.body.data.items.map((u) => u.id)).toEqual([multi.id]);
      const ops = await asOperator(`/api/v1/platform-admin/users?q=${encodeURIComponent(operator.email)}`);
      expect(ops.body.data.items[0].platformOperator).toBe(true);
    });

    it("projects: metadata only, filter by company", async () => {
      const res = await asOperator(`/api/v1/platform-admin/projects?orgId=${orgB.org.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.items.map((p) => p.id)).toEqual([projectB.id]);
      expect(res.body.data.items[0].organisation).toEqual({ id: orgB.org.id, name: orgB.org.name });
    });

    it("subscriptions: canonical fields, provider linkage as booleans only", async () => {
      const res = await asOperator(`/api/v1/platform-admin/subscriptions?q=${encodeURIComponent(orgA.org.name)}`);
      expect(res.status).toBe(200);
      expect(res.body.data.items[0]).toMatchObject({
        organisation: { id: orgA.org.id }, plan: "business", recognized: true, status: "active", hasAccess: true,
        seats: 25, activeMembers: 4, providerCustomerLinked: false, paymentIssue: false,
      });
    });

    it("analytics, health, errors and audit answer with bounded windows", async () => {
      const analytics = await asOperator("/api/v1/platform-admin/analytics?windowDays=7");
      expect(analytics.status).toBe(200);
      expect(analytics.body.data.windowDays).toBe(7);
      expect(analytics.body.data.funnels.map((f) => f.key)).toEqual(["project_setup", "rfi", "progress", "daily_reports"]);
      expect((await asOperator("/api/v1/platform-admin/analytics?windowDays=365")).status).toBe(400);
      const health = await asOperator("/api/v1/platform-admin/health");
      expect(health.status).toBe(200);
      expect(health.body.data.database.ok).toBe(true);
      expect((await asOperator("/api/v1/platform-admin/errors")).status).toBe(200);
      expect((await asOperator("/api/v1/platform-admin/audit")).status).toBe(200);
    });

    it("counts only existing, active companies: a module's share never exceeds 100%", async () => {
      const { data } = (await asOperator("/api/v1/platform-admin/analytics?windowDays=7")).body;
      const rfi = data.modules.recordActivity.find((m) => m.module === "rfi");
      const liveRfiOrgs = await prisma.auditEvent.findMany({
        where: { entityType: "rfi", occurredAt: { gte: new Date(Date.now() - 7 * 86_400_000) }, orgId: { in: (await prisma.organisation.findMany({ where: { status: "active" }, select: { id: true } })).map((o) => o.id) } },
        distinct: ["orgId"],
        select: { orgId: true },
      });
      expect(rfi.companies).toBe(liveRfiOrgs.length);
      for (const row of [...data.modules.recordActivity, ...data.modules.trackedEvents]) {
        expect([row.module, row.companies <= data.denominators.activeCompanies]).toEqual([row.module, true]);
      }
    });

    it("no answer carries planted customer content, credentials or commercial figures", async () => {
      const routes = [
        ...ROUTES,
        `/api/v1/platform-admin/companies/${orgA.org.id}`,
        `/api/v1/platform-admin/users?orgId=${orgA.org.id}`,
        `/api/v1/platform-admin/projects?orgId=${orgA.org.id}`,
        "/api/v1/platform-admin/analytics?windowDays=90",
      ];
      for (const route of routes) {
        const res = await asOperator(route);
        expect([route, res.status]).toEqual([route, 200]);
        expect([route, res.text.includes(CANARY)]).toEqual([route, false]);
        expect([route, res.text.includes("98765432")]).toEqual([route, false]);
        for (const key of FORBIDDEN_KEYS) expect([route, key, res.text.includes(`"${key}"`)]).toEqual([route, key, false]);
      }
    });
  });

  describe("audit trail", () => {
    it("writes one entry per operator request with the final status, target and query names only", async () => {
      const before = new Date();
      await asOperator(`/api/v1/platform-admin/companies/${orgA.org.id}`);
      await asOperator(`/api/v1/platform-admin/users?q=${encodeURIComponent("secret search term")}`);
      await new Promise((r) => setTimeout(r, 300));
      const rows = await prisma.platformAuditEvent.findMany({ where: { actorUserId: operator.id, occurredAt: { gte: before } }, orderBy: { occurredAt: "asc" } });
      expect(rows.map((r) => [r.action, r.statusCode])).toEqual([
        ["platform.company.view", 200],
        ["platform.users.list", 200],
      ]);
      expect(rows[0]).toMatchObject({ targetType: "organisation", targetOrgId: orgA.org.id, actorRole: "platform_superadmin" });
      expect(rows[1].queryKeys).toEqual(["q"]);
      expect(JSON.stringify(rows)).not.toContain("secret search term");
    });
  });

  describe("usage and error events", () => {
    it("accepts catalogue screen-opens for the caller's own project only", async () => {
      const res = await api.post(
        "/api/v1/telemetry/events",
        { events: [{ name: "boq.opened", projectId: projectA.id }, { name: "boq.opened", projectId: projectB.id }, { name: "my private note" }, { name: "rfi.opened" }] },
        bearer(mintAccessToken(pmA)),
      );
      expect(res.status).toBe(202);
      expect(res.body.data).toEqual({ accepted: 2, dropped: 2 });
      expect((await api.post("/api/v1/telemetry/events", { events: [{ name: "boq.opened" }] })).status).toBe(401);
    });

    it("records server events from successful requests and error counts from failures, catalogue words only", async () => {
      await api.get("/api/v1/search?q=anything", bearer(mintAccessToken(pmA)));
      await api.get(`/api/v1/projects/${projectB.id}/rfi`, bearer(mintAccessToken(pmA))); // another company's project
      await new Promise((r) => setTimeout(r, 3500)); // one telemetry flush interval
      const events = await prisma.productEvent.findMany({ where: { orgId: orgA.org.id } });
      const names = events.map((e) => `${e.eventName}:${e.source}`).sort();
      expect(names).toEqual(expect.arrayContaining(["boq.opened:client", "rfi.opened:client", "search.executed:server"]));
      expect(events.find((e) => e.eventName === "boq.opened").projectId).toBe(projectA.id);
      expect(events.some((e) => e.projectId === projectB.id)).toBe(false);
      const errors = await prisma.platformErrorEvent.findMany({ where: { orgId: orgA.org.id } });
      expect(errors.length).toBeGreaterThan(0);
      for (const e of errors) {
        expect(e.routePattern).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
        expect(e.code).toMatch(/^[A-Z_]+$/);
      }
      expect(JSON.stringify([events, errors])).not.toContain("anything");
      // The gate's refusals happen before a route matches; they keep their route, not "(unmatched)".
      const refusals = await prisma.platformErrorEvent.findMany({
        where: { code: "PLATFORM_ACCESS_REQUIRED", occurredAt: { gte: STARTED_AT } },
        select: { routePattern: true, module: true },
      });
      expect(refusals.length).toBeGreaterThan(0);
      for (const r of refusals) expect(r).toEqual({ routePattern: expect.stringMatching(/^\/platform-admin\//), module: "platform-admin" });
    });
  });
});
