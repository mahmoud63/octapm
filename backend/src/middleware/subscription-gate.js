const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { PLANS } = require('../config/plans');
const { ensureSubscription, isExpired } = require('../services/subscription.service');

const subscriptionGate = async (req, res, next) => {
  try {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }
    if (!req.user) {
      return next(
        new HttpError(401, 'AUTH_REQUIRED', 'Authentication is required'),
      );
    }

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
    const plan = PLANS[sub.plan];
    // A plan we do not recognise is our data being wrong, not a customer who
    // has used their allowance (OCTA-BILL-PLAN-072). Falling back to `?? 0`
    // silently turned an unknown plan id into a limit of nought — and since
    // `count >= 0` is always true, that organisation could never create a
    // project again, while being told to upgrade. The demo and UAT
    // organisations were in exactly that state, on a plan called "standard"
    // that the catalogue has never contained.
    if (!plan) {
      return next(
        new HttpError(
          500,
          'SUBSCRIPTION_PLAN_UNKNOWN',
          `This organisation is on a plan called "${sub.plan}", which does not exist. That is a configuration fault on our side, not a limit you have reached.`,
        ),
      );
    }
    const limit = plan.projectLimit;
    if (limit !== Infinity) {
      const count = await prisma.project.count({ where: { orgId: req.user.orgId } });
      if (count >= limit) {
        return next(new HttpError(
          402, 'PROJECT_LIMIT_REACHED',
          `Your ${plan.name} plan allows ${limit} project(s). Upgrade to add more.`,
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
