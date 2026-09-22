/**
 * AWS Signature Version 4, hand-rolled.
 *
 * The backend deliberately carries no AWS SDK: S3 and SES are the only AWS
 * services it calls, and the SDK would add dozens of packages to the image for
 * two requests. The price is that the signer has to be right, so it is pure —
 * credentials and the clock are passed in — and is pinned to AWS's published
 * test vectors (utils/__tests__/aws-sigv4.vectors.test.js).
 *
 * This code moved here from file-storage.service.js so SES can share it. What
 * changed on the way: the service is a parameter (it was hard-coded to 's3'),
 * a query string can be signed (it was always empty), and the payload hash is a
 * parameter (S3 sends UNSIGNED-PAYLOAD; SES does not accept that and signs the
 * SHA-256 of the body).
 */
const crypto = require('crypto');

const ALGORITHM = 'AWS4-HMAC-SHA256';
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

/**
 * RFC 3986 encoding, which SigV4 requires: encodeURIComponent leaves
 * ! ' ( ) * alone, and AWS would compute a different signature for a key
 * that contains one of them.
 */
const encodeRfc3986 = (value) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** A path as it goes on the wire: each segment encoded once, slashes kept. */
const encodePath = (rawPath) =>
  `/${String(rawPath || '').replace(/^\/+/, '').split('/').map(encodeRfc3986).join('/')}`;

/**
 * The path as it goes into the canonical request. S3 signs the wire path;
 * every other service signs it encoded a second time. The SES v2 path
 * (/v2/email/outbound-emails) has nothing that encodes, so for SES the two are
 * identical — but a future caller with a reserved character gets AWS's rule.
 */
const canonicalPath = (rawPath, service) => {
  const once = encodePath(rawPath);
  if (service === 's3') return once;
  return once.split('/').map(encodeRfc3986).join('/');
};

const sha256Hex = (value) =>
  crypto.createHash('sha256').update(value, typeof value === 'string' ? 'utf8' : undefined).digest('hex');

const hmac = (key, value, encoding) =>
  crypto.createHmac('sha256', key).update(value, 'utf8').digest(encoding);

const awsDate = (date = new Date()) =>
  date.toISOString().replace(/[:-]|\.\d{3}/g, '');

const awsDateStamp = (date = new Date()) =>
  date.toISOString().slice(0, 10).replace(/-/g, '');

const normalizeHeaderValue = (value) =>
  String(value).trim().replace(/\s+/g, ' ');

const buildCanonicalHeaders = (headers) => {
  const entries = Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), normalizeHeaderValue(value)])
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return {
    canonicalHeaders: `${entries.map(([key, value]) => `${key}:${value}`).join('\n')}\n`,
    signedHeaders: entries.map(([key]) => key).join(';'),
  };
};

/** Query parameters sorted by encoded name, then value, as SigV4 specifies. */
const canonicalQueryString = (query = {}) =>
  Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(String(value))])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0,
    )
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

const signingKey = ({ secretAccessKey, dateStamp, region, service }) => {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, 'aws4_request');
};

const requireSigningInput = ({ service, region, credentials }) => {
  if (!service) throw new Error('SigV4 signing needs a service name');
  if (!region) throw new Error('SigV4 signing needs a region');
  if (!credentials?.accessKeyId || !credentials?.secretAccessKey) {
    throw new Error('SigV4 signing needs credentials');
  }
};

const signature = ({ credentials, dateStamp, region, service, amzDate, scope, canonicalRequest }) =>
  hmac(
    signingKey({ secretAccessKey: credentials.secretAccessKey, dateStamp, region, service }),
    [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n'),
    'hex',
  );

/**
 * Signs a request in the Authorization header.
 *
 * Returns every header that was signed — host, x-amz-date, the session token
 * when the credentials are temporary (a task role's always are), and
 * x-amz-content-sha256 unless `contentSha256Header` is false — plus
 * Authorization. The caller sends them all; `path` is the raw, unencoded path
 * and `encodePath(path)` is what goes on the wire.
 */
const signHeaders = ({
  method,
  host,
  path: rawPath = '/',
  query = {},
  headers = {},
  payloadHash,
  service,
  region,
  credentials,
  now = new Date(),
  contentSha256Header = true,
}) => {
  requireSigningInput({ service, region, credentials });
  if (!payloadHash) throw new Error('SigV4 signing needs a payload hash');
  const amzDate = awsDate(now);
  const dateStamp = awsDateStamp(now);
  const signingHeaders = { ...headers, host };
  if (contentSha256Header) signingHeaders['x-amz-content-sha256'] = payloadHash;
  signingHeaders['x-amz-date'] = amzDate;
  if (credentials.sessionToken) {
    signingHeaders['x-amz-security-token'] = credentials.sessionToken;
  }

  const { canonicalHeaders, signedHeaders } = buildCanonicalHeaders(signingHeaders);
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalPath(rawPath, service),
    canonicalQueryString(query),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const signed = signature({ credentials, dateStamp, region, service, amzDate, scope, canonicalRequest });

  return {
    ...signingHeaders,
    Authorization: `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signed}`,
  };
};

/**
 * A presigned GET URL: the signature travels in the query string and only
 * `host` is signed. A session token goes into the canonical query *before*
 * signing — S3 rejects a URL whose token was appended afterwards.
 */
const presignUrl = ({
  protocol = 'https:',
  host,
  path: rawPath,
  method = 'GET',
  service,
  region,
  credentials,
  expiresSeconds,
  now = new Date(),
  query: extraQuery = {},
}) => {
  requireSigningInput({ service, region, credentials });
  const amzDate = awsDate(now);
  const dateStamp = awsDateStamp(now);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const query = {
    ...extraQuery,
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${credentials.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  if (credentials.sessionToken) {
    query['X-Amz-Security-Token'] = credentials.sessionToken;
  }
  const canonicalQuery = canonicalQueryString(query);
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalPath(rawPath, service),
    canonicalQuery,
    `host:${host}\n`,
    'host',
    service === 's3' ? UNSIGNED_PAYLOAD : sha256Hex(''),
  ].join('\n');
  const signed = signature({ credentials, dateStamp, region, service, amzDate, scope, canonicalRequest });
  const scheme = String(protocol).replace(/:?$/, ':');
  return `${scheme}//${host}${encodePath(rawPath)}?${canonicalQuery}&X-Amz-Signature=${signed}`;
};

module.exports = {
  ALGORITHM,
  UNSIGNED_PAYLOAD,
  awsDate,
  awsDateStamp,
  buildCanonicalHeaders,
  canonicalPath,
  canonicalQueryString,
  encodePath,
  encodeRfc3986,
  hmac,
  presignUrl,
  sha256Hex,
  signHeaders,
  signingKey,
};
