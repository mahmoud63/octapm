const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { PLANS } = require('../config/plans');
const { ensureSubscription, isExpired } = require('../services/subscription.service');

const subscriptionGate = async (req, res, next) => {
  try {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }
    if (!req.user) return next();

    const sub = await ensureSubscription(req.user.orgId);
    if (isExpired(sub)) {
      return next(new HttpError(
        402, 'SUBSCRIPTION_REQUIRED',
        'Your trial or subscription has ended. Subscribe to continue.',
      ));
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

const enforceProjectLimit = async (req, res, next) => {
  try {
    const sub = await ensureSubscription(req.user.orgId);
    const limit = PLANS[sub.plan]?.projectLimit ?? 0;
    if (limit !== Infinity) {
      const count = await prisma.project.count({ where: { orgId: req.user.orgId } });
      if (count >= limit) {
        return next(new HttpError(
          402, 'PROJECT_LIMIT_REACHED',
          `Your ${PLANS[sub.plan]?.name ?? 'current'} plan allows ${limit} project(s). Upgrade to add more.`,
        ));
      }
    }
    return next();
  } catch (err) {
    return next(err);
  }
};

async function assertAiQuota(orgId) {
  const sub = await ensureSubscription(orgId);
  const limit = PLANS[sub.plan]?.aiLimit ?? 0;
  if (limit === Infinity) return;
  if (sub.aiGenerationsUsed >= limit) {
    throw new HttpError(
      402, 'AI_LIMIT_REACHED',
      `Your plan allows ${limit} AI generations per period. Upgrade for more.`,
    );
  }
}

async function incrementAiUsage(orgId) {
  await prisma.subscription.updateMany({
    where: { orgId },
    data: { aiGenerationsUsed: { increment: 1 } },
  });
}

module.exports = { subscriptionGate, enforceProjectLimit, assertAiQuota, incrementAiUsage };
