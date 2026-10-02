const express = require('express');
const { getStripe, getStripeWebhookSecret } = require('../config/stripe');
const { asyncHandler } = require('../utils/async-handler');
const stripeWebhookService = require('../services/stripe-webhook.service');

const router = express.Router();

/**
 * Stripe's events. The signature is checked here; what an event may change,
 * and for which company, is decided in services/stripe-webhook.service.js.
 * An event that names no company, names an unknown one, or contradicts itself
 * changes nothing and is still acknowledged, so the provider does not retry
 * it for days.
 */
router.post('/', asyncHandler(async (req, res) => {
  const webhookSecret = getStripeWebhookSecret();
  const stripe = getStripe();
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, sig, webhookSecret,
    );
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await stripeWebhookService.handleEvent(event);
  } catch (err) {
    console.error('[stripe-webhook] handler error:', err);
    return res.status(500).send('handler error');
  }

  return res.json({ received: true });
}));

module.exports = router;
