/**
 * Where the backend's AWS credentials come from.
 *
 * The chain, first match wins:
 *   1. AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (+ AWS_SESSION_TOKEN) — a
 *      developer testing against a real bucket. Production refuses these.
 *   2. The container credentials endpoint — what ECS/Fargate gives a task
 *      with a task role. AWS_CONTAINER_CREDENTIALS_RELATIVE_URI is a path on
 *      169.254.170.2; AWS_CONTAINER_CREDENTIALS_FULL_URI is a whole URL, only
 *      accepted on loopback or the two link-local container hosts, with an
 *      Authorization token from AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE or
 *      AWS_CONTAINER_AUTHORIZATION_TOKEN.
 *   3. EC2 IMDSv2 — skipped when AWS_EC2_METADATA_DISABLED=true.
 *   4. Nothing: an Error with code AWS_CREDENTIALS_UNAVAILABLE.
 *
 * Before this, the chain was env keys then IMDS only. Fargate has no IMDS, so
 * once the static keys were gone every upload and every download link failed
 * after a one-second wait.
 *
 * Temporary credentials are cached per process. Concurrent callers share one
 * fetch; a caller that will sign something long-lived (a presigned URL) asks
 * for credentials that stay valid at least that long; and if a refresh fails
 * while the cached credentials are still valid, those are used rather than
 * failing a request that would have worked.
 */
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const { URL } = require('url');
const { encodeRfc3986 } = require('./aws-sigv4');

const CONTAINER_HOST = '169.254.170.2';
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const CONTAINER_TIMEOUT_MS = 1000;
const IMDS_TIMEOUT_MS = 1000;

/** Hosts a FULL_URI may name: loopback and the ECS / EKS link-local agents. */
const ALLOWED_FULL_URI_HOSTS = new Set([
  CONTAINER_HOST,
  '169.254.170.23',
  'fd00:ec2::23',
  'localhost',
]);

const unavailable = (message, cause) => {
  const error = new Error(message);
  error.code = 'AWS_CREDENTIALS_UNAVAILABLE';
  if (cause) error.cause = cause;
  return error;
};

const httpRequest = ({ method = 'GET', url, headers = {}, body = null, timeout = 3000 }) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const req = transport.request(
      target,
      { method, headers, timeout },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const payload = Buffer.concat(chunks);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, headers: res.headers, body: payload });
            return;
          }
          const error = new Error(
            `HTTP ${res.statusCode || 0} from ${target.hostname}: ${payload
              .toString('utf8')
              .slice(0, 300)}`,
          );
          error.statusCode = res.statusCode;
          reject(error);
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`Request timed out: ${target.origin}${target.pathname}`)));
    req.on('error', reject);
    if (body) body.pipe ? body.pipe(req) : req.end(body);
    else req.end();
  });

const trimOrNull = (value) => {
  const text = String(value ?? '').trim();
  return text || null;
};

const isLoopback = (hostname) => {
  if (hostname === 'localhost' || hostname === '::1') return true;
  return net.isIPv4(hostname) && hostname.startsWith('127.');
};

/**
 * The container endpoint for this environment, or null when none is
 * configured. Pure apart from reading the token file, and exported so the
 * allow-list can be tested without a network.
 *
 * @returns {{ url: string, authorization: string|null } | null}
 */
const resolveContainerCredentialsUrl = (env = process.env) => {
  const relative = trimOrNull(env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI);
  const full = trimOrNull(env.AWS_CONTAINER_CREDENTIALS_FULL_URI);
  let url;
  if (relative) {
    url = `http://${CONTAINER_HOST}${relative.startsWith('/') ? '' : '/'}${relative}`;
  } else if (full) {
    let parsed;
    try {
      parsed = new URL(full);
    } catch {
      throw unavailable('AWS_CONTAINER_CREDENTIALS_FULL_URI is not a valid URL');
    }
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw unavailable('AWS_CONTAINER_CREDENTIALS_FULL_URI must be http or https');
    }
    // The endpoint is handed an authorization token and trusted for keys, so
    // it must be on this host or the container agent — never a name that DNS
    // could point anywhere.
    if (!isLoopback(hostname) && !ALLOWED_FULL_URI_HOSTS.has(hostname)) {
      throw unavailable(
        `AWS_CONTAINER_CREDENTIALS_FULL_URI host ${hostname} is not loopback or a container credentials host`,
      );
    }
    url = parsed.toString();
  } else {
    return null;
  }

  // The file wins over the variable: on EKS the file is rotated underneath a
  // running process, so it is read on every fetch.
  let authorization = null;
  const tokenFile = trimOrNull(env.AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE);
  if (tokenFile) {
    try {
      authorization = trimOrNull(fs.readFileSync(tokenFile, 'utf8'));
    } catch (error) {
      throw unavailable(`AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE could not be read: ${error.message}`);
    }
  } else {
    authorization = trimOrNull(env.AWS_CONTAINER_AUTHORIZATION_TOKEN);
  }
  if (authorization && /[\r\n]/.test(authorization)) {
    throw unavailable('The container authorization token contains a line break');
  }
  return { url, authorization };
};

const parseCredentialsBody = (raw, source) => {
  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Error(`${source} did not return JSON`);
  }
  if (!body.AccessKeyId || !body.SecretAccessKey) {
    throw new Error(`${source} returned no AccessKeyId/SecretAccessKey`);
  }
  const expiration = body.Expiration ? new Date(body.Expiration).getTime() : 0;
  return {
    accessKeyId: body.AccessKeyId,
    secretAccessKey: body.SecretAccessKey,
    sessionToken: body.Token || null,
    expiration: Number.isFinite(expiration) ? expiration : 0,
    source,
  };
};

const getContainerCredentials = async (endpoint) => {
  const headers = endpoint.authorization ? { Authorization: endpoint.authorization } : {};
  let lastError;
  // One retry: the agent occasionally drops the first connection of a task.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await httpRequest({ url: endpoint.url, headers, timeout: CONTAINER_TIMEOUT_MS });
      return parseCredentialsBody(response.body, 'container');
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

const getInstanceProfileCredentials = async () => {
  const tokenResponse = await httpRequest({
    method: 'PUT',
    url: 'http://169.254.169.254/latest/api/token',
    headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '21600' },
    timeout: IMDS_TIMEOUT_MS,
  });
  const token = tokenResponse.body.toString('utf8');
  const roleResponse = await httpRequest({
    url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    headers: { 'X-aws-ec2-metadata-token': token },
    timeout: IMDS_TIMEOUT_MS,
  });
  const roleName = roleResponse.body.toString('utf8').split('\n')[0].trim();
  if (!roleName) throw new Error('No EC2 instance profile role found');

  const credentialsResponse = await httpRequest({
    url: `http://169.254.169.254/latest/meta-data/iam/security-credentials/${encodeRfc3986(roleName)}`,
    headers: { 'X-aws-ec2-metadata-token': token },
    timeout: IMDS_TIMEOUT_MS,
  });
  return parseCredentialsBody(credentialsResponse.body, 'imds');
};

const envCredentials = (env = process.env) => {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) return null;
  return {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN || null,
    expiration: 0,
    source: 'env',
  };
};

const fetchTemporaryCredentials = async () => {
  const endpoint = resolveContainerCredentialsUrl();
  if (endpoint) {
    try {
      return await getContainerCredentials(endpoint);
    } catch (error) {
      // A task that was given a container endpoint is on ECS: falling through
      // to IMDS would only add a second timeout to the same failure.
      throw unavailable(`Container credentials endpoint failed: ${error.message}`, error);
    }
  }
  if (String(process.env.AWS_EC2_METADATA_DISABLED || '').toLowerCase() === 'true') {
    throw unavailable('No AWS credentials: no env keys, no container endpoint, and IMDS is disabled');
  }
  try {
    return await getInstanceProfileCredentials();
  } catch (error) {
    throw unavailable(`No AWS credentials: no env keys, no container endpoint, IMDS failed (${error.message})`, error);
  }
};

let cached = null;
let inflight = null;

const hasValidityFor = (credentials, marginMs, now = Date.now()) =>
  Boolean(credentials) && (!credentials.expiration || credentials.expiration - now > marginMs);

/**
 * Credentials that stay valid for at least `minValidityMs` (never less than
 * five minutes). A presigner passes its URL lifetime plus a minute, so no URL
 * it hands out can outlive the credentials that signed it.
 */
const getAwsCredentials = async ({ minValidityMs = 0 } = {}) => {
  // Env keys are read every call: they are free to read, never expire, and a
  // cache would hide a change made while the process runs.
  const fromEnv = envCredentials();
  if (fromEnv) return fromEnv;

  const marginMs = Math.max(REFRESH_MARGIN_MS, Number(minValidityMs) || 0);
  if (hasValidityFor(cached, marginMs)) return cached;

  if (!inflight) {
    inflight = fetchTemporaryCredentials()
      .then((credentials) => {
        cached = credentials;
        return credentials;
      })
      .finally(() => {
        inflight = null;
      });
  }

  try {
    return await inflight;
  } catch (error) {
    // Stale but still valid beats failing: the refresh is retried on the next
    // call, and the request in hand still signs with keys AWS will accept.
    if (hasValidityFor(cached, 0)) {
      console.warn(`[aws-credentials] refresh failed, using cached credentials until they expire: ${error.message}`);
      return cached;
    }
    throw error.code === 'AWS_CREDENTIALS_UNAVAILABLE' ? error : unavailable(error.message, error);
  }
};

/** Tests only: forget cached credentials and any fetch in flight. */
const _resetAwsCredentialsCache = () => {
  cached = null;
  inflight = null;
};

module.exports = {
  ALLOWED_FULL_URI_HOSTS,
  getAwsCredentials,
  httpRequest,
  resolveContainerCredentialsUrl,
  _resetAwsCredentialsCache,
};
