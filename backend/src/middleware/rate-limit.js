const { HttpError } = require('../utils/http-error');
const {
  getSharedRateLimitStore,
  setSharedRateLimitStore,
} = require('../config/rate-limit-store');

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function userOrIpKey(req) {
  if (req.user?.id) {
    return `user:${req.user.orgId || 'org'}:${req.user.id}`;
  }

  return `ip:${clientIp(req)}`;
}

function projectUserOrIpKey(req) {
  const projectId = req.params?.projectId || req.params?.id || 'none';
  return `${projectId}:${userOrIpKey(req)}`;
}

function setRateHeaders(res, { limit, remaining, resetAt }) {
  res.set('RateLimit-Limit', String(limit));
  res.set('RateLimit-Remaining', String(Math.max(0, remaining)));
  res.set('RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
}

/**
 * Fixed-window limiter. Counters live in the shared rate-limit store (Redis
 * when REDIS_URL is set, otherwise process memory), so limits are enforced
 * consistently across horizontally scaled API instances.
 */
function createRateLimiter({
  name,
  windowMs,
  max,
  keyGenerator = clientIp,
  code = 'RATE_LIMITED',
  message = 'Too many requests. Try again later.',
  skip = () => false,
  store = null,
}) {
  const resolveStore = () => store || getSharedRateLimitStore();

  return (req, res, next) => {
    if (skip(req) || max === Infinity) {
      return next();
    }

    const now = Date.now();
    const key = `${name}:${keyGenerator(req) || 'anonymous'}`;

    return resolveStore()
      .hit(key, windowMs, now)
      .then(({ count, resetAt }) => {
        const remaining = max - count;
        setRateHeaders(res, { limit: max, remaining, resetAt });

        if (count > max) {
          const retryAfterSeconds = Math.max(
            1,
            Math.ceil((resetAt - now) / 1000),
          );
          res.set('Retry-After', String(retryAfterSeconds));
          return next(
            new HttpError(429, code, message, {
              bucket: name,
              retryAfterSeconds,
            }),
          );
        }

        return next();
      })
      .catch((error) => {
        // A broken counter store must never take the API down.
        console.error('[rate-limit] store failure; allowing request', error);
        return next();
      });
  };
}

function resetRateLimitStores() {
  return getSharedRateLimitStore().clear();
}

const apiRateLimiter = createRateLimiter({
  name: 'api',
  windowMs: readPositiveInt(process.env.RATE_LIMIT_API_WINDOW_MS, 15 * 60_000),
  max: readPositiveInt(process.env.RATE_LIMIT_API_MAX, 3000),
  keyGenerator: clientIp,
});

const authLimiter = createRateLimiter({
  name: 'auth',
  windowMs: readPositiveInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 15 * 60_000),
  max: readPositiveInt(process.env.RATE_LIMIT_AUTH_MAX, 80),
  keyGenerator: clientIp,
  message: 'Too many authentication requests. Try again later.',
});

const loginLimiter = createRateLimiter({
  name: 'auth-login',
  windowMs: readPositiveInt(
    process.env.RATE_LIMIT_LOGIN_WINDOW_MS,
    15 * 60_000,
  ),
  max: readPositiveInt(process.env.RATE_LIMIT_LOGIN_MAX, 12),
  keyGenerator: (req) => `${clientIp(req)}:${String(req.body?.email || '')}`,
  message: 'Too many login attempts. Try again later.',
});

const refreshLimiter = createRateLimiter({
  name: 'auth-refresh',
  windowMs: readPositiveInt(
    process.env.RATE_LIMIT_REFRESH_WINDOW_MS,
    5 * 60_000,
  ),
  max: readPositiveInt(process.env.RATE_LIMIT_REFRESH_MAX, 30),
  keyGenerator: clientIp,
  message: 'Too many refresh attempts. Try again later.',
});

const uploadLimiter = createRateLimiter({
  name: 'upload',
  windowMs: readPositiveInt(process.env.RATE_LIMIT_UPLOAD_WINDOW_MS, 60 * 60_000),
  max: readPositiveInt(process.env.RATE_LIMIT_UPLOAD_MAX, 40),
  keyGenerator: projectUserOrIpKey,
  message: 'Too many uploads. Try again later.',
});

const aiGenerationLimiter = createRateLimiter({
  name: 'ai-generation',
  windowMs: readPositiveInt(process.env.RATE_LIMIT_AI_WINDOW_MS, 60 * 60_000),
  max: readPositiveInt(process.env.RATE_LIMIT_AI_MAX, 8),
  keyGenerator: projectUserOrIpKey,
  message: 'Too many AI generation requests. Try again later.',
});

const billingLimiter = createRateLimiter({
  name: 'billing',
  windowMs: readPositiveInt(
    process.env.RATE_LIMIT_BILLING_WINDOW_MS,
    60 * 60_000,
  ),
  max: readPositiveInt(process.env.RATE_LIMIT_BILLING_MAX, 60),
  keyGenerator: userOrIpKey,
  message: 'Too many billing requests. Try again later.',
});

const stripeWebhookLimiter = createRateLimiter({
  name: 'stripe-webhook',
  windowMs: readPositiveInt(
    process.env.RATE_LIMIT_STRIPE_WEBHOOK_WINDOW_MS,
    60_000,
  ),
  max: readPositiveInt(process.env.RATE_LIMIT_STRIPE_WEBHOOK_MAX, 120),
  keyGenerator: clientIp,
  message: 'Too many webhook requests. Try again later.',
});

// An administrator asking OctaPM to send someone the reset e-mail (D-ID-1 Q4):
// limited per person in each workspace, so no company can flood a person's
// mailbox or keep cancelling the reset link they asked for themselves, and per
// administrator, so one account cannot sweep a workspace.
const passwordResetEmailTargetLimiter = createRateLimiter({
  name: 'reset-email-target',
  windowMs: readPositiveInt(process.env.RATE_LIMIT_RESET_EMAIL_WINDOW_MS, 60 * 60_000),
  max: readPositiveInt(process.env.RATE_LIMIT_RESET_EMAIL_TARGET_MAX, 3),
  keyGenerator: (req) => `${req.user?.orgId || 'none'}:${String(req.params?.id || '')}`,
  message: 'A reset e-mail was sent to this person recently. Try again later.',
});

const passwordResetEmailActorLimiter = createRateLimiter({
  name: 'reset-email-actor',
  windowMs: readPositiveInt(process.env.RATE_LIMIT_RESET_EMAIL_WINDOW_MS, 60 * 60_000),
  max: readPositiveInt(process.env.RATE_LIMIT_RESET_EMAIL_ACTOR_MAX, 20),
  keyGenerator: (req) => `${req.user?.orgId || 'none'}:${req.user?.id || clientIp(req)}`,
  message: 'Too many reset e-mails requested. Try again later.',
});

module.exports = {
  aiGenerationLimiter,
  passwordResetEmailActorLimiter,
  passwordResetEmailTargetLimiter,
  apiRateLimiter,
  authLimiter,
  billingLimiter,
  createRateLimiter,
  loginLimiter,
  refreshLimiter,
  resetRateLimitStores,
  setSharedRateLimitStore,
  stripeWebhookLimiter,
  uploadLimiter,
};
