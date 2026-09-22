/**
 * S3 the way Fargate reaches it: no AWS keys in the environment, temporary
 * task-role credentials from the container endpoint, and every request
 * carrying their session token.
 *
 * The real API (createApp on a real socket, real auth, real Postgres) uploads
 * a photo and hands out a download link. The S3 on the other end is a fake on
 * 127.0.0.1 that verifies SigV4 itself — its own implementation, not the one
 * under test — and the session token, so a request AWS would refuse is
 * refused here too.
 */
const crypto = require('crypto');
const http = require('http');
const { prisma } = require('../../config/db');
const { createLiveOrg, dropLiveOrg, liveDescribe } = require('../../__live__/helpers');
const { _resetAwsCredentialsCache } = require('../../utils/aws-credentials');

const BUCKET = 'octapm-live-uploads';
const REGION = 'us-east-2';
// A real 1x1 PNG, so the magic-byte check passes as it would for a phone photo.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const ENV_KEYS = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_REGION',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
  'AWS_EC2_METADATA_DISABLED',
  'FILE_STORAGE_DRIVER',
  'FILE_STORAGE_S3_BUCKET',
  'FILE_STORAGE_S3_REGION',
  'FILE_STORAGE_S3_ENDPOINT',
  'FILE_PRESIGNED_URL_TTL_SECONDS',
];

// ---- An independent SigV4 verifier (deliberately not utils/aws-sigv4) ----
const rfc3986 = (value) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hmacOf = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const deriveKey = (secret, date, region, service) =>
  hmacOf(hmacOf(hmacOf(hmacOf(`AWS4${secret}`, date), region), service), 'aws4_request');
const rawQueryPairs = (rawQuery) =>
  (rawQuery ? rawQuery.split('&') : []).map((pair) => {
    const [key, value = ''] = pair.split('=');
    return [decodeURIComponent(key), decodeURIComponent(value)];
  });
const canonicalQueryOf = (pairs) =>
  pairs
    .map(([key, value]) => [rfc3986(key), rfc3986(value)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

const startFakeS3 = async ({ iam }) => {
  const objects = new Map();
  const log = [];
  const deny = (res, reason) => {
    log[log.length - 1].denied = reason;
    res.writeHead(403, { 'content-type': 'application/xml' }).end(`<Error><Code>${reason}</Code></Error>`);
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const [rawPath, rawQuery = ''] = req.url.split('?');
      const pairs = rawQueryPairs(rawQuery);
      const query = Object.fromEntries(pairs);
      const entry = { method: req.method, path: rawPath, query, headers: req.headers };
      log.push(entry);

      let accessKeyId;
      let scope;
      let signedHeaderNames;
      let signature;
      let amzDate;
      let token;
      let payloadHash;
      let canonicalQuery;
      if (req.headers.authorization) {
        const match = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^,]+), SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(
          req.headers.authorization,
        );
        if (!match) return deny(res, 'AuthorizationHeaderMalformed');
        [, accessKeyId, scope, signedHeaderNames, signature] = match;
        signedHeaderNames = signedHeaderNames.split(';');
        amzDate = req.headers['x-amz-date'];
        token = req.headers['x-amz-security-token'];
        payloadHash = req.headers['x-amz-content-sha256'];
        if (payloadHash !== 'UNSIGNED-PAYLOAD' && payloadHash !== sha256(body)) {
          return deny(res, 'XAmzContentSHA256Mismatch');
        }
        if (token !== undefined && !signedHeaderNames.includes('x-amz-security-token')) {
          return deny(res, 'SecurityTokenNotSigned');
        }
        canonicalQuery = canonicalQueryOf(pairs);
      } else if (query['X-Amz-Signature']) {
        const credential = query['X-Amz-Credential'] || '';
        const slash = credential.indexOf('/');
        accessKeyId = credential.slice(0, slash);
        scope = credential.slice(slash + 1);
        signedHeaderNames = String(query['X-Amz-SignedHeaders'] || '').split(';');
        signature = query['X-Amz-Signature'];
        amzDate = query['X-Amz-Date'];
        token = query['X-Amz-Security-Token'];
        payloadHash = 'UNSIGNED-PAYLOAD';
        const issued = Date.parse(amzDate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
        if (!(issued + Number(query['X-Amz-Expires']) * 1000 > Date.now())) return deny(res, 'AccessDenied: Request has expired');
        canonicalQuery = canonicalQueryOf(pairs.filter(([key]) => key !== 'X-Amz-Signature'));
      } else {
        return deny(res, 'AccessDenied: anonymous');
      }

      const [date, region, service, terminator] = scope.split('/');
      if (region !== REGION || service !== 's3' || terminator !== 'aws4_request') {
        return deny(res, `AuthorizationHeaderMalformed: scope ${scope}`);
      }
      const identity = iam.get(accessKeyId);
      if (!identity) return deny(res, 'InvalidAccessKeyId');
      if (identity.expiresAt <= Date.now()) return deny(res, 'ExpiredToken');
      // Temporary credentials are only valid together with their token.
      if (token !== identity.token) return deny(res, 'InvalidToken');

      const canonicalHeaders = signedHeaderNames
        .map((name) => `${name}:${String(req.headers[name] ?? '').trim().replace(/\s+/g, ' ')}\n`)
        .join('');
      const canonicalRequest = [req.method, rawPath, canonicalQuery, canonicalHeaders, signedHeaderNames.join(';'), payloadHash].join('\n');
      const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
      const expected = crypto
        .createHmac('sha256', deriveKey(identity.secret, date, region, service))
        .update(stringToSign)
        .digest('hex');
      if (expected !== signature) return deny(res, 'SignatureDoesNotMatch');
      entry.accessKeyId = accessKeyId;
      entry.token = token;

      if (req.method === 'PUT') {
        objects.set(rawPath, { body, type: req.headers['content-type'] });
        res.writeHead(200, { 'x-amz-version-id': 'v1', etag: `"${sha256(body)}"` }).end();
        return undefined;
      }
      if (req.method === 'GET') {
        const object = objects.get(rawPath);
        if (!object) return res.writeHead(404).end();
        res.writeHead(200, { 'content-type': object.type }).end(object.body);
        return undefined;
      }
      return res.writeHead(405).end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    log,
    objects,
    endpoint: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

/** The ECS agent: issues temporary credentials and registers them with the fake S3's "IAM". */
const startFakeAgent = async ({ iam }) => {
  const state = { hits: 0, next: null };
  const issue = (key, token, lifetimeMs) => {
    const expiresAt = Date.now() + lifetimeMs;
    iam.set(key, { secret: `secret-${key}`, token, expiresAt });
    state.next = { AccessKeyId: key, SecretAccessKey: `secret-${key}`, Token: token, Expiration: new Date(expiresAt).toISOString() };
  };
  const server = http.createServer((req, res) => {
    state.hits += 1;
    if (req.headers.authorization !== 'agent-token') return res.writeHead(401).end();
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(state.next));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    state,
    issue,
    url: `http://127.0.0.1:${server.address().port}/creds`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

liveDescribe('file storage on S3 with Fargate task-role credentials', () => {
  const saved = {};
  const iam = new Map();
  let s3;
  let agent;
  let server;
  let base;
  let live;
  let project;

  const upload = async (bytes = PNG, name = 'site.png') => {
    const form = new FormData();
    form.append('files', new Blob([bytes], { type: 'image/png' }), name);
    const response = await fetch(`${base}/api/v1/projects/${project.id}/site-reporting/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${live.token}` },
      body: form,
    });
    return { status: response.status, body: await response.json() };
  };

  const downloadLink = async (documentId) => {
    const response = await fetch(`${base}/api/v1/projects/${project.id}/site-reporting/uploads/${documentId}`, {
      headers: { authorization: `Bearer ${live.token}` },
      redirect: 'manual',
    });
    return {
      status: response.status,
      location: response.headers.get('location'),
      body: response.status === 302 ? null : await response.json(),
    };
  };

  beforeAll(async () => {
    for (const name of ENV_KEYS) saved[name] = process.env[name];
    s3 = await startFakeS3({ iam });
    agent = await startFakeAgent({ iam });

    for (const name of ENV_KEYS) delete process.env[name];
    Object.assign(process.env, {
      FILE_STORAGE_S3_BUCKET: BUCKET,
      FILE_STORAGE_S3_REGION: REGION,
      // ECS may inject a different AWS_REGION; the bucket's region must win.
      AWS_REGION: 'eu-west-1',
      FILE_STORAGE_S3_ENDPOINT: s3.endpoint,
      AWS_CONTAINER_CREDENTIALS_FULL_URI: agent.url,
      AWS_CONTAINER_AUTHORIZATION_TOKEN: 'agent-token',
      AWS_EC2_METADATA_DISABLED: 'true',
    });
    _resetAwsCredentialsCache();

    live = await createLiveOrg(prisma);
    project = await prisma.project.create({ data: { orgId: live.org.id, name: 'S3 Fargate live project' } });

    const { createApp } = require('../../app');
    server = http.createServer(createApp());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (live) await dropLiveOrg(prisma, live.org.id);
    for (const name of ENV_KEYS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    _resetAwsCredentialsCache();
    await Promise.all([s3?.close(), agent?.close()]);
    await prisma.$disconnect();
  });

  let documentId;

  it('uploads through the API with the task role: signed PUT, session token, AES256', async () => {
    agent.issue('ASIAFAKE1', 'tok-1', 10 * 60 * 1000);
    const result = await upload();
    expect(result).toMatchObject({ status: 201, body: { success: true } });
    documentId = result.body.data[0].documentId;

    const put = s3.log.find((entry) => entry.method === 'PUT');
    expect(put.denied).toBeUndefined();
    expect(put.accessKeyId).toBe('ASIAFAKE1');
    expect(put.headers['x-amz-security-token']).toBe('tok-1');
    expect(put.headers.authorization).toContain(`ASIAFAKE1/`);
    expect(put.headers.authorization).toContain(`/${REGION}/s3/aws4_request`);
    expect(put.headers['x-amz-server-side-encryption']).toBe('AES256');
    expect(put.path).toMatch(new RegExp(`^/${BUCKET}/orgs/${live.org.id}/projects/${project.id}/site-reporting/`));

    const row = await prisma.projectDocument.findUnique({ where: { id: documentId } });
    expect(row).toMatchObject({ storageProvider: 's3', bucket: BUCKET, storageVersionId: 'v1' });
    expect(agent.state.hits).toBe(1);
  });

  it('answers a download with a 302 to a presigned URL that returns the same bytes', async () => {
    const link = await downloadLink(documentId);
    expect(link.status).toBe(302);
    const location = new URL(link.location);
    expect(location.searchParams.get('X-Amz-Security-Token')).toBe('tok-1');
    expect(location.searchParams.get('X-Amz-Credential')).toMatch(new RegExp(`^ASIAFAKE1/\\d{8}/${REGION}/s3/aws4_request$`));
    expect(location.searchParams.get('X-Amz-Expires')).toBe('300');

    const object = await fetch(link.location);
    expect(object.status).toBe(200);
    expect(Buffer.from(await object.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it('signs a long-lived link with fresh credentials, and clamps the lifetime to an hour', async () => {
    // ASIAFAKE1 has about ten minutes left: enough for a five-minute link,
    // not for an hour-long one. The agent has already rotated.
    agent.issue('ASIAFAKE2', 'tok-2', 2 * 60 * 60 * 1000);
    process.env.FILE_PRESIGNED_URL_TTL_SECONDS = '999999';
    try {
      const link = await downloadLink(documentId);
      expect(link.status).toBe(302);
      const location = new URL(link.location);
      expect(location.searchParams.get('X-Amz-Expires')).toBe('3600');
      expect(location.searchParams.get('X-Amz-Credential')).toMatch(/^ASIAFAKE2\//);
      expect(location.searchParams.get('X-Amz-Security-Token')).toBe('tok-2');
      const object = await fetch(link.location);
      expect(object.status).toBe(200);
      expect(Buffer.from(await object.arrayBuffer()).equals(PNG)).toBe(true);
    } finally {
      delete process.env.FILE_PRESIGNED_URL_TTL_SECONDS;
    }
    expect(agent.state.hits).toBe(2);
  });

  it('answers 503 FILE_STORAGE_UNAVAILABLE, not a raw 500, when S3 refuses the write', async () => {
    // A credential S3 no longer honours (revoked role, wrong token) is a 403 from S3.
    iam.get('ASIAFAKE2').token = 'revoked';
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await upload();
      expect(result.status).toBe(503);
      expect(result.body).toMatchObject({ success: false, error: { code: 'FILE_STORAGE_UNAVAILABLE' } });
      expect(JSON.stringify(result.body)).not.toMatch(/InvalidToken|octapm-live-uploads|orgs\//);
    } finally {
      error.mockRestore();
      iam.get('ASIAFAKE2').token = 'tok-2';
    }
  });

  it('answers 503 FILE_STORAGE_UNAVAILABLE for upload and download when no credentials can be had', async () => {
    await agent.close();
    agent = null;
    _resetAwsCredentialsCache();
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const started = Date.now();
      const result = await upload();
      expect(result.status).toBe(503);
      expect(result.body).toMatchObject({ success: false, error: { code: 'FILE_STORAGE_UNAVAILABLE' } });
      expect(Date.now() - started).toBeLessThan(5000);

      const link = await downloadLink(documentId);
      expect(link.status).toBe(503);
      expect(link.body).toMatchObject({ success: false, error: { code: 'FILE_STORAGE_UNAVAILABLE' } });
    } finally {
      error.mockRestore();
    }
  });
});
