const request = require('supertest');
const { createApp } = require('../../app');
const {
  createSocketCorsOptions,
  validateProductionEnv,
} = require('../security');

const ORIGINAL_ENV = process.env;

const fakeStripeSecretKey = (mode) => `sk_${mode}_validproductionreadiness`;

// Any file that exists stands in for the RDS CA bundle: the check is that the
// path is absolute and present, not what is inside it.
const CA_BUNDLE = __filename;

// The whole production contract (backend/.env.example, "Running on AWS"):
// an ALB-only API on ECS with RDS over TLS, S3 and SES through the task role.
const validProductionEnv = () => ({
  NODE_ENV: 'production',
  APP_ENV: 'production',
  RELEASE_GIT_SHA: '0123456789abcdef0123456789abcdef01234567',
  DATABASE_URL: `postgresql://user:password@db.example.com:5432/pmcopilots?sslmode=require&sslcert=${encodeURIComponent(CA_BUNDLE)}&sslaccept=strict`,
  DATABASE_CONNECTION_LIMIT: '10',
  JWT_SECRET: 'access-secret-with-at-least-32-characters',
  JWT_REFRESH_SECRET: 'refresh-secret-with-at-least-32-characters',
  MFA_SECRET_KEY: 'mfa-key-with-at-least-thirty-two-characters',
  INTEGRATION_SECRET_KEY: 'integration-key-with-at-least-32-characters',
  ANTHROPIC_API_KEY: 'sk-ant-production-placeholder-shape',
  STRIPE_SECRET_KEY: fakeStripeSecretKey('live'),
  STRIPE_WEBHOOK_SECRET: 'whsec_validproductionreadiness',
  STRIPE_PRICE_INDIVIDUAL_MONTHLY: 'price_individual_monthly',
  STRIPE_PRICE_INDIVIDUAL_ANNUAL: 'price_individual_annual',
  STRIPE_PRICE_BUSINESS_MONTHLY: 'price_business_monthly',
  STRIPE_PRICE_BUSINESS_ANNUAL: 'price_business_annual',
  STRIPE_SECRET_ROTATION_CONFIRMED_AT: '2026-06-10',
  STRIPE_SECRET_ROTATION_TICKET: 'SEC-1234',
  TRUST_PROXY_HOPS: '1',
  CORS_ALLOWED_ORIGINS: 'https://app.example.com',
  WEB_APP_URL: 'https://app.example.com',
  API_BASE_URL: 'https://api.example.com',
  EMAIL_PROVIDER: 'ses',
  EMAIL_FROM: 'OctaPM <no-reply@example.com>',
  SES_REGION: 'us-east-2',
  FILE_STORAGE_S3_BUCKET: 'pmcopilots-uploads-prod',
  FILE_STORAGE_S3_REGION: 'us-east-2',
});

const CLOUDFRONT_SECRET = 'cloudfront-secret-with-32-plus-chars';

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

    // C0-3: a stand-in word has the shape of a signing secret and must still be refused.
    for (const word of ['placeholder', 'PlaceHolder', 'example', 'changeme', 'change_me', 'dummy', 'replaceme', 'xxxx']) {
      expect(() => validateProductionEnv({
        ...validProductionEnv(),
        STRIPE_WEBHOOK_SECRET: ['whsec', word].join('_'),
      })).toThrow(/STRIPE_WEBHOOK_SECRET must be set to a non-placeholder/);
    }
    expect(() => validateProductionEnv({
      ...validProductionEnv(),
      STRIPE_SECRET_KEY: ['sk', 'live', 'placeholder'].join('_'),
    })).toThrow(/STRIPE_SECRET_KEY must be set to a non-placeholder/);
    expect(() => validateProductionEnv({
      ...validProductionEnv(),
      STRIPE_PRICE_BUSINESS_ANNUAL: ['price', 'placeholder'].join('_'),
    })).toThrow(/STRIPE_PRICE_BUSINESS_ANNUAL must be set to a non-placeholder/);
    // A real-looking value whose body merely contains one of the words is not a placeholder.
    expect(() => validateProductionEnv({
      ...validProductionEnv(),
      STRIPE_WEBHOOK_SECRET: ['whsec', 'examplePlaceholderXy12345'].join('_'),
    })).not.toThrow();
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
    env.TRUST_PROXY_HOPS = '2';
    env.CLOUDFRONT_SHARED_SECRET = env.JWT_SECRET;

    expect(() => validateProductionEnv(env)).toThrow(/JWT_SECRET and CLOUDFRONT_SHARED_SECRET/);
  });

  it('checks nothing outside production', () => {
    expect(validateProductionEnv({ NODE_ENV: 'development' })).toEqual([]);
    expect(validateProductionEnv({ NODE_ENV: 'test' })).toEqual([]);
    expect(validateProductionEnv({})).toEqual([]);
  });

  it('serves an ALB-only production API without the CloudFront header', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ALLOWED_ORIGINS = 'https://app.example.com';

    const app = createApp();
    await request(app).get('/api/v1/openapi.json').expect(200);
    await request(app).get('/api/health').expect(200);
  });

  it('keeps the trust-proxy default of 1 in production and 0 elsewhere', () => {
    const { getTrustProxyHops } = require('../security');
    expect(getTrustProxyHops({ NODE_ENV: 'production' })).toBe(1);
    expect(getTrustProxyHops({ NODE_ENV: 'development' })).toBe(0);
    expect(getTrustProxyHops({})).toBe(0);
    expect(getTrustProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '2' })).toBe(2);
  });

  describe('accepted production shapes', () => {
    it.each([
      ['CloudFront then ALB, with the secret', { TRUST_PROXY_HOPS: '2', CLOUDFRONT_SHARED_SECRET: CLOUDFRONT_SECRET }],
      ['hops left to the default of 1', { TRUST_PROXY_HOPS: undefined }],
      ['a reset link that lasts half an hour', { PASSWORD_RESET_TOKEN_MINUTES: '30' }],
      ['staging on Stripe test keys', { APP_ENV: 'staging', STRIPE_SECRET_KEY: fakeStripeSecretKey('test') }],
      ['the pool size written into the URL', {
        DATABASE_CONNECTION_LIMIT: undefined,
        DATABASE_URL: `${validProductionEnv().DATABASE_URL}&connection_limit=10`,
      }],
      ['mail through an https webhook', { EMAIL_PROVIDER: 'webhook', EMAIL_WEBHOOK_URL: 'https://mail.example.com/send' }],
      ['the SES region from the platform', { SES_REGION: undefined, AWS_REGION: 'us-east-2' }],
      ['the bucket region from the platform', { FILE_STORAGE_S3_REGION: undefined, AWS_REGION: 'us-east-2' }],
      ['API_BASE_URL spelled with /api/v1', { API_BASE_URL: 'https://api.example.com/api/v1' }],
      ['a pool size and timeout written into the URL', {
        DATABASE_CONNECTION_LIMIT: undefined,
        DATABASE_URL: `${validProductionEnv().DATABASE_URL}&connection_limit=10&pool_timeout=5`,
      }],
      ['postgres shared state named explicitly', {
        REALTIME_ADAPTER: 'postgres', RATE_LIMIT_STORE: 'postgres', AUTH_THROTTLE_STORE: 'postgres',
      }],
      ['a redis rate-limit store with its URL', { RATE_LIMIT_STORE: 'redis', REDIS_URL: 'rediss://cache.example.com:6379' }],
      ['a rotation window', { MFA_SECRET_KEY_PREVIOUS: 'the-old-mfa-key-with-at-least-32-characters' }],
      // pg ignores sslaccept and connection_limit, so the realtime URL needs neither.
      ['a direct realtime connection over TLS', {
        REALTIME_DATABASE_URL: `postgresql://user:password@db-direct.example.com:5432/pmcopilots?sslmode=require&sslcert=${encodeURIComponent(CA_BUNDLE)}`,
      }],
    ])('%s', (_label, overrides) => {
      expect(validateProductionEnv({ ...validProductionEnv(), ...overrides })).toEqual([]);
    });
  });

  // One case per rule: break exactly one thing in a valid environment and the
  // boot must fail naming the variable. Deleting any rule turns its row red.
  describe('refused production shapes', () => {
    it.each([
      // Edge: the hop count and the CloudFront secret describe one topology.
      ['hops that are not a number', { TRUST_PROXY_HOPS: 'abc' }, /TRUST_PROXY_HOPS must be 1/],
      ['zero hops', { TRUST_PROXY_HOPS: '0' }, /TRUST_PROXY_HOPS must be 1/],
      ['three hops', { TRUST_PROXY_HOPS: '3' }, /TRUST_PROXY_HOPS must be 1/],
      ['two hops without the CloudFront secret', { TRUST_PROXY_HOPS: '2' }, /CLOUDFRONT_SHARED_SECRET is required when TRUST_PROXY_HOPS=2/],
      ['the CloudFront secret on an ALB-only API', { CLOUDFRONT_SHARED_SECRET: CLOUDFRONT_SECRET }, /CLOUDFRONT_SHARED_SECRET must be unset when TRUST_PROXY_HOPS=1/],
      ['a short CloudFront secret', { TRUST_PROXY_HOPS: '2', CLOUDFRONT_SHARED_SECRET: 'short-secret' }, /CLOUDFRONT_SHARED_SECRET must be at least 32/],
      // Links and mail.
      ['no WEB_APP_URL', { WEB_APP_URL: undefined }, /WEB_APP_URL must be set/],
      ['an http WEB_APP_URL', { WEB_APP_URL: 'http://app.example.com' }, /WEB_APP_URL must use https/],
      ['a local WEB_APP_URL', { WEB_APP_URL: 'https://localhost:5173' }, /WEB_APP_URL must not point at a local/],
      ['a WEB_APP_URL with a path', { WEB_APP_URL: 'https://app.example.com/app' }, /WEB_APP_URL must be an origin only/],
      ['no API_BASE_URL', { API_BASE_URL: undefined }, /API_BASE_URL must be set/],
      ['a local API_BASE_URL', { API_BASE_URL: 'https://127.0.0.1:5000' }, /API_BASE_URL must not point at a local/],
      ['mail left on the log provider', { EMAIL_PROVIDER: undefined }, /EMAIL_PROVIDER must be ses or webhook in production/],
      ['mail explicitly on the log provider', { EMAIL_PROVIDER: 'log' }, /EMAIL_PROVIDER must be ses or webhook in production/],
      ['an unknown mail provider', { EMAIL_PROVIDER: 'smtp' }, /EMAIL_PROVIDER must be ses or webhook, not "smtp"/],
      ['SES without a sender', { EMAIL_FROM: undefined }, /EMAIL_FROM must be set/],
      ['SES with a sender that is not an address', { EMAIL_FROM: 'OctaPM' }, /EMAIL_FROM must be set/],
      ['SES without a region', { SES_REGION: undefined }, /SES_REGION/],
      ['an http mail webhook', { EMAIL_PROVIDER: 'webhook', EMAIL_WEBHOOK_URL: 'http://mail.example.com/send' }, /EMAIL_WEBHOOK_URL must be a public https URL/],
      ['a webhook provider with no URL', { EMAIL_PROVIDER: 'webhook' }, /EMAIL_WEBHOOK_URL must be a public https URL/],
      // Files.
      ['no bucket region', { FILE_STORAGE_S3_REGION: undefined }, /FILE_STORAGE_S3_REGION \(or AWS_REGION\)/],
      ['a bucket region that is not a region', { FILE_STORAGE_S3_REGION: 'ohio' }, /FILE_STORAGE_S3_REGION "ohio"/],
      ['a bucket name with dots', { FILE_STORAGE_S3_BUCKET: 'uploads.example.com' }, /FILE_STORAGE_S3_BUCKET "uploads.example.com"/],
      ['uploads forced to local disk', { FILE_STORAGE_DRIVER: 'local' }, /FILE_STORAGE_DRIVER=local/],
      ['static AWS access key', { AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE' }, /AWS_ACCESS_KEY_ID must not be set/],
      ['static AWS secret key', { AWS_SECRET_ACCESS_KEY: 'secret' }, /AWS_SECRET_ACCESS_KEY must not be set/],
      ['static AWS session token', { AWS_SESSION_TOKEN: 'token' }, /AWS_SESSION_TOKEN must not be set/],
      ['an S3 endpoint override', { FILE_STORAGE_S3_ENDPOINT: 'http://127.0.0.1:9000' }, /FILE_STORAGE_S3_ENDPOINT must not be set/],
      ['an SES endpoint override', { SES_ENDPOINT: 'https://ses.example.com' }, /SES_ENDPOINT must not be set/],
      ['an armed data-script guard', { ALLOW_DATA_SCRIPT: 'db.example.com/pmcopilots' }, /ALLOW_DATA_SCRIPT must not be set/],
      // Keys.
      ['no MFA key', { MFA_SECRET_KEY: undefined }, /MFA_SECRET_KEY must be set/],
      ['no integration key', { INTEGRATION_SECRET_KEY: undefined }, /INTEGRATION_SECRET_KEY must be set/],
      ['a short MFA key', { MFA_SECRET_KEY: 'short' }, /MFA_SECRET_KEY must be at least 32/],
      ['a short integration key', { INTEGRATION_SECRET_KEY: 'short' }, /INTEGRATION_SECRET_KEY must be at least 32/],
      ['the MFA key reusing the JWT secret', { MFA_SECRET_KEY: 'access-secret-with-at-least-32-characters' }, /JWT_SECRET and MFA_SECRET_KEY/],
      ['the MFA and integration keys the same', { INTEGRATION_SECRET_KEY: 'mfa-key-with-at-least-thirty-two-characters' }, /MFA_SECRET_KEY and INTEGRATION_SECRET_KEY/],
      ['a previous key equal to the current one', { MFA_SECRET_KEY_PREVIOUS: 'mfa-key-with-at-least-thirty-two-characters' }, /MFA_SECRET_KEY and MFA_SECRET_KEY_PREVIOUS/],
      ['inbound email at launch, even with its key', {
        INBOUND_EMAIL_DOMAIN: 'in.example.com',
        INBOUND_EMAIL_SECRET: 'inbound-secret-with-at-least-32-characters',
      }, /INBOUND_EMAIL_DOMAIN must not be set in production/],
      ['inbound email without its key', { INBOUND_EMAIL_DOMAIN: 'in.example.com' }, /INBOUND_EMAIL_SECRET must be set/],
      ['inbound email with a short key', { INBOUND_EMAIL_DOMAIN: 'in.example.com', INBOUND_EMAIL_SECRET: 'short' }, /INBOUND_EMAIL_SECRET must be at least 32/],
      ['an Anthropic key of the wrong shape', { ANTHROPIC_API_KEY: 'not-an-anthropic-key' }, /ANTHROPIC_API_KEY must look like/],
      // Database.
      ['no TLS to the database', { DATABASE_URL: 'postgresql://user:password@db.example.com:5432/pmcopilots' }, /DATABASE_URL must set sslmode=require/],
      ['libpq verify-full, which Prisma downgrades', { DATABASE_URL: validProductionEnv().DATABASE_URL.replace('sslmode=require', 'sslmode=verify-full') }, /sslmode=verify-full is not verified TLS/],
      ['sslmode=prefer', { DATABASE_URL: validProductionEnv().DATABASE_URL.replace('sslmode=require', 'sslmode=prefer') }, /sslmode=prefer/],
      ['sslmode=disable', { DATABASE_URL: validProductionEnv().DATABASE_URL.replace('sslmode=require', 'sslmode=disable') }, /sslmode=disable/],
      ['certificate checks switched off', { DATABASE_URL: validProductionEnv().DATABASE_URL.replace('sslaccept=strict', 'sslaccept=accept_invalid_certs') }, /sslaccept=accept_invalid_certs/],
      ['certificate checks left at the Prisma default', { DATABASE_URL: validProductionEnv().DATABASE_URL.replace('&sslaccept=strict', '') }, /must set sslaccept=strict/],
      // Prisma reads the last copy of a repeated parameter; the check must not read the first.
      ['a second sslmode that turns TLS off', { DATABASE_URL: `${validProductionEnv().DATABASE_URL}&sslmode=disable` }, /DATABASE_URL sets sslmode more than once/],
      ['a second sslaccept that turns certificate checks off', { DATABASE_URL: `${validProductionEnv().DATABASE_URL}&sslaccept=strict&sslaccept=accept_invalid_certs` }, /DATABASE_URL sets sslaccept more than once/],
      ['a second sslcert', { DATABASE_URL: `${validProductionEnv().DATABASE_URL}&sslcert=%2Ftmp%2Fother.pem` }, /DATABASE_URL sets sslcert more than once/],
      ['a second connection_limit', { DATABASE_URL: `${validProductionEnv().DATABASE_URL}&connection_limit=5&connection_limit=500` }, /DATABASE_URL sets connection_limit more than once/],
      ['an unbounded pool in the URL', { DATABASE_CONNECTION_LIMIT: undefined, DATABASE_URL: `${validProductionEnv().DATABASE_URL}&connection_limit=0` }, /DATABASE_URL connection_limit must be a positive whole number \(got "0"\)/],
      ['a pool size in the URL that is not a number', { DATABASE_CONNECTION_LIMIT: undefined, DATABASE_URL: `${validProductionEnv().DATABASE_URL}&connection_limit=abc` }, /DATABASE_URL connection_limit must be a positive whole number \(got "abc"\)/],
      ['an empty pool size in the URL', { DATABASE_CONNECTION_LIMIT: undefined, DATABASE_URL: `${validProductionEnv().DATABASE_URL}&connection_limit=` }, /DATABASE_URL connection_limit must be a positive whole number \(got ""\)/],
      ['a pool timeout in the URL that is not a number', { DATABASE_URL: `${validProductionEnv().DATABASE_URL}&pool_timeout=soon` }, /DATABASE_URL pool_timeout must be a positive whole number/],
      ['no CA bundle', { DATABASE_URL: 'postgresql://user:password@db.example.com:5432/pmcopilots?sslmode=require' }, /DATABASE_URL must set sslcert/],
      ['a relative CA path', { DATABASE_URL: 'postgresql://u:p@db.example.com/pm?sslmode=require&sslcert=certs/rds-ca.pem' }, /sslcert must be an absolute path/],
      ['a reset link that lasts ten days', { PASSWORD_RESET_TOKEN_MINUTES: '14400' }, /PASSWORD_RESET_TOKEN_MINUTES must be a whole number from 5 to 1440 \(got "14400"\)/],
      ['a reset link that lasts no time at all', { PASSWORD_RESET_TOKEN_MINUTES: '0' }, /PASSWORD_RESET_TOKEN_MINUTES must be a whole number from 5 to 1440/],
      ['a reset lifetime that is not a number', { PASSWORD_RESET_TOKEN_MINUTES: 'an hour' }, /PASSWORD_RESET_TOKEN_MINUTES must be a whole number from 5 to 1440/],
      ['a CA bundle that is not there', { DATABASE_URL: `postgresql://u:p@db.example.com/pm?sslmode=require&sslcert=${encodeURIComponent(`${CA_BUNDLE}.missing`)}` }, /sslcert names a file that does not exist/],
      ['no pool size', { DATABASE_CONNECTION_LIMIT: undefined }, /DATABASE_CONNECTION_LIMIT \(or connection_limit/],
      ['a pool size that is not a number', { DATABASE_CONNECTION_LIMIT: 'abc' }, /DATABASE_CONNECTION_LIMIT must be a positive whole number/],
      ['a pool timeout that is not a number', { DATABASE_POOL_TIMEOUT_SECONDS: '0' }, /DATABASE_POOL_TIMEOUT_SECONDS must be a positive whole number/],
      // The realtime adapter's own connection, when it has one.
      ['a realtime URL that is not a URL', { REALTIME_DATABASE_URL: 'not a url' }, /REALTIME_DATABASE_URL must be a postgresql:\/\/ URL/],
      ['a realtime connection without TLS', { REALTIME_DATABASE_URL: 'postgresql://u:p@db.example.com:5432/pm' }, /REALTIME_DATABASE_URL must set sslmode=require/],
      ['a realtime connection on sslmode=prefer', { REALTIME_DATABASE_URL: `postgresql://u:p@db.example.com/pm?sslmode=prefer&sslcert=${encodeURIComponent(CA_BUNDLE)}` }, /REALTIME_DATABASE_URL sslmode=prefer/],
      ['a realtime connection with no CA bundle', { REALTIME_DATABASE_URL: 'postgresql://u:p@db.example.com/pm?sslmode=require' }, /REALTIME_DATABASE_URL must set sslcert/],
      ['a relative realtime CA path', { REALTIME_DATABASE_URL: 'postgresql://u:p@db.example.com/pm?sslmode=require&sslcert=relative.pem' }, /REALTIME_DATABASE_URL sslcert must be an absolute path/],
      ['a realtime CA bundle that is not there', { REALTIME_DATABASE_URL: `postgresql://u:p@db.example.com/pm?sslmode=require&sslcert=${encodeURIComponent(`${CA_BUNDLE}.missing`)}` }, /REALTIME_DATABASE_URL sslcert names a file that does not exist/],
      ['a second realtime sslmode that turns TLS off', { REALTIME_DATABASE_URL: `postgresql://u:p@db.example.com/pm?sslmode=require&sslcert=${encodeURIComponent(CA_BUNDLE)}&sslmode=disable` }, /REALTIME_DATABASE_URL sets sslmode more than once/],
      ['a second realtime sslcert', { REALTIME_DATABASE_URL: `postgresql://u:p@db.example.com/pm?sslmode=require&sslcert=${encodeURIComponent(CA_BUNDLE)}&sslcert=%2Ftmp%2Fother.pem` }, /REALTIME_DATABASE_URL sets sslcert more than once/],
      ['a second realtime sslaccept', { REALTIME_DATABASE_URL: `postgresql://u:p@db.example.com/pm?sslmode=require&sslcert=${encodeURIComponent(CA_BUNDLE)}&sslaccept=strict&sslaccept=accept_invalid_certs` }, /REALTIME_DATABASE_URL sets sslaccept more than once/],
      // Release identity.
      ['no commit', { RELEASE_GIT_SHA: undefined }, /RELEASE_GIT_SHA must be the full 40-character commit/],
      ['a short commit', { RELEASE_GIT_SHA: '0123456' }, /RELEASE_GIT_SHA must be the full 40-character commit/],
      ['no APP_ENV', { APP_ENV: undefined }, /APP_ENV must be production or staging/],
      ['an unknown APP_ENV', { APP_ENV: 'prod' }, /APP_ENV must be production or staging, not "prod"/],
      ['production on Stripe test keys', { STRIPE_SECRET_KEY: fakeStripeSecretKey('test') }, /sk_live_/],
      // Shared state across tasks.
      ['per-task realtime', { REALTIME_ADAPTER: 'memory' }, /REALTIME_ADAPTER must be postgres/],
      ['per-task rate limits', { RATE_LIMIT_STORE: 'memory' }, /RATE_LIMIT_STORE must be postgres or redis/],
      ['per-task login lockout', { AUTH_THROTTLE_STORE: 'memory' }, /AUTH_THROTTLE_STORE must be postgres/],
      ['a redis store with no URL', { RATE_LIMIT_STORE: 'redis' }, /RATE_LIMIT_STORE=redis needs REDIS_URL/],
      ['an unknown request log format', { REQUEST_LOG_FORMAT: 'xml' }, /REQUEST_LOG_FORMAT must be one of/],
    ])('%s', (_label, overrides, message) => {
      const env = { ...validProductionEnv(), ...overrides };
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) delete env[key];
      }
      expect(() => validateProductionEnv(env)).toThrow(message);
    });
  });
});
