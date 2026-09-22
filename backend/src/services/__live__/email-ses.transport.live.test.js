/**
 * The SES v2 transport against a fake SES on 127.0.0.1 that checks the
 * request the way SES does: the SigV4 signature recomputed by an independent
 * verifier with the `ses` scope, the body hash, and the session token. The
 * last case runs forgot-password through the real API and real Postgres.
 *
 * Also pins what must not change: with nothing configured, a developer's
 * machine logs the email and calls nobody; a webhook still gets today's body.
 */
const crypto = require('crypto');
const http = require('http');
const { prisma } = require('../../config/db');
const { createLiveOrg, dropLiveOrg, liveDescribe } = require('../../__live__/helpers');
const { _resetAwsCredentialsCache } = require('../../utils/aws-credentials');
const { sendEmail } = require('../email.service');

const ENV_KEYS = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
  'AWS_EC2_METADATA_DISABLED',
  'EMAIL_PROVIDER',
  'EMAIL_FROM',
  'EMAIL_WEBHOOK_URL',
  'EMAIL_WEBHOOK_TOKEN',
  'NOTIFICATION_EMAIL_WEBHOOK_URL',
  'NOTIFICATION_EMAIL_WEBHOOK_TOKEN',
  'SES_REGION',
  'SES_ENDPOINT',
  'SES_CONFIGURATION_SET',
  'WEB_APP_URL',
];

const SECRETS = {
  AKIDEXAMPLE: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  ASIATASK: 'task-role-secret',
};

// ---- An independent SigV4 verifier (deliberately not utils/aws-sigv4) ----
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmacOf = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const verifySignature = (req, body) => {
  const match = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(
    req.headers.authorization || '',
  );
  if (!match) return { ok: false, reason: 'malformed' };
  const [, accessKeyId, date, region, service, signedHeaders, signature] = match;
  const secret = SECRETS[accessKeyId];
  if (!secret) return { ok: false, reason: 'unknown key' };
  const names = signedHeaders.split(';');
  const canonicalHeaders = names
    .map((name) => `${name}:${String(req.headers[name] ?? '').trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const [rawPath, rawQuery = ''] = req.url.split('?');
  const canonicalRequest = [req.method, rawPath, rawQuery, canonicalHeaders, signedHeaders, sha256(body)].join('\n');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', req.headers['x-amz-date'], scope, sha256(canonicalRequest)].join('\n');
  const key = hmacOf(hmacOf(hmacOf(hmacOf(`AWS4${secret}`, date), region), service), 'aws4_request');
  const expected = crypto.createHmac('sha256', key).update(stringToSign).digest('hex');
  return { ok: expected === signature, accessKeyId, region, service, names, reason: expected === signature ? null : 'mismatch' };
};

const startFake = async () => {
  const state = { requests: [], mode: 'ok' };
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const record = { method: req.method, url: req.url, headers: req.headers, raw: body.toString('utf8') };
      state.requests.push(record);
      if (req.url === '/hook') {
        res.writeHead(202, { 'content-type': 'application/json' }).end('{}');
        return;
      }
      record.verified = verifySignature(req, body);
      if (state.mode === 'hang') return; // never answer
      if (state.mode === 'reject') {
        res.writeHead(400, { 'content-type': 'application/json', 'x-amzn-ErrorType': 'MessageRejected:http://internal.amazon.com/coral/com.amazonaws.sesv2/' });
        res.end('{"message":"Email address is not verified."}');
        return;
      }
      if (state.mode === 'throttle') {
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end('{"__type":"TooManyRequestsException","message":"Maximum sending rate exceeded."}');
        return;
      }
      // Like SES: a bad signature or missing session token is a 403.
      if (!record.verified.ok) {
        res.writeHead(403, { 'x-amzn-ErrorType': 'SignatureDoesNotMatch' }).end('{}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ MessageId: `fake-${state.requests.length}` }));
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    state,
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(resolve);
      }),
  };
};

const startFakeAgent = async () => {
  const state = { hits: 0 };
  const server = http.createServer((req, res) => {
    state.hits += 1;
    if (req.headers.authorization !== 'agent-token') return res.writeHead(401).end();
    return res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        AccessKeyId: 'ASIATASK',
        SecretAccessKey: SECRETS.ASIATASK,
        Token: 'task-tok',
        Expiration: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { state, url: `http://127.0.0.1:${server.address().port}/creds`, close: () => new Promise((r) => server.close(r)) };
};

const MESSAGE = {
  to: 'site.manager@octapm-live.test',
  subject: 'RFI 12 needs your answer',
  body: 'Plain text body',
  html: '<p>HTML body</p>',
  replyTo: 'reply+abc@in.octapm-live.test',
  metadata: { kind: 'rfi' },
};

liveDescribe('SES v2 email transport', () => {
  const saved = {};
  let fake;
  let agent;

  const useSesWithEnvKeys = () => {
    Object.assign(process.env, {
      EMAIL_PROVIDER: 'ses',
      EMAIL_FROM: 'OctaPM <no-reply@octapm-live.test>',
      SES_REGION: 'us-east-2',
      SES_ENDPOINT: fake.origin,
      SES_CONFIGURATION_SET: 'octapm-live',
      AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE',
      AWS_SECRET_ACCESS_KEY: SECRETS.AKIDEXAMPLE,
      AWS_SESSION_TOKEN: 'session-tok',
    });
  };

  beforeAll(async () => {
    for (const name of ENV_KEYS) saved[name] = process.env[name];
    fake = await startFake();
    agent = await startFakeAgent();
  });

  afterAll(async () => {
    for (const name of ENV_KEYS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    _resetAwsCredentialsCache();
    await Promise.all([fake.close(), agent.close()]);
    await prisma.$disconnect();
  });

  let quiet;
  beforeEach(() => {
    for (const name of ENV_KEYS) delete process.env[name];
    process.env.AWS_EC2_METADATA_DISABLED = 'true';
    fake.state.requests = [];
    fake.state.mode = 'ok';
    agent.state.hits = 0;
    _resetAwsCredentialsCache();
    quiet = [jest.spyOn(console, 'log').mockImplementation(() => {}), jest.spyOn(console, 'error').mockImplementation(() => {})];
  });
  afterEach(() => quiet.forEach((spy) => spy.mockRestore()));

  it('sends a SendEmail request SES would accept: path, body, body hash, ses scope, token', async () => {
    useSesWithEnvKeys();
    const result = await sendEmail(MESSAGE);
    expect(result).toEqual({ delivered: true, provider: 'ses', messageId: 'fake-1', to: MESSAGE.to, subject: MESSAGE.subject });

    expect(fake.state.requests).toHaveLength(1);
    const [request] = fake.state.requests;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/v2/email/outbound-emails');
    expect(JSON.parse(request.raw)).toEqual({
      FromEmailAddress: 'OctaPM <no-reply@octapm-live.test>',
      Destination: { ToAddresses: [MESSAGE.to] },
      ReplyToAddresses: [MESSAGE.replyTo],
      ConfigurationSetName: 'octapm-live',
      Content: {
        Simple: {
          Subject: { Data: MESSAGE.subject, Charset: 'UTF-8' },
          Body: { Text: { Data: MESSAGE.body, Charset: 'UTF-8' }, Html: { Data: MESSAGE.html, Charset: 'UTF-8' } },
        },
      },
    });
    expect(request.headers['x-amz-content-sha256']).toBe(sha256(request.raw));
    expect(request.headers['x-amz-security-token']).toBe('session-tok');
    expect(request.verified).toMatchObject({ ok: true, accessKeyId: 'AKIDEXAMPLE', region: 'us-east-2', service: 'ses' });
    expect(request.verified.names).toEqual(expect.arrayContaining(['host', 'x-amz-content-sha256', 'x-amz-date', 'x-amz-security-token']));
  });

  it('signs with the task role from the container endpoint, fetched once', async () => {
    useSesWithEnvKeys();
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_SESSION_TOKEN;
    process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI = agent.url;
    process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN = 'agent-token';

    await sendEmail(MESSAGE);
    await sendEmail({ ...MESSAGE, html: undefined, replyTo: null });
    expect(agent.state.hits).toBe(1);
    for (const request of fake.state.requests) {
      expect(request.verified).toMatchObject({ ok: true, accessKeyId: 'ASIATASK', service: 'ses' });
      expect(request.headers['x-amz-security-token']).toBe('task-tok');
    }
    const second = JSON.parse(fake.state.requests[1].raw);
    expect(second.ReplyToAddresses).toBeUndefined();
    expect(second.Content.Simple.Body.Html).toBeUndefined();
  });

  it.each([
    ['reject', 400, 'MessageRejected'],
    ['throttle', 429, 'TooManyRequestsException'],
  ])('turns an SES %s into 502 EMAIL_DELIVERY_FAILED naming the AWS error', async (mode, status, awsError) => {
    useSesWithEnvKeys();
    fake.state.mode = mode;
    await expect(sendEmail(MESSAGE)).rejects.toMatchObject({
      status: 502,
      code: 'EMAIL_DELIVERY_FAILED',
      details: { status, awsError },
    });
  });

  it('gives up on an SES that never answers after ten seconds, as 502', async () => {
    useSesWithEnvKeys();
    fake.state.mode = 'hang';
    const started = Date.now();
    await expect(sendEmail(MESSAGE)).rejects.toMatchObject({
      status: 502,
      code: 'EMAIL_DELIVERY_FAILED',
      details: { awsError: 'Timeout' },
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(9_500);
    expect(elapsed).toBeLessThan(15_000);
  }, 30_000);

  it('logs locally and calls nobody when no provider is configured (today\'s development behaviour)', async () => {
    // Everything SES needs is present except the choice to use it.
    Object.assign(process.env, {
      SES_ENDPOINT: fake.origin,
      SES_REGION: 'us-east-2',
      EMAIL_FROM: 'no-reply@octapm-live.test',
      AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE',
      AWS_SECRET_ACCESS_KEY: SECRETS.AKIDEXAMPLE,
    });
    const result = await sendEmail(MESSAGE);
    expect(result).toEqual({ delivered: true, provider: 'local-log', to: MESSAGE.to, subject: MESSAGE.subject });
    expect(fake.state.requests).toHaveLength(0);
  });

  it('still posts today\'s JSON to a webhook when only a webhook is configured', async () => {
    process.env.EMAIL_WEBHOOK_URL = `${fake.origin}/hook`;
    process.env.EMAIL_WEBHOOK_TOKEN = 'hook-token';
    const result = await sendEmail(MESSAGE);
    expect(result).toEqual({ delivered: true, provider: 'webhook', to: MESSAGE.to, subject: MESSAGE.subject });
    expect(fake.state.requests).toHaveLength(1);
    const [request] = fake.state.requests;
    expect(request.headers.authorization).toBe('Bearer hook-token');
    expect(JSON.parse(request.raw)).toEqual({
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      text: MESSAGE.body,
      html: MESSAGE.html,
      replyTo: MESSAGE.replyTo,
      metadata: MESSAGE.metadata,
    });
  });

  describe('through the real API', () => {
    let live;
    let server;
    let base;

    beforeAll(async () => {
      live = await createLiveOrg(prisma);
      const { createApp } = require('../../app');
      server = http.createServer(createApp());
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${server.address().port}`;
    });

    afterAll(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      if (live) await dropLiveOrg(prisma, live.org.id);
    });

    it('delivers forgot-password through SES with a working reset link', async () => {
      useSesWithEnvKeys();
      process.env.WEB_APP_URL = 'https://app.octapm-live.test';

      const response = await fetch(`${base}/api/v1/auth/forgot-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: live.user.email }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true, data: { sent: true } });

      expect(fake.state.requests).toHaveLength(1);
      const [request] = fake.state.requests;
      expect(request.verified).toMatchObject({ ok: true, service: 'ses' });
      const message = JSON.parse(request.raw);
      expect(message.Destination.ToAddresses).toEqual([live.user.email]);
      const token = /https:\/\/app\.octapm-live\.test\/reset-password\?token=([A-Za-z0-9_-]+)/.exec(
        message.Content.Simple.Body.Text.Data,
      )?.[1];
      expect(token).toBeTruthy();

      const reset = await fetch(`${base}/api/v1/auth/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password: 'Reset-Live-Password-9!' }),
      });
      expect(reset.status).toBe(200);
    });
  });
});
