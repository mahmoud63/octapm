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

// The official Subscription.plan catalogue is exactly the four plans above
// (owner decision, docs/qa/OCTAPM_ISSUE_PLAN-CATALOGUE-UAT.md). Any other
// stored value — "standard" among them, which is a workspace label on
// Organisation.plan, never a subscription plan — is a configuration fault:
// it has no limits, it is never shown as a trial, and the gates refuse with
// SUBSCRIPTION_PLAN_UNKNOWN rather than invent a tier.
const PLAN_UNKNOWN_CODE = 'SUBSCRIPTION_PLAN_UNKNOWN';

// An own key only: PLANS.toString is a function, not a plan.
function isRecognizedPlan(planId) {
  return typeof planId === 'string' && Object.prototype.hasOwnProperty.call(PLANS, planId);
}

function recognizedPlan(planId) {
  return isRecognizedPlan(planId) ? PLANS[planId] : null;
}

// The stored identifier is shown back to the organisation's own members only
// when it is a plain token; anything else is withheld rather than echoed.
const SAFE_PLAN_IDENTIFIER = /^[A-Za-z0-9_.-]{1,64}$/;

function storedPlanIdentifier(planId) {
  return typeof planId === 'string' && SAFE_PLAN_IDENTIFIER.test(planId) ? planId : null;
}

/** The configuration fault an unknown plan is, as { code, message } — one sentence for every surface. */
function planConfigurationError(planId) {
  const stored = storedPlanIdentifier(planId);
  const named = stored ? `a plan called "${stored}"` : 'a plan';
  return {
    code: PLAN_UNKNOWN_CODE,
    message:
      `Subscription plan: configuration issue. This organisation's subscription names ${named}, which is not in the plan catalogue, so its limits are unavailable. ` +
      'This is a configuration fault on our side, not a limit you have reached — contact your administrator.',
  };
}

module.exports = {
  PLANS, PAID_PLAN_ORDER, STRIPE_PRICE_IDS, PLAN_UNKNOWN_CODE,
  planRank, getPrice, getStripePriceId, getVisiblePlanIds,
  isRecognizedPlan, recognizedPlan, storedPlanIdentifier, planConfigurationError,
};
