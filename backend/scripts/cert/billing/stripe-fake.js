'use strict';

/**
 * A local stand-in for the Stripe API, for the billing certification.
 *
 *   node scripts/cert/billing/stripe-fake.js [port]        (default 5390)
 *
 * No real provider is called and no card exists. It answers exactly the
 * calls the product makes (customers, setup intents, payment methods,
 * subscriptions) with the fields the product reads, keeps what it was asked
 * in memory, and can be told to misbehave:
 *
 *   payment method ids starting  pm_declined   → the charge is declined (402 card_error)
 *   payment method ids starting  pm_foreign    → attach is refused (belongs to another customer)
 *   POST /__set { "subscriptionStatus": { "<sub id>": "canceled" } }   what GET /v1/subscriptions/<id> says
 *   POST /__set { "failNext": { "path": "/v1/subscriptions", "status": 500 } }
 *        the next call whose path starts with "path" is answered with that failure (one slot, shared by everybody)
 *   POST /__set { "failNext": { "path": "/v1/subscriptions", "customer": "cus_…", "status": 400 } }
 *        the same, but only a call whose body names that customer consumes it: a creation of another
 *        customer's subscription passes by and leaves the failure armed
 *   POST /__set { "periodDays": 30 }
 *   GET  /__calls            every request received (method, path, idempotency key, parsed body); the call that
 *                            consumed a staged failure carries it as "staged": { status, code, message, customer }
 *   POST /__reset            forget everything
 *
 * It only listens on 127.0.0.1.
 */

const http = require('http');

const port = Number(process.argv[2] || process.env.STRIPE_FAKE_PORT || 5390);
let state;
const reset = () => {
  state = { calls: [], customers: new Map(), paymentMethods: new Map(), subscriptions: new Map(), subscriptionStatus: {}, failNext: null, periodDays: 30, counter: 0, idempotency: new Map() };
};
reset();

const next = (prefix) => {
  state.counter += 1;
  return `${prefix}_fake${String(state.counter).padStart(6, '0')}`;
};

/** Stripe's form encoding: a[b][0][c]=d → nested object. */
const parseForm = (raw) => {
  const out = {};
  for (const [key, value] of new URLSearchParams(raw)) {
    const parts = key.replace(/\]/g, '').split('[');
    let node = out;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) node[part] = value;
      else node = node[part] = node[part] || {};
    });
  }
  return out;
};

const card = (id) => ({ id, object: 'payment_method', card: { brand: id.includes('amex') ? 'amex' : 'visa', last4: id.includes('amex') ? '0005' : '4242', exp_month: 12, exp_year: 2030 } });
const error = (res, status, type, code, message) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { type, code, message } }));
};
const ok = (res, body) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const periodEnd = () => Math.floor(Date.now() / 1000) + state.periodDays * 86_400;

const handle = (req, res, raw) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const path = url.pathname;

  // ── control ──────────────────────────────────────────────────────────────
  if (path === '/__calls') return ok(res, { calls: state.calls });
  if (path === '/__reset') {
    reset();
    return ok(res, { reset: true });
  }
  if (path === '/__set') {
    const body = JSON.parse(raw || '{}');
    if (body.subscriptionStatus) Object.assign(state.subscriptionStatus, body.subscriptionStatus);
    if (body.failNext !== undefined) state.failNext = body.failNext;
    if (body.periodDays !== undefined) state.periodDays = Number(body.periodDays);
    return ok(res, { set: true });
  }
  if (path === '/__health') return ok(res, { fake: 'stripe', port });

  const body = parseForm(raw);
  const idempotencyKey = req.headers['idempotency-key'] || null;
  const call = { at: Date.now(), method: req.method, path, idempotencyKey, body };
  state.calls.push(call);

  // A staged failure names a path prefix and, optionally, the customer whose call it is for.
  const staged = state.failNext;
  if (staged && path.startsWith(staged.path) && (!staged.customer || body.customer === staged.customer)) {
    state.failNext = null;
    const status = staged.status || 500;
    const code = staged.code || 'fake_failure';
    const message = staged.message || 'The fake was told to fail this call';
    // Recorded on the call that consumed it, so a suite can prove whose call received its failure.
    call.staged = { status, code, message, customer: staged.customer || null };
    return error(res, status, staged.type || 'api_error', code, message);
  }

  // Stripe replays the stored answer for a repeated idempotency key with the same parameters,
  // and refuses the key with different parameters.
  if (idempotencyKey && req.method === 'POST') {
    const seen = state.idempotency.get(idempotencyKey);
    if (seen) {
      if (seen.raw !== raw) return error(res, 400, 'idempotency_error', 'idempotency_key_in_use', 'Keys for idempotent requests can only be used with the same parameters they were first used with.');
      res.writeHead(seen.status, { 'content-type': 'application/json', 'idempotent-replayed': 'true' });
      return res.end(seen.text);
    }
  }
  const remember = (status, payload) => {
    const text = JSON.stringify(payload);
    if (idempotencyKey) state.idempotency.set(idempotencyKey, { raw, status, text });
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(text);
  };

  let m;
  if (req.method === 'POST' && path === '/v1/customers') {
    const id = next('cus');
    state.customers.set(id, { id, name: body.name, metadata: body.metadata || {}, defaultPaymentMethod: null });
    return ok(res, { id, object: 'customer' });
  }
  if (req.method === 'POST' && (m = /^\/v1\/customers\/([^/]+)$/.exec(path))) {
    const customer = state.customers.get(m[1]) || { id: m[1] };
    customer.defaultPaymentMethod = body.invoice_settings?.default_payment_method || customer.defaultPaymentMethod;
    state.customers.set(m[1], customer);
    return ok(res, { id: m[1], object: 'customer' });
  }
  if (req.method === 'POST' && path === '/v1/setup_intents') {
    const id = next('seti');
    return ok(res, { id, object: 'setup_intent', client_secret: `${id}_secret_fake`, customer: body.customer });
  }
  if (req.method === 'POST' && (m = /^\/v1\/payment_methods\/([^/]+)\/attach$/.exec(path))) {
    if (m[1].startsWith('pm_foreign')) return error(res, 400, 'invalid_request_error', 'payment_method_unexpected_state', 'This PaymentMethod was previously used with another customer and cannot be attached.');
    state.paymentMethods.set(m[1], { id: m[1], customer: body.customer });
    return ok(res, { id: m[1], object: 'payment_method', customer: body.customer });
  }
  if (req.method === 'GET' && (m = /^\/v1\/payment_methods\/([^/]+)$/.exec(path))) return ok(res, card(m[1]));

  if (req.method === 'POST' && path === '/v1/subscriptions') {
    const method = body.default_payment_method || '';
    if (method.startsWith('pm_declined')) return remember(402, { error: { type: 'card_error', code: 'card_declined', decline_code: 'generic_decline', message: 'Your card was declined.' } });
    const id = next('sub');
    const subscription = { id, object: 'subscription', status: 'active', customer: body.customer, current_period_end: periodEnd(), cancel_at_period_end: false, items: { data: [{ id: next('si'), price: { id: body.items?.[0]?.price } }] }, default_payment_method: method };
    state.subscriptions.set(id, subscription);
    return remember(200, subscription);
  }
  if ((m = /^\/v1\/subscriptions\/([^/]+)$/.exec(path))) {
    const subscription = state.subscriptions.get(m[1]);
    const forced = state.subscriptionStatus[m[1]];
    if (forced === 'missing' || (!subscription && !forced)) return error(res, 404, 'invalid_request_error', 'resource_missing', `No such subscription: '${m[1]}'`);
    const current = subscription || { id: m[1], object: 'subscription', status: forced, current_period_end: periodEnd(), cancel_at_period_end: false, items: { data: [{ id: 'si_fake_forced' }] } };
    if (forced) current.status = forced;
    if (req.method === 'GET') return ok(res, current);
    if (req.method === 'POST') {
      if ((body.default_payment_method || '').startsWith('pm_declined')) return error(res, 402, 'card_error', 'card_declined', 'Your card was declined.');
      if (body.cancel_at_period_end !== undefined) current.cancel_at_period_end = body.cancel_at_period_end === 'true';
      if (body.items?.[0]?.price) current.items.data[0].price = { id: body.items[0].price };
      current.current_period_end = periodEnd();
      state.subscriptions.set(m[1], current);
      return ok(res, current);
    }
  }
  return error(res, 404, 'invalid_request_error', 'fake_unknown_route', `The Stripe fake has no route for ${req.method} ${path}`);
};

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        handle(req, res, Buffer.concat(chunks).toString('utf8'));
      } catch (failure) {
        error(res, 500, 'api_error', 'fake_crashed', String(failure.message || failure));
      }
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`stripe fake listening on 127.0.0.1:${port}`));
