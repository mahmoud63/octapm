const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { recognizedPlan, planConfigurationError } = require('../config/plans');
const { ensureSubscription, isExpired } = require('../services/subscription.service');

// An unknown plan is our data being wrong, and every gate says so the same
// way (docs/qa/OCTAPM_ISSUE_PLAN-CATALOGUE-UAT.md): 500
// SUBSCRIPTION_PLAN_UNKNOWN with the configuration sentence the billing
// screen shows, marked for the client so production does not replace it with
// "Unexpected server error".
function unknownPlanError(sub) {
  const fault = planConfigurationError(sub.plan);
  const error = new HttpError(500, fault.code, fault.message);
  error.expose = true;
  return error;
}

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
    const plan = recognizedPlan(sub.plan);
    // A plan we do not recognise is our data being wrong, not a customer who
    // has used their allowance (OCTA-BILL-PLAN-072). Falling back to `?? 0`
    // silently turned an unknown plan id into a limit of nought — and since
    // `count >= 0` is always true, that organisation could never create a
    // project again, while being told to upgrade. The demo and UAT
    // organisations were in exactly that state, on a plan called "standard"
    // that the catalogue has never contained.
    if (!plan) return next(unknownPlanError(sub));
    const limit = plan.projectLimit;
    if (limit !== Infinity) {
      // Archived projects do not spend the allowance. Deleting a project
      // archives it — the right thing for a construction record, which has to
      // survive the job it belonged to — and the project list hides archived
      // ones. Counting them here meant archiving never gave anything back: an
      // organisation could see three projects on screen, be told it had used
      // all twenty-five, and have no way to find the other twenty-two, because
      // nothing in the product shows them.
      const count = await prisma.project.count({
        where: { orgId: req.user.orgId, archivedAt: null },
      });
      if (count >= limit) {
        return next(new HttpError(
          402, 'PROJECT_LIMIT_REACHED',
          `Your ${plan.name} plan allows ${limit} project(s), and ${count} are live. Archiving a project frees its place; upgrade to raise the limit.`,
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
  const plan = recognizedPlan(sub.plan);
  // `?? 0` made an unknown plan a tier with no AI allowance ("Your plan allows
  // 0 AI generations … Upgrade") while the billing screen showed it trial's
  // three. It is the configuration fault the project gate answers with.
  if (!plan) throw unknownPlanError(sub);
  const limit = plan.aiLimit;
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
