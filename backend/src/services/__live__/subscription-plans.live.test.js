/**
 * The subscription gates by plan, and the organisations restored after the
 * 2026-09-26 incident behaving as their restored plans say (docs/qa/
 * OCTAPM_INCIDENT_2026-09-26_MEMBERSHIP_ROLES.md).
 *
 *   npm run test:live -- src/services/__live__/subscription-plans.live.test.js
 *
 * Behaviour is proven on throwaway LiveTest organisations set to each plan,
 * through a real API process: a trial never started (trial / incomplete) reads
 * but cannot write; a running trial allows one project and three AI
 * generations; a plan outside the catalogue (standard — what the UAT seed
 * writes) passes the gate but cannot create a project (500
 * SUBSCRIPTION_PLAN_UNKNOWN) and has no AI allowance; business allows
 * projects and 150 generations.
 *
 * The restored durable organisations are only READ: their rows, the gate's
 * own decision functions, and GET /billing/subscription under their owner's
 * token. Nothing here writes to them. The personal-workspace seat rule is
 * ENT-6's and is proven by organisation-lifecycle.live.test.js.
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");
const { PLANS } = require("../../config/plans");
const { assertAiQuota } = require("../../middleware/subscription-gate");
const { isExpired } = require("../subscription.service");

const LIVE = /^LiveTest [0-9a-f-]{36}$/;
const THROWAWAY = /^LiveTest [0-9a-f-]{36}$|^Fixture Co/;
const DEMO = "OctaPM Demo Contracting";
const E2E = "OctaPM E2E";
const UAT = "PMcopilots UAT Fixtures";

liveDescribe("subscription gates by plan, and the restored organisations read as restored", () => {
  let api;
  const orgs = {};
  const bearer = (token) => ({ authorization: `Bearer ${token}` });

  /** One subscription, by its unique orgId, on an organisation proven to be a throwaway one. */
  const setPlan = async (live, data) => {
    const org = await prisma.organisation.findUnique({ where: { id: live.org.id }, select: { name: true } });
    expect(org?.name).toMatch(LIVE);
    return prisma.subscription.update({ where: { orgId: live.org.id }, data });
  };
  const createProject = (live, name) => api.post("/api/v1/projects", { name }, bearer(live.token));
  const projectCount = (live) => prisma.project.count({ where: { orgId: live.org.id } });
  const aiQuota = (orgId) => assertAiQuota(orgId).then(() => "ok", (error) => error.code);

  beforeAll(async () => {
    api = await startApi();
    for (const key of ["neverStarted", "trialing", "standard", "business"]) orgs[key] = await createLiveOrg(prisma);
    await setPlan(orgs.neverStarted, { plan: "trial", status: "incomplete", seats: 1, currentPeriodEnd: null });
    await setPlan(orgs.trialing, { plan: "trial", status: "trialing", trialStartsAt: new Date(), trialEndsAt: new Date(Date.now() + 7 * 86_400_000), seats: 1, currentPeriodEnd: null });
    await setPlan(orgs.standard, { plan: "standard", status: "active", seats: 1, currentPeriodEnd: null });
  }, 120_000);

  afterAll(async () => {
    await api?.stop();
    for (const live of Object.values(orgs)) await dropLiveOrg(prisma, live?.org?.id);
  });

  test("a trial never started (trial / incomplete) reads, and every write stops at the gate", async () => {
    expect((await api.get("/api/v1/projects", bearer(orgs.neverStarted.token))).status).toBe(200);
    const write = await createProject(orgs.neverStarted, "Refused");
    expect(write.status).toBe(402);
    expect(write.body.error.code).toBe("SUBSCRIPTION_REQUIRED");
    expect(await projectCount(orgs.neverStarted)).toBe(0);
    const billing = await api.get("/api/v1/billing/subscription", bearer(orgs.neverStarted.token));
    expect(billing.status).toBe(200);
    expect(billing.body.data).toMatchObject({ plan: "trial", status: "incomplete" });
  });

  test("a running trial allows one live project and three AI generations", async () => {
    expect((await createProject(orgs.trialing, "First")).status).toBe(201);
    const second = await createProject(orgs.trialing, "Second");
    expect(second.status).toBe(402);
    expect(second.body.error.code).toBe("PROJECT_LIMIT_REACHED");
    expect(await projectCount(orgs.trialing)).toBe(1);
    await setPlan(orgs.trialing, { aiGenerationsUsed: PLANS.trial.aiLimit - 1 });
    expect(await aiQuota(orgs.trialing.org.id)).toBe("ok");
    await setPlan(orgs.trialing, { aiGenerationsUsed: PLANS.trial.aiLimit });
    expect(await aiQuota(orgs.trialing.org.id)).toBe("AI_LIMIT_REACHED");
  });

  test("a plan outside the catalogue (standard) passes the gate but cannot create a project, and has no AI allowance", async () => {
    expect(PLANS.standard).toBeUndefined();
    const write = await createProject(orgs.standard, "Unknown plan");
    expect(write.status).toBe(500);
    expect(write.body.error.code).toBe("SUBSCRIPTION_PLAN_UNKNOWN");
    expect(await projectCount(orgs.standard)).toBe(0);
    expect(await aiQuota(orgs.standard.org.id)).toBe("AI_LIMIT_REACHED");
  });

  test("business allows projects and 150 AI generations", async () => {
    expect((await createProject(orgs.business, "Business project")).status).toBe(201);
    await setPlan(orgs.business, { aiGenerationsUsed: PLANS.business.aiLimit - 1 });
    expect(await aiQuota(orgs.business.org.id)).toBe("ok");
    await setPlan(orgs.business, { aiGenerationsUsed: PLANS.business.aiLimit });
    expect(await aiQuota(orgs.business.org.id)).toBe("AI_LIMIT_REACHED");
  });

  test("the restored organisations read as restored — rows, gate decisions and the billing API (read only)", async () => {
    const durable = (await prisma.organisation.findMany({ select: { id: true, name: true } })).filter((org) => !THROWAWAY.test(org.name));
    const expectations = durable.map((org) => {
      if (org.name === DEMO || org.name === E2E) return { org, plan: "business", status: "active", writes: true, projectLimit: 25 };
      if (org.name === UAT) return { org, plan: "standard", status: "active", writes: true, projectLimit: undefined };
      return { org, plan: "trial", status: "incomplete", writes: false, projectLimit: 1 };
    });
    expect(expectations.filter((e) => e.plan === "trial")).toHaveLength(21);

    for (const e of expectations) {
      const sub = await prisma.subscription.findUnique({ where: { orgId: e.org.id } });
      expect({ org: e.org.name, plan: sub.plan, status: sub.status, seats: sub.seats, currentPeriodEnd: sub.currentPeriodEnd }).toEqual({
        org: e.org.name, plan: e.plan, status: e.status, seats: 1, currentPeriodEnd: null,
      });
      // The gate's own decision: an expired subscription refuses every write.
      expect({ org: e.org.name, writes: !isExpired(sub) }).toEqual({ org: e.org.name, writes: e.writes });
      expect(PLANS[sub.plan]?.projectLimit).toBe(e.projectLimit);
    }

    // Through the API, under each organisation owner's own token — a GET, which the gate never stops.
    for (const name of [DEMO, E2E, UAT, "Probe Corp"]) {
      const e = expectations.find((x) => x.org.name === name);
      const owner = await prisma.organizationMembership.findFirst({ where: { orgId: e.org.id, isOwner: true, status: "active" }, include: { user: true } });
      const billing = await api.get("/api/v1/billing/subscription", bearer(mintAccessToken(owner.user)));
      expect({ org: name, status: billing.status, plan: billing.body?.data?.plan, subscription: billing.body?.data?.status }).toEqual({
        org: name, status: 200, plan: e.plan, subscription: e.status,
      });
    }
  });
});
