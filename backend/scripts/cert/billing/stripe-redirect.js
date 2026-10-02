'use strict';

/**
 * Preloaded into a certification API process (node -r) so that the Stripe
 * SDK's calls go to the local Stripe fake instead of api.stripe.com:
 *
 *   CERT_STRIPE_FAKE_PORT=5390 node -r ./scripts/cert/billing/stripe-redirect.js src/index.js
 *
 * Without CERT_STRIPE_FAKE_PORT it does nothing. With it, a request addressed
 * to api.stripe.com is sent over plain HTTP to 127.0.0.1:<port>; every other
 * request is untouched. It also refuses to load unless the process is using
 * the certification database, so it can never sit in front of a real key.
 *
 * (The product has no host override of its own; the same hook exists for the
 * product's live tests in src/services/__live__/shared-state-node.js.)
 */

const http = require('http');
const https = require('https');

const port = Number(process.env.CERT_STRIPE_FAKE_PORT || 0);
if (port) {
  require('dotenv').config();
  const database = (() => {
    try {
      return decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ''));
    } catch {
      return null;
    }
  })();
  if (database !== 'octapm_cert') {
    throw new Error(`stripe-redirect: refused — the process database is "${database}", not the certification database.`);
  }
  if (/^sk_live_/.test(process.env.STRIPE_SECRET_KEY || '')) {
    throw new Error('stripe-redirect: refused — a live Stripe key is configured.');
  }
  const originalRequest = https.request;
  https.request = function request(options, callback) {
    if (options && typeof options === 'object' && !(options instanceof URL)) {
      const host = options.hostname || options.host;
      if (host === 'api.stripe.com') {
        const plain = { ...options, host: '127.0.0.1', hostname: '127.0.0.1', port };
        delete plain.agent;
        const req = http.request(plain, callback);
        // The SDK writes its body on the TLS 'secureConnect' event; a plain socket only says 'connect'.
        req.on('socket', (socket) => socket.once('connect', () => socket.emit('secureConnect')));
        return req;
      }
    }
    return originalRequest.apply(this, arguments);
  };
  console.log(`[stripe-redirect] api.stripe.com -> 127.0.0.1:${port} (certification only)`);
}
