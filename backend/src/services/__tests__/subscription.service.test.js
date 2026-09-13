/**
 * Subscribing is serialised per organisation and never duplicates a Stripe
 * subscription that is still running (Phase 21D, CX21-435).
 */
const calls = [];
const baseRow = { id: "sub-1", orgId: "org-1", plan: "individual", billingCycle: "monthly", status: "canceled", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_stripe_1", cancelAtPeriodEnd: true, currentPeriodEnd: new Date("2027-01-01T00:00:00.000Z"), aiGenerationsUsed: 0, seats: 1, trialEndsAt: null };
let row = { ...baseRow };
const mockPrisma = {
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
  $queryRaw: jest.fn(async (strings) => { calls.push(`raw:${Array.isArray(strings) ? strings.join("?") : String(strings)}`); return []; }),
  subscription: {
    findUnique: jest.fn(async () => { calls.push("read"); return { ...row }; }),
    create: jest.fn(async ({ data }) => ({ ...row, ...data })),
    update: jest.fn(async ({ data }) => { row = { ...row, ...data }; return { ...row }; }),
  },
  paymentMethod: { findFirst: jest.fn(async () => ({ id: "pm-1", stripePaymentMethodId: "pm_1", isDefault: true, brand: "visa", last4: "4242" })), deleteMany: jest.fn(), create: jest.fn() },
  organisation: { findUnique: jest.fn(async () => ({ id: "org-1", name: "Org" })) },
  user: { findFirst: jest.fn(async () => ({ email: "pm@example.test" })), findMany: jest.fn(async () => []) },
};
const mockStripe = {
  subscriptions: {
    retrieve: jest.fn(async () => ({ id: "sub_stripe_1", status: "active", cancel_at_period_end: true, items: { data: [{ id: "si_1" }] } })),
    update: jest.fn(async (id, data) => ({ id, current_period_end: 1800000000, ...data })),
    create: jest.fn(async () => ({ id: "sub_stripe_2", current_period_end: 1800000000 })),
  },
  paymentMethods: { attach: jest.fn(), retrieve: jest.fn() },
  customers: { update: jest.fn() },
};
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../../config/stripe", () => ({ getStripe: () => mockStripe }));
jest.mock("../../config/plans", () => ({
  PLANS: { trial: { name: "Trial", projectLimit: 1, aiLimit: 1 }, individual: { name: "Individual", projectLimit: 3, aiLimit: 10 }, business: { name: "Business", projectLimit: Infinity, aiLimit: Infinity } },
  planRank: (plan) => ({ trial: 0, individual: 1, business: 2 }[plan] ?? 0),
  getPrice: () => 10,
  getStripePriceId: () => "price_1",
  getVisiblePlanIds: () => ["individual", "business"],
}));
jest.mock("../email.service", () => ({ sendEmail: jest.fn(async () => ({})), templates: {} }));

const service = require("../subscription.service");

describe("Phase 21D — integrity (release challenge, third pass)", () => {
  beforeEach(() => { jest.clearAllMocks(); calls.length = 0; row = { ...baseRow }; });

  it("CX21-435: a subscribe while the Stripe subscription still runs changes it in place — no second subscription", async () => {
    await service.subscribe("org-1", "business", "monthly");
    expect(mockStripe.subscriptions.update).toHaveBeenCalledWith("sub_stripe_1", expect.objectContaining({ cancel_at_period_end: false, items: [{ id: "si_1", price: "price_1" }] }));
    expect(mockStripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mockPrisma.subscription.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "active", cancelAtPeriodEnd: false, plan: "business" }) }));
  });

  it("the decision is taken under a per-organisation lock, on a row read under it", async () => {
    await service.subscribe("org-1", "business", "monthly");
    const lockAt = calls.findIndex((c) => c.startsWith("raw:") && c.includes("pg_advisory_xact_lock"));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(calls.lastIndexOf("read")).toBeGreaterThan(lockAt);
  });

  it("a first subscription is created once, with an idempotency key", async () => {
    row = { ...baseRow, status: "incomplete", stripeSubscriptionId: null, cancelAtPeriodEnd: false };
    await service.subscribe("org-1", "individual", "monthly");
    expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(mockStripe.subscriptions.create).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_1" }), expect.objectContaining({ idempotencyKey: expect.stringContaining("subscribe:sub-1:individual:monthly") }));
  });
});

describe("Phase 21D — integrity (release challenge, fourth pass)", () => {
  beforeEach(() => { jest.clearAllMocks(); calls.length = 0; row = { ...baseRow }; });

  it("CX21-440: a lookup that fails is a failure — nothing is created and nothing is written", async () => {
    mockStripe.subscriptions.retrieve.mockRejectedValueOnce(Object.assign(new Error("connection reset"), { code: "api_connection_error" }));
    await expect(service.subscribe("org-1", "business", "monthly")).rejects.toThrow("connection reset");
    expect(mockStripe.subscriptions.create).not.toHaveBeenCalled();
    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
  });

  it("only \"no such subscription\" means there is none to change", async () => {
    mockStripe.subscriptions.retrieve.mockRejectedValueOnce(Object.assign(new Error("No such subscription"), { code: "resource_missing", statusCode: 404 }));
    await service.subscribe("org-1", "business", "monthly");
    expect(mockStripe.subscriptions.create).toHaveBeenCalledTimes(1);
    expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
  });
});
