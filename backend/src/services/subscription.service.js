const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { getStripe } = require('../config/stripe');
const {
  PLANS, planRank, getPrice, getStripePriceId, getVisiblePlanIds,
} = require('../config/plans');
const { sendEmail, templates } = require('./email.service');

const TRIAL_DAYS = 7;
const ACCESS_STATUSES = ['trialing', 'active', 'past_due', 'canceled'];

const addDays = (date, days) =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

async function ensureSubscription(orgId, tx = prisma) {
  const existing = await tx.subscription.findUnique({ where: { orgId } });
  if (existing) return existing;
  return tx.subscription.create({ data: { orgId, plan: 'trial', status: 'incomplete' } });
}

function isExpired(sub) {
  if (!sub) return true;
  if (!ACCESS_STATUSES.includes(sub.status)) return true;
  if (sub.status === 'trialing' && sub.trialEndsAt && new Date() > sub.trialEndsAt) {
    return true;
  }
  if (sub.status === 'canceled' && sub.currentPeriodEnd && new Date() > sub.currentPeriodEnd) {
    return true;
  }
  return false;
}

function serializeSubscription(sub, paymentMethod = null) {
  if (!sub) return null;
  const plan = PLANS[sub.plan] ?? PLANS.trial;
  return {
    id: sub.id,
    plan: sub.plan,
    planName: plan.name,
    billingCycle: sub.billingCycle,
    status: sub.status,
    hasAccess: !isExpired(sub),
    seats: sub.seats,
    projectLimit: plan.projectLimit === Infinity ? null : plan.projectLimit,
    aiLimit: plan.aiLimit === Infinity ? null : plan.aiLimit,
    aiGenerationsUsed: sub.aiGenerationsUsed,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    paymentMethod: paymentMethod
      ? { brand: paymentMethod.brand, last4: paymentMethod.last4,
          expMonth: paymentMethod.expMonth, expYear: paymentMethod.expYear }
      : null,
  };
}

async function getCurrentSubscription(orgId) {
  const sub = await ensureSubscription(orgId);
  const pm = await prisma.paymentMethod.findFirst({
    where: { subscriptionId: sub.id, isDefault: true },
  });
  return serializeSubscription(sub, pm);
}

async function getPlansForOrg(orgId) {
  const sub = await ensureSubscription(orgId);
  const currentPlan =
    sub.status === 'active' || sub.status === 'canceled' || sub.status === 'past_due'
      ? sub.plan
      : null;
  const visibleIds = getVisiblePlanIds(currentPlan);

  return {
    currentPlan,
    plans: visibleIds.map((id) => {
      const p = PLANS[id];
      return {
        id, name: p.name,
        projectLimit: p.projectLimit === Infinity ? null : p.projectLimit,
        aiLimit: p.aiLimit === Infinity ? null : p.aiLimit,
        seats: p.seats === Infinity ? null : p.seats,
        monthly: getPrice(id, 'monthly'),
        annual: getPrice(id, 'annual'),
        isCurrent: id === currentPlan,
        isEnterprise: id === 'enterprise',
      };
    }),
  };
}

module.exports = {
  TRIAL_DAYS, ACCESS_STATUSES, addDays,
  ensureSubscription, isExpired, serializeSubscription,
  getCurrentSubscription, getPlansForOrg,
};
