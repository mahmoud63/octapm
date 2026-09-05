const fs = require("fs");
const fsp = require("fs/promises");
const https = require("https");
const http = require("http");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { readImageMetadata } = require("../utils/image-metadata");
const fileStorageService = require("./file-storage.service");
const auditService = require("./audit.service");
const { JobError } = require("../jobs/errors");

/**
 * Unified attachments (OCTA-DOC-ATTACH-006).
 *
 * Every record type links files through one `Attachment` row that points at a
 * `ProjectDocument`; images additionally get a `Photo` row with EXIF, GPS,
 * location, tags and an asynchronously generated thumbnail. One photo can be
 * attached to many records.
 */

const ATTACHMENT_ROLES = Object.freeze(["attachment", "evidence", "photo", "reference"]);
const THUMBNAIL_STATUS = Object.freeze({
  PENDING: "pending",
  READY: "ready",
  UNAVAILABLE: "unavailable",
  FAILED: "failed",
});
const THUMBNAIL_WIDTH = 480;
const PHOTO_TAG_LIMIT = 20;

/** Record types that accept attachments and the permission module that guards them. */
const RECORD_TYPE_MODULES = Object.freeze({
  risk: "risk",
  ncr: "ncr",
  itp: "ncr",
  defect: "ncr",
  material_test: "ncr",
  safety_incident: "safety",
  rfi: "rfi",
  submittal: "submittal",
  drawing: "document_control",
  transmittal: "document_control",
  correspondence: "document_control",
  document: "document_control",
  task: "task",
  daily_report: "progress",
  site_diary: "progress",
  progress_submission: "progress",
  activity: "schedule",
  change_order: "change_order",
  ipc: "ipc",
  ipc_certificate: "ipc",
  sub_valuation: "ipc",
  eot: "eot",
  weather_delay: "eot",
  meeting: "meeting",
  meeting_action: "meeting",
  procurement_order: "procurement",
  procurement_package: "procurement",
  delivery_receipt: "procurement",
  cost_record: "cost",
  boq_item: "boq",
  location: "location",
  project: "project_parties",
});
const RECORD_TYPES = Object.keys(RECORD_TYPE_MODULES);

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const toIso = (value) => value?.toISOString?.() || value || null;

const isImage = (mimeType) => String(mimeType || "").startsWith("image/");

const moduleForRecordType = (recordType) => {
  const moduleName = RECORD_TYPE_MODULES[recordType];
  if (!moduleName) {
    throw new HttpError(400, "ATTACHMENT_RECORD_TYPE_INVALID", `Unknown record type: ${recordType}`);
  }
  return moduleName;
};

const normalizeRole = (role, fallback = "attachment") => {
  const value = trimOrNull(role) || fallback;
  if (!ATTACHMENT_ROLES.includes(value)) {
    throw new HttpError(400, "ATTACHMENT_ROLE_INVALID", `Role must be one of ${ATTACHMENT_ROLES.join(", ")}`);
  }
  return value;
};

const normalizeTags = (tags) => {
  if (tags === undefined) return undefined;
  const list = Array.isArray(tags)
    ? tags
    : String(tags || "")
        .split(",")
        .map((tag) => tag.trim());
  const unique = [...new Set(list.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))];
  return unique.slice(0, PHOTO_TAG_LIMIT);
};

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true },
  });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

// ─── Serialization ──────────────────────────────────────────────────────────

const documentUrl = (projectId, documentId) =>
  `/api/v1/projects/${projectId}/attachments/documents/${documentId}`;

const photoUrls = (projectId, photo) => ({
  url: documentUrl(projectId, photo.documentId),
  thumbnailUrl:
    photo.thumbnailStatus === THUMBNAIL_STATUS.READY && photo.thumbnailKey
      ? `/api/v1/projects/${projectId}/photos/${photo.id}/thumbnail`
      : documentUrl(projectId, photo.documentId),
});

const serializePhoto = (photo, projectId, extra = {}) =>
  photo
    ? {
        id: photo.id,
        documentId: photo.documentId,
        locationId: photo.locationId || null,
        location: photo.location
          ? { id: photo.location.id, name: photo.location.name, fullName: photo.location.fullName || null, path: photo.location.path }
          : null,
        caption: photo.caption || null,
        tags: photo.tags || [],
        takenAt: toIso(photo.takenAt),
        latitude: photo.latitude ?? null,
        longitude: photo.longitude ?? null,
        altitude: photo.altitude ?? null,
        cameraMake: photo.cameraMake || null,
        cameraModel: photo.cameraModel || null,
        width: photo.width ?? null,
        height: photo.height ?? null,
        orientation: photo.orientation ?? null,
        thumbnailStatus: photo.thumbnailStatus,
        uploadedBy: photo.uploadedBy || null,
        createdAt: toIso(photo.createdAt),
        updatedAt: toIso(photo.updatedAt),
        ...photoUrls(projectId, photo),
        ...extra,
      }
    : null;

const serializeDocument = (document, projectId) =>
  document
    ? {
        id: document.id,
        fileName: document.fileName,
        originalName: document.originalName,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        documentType: document.documentType,
        uploadedBy: document.uploadedBy || null,
        uploadedAt: toIso(document.uploadedAt),
        url: documentUrl(projectId, document.id),
      }
    : null;

const serializeAttachment = (attachment, projectId) => ({
  id: attachment.id,
  projectId,
  recordType: attachment.recordType,
  recordId: attachment.recordId,
  documentId: attachment.documentId,
  role: attachment.role,
  caption: attachment.caption || null,
  sortOrder: attachment.sortOrder,
  source: attachment.source,
  uploadedBy: attachment.uploadedBy || null,
  createdAt: toIso(attachment.createdAt),
  document: serializeDocument(attachment.document, projectId),
  photo: serializePhoto(attachment.document?.photo, projectId),
  // Legacy-compatible fields so existing evidence lists keep rendering.
  fileName: attachment.document?.fileName || null,
  fileUrl: attachment.document ? documentUrl(projectId, attachment.document.id) : null,
  mimeType: attachment.document?.mimeType || null,
  sizeBytes: attachment.document?.sizeBytes ?? null,
});

const attachmentInclude = {
  document: { include: { photo: { include: { location: { select: { id: true, name: true, path: true } } } } } },
};

// ─── Photos ─────────────────────────────────────────────────────────────────

const enqueueThumbnail = async ({ orgId, projectId, photoId, userId }) => {
  try {
    const jobService = require("../jobs/job.service");
    if (!prisma.backgroundJob?.create) return null;
    return await jobService.enqueueJob({
      orgId,
      projectId,
      type: jobService.JOB_TYPES.PHOTO_THUMBNAIL,
      payload: { photoId },
      requestedBy: userId || null,
      maxAttempts: 2,
    });
  } catch (error) {
    console.error("[attachments] could not enqueue thumbnail job", error);
    return null;
  }
};

/** Creates (or returns) the Photo row for an image document. */
const ensurePhotoForDocument = async ({
  tx = prisma,
  orgId,
  projectId,
  document,
  userId = null,
  metadata = null,
  locationId = null,
  caption = null,
  tags = [],
}) => {
  if (!isImage(document.mimeType) || !tx.photo?.upsert) return null;
  const meta = metadata || {};
  return tx.photo.upsert({
    where: { documentId: document.id },
    create: {
      orgId,
      projectId,
      documentId: document.id,
      locationId: locationId || null,
      caption: trimOrNull(caption),
      tags: tags || [],
      takenAt: meta.takenAt || document.uploadedAt || null,
      latitude: meta.latitude ?? null,
      longitude: meta.longitude ?? null,
      altitude: meta.altitude ?? null,
      cameraMake: meta.cameraMake || null,
      cameraModel: meta.cameraModel || null,
      width: meta.width ?? null,
      height: meta.height ?? null,
      orientation: meta.orientation ?? null,
      exifJson: meta.raw || null,
      thumbnailStatus: THUMBNAIL_STATUS.PENDING,
      uploadedBy: userId || document.uploadedBy || null,
    },
    update: {
      ...(locationId ? { locationId } : {}),
      ...(trimOrNull(caption) ? { caption: trimOrNull(caption) } : {}),
      ...(tags?.length ? { tags } : {}),
    },
  });
};

// ─── Attachments ────────────────────────────────────────────────────────────

const parseDocumentIds = (value) => {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) return value.map(trimOrNull).filter(Boolean);
  const text = String(value).trim();
  if (text.startsWith("[")) {
    try {
      return JSON.parse(text).map(trimOrNull).filter(Boolean);
    } catch {
      throw new HttpError(400, "ATTACHMENT_DOCUMENT_IDS_INVALID", "documentIds must be a JSON array");
    }
  }
  return text.split(",").map(trimOrNull).filter(Boolean);
};

/**
 * Attaches uploaded files and/or existing documents to a record. Files are
 * stored as ProjectDocuments (images also become Photos with EXIF read from
 * the temp upload before it is cleaned up).
 */
const createAttachments = async ({
  orgId,
  projectId,
  userId = null,
  userRole = null,
  recordType,
  recordId,
  role,
  caption = null,
  locationId = null,
  tags,
  files = [],
  documentIds = [],
}) => {
  await ensureProject({ orgId, projectId });
  moduleForRecordType(recordType);
  const id = trimOrNull(recordId);
  if (!id) throw new HttpError(400, "ATTACHMENT_RECORD_ID_REQUIRED", "recordId is required");
  const ids = parseDocumentIds(documentIds);
  if (!files.length && !ids.length) {
    throw new HttpError(400, "NO_FILE", "Upload at least one file or link a document");
  }
  const normalizedTags = normalizeTags(tags) || [];

  // Uploads first (outside the transaction: object storage is not transactional).
  const uploaded = [];
  for (const file of files) {
    const mimeType = file.mimetype || file.mimeType || "";
    const metadata = isImage(mimeType) ? await readImageMetadata(file.path) : null;
    const document = await fileStorageService.uploadProjectDocument({
      orgId,
      projectId,
      userId,
      file,
      documentType: fileStorageService.DOCUMENT_TYPES.WORKFLOW_ATTACHMENT,
      linkedEntityType: recordType,
      linkedEntityId: id,
    });
    uploaded.push({ document, metadata });
  }

  const linkedDocuments = ids.length
    ? await prisma.projectDocument.findMany({
        where: { id: { in: ids }, orgId, projectId, status: { in: ["available", "linked"] } },
      })
    : [];
  const missing = ids.filter((docId) => !linkedDocuments.some((doc) => doc.id === docId));
  if (missing.length) {
    throw new HttpError(404, "ATTACHMENT_DOCUMENT_NOT_FOUND", "One or more documents were not found in this project");
  }

  const created = await prisma.$transaction(async (tx) => {
    const rows = [];
    const entries = [
      ...uploaded.map((entry) => ({ ...entry, source: "upload" })),
      ...linkedDocuments.map((document) => ({ document, metadata: null, source: "link" })),
    ];
    let sortOrder = await tx.attachment.count({ where: { recordType, recordId: id } });

    for (const entry of entries) {
      const attachmentRole = normalizeRole(
        role,
        isImage(entry.document.mimeType) ? "photo" : entry.source === "link" ? "reference" : "attachment",
      );
      const attachment = await tx.attachment.upsert({
        where: {
          recordType_recordId_documentId: { recordType, recordId: id, documentId: entry.document.id },
        },
        create: {
          orgId,
          projectId,
          recordType,
          recordId: id,
          documentId: entry.document.id,
          role: attachmentRole,
          caption: trimOrNull(caption),
          sortOrder: sortOrder++,
          source: entry.source,
          uploadedBy: userId || null,
        },
        update: {
          role: attachmentRole,
          ...(trimOrNull(caption) ? { caption: trimOrNull(caption) } : {}),
        },
        include: attachmentInclude,
      });

      if (isImage(entry.document.mimeType)) {
        const photo = await ensurePhotoForDocument({
          tx,
          orgId,
          projectId,
          document: entry.document,
          userId,
          metadata: entry.metadata,
          locationId,
          caption,
          tags: normalizedTags,
        });
        attachment.document.photo = photo
          ? { ...photo, location: attachment.document.photo?.location || null }
          : attachment.document.photo;
      }

      await auditService.recordEvent({
        tx,
        orgId,
        projectId,
        entityType: auditService.ENTITY_TYPES.ATTACHMENT,
        entityId: attachment.id,
        action: auditService.ACTIONS.CREATED,
        actorId: userId,
        actorRole: userRole,
        summary: {
          recordType,
          recordId: id,
          fileName: entry.document.fileName,
          role: attachmentRole,
        },
        metadata: { recordType, recordId: id, documentId: entry.document.id, source: entry.source },
      });
      rows.push(attachment);
    }
    return rows;
  });

  // Thumbnails are generated in the background; failures never block the upload.
  for (const attachment of created) {
    const photo = attachment.document?.photo;
    if (photo && photo.thumbnailStatus === THUMBNAIL_STATUS.PENDING && !photo.thumbnailKey) {
      await enqueueThumbnail({ orgId, projectId, photoId: photo.id, userId });
    }
  }

  return { items: created.map((row) => serializeAttachment(row, projectId)) };
};

const listAttachments = async ({ orgId, projectId, recordType, recordId }) => {
  await ensureProject({ orgId, projectId });
  if (recordType) moduleForRecordType(recordType);
  const rows = await prisma.attachment.findMany({
    where: {
      projectId,
      ...(recordType ? { recordType } : {}),
      ...(recordId ? { recordId } : {}),
    },
    include: attachmentInclude,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: 500,
  });
  return { items: rows.map((row) => serializeAttachment(row, projectId)) };
};

const getAttachment = async ({ orgId, projectId, attachmentId }) => {
  const row = await prisma.attachment.findFirst({
    where: { id: attachmentId, projectId, orgId },
    include: attachmentInclude,
  });
  if (!row) throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found");
  return row;
};

/** Unlinks a document from a record. The document and its photo stay. */
const deleteAttachment = async ({ orgId, projectId, attachmentId, userId = null, userRole = null }) => {
  const existing = await getAttachment({ orgId, projectId, attachmentId });
  await prisma.$transaction(async (tx) => {
    await tx.attachment.delete({ where: { id: attachmentId } });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.ATTACHMENT,
      entityId: attachmentId,
      action: auditService.ACTIONS.DELETED,
      actorId: userId,
      actorRole: userRole,
      summary: { recordType: existing.recordType, recordId: existing.recordId, fileName: existing.document?.fileName },
      metadata: { recordType: existing.recordType, recordId: existing.recordId, documentId: existing.documentId },
    });
  });
  return { deleted: true, id: attachmentId, recordType: existing.recordType, recordId: existing.recordId };
};

/** Streams any document that is attached somewhere on the project. */
const getDocumentFile = async ({ orgId, projectId, documentId }) => {
  const document = await prisma.projectDocument.findFirst({
    where: { id: documentId, orgId, projectId },
    select: { id: true, documentType: true },
  });
  if (!document) throw new HttpError(404, "FILE_NOT_FOUND", "File not found");
  return fileStorageService.getProjectDocumentFile({
    orgId,
    projectId,
    key: document.id,
    documentType: document.documentType,
  });
};

// ─── Gallery ────────────────────────────────────────────────────────────────

const photoInclude = {
  document: { select: { id: true, fileName: true, originalName: true, mimeType: true, sizeBytes: true, uploadedAt: true, uploadedBy: true, documentType: true } },
  location: { select: { id: true, name: true, path: true } },
};

const parseDate = (value, endOfDay = false) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, "PHOTO_DATE_INVALID", "Date filters must be ISO-8601");
  }
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) date.setHours(23, 59, 59, 999);
  return date;
};

const listPhotos = async ({ orgId, projectId, query = {} }) => {
  await ensureProject({ orgId, projectId });
  const limit = Math.min(Math.max(Number(query.limit) || 60, 1), 200);
  const where = { projectId, orgId };

  const from = parseDate(query.from);
  const to = parseDate(query.to, true);
  if (from || to) {
    where.takenAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }
  if (query.locationId) {
    const location = await prisma.location.findFirst({
      where: { id: query.locationId, projectId },
      select: { id: true, path: true },
    });
    if (!location) throw new HttpError(404, "LOCATION_NOT_FOUND", "Location not found");
    const subtree = await prisma.location.findMany({
      where: { projectId, OR: [{ id: location.id }, { path: { startsWith: `${location.path}/` } }] },
      select: { id: true },
    });
    where.locationId = { in: subtree.map((row) => row.id) };
  }
  const tag = trimOrNull(query.tag)?.toLowerCase();
  if (tag) where.tags = { has: tag };
  if (query.recordType) {
    moduleForRecordType(query.recordType);
    where.document = {
      attachments: {
        some: { recordType: query.recordType, ...(query.recordId ? { recordId: query.recordId } : {}) },
      },
    };
  }
  if (query.search) {
    const search = String(query.search).trim();
    where.OR = [
      { caption: { contains: search, mode: "insensitive" } },
      { document: { originalName: { contains: search, mode: "insensitive" } } },
    ];
  }

  const rows = await prisma.photo.findMany({
    where,
    include: photoInclude,
    orderBy: [{ takenAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const links = page.length
    ? await prisma.attachment.findMany({
        where: { projectId, documentId: { in: page.map((row) => row.documentId) } },
        select: { documentId: true, recordType: true, recordId: true, role: true },
      })
    : [];
  const linksByDocument = links.reduce((map, link) => {
    if (!map.has(link.documentId)) map.set(link.documentId, []);
    map.get(link.documentId).push({ recordType: link.recordType, recordId: link.recordId, role: link.role });
    return map;
  }, new Map());

  const [total, tagRows] = await Promise.all([
    prisma.photo.count({ where: { projectId, orgId } }),
    prisma.photo.findMany({ where: { projectId, orgId }, select: { tags: true }, take: 2000 }),
  ]);
  const tagCounts = {};
  for (const row of tagRows) for (const value of row.tags || []) tagCounts[value] = (tagCounts[value] || 0) + 1;

  return {
    items: page.map((photo) =>
      serializePhoto(photo, projectId, {
        document: serializeDocument(photo.document, projectId),
        records: linksByDocument.get(photo.documentId) || [],
      }),
    ),
    pagination: { limit, nextCursor: hasMore ? page[page.length - 1].id : null },
    summary: {
      total,
      tags: Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([value, count]) => ({ tag: value, count })),
    },
  };
};

const getPhoto = async ({ orgId, projectId, photoId }) => {
  const photo = await prisma.photo.findFirst({
    where: { id: photoId, projectId, orgId },
    include: photoInclude,
  });
  if (!photo) throw new HttpError(404, "PHOTO_NOT_FOUND", "Photo not found");
  return photo;
};

const updatePhoto = async ({ orgId, projectId, photoId, payload = {}, userId = null, userRole = null }) => {
  const existing = await getPhoto({ orgId, projectId, photoId });
  const data = {};
  if (payload.caption !== undefined) data.caption = trimOrNull(payload.caption);
  if (payload.tags !== undefined) data.tags = normalizeTags(payload.tags);
  if (payload.takenAt !== undefined) data.takenAt = parseDate(payload.takenAt);
  if (payload.locationId !== undefined) {
    const locationId = trimOrNull(payload.locationId);
    if (locationId) {
      const location = await prisma.location.findFirst({ where: { id: locationId, projectId }, select: { id: true } });
      if (!location) throw new HttpError(404, "LOCATION_NOT_FOUND", "Location not found");
    }
    data.locationId = locationId;
  }

  const photo = await prisma.$transaction(async (tx) => {
    const updated = await tx.photo.update({ where: { id: existing.id }, data, include: photoInclude });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: auditService.ENTITY_TYPES.PHOTO,
      entityId: existing.id,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      actorRole: userRole,
      summary: { caption: updated.caption, tags: updated.tags, locationId: updated.locationId },
      metadata: { fields: Object.keys(data) },
    });
    return updated;
  });

  return serializePhoto(photo, projectId, { document: serializeDocument(photo.document, projectId) });
};

const getPhotoFile = async ({ orgId, projectId, photoId, variant = "original" }) => {
  const photo = await getPhoto({ orgId, projectId, photoId });
  const key =
    variant === "thumbnail" && photo.thumbnailStatus === THUMBNAIL_STATUS.READY && photo.thumbnailKey
      ? photo.thumbnailKey
      : photo.documentId;
  const document = await prisma.projectDocument.findFirst({
    where: { id: key, orgId, projectId },
    select: { id: true, documentType: true },
  });
  if (!document) throw new HttpError(404, "FILE_NOT_FOUND", "File not found");
  return fileStorageService.getProjectDocumentFile({
    orgId,
    projectId,
    key: document.id,
    documentType: document.documentType,
  });
};

// ─── Thumbnail job ──────────────────────────────────────────────────────────

const loadSharp = () => {
  try {
    // Optional dependency: native image codec. Absent in minimal installs.
    return require("sharp");
  } catch {
    return null;
  }
};

const downloadToTemp = (url, extension) =>
  new Promise((resolve, reject) => {
    const target = path.join(os.tmpdir(), `octapm-photo-${crypto.randomUUID()}${extension}`);
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new JobError("PHOTO_DOWNLOAD_FAILED", `Download failed (${response.statusCode})`, { retryable: true }));
          return;
        }
        const stream = fs.createWriteStream(target);
        response.pipe(stream);
        stream.on("finish", () => stream.close(() => resolve(target)));
        stream.on("error", reject);
      })
      .on("error", reject);
  });

const runPhotoThumbnailJob = async ({ job, payload = {}, updateProgress = async () => {} }) => {
  const photoId = payload.photoId;
  const photo = await prisma.photo.findFirst({
    where: { id: photoId, orgId: job.orgId },
    include: { document: true },
  });
  if (!photo) throw new JobError("PHOTO_NOT_FOUND", "Photo no longer exists", { retryable: false });

  const sharp = loadSharp();
  if (!sharp) {
    await prisma.photo.update({
      where: { id: photo.id },
      data: { thumbnailStatus: THUMBNAIL_STATUS.UNAVAILABLE },
    });
    return { photoId: photo.id, status: THUMBNAIL_STATUS.UNAVAILABLE, reason: "sharp not installed" };
  }

  await updateProgress({ step: "load", progress: 10 });
  const source = await fileStorageService.getProjectDocumentFile({
    orgId: photo.orgId,
    projectId: photo.projectId,
    key: photo.documentId,
    documentType: photo.document.documentType,
  });
  const extension = path.extname(photo.document.fileName || "") || ".jpg";
  const localPath = source.path || (await downloadToTemp(source.redirectUrl, extension));
  const thumbPath = path.join(os.tmpdir(), `octapm-thumb-${crypto.randomUUID()}.jpg`);

  try {
    await updateProgress({ step: "resize", progress: 40 });
    const image = sharp(localPath).rotate().resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true });
    const info = await image.jpeg({ quality: 78 }).toFile(thumbPath);
    const original = await sharp(localPath).metadata().catch(() => ({}));

    await updateProgress({ step: "store", progress: 70 });
    const thumbDocument = await fileStorageService.uploadProjectDocument({
      orgId: photo.orgId,
      projectId: photo.projectId,
      userId: photo.uploadedBy,
      file: {
        path: thumbPath,
        originalname: `${path.basename(photo.document.fileName || "photo", extension)}-thumb.jpg`,
        mimetype: "image/jpeg",
        size: info.size,
      },
      documentType: fileStorageService.DOCUMENT_TYPES.WORKFLOW_ATTACHMENT,
      linkedEntityType: "photo_thumbnail",
      linkedEntityId: photo.id,
    });

    await prisma.photo.update({
      where: { id: photo.id },
      data: {
        thumbnailKey: thumbDocument.id,
        thumbnailStatus: THUMBNAIL_STATUS.READY,
        width: photo.width || original.width || null,
        height: photo.height || original.height || null,
      },
    });
    return { photoId: photo.id, status: THUMBNAIL_STATUS.READY, thumbnailKey: thumbDocument.id };
  } catch (error) {
    await prisma.photo.update({
      where: { id: photo.id },
      data: { thumbnailStatus: THUMBNAIL_STATUS.FAILED },
    });
    throw new JobError("PHOTO_THUMBNAIL_FAILED", error?.message || "Thumbnail generation failed", {
      retryable: false,
    });
  } finally {
    await fsp.unlink(thumbPath).catch(() => {});
    if (!source.path && localPath) await fsp.unlink(localPath).catch(() => {});
  }
};

module.exports = {
  ATTACHMENT_ROLES,
  RECORD_TYPES,
  RECORD_TYPE_MODULES,
  THUMBNAIL_STATUS,
  createAttachments,
  deleteAttachment,
  ensurePhotoForDocument,
  getAttachment,
  getDocumentFile,
  getPhoto,
  getPhotoFile,
  listAttachments,
  listPhotos,
  moduleForRecordType,
  normalizeTags,
  parseDocumentIds,
  runPhotoThumbnailJob,
  serializeAttachment,
  serializePhoto,
  updatePhoto,
};
