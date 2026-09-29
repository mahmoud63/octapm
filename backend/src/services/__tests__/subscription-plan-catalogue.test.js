/**
 * The subscription plan catalogue, and an unknown plan as a configuration
 * fault everywhere (docs/qa/OCTAPM_ISSUE_PLAN-CATALOGUE-UAT.md, owner
 * decisions 1, 6 and 8).
 *
 * serializeSubscription used to show `PLANS[plan] ?? PLANS.trial`: an
 * organisation on a plan the catalogue does not contain was displayed as a
 * trial — one project, three AI generations — while the project gate refused
 * every project with SUBSCRIPTION_PLAN_UNKNOWN and assertAiQuota gave it an
 * allowance of nought ("Upgrade for more"). The display and the gates now say
 * the same thing: a configuration issue, no limits, contact your
 * administrator.
 */
const mockSub = { row: null };
jest.mock("../../config/db", () => ({
  prisma: {
    subscription: { findUnique: jest.fn(async () => mockSub.row), create: jest.fn() },
    paymentMethod: { findFirst: jest.fn(async () => null) },
  },
}));
jest.mock("../../config/stripe", () => ({ getStripe: () => ({}) }));
jest.mock("../email.service", () => ({ sendEmail: jest.fn(), templates: {} }));

const { PLANS, isRecognizedPlan, recognizedPlan, storedPlanIdentifier, planConfigurationError } = require("../../config/plans");
const { serializeSubscription, getCurrentSubscription } = require("../subscription.service");
const { assertAiQuota } = require("../../middleware/subscription-gate");
const { WORKSPACE_KINDS } = require("../organisation.service");

const row = (plan, extra = {}) => ({
  id: "sub-1", orgId: "org-1", plan, status: "active", billingCycle: null, seats: 1,
  aiGenerationsUsed: 0, trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, ...extra,
});

describe("the official Subscription.plan catalogue", () => {
  it("is exactly trial, individual, business and enterprise — never standard", () => {
    expect(Object.keys(PLANS).sort()).toEqual(["business", "enterprise", "individual", "trial"]);
    expect(isRecognizedPlan("standard")).toBe(false);
  });

  it("recognises only its own keys — not an inherited property, not a non-string", () => {
    for (const id of ["toString", "constructor", "__proto__", "hasOwnProperty", "", null, undefined, 3]) {
      expect(isRecognizedPlan(id)).toBe(false);
      expect(recognizedPlan(id)).toBeNull();
    }
    for (const id of ["trial", "individual", "business", "enterprise"]) expect(recognizedPlan(id)).toBe(PLANS[id]);
  });

  /**
   * Organisation.plan is a workspace label (ENT-6 planForKind: personal →
   * "individual", company → "standard"), deprecated for workspaceType
   * (M8/M9). The company label is not a subscription plan, so reading it as
   * one is the configuration fault — it can never pass as a tier.
   */
  it("the company workspace label on Organisation.plan is not a subscription plan", () => {
    expect(WORKSPACE_KINDS.COMPANY).toBe("company");
    const asIfSubscription = serializeSubscription(row("standard"));
    expect(asIfSubscription.recognized).toBe(false);
    expect(asIfSubscription.configurationError.code).toBe("SUBSCRIPTION_PLAN_UNKNOWN");
  });
});

describe("serializeSubscription", () => {
  it("a recognised plan carries its name and its limits", () => {
    const business = serializeSubscription(row("business"));
    expect(business).toMatchObject({
      plan: "business", recognized: true, planName: "Business",
      projectLimit: 25, aiLimit: 150, limits: { projectLimit: 25, aiLimit: 150 }, configurationError: null,
    });
    // Unlimited stays null, on both the flat fields and the limits object.
    expect(serializeSubscription(row("enterprise"))).toMatchObject({
      recognized: true, planName: "Enterprise", projectLimit: null, aiLimit: null, limits: { projectLimit: null, aiLimit: null },
    });
  });

  it("an unknown plan is a configuration fault — never displayed as a trial, never a limit of nought", () => {
    const sub = serializeSubscription(row("standard", { aiGenerationsUsed: 2 }));
    expect(sub).toMatchObject({
      plan: "standard",
      recognized: false,
      planName: null,
      limits: null,
      configurationError: { code: "SUBSCRIPTION_PLAN_UNKNOWN" },
      status: "active",
      hasAccess: true,
      aiGenerationsUsed: 2,
    });
    // The flat limits are left out: null there means "unlimited".
    expect(sub).not.toHaveProperty("projectLimit");
    expect(sub).not.toHaveProperty("aiLimit");
    expect(sub.planName).not.toBe(PLANS.trial.name);
    expect(sub.configurationError.message).toMatch(/^Subscription plan: configuration issue\./);
    expect(sub.configurationError.message).toContain('"standard"');
    expect(sub.configurationError.message).toMatch(/limits are unavailable/);
    expect(sub.configurationError.message).toMatch(/contact your administrator/);
    expect(sub.configurationError.message).not.toMatch(/upgrade|trial/i);
  });

  it("an unknown plan's identifier is echoed only when it is a plain token", () => {
    const odd = '<img src=x onerror="alert(1)">';
    const sub = serializeSubscription(row(odd));
    expect(sub.recognized).toBe(false);
    expect(sub.plan).toBeNull();
    expect(sub.configurationError.message).not.toContain("<img");
    expect(storedPlanIdentifier("legacy-gold")).toBe("legacy-gold");
    expect(storedPlanIdentifier("x".repeat(65))).toBeNull();
  });

  it("the read endpoint's service answers the same shape", async () => {
    mockSub.row = row("standard");
    const sub = await getCurrentSubscription("org-1");
    expect(sub).toMatchObject({ recognized: false, planName: null, limits: null, configurationError: planConfigurationError("standard") });
  });
});

describe("assertAiQuota", () => {
  const code = () => assertAiQuota("org-1").then(() => "ok", (error) => ({ status: error.status, code: error.code, expose: error.expose, message: error.message }));

  it("an unknown plan's AI quota is the configuration fault, not a tier with no allowance", async () => {
    mockSub.row = row("standard");
    const result = await code();
    expect(result).toMatchObject({ status: 500, code: "SUBSCRIPTION_PLAN_UNKNOWN", expose: true });
    expect(result.message).toBe(planConfigurationError("standard").message);
  });

  it("a recognised plan keeps its allowance", async () => {
    mockSub.row = row("business", { aiGenerationsUsed: 149 });
    expect(await code()).toBe("ok");
    mockSub.row = row("business", { aiGenerationsUsed: 150 });
    expect(await code()).toMatchObject({ status: 402, code: "AI_LIMIT_REACHED" });
  });
});
