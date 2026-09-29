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
 * used to write) is a configuration fault everywhere (docs/qa/
 * OCTAPM_ISSUE_PLAN-CATALOGUE-UAT.md): it passes the subscription gate, but
 * project creation and the AI quota answer 500 SUBSCRIPTION_PLAN_UNKNOWN and
 * GET /billing/subscription reads it as recognized: false, no plan name, no
 * limits and the same configuration error — never as a trial; business
 * allows projects and 150 generations, and says so on the billing read.
 *
 * The restored durable organisations are only READ: their rows, the gate's
 * own decision functions, GET /billing/subscription under their owner's
 * token and, for UAT (a normal paying company since the canonical reseed:
 * business / active), a POST /projects without a name — the project limit
 * runs before the validator, so the answer says whether the limit let it
 * through while nothing is written. The personal-workspace seat rule is
 * ENT-6's and is proven by organisation-lifecycle.live.test.js.
 */
const { prisma } = require("../../config/db");
const { createLiveOrg, dropLiveOrg, liveDescribe, mintAccessToken } = require("../../__live__/helpers");
const { startApi } = require("./auth-live-kit");
const { PLANS, planConfigurationError } = require("../../config/plans");
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
  const aiRefusal = (orgId) => assertAiQuota(orgId).then(() => null, (error) => ({ status: error.status, code: error.code, message: error.message }));
  const billing = async (token) => {
    const response = await api.get("/api/v1/billing/subscription", bearer(token));
    expect(response.status).toBe(200);
    return response.body.data;
  };

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

  test("a plan outside the catalogue (standard) is a configuration fault: the gates refuse with it and the billing read shows it — never a trial", async () => {
    expect(PLANS.standard).toBeUndefined();
    const fault = planConfigurationError("standard");

    // The display: recognized false, no name, no limits, the configuration error.
    const shown = await billing(orgs.standard.token);
    expect(shown).toMatchObject({
      plan: "standard", recognized: false, planName: null, limits: null,
      configurationError: fault, status: "active", hasAccess: true,
    });
    expect(shown).not.toHaveProperty("projectLimit");
    expect(shown).not.toHaveProperty("aiLimit");
    expect(JSON.stringify(shown)).not.toMatch(/"Trial"/);

    // The gates: the same code and the same sentence the screen shows.
    const write = await createProject(orgs.standard, "Unknown plan");
    expect(write.status).toBe(500);
    expect(write.body.error).toMatchObject({ code: "SUBSCRIPTION_PLAN_UNKNOWN", message: shown.configurationError.message });
    expect(await projectCount(orgs.standard)).toBe(0);
    expect(await aiRefusal(orgs.standard.org.id)).toEqual({ status: 500, code: "SUBSCRIPTION_PLAN_UNKNOWN", message: fault.message });
    // …at any usage: an unknown plan's AI quota is not a tier that runs out.
    await setPlan(orgs.standard, { aiGenerationsUsed: 0 });
    expect(await aiQuota(orgs.standard.org.id)).toBe("SUBSCRIPTION_PLAN_UNKNOWN");
  });

  test("business allows projects and 150 AI generations, and the billing read says Business with those limits", async () => {
    const shown = await billing(orgs.business.token);
    expect(shown).toMatchObject({
      plan: "business", recognized: true, planName: "Business", configurationError: null,
      projectLimit: PLANS.business.projectLimit, aiLimit: PLANS.business.aiLimit,
      limits: { projectLimit: PLANS.business.projectLimit, aiLimit: PLANS.business.aiLimit },
    });
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
      if (org.name === UAT) return { org, plan: "business", status: "active", writes: true, projectLimit: 25 };
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
      // The display and the gate's limit agree, for every organisation read here.
      expect({ org: name, recognized: billing.body.data.recognized, projectLimit: billing.body.data.limits?.projectLimit }).toEqual({
        org: name, recognized: true, projectLimit: e.projectLimit,
      });
    }
  });

  test("UAT is a normal paying company through the product: Business on the billing read, the business AI allowance, and the project limit lets it create (read only)", async () => {
    const uat = await prisma.organisation.findFirst({ where: { name: UAT }, select: { id: true } });
    expect(uat).not.toBeNull();
    const sub = await prisma.subscription.findUnique({ where: { orgId: uat.id } });
    expect({ plan: sub.plan, status: sub.status }).toEqual({ plan: "business", status: "active" });
    const owner = await prisma.organizationMembership.findFirst({ where: { orgId: uat.id, isOwner: true, status: "active" }, include: { user: true } });
    const token = mintAccessToken(owner.user);

    const shown = await billing(token);
    expect(shown).toMatchObject({
      plan: "business", recognized: true, planName: "Business", hasAccess: true, configurationError: null,
      limits: { projectLimit: PLANS.business.projectLimit, aiLimit: PLANS.business.aiLimit },
    });
    // The AI quota is the business allowance the screen shows: the gate lets
    // UAT through at its current usage, which is below that allowance.
    expect(sub.aiGenerationsUsed).toBeLessThan(shown.limits.aiLimit);
    expect(await aiQuota(uat.id)).toBe("ok");

    // Project creation: the subscription gate and the project limit run before
    // the validator, so a nameless create answers 400 from the validator —
    // past both gates — and writes nothing.
    const before = await prisma.project.count({ where: { orgId: uat.id } });
    const live = await prisma.project.count({ where: { orgId: uat.id, archivedAt: null } });
    expect(live).toBeLessThan(shown.limits.projectLimit);
    const probe = await api.post("/api/v1/projects", {}, bearer(token));
    expect({ status: probe.status, code: probe.body?.error?.code }).toEqual({ status: 400, code: "VALIDATION_ERROR" });
    expect(await prisma.project.count({ where: { orgId: uat.id } })).toBe(before);
  });
});
