const express = require('express');
const request = require('supertest');

const {
  createRateLimiter,
  resetRateLimitStores,
} = require('../../middleware/rate-limit');

function buildApp(limiter) {
  const app = express();

  app.get('/limited', limiter, (_req, res) =>
    res.json({ success: true, data: { ok: true } }),
  );
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({
      success: false,
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: err.message,
        details: err.details,
      },
    }),
  );

  return app;
}

describe('rate limit middleware', () => {
  beforeEach(() => {
    resetRateLimitStores();
  });

  it('returns structured 429 errors with retry metadata after a bucket is exhausted', async () => {
    const limiter = createRateLimiter({
      name: 'focused-test',
      windowMs: 60_000,
      max: 2,
      keyGenerator: () => 'same-client',
    });
    const app = buildApp(limiter);

    await request(app).get('/limited').expect(200);
    const second = await request(app).get('/limited').expect(200);
    expect(second.get('RateLimit-Limit')).toBe('2');
    expect(second.get('RateLimit-Remaining')).toBe('0');

    const blocked = await request(app).get('/limited').expect(429);

    expect(blocked.get('Retry-After')).toBeDefined();
    expect(blocked.body).toMatchObject({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        details: {
          bucket: 'focused-test',
          retryAfterSeconds: expect.any(Number),
        },
      },
    });
  });
});
