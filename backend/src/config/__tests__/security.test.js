const request = require('supertest');
const { createApp } = require('../../app');
const {
  createSocketCorsOptions,
  validateProductionEnv,
} = require('../security');

const ORIGINAL_ENV = process.env;

const fakeStripeSecretKey = (mode) => `sk_${mode}_validproductionreadiness`;

const validProductionEnv = () => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@db.example.com:5432/pmcopilots',
  JWT_SECRET: 'access-secret-with-at-least-32-characters',
  JWT_REFRESH_SECRET: 'refresh-secret-with-at-least-32-characters',
  ANTHROPIC_API_KEY: 'sk-ant-production-placeholder-shape',
  STRIPE_SECRET_KEY: fakeStripeSecretKey('live'),
  STRIPE_WEBHOOK_SECRET: 'whsec_validproductionreadiness',
  STRIPE_PRICE_INDIVIDUAL_MONTHLY: 'price_individual_monthly',
  STRIPE_PRICE_INDIVIDUAL_ANNUAL: 'price_individual_annual',
  STRIPE_PRICE_BUSINESS_MONTHLY: 'price_business_monthly',
  STRIPE_PRICE_BUSINESS_ANNUAL: 'price_business_annual',
  STRIPE_SECRET_ROTATION_CONFIRMED_AT: '2026-06-10',
  STRIPE_SECRET_ROTATION_TICKET: 'SEC-1234',
  CLOUDFRONT_SHARED_SECRET: 'cloudfront-secret-with-32-plus-chars',
  CORS_ALLOWED_ORIGINS: 'https://app.example.com',
  FILE_STORAGE_S3_BUCKET: 'pmcopilots-uploads-prod',
});

describe('security configuration', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
    };
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete process.env.FRONTEND_URL;
    delete process.env.CLOUDFRONT_SHARED_SECRET;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('allows only configured Express CORS origins', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ALLOWED_ORIGINS = 'https://app.example.com';

    const app = createApp();

    const allowed = await request(app)
      .get('/api/health')
      .set('Origin', 'https://app.example.com')
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.com');

    const blocked = await request(app)
      .get('/api/health')
      .set('Origin', 'https://evil.example.com')
      .expect(200);
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('uses the same origin allowlist shape for Socket.IO', (done) => {
    const cors = createSocketCorsOptions({
      NODE_ENV: 'production',
      CORS_ALLOWED_ORIGINS: 'https://app.example.com',
    });

    cors.origin('https://app.example.com', (_error, allowed) => {
      expect(allowed).toBe(true);
      cors.origin('https://evil.example.com', (_blockedError, blocked) => {
        expect(blocked).toBe(false);
        done();
      });
    });
  });

  it('requires the CloudFront origin header for production API routes', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ALLOWED_ORIGINS = 'https://app.example.com';
    process.env.CLOUDFRONT_SHARED_SECRET = 'cloudfront-secret-with-32-plus-chars';

    const app = createApp();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await request(app).get('/api/health').expect(200);

      const blocked = await request(app).get('/api/v1/openapi.json').expect(403);
      expect(blocked.body).toMatchObject({
        success: false,
        error: { code: 'CLOUDFRONT_ORIGIN_REQUIRED' },
      });

      await request(app)
        .get('/api/v1/openapi.json')
        .set('X-CloudFront-Secret', process.env.CLOUDFRONT_SHARED_SECRET)
        .expect(200);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('passes production validation with distinct required secrets and approved origins', () => {
    expect(validateProductionEnv(validProductionEnv())).toEqual([]);
  });

  it('fails production validation when the Stripe webhook secret is missing', () => {
    const env = validProductionEnv();
    delete env.STRIPE_WEBHOOK_SECRET;

    expect(() => validateProductionEnv(env)).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it('fails production validation when Stripe rotation evidence is missing', () => {
    const env = validProductionEnv();
    delete env.STRIPE_SECRET_ROTATION_CONFIRMED_AT;

    expect(() => validateProductionEnv(env)).toThrow(/STRIPE_SECRET_ROTATION_CONFIRMED_AT/);
  });

  it('fails production validation when private upload storage is not configured', () => {
    const env = validProductionEnv();
    delete env.FILE_STORAGE_S3_BUCKET;

    expect(() => validateProductionEnv(env)).toThrow(/private production uploads/);
  });

  it('fails production validation for test-mode Stripe keys or placeholder webhook secrets', () => {
    expect(() => validateProductionEnv({
      ...validProductionEnv(),
      STRIPE_SECRET_KEY: fakeStripeSecretKey('test'),
    })).toThrow(/sk_live_/);

    expect(() => validateProductionEnv({
      ...validProductionEnv(),
      STRIPE_WEBHOOK_SECRET: 'whsec_...',
    })).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it('fails production validation when Stripe price ids are missing or malformed', () => {
    const missingPrice = validProductionEnv();
    delete missingPrice.STRIPE_PRICE_INDIVIDUAL_MONTHLY;
    expect(() => validateProductionEnv(missingPrice)).toThrow(/STRIPE_PRICE_INDIVIDUAL_MONTHLY/);

    expect(() => validateProductionEnv({
      ...validProductionEnv(),
      STRIPE_PRICE_BUSINESS_ANNUAL: 'plan_business_annual',
    })).toThrow(/STRIPE_PRICE_BUSINESS_ANNUAL/);
  });

  it('fails production validation for wildcard or development CORS origins', () => {
    expect(() => validateProductionEnv({
      ...validProductionEnv(),
      CORS_ALLOWED_ORIGINS: '*',
    })).toThrow(/wildcard/);

    expect(() => validateProductionEnv({
      ...validProductionEnv(),
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
    })).toThrow(/local development origin/);
  });

  it('fails production validation when unrelated secrets are reused', () => {
    const env = validProductionEnv();
    env.CLOUDFRONT_SHARED_SECRET = env.JWT_SECRET;

    expect(() => validateProductionEnv(env)).toThrow(/JWT_SECRET and CLOUDFRONT_SHARED_SECRET/);
  });
});
