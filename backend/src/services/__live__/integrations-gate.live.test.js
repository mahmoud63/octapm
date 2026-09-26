/**
 * The integrations router's public OAuth callback stays reachable without a
 * bearer while everything behind it stands behind the membership gate
 * (ENT-2 review: mounting the gate in app.js had put the callback behind it,
 * which answered every QuickBooks/Xero connect redirect with 401).
 *
 *   npm run test:live -- src/services/__live__/integrations-gate.live.test.js
 */
const crypto = require("crypto");
const { prisma } = require("../../config/db");
const { dropLiveOrg, liveDescribe } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");

const PASSWORD = "Live-Passw0rd!9a";
const MOBILE = { "x-octapm-client": "mobile" };
const bearer = (token) => ({ ...MOBILE, authorization: `Bearer ${token}` });

liveDescribe("integrations: the OAuth callback is public, the rest is gated", () => {
  let api;
  let org;

  beforeAll(async () => {
    api = await startApi();
    const id = crypto.randomUUID();
    const res = await api.post(
      "/api/v1/auth/register",
      { orgName: `LiveTest ${id}`, name: "Owner", email: `live-int-${id}@octapm-live.test`, password: PASSWORD },
      MOBILE,
    );
    if (res.status !== 201) throw new Error(`register: ${res.status} ${res.text}`);
    org = { orgId: res.body.data.user.orgId, token: res.body.data.tokens.accessToken };
    // A brand-new organisation is on a trial; this test is about the gate, not billing.
    await prisma.subscription.updateMany({
      where: { orgId: org.orgId },
      data: { plan: "business", status: "active", seats: 25, currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) },
    });
  }, 120_000);

  afterAll(async () => {
    await api?.stop();
    if (org) await dropLiveOrg(prisma, org.orgId);
    await prisma.$disconnect();
  });

  it("answers the accounting callback without a bearer: the handler judges the state, not the gate", async () => {
    for (const provider of ["xero", "qbo"]) {
      const res = await api.get(`/api/v1/integrations/accounting/${provider}/callback?state=not-a-real-state&code=x`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("ACCOUNTING_STATE_INVALID");
    }
  });

  it("keeps everything else behind the membership gate and company administration", async () => {
    const anonymous = await api.get("/api/v1/integrations/scopes");
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe("AUTH_REQUIRED");
    const owner = await api.get("/api/v1/integrations/scopes", bearer(org.token));
    expect(owner.status).toBe(200);

    const member = await api.post(
      "/api/v1/users",
      { name: "Member", email: `live-int-member-${crypto.randomUUID()}@octapm-live.test`, password: PASSWORD, role: "site_engineer" },
      bearer(org.token),
    );
    expect(member.status).toBe(201);
    const login = await api.post("/api/v1/auth/login", { email: member.body.data.email, password: PASSWORD }, MOBILE);
    expect(login.status).toBe(200);
    const plain = await api.get("/api/v1/integrations/scopes", bearer(login.body.data.tokens.accessToken));
    expect(plain.status).toBe(403);
  });
});
