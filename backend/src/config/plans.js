// Fixed plan catalog. Limits drive feature gating; prices drive checkout display.
const PLANS = {
  trial: {
    id: 'trial', name: 'Trial', rank: 0,
    projectLimit: 1, aiLimit: 3, seats: 1,
    monthly: null, annual: null,
  },
  individual: {
    id: 'individual', name: 'Individual', rank: 1,
    projectLimit: 3, aiLimit: 10, seats: 1,
    monthly: 49, annual: 39,
  },
  business: {
    id: 'business', name: 'Business', rank: 2,
    projectLimit: 25, aiLimit: 150, seats: 10,
    monthly: 499, annual: 399,
  },
  enterprise: {
    id: 'enterprise', name: 'Enterprise', rank: 3,
    projectLimit: Infinity, aiLimit: Infinity, seats: Infinity,
    monthly: null, annual: null,
  },
};

const PAID_PLAN_ORDER = ['individual', 'business', 'enterprise'];

const STRIPE_PRICE_IDS = {
  individual: {
    monthly: process.env.STRIPE_PRICE_INDIVIDUAL_MONTHLY,
    annual: process.env.STRIPE_PRICE_INDIVIDUAL_ANNUAL,
  },
  business: {
    monthly: process.env.STRIPE_PRICE_BUSINESS_MONTHLY,
    annual: process.env.STRIPE_PRICE_BUSINESS_ANNUAL,
  },
};

function planRank(planId) {
  return PLANS[planId]?.rank ?? -1;
}

function getPrice(planId, cycle) {
  return PLANS[planId]?.[cycle] ?? null;
}

function getStripePriceId(planId, cycle) {
  return STRIPE_PRICE_IDS[planId]?.[cycle] ?? null;
}

function getVisiblePlanIds(currentPlanId) {
  if (!currentPlanId || currentPlanId === 'trial') {
    return [...PAID_PLAN_ORDER];
  }
  const idx = PAID_PLAN_ORDER.indexOf(currentPlanId);
  if (idx === -1) return [...PAID_PLAN_ORDER];
  return PAID_PLAN_ORDER.slice(idx, idx + 2);
}

module.exports = {
  PLANS, PAID_PLAN_ORDER, STRIPE_PRICE_IDS,
  planRank, getPrice, getStripePriceId, getVisiblePlanIds,
};
