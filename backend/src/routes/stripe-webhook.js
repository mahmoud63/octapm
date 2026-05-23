const express = require('express');
const { getStripe } = require('../config/stripe');
const { prisma } = require('../config/db');

const router = express.Router();

router.post('/', async (req, res) => {
  const stripe = getStripe();
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, sig, process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const obj = event.data.object;

    if (event.type === 'invoice.paid') {
      const sub = await prisma.subscription.findFirst({
        where: { stripeCustomerId: obj.customer },
      });
      if (sub) {
        await prisma.invoice.create({
          data: {
            subscriptionId: sub.id,
            description: obj.lines?.data?.[0]?.description || 'Subscription payment',
            amount: (obj.amount_paid ?? 0) / 100,
            currency: (obj.currency ?? 'usd').toUpperCase(),
            status: 'paid',
            periodLabel: obj.lines?.data?.[0]?.period
              ? new Date(obj.lines.data[0].period.start * 1000).toISOString().slice(0, 7)
              : null,
            stripeInvoiceId: obj.id,
          },
        });
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            status: 'active',
            currentPeriodEnd: obj.lines?.data?.[0]?.period
              ? new Date(obj.lines.data[0].period.end * 1000)
              : sub.currentPeriodEnd,
          },
        });
      }
    }

    if (event.type === 'invoice.payment_failed') {
      const sub = await prisma.subscription.findFirst({
        where: { stripeCustomerId: obj.customer },
      });
      if (sub) {
        await prisma.invoice.create({
          data: {
            subscriptionId: sub.id,
            description: 'Failed subscription payment',
            amount: (obj.amount_due ?? 0) / 100,
            currency: (obj.currency ?? 'usd').toUpperCase(),
            status: 'failed',
            stripeInvoiceId: obj.id,
          },
        });
        await prisma.subscription.update({
          where: { id: sub.id }, data: { status: 'past_due' },
        });
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: obj.id },
      });
      if (sub) {
        await prisma.subscription.update({
          where: { id: sub.id }, data: { status: 'expired' },
        });
      }
    }
  } catch (err) {
    console.error('[stripe-webhook] handler error:', err);
    return res.status(500).send('handler error');
  }

  return res.json({ received: true });
});

module.exports = router;
