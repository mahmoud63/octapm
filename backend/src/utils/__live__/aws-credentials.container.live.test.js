/**
 * The credential chain against a fake ECS container-credentials endpoint on
 * 127.0.0.1 — the source Fargate actually gives a task role. Before this the
 * chain was env keys then EC2 IMDS, so on Fargate it found nothing.
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { liveDescribe } = require('../../__live__/helpers');
const {
  getAwsCredentials,
  resolveContainerCredentialsUrl,
  _resetAwsCredentialsCache,
} = require('../aws-credentials');

const AWS_ENV = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
  'AWS_EC2_METADATA_DISABLED',
];

/** A container credentials agent: counts hits, checks the token, answers what the test says. */
const startFakeAgent = async () => {
  const state = {
    hits: 0,
    authorizations: [],
    requiredAuthorization: 'secret-token',
    status: 200,
    delayMs: 0,
    hang: false,
    credentials: null,
  };
  const server = http.createServer((req, res) => {
    state.hits += 1;
    state.authorizations.push(req.headers.authorization || null);
    const answer = () => {
      if (req.url !== '/creds') {
        res.writeHead(404).end();
      } else if (state.requiredAuthorization && req.headers.authorization !== state.requiredAuthorization) {
        res.writeHead(401).end('{"message":"unauthorized"}');
      } else if (state.status !== 200) {
        res.writeHead(state.status).end('{"message":"agent failure"}');
      } else {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(state.credentials));
      }
    };
    // A hung agent accepts the connection and never answers; the client's
    // timeout is what ends the request.
    if (state.hang) return;
    if (state.delayMs) setTimeout(answer, state.delayMs);
    else answer();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    state,
    url: `http://127.0.0.1:${port}/creds`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

const issue = (key, token, lifetimeMs) => ({
  AccessKeyId: key,
  SecretAccessKey: `secret-for-${key}`,
  Token: token,
  Expiration: new Date(Date.now() + lifetimeMs).toISOString(),
});

liveDescribe('AWS credentials from the container endpoint', () => {
  const saved = {};
  let agent;
  let tokenDir;

  beforeAll(async () => {
    for (const name of AWS_ENV) saved[name] = process.env[name];
    agent = await startFakeAgent();
    tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octapm-aws-token-'));
  });

  afterAll(async () => {
    for (const name of AWS_ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    _resetAwsCredentialsCache();
    await agent.close();
    fs.rmSync(tokenDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    for (const name of AWS_ENV) delete process.env[name];
    process.env.AWS_EC2_METADATA_DISABLED = 'true';
    process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI = agent.url;
    const tokenFile = path.join(tokenDir, 'token');
    fs.writeFileSync(tokenFile, 'secret-token\n');
    process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE = tokenFile;
    // The variable is wrong on purpose: the file must win.
    process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN = 'wrong-token';
    agent.state.hits = 0;
    agent.state.authorizations = [];
    agent.state.status = 200;
    agent.state.delayMs = 0;
    agent.state.hang = false;
    agent.state.credentials = issue('ASIAFAKE1', 'tok-1', 60 * 60 * 1000);
    _resetAwsCredentialsCache();
  });

  it('fetches task-role credentials with the token file as Authorization, trimmed', async () => {
    const credentials = await getAwsCredentials();
    expect(credentials).toMatchObject({
      accessKeyId: 'ASIAFAKE1',
      secretAccessKey: 'secret-for-ASIAFAKE1',
      sessionToken: 'tok-1',
      source: 'container',
    });
    expect(agent.state.authorizations).toEqual(['secret-token']);
  });

  it('serves five concurrent callers from one fetch, then from cache', async () => {
    agent.state.delayMs = 150;
    const results = await Promise.all(Array.from({ length: 5 }, () => getAwsCredentials()));
    expect(new Set(results.map((row) => row.sessionToken))).toEqual(new Set(['tok-1']));
    expect(agent.state.hits).toBe(1);

    await getAwsCredentials();
    expect(agent.state.hits).toBe(1);
  });

  it('refetches inside the five-minute margin, and when a caller needs longer validity', async () => {
    agent.state.credentials = issue('ASIAFAKE1', 'tok-1', 4 * 60 * 1000);
    await getAwsCredentials();
    agent.state.credentials = issue('ASIAFAKE2', 'tok-2', 20 * 60 * 1000);
    const refreshed = await getAwsCredentials();
    expect(agent.state.hits).toBe(2);
    expect(refreshed.accessKeyId).toBe('ASIAFAKE2');

    // Twenty minutes left is plenty for a normal call...
    await getAwsCredentials();
    expect(agent.state.hits).toBe(2);
    // ...but not for a presigned URL that lives an hour.
    agent.state.credentials = issue('ASIAFAKE3', 'tok-3', 2 * 60 * 60 * 1000);
    const forPresign = await getAwsCredentials({ minValidityMs: (3600 + 60) * 1000 });
    expect(agent.state.hits).toBe(3);
    expect(forPresign.accessKeyId).toBe('ASIAFAKE3');
  });

  it('keeps using still-valid cached credentials when a refresh fails', async () => {
    agent.state.credentials = issue('ASIAFAKE1', 'tok-1', 4 * 60 * 1000);
    await getAwsCredentials();
    agent.state.status = 500;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const stale = await getAwsCredentials();
      expect(stale.accessKeyId).toBe('ASIAFAKE1');
      expect(agent.state.hits).toBeGreaterThan(1);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('does not wait on a hung agent again while the cached keys still work', async () => {
    agent.state.credentials = issue('ASIAFAKE1', 'tok-1', 4 * 60 * 1000);
    await getAwsCredentials();
    agent.state.hang = true;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // The first call after the agent hangs pays the timeouts once...
      const first = await getAwsCredentials();
      expect(first.accessKeyId).toBe('ASIAFAKE1');
      const hitsAfterFailure = agent.state.hits;

      // ...and the calls after it are answered from the cache at once.
      for (let call = 0; call < 3; call += 1) {
        const started = Date.now();
        const again = await getAwsCredentials();
        expect(Date.now() - started).toBeLessThan(50);
        expect(again.accessKeyId).toBe('ASIAFAKE1');
      }
      expect(agent.state.hits).toBe(hitsAfterFailure);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('asks the agent again once the back-off ends, never later than the last minute of the keys', async () => {
    // 62 s of life leaves a two-second back-off before the final minute.
    agent.state.credentials = issue('ASIAFAKE1', 'tok-1', 62 * 1000);
    await getAwsCredentials();
    agent.state.status = 500;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect((await getAwsCredentials()).accessKeyId).toBe('ASIAFAKE1');
      const hitsAfterFailure = agent.state.hits;
      expect((await getAwsCredentials()).accessKeyId).toBe('ASIAFAKE1');
      expect(agent.state.hits).toBe(hitsAfterFailure);

      await new Promise((resolve) => setTimeout(resolve, 2200));
      agent.state.status = 200;
      agent.state.credentials = issue('ASIAFAKE2', 'tok-2', 60 * 60 * 1000);
      expect((await getAwsCredentials()).accessKeyId).toBe('ASIAFAKE2');
      expect(agent.state.hits).toBe(hitsAfterFailure + 1);
    } finally {
      warn.mockRestore();
    }
  });

  it('fails with AWS_CREDENTIALS_UNAVAILABLE, quickly, when nothing can supply credentials', async () => {
    agent.state.status = 500;
    const started = Date.now();
    await expect(getAwsCredentials()).rejects.toMatchObject({ code: 'AWS_CREDENTIALS_UNAVAILABLE' });
    expect(Date.now() - started).toBeLessThan(3000);

    delete process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
    _resetAwsCredentialsCache();
    await expect(getAwsCredentials()).rejects.toMatchObject({ code: 'AWS_CREDENTIALS_UNAVAILABLE' });
  });

  it('rejects a request without the token: the header really is sent', async () => {
    delete process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE;
    delete process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN;
    await expect(getAwsCredentials()).rejects.toMatchObject({ code: 'AWS_CREDENTIALS_UNAVAILABLE' });
    process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN = 'secret-token';
    await expect(getAwsCredentials()).resolves.toMatchObject({ accessKeyId: 'ASIAFAKE1' });
  });

  it('lets env keys win, without ever calling the endpoint', async () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIALOCAL';
    process.env.AWS_SECRET_ACCESS_KEY = 'local-secret';
    const credentials = await getAwsCredentials();
    expect(credentials).toMatchObject({ accessKeyId: 'AKIALOCAL', sessionToken: null, source: 'env' });
    expect(agent.state.hits).toBe(0);
  });

  it('resolves RELATIVE_URI to the ECS agent and holds FULL_URI to the allow-list', () => {
    expect(resolveContainerCredentialsUrl({ AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/abc' })).toEqual({
      url: 'http://169.254.170.2/v2/credentials/abc',
      authorization: null,
    });
    expect(resolveContainerCredentialsUrl({})).toBeNull();
    for (const allowed of [
      'http://127.0.0.1:9000/creds',
      'http://localhost/creds',
      'http://[::1]/creds',
      'http://169.254.170.23/v1/credentials',
      'https://169.254.170.2/creds',
    ]) {
      expect(resolveContainerCredentialsUrl({ AWS_CONTAINER_CREDENTIALS_FULL_URI: allowed })).toMatchObject({ url: expect.any(String) });
    }
    for (const refused of ['http://example.com/creds', 'https://169.254.169.254/creds', 'file:///etc/passwd']) {
      expect(() => resolveContainerCredentialsUrl({ AWS_CONTAINER_CREDENTIALS_FULL_URI: refused })).toThrow(
        expect.objectContaining({ code: 'AWS_CREDENTIALS_UNAVAILABLE' }),
      );
    }
  });
});
