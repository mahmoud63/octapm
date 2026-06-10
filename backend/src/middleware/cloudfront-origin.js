const crypto = require('crypto');
const { HttpError } = require('../utils/http-error');

const HEADER_NAME = 'X-CloudFront-Secret';

const timingSafeCompare = (provided, expected) => {
  if (!provided || !expected) return false;

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

const shouldBypassCloudFrontGuard = (req) => (
  process.env.NODE_ENV !== 'production'
  || !process.env.CLOUDFRONT_SHARED_SECRET
  || req.path === '/api/health'
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
  requireCloudFrontOriginSecret,
  timingSafeCompare,
};
