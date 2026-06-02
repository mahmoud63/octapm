const Stripe = require('stripe');
const { HttpError } = require('../utils/http-error');

let stripeClient = null;

function getStripe() {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  console.log('Stripe Secret Key:', key ? '***' : 'NOT SET');
  if (!key) {
    throw new HttpError(500, 'CONFIG_ERROR', 'STRIPE_SECRET_KEY is not set');
  }
  stripeClient = new Stripe(key, { apiVersion: '2024-06-20' });
  return stripeClient;
}

module.exports = { getStripe };
