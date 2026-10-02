const request = require('supertest');
const Stripe = require('stripe');

const ORIGINAL_ENV = process.env;

const buildPayload = () => JSON.stringify({
  id: 'evt_test_webhook',
  type: 'invoice.created',
  data: { object: { id: 'in_test_webhook' } },
});

const buildSignature = (payload, secret = process.env.STRIPE_WEBHOOK_SECRET) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  return stripe.webhooks.generateTestHeaderString({ payload, secret });
};

describe('Stripe webhook route', () => {
  let app;
  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      STRIPE_SECRET_KEY: 'sk_test_webhookreadiness',
      STRIPE_WEBHOOK_SECRET: 'whsec_webhookreadiness',
    };
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    app = require('../../app').createApp();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('rejects unsigned events', async () => {
    const payload = buildPayload();

    const res = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(400);

    expect(res.text).toContain('Webhook Error');
  });

  it('rejects incorrectly signed events', async () => {
    const payload = buildPayload();

    const res = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', buildSignature(payload, 'whsec_wrong_secret'))
      .send(payload)
      .expect(400);

    expect(res.text).toContain('Webhook Error');
  });

  it('fails closed when the webhook signing secret is not configured', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const res = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(buildPayload())
      .expect(500);

    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'CONFIG_ERROR' },
    });
  });

  it('accepts valid signed test events', async () => {
    const payload = buildPayload();

    const res = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', buildSignature(payload))
      .send(payload)
      .expect(200);

    expect(res.body).toEqual({ received: true });
  });

  it('does not log Stripe secret configuration during signed webhook verification', async () => {
    const payload = buildPayload();

    await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', buildSignature(payload))
      .send(payload)
      .expect(200);

    // Each event's outcome is logged on one line (certification D2); no secret ever is.
    const logged = [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls].flat().map(String).join('\n');
    expect(logged).not.toContain(process.env.STRIPE_WEBHOOK_SECRET);
    expect(logged).not.toContain(process.env.STRIPE_SECRET_KEY);
    expect(logged).not.toMatch(/sk_(test|live)_|whsec_/);
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleLogSpy.mock.calls[0][0])).toMatch(/^\[stripe-webhook\] \{.*"outcome":"unhandled"/);
  });
});
