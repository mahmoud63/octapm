const { collectStripeConfigProblems } = require('./stripe');

const DEFAULT_DEVELOPMENT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const REQUIRED_PRODUCTION_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'ANTHROPIC_API_KEY',
  'CLOUDFRONT_SHARED_SECRET',
];

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
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return null;

  const parsed = new URL(trimmed);
  if (parsed.origin !== trimmed) {
    throw new Error(`${value} must be an origin without a path`);
  }

  return parsed.origin;
};

const getConfiguredCorsOrigins = (env = process.env) =>
  unique(
    [
      ...splitList(env.CORS_ALLOWED_ORIGINS),
      ...splitList(env.FRONTEND_URL),
    ]
      .map(normalizeOrigin)
      .filter(Boolean),
  );

const getAllowedCorsOrigins = (env = process.env) => {
  const configured = getConfiguredCorsOrigins(env);
  if (configured.length > 0) return configured;
  return env.NODE_ENV === 'production' ? [] : DEFAULT_DEVELOPMENT_ORIGINS;
};

const isCorsOriginAllowed = (origin, env = process.env) => {
  if (!origin) return true;
  return getAllowedCorsOrigins(env).includes(origin);
};

const createCorsOriginDelegate = (env = process.env) => (origin, callback) => {
  callback(null, isCorsOriginAllowed(origin, env));
};

const createCorsOptions = (env = process.env) => ({
  origin: createCorsOriginDelegate(env),
  credentials: true,
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

const validateProductionCorsOrigins = (env, problems) => {
  const originValues = [
    ...splitList(env.CORS_ALLOWED_ORIGINS),
    ...splitList(env.FRONTEND_URL),
  ];

  if (originValues.length === 0) {
    problems.push('CORS_ALLOWED_ORIGINS or FRONTEND_URL must list approved frontend origins');
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
      problems.push(`${origin} must not be a local development origin in production`);
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
  }
};

const validateProductionEnv = (env = process.env) => {
  if (env.NODE_ENV !== 'production') {
    return [];
  }

  const problems = [];

  for (const key of REQUIRED_PRODUCTION_ENV) {
    assertRequiredValue(env, key, problems);
  }

  assertMinimumLength(env, 'JWT_SECRET', 32, problems);
  assertMinimumLength(env, 'JWT_REFRESH_SECRET', 32, problems);
  assertMinimumLength(env, 'CLOUDFRONT_SHARED_SECRET', 32, problems);

  problems.push(...collectStripeConfigProblems(env, {
    requireSecretKey: true,
    requireWebhookSecret: true,
    requireLiveSecretKey: true,
    requirePriceIds: true,
    requireRotationEvidence: true,
  }));

  assertDistinct(env, 'JWT_SECRET', 'JWT_REFRESH_SECRET', problems);
  assertDistinct(env, 'JWT_SECRET', 'CLOUDFRONT_SHARED_SECRET', problems);
  assertDistinct(env, 'JWT_REFRESH_SECRET', 'CLOUDFRONT_SHARED_SECRET', problems);
  validateProductionCorsOrigins(env, problems);
  validateProductionFileStorage(env, problems);

  if (problems.length > 0) {
    throw new Error(`Production environment validation failed:\n- ${problems.join('\n- ')}`);
  }

  return problems;
};

module.exports = {
  DEFAULT_DEVELOPMENT_ORIGINS,
  createCorsOptions,
  createSocketCorsOptions,
  getAllowedCorsOrigins,
  getConfiguredCorsOrigins,
  isCorsOriginAllowed,
  validateProductionEnv,
};
