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

async function startTrialSetup(orgId) {
  const sub = await ensureSubscription(orgId);
  if (sub.status !== 'incomplete' && sub.status !== 'expired') {
    throw new HttpError(409, 'TRIAL_NOT_AVAILABLE', 'Trial is not available for this account');
  }

  const stripe = getStripe();
  let customerId = sub.stripeCustomerId;
  if (!customerId) {
    const org = await prisma.organisation.findUnique({ where: { id: orgId } });
    const customer = await stripe.customers.create({
      name: org?.name ?? 'PM Copilots org',
      metadata: { orgId },
    });
    customerId = customer.id;
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ['card'],
    usage: 'off_session',
  });

  return { clientSecret: setupIntent.client_secret };
}

async function confirmTrial(orgId, stripePaymentMethodId) {
  const sub = await ensureSubscription(orgId);
  if (sub.status !== 'incomplete' && sub.status !== 'expired') {
    throw new HttpError(409, 'TRIAL_NOT_AVAILABLE', 'Trial already started');
  }
  if (!stripePaymentMethodId) {
    throw new HttpError(400, 'PAYMENT_METHOD_REQUIRED', 'A payment method is required');
  }

  const stripe = getStripe();
  await stripe.paymentMethods.attach(stripePaymentMethodId, {
    customer: sub.stripeCustomerId,
  });
  const pm = await stripe.paymentMethods.retrieve(stripePaymentMethodId);
  await stripe.customers.update(sub.stripeCustomerId, {
    invoice_settings: { default_payment_method: stripePaymentMethodId },
  });

  const now = new Date();
  const trialEndsAt = addDays(now, TRIAL_DAYS);

  await prisma.$transaction(async (tx) => {
    await tx.paymentMethod.deleteMany({ where: { subscriptionId: sub.id } });
    await tx.paymentMethod.create({
      data: {
        subscriptionId: sub.id,
        stripePaymentMethodId,
        brand: pm.card?.brand ?? null,
        last4: pm.card?.last4 ?? null,
        expMonth: pm.card?.exp_month ?? null,
        expYear: pm.card?.exp_year ?? null,
        isDefault: true,
      },
    });
    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        plan: 'trial',
        status: 'trialing',
        trialStartsAt: now,
        trialEndsAt,
        periodResetAt: trialEndsAt,
        aiGenerationsUsed: 0,
        reminderDay5SentAt: null,
        reminderDay7SentAt: null,
      },
    });
  });

  return getCurrentSubscription(orgId);
}

async function orgEmail(orgId) {
  const user = await prisma.user.findFirst({
    where: { orgId, role: 'pm' },
    orderBy: { createdAt: 'asc' },
  });
  return user?.email ?? 'unknown@pmcopilots.local';
}

async function subscribe(orgId, planId, billingCycle, paymentMethodId = null) {
  if (planId === 'enterprise') {
    throw new HttpError(400, 'ENTERPRISE_VIA_SALES', 'Enterprise plans are arranged via sales');
  }
  if (!PLANS[planId] || planId === 'trial') {
    throw new HttpError(400, 'INVALID_PLAN', 'Unknown plan');
  }
  if (!['monthly', 'annual'].includes(billingCycle)) {
    throw new HttpError(400, 'INVALID_CYCLE', 'billingCycle must be monthly or annual');
  }

  const sub = await ensureSubscription(orgId);

  if (paymentMethodId) {
    const stripe = getStripe();
    try {
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: sub.stripeCustomerId,
      });
    } catch (err) {
      // Ignore if already attached
    }
    const stripePm = await stripe.paymentMethods.retrieve(paymentMethodId);
    await stripe.customers.update(sub.stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    await prisma.$transaction(async (tx) => {
      await tx.paymentMethod.deleteMany({ where: { subscriptionId: sub.id } });
      await tx.paymentMethod.create({
        data: {
          subscriptionId: sub.id,
          stripePaymentMethodId: paymentMethodId,
          brand: stripePm.card?.brand ?? null,
          last4: stripePm.card?.last4 ?? null,
          expMonth: stripePm.card?.exp_month ?? null,
          expYear: stripePm.card?.exp_year ?? null,
          isDefault: true,
        },
      });
    });
  }

  // One subscribe per organisation at a time, decided on a row read under the
  // lock: two concurrent requests used to both read "no active subscription"
  // and each create a Stripe subscription, the second hiding the first; and a
  // subscribe after a cancel-at-period-end used to create a second billable
  // subscription while the first ran to its period end (Phase 21D, CX21-435).
  await prisma.$transaction(async (tx) => {
    // $executeRaw, not $queryRaw: the lock function returns void, which
    // $queryRaw cannot deserialize.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`subscription:${orgId}`}))`;
    const held = await ensureSubscription(orgId, tx);
    const pm = await tx.paymentMethod.findFirst({
      where: { subscriptionId: held.id, isDefault: true },
    });
    if (!held.stripeCustomerId || !pm) {
      throw new HttpError(400, 'PAYMENT_METHOD_REQUIRED', 'No payment method on file');
    }

    if (planRank(planId) < planRank(held.plan) && held.status === 'active') {
      throw new HttpError(400, 'DOWNGRADE_NOT_ALLOWED', 'Downgrades are not supported');
    }

    const priceId = getStripePriceId(planId, billingCycle);
    if (!priceId) {
      throw new HttpError(500, 'CONFIG_ERROR', `Missing Stripe price for ${planId}/${billingCycle}`);
    }

    const stripe = getStripe();
    // A Stripe subscription that is still running — active, past due, or
    // cancelled at period end and not yet ended — is changed in place.
    // A lookup that fails is a failure, not "no subscription": swallowing it
    // let a transient Stripe error create a second billable subscription
    // (Phase 21D, CX21-440). Only "no such subscription" means none.
    const running = held.stripeSubscriptionId
      ? await stripe.subscriptions.retrieve(held.stripeSubscriptionId).catch((error) => {
          if (error?.code === 'resource_missing' || error?.statusCode === 404) return null;
          throw error;
        })
      : null;
    const reusable = Boolean(running && !['canceled', 'incomplete_expired'].includes(running.status));
    let stripeSub;
    if (reusable) {
      stripeSub = await stripe.subscriptions.update(held.stripeSubscriptionId, {
        items: [{ id: running.items.data[0].id, price: priceId }],
        cancel_at_period_end: false,
        proration_behavior: 'always_invoice',
        default_payment_method: pm.stripePaymentMethodId,
      });
    } else {
      stripeSub = await stripe.subscriptions.create({
        customer: held.stripeCustomerId,
        items: [{ price: priceId }],
        default_payment_method: pm.stripePaymentMethodId,
        payment_behavior: 'error_if_incomplete',
        expand: ['latest_invoice'],
      }, {
        // The same attempt replayed (a retry after a failed write here) gets
        // the same subscription back from Stripe, not a second one.
        idempotencyKey: `subscribe:${held.id}:${planId}:${billingCycle}:${held.stripeSubscriptionId || 'first'}`,
      });
    }

    await tx.subscription.update({
      where: { id: held.id },
      data: {
        plan: planId,
        billingCycle,
        status: 'active',
        stripeSubscriptionId: stripeSub.id,
        currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        aiGenerationsUsed: 0,
        periodResetAt: new Date(stripeSub.current_period_end * 1000),
      },
    });
  }, { maxWait: 5000, timeout: 30000 });

  return getCurrentSubscription(orgId);
}

async function cancelSubscription(orgId) {
  const sub = await ensureSubscription(orgId);
  if (sub.status !== 'active' || !sub.stripeSubscriptionId) {
    throw new HttpError(400, 'NO_ACTIVE_SUBSCRIPTION', 'No active subscription to cancel');
  }

  const stripe = getStripe();
  await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  const updated = await prisma.subscription.update({
    where: { id: sub.id },
    data: { status: 'canceled', cancelAtPeriodEnd: true, canceledAt: new Date() },
  });

  const org = await prisma.organisation.findUnique({ where: { id: orgId } });
  const planName = PLANS[updated.plan]?.name ?? updated.plan;
  const endDate = updated.currentPeriodEnd
    ? updated.currentPeriodEnd.toISOString().slice(0, 10)
    : 'the end of the billing period';
  const tpl = templates.subscriptionCanceled(org?.name ?? 'there', planName, endDate);
  await sendEmail({ to: await orgEmail(orgId), ...tpl });

  return getCurrentSubscription(orgId);
}

async function listInvoices(orgId) {
  const sub = await ensureSubscription(orgId);
  const invoices = await prisma.invoice.findMany({
    where: { subscriptionId: sub.id },
    orderBy: { createdAt: 'desc' },
  });
  return invoices.map((i) => ({
    id: i.id,
    date: i.createdAt,
    description: i.description,
    amount: i.amount,
    currency: i.currency,
    status: i.status,
  }));
}

async function createEnterpriseLead(orgId, seatsBand) {
  if (!['lte_100', 'gt_100'].includes(seatsBand)) {
    throw new HttpError(400, 'INVALID_SEATS_BAND', 'seatsBand must be lte_100 or gt_100');
  }
  const lead = await prisma.enterpriseLead.create({ data: { orgId, seatsBand } });
  return { id: lead.id, seatsBand: lead.seatsBand, status: lead.status };
}

module.exports = {
  TRIAL_DAYS, ACCESS_STATUSES, addDays,
  ensureSubscription, isExpired, serializeSubscription,
  getCurrentSubscription, getPlansForOrg,
  startTrialSetup, confirmTrial,
  subscribe, cancelSubscription, listInvoices, createEnterpriseLead,
};
