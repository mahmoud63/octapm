const crypto = require('crypto');
const { HttpError } = require('../utils/http-error');

const HEADER_NAME = 'X-CloudFront-Secret';

// Health checks come from the load balancer itself, which never passes
// through CloudFront and so never carries the secret. Liveness, the /live
// alias and readiness must all answer it, or a healthy task is marked dead.
const HEALTH_PATHS = new Set(['/api/health', '/api/health/live', '/api/health/ready']);

const timingSafeCompare = (provided, expected) => {
  if (!provided || !expected) return false;

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

// Express matches /api/health/ to /api/health, so the bypass must as well.
const isHealthPath = (path) => HEALTH_PATHS.has(String(path || '').replace(/(.)\/+$/, '$1'));

const shouldBypassCloudFrontGuard = (req) => (
  process.env.NODE_ENV !== 'production'
  || !process.env.CLOUDFRONT_SHARED_SECRET
  || isHealthPath(req.path)
);

const requireCloudFrontOriginSecret = (req, _res, next) => {
  if (shouldBypassCloudFrontGuard(req)) {
    return next();
  }

  if (timingSafeCompare(req.get(HEADER_NAME), process.env.CLOUDFRONT_SHARED_SECRET)) {
    return next();
  }

  return next(
    new HttpError(
      403,
      'CLOUDFRONT_ORIGIN_REQUIRED',
      'Request must arrive through the approved CloudFront origin',
    ),
  );
};

module.exports = {
  HEADER_NAME,
  HEALTH_PATHS,
  requireCloudFrontOriginSecret,
  timingSafeCompare,
};
