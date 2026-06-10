const Stripe = require('stripe');
const { HttpError } = require('../utils/http-error');

let stripeClient = null;
let stripeClientKey = null;

const STRIPE_SECRET_KEY_PATTERN = /^sk_(test|live)_[A-Za-z0-9]+$/;
const STRIPE_WEBHOOK_SECRET_PATTERN = /^whsec_[A-Za-z0-9]+$/;
const STRIPE_PRICE_ID_PATTERN = /^price_[A-Za-z0-9_]+$/;

const STRIPE_PRICE_ENV_KEYS = [
  'STRIPE_PRICE_INDIVIDUAL_MONTHLY',
  'STRIPE_PRICE_INDIVIDUAL_ANNUAL',
  'STRIPE_PRICE_BUSINESS_MONTHLY',
  'STRIPE_PRICE_BUSINESS_ANNUAL',
];

const STRIPE_PLACEHOLDER_VALUES = new Set([
  'CHANGE_ME',
  'your-key-here',
  'your-stripe-secret-key',
  'your-stripe-webhook-secret',
  'sk_test_...',
  'sk_live_...',
  'whsec_...',
  'price_...',
]);

const normalize = (value) => String(value || '').trim();

const isPlaceholderStripeValue = (value) => {
  const normalized = normalize(value);
  return !normalized || STRIPE_PLACEHOLDER_VALUES.has(normalized);
};

const getStripeSecretKeyMode = (value) => {
  const match = normalize(value).match(/^sk_(test|live)_/);
  return match?.[1] ?? null;
};

const collectStripeConfigProblems = (env = process.env, options = {}) => {
  const {
    requireSecretKey = true,
    requireWebhookSecret = false,
    requireLiveSecretKey = false,
    requirePriceIds = false,
    requireRotationEvidence = false,
  } = options;

  const problems = [];
  const secretKey = normalize(env.STRIPE_SECRET_KEY);

  if (requireSecretKey) {
    if (isPlaceholderStripeValue(secretKey)) {
      problems.push('STRIPE_SECRET_KEY must be set to a non-placeholder Stripe secret key');
    } else if (!STRIPE_SECRET_KEY_PATTERN.test(secretKey)) {
      problems.push('STRIPE_SECRET_KEY must look like a Stripe secret key');
    } else if (requireLiveSecretKey && getStripeSecretKeyMode(secretKey) !== 'live') {
      problems.push('STRIPE_SECRET_KEY must use an sk_live_ key for production payments');
    }
  }

  if (requireWebhookSecret) {
    const webhookSecret = normalize(env.STRIPE_WEBHOOK_SECRET);
    if (isPlaceholderStripeValue(webhookSecret)) {
      problems.push('STRIPE_WEBHOOK_SECRET must be set to a non-placeholder Stripe webhook signing secret');
    } else if (!STRIPE_WEBHOOK_SECRET_PATTERN.test(webhookSecret)) {
      problems.push('STRIPE_WEBHOOK_SECRET must look like a Stripe webhook signing secret');
    }
  }

  if (requirePriceIds) {
    for (const key of STRIPE_PRICE_ENV_KEYS) {
      const priceId = normalize(env[key]);
      if (isPlaceholderStripeValue(priceId)) {
        problems.push(`${key} must be set to a non-placeholder Stripe price id`);
      } else if (!STRIPE_PRICE_ID_PATTERN.test(priceId)) {
        problems.push(`${key} must look like a Stripe price id`);
      }
    }
  }

  if (requireRotationEvidence) {
    const confirmedAt = normalize(env.STRIPE_SECRET_ROTATION_CONFIRMED_AT);
    const ticket = normalize(env.STRIPE_SECRET_ROTATION_TICKET);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(confirmedAt)) {
      problems.push('STRIPE_SECRET_ROTATION_CONFIRMED_AT must be set to the YYYY-MM-DD rotation confirmation date');
    }
    if (isPlaceholderStripeValue(ticket) || ticket.length < 3) {
      problems.push('STRIPE_SECRET_ROTATION_TICKET must reference the approved non-secret rotation ticket');
    }
  }

  return problems;
};

const throwConfigError = (problems) => {
  throw new HttpError(500, 'CONFIG_ERROR', problems.join('; '));
};

const getStripeWebhookSecret = () => {
  const problems = collectStripeConfigProblems(process.env, {
    requireSecretKey: false,
    requireWebhookSecret: true,
  });
  if (problems.length > 0) {
    throwConfigError(problems);
  }
  return normalize(process.env.STRIPE_WEBHOOK_SECRET);
};

function getStripe() {
  const key = normalize(process.env.STRIPE_SECRET_KEY);
  if (stripeClient && stripeClientKey === key) return stripeClient;

  const problems = collectStripeConfigProblems(process.env, {
    requireSecretKey: true,
  });
  if (problems.length > 0) {
    throwConfigError(problems);
  }

  stripeClient = new Stripe(key, { apiVersion: '2024-06-20' });
  stripeClientKey = key;
  return stripeClient;
}

module.exports = {
  STRIPE_PRICE_ENV_KEYS,
  collectStripeConfigProblems,
  getStripe,
  getStripeSecretKeyMode,
  getStripeWebhookSecret,
};
