const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { URL } = require('url');
const { prisma } = require('../config/db');
const { HttpError } = require('../utils/http-error');
const { getAwsCredentials, httpRequest } = require('../utils/aws-credentials');
const { UNSIGNED_PAYLOAD, encodePath, presignUrl, signHeaders } = require('../utils/aws-sigv4');

const EICAR_SIGNATURE = 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE';
const DEFAULT_REGION = 'us-east-2';
const PRESIGNED_DOWNLOAD_EXPIRES_SECONDS = 5 * 60;
// A presigned URL is the capability to read a private object: an hour at most,
// and not so short that a slow phone cannot start the download.
const PRESIGNED_DOWNLOAD_MIN_SECONDS = 60;
const PRESIGNED_DOWNLOAD_MAX_SECONDS = 60 * 60;

const DOCUMENT_TYPES = Object.freeze({
  SITE_PHOTO: 'site_photo',
  WORKFLOW_ATTACHMENT: 'workflow_attachment',
  BOQ_UPLOAD: 'boq_upload',
  SCHEDULE_IMPORT: 'schedule_import',
  SCHEDULE_GENERATION_SOURCE: 'schedule_generation_source',
  PROGRESS_IMPORT: 'progress_import',
  DRAWING_SET: 'drawing_set',
  BIM_MODEL: 'bim_model',
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
      // A programme from a workbook (PC-2) is kept like an XER or MSPDI source.
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]),
    allowedExtensions: ['.xer', '.xml', '.xlsx'],
    maxBytes: 50 * 1024 * 1024,
    prefix: 'schedule-imports',
    retentionEnv: 'SCHEDULE_IMPORT_RETENTION_DAYS',
    defaultRetentionDays: 3650,
    unsupportedCode: 'UNSUPPORTED_FORMAT',
    unsupportedMessage: 'Allowed formats: .xer, .xml, .xlsx',
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
  [DOCUMENT_TYPES.BIM_MODEL]: {
    allowedMime: new Set(['application/octet-stream', 'text/plain', 'application/x-step', 'model/ifc']),
    allowedExtensions: ['.ifc'],
    maxBytes: 300 * 1024 * 1024,
    prefix: 'bim',
    retentionEnv: 'BIM_MODEL_RETENTION_DAYS',
    defaultRetentionDays: 3650,
    unsupportedCode: 'UNSUPPORTED_FORMAT',
    unsupportedMessage: 'Upload the model as an IFC file (.ifc)',
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
    // Path-style endpoint for a local fake S3 or MinIO. Production refuses it;
    // unset, the URL is the real virtual-hosted one exactly as before.
    endpoint: String(process.env.FILE_STORAGE_S3_ENDPOINT || '').trim() || null,
    localRoot: getCategoryLocalRoot(documentType),
  };
};

const presignedDownloadTtlSeconds = () => {
  const requested = Number(process.env.FILE_PRESIGNED_URL_TTL_SECONDS);
  const ttl = Number.isFinite(requested) && requested > 0
    ? Math.floor(requested)
    : PRESIGNED_DOWNLOAD_EXPIRES_SECONDS;
  return Math.min(PRESIGNED_DOWNLOAD_MAX_SECONDS, Math.max(PRESIGNED_DOWNLOAD_MIN_SECONDS, ttl));
};

// What a client sees when S3 or the credentials behind it fail. The cause is
// logged, never echoed: an S3 error body names the bucket and the key.
const storageUnavailable = (operation, error) => {
  console.error(`[file-storage] S3 ${operation} failed: ${error?.message || error}`);
  return new HttpError(503, 'FILE_STORAGE_UNAVAILABLE', 'File storage is temporarily unavailable');
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
        (['.csv', '.xml', '.xer', '.ifc'].includes(extension) && looksLikeText(head)))) ||
    ((mimeType === 'application/x-step' || mimeType === 'model/ifc') && looksLikeText(head)) ||
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

/**
 * Where an object lives on the wire. Unset FILE_STORAGE_S3_ENDPOINT gives the
 * real virtual-hosted https://<bucket>.s3.<region>.amazonaws.com/<key>; a set
 * one gives path-style <endpoint>/<bucket>/<key>, which is what a fake S3 on
 * 127.0.0.1 or MinIO answers.
 */
const s3Location = ({ bucket, region, objectKey, endpoint }) => {
  if (endpoint) {
    const base = new URL(endpoint);
    return { protocol: base.protocol, host: base.host, path: `/${bucket}/${objectKey}` };
  }
  return { protocol: 'https:', host: `${bucket}.s3.${region}.amazonaws.com`, path: `/${objectKey}` };
};

const putS3Object = async ({
  file,
  bucket,
  region,
  endpoint,
  objectKey,
  mimeType,
  sizeBytes,
  sha256,
  documentType,
}) => {
  const location = s3Location({ bucket, region, objectKey, endpoint });
  const credentials = await getAwsCredentials();
  const headers = signHeaders({
    method: 'PUT',
    host: location.host,
    path: location.path,
    headers: {
      'content-length': sizeBytes,
      'content-type': mimeType,
      'x-amz-meta-document-type': documentType,
      'x-amz-meta-sha256': sha256,
      'x-amz-server-side-encryption': 'AES256',
    },
    payloadHash: UNSIGNED_PAYLOAD,
    service: 's3',
    region,
    credentials,
  });
  const body = Buffer.isBuffer(file.buffer) ? file.buffer : fs.createReadStream(file.path);
  const response = await httpRequest({
    method: 'PUT',
    url: `${location.protocol}//${location.host}${encodePath(location.path)}`,
    headers,
    body,
    timeout: 120000,
  });
  return response.headers['x-amz-version-id'] || null;
};

const createS3PresignedGetUrl = async ({ bucket, region, endpoint, objectKey, expiresSeconds }) => {
  // The credentials must outlive the URL, or it dies before X-Amz-Expires.
  const credentials = await getAwsCredentials({ minValidityMs: (expiresSeconds + 60) * 1000 });
  const location = s3Location({ bucket, region, objectKey, endpoint });
  return presignUrl({
    protocol: location.protocol,
    host: location.host,
    path: location.path,
    service: 's3',
    region,
    credentials,
    expiresSeconds,
  });
};

const storeObject = async ({ file, documentType, objectKey, mimeType, sizeBytes, sha256 }) => {
  const config = getStorageConfig(documentType);
  if (config.provider === 's3') {
    let versionId;
    try {
      versionId = await putS3Object({
        file,
        bucket: config.bucket,
        region: config.region,
        endpoint: config.endpoint,
        objectKey,
        mimeType,
        sizeBytes,
        sha256,
        documentType,
      });
    } catch (error) {
      throw storageUnavailable('upload', error);
    }
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
    // Region and endpoint come from the one storage config, so an upload and
    // its download link can never be signed for different regions.
    const config = getStorageConfig(document.documentType);
    let redirectUrl;
    try {
      redirectUrl = await createS3PresignedGetUrl({
        bucket: document.bucket,
        region: config.region,
        endpoint: config.endpoint,
        objectKey: document.objectKey,
        expiresSeconds: presignedDownloadTtlSeconds(),
      });
    } catch (error) {
      throw storageUnavailable('download link', error);
    }
    return {
      redirectUrl,
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

/**
 * The workflow document a public key (its id or its storage key) names in
 * this project, or null — so a download route can ask whether the caller may
 * read that document before serving it (certification L2).
 */
const findWorkflowDocument = ({ orgId, projectId, key }) =>
  getDocumentByPublicKey({
    orgId,
    projectId,
    documentType: DOCUMENT_TYPES.WORKFLOW_ATTACHMENT,
    key,
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

const getBimModelFile = ({ orgId, projectId, key }) =>
  getProjectDocumentFile({
    orgId,
    projectId,
    key,
    documentType: DOCUMENT_TYPES.BIM_MODEL,
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
  findWorkflowDocument,
  getBimModelFile,
  getBoqUploadFile,
  getImportUploadFile,
  // Photos, attachments and document text all serve a project document
  // through this. Defined here but never exported, so every caller got
  // undefined and every photograph was a 500.
  getProjectDocumentFile,
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
