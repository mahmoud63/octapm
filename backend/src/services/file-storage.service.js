const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { URL } = require('url');
const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');

const EICAR_SIGNATURE = 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE';
const DEFAULT_REGION = 'us-east-2';
const PRESIGNED_DOWNLOAD_EXPIRES_SECONDS = 5 * 60;

const DOCUMENT_TYPES = Object.freeze({
  SITE_PHOTO: 'site_photo',
  WORKFLOW_ATTACHMENT: 'workflow_attachment',
  BOQ_UPLOAD: 'boq_upload',
  SCHEDULE_IMPORT: 'schedule_import',
  SCHEDULE_GENERATION_SOURCE: 'schedule_generation_source',
  PROGRESS_IMPORT: 'progress_import',
  DRAWING_SET: 'drawing_set',
});

const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const ALLOWED_BOQ_MIME = new Set([
  'application/octet-stream',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const ALLOWED_WORKFLOW_MIME = new Set([
  ...ALLOWED_IMAGE_MIME,
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
]);

const MIME_EXTENSIONS = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/heic': ['.heic'],
  'image/heif': ['.heif'],
  'application/pdf': ['.pdf'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    '.docx',
  ],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    '.xlsx',
  ],
  'text/csv': ['.csv'],
  'text/plain': ['.txt'],
  'application/xml': ['.xml'],
  'text/xml': ['.xml'],
};

const EXT_TO_MIME = Object.entries(MIME_EXTENSIONS).reduce(
  (memo, [mimeType, extensions]) => {
    extensions.forEach((extension) => {
      memo[extension] = mimeType;
    });
    return memo;
  },
  {},
);

const DOCUMENT_POLICIES = {
  [DOCUMENT_TYPES.SITE_PHOTO]: {
    allowedMime: ALLOWED_IMAGE_MIME,
    maxBytes: 8 * 1024 * 1024,
    prefix: 'site-reporting',
    retentionEnv: 'SITE_REPORTING_UPLOAD_RETENTION_DAYS',
    defaultRetentionDays: 365,
    unsupportedCode: 'UNSUPPORTED_SITE_PHOTO',
    unsupportedMessage: 'Only JPEG, PNG, WebP, HEIC, and HEIF photos are allowed',
  },
  [DOCUMENT_TYPES.WORKFLOW_ATTACHMENT]: {
    allowedMime: ALLOWED_WORKFLOW_MIME,
    maxBytes: 25 * 1024 * 1024,
    prefix: 'workflow',
    retentionEnv: 'WORKFLOW_UPLOAD_RETENTION_DAYS',
    defaultRetentionDays: 3650,
    unsupportedCode: 'UNSUPPORTED_WORKFLOW_ATTACHMENT',
    unsupportedMessage:
      'Only images, PDF, Word, Excel, CSV, and text files are allowed',
  },
  [DOCUMENT_TYPES.DRAWING_SET]: {
    allowedMime: new Set(['application/pdf', 'application/x-pdf', 'application/octet-stream']),
    allowedExtensions: ['.pdf'],
    maxBytes: 250 * 1024 * 1024,
    prefix: 'drawings',
    retentionEnv: 'DRAWING_UPLOAD_RETENTION_DAYS',
    defaultRetentionDays: 3650,
    unsupportedCode: 'UNSUPPORTED_DRAWING_FILE',
    unsupportedMessage: 'Drawing sets must be PDF files',
  },
  [DOCUMENT_TYPES.BOQ_UPLOAD]: {
    allowedMime: ALLOWED_BOQ_MIME,
    allowedExtensions: ['.xlsx', '.xls'],
    maxBytes: 50 * 1024 * 1024,
    prefix: 'boq',
    retentionEnv: 'BOQ_UPLOAD_RETENTION_DAYS',
    defaultRetentionDays: 3650,
    unsupportedCode: 'UNSUPPORTED_FORMAT',
    unsupportedMessage: 'Only .xlsx and .xls files are allowed',
  },
  [DOCUMENT_TYPES.SCHEDULE_IMPORT]: {
    allowedMime: new Set([
      'application/octet-stream',
      'text/plain',
      'application/xml',
      'text/xml',
    ]),
    allowedExtensions: ['.xer', '.xml'],
    maxBytes: 50 * 1024 * 1024,
    prefix: 'schedule-imports',
    retentionEnv: 'SCHEDULE_IMPORT_RETENTION_DAYS',
    defaultRetentionDays: 3650,
    unsupportedCode: 'UNSUPPORTED_FORMAT',
    unsupportedMessage: 'Allowed formats: .xer, .xml',
  },
  [DOCUMENT_TYPES.SCHEDULE_GENERATION_SOURCE]: {
    allowedMime: new Set([
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream',
      'text/csv',
    ]),
    allowedExtensions: ['.xlsx', '.xls', '.csv'],
    maxBytes: 50 * 1024 * 1024,
    prefix: 'schedule-generation',
    retentionEnv: 'SCHEDULE_GENERATION_UPLOAD_RETENTION_DAYS',
    defaultRetentionDays: 3650,
    unsupportedCode: 'UNSUPPORTED_FORMAT',
    unsupportedMessage: 'Supported formats: .xlsx, .xls, .csv',
  },
  [DOCUMENT_TYPES.PROGRESS_IMPORT]: {
    allowedMime: new Set([
      'application/octet-stream',
      'text/plain',
      'application/xml',
      'text/xml',
    ]),
    allowedExtensions: ['.xer', '.xml'],
    maxBytes: 50 * 1024 * 1024,
    prefix: 'progress-imports',
    retentionEnv: 'PROGRESS_IMPORT_RETENTION_DAYS',
    defaultRetentionDays: 3650,
    unsupportedCode: 'UNSUPPORTED_FORMAT',
    unsupportedMessage: 'Allowed formats: .xer, .xml',
  },
};

const splitList = (value) =>
  String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const getTempUploadDir = () =>
  process.env.FILE_UPLOAD_TMP_DIR ||
  path.join(os.tmpdir(), 'pmcopilots-uploads');

const ensureTempUploadDirSync = () => {
  const dir = getTempUploadDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const getCategoryLocalRoot = (documentType) => {
  if (documentType === DOCUMENT_TYPES.SITE_PHOTO && process.env.SITE_REPORT_UPLOAD_DIR) {
    return process.env.SITE_REPORT_UPLOAD_DIR;
  }
  if (
    documentType === DOCUMENT_TYPES.WORKFLOW_ATTACHMENT &&
    process.env.WORKFLOW_UPLOAD_DIR
  ) {
    return process.env.WORKFLOW_UPLOAD_DIR;
  }
  return (
    process.env.FILE_STORAGE_LOCAL_DIR ||
    path.join(process.cwd(), 'storage', 'private-documents')
  );
};

const getStorageConfig = (documentType) => {
  const bucket =
    process.env.FILE_STORAGE_S3_BUCKET ||
    process.env.S3_UPLOADS_BUCKET ||
    process.env.S3_UPLOAD_BUCKET ||
    process.env.AWS_S3_UPLOADS_BUCKET ||
    process.env.AWS_S3_UPLOAD_BUCKET ||
    null;
  const requestedDriver = String(process.env.FILE_STORAGE_DRIVER || '').toLowerCase();
  const provider = requestedDriver === 'local' || !bucket ? 'local' : 's3';

  return {
    provider,
    bucket,
    region:
      process.env.FILE_STORAGE_S3_REGION ||
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      DEFAULT_REGION,
    localRoot: getCategoryLocalRoot(documentType),
  };
};

const retentionDaysFor = (documentType) => {
  const policy = DOCUMENT_POLICIES[documentType];
  const value = Number(process.env[policy.retentionEnv]);
  if (Number.isInteger(value) && value > 0) return value;
  return policy.defaultRetentionDays;
};

const retentionDateFor = (documentType, now = new Date()) => {
  const days = retentionDaysFor(documentType);
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
};

const assertProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true },
  });
  if (!project) {
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }
};

const safeName = (value, fallback = 'upload') =>
  String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || fallback;

const normalizeMime = (file) =>
  String(file?.mimetype || file?.mimeType || '').toLowerCase();

const originalExtension = (file) =>
  path.extname(file?.originalname || file?.originalName || file?.filename || '').toLowerCase();

const getAllowedExtension = (file, policy) => {
  const mimeType = normalizeMime(file);
  const extensions = MIME_EXTENSIONS[mimeType] || [];
  const ext = originalExtension(file);
  if (policy.allowedExtensions?.includes(ext)) return ext;
  if (extensions.includes(ext)) return ext;
  if (policy.allowedMime.has(mimeType) && extensions.length) return extensions[0];
  return ext;
};

const getFileSize = async (file) => {
  if (Number.isFinite(Number(file?.size))) return Number(file.size);
  if (Buffer.isBuffer(file?.buffer)) return file.buffer.length;
  if (file?.path) {
    const stat = await fsp.stat(file.path);
    return stat.size;
  }
  return 0;
};

const readHead = async (file, bytes = 512) => {
  if (Buffer.isBuffer(file?.buffer)) return file.buffer.subarray(0, bytes);
  if (!file?.path) return Buffer.alloc(0);

  const handle = await fsp.open(file.path, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

const createInputStream = (file) => {
  if (Buffer.isBuffer(file?.buffer)) return Readable.from(file.buffer);
  if (file?.path) return fs.createReadStream(file.path);
  throw new HttpError(400, 'NO_FILE', 'No file uploaded');
};

const inspectFile = async (file) => {
  const hash = crypto.createHash('sha256');
  let carry = '';

  for await (const chunk of createInputStream(file)) {
    hash.update(chunk);
    const text = carry + chunk.toString('latin1');
    if (text.includes(EICAR_SIGNATURE)) {
      throw new HttpError(
        422,
        'FILE_VIRUS_DETECTED',
        'Uploaded file failed malware scanning',
      );
    }
    carry = text.slice(-EICAR_SIGNATURE.length);
  }

  return {
    sha256: hash.digest('hex'),
    head: await readHead(file),
  };
};

const startsWith = (buffer, signature) =>
  buffer.length >= signature.length &&
  signature.every((value, index) => buffer[index] === value);

const hasZipHeader = (buffer) =>
  startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
  startsWith(buffer, [0x50, 0x4b, 0x05, 0x06]) ||
  startsWith(buffer, [0x50, 0x4b, 0x07, 0x08]);

const hasOleHeader = (buffer) =>
  startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const hasPngHeader = (buffer) =>
  startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const hasJpegHeader = (buffer) =>
  startsWith(buffer, [0xff, 0xd8, 0xff]);

const hasWebpHeader = (buffer) =>
  buffer.length >= 12 &&
  buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
  buffer.subarray(8, 12).toString('ascii') === 'WEBP';

const hasPdfHeader = (buffer) =>
  buffer.subarray(0, 5).toString('ascii') === '%PDF-';

const hasHeifHeader = (buffer) => {
  if (buffer.length < 12) return false;
  if (buffer.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
  const brand = buffer.subarray(8, 12).toString('ascii');
  return ['heic', 'heix', 'hevc', 'hevx', 'heif', 'mif1', 'msf1'].includes(brand);
};

const looksLikeText = (buffer) => {
  if (!buffer.length) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 512));
  return !sample.some((byte) => byte === 0x00 || (byte < 0x08));
};

const assertMagicMatches = ({ file, mimeType, extension, head }) => {
  const matches =
    (mimeType === 'application/octet-stream' &&
      ((['.xlsx', '.docx'].includes(extension) && hasZipHeader(head)) ||
        (['.xls', '.doc'].includes(extension) && hasOleHeader(head)) ||
        (['.csv', '.xml', '.xer'].includes(extension) && looksLikeText(head)))) ||
    (mimeType === 'image/jpeg' && hasJpegHeader(head)) ||
    (mimeType === 'image/png' && hasPngHeader(head)) ||
    (mimeType === 'image/webp' && hasWebpHeader(head)) ||
    ((mimeType === 'image/heic' || mimeType === 'image/heif') && hasHeifHeader(head)) ||
    (mimeType === 'application/pdf' && hasPdfHeader(head)) ||
    (mimeType === 'application/msword' && hasOleHeader(head)) ||
    (mimeType === 'application/vnd.ms-excel' && hasOleHeader(head)) ||
    (mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' &&
      hasZipHeader(head)) ||
    (mimeType ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' &&
      hasZipHeader(head)) ||
    ((mimeType === 'text/csv' ||
      mimeType === 'text/plain' ||
      mimeType === 'application/xml' ||
      mimeType === 'text/xml') &&
      looksLikeText(head));

  if (!matches) {
    throw new HttpError(
      400,
      'FILE_TYPE_MISMATCH',
      `File content does not match ${extension || 'the declared'} upload type`,
      {
        originalName: file?.originalname || file?.originalName || null,
        mimeType,
      },
    );
  }
};

const assertAllowedFile = async ({ file, documentType }) => {
  if (!file) {
    throw new HttpError(400, 'NO_FILE', 'No file uploaded');
  }

  const policy = DOCUMENT_POLICIES[documentType];
  const mimeType = normalizeMime(file);
  const extension = getAllowedExtension(file, policy);
  const allowedExtensions = MIME_EXTENSIONS[mimeType] || [];
  const allowedByPolicy = policy.allowedExtensions
    ? policy.allowedExtensions.includes(extension)
    : allowedExtensions.includes(extension);

  if (!policy.allowedMime.has(mimeType) || !allowedByPolicy) {
    throw new HttpError(
      400,
      policy.unsupportedCode,
      policy.unsupportedMessage,
    );
  }

  const sizeBytes = await getFileSize(file);
  if (sizeBytes <= 0) {
    throw new HttpError(400, 'EMPTY_FILE', 'Uploaded file is empty');
  }
  if (sizeBytes > policy.maxBytes) {
    throw new HttpError(
      413,
      'FILE_TOO_LARGE',
      `Uploaded file exceeds the ${Math.round(policy.maxBytes / 1024 / 1024)} MB limit`,
    );
  }

  const inspection = await inspectFile(file);
  assertMagicMatches({ file, mimeType, extension, head: inspection.head });

  return {
    mimeType,
    extension,
    sizeBytes,
    sha256: inspection.sha256,
  };
};

const buildPrivateObjectKey = ({
  orgId,
  projectId,
  documentType,
  storageKey,
  extension,
}) => {
  const policy = DOCUMENT_POLICIES[documentType];
  return `orgs/${safeName(orgId, 'org')}/projects/${safeName(projectId, 'project')}/${policy.prefix}/${storageKey}${extension}`;
};

const resolveLocalObjectPath = ({ localRoot, objectKey }) => {
  const safeRoot = path.resolve(localRoot);
  const target = path.resolve(safeRoot, ...objectKey.split('/'));
  if (!target.startsWith(safeRoot + path.sep)) {
    throw new HttpError(400, 'INVALID_FILE_KEY', 'File key is invalid');
  }
  return target;
};

const writeLocalObject = async ({ file, localRoot, objectKey }) => {
  const target = resolveLocalObjectPath({ localRoot, objectKey });
  await fsp.mkdir(path.dirname(target), { recursive: true });
  if (file.path) {
    await fsp.copyFile(file.path, target);
  } else if (Buffer.isBuffer(file.buffer)) {
    await fsp.writeFile(target, file.buffer);
  } else {
    throw new HttpError(400, 'NO_FILE', 'No file uploaded');
  }
  return null;
};

const encodeRfc3986 = (value) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const canonicalUri = (objectKey) =>
  `/${objectKey.split('/').map(encodeRfc3986).join('/')}`;

const sha256Hex = (value) =>
  crypto.createHash('sha256').update(value, 'utf8').digest('hex');

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
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    canonicalHeaders: `${entries.map(([key, value]) => `${key}:${value}`).join('\n')}\n`,
    signedHeaders: entries.map(([key]) => key).join(';'),
  };
};

const signingKey = ({ secretAccessKey, dateStamp, region }) => {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, 's3');
  return hmac(serviceKey, 'aws4_request');
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
          reject(
            new Error(
              `HTTP ${res.statusCode || 0} from ${target.hostname}: ${payload
                .toString('utf8')
                .slice(0, 300)}`,
            ),
          );
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`Request timed out: ${url}`)));
    req.on('error', reject);
    if (body) body.pipe ? body.pipe(req) : req.end(body);
    else req.end();
  });

let cachedAwsCredentials = null;

const getInstanceProfileCredentials = async () => {
  const tokenResponse = await httpRequest({
    method: 'PUT',
    url: 'http://169.254.169.254/latest/api/token',
    headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '21600' },
    timeout: 1000,
  });
  const token = tokenResponse.body.toString('utf8');
  const roleResponse = await httpRequest({
    url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    headers: { 'X-aws-ec2-metadata-token': token },
    timeout: 1000,
  });
  const roleName = roleResponse.body.toString('utf8').split('\n')[0].trim();
  if (!roleName) throw new Error('No EC2 instance profile role found');

  const credentialsResponse = await httpRequest({
    url: `http://169.254.169.254/latest/meta-data/iam/security-credentials/${encodeRfc3986(roleName)}`,
    headers: { 'X-aws-ec2-metadata-token': token },
    timeout: 1000,
  });
  const body = JSON.parse(credentialsResponse.body.toString('utf8'));
  return {
    accessKeyId: body.AccessKeyId,
    secretAccessKey: body.SecretAccessKey,
    sessionToken: body.Token,
    expiration: body.Expiration ? new Date(body.Expiration).getTime() : 0,
  };
};

const getAwsCredentials = async () => {
  if (
    cachedAwsCredentials &&
    (!cachedAwsCredentials.expiration ||
      cachedAwsCredentials.expiration - Date.now() > 5 * 60 * 1000)
  ) {
    return cachedAwsCredentials;
  }

  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    cachedAwsCredentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN || null,
      expiration: 0,
    };
    return cachedAwsCredentials;
  }

  cachedAwsCredentials = await getInstanceProfileCredentials();
  return cachedAwsCredentials;
};

const signS3Headers = async ({ method, bucket, region, objectKey, headers }) => {
  const credentials = await getAwsCredentials();
  const now = new Date();
  const amzDate = awsDate(now);
  const dateStamp = awsDateStamp(now);
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const signingHeaders = {
    ...headers,
    host,
    'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
    'x-amz-date': amzDate,
  };
  if (credentials.sessionToken) {
    signingHeaders['x-amz-security-token'] = credentials.sessionToken;
  }

  const { canonicalHeaders, signedHeaders } = buildCanonicalHeaders(signingHeaders);
  const canonicalRequest = [
    method,
    canonicalUri(objectKey),
    '',
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = hmac(
    signingKey({
      secretAccessKey: credentials.secretAccessKey,
      dateStamp,
      region,
    }),
    stringToSign,
    'hex',
  );

  return {
    ...signingHeaders,
    Authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
};

const putS3Object = async ({
  file,
  bucket,
  region,
  objectKey,
  mimeType,
  sizeBytes,
  sha256,
  documentType,
}) => {
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const headers = await signS3Headers({
    method: 'PUT',
    bucket,
    region,
    objectKey,
    headers: {
      'content-length': sizeBytes,
      'content-type': mimeType,
      'x-amz-meta-document-type': documentType,
      'x-amz-meta-sha256': sha256,
      'x-amz-server-side-encryption': 'AES256',
    },
  });
  const body = Buffer.isBuffer(file.buffer) ? file.buffer : fs.createReadStream(file.path);
  const response = await httpRequest({
    method: 'PUT',
    url: `https://${host}${canonicalUri(objectKey)}`,
    headers,
    body,
    timeout: 120000,
  });
  return response.headers['x-amz-version-id'] || null;
};

const createS3PresignedGetUrl = async ({ bucket, region, objectKey, expiresSeconds }) => {
  const credentials = await getAwsCredentials();
  const now = new Date();
  const amzDate = awsDate(now);
  const dateStamp = awsDateStamp(now);
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${credentials.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  if (credentials.sessionToken) {
    query['X-Amz-Security-Token'] = credentials.sessionToken;
  }
  const canonicalQuery = Object.entries(query)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&');
  const canonicalRequest = [
    'GET',
    canonicalUri(objectKey),
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = hmac(
    signingKey({
      secretAccessKey: credentials.secretAccessKey,
      dateStamp,
      region,
    }),
    stringToSign,
    'hex',
  );

  return `https://${host}${canonicalUri(objectKey)}?${canonicalQuery}&X-Amz-Signature=${signature}`;
};

const storeObject = async ({ file, documentType, objectKey, mimeType, sizeBytes, sha256 }) => {
  const config = getStorageConfig(documentType);
  if (config.provider === 's3') {
    const versionId = await putS3Object({
      file,
      bucket: config.bucket,
      region: config.region,
      objectKey,
      mimeType,
      sizeBytes,
      sha256,
      documentType,
    });
    return { storageProvider: 's3', bucket: config.bucket, storageVersionId: versionId };
  }

  await writeLocalObject({ file, localRoot: config.localRoot, objectKey });
  return { storageProvider: 'local', bucket: null, storageVersionId: null };
};

const uploadProjectDocument = async ({
  orgId,
  projectId,
  userId,
  file,
  documentType,
  linkedEntityType = null,
  linkedEntityId = null,
}) => {
  await assertProject({ orgId, projectId });
  const policy = DOCUMENT_POLICIES[documentType];
  if (!policy) {
    throw new HttpError(400, 'UNSUPPORTED_DOCUMENT_TYPE', 'Document type is invalid');
  }

  const { mimeType, extension, sizeBytes, sha256 } = await assertAllowedFile({
    file,
    documentType,
  });
  const storageKey = crypto.randomUUID();
  const objectKey = buildPrivateObjectKey({
    orgId,
    projectId,
    documentType,
    storageKey,
    extension,
  });
  const storage = await storeObject({
    file,
    documentType,
    objectKey,
    mimeType,
    sizeBytes,
    sha256,
  });
  const baseName = path.basename(
    file.originalname || file.originalName || `upload${extension}`,
    originalExtension(file),
  );
  const fileName = `${safeName(baseName)}${extension}`;
  const retentionDays = retentionDaysFor(documentType);

  const document = await prisma.projectDocument.create({
    data: {
      orgId,
      projectId,
      documentType,
      linkedEntityType,
      linkedEntityId,
      originalName: file.originalname || file.originalName || fileName,
      fileName,
      mimeType,
      sizeBytes,
      sha256,
      storageProvider: storage.storageProvider,
      bucket: storage.bucket,
      objectKey,
      storageKey,
      storageVersionId: storage.storageVersionId,
      scanStatus: 'clean',
      scannedAt: new Date(),
      status: linkedEntityType && linkedEntityId ? 'linked' : 'available',
      retentionPolicy: `retain-${retentionDays}-days`,
      retentionExpiresAt: retentionDateFor(documentType),
      uploadedBy: userId || null,
    },
  });

  // Text extraction for search runs in the background (OCTA-DOC-TEXT-010).
  // Required lazily to avoid a service cycle; a queue failure never blocks
  // the upload itself.
  try {
    const documentTextService = require('./document-text.service');
    if (documentTextService.isExtractableDocument(document)) {
      await documentTextService.enqueueExtraction({
        orgId,
        projectId,
        documentId: document.id,
        requestedBy: userId || null,
        document,
      });
    }
  } catch (error) {
    console.error('[document-text] failed to queue extraction', error?.message || error);
  }

  return document;
};

const serializeUploadedDocument = ({ document, projectId, routeBase }) => ({
  documentId: document.id,
  key: document.id,
  storageKey: document.id,
  url: `/api/v1/projects/${projectId}/${routeBase}/${document.id}`,
  fileUrl: `/api/v1/projects/${projectId}/${routeBase}/${document.id}`,
  downloadUrl: `/api/v1/projects/${projectId}/${routeBase}/${document.id}`,
  filename: document.fileName,
  fileName: document.fileName,
  originalName: document.originalName,
  mimeType: document.mimeType,
  size: document.sizeBytes,
  sizeBytes: document.sizeBytes,
  storage: document.storageProvider,
  scanStatus: document.scanStatus,
  retentionExpiresAt: document.retentionExpiresAt,
  uploadedBy: document.uploadedBy,
  uploadedAt:
    document.uploadedAt instanceof Date
      ? document.uploadedAt.toISOString()
      : document.uploadedAt,
});

const uploadFilesForType = async ({
  orgId,
  projectId,
  userId,
  files,
  documentType,
  routeBase,
}) => {
  if (!files?.length) {
    throw new HttpError(400, 'NO_FILE', 'No file uploaded');
  }

  const uploaded = [];
  for (const file of files) {
    const document = await uploadProjectDocument({
      orgId,
      projectId,
      userId,
      file,
      documentType,
    });
    uploaded.push(
      serializeUploadedDocument({
        document,
        projectId,
        routeBase,
      }),
    );
  }
  return uploaded;
};

const uploadBoqFile = async ({ orgId, projectId, userId, file }) => {
  const document = await uploadProjectDocument({
    orgId,
    projectId,
    userId,
    file,
    documentType: DOCUMENT_TYPES.BOQ_UPLOAD,
  });
  return serializeUploadedDocument({
    document,
    projectId,
    routeBase: 'boq/uploads',
  });
};

const uploadScheduleImportFile = async ({ orgId, projectId, userId, file }) => {
  const document = await uploadProjectDocument({
    orgId,
    projectId,
    userId,
    file,
    documentType: DOCUMENT_TYPES.SCHEDULE_IMPORT,
  });
  return serializeUploadedDocument({
    document,
    projectId,
    routeBase: 'import/uploads',
  });
};

const uploadProgressImportFile = async ({ orgId, projectId, userId, file }) => {
  const document = await uploadProjectDocument({
    orgId,
    projectId,
    userId,
    file,
    documentType: DOCUMENT_TYPES.PROGRESS_IMPORT,
  });
  return serializeUploadedDocument({
    document,
    projectId,
    routeBase: 'import/uploads',
  });
};

const uploadScheduleGenerationFile = async ({ orgId, projectId, userId, file }) => {
  const document = await uploadProjectDocument({
    orgId,
    projectId,
    userId,
    file,
    documentType: DOCUMENT_TYPES.SCHEDULE_GENERATION_SOURCE,
  });
  return serializeUploadedDocument({
    document,
    projectId,
    routeBase: 'schedule/uploads',
  });
};

const uploadSiteReportingFiles = ({ orgId, projectId, userId, files = [] }) =>
  uploadFilesForType({
    orgId,
    projectId,
    userId,
    files,
    documentType: DOCUMENT_TYPES.SITE_PHOTO,
    routeBase: 'site-reporting/uploads',
  });

const uploadWorkflowFiles = ({ orgId, projectId, userId, files = [] }) =>
  uploadFilesForType({
    orgId,
    projectId,
    userId,
    files,
    documentType: DOCUMENT_TYPES.WORKFLOW_ATTACHMENT,
    routeBase: 'workflow/uploads',
  });

const uploadDocumentControlFile = async ({ orgId, projectId, userId, file }) => {
  const rows = await uploadFilesForType({
    orgId,
    projectId,
    userId,
    files: file ? [file] : [],
    documentType: DOCUMENT_TYPES.WORKFLOW_ATTACHMENT,
    routeBase: 'doc-control/uploads',
  });
  return rows[0];
};

const getDocumentByPublicKey = async ({ orgId, projectId, documentType, key }) =>
  prisma.projectDocument.findFirst({
    where: {
      orgId,
      projectId,
      documentType: Array.isArray(documentType) ? { in: documentType } : documentType,
      OR: [{ id: key }, { storageKey: key }],
    },
  });

const getLegacyLocalFile = async ({ orgId, projectId, key, documentType }) => {
  const allowed =
    documentType === DOCUMENT_TYPES.SITE_PHOTO
      ? /^[a-f0-9-]+\.(jpg|jpeg|png|webp|heic|heif)$/i
      : /^[a-f0-9-]+\.(jpg|jpeg|png|webp|heic|heif|pdf|doc|docx|xls|xlsx|csv|txt)$/i;
  if (!allowed.test(key)) return null;

  const dir = path.join(getCategoryLocalRoot(documentType), orgId, projectId);
  const target = path.resolve(dir, key);
  const safeRoot = path.resolve(dir);
  if (!target.startsWith(safeRoot + path.sep)) {
    throw new HttpError(400, 'INVALID_FILE_KEY', 'File key is invalid');
  }

  try {
    await fsp.stat(target);
  } catch {
    return null;
  }

  const ext = path.extname(target).toLowerCase();
  return {
    path: target,
    mimeType: EXT_TO_MIME[ext] || 'application/octet-stream',
    fileName: key,
  };
};

const getProjectDocumentFile = async ({ orgId, projectId, key, documentType }) => {
  await assertProject({ orgId, projectId });
  const document = await getDocumentByPublicKey({
    orgId,
    projectId,
    documentType,
    key,
  });

  if (!document) {
    const legacy = await getLegacyLocalFile({ orgId, projectId, key, documentType });
    if (legacy) return legacy;
    throw new HttpError(404, 'FILE_NOT_FOUND', 'File not found');
  }

  if (!['available', 'linked'].includes(document.status)) {
    throw new HttpError(409, 'FILE_NOT_AVAILABLE', 'File is not available for download');
  }

  if (document.storageProvider === 's3') {
    return {
      redirectUrl: await createS3PresignedGetUrl({
        bucket: document.bucket,
        region:
          process.env.FILE_STORAGE_S3_REGION ||
          process.env.AWS_REGION ||
          process.env.AWS_DEFAULT_REGION ||
          DEFAULT_REGION,
        objectKey: document.objectKey,
        expiresSeconds: Number(process.env.FILE_PRESIGNED_URL_TTL_SECONDS) ||
          PRESIGNED_DOWNLOAD_EXPIRES_SECONDS,
      }),
      mimeType: document.mimeType,
      fileName: document.fileName,
    };
  }

  const config = getStorageConfig(document.documentType);
  const target = resolveLocalObjectPath({
    localRoot: config.localRoot,
    objectKey: document.objectKey,
  });
  try {
    await fsp.stat(target);
  } catch {
    throw new HttpError(404, 'FILE_NOT_FOUND', 'File not found');
  }
  return {
    path: target,
    mimeType: document.mimeType,
    fileName: document.fileName,
  };
};

const getSiteReportingFile = ({ orgId, projectId, key }) =>
  getProjectDocumentFile({
    orgId,
    projectId,
    key,
    documentType: DOCUMENT_TYPES.SITE_PHOTO,
  });

const getWorkflowFile = ({ orgId, projectId, key }) =>
  getProjectDocumentFile({
    orgId,
    projectId,
    key,
    documentType: DOCUMENT_TYPES.WORKFLOW_ATTACHMENT,
  });

const getBoqUploadFile = ({ orgId, projectId, key }) =>
  getProjectDocumentFile({
    orgId,
    projectId,
    key,
    documentType: DOCUMENT_TYPES.BOQ_UPLOAD,
  });

const getImportUploadFile = ({ orgId, projectId, key }) =>
  getProjectDocumentFile({
    orgId,
    projectId,
    key,
    documentType: [DOCUMENT_TYPES.SCHEDULE_IMPORT, DOCUMENT_TYPES.PROGRESS_IMPORT],
  });

const getScheduleGenerationFile = ({ orgId, projectId, key }) =>
  getProjectDocumentFile({
    orgId,
    projectId,
    key,
    documentType: DOCUMENT_TYPES.SCHEDULE_GENERATION_SOURCE,
  });

const markDocumentLinked = async ({ documentId, entityType, entityId }) => {
  if (!documentId) return null;
  return prisma.projectDocument.update({
    where: { id: documentId },
    data: {
      status: 'linked',
      linkedEntityType: entityType,
      linkedEntityId: entityId,
    },
  });
};

const markDocumentRejected = async ({ documentId, code, message }) => {
  if (!documentId) return null;
  return prisma.projectDocument.update({
    where: { id: documentId },
    data: {
      status: 'rejected',
      linkedEntityType: code || message || 'upload_rejected',
      linkedEntityId: null,
    },
  });
};

const cleanupTempFiles = async (files) => {
  const list = Array.isArray(files) ? files : [files];
  await Promise.all(
    list
      .filter((file) => file?.path)
      .map((file) => fsp.rm(file.path, { force: true }).catch(() => null)),
  );
};

const isAllowedMimeForType = (documentType, mimeType) =>
  DOCUMENT_POLICIES[documentType]?.allowedMime.has(String(mimeType || '').toLowerCase()) ||
  false;

const isAllowedOriginalNameForType = (documentType, originalName) => {
  const policy = DOCUMENT_POLICIES[documentType];
  const ext = path.extname(originalName || '').toLowerCase();
  if (policy.allowedExtensions) return policy.allowedExtensions.includes(ext);
  return [...policy.allowedMime].some((mimeType) =>
    (MIME_EXTENSIONS[mimeType] || []).includes(ext),
  );
};

module.exports = {
  ALLOWED_BOQ_MIME,
  ALLOWED_IMAGE_MIME,
  ALLOWED_WORKFLOW_MIME,
  DOCUMENT_TYPES,
  buildPrivateObjectKey,
  cleanupTempFiles,
  ensureTempUploadDirSync,
  getBoqUploadFile,
  getImportUploadFile,
  getScheduleGenerationFile,
  getTempUploadDir,
  getWorkflowFile,
  getSiteReportingFile,
  isAllowedMimeForType,
  isAllowedOriginalNameForType,
  markDocumentLinked,
  markDocumentRejected,
  uploadBoqFile,
  uploadDocumentControlFile,
  uploadProgressImportFile,
  uploadProjectDocument,
  uploadScheduleGenerationFile,
  uploadScheduleImportFile,
  uploadWorkflowFiles,
  uploadSiteReportingFiles,
};
