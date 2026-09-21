const fs = require('fs');
const path = require('path');
const { collectStripeConfigProblems } = require('./stripe');
const { emailWebhookUrl, resolveEmailProvider } = require('./email-provider');
const { readPoolSetting } = require('./db');
const { RELEASE_HEADER } = require('./release');
const { REQUEST_LOG_FORMATS } = require('../middleware/request-log');

const DEFAULT_DEVELOPMENT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:5175',
  'http://127.0.0.1:5175',
];

const REQUIRED_PRODUCTION_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'ANTHROPIC_API_KEY',
  // Dedicated encryption keys. Outside production they fall back to other
  // secrets; in production that fallback would tie TOTP and OAuth ciphertext
  // to JWT_SECRET, so a routine JWT rotation would break every enrolment.
  'MFA_SECRET_KEY',
  'INTEGRATION_SECRET_KEY',
  // CLOUDFRONT_SHARED_SECRET is not listed: it is required only when the API
  // sits behind CloudFront (TRUST_PROXY_HOPS=2); see validateProductionProxy.
];

// Every secret that must be unique. Reusing one for two jobs means leaking
// one leaks both, and rotating one silently breaks the other.
const DISTINCT_SECRETS = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'MFA_SECRET_KEY',
  'INTEGRATION_SECRET_KEY',
  'INBOUND_EMAIL_SECRET',
  'CLOUDFRONT_SHARED_SECRET',
];

// Keys that may have a decrypt-only *_PREVIOUS during a rotation window.
const ROTATABLE_SECRETS = [
  'MFA_SECRET_KEY',
  'INTEGRATION_SECRET_KEY',
  'INBOUND_EMAIL_SECRET',
];

// Set on a production task, each of these quietly defeats something the
// deployment depends on: static keys outrank the task role, an endpoint
// override sends files or mail somewhere other than AWS, and ALLOW_DATA_SCRIPT
// lets the seed and E2E-reset scripts write to this database.
const FORBIDDEN_PRODUCTION_ENV = [
  ['AWS_ACCESS_KEY_ID', 'credentials come from the ECS task role'],
  ['AWS_SECRET_ACCESS_KEY', 'credentials come from the ECS task role'],
  ['AWS_SESSION_TOKEN', 'credentials come from the ECS task role'],
  ['FILE_STORAGE_S3_ENDPOINT', 'it is for local S3 stand-ins only'],
  ['SES_ENDPOINT', 'it is for local SES stand-ins only'],
  ['ALLOW_DATA_SCRIPT', 'data scripts must never be armed on a running service'],
];

// Shared-state backends: each is per-process `memory` outside production and
// must be shared across tasks in production.
const SHARED_STATE_STORES = [
  ['REALTIME_ADAPTER', ['postgres']],
  ['RATE_LIMIT_STORE', ['postgres', 'redis']],
  ['AUTH_THROTTLE_STORE', ['postgres']],
];

const APP_ENVIRONMENTS = ['production', 'staging'];
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

const PLACEHOLDER_VALUES = new Set([
  'CHANGE_ME',
  'your-secret-key-change-this',
  'your-refresh-secret-change-this',
  'your-key-here',
  'sk-ant-CHANGE_ME',
  'sk_test_...',
  'sk_live_...',
  'whsec_...',
  'price_...',
]);

const splitList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const unique = (values) => [...new Set(values)];

const normalizeOrigin = (value) => {
  const trimmed = String(value || '')
    .trim()
    .replace(/\/+$/, '');
  if (!trimmed) return null;

  const parsed = new URL(trimmed);
  if (parsed.origin !== trimmed) {
    throw new Error(`${value} must be an origin without a path`);
  }

  return parsed.origin;
};

const getConfiguredCorsOrigins = (env = process.env) =>
  unique(
    [...splitList(env.CORS_ALLOWED_ORIGINS), ...splitList(env.FRONTEND_URL)]
      .map(normalizeOrigin)
      .filter(Boolean),
  );

const getAllowedCorsOrigins = (env = process.env) => {
  const configured = getConfiguredCorsOrigins(env);
  if (configured.length > 0) return configured;
  return env.NODE_ENV === 'production' ? [] : DEFAULT_DEVELOPMENT_ORIGINS;
};

// A request with no Origin header is not a browser cross-origin request
// (curl, a health check, a server-to-server call), so it is allowed; anything
// else must appear in the configured allowlist.
//
// Main replaced this with an unconditional `return true` while unblocking a
// deployment (commit ab50f03, "allow origin list"). Phase 20.6 restored it:
// widening CORS belongs in CORS_ALLOWED_ORIGINS / FRONTEND_URL, which this
// function already reads, not in the code.
const isCorsOriginAllowed = (origin, env = process.env) => {
  if (!origin) return true;
  return getAllowedCorsOrigins(env).includes(origin);
};

const createCorsOriginDelegate =
  (env = process.env) =>
  (origin, callback) => {
    callback(null, isCorsOriginAllowed(origin, env));
  };

const createCorsOptions = (env = process.env) => ({
  origin: createCorsOriginDelegate(env),
  credentials: true,
  // Browser scripts can read only the response headers a preflight exposes.
  // The request id is the support reference every client shows, so a browser
  // client (the web platform, or the mobile app running as a web build) must
  // be able to read it too. Native apps are not subject to CORS. The release
  // header lets the web app notice it is talking to a newer API.
  exposedHeaders: ["X-Request-Id", RELEASE_HEADER],
});

const createSocketCorsOptions = (env = process.env) => ({
  origin: createCorsOriginDelegate(env),
  methods: ['GET', 'POST'],
  credentials: true,
});

const isPlaceholder = (value) => {
  const normalized = String(value || '').trim();
  return !normalized || PLACEHOLDER_VALUES.has(normalized);
};

const assertRequiredValue = (env, key, problems) => {
  if (isPlaceholder(env[key])) {
    problems.push(`${key} must be set to a non-placeholder value`);
  }
};

const assertMinimumLength = (env, key, minLength, problems) => {
  const value = String(env[key] || '');
  if (value && value.length < minLength) {
    problems.push(`${key} must be at least ${minLength} characters long`);
  }
};

const assertDistinct = (env, left, right, problems) => {
  if (env[left] && env[right] && env[left] === env[right]) {
    problems.push(`${left} and ${right} must not reuse the same secret`);
  }
};

const isSet = (value) => String(value ?? '').trim() !== '';

/**
 * How many proxies in front of this process to trust for the client IP.
 *
 * TRUST_PROXY_HOPS when set, otherwise 1 in production (a load balancer in
 * front) and 0 elsewhere — the rule app.js has always applied. A value that
 * is not a number comes back as NaN, which app.js treats as "trust nothing",
 * again as before; production refuses such a value at boot instead.
 */
const getTrustProxyHops = (env = process.env) =>
  Number.parseInt(
    env.TRUST_PROXY_HOPS || (env.NODE_ENV === 'production' ? '1' : '0'),
    10,
  );

/**
 * The hop count and the CloudFront origin secret describe one topology, so
 * they are checked together:
 *
 * - ALB only (the target): TRUST_PROXY_HOPS=1 and no secret. The ALB appends
 *   the real client as the last X-Forwarded-For entry, so one hop is
 *   authoritative and anything a client wrote to the left is ignored. A secret
 *   here would make the origin guard refuse every request, since no web or
 *   mobile client sends it.
 * - CloudFront then ALB: TRUST_PROXY_HOPS=2 and the secret. Two hops are only
 *   trustworthy if nobody can reach the ALB directly, which is exactly what
 *   the secret enforces. Without it any client could choose its own IP for the
 *   rate limiter and the login lockout.
 *
 * Anything other than 1 or 2 is refused: a stray value used to switch trust
 * proxy off silently, keying every limit on the load balancer's address.
 */
const validateProductionProxy = (env, problems) => {
  const raw = String(env.TRUST_PROXY_HOPS ?? '').trim();
  if (raw && raw !== '1' && raw !== '2') {
    problems.push(
      `TRUST_PROXY_HOPS must be 1 (load balancer only) or 2 (CloudFront then load balancer), not "${env.TRUST_PROXY_HOPS}"`,
    );
    return;
  }

  const hops = raw ? Number(raw) : 1;
  const hasSecret = isSet(env.CLOUDFRONT_SHARED_SECRET);
  if (hops === 2 && isPlaceholder(env.CLOUDFRONT_SHARED_SECRET)) {
    problems.push(
      'CLOUDFRONT_SHARED_SECRET is required when TRUST_PROXY_HOPS=2 (CloudFront then load balancer)',
    );
  }
  if (hops === 1 && hasSecret) {
    problems.push(
      'CLOUDFRONT_SHARED_SECRET must be unset when TRUST_PROXY_HOPS=1 (load balancer only); set TRUST_PROXY_HOPS=2 if CloudFront fronts the API',
    );
  }
};

const isLocalHostname = (hostname) =>
  LOCAL_HOSTNAMES.has(hostname)
  || hostname.endsWith('.localhost')
  || /^127\./.test(hostname);

/**
 * A public https origin (no path, query or credentials), or a problem.
 * `allowApiRoot` also accepts a trailing /api/v1, the second spelling
 * utils/api-url.js understands for API_BASE_URL.
 */
const checkPublicOrigin = (env, key, problems, { allowApiRoot = false } = {}) => {
  const raw = String(env[key] ?? '').trim();
  if (!raw) {
    problems.push(`${key} must be set to the public https origin (links and redirects are built from it)`);
    return;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    problems.push(`${key} must be a URL, not "${raw}"`);
    return;
  }

  if (parsed.protocol !== 'https:') {
    problems.push(`${key} must use https in production`);
  }
  if (isLocalHostname(parsed.hostname)) {
    problems.push(`${key} must not point at a local development host in production`);
  }
  const pathname = parsed.pathname.replace(/\/+$/, '');
  const pathAllowed = !pathname || (allowApiRoot && /^\/api\/v\d+$/i.test(pathname));
  if (!pathAllowed || parsed.search || parsed.hash || parsed.username || parsed.password) {
    problems.push(`${key} must be an origin only, such as https://app.example.com`);
  }
};

/**
 * Mail has to leave the building, and every link in it has to point at the
 * real site. `resolveEmailProvider` is the same answer email.service uses, so
 * this check cannot pass a configuration the sender would then refuse.
 */
const validateProductionEmailAndLinks = (env, problems) => {
  checkPublicOrigin(env, 'WEB_APP_URL', problems);
  checkPublicOrigin(env, 'API_BASE_URL', problems, { allowApiRoot: true });

  const { provider, invalid } = resolveEmailProvider(env);
  if (invalid) {
    problems.push(`EMAIL_PROVIDER must be ses or webhook, not "${invalid}"`);
    return;
  }
  if (provider === 'log') {
    problems.push(
      'EMAIL_PROVIDER must be ses or webhook in production (log only writes mail, and its links, to the server log)',
    );
    return;
  }

  if (provider === 'ses') {
    const from = String(env.EMAIL_FROM ?? '').trim();
    const address = (/<([^<>]*)>$/.exec(from) || [null, from])[1].trim();
    if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(address)) {
      problems.push('EMAIL_FROM must be set to a verified SES sender, such as OctaPM <no-reply@example.com>');
    }
    if (!isSet(env.SES_REGION) && !isSet(env.AWS_REGION) && !isSet(env.AWS_DEFAULT_REGION)) {
      problems.push('SES_REGION (or AWS_REGION) must name the region where the SES identity is verified');
    }
  }

  if (provider === 'webhook') {
    const url = emailWebhookUrl(env);
    let parsed = null;
    try {
      parsed = url ? new URL(url) : null;
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.protocol !== 'https:' || isLocalHostname(parsed.hostname)) {
      problems.push('EMAIL_WEBHOOK_URL must be a public https URL when EMAIL_PROVIDER=webhook');
    }
  }
};

/**
 * The database connection: verified TLS and a bounded pool.
 *
 * Prisma understands sslmode=require with sslcert=<CA file> as "verify the
 * chain and the hostname" (sslaccept defaults to strict). It does not
 * understand libpq's verify-full / verify-ca: it silently treats them as
 * prefer, which falls back to plaintext. So the one spelling that works is
 * required and the look-alikes are refused by name. The CA path must be
 * absolute because Prisma resolves a relative one against the schema folder,
 * not the working directory, so the app and `migrate deploy` would disagree.
 */
const validateProductionDatabase = (env, problems) => {
  const raw = String(env.DATABASE_URL ?? '').trim();
  if (raw && !isPlaceholder(raw)) {
    let parsed = null;
    try {
      parsed = new URL(raw);
    } catch {
      problems.push('DATABASE_URL must be a postgresql:// URL');
    }

    if (parsed) {
      const params = parsed.searchParams;
      const sslmode = String(params.get('sslmode') ?? '').trim().toLowerCase();
      if (sslmode !== 'require') {
        problems.push(
          sslmode
            ? `DATABASE_URL sslmode=${sslmode} is not verified TLS under Prisma; use sslmode=require with sslcert=<absolute CA path>`
            : 'DATABASE_URL must set sslmode=require and sslcert=<absolute CA path> (TLS to the database)',
        );
      }

      const sslcert = String(params.get('sslcert') ?? '').trim();
      if (!sslcert) {
        problems.push('DATABASE_URL must set sslcert to the absolute path of the database CA bundle');
      } else if (!path.isAbsolute(sslcert)) {
        problems.push(`DATABASE_URL sslcert must be an absolute path, not "${sslcert}"`);
      } else if (!fs.existsSync(sslcert)) {
        problems.push(`DATABASE_URL sslcert names a file that does not exist: ${sslcert}`);
      }

      const sslaccept = String(params.get('sslaccept') ?? '').trim().toLowerCase();
      if (sslaccept && sslaccept !== 'strict') {
        problems.push(`DATABASE_URL sslaccept=${sslaccept} turns certificate checking off; remove it`);
      }

      if (!params.has('connection_limit') && !isSet(env.DATABASE_CONNECTION_LIMIT)) {
        problems.push(
          'DATABASE_CONNECTION_LIMIT (or connection_limit in DATABASE_URL) must size this process\'s pool',
        );
      }
    }
  }

  for (const key of ['DATABASE_CONNECTION_LIMIT', 'DATABASE_POOL_TIMEOUT_SECONDS']) {
    try {
      readPoolSetting(env, key);
    } catch (error) {
      problems.push(error.message);
    }
  }
};

/**
 * One image runs as staging and as production, so the image must say which
 * commit it is and the task must say where it runs. An image built without
 * the build args would otherwise report nothing a deploy could be checked
 * against.
 */
const validateProductionRelease = (env, problems) => {
  if (!/^[0-9a-f]{40}$/i.test(String(env.RELEASE_GIT_SHA ?? '').trim())) {
    problems.push('RELEASE_GIT_SHA must be the full 40-character commit the image was built from');
  }
  const appEnv = String(env.APP_ENV ?? '').trim();
  if (!APP_ENVIRONMENTS.includes(appEnv)) {
    problems.push(`APP_ENV must be production or staging${appEnv ? `, not "${appEnv}"` : ''}`);
  }
};

const validateProductionSecrets = (env, problems) => {
  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'MFA_SECRET_KEY', 'INTEGRATION_SECRET_KEY']) {
    assertMinimumLength(env, key, 32, problems);
  }
  assertMinimumLength(env, 'CLOUDFRONT_SHARED_SECRET', 32, problems);

  // Reply-to addresses are signed with this; with the inbound domain set and
  // no key, production would sign them with nothing it controls separately.
  if (isSet(env.INBOUND_EMAIL_DOMAIN)) {
    assertRequiredValue(env, 'INBOUND_EMAIL_SECRET', problems);
    assertMinimumLength(env, 'INBOUND_EMAIL_SECRET', 32, problems);
  }

  const anthropicKey = String(env.ANTHROPIC_API_KEY ?? '').trim();
  if (anthropicKey && !isPlaceholder(anthropicKey) && !anthropicKey.startsWith('sk-ant-')) {
    problems.push('ANTHROPIC_API_KEY must look like an Anthropic key (sk-ant-…)');
  }

  for (let i = 0; i < DISTINCT_SECRETS.length; i += 1) {
    for (let j = i + 1; j < DISTINCT_SECRETS.length; j += 1) {
      assertDistinct(env, DISTINCT_SECRETS[i], DISTINCT_SECRETS[j], problems);
    }
  }
  // A *_PREVIOUS equal to its primary is a rotation that never happened.
  for (const key of ROTATABLE_SECRETS) {
    assertDistinct(env, key, `${key}_PREVIOUS`, problems);
  }
};

const validateProductionForbidden = (env, problems) => {
  for (const [key, reason] of FORBIDDEN_PRODUCTION_ENV) {
    if (isSet(env[key])) {
      problems.push(`${key} must not be set in production: ${reason}`);
    }
  }
};

const validateProductionSharedState = (env, problems) => {
  for (const [key, allowed] of SHARED_STATE_STORES) {
    const value = String(env[key] ?? '').trim().toLowerCase();
    if (value && !allowed.includes(value)) {
      problems.push(
        `${key} must be ${allowed.join(' or ')} in production, not "${env[key]}" (several tasks must share this state)`,
      );
    }
  }
  if (String(env.RATE_LIMIT_STORE ?? '').trim().toLowerCase() === 'redis' && !isSet(env.REDIS_URL)) {
    problems.push('RATE_LIMIT_STORE=redis needs REDIS_URL');
  }

  const logFormat = String(env.REQUEST_LOG_FORMAT ?? '').trim().toLowerCase();
  if (logFormat && !REQUEST_LOG_FORMATS.includes(logFormat)) {
    problems.push(`REQUEST_LOG_FORMAT must be one of ${REQUEST_LOG_FORMATS.join(', ')}, not "${env.REQUEST_LOG_FORMAT}"`);
  }
};

const validateProductionCorsOrigins = (env, problems) => {
  const originValues = [
    ...splitList(env.CORS_ALLOWED_ORIGINS),
    ...splitList(env.FRONTEND_URL),
  ];

  if (originValues.length === 0) {
    problems.push(
      'CORS_ALLOWED_ORIGINS or FRONTEND_URL must list approved frontend origins',
    );
    return;
  }

  for (const originValue of originValues) {
    if (originValue === '*') {
      problems.push('CORS origins must not use a wildcard in production');
      continue;
    }

    let origin;
    try {
      origin = normalizeOrigin(originValue);
    } catch (error) {
      problems.push(`Invalid CORS origin: ${error.message}`);
      continue;
    }

    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:') {
      problems.push(`${origin} must use https in production CORS`);
    }
    if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
      problems.push(
        `${origin} must not be a local development origin in production`,
      );
    }
  }
};

const validateProductionFileStorage = (env, problems) => {
  const bucket =
    env.FILE_STORAGE_S3_BUCKET ||
    env.S3_UPLOADS_BUCKET ||
    env.S3_UPLOAD_BUCKET ||
    env.AWS_S3_UPLOADS_BUCKET ||
    env.AWS_S3_UPLOAD_BUCKET;

  if (isPlaceholder(bucket)) {
    problems.push(
      'FILE_STORAGE_S3_BUCKET or S3_UPLOADS_BUCKET must be set for private production uploads',
    );
  } else if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(String(bucket).trim())) {
    // Uploads use virtual-hosted https://<bucket>.s3.<region>.amazonaws.com;
    // a dot in the name breaks that certificate match.
    problems.push(
      `FILE_STORAGE_S3_BUCKET "${bucket}" must be a lowercase S3 bucket name without dots`,
    );
  }

  // Forcing local disk on a task means every upload vanishes with the task.
  if (String(env.FILE_STORAGE_DRIVER ?? '').trim().toLowerCase() === 'local') {
    problems.push(
      'FILE_STORAGE_DRIVER=local must not be used in production: task disks are discarded, uploads must go to S3',
    );
  }

  // Presigned URLs and upload signatures are scoped to a region; signing for
  // the wrong one fails every request against the bucket.
  const region = String(env.FILE_STORAGE_S3_REGION || env.AWS_REGION || '').trim();
  if (!region) {
    problems.push('FILE_STORAGE_S3_REGION (or AWS_REGION) must name the upload bucket\'s region');
  } else if (!/^[a-z]{2}(-[a-z]+)+-\d+$/.test(region)) {
    problems.push(`FILE_STORAGE_S3_REGION "${region}" is not an AWS region name`);
  }
};

const validateProductionEnv = (env = process.env) => {
  // 'productio' on main (a typo introduced in e2b95be) made this return early
  // for NODE_ENV=production, so every check below — secret length, secret
  // reuse, Stripe configuration, S3 bucket, CORS — was skipped in the one
  // environment they exist for. Restored in Phase 20.6.
  if (env.NODE_ENV !== 'production') {
    return [];
  }

  const problems = [];

  for (const key of REQUIRED_PRODUCTION_ENV) {
    assertRequiredValue(env, key, problems);
  }

  validateProductionSecrets(env, problems);

  problems.push(
    ...collectStripeConfigProblems(env, {
      requireSecretKey: true,
      requireWebhookSecret: true,
      // Waived for APP_ENV=staging inside collectStripeConfigProblems.
      requireLiveSecretKey: true,
      requirePriceIds: true,
      requireRotationEvidence: true,
    }),
  );

  validateProductionProxy(env, problems);
  validateProductionCorsOrigins(env, problems);
  validateProductionEmailAndLinks(env, problems);
  validateProductionFileStorage(env, problems);
  validateProductionDatabase(env, problems);
  validateProductionRelease(env, problems);
  validateProductionSharedState(env, problems);
  validateProductionForbidden(env, problems);

  if (problems.length > 0) {
    throw new Error(
      `Production environment validation failed:\n- ${problems.join('\n- ')}`,
    );
  }

  return problems;
};

module.exports = {
  DEFAULT_DEVELOPMENT_ORIGINS,
  createCorsOptions,
  createSocketCorsOptions,
  getAllowedCorsOrigins,
  getConfiguredCorsOrigins,
  getTrustProxyHops,
  isCorsOriginAllowed,
  validateProductionEnv,
};
