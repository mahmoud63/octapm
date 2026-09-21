/**
 * Environments for the edge live tests' child processes.
 *
 * A child inherits the jest process's environment, which dotenv filled from
 * backend/.env — including a CLOUDFRONT_SHARED_SECRET, local http URLs and
 * relaxed rate limits. An empty string is what stops dotenv (in app.js)
 * putting a value back, so everything a test must not inherit is blanked.
 */
const crypto = require("crypto");

// Keys backend/.env sets that would otherwise leak into a production child.
const BLANK = {
  CLOUDFRONT_SHARED_SECRET: "",
  FRONTEND_URL: "",
  REDIS_URL: "",
};

/** DATABASE_URL without the connection_limit the live kit adds. */
const rawDatabaseUrl = () =>
  String(process.env.DATABASE_URL || "")
    .replace(/([?&])connection_limit=\d+&?/, "$1")
    .replace(/[?&]$/, "");

const randomSha = () => crypto.randomBytes(20).toString("hex");

/**
 * A complete, valid production environment for an ALB-only API, pointing at
 * a database that is never contacted (the TLS CA path must merely exist).
 */
const productionEnv = (overrides = {}) => ({
  ...BLANK,
  NODE_ENV: "production",
  APP_ENV: "staging",
  RELEASE_GIT_SHA: randomSha(),
  DATABASE_URL: `postgresql://octapm_app:pw@db.example.invalid:5432/octapm?sslmode=require&sslcert=${encodeURIComponent(__filename)}`,
  DATABASE_CONNECTION_LIMIT: "3",
  JWT_SECRET: "live-access-secret-with-at-least-32-characters",
  JWT_REFRESH_SECRET: "live-refresh-secret-with-at-least-32-characters",
  MFA_SECRET_KEY: "live-mfa-key-with-at-least-thirty-two-chars",
  INTEGRATION_SECRET_KEY: "live-integration-key-with-at-least-32-chars",
  ANTHROPIC_API_KEY: "sk-ant-live-test-shape-only",
  STRIPE_SECRET_KEY: "sk_test_livetestshapeonly",
  STRIPE_WEBHOOK_SECRET: "whsec_livetestshapeonly",
  STRIPE_PRICE_INDIVIDUAL_MONTHLY: "price_individual_monthly",
  STRIPE_PRICE_INDIVIDUAL_ANNUAL: "price_individual_annual",
  STRIPE_PRICE_BUSINESS_MONTHLY: "price_business_monthly",
  STRIPE_PRICE_BUSINESS_ANNUAL: "price_business_annual",
  STRIPE_SECRET_ROTATION_CONFIRMED_AT: "2026-09-01",
  STRIPE_SECRET_ROTATION_TICKET: "SEC-LIVE",
  TRUST_PROXY_HOPS: "1",
  CORS_ALLOWED_ORIGINS: "https://app.example.com",
  WEB_APP_URL: "https://app.example.com",
  API_BASE_URL: "https://api.example.com",
  EMAIL_PROVIDER: "ses",
  EMAIL_FROM: "OctaPM <no-reply@example.com>",
  SES_REGION: "us-east-2",
  FILE_STORAGE_S3_BUCKET: "octapm-live-uploads",
  FILE_STORAGE_S3_REGION: "us-east-2",
  LIVE_VALIDATE_ENV: "1",
  ...overrides,
});

module.exports = { BLANK, productionEnv, randomSha, rawDatabaseUrl };
