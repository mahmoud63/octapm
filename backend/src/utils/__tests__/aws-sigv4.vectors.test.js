/**
 * The hand-rolled SigV4 signer against AWS's own published answers. If any of
 * these moves, S3 uploads, download links and SES sends all fail in AWS with
 * SignatureDoesNotMatch — and nothing local would notice.
 *
 * Sources, copied verbatim:
 *  - S3 examples (Amazon S3 API Reference, "Signature Calculations for the
 *    Authorization Header" and "Authenticating Requests: Using Query
 *    Parameters"): access key AKIAIOSFODNN7EXAMPLE, secret
 *    wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY, 20130524T000000Z, us-east-1,
 *    bucket examplebucket, object test.txt.
 *      GET Object (Range: bytes=0-9)  f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41
 *      presigned GET, 86400 s          aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404
 *  - The AWS SigV4 test suite (awslabs/aws-c-auth,
 *    tests/aws-signing-test-suite/v4/<case>/context.json and
 *    header-signed-request.txt): AKIDEXAMPLE /
 *    wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY, 2015-08-30T12:36:00Z,
 *    us-east-1, service "service", host example.amazonaws.com.
 *      get-vanilla                        5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31
 *      get-vanilla-query-order-key-case   b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500
 *      get-vanilla-with-session-token     07ec1639c89043aa0e3e2de82b96708f198cceab042d4a97044c66dd9f74e7f8
 */
const {
  canonicalPath,
  encodeRfc3986,
  presignUrl,
  sha256Hex,
  signHeaders,
} = require('../aws-sigv4');

const S3_EXAMPLE = {
  credentials: {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  },
  now: new Date('2013-05-24T00:00:00Z'),
  region: 'us-east-1',
  host: 'examplebucket.s3.amazonaws.com',
};

const SUITE = {
  credentials: {
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  },
  now: new Date('2015-08-30T12:36:00Z'),
  region: 'us-east-1',
  service: 'service',
  host: 'example.amazonaws.com',
};

const signatureOf = (authorization) => /Signature=([0-9a-f]{64})$/.exec(authorization)[1];

describe('SigV4 against AWS published vectors', () => {
  it('signs the S3 "GET Object" header example exactly', () => {
    const headers = signHeaders({
      method: 'GET',
      host: S3_EXAMPLE.host,
      path: '/test.txt',
      // Deliberately not in sorted order: the signer must sort.
      headers: { Range: 'bytes=0-9' },
      payloadHash: sha256Hex(''),
      service: 's3',
      region: S3_EXAMPLE.region,
      credentials: S3_EXAMPLE.credentials,
      now: S3_EXAMPLE.now,
    });
    expect(headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
    expect(headers['x-amz-content-sha256']).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('presigns the S3 query-string example exactly', () => {
    const url = presignUrl({
      host: S3_EXAMPLE.host,
      path: '/test.txt',
      service: 's3',
      region: S3_EXAMPLE.region,
      credentials: S3_EXAMPLE.credentials,
      expiresSeconds: 86400,
      now: S3_EXAMPLE.now,
    });
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('signs for the service it is given (suite: get-vanilla)', () => {
    const headers = signHeaders({
      method: 'GET',
      host: SUITE.host,
      path: '/',
      payloadHash: sha256Hex(''),
      service: SUITE.service,
      region: SUITE.region,
      credentials: SUITE.credentials,
      now: SUITE.now,
      contentSha256Header: false,
    });
    expect(headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  it('sorts the query string (suite: get-vanilla-query-order-key-case)', () => {
    const headers = signHeaders({
      method: 'GET',
      host: SUITE.host,
      path: '/',
      query: { Param2: 'value2', Param1: 'value1' },
      payloadHash: sha256Hex(''),
      service: SUITE.service,
      region: SUITE.region,
      credentials: SUITE.credentials,
      now: SUITE.now,
      contentSha256Header: false,
    });
    expect(signatureOf(headers.Authorization)).toBe(
      'b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500',
    );
  });

  it('signs the session token as a header (suite: get-vanilla-with-session-token)', () => {
    const token = '6e86291e8372ff2a2260956d9b8aae1d763fbf315fa00fa31553b73ebf194267';
    const headers = signHeaders({
      method: 'GET',
      host: SUITE.host,
      path: '/',
      payloadHash: sha256Hex(''),
      service: SUITE.service,
      region: SUITE.region,
      credentials: { ...SUITE.credentials, sessionToken: token },
      now: SUITE.now,
      contentSha256Header: false,
    });
    expect(headers['x-amz-security-token']).toBe(token);
    expect(headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date;x-amz-security-token, ' +
        'Signature=07ec1639c89043aa0e3e2de82b96708f198cceab042d4a97044c66dd9f74e7f8',
    );
  });
});

describe('SigV4 rules the vectors do not reach', () => {
  it('puts a presign session token inside the signed query, so the token changes the signature', () => {
    const base = {
      host: S3_EXAMPLE.host,
      path: '/test.txt',
      service: 's3',
      region: S3_EXAMPLE.region,
      expiresSeconds: 300,
      now: S3_EXAMPLE.now,
    };
    const one = presignUrl({ ...base, credentials: { ...S3_EXAMPLE.credentials, sessionToken: 'tok-1' } });
    const two = presignUrl({ ...base, credentials: { ...S3_EXAMPLE.credentials, sessionToken: 'tok-2' } });
    const without = presignUrl({ ...base, credentials: S3_EXAMPLE.credentials });

    expect(one).toContain('X-Amz-Security-Token=tok-1');
    // The token sits before the signature, never appended after it.
    expect(one.indexOf('X-Amz-Security-Token')).toBeLessThan(one.indexOf('X-Amz-Signature'));
    const sig = (url) => new URL(url).searchParams.get('X-Amz-Signature');
    expect(new Set([sig(one), sig(two), sig(without)]).size).toBe(3);
  });

  it('encodes a key with RFC 3986, which escapes the characters encodeURIComponent leaves alone', () => {
    // S3: "URI-encode every byte except the unreserved characters A-Z a-z 0-9 - . _ ~".
    expect(encodeRfc3986("site (1)!*'.jpg")).toBe('site%20%281%29%21%2A%27.jpg');
    expect(canonicalPath("orgs/a b/site (1)*.jpg", 's3')).toBe('/orgs/a%20b/site%20%281%29%2A.jpg');
  });

  it('encodes the path twice for every service but S3', () => {
    expect(canonicalPath('/a b', 's3')).toBe('/a%20b');
    expect(canonicalPath('/a b', 'ses')).toBe('/a%2520b');
    expect(canonicalPath('/v2/email/outbound-emails', 'ses')).toBe('/v2/email/outbound-emails');
  });
});
