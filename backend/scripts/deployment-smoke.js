#!/usr/bin/env node

const Stripe = require('stripe');

const DEFAULT_PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const BASE_URL = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:5000').replace(/\/+$/, '');
const CLOUDFRONT_SECRET = process.env.SMOKE_CLOUDFRONT_SECRET;
const SMOKE_EMAIL = process.env.SMOKE_EMAIL;
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD;
const SMOKE_PROJECT_ID = process.env.SMOKE_PROJECT_ID;
const SMOKE_STRIPE_WEBHOOK_SECRET = process.env.SMOKE_STRIPE_WEBHOOK_SECRET;
const REQUIRE_AUTHENTICATED = process.env.SMOKE_REQUIRE_AUTHENTICATED === 'true';

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const baseHeaders = () => {
  const headers = {};
  if (CLOUDFRONT_SECRET) {
    headers['X-CloudFront-Secret'] = CLOUDFRONT_SECRET;
  }
  return headers;
};

const buildUrl = (path) => `${BASE_URL}${path}`;

const readBody = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return text;
  }
};

const request = async (path, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const headers = {
      ...baseHeaders(),
      ...(options.headers || {}),
    };

    return await fetch(buildUrl(path), {
      ...options,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const expectStatus = async (label, path, options, expectedStatus) => {
  const response = await request(path, options);
  const body = await readBody(response);

  if (response.status !== expectedStatus) {
    throw new Error(`${label} expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(body)}`);
  }

  console.log(`ok - ${label}`);
  return body;
};

const expectResponse = async (label, path, options, expectedStatus) => {
  const response = await request(path, options);
  const body = await readBody(response);

  if (response.status !== expectedStatus) {
    throw new Error(`${label} expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(body)}`);
  }

  console.log(`ok - ${label}`);
  return { body, response };
};

const waitForHealth = async () => {
  let lastError = null;

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const body = await expectStatus('health endpoint', '/api/health', {}, 200);
      if (body?.success === true && body?.data?.status === 'ok') {
        return;
      }
      lastError = new Error('health response did not include success status');
    } catch (error) {
      lastError = error;
    }

    await sleep(1000);
  }

  throw lastError || new Error('health endpoint did not become ready');
};

const runUnauthenticatedSmoke = async () => {
  await expectStatus('auth gate rejects missing token', '/api/v1/auth/me', {}, 401);
  await expectStatus('project list rejects missing token', '/api/v1/projects', {}, 401);
  await expectStatus(
    'schedule route rejects missing token',
    `/api/v1/projects/${DEFAULT_PROJECT_ID}/schedule`,
    {},
    401,
  );
  await expectStatus(
    'BOQ route rejects missing token',
    `/api/v1/projects/${DEFAULT_PROJECT_ID}/boq`,
    {},
    401,
  );
};

const runAuthenticatedSmoke = async () => {
  const { body: loginBody, response: loginResponse } = await expectResponse(
    'auth login accepts smoke user',
    '/api/v1/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SMOKE_EMAIL, password: SMOKE_PASSWORD }),
    },
    200,
  );

  const token = loginBody?.data?.tokens?.accessToken;
  if (!token) {
    throw new Error('auth login did not return an access token');
  }
  if (loginBody?.data?.tokens?.refreshToken || loginBody?.data?.refreshToken) {
    throw new Error('auth login leaked a refresh token in the response body');
  }

  const setCookie = loginResponse.headers.get('set-cookie') || '';
  if (!setCookie.includes('pmc_refresh_token=') || !setCookie.includes('HttpOnly')) {
    throw new Error('auth login did not set the httpOnly refresh cookie');
  }

  const authHeaders = { Authorization: `Bearer ${token}` };
  await expectStatus('auth profile loads', '/api/v1/auth/me', { headers: authHeaders }, 200);

  const projectsBody = await expectStatus(
    'project list loads',
    '/api/v1/projects?limit=1',
    { headers: authHeaders },
    200,
  );

  const projectId = SMOKE_PROJECT_ID || projectsBody?.data?.items?.[0]?.id;
  if (!projectId) {
    throw new Error('no project available for BOQ and schedule smoke checks');
  }

  await expectStatus(
    'schedule module loads',
    `/api/v1/projects/${projectId}/schedule`,
    { headers: authHeaders },
    200,
  );
  await expectStatus(
    'BOQ module loads',
    `/api/v1/projects/${projectId}/boq`,
    { headers: authHeaders },
    200,
  );
};

const runWebhookSmoke = async () => {
  const unsignedPayload = JSON.stringify({
    id: 'evt_unsigned_smoke',
    type: 'invoice.created',
    data: { object: {} },
  });
  const response = await request('/api/v1/webhooks/stripe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: unsignedPayload,
  });
  const body = await readBody(response);
  const expectedStatus = CLOUDFRONT_SECRET ? 400 : [400, 403];

  if (Array.isArray(expectedStatus)) {
    if (!expectedStatus.includes(response.status)) {
      throw new Error(`webhook rejection expected one of ${expectedStatus.join(', ')}, got ${response.status}: ${JSON.stringify(body)}`);
    }
  } else if (response.status !== expectedStatus) {
    throw new Error(`webhook rejection expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(body)}`);
  }

  console.log('ok - unsigned Stripe webhook is rejected');

  if (!SMOKE_STRIPE_WEBHOOK_SECRET) {
    console.log('skip - signed Stripe webhook smoke not configured');
    return;
  }

  const signedPayload = JSON.stringify({
    id: 'evt_signed_smoke',
    type: 'invoice.created',
    data: { object: { id: 'in_signed_smoke' } },
  });
  const stripe = new Stripe('sk_test_signature_smoke_only', { apiVersion: '2024-06-20' });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: signedPayload,
    secret: SMOKE_STRIPE_WEBHOOK_SECRET,
  });

  await expectStatus(
    'signed Stripe webhook test event is accepted',
    '/api/v1/webhooks/stripe',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': signature,
      },
      body: signedPayload,
    },
    200,
  );
};

const main = async () => {
  console.log(`Running deployment smoke checks against ${BASE_URL}`);
  await waitForHealth();

  if (SMOKE_EMAIL && SMOKE_PASSWORD) {
    await runAuthenticatedSmoke();
  } else if (REQUIRE_AUTHENTICATED) {
    throw new Error('SMOKE_EMAIL and SMOKE_PASSWORD are required when SMOKE_REQUIRE_AUTHENTICATED=true');
  } else {
    await runUnauthenticatedSmoke();
  }

  await runWebhookSmoke();
  console.log('Deployment smoke checks passed');
};

main().catch((error) => {
  console.error(`Deployment smoke checks failed: ${error.message}`);
  process.exitCode = 1;
});
